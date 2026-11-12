import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { simGames, summarize } from "./possessionMetrics.ts";
import {
	ENDGAME,
	endgameRole,
	endgameRoleScore,
	endgameValues,
	foulTargetWeights,
	runTimeoutSource,
	runTimeoutThreshold,
	saveLastTimeout,
	upThreeFoulProb,
} from "./endgame.ts";
import { NEUTRAL_COACH_SIM } from "../../../common/coachSystems.ts";
import { range } from "../../../common/utils.ts";

/*
 * End-of-Game Intelligence (the smartEndgame setting, endgame.ts). Off: nothing runs (the fixed-seed box scores of
 * outcomeInvariance.test.ts are recorded with it off, and the checks below). On: scenario tests with the clock and the score set by
 * hand. The league averages and the close-game outcomes are in docs/native-features.md (endgame.script.test.ts).
 */

afterAll(() => {
	resetG();
});

type Sim = any;

// A game about to start, with the given settings, and everything that follows on the seeded random numbers
const scenario = <T>(
	seed: number,
	settings: Record<string, unknown>,
	fn: (sim: Sim) => T | Promise<T>,
) =>
	withSeededRandom(seed, async () => {
		await genTeams();
		g.setWithoutSavingToDB("storePlayByPlay", false);
		for (const [key, value] of Object.entries(settings)) {
			g.setWithoutSavingToDB(key as any, value as any);
		}
		const teams = await loadTeams([0, 1], {});
		const sim: Sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: 0,
			doPlayByPlay: false,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: true,
		});
		return fn(sim);
	});

// The clock and the score by hand: team o has the ball in the given period with t seconds left
const setState = (
	sim: Sim,
	{
		period = 4,
		t,
		pts,
		o = 0,
		prev = "drb",
	}: {
		period?: number;
		t: number;
		pts: [number, number];
		o?: 0 | 1;
		prev?: string;
	},
) => {
	sim.t = t;
	sim.o = o;
	sim.d = o === 0 ? 1 : 0;
	sim.nextOffense = o;
	sim.prevPossessionOutcome = prev;
	for (const i of [0, 1]) {
		sim.team[i].stat.pts = pts[i];
		sim.team[i].stat.ptsQtrs = range(period).map(() => pts[i]! / period);
	}
};

const coach = (mgmt: number, quick: boolean) => ({
	...NEUTRAL_COACH_SIM,
	off: "motion",
	def: "switch",
	foulWindow: 27 + 6 * mgmt,
	burnTimeout: quick,
});
const setCoaches = (sim: Sim, a: any, b: any) => {
	sim.coachSys = true;
	sim.cs = [a, b];
};

const countRandom = <T>(fn: () => T) => {
	const original = Math.random;
	let n = 0;
	Math.random = () => {
		n += 1;
		return original();
	};
	try {
		return { out: fn(), n };
	} finally {
		Math.random = original;
	}
};

test("off: nothing of the feature runs", async () => {
	for (const seed of [11, 12, 13]) {
		const sim = await scenario(seed, { smartEndgame: false }, (s) => {
			s.run();
			return s;
		});
		assert.isFalse(sim.smartEndgame);
		assert.deepStrictEqual(sim.earlyTimeouts, [0, 0]);
		assert.deepStrictEqual(sim.scoringRun, [0, 0]);
		assert.deepStrictEqual(sim.endgameCounts, {
			runTimeouts: 0,
			up3Fouls: 0,
			odSubs: 0,
		});
		assert.deepStrictEqual(sim.up3Coach, [undefined, undefined]);
	}
});

test("off: the same game whether the setting is false or missing, on: a different game", async () => {
	const box = (settings: Record<string, unknown>) =>
		scenario(21, settings, (s) => JSON.stringify(s.run().team));
	const a = await box({ smartEndgame: false });
	const b = await box({});
	const c = await box({ smartEndgame: true });
	assert.strictEqual(a, b);
	assert.notStrictEqual(a, c);
});

