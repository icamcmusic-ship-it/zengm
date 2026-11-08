import { assert, beforeAll, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { simGames, summarize, type Metrics } from "./possessionMetrics.ts";
import {
	genTeams,
	makeLiveBoxScore,
	playLive,
	withSeededRandom,
} from "./simLiveGameForTests.ts";
import { paceScales, teamPaceFactor } from "./possessionModel.ts";
import {
	decodePlayByPlay,
	encodePlayByPlay,
	storedInitEvent,
} from "../../../common/pbpFlavor/store.ts";

// The realistic possession model (realisticPossessions setting). Targets are modern NBA values (see possessionModel.ts); box score
// averages must stay where the old model had them, since BBGM's sim is tuned to real stats

const NUM_GAMES = 240;
let oldModel: Metrics;
let newModel: Metrics;

beforeAll(async () => {
	oldModel = summarize(
		await simGames({ realistic: false, numGames: NUM_GAMES, seed: 3 }),
	);
	newModel = summarize(
		await simGames({ realistic: true, numGames: NUM_GAMES, seed: 3 }),
	);
}, 300_000);

const close = (name: keyof Metrics, tolerance: number) => {
	const a = oldModel[name] as number;
	const b = newModel[name] as number;
	assert.isTrue(
		Math.abs(a - b) <= tolerance,
		`${name}: old ${a.toFixed(4)}, new ${b.toFixed(4)}`,
	);
};
const between = (name: keyof Metrics, lo: number, hi: number) => {
	const x = newModel[name] as number;
	assert.isTrue(x >= lo && x <= hi, `${name}: ${x} not in [${lo}, ${hi}]`);
};

test("box score averages stay calibrated", () => {
	close("pts", 3);
	close("fgp", 0.007);
	close("tpaRate", 0.012);
	close("tovPct", 0.006);
	close("orbPct", 0.012);
	close("ftr", 0.02);
	close("pace", 2);
	close("min", 1.5);
});

test("pace and possession lengths look like the NBA", () => {
	between("pace", 97, 102);
	between("possLength", 13.8, 15.2);
	// transition (quick shot after a steal or a defensive rebound) and half-court (after a make or a dead ball, inbound included)
	between("transLength", 4, 8);
	between("transShare", 0.08, 0.2);
	between("halfCourtLength", 15, 18.5);
});

test("shots go up through the whole shot clock, with a late-clock tail", () => {
	between("scMedian", 8.5, 12);
	between("sc22_18", 0.08, 0.2);
	between("sc18_15", 0.08, 0.2);
	between("sc15_7", 0.35, 0.55);
	between("sc7_4", 0.1, 0.22);
	between("sc4_0", 0.05, 0.14);
	// the old model had almost no late-clock shots
	assert.isBelow(oldModel.sc4_0, newModel.sc4_0);
});

test("offensive rebounds: quick putbacks, and a 14-second clock", () => {
	between("orbQuick", 0.3, 0.55);
	between("orbToShot", 2.5, 6.5);
	close("secondChancePts", 1.5);
});

test("shot-clock violations come from the model, at about the NBA rate", () => {
	between("violationsPerTeamGame", 0.35, 1.2);
	assert.strictEqual(oldModel.violationsPerTeamGame, 0);
});

test("end of periods: last shots and 2-for-1s", () => {
	between("lastShotUnder3", 0.8, 1);
	between("twoForOneShotTime", 5, 12);
	assert.isBelow(newModel.twoForOneShotTime, oldModel.twoForOneShotTime);
	between("intentionalFoulsPerGame", 0.3, 2.5);
	between("otRate", 0.01, 0.12);
});

test("the shot clock is never exceeded", async () => {
	const games = await simGames({ realistic: true, numGames: 40, seed: 11 });
	for (const game of games) {
		for (const shot of game.shots) {
			if (!shot.scOff) {
				assert.isAtLeast(shot.scLeft, 0, JSON.stringify(shot));
				assert.isAtMost(shot.scLeft, 24);
			}
			// after an offensive rebound, the shot clock was reset to 14
			if (shot.afterOrb && !shot.scOff) {
				assert.isAtMost(shot.scLeft, 14);
			}
		}
	}
}, 60_000);

test("the pace setting still scales the game around the new baseline", async () => {
	const fast = summarize(
		await simGames({ realistic: true, numGames: 60, seed: 5, pace: 115 }),
	);
	const slow = summarize(
		await simGames({ realistic: true, numGames: 60, seed: 5, pace: 85 }),
	);
	assert.isAbove(fast.pace, newModel.pace * 1.08, `fast ${fast.pace}`);
	assert.isBelow(slow.pace, newModel.pace * 0.92, `slow ${slow.pace}`);
	// a slow league does not just mean many more shot-clock violations
	assert.isBelow(slow.violationsPerTeamGame, 2.5);
}, 120_000);

test("pace helpers", () => {
	assert.strictEqual(teamPaceFactor(108), 1);
	assert.isAbove(teamPaceFactor(109), 1);
	assert.isBelow(teamPaceFactor(107), 1);
	assert.isAtMost(teamPaceFactor(200), 1.07);
	assert.deepEqual(paceScales(1), { possTimeScale: 1, gameClockFactor: 1 });
	const slow = paceScales(0.5);
	assert.closeTo(slow.possTimeScale * slow.gameClockFactor, 2, 1e-9);
});

test("play-by-play: violations are logged as such, and read as shot-clock violations", async () => {
	let violations = 0;
	let violationLines = 0;
	for (const seed of [21, 22, 23, 24, 25, 26]) {
		await withSeededRandom(seed, async () => {
			await genTeams();
			g.setWithoutSavingToDB("realisticPossessions", true);
			const teams = await loadTeams([0, 1], {});
			const sim = new GameSim({
				gid: seed,
				teams: [teams[0]!, teams[1]!],
				baseInjuryRate: g.get("injuryRate"),
				doPlayByPlay: true,
				homeCourtFactor: 1,
				allStarGame: false,
				neutralSite: false,
			});
			const result = sim.run();
			const events = result.playByPlay!.slice() as any[];
			violations += events.filter(
				(e) => e.type === "tov" && e.shotClock === true,
			).length;
			// every shot attempt's "poss" is the shot clock used, so never more than 24
			for (const e of events) {
				if (typeof e.poss === "number") {
					assert.isAtMost(e.poss, 24, JSON.stringify(e));
				}
			}
			const lines = playLive(events.slice(), makeLiveBoxScore(result, seed));
			violationLines += lines.filter((l) =>
				/shot-clock violation|shot clock expires|shot clock runs out|out the shot clock/i.test(
					l.text,
				),
			).length;

			// stored with the box score (game.pbp), the game reads exactly as it did live
			const { players, events: decoded } = decodePlayByPlay(
				encodePlayByPlay(events),
			);
			const box = makeLiveBoxScore(result, seed);
			const replay = playLive(
				[storedInitEvent(players, box.teams), ...decoded],
				box,
			);
			assert.deepStrictEqual(replay, lines, `seed ${seed}`);
		});
	}
	assert.isAbove(violations, 0);
	assert.isAtLeast(violationLines, violations);
}, 60_000);

// The model lives entirely in GameSim: the play-by-play logger (live feed, stored game.pbp, flavor text) only reads what the sim does. So the
// same seeded game is identical with logging off (doPlayByPlay false, storePlayByPlay off: no events at all) and with every kind of logging on,
// with the realistic possession model on or off
test("box scores are byte-identical with play-by-play logging on or off, with the model on and off", async () => {
	const hashOf = (box: unknown) => JSON.stringify(box);
	for (const realistic of [false, true]) {
		for (const tech of [false, true]) {
			for (const seed of [31, 32, 33, 34]) {
				const run = (doPlayByPlay: boolean, storePlayByPlay: boolean) =>
					withSeededRandom(seed, async () => {
						await genTeams();
						g.setWithoutSavingToDB("realisticPossessions", realistic);
						g.setWithoutSavingToDB("technicalFouls", tech);
						g.setWithoutSavingToDB("storePlayByPlay", storePlayByPlay);
						const teams = await loadTeams([0, 1], {});
						const sim = new GameSim({
							gid: seed,
							teams: [teams[0]!, teams[1]!],
							baseInjuryRate: g.get("injuryRate"),
							doPlayByPlay,
							homeCourtFactor: 1,
							allStarGame: false,
							neutralSite: false,
						});
						const result = sim.run();
						return {
							events: result.playByPlay?.length ?? 0,
							box: hashOf({
								overtimes: result.overtimes,
								teams: result.team.map((t) => ({
									stat: t.stat,
									players: t.player.map((p) => ({ id: p.id, stat: p.stat })),
								})),
								violations: sim.shotClockViolations,
							}),
						};
					});
				const off = await run(false, false);
				const live = await run(true, false);
				const stored = await run(false, true);
				const both = await run(true, true);
				const label = `realistic ${realistic}, tech ${tech}, seed ${seed}`;
				assert.strictEqual(off.events, 0, label);
				assert.isAbove(live.events, 100, label);
				assert.strictEqual(live.box, off.box, label);
				assert.strictEqual(stored.box, off.box, label);
				assert.strictEqual(both.box, off.box, label);
			}
		}
	}
}, 120_000);

test("the distributions measured with logging fully off are the NBA-like ones", () => {
	// possessionMetrics runs with storePlayByPlay off and doPlayByPlay false, so these come from the sim alone
	between("pace", 97, 102);
	between("violationsPerTeamGame", 0.35, 1.2);
	between("possLength", 13.8, 15.2);
});