test("off: the late-game decisions draw the random numbers they always did", async () => {
	// (up 3 with 5 seconds left, and an intentional foul: no extra draw, the shooter by usage)
	for (const realisticPossessions of [false, true]) {
		await scenario(31, { smartEndgame: false, realisticPossessions }, (sim) => {
			setState(sim, { t: 5, pts: [97, 100], o: 0 });
			sim.shotClock = 24;
			const a = countRandom(() => sim.getClockFactor());
			assert.strictEqual(a.n, 0);
			assert.notStrictEqual(a.out, "intentionalFoul");
			const b = countRandom(() => sim.pickShooter("intentionalFoul"));
			assert.strictEqual(b.n, 1);
		});
	}
});

test("run timeouts: thresholds and where the timeout comes from", () => {
	assert.strictEqual(runTimeoutThreshold(undefined), 10);
	assert.strictEqual(runTimeoutThreshold(true), 10);
	assert.strictEqual(runTimeoutThreshold(false), 12);
	const base = {
		early: 3,
		late: 2,
		finalPeriod: false,
		overtime: false,
		t: 400,
		quickTrigger: undefined as boolean | undefined,
	};
	assert.strictEqual(runTimeoutSource(base), "early");
	// not with the period about to end, in overtime or in the closing minutes
	assert.isUndefined(runTimeoutSource({ ...base, t: 20 }));
	assert.isUndefined(runTimeoutSource({ ...base, overtime: true }));
	assert.isUndefined(runTimeoutSource({ ...base, finalPeriod: true, t: 150 }));
	// none of the extra ones left: only a quick-trigger coach, in the final period, and never his last one
	const none = { ...base, early: 0, finalPeriod: true };
	assert.isUndefined(runTimeoutSource(none));
	assert.isUndefined(runTimeoutSource({ ...none, quickTrigger: false }));
	assert.strictEqual(runTimeoutSource({ ...none, quickTrigger: true }), "late");
	assert.isUndefined(
		runTimeoutSource({ ...none, quickTrigger: true, late: 1 }),
	);
	assert.isUndefined(
		runTimeoutSource({ ...none, quickTrigger: true, finalPeriod: false }),
	);
});

test("run timeouts: a 10-0 run gets a timeout, a breather and a dead ball; 9-0 does not", async () => {
	await scenario(41, { smartEndgame: true }, (sim) => {
		assert.deepStrictEqual(sim.earlyTimeouts, [
			ENDGAME.earlyTimeouts,
			ENDGAME.earlyTimeouts,
		]);
		setState(sim, { period: 2, t: 400, pts: [30, 40], o: 0, prev: "fg" });
		for (const p of sim.playersOnCourt[0]) {
			p.stat.energy = 0.5;
		}
		sim.scoringRun = [0, 9];
		assert.notStrictEqual(sim.getPossessionOutcome(undefined), "timeout");

		setState(sim, { period: 2, t: 400, pts: [30, 40], o: 0, prev: "fg" });
		sim.scoringRun = [0, 10];
		const { out, n } = countRandom(() => sim.getPossessionOutcome(undefined));
		assert.strictEqual(out, "timeout");
		assert.strictEqual(n, 0);
		assert.deepStrictEqual(sim.earlyTimeouts, [ENDGAME.earlyTimeouts - 1, 5]);
		assert.deepStrictEqual(sim.timeouts, [2, 2]);
		assert.deepStrictEqual(sim.scoringRun, [0, 0]);
		assert.strictEqual(sim.t, 400);
		for (const p of sim.playersOnCourt[0]) {
			assert.closeTo(p.stat.energy, 0.5 + ENDGAME.timeoutRest, 1e-9);
		}
		assert.strictEqual(sim.endgameCounts.runTimeouts, 1);

		// the team on the run does not call it
		setState(sim, { period: 2, t: 400, pts: [30, 40], o: 1, prev: "fg" });
		sim.scoringRun = [0, 14];
		assert.notStrictEqual(sim.getPossessionOutcome(undefined), "timeout");
	});
});

test("run timeouts: scoring keeps the count of unanswered points", async () => {
	await scenario(42, { smartEndgame: true }, (sim) => {
		const [a, b] = [sim.playersOnCourt[0][0], sim.playersOnCourt[1][0]];
		sim.recordStat(0, a, "pts", 3);
		sim.recordStat(0, a, "pts", 2);
		assert.deepStrictEqual(sim.scoringRun, [5, 0]);
		sim.recordStat(1, b, "pts", 1);
		assert.deepStrictEqual(sim.scoringRun, [0, 1]);
	});
});

test("run timeouts: a patient coach waits for 12-0, a quick-trigger coach dips into his last two", async () => {
	await scenario(43, { smartEndgame: true }, (sim) => {
		setCoaches(sim, coach(0, false), coach(0, true));
		setState(sim, { period: 2, t: 400, pts: [30, 40], o: 0, prev: "fg" });
		sim.scoringRun = [0, 11];
		assert.notStrictEqual(sim.getPossessionOutcome(undefined), "timeout");
		setState(sim, { period: 2, t: 400, pts: [30, 42], o: 0, prev: "fg" });
		sim.scoringRun = [0, 12];
		assert.strictEqual(sim.getPossessionOutcome(undefined), "timeout");

		// final period, none of the extra ones left
		sim.earlyTimeouts = [0, 0];
		setState(sim, { period: 4, t: 400, pts: [80, 70], o: 1, prev: "fg" });
		sim.scoringRun = [10, 0];
		assert.strictEqual(sim.getPossessionOutcome(undefined), "timeout");
		assert.deepStrictEqual(sim.timeouts, [2, 1]);
		// (not his last one)
		setState(sim, { period: 4, t: 380, pts: [90, 70], o: 1, prev: "fg" });
		sim.scoringRun = [10, 0];
		assert.notStrictEqual(sim.getPossessionOutcome(undefined), "timeout");
		// the patient coach keeps his
		setState(sim, { period: 4, t: 380, pts: [70, 90], o: 0, prev: "fg" });
		sim.scoringRun = [0, 20];
		assert.notStrictEqual(sim.getPossessionOutcome(undefined), "timeout");
		assert.deepStrictEqual(sim.timeouts, [2, 1]);
	});
});

test("run timeouts happen in games, only with the setting on", async () => {
	let on = 0;
	for (const seed of range(12)) {
		on += await scenario(50 + seed, { smartEndgame: true }, (sim) => {
			sim.run();
			return sim.endgameCounts.runTimeouts;
		});
	}
	assert.isAbove(on, 0);
	assert.isBelow(on, 12 * 4);
});

test("intentional fouls: the worst free throw shooter on the floor is the target", async () => {
	const weights = foulTargetWeights(
		[1, 1, 1, 1, 1],
		[0.9, 0.85, 0.8, 0.75, 0.5],
		0,
		[],
	);
	assert.isAbove(weights[4]! / weights[0]!, 100);
	// a good game manager is pickier
	const better = foulTargetWeights(
		[1, 1, 1, 1, 1],
		[0.9, 0.85, 0.8, 0.75, 0.5],
		1,
		[],
	);
	assert.isAbove(better[4]! / better[0]!, weights[4]! / weights[0]!);

	const share = (smartEndgame: boolean) =>
		scenario(61, { smartEndgame }, (sim) => {
			setState(sim, { t: 15, pts: [100, 98], o: 0 });
			const players = sim.playersOnCourt[0];
			for (const [i, p] of players.entries()) {
				p.compositeRating.shootingFT = [0.75, 0.7, 0.65, 0.6, 0.15][i];
			}
			let worst = 0;
			const N = 2000;
			for (let i = 0; i < N; i++) {
				const { out, n } = countRandom(() =>
					sim.pickShooter("intentionalFoul"),
				);
				assert.strictEqual(n, 1);
				worst += out === players[4] ? 1 : 0;
			}
			// (any other possession: by usage, as always)
			assert.include(players, sim.pickShooter(undefined));
			return worst / N;
		});
	const off = await share(false);
	const on = await share(true);
	assert.isAbove(on, 0.6);
	assert.isBelow(off, 0.4);
});

test("up 3 with a few seconds left: the defense fouls, in both possession models; not earlier, not at the buzzer", async () => {
	assert.strictEqual(upThreeFoulProb(10, 0), 0);
	assert.strictEqual(upThreeFoulProb(1, 0), 0);
	assert.closeTo(upThreeFoulProb(5, 0), ENDGAME.up3Prob, 1e-9);
	assert.isAbove(upThreeFoulProb(5, 1), upThreeFoulProb(5, 0));
	assert.isBelow(upThreeFoulProb(5, -1), upThreeFoulProb(5, 0));

	for (const realisticPossessions of [false, true]) {
		const rate = async (mgmt: number | undefined, t: number, lead = 3) => {
			let fouls = 0;
			const N = 60;
			await scenario(
				71,
				{ smartEndgame: true, realisticPossessions },
				(sim) => {
					if (mgmt !== undefined) {
						setCoaches(sim, coach(mgmt, false), coach(mgmt, false));
					}
					for (let i = 0; i < N; i++) {
						// (each coach decides once per game)
						sim.up3Coach = [undefined, undefined];
						setState(sim, { t, pts: [100 - lead, 100], o: 0 });
						sim.shotClock = 24;
						fouls += sim.getClockFactor() === "intentionalFoul" ? 1 : 0;
					}
				},
			);
			return fouls / N;
		};
		const avg = await rate(undefined, 5);
		assert.isAbove(avg, 0.25);
		assert.isBelow(avg, 0.75);
		assert.isAbove(await rate(1, 5), 0.7);
		assert.isBelow(await rate(-1, 5), 0.35);
		assert.strictEqual(await rate(1, 12), 0);
		assert.strictEqual(await rate(1, 1), 0);
		// up 4: no reason to
		assert.strictEqual(await rate(1, 5, 4), 0);
	}

	// the coach's choice is made once and kept
	await scenario(72, { smartEndgame: true }, (sim) => {
		setState(sim, { t: 5, pts: [97, 100], o: 0 });
		sim.shotClock = 24;
		const first = sim.getClockFactor() === "intentionalFoul";
		for (let i = 0; i < 20; i++) {
			const { out, n } = countRandom(() => sim.getClockFactor());
			assert.strictEqual(out === "intentionalFoul", first);
			assert.strictEqual(n, 0);
		}
		// not in the third quarter
		setState(sim, { period: 3, t: 5, pts: [70, 73], o: 0 });
		assert.notStrictEqual(sim.getClockFactor(), "intentionalFoul");
	});
});

test("up 3 with a few seconds left: fouling wins at least as often as defending the three", async () => {
	// The end of the game from 97-100 with 5 seconds left and the trailing team's ball, with a coach who fouls and one who does not
	const winRate = async (foul: boolean) => {
		let wins = 0;
		const N = 500;
		for (const realisticPossessions of [false, true]) {
			await scenario(
				81,
				{ smartEndgame: true, realisticPossessions },
				async (sim0) => {
					let sim = sim0;
					for (let i = 0; i < N / 2; i++) {
						if (i > 0) {
							const teams = await loadTeams([0, 1], {});
							sim = new GameSim({
								gid: i,
								teams: [teams[0]!, teams[1]!],
								baseInjuryRate: 0,
								doPlayByPlay: false,
								homeCourtFactor: 1,
								allStarGame: false,
								neutralSite: true,
							});
						}
						// (possession changes at the start of simPossession: the leading team "had" the ball)
						setState(sim, { t: 5, pts: [100, 97], o: 0, prev: "ft" });
						sim.foulsThisQuarter = [5, 5];
						sim.isClockRunning = false;
						sim.up3Coach = [foul, foul];
						while (sim.t > 0) {
							sim.simPossession();
						}
						const d = sim.team[0].stat.pts - sim.team[1].stat.pts;
						wins += d > 0 ? 1 : d === 0 ? 0.5 : 0;
					}
				},
			);
		}
		return wins / N;
	};
	const foul = await winRate(true);
	const noFoul = await winRate(false);
	assert.isAbove(foul, 0.85);
	assert.isAbove(foul, noFoul - 0.02);
}, 120_000);

test("offense/defense substitutions: roles and how the values move", () => {
	assert.strictEqual(endgameRole(true, 2), "protect");
	assert.strictEqual(endgameRole(true, 0), "score");
	assert.strictEqual(endgameRole(true, -2), "score");
	assert.strictEqual(endgameRole(true, -3), "three");
	assert.strictEqual(endgameRole(false, 3), "stopThree");
	assert.strictEqual(endgameRole(false, -1), "stop");
	const r = {
		shootingFT: 0.5,
		shootingThreePointer: 0.5,
		dribbling: 0.5,
		passing: 0.5,
		usage: 0.5,
		defense: 0.5,
		defensePerimeter: 0.5,
		rebounding: 0.5,
	};
	for (const role of [
		"protect",
		"score",
		"three",
		"stop",
		"stopThree",
	] as const) {
		assert.closeTo(endgameRoleScore(role, r), 0.5, 1e-9);
	}
	assert.isAbove(
		endgameRoleScore("protect", { ...r, shootingFT: 0.9 }),
		endgameRoleScore("protect", { ...r, defense: 0.9 }),
	);
	assert.isAbove(
		endgameRoleScore("stop", { ...r, defense: 0.9 }),
		endgameRoleScore("stop", { ...r, shootingFT: 0.9 }),
	);
	// the specialist moves up, the average player stays, and a good game manager leans on it more
	const values = endgameValues([60, 50, 50], [0.5, 0.7, 0.3], 0);
	assert.closeTo(values[0]!, 60, 1e-9);
	assert.isAbove(values[1]!, 50);
	assert.isBelow(values[2]!, 50);
	assert.isAbove(
		endgameValues([60, 50, 50], [0.5, 0.7, 0.3], 1)[1]!,
		values[1]!,
	);
});

for (const realisticRotations of [true, false]) {
	test(`offense/defense substitutions in the last minute (realisticRotations ${realisticRotations})`, async () => {
		const run = (smartEndgame: boolean) =>
			scenario(91, { smartEndgame, realisticRotations }, (sim) => {
				const roster = sim.team[0].player.toSorted(
					(a: any, b: any) => b.valueNoPot - a.valueNoPot,
				);
				// The fifth and sixth men are the same player except that one is a free throw shooter and ball handler who cannot guard
				// anyone, the other a stopper who cannot shoot
				const [shooter, stopper] = [roster[4], roster[5]];
				stopper.valueNoPot = shooter.valueNoPot;
				stopper.pos = shooter.pos;
				for (const p of roster) {
					p.ptModifier = 1;
					p.stat.energy = 1;
				}
				const set = (p: any, off: number, def: number) => {
					Object.assign(p.compositeRating, {
						shootingFT: off,
						dribbling: off,
						passing: off,
						usage: off,
						shootingThreePointer: off,
						defense: def,
						defensePerimeter: def,
						rebounding: def,
					});
				};
				set(shooter, 0.9, 0.1);
				set(stopper, 0.1, 0.9);
				sim.playersOnCourt[0] = roster.slice(0, 5);
				for (const p of sim.team[0].player) {
					// (just came on, or just sat down: the stock rules would not substitute)
					p.stat.courtTime = 0.5;
					p.stat.benchTime = 0.5;
				}

				// Up 2 with 30 seconds left, about to be fouled: the free throw shooter
				setState(sim, { t: 30, pts: [100, 98], o: 0, prev: "timeout" });
				sim.nextOffense = 0;
				sim.updatePlayersOnCourt();
				const onOffense = [...sim.playersOnCourt[0]];
				// Same score, the other team's ball: the stopper
				setState(sim, { t: 25, pts: [100, 98], o: 0, prev: "timeout" });
				sim.nextOffense = 1;
				sim.updatePlayersOnCourt();
				const onDefense = [...sim.playersOnCourt[0]];
				// With 3 minutes left, nobody is substituted for this
				setState(sim, { t: 180, pts: [100, 98], o: 0, prev: "timeout" });
				sim.nextOffense = 1;
				sim.playersOnCourt[0] = roster.slice(0, 5);
				sim.updatePlayersOnCourt();
				const earlier = [...sim.playersOnCourt[0]];
				return {
					offense: [onOffense.includes(shooter), onOffense.includes(stopper)],
					defense: [onDefense.includes(shooter), onDefense.includes(stopper)],
					earlier: [earlier.includes(shooter), earlier.includes(stopper)],
					odSubs: sim.endgameCounts.odSubs,
				};
			});
		const on = await run(true);
		assert.deepStrictEqual(on.offense, [true, false]);
		assert.deepStrictEqual(on.defense, [false, true]);
		assert.deepStrictEqual(on.earlier, [true, false]);
		assert.isAtLeast(on.odSubs, 1);
		const off = await run(false);
		assert.deepStrictEqual(off.offense, [true, false]);
		assert.deepStrictEqual(off.defense, [true, false]);
		assert.strictEqual(off.odSubs, 0);
	});
}

test("the last timeout is kept for the final possession, and used when a three can tie it", async () => {
	assert.isTrue(saveLastTimeout(1, -2, 40));
	assert.isFalse(saveLastTimeout(2, -2, 40));
	assert.isFalse(saveLastTimeout(1, -5, 40));
	assert.isFalse(saveLastTimeout(1, -2, 20));

	const rate = (
		smartEndgame: boolean,
		state: { t: number; pts: [number, number]; prev: string },
		timeouts: number,
		clockRunning: boolean,
	) =>
		scenario(101, { smartEndgame }, (sim) => {
			let n = 0;
			const N = 200;
			for (let i = 0; i < N; i++) {
				setState(sim, { ...state, o: 0 });
				sim.timeouts = [timeouts, 2];
				sim.isClockRunning = clockRunning;
				n += sim.maybeTimeoutToAdvanceBall(false, true) === "timeout" ? 1 : 0;
			}
			return n / N;
		});
	// Down 2 with 45 seconds left after a rebound, one timeout left: the stock sim often burns it
	const s1 = { t: 45, pts: [98, 100] as [number, number], prev: "drb" };
	assert.isAbove(await rate(false, s1, 1, true), 0.2);
	assert.strictEqual(await rate(true, s1, 1, true), 0);
	// (with two left, or down 6, as before)
	assert.isAbove(await rate(true, s1, 2, true), 0.2);
	assert.isAbove(await rate(true, { ...s1, pts: [94, 100] }, 1, true), 0.2);
	// Down 3 with 15 seconds left after the other team scored (clock stopped): advance the ball
	const s2 = { t: 15, pts: [97, 100] as [number, number], prev: "fg" };
	assert.strictEqual(await rate(false, s2, 1, false), 0);
	assert.strictEqual(await rate(true, s2, 1, false), 1);
	// Up 2 with 15 seconds left after the other team scored: sometimes, to get the free throw shooters in
	const s3 = { t: 15, pts: [100, 98] as [number, number], prev: "fg" };
	assert.strictEqual(await rate(false, s3, 1, false), 0);
	const lead = await rate(true, s3, 1, false);
	assert.isAbove(lead, 0.3);
	assert.isBelow(lead, 0.7);
	// (not after a rebound, and not without a timeout)
	assert.strictEqual(await rate(true, { ...s3, prev: "drb" }, 1, true), 0);
	assert.strictEqual(await rate(true, s3, 0, false), 0);
});

test("the stock possession model goes 2-for-1 with the setting on", async () => {
	const metrics = async (smartEndgame: boolean) =>
		summarize(
			await simGames({
				realistic: false,
				numGames: 150,
				seed: 7,
				settings: { smartEndgame },
			}),
		);
	const off = await metrics(false);
	const on = await metrics(true);
	// (the stock model already held for the last shot: still does)
	assert.isAbove(on.lastShotUnder3, 0.8);
	assert.isAbove(on.lastShotUnder3, off.lastShotUnder3 - 0.06);
	// the possession that starts with 34-50 seconds left shoots sooner
	assert.isBelow(on.twoForOneShotTime, off.twoForOneShotTime - 0.5);
	// and the box score stays where it was
	assert.closeTo(on.pts, off.pts, 2.5);
	assert.closeTo(on.fgp, off.fgp, 0.008);
	assert.closeTo(on.min, off.min, 1);
}, 300_000);

test("on: games are still sane, with and without the other sim extras", async () => {
	for (const settings of [
		{ smartEndgame: true },
		{
			smartEndgame: true,
			realisticPossessions: true,
			realisticRotations: true,
			simFixes: true,
			positionalComposites: true,
			expandedRatings: true,
			playerTraits: true,
			technicalFouls: true,
			spacingCreation: true,
			matchupDefense: true,
		},
	]) {
		let pts = 0;
		let min = 0;
		const seeds = range(8).map((i) => 700 + i * 13);
		for (const seed of seeds) {
			const result = await scenario(seed, settings, (sim) => sim.run());
			for (const t of result.team) {
				pts += t.stat.pts;
				for (const p of t.player) {
					min += p.stat.min;
				}
			}
		}
		const n = seeds.length * 2;
		assert.isAbove(pts / n, 80);
		assert.isBelow(pts / n, 135);
		assert.isAbove(min / n, 239);
	}
});

test("college rules (two 20-minute halves, one-and-one, 30-second shot clock): both settings play sensible games", async () => {
	const college = {
		numPeriods: 2,
		quarterLength: 20,
		overtimeLength: 5,
		foulsNeededToFoulOut: 5,
		foulsUntilBonus: [10, 1, 10],
		oneAndOne: true,
		oneAndOneFouls: 7,
		customShotClock: true,
		shotClockLength: 30,
		realisticPossessions: true,
		realisticRotations: true,
		smartEndgame: true,
		scheduleLoad: true,
	};
	let pts = 0;
	let min = 0;
	let runTimeouts = 0;
	const seeds = range(6).map((i) => 1300 + i);
	for (const seed of seeds) {
		const result = await scenario(seed, college, (sim) => {
			const out = sim.run();
			runTimeouts += sim.endgameCounts.runTimeouts;
			return out;
		});
		for (const t of result.team) {
			pts += t.stat.pts;
			for (const p of t.player) {
				min += p.stat.min;
			}
		}
	}
	const n = seeds.length * 2;
	assert.isAbove(pts / n, 50);
	assert.isBelow(pts / n, 125);
	assert.isAbove(min / n, 199);
	// (with overtimes)
	assert.isBelow(min / n, 230);
	assert.isAbove(runTimeouts, 0);

	// the final half is the final period: up 3 with a few seconds left, the defense fouls (not in the first half)
	await scenario(1310, college, (sim) => {
		// (a coach who fouls up 3)
		sim.up3Coach = [true, true];
		setState(sim, { period: 2, t: 5, pts: [57, 60], o: 0 });
		sim.shotClock = 30;
		assert.strictEqual(sim.getClockFactor(), "intentionalFoul");
		setState(sim, { period: 1, t: 5, pts: [27, 30], o: 0 });
		assert.notStrictEqual(sim.getClockFactor(), "intentionalFoul");
	});
});
