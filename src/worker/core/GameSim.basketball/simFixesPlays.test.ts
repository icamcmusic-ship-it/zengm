import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { SIM_FIX_BLOCK, SIM_FIX_KNOCK } from "./simSettings.ts";
import { range } from "../../../common/utils.ts";

/*
 * Game Sim Fixes plays: blocks out of bounds, knocks (minor in-game injuries). The league totals are in docs/native-features.md (threeGradient.script.test.ts).
 */

afterAll(() => {
	resetG();
});

type Sim = any;

const scenario = <T>(
	seed: number,
	settings: Record<string, unknown>,
	fn: (sim: Sim) => T | Promise<T>,
	{
		baseInjuryRate = 0,
		doPlayByPlay = false,
	}: { baseInjuryRate?: number; doPlayByPlay?: boolean } = {},
) =>
	withSeededRandom(seed, async () => {
		await genTeams();
		g.setWithoutSavingToDB("storePlayByPlay", doPlayByPlay);
		for (const [key, value] of Object.entries(settings)) {
			g.setWithoutSavingToDB(key as any, value as any);
		}
		const teams = await loadTeams([0, 1], {});
		const sim: Sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate,
			doPlayByPlay,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: true,
		});
		return fn(sim);
	});

test("blocks out of bounds: the offense keeps the ball with the shot clock it had", async () => {
	await scenario(1, { simFixes: true, realisticPossessions: true }, (sim) => {
		const counts: Record<string, number> = {};
		const n = 4000;
		for (const i of range(n)) {
			sim.t = 300;
			sim.o = i % 2;
			sim.d = sim.o === 0 ? 1 : 0;
			sim.shotClock = 3;
			sim.afterShotAttempt = false;
			const outcome = sim.blockedBallOutcome();
			counts[outcome] = (counts[outcome] ?? 0) + 1;
			// (the block out of bounds, not an ordinary loose ball after the rebound, which resets the clock to 14)
			if (outcome === "outOfBoundsDefense" && !sim.afterShotAttempt) {
				counts.blkOob = (counts.blkOob ?? 0) + 1;
				// (no new shot clock: the offense has what was left, at least a second)
				sim.prevPossessionOutcome = outcome;
				sim.resetShotClock();
				assert.isAtMost(sim.shotClock, 3);
				assert.isAtLeast(sim.shotClock, 1);
			}
		}
		const oob = (counts.blkOob ?? 0) / n;
		assert.isAbove(oob, SIM_FIX_BLOCK.oob - 0.03);
		assert.isBelow(oob, SIM_FIX_BLOCK.oob + 0.03);
		// the rest is mostly the defense's
		const orb = (counts.orb ?? 0) / n;
		const drb = (counts.drb ?? 0) / n;
		assert.isBelow(orb, 0.2);
		assert.isAbove(drb, 0.55);
	});
});

test("blocks out of bounds: off without Game Sim Fixes (the stock rebound, same random numbers)", async () => {
	await scenario(2, { simFixes: false }, (sim) => {
		assert.isFalse(sim.simFixes);
	});
});

test("knocks: players shaken up leave, most come back later in the game, none of it is an injury after the game", async () => {
	let knocks = 0;
	let returns = 0;
	let ruledOut = 0;
	let injuries = 0;
	let returnedAndPlayed = 0;
	for (const seed of range(8)) {
		await scenario(
			100 + seed,
			{ simFixes: true },
			(sim) => {
				const result = sim.run();
				const events = result.playByPlay as any[];
				const subsOn = new Map<number, number[]>();
				events.forEach((e, i) => {
					if (e.type === "sub") {
						for (const pid of e.pids) {
							subsOn.set(pid, [...(subsOn.get(pid) ?? []), i]);
						}
					}
				});
				events.forEach((e, i) => {
					if (e.type === "knock") {
						knocks += 1;
					} else if (e.type === "knockReturn") {
						if (e.back) {
							returns += 1;
							if ((subsOn.get(e.pid) ?? []).some((j) => j > i)) {
								returnedAndPlayed += 1;
							}
						} else {
							ruledOut += 1;
						}
					} else if (e.type === "injury") {
						injuries += 1;
					}
				});
				for (const t of sim.team) {
					for (const p of t.player) {
						// (a real injury stands: no knock evaluation clears it)
						if (p.newInjury) {
							assert.isTrue(p.injured);
						}
						// (a knock is never an injury after the game, and a player cleared to return is healthy)
						if (p.knock && !p.newInjury) {
							const ev = events.findLast(
								(e) => e.type === "knockReturn" && e.pid === p.id,
							);
							if (ev) {
								assert.strictEqual(p.injured, !ev.back);
							}
						}
					}
				}
			},
			// (a high injury rate, to see some)
			{ baseInjuryRate: 0.002, doPlayByPlay: true },
		);
	}
	assert.isAbove(knocks, 10);
	// (about SIM_FIX_KNOCK.rate knocks per injury)
	assert.isAbove(knocks / Math.max(1, injuries), SIM_FIX_KNOCK.rate / 2);
	assert.isBelow(knocks / Math.max(1, injuries), SIM_FIX_KNOCK.rate * 2);
	// (a late knock may not be evaluated before the game ends)
	assert.isAtMost(returns + ruledOut, knocks);
	assert.isAbove(returns, ruledOut);
	assert.isAbove(returnedAndPlayed, 0);
});

test("knocks: none without Game Sim Fixes", async () => {
	await scenario(
		200,
		{ simFixes: false },
		(sim) => {
			const result = sim.run();
			const events = result.playByPlay as any[];
			assert.isFalse(events.some((e) => e.type === "knock"));
			assert.isTrue(events.some((e) => e.type === "injury"));
		},
		{ baseInjuryRate: 0.005, doPlayByPlay: true },
	);
});

test("knocks: never to a player already injured, and an evaluation doesn't clear a real injury", async () => {
	await scenario(
		7,
		{ simFixes: true },
		(sim) => {
			// Injured this game but not subbed out yet: the injury checks keep running on him
			const hurt = sim.playersOnCourt[0][0];
			hurt.injured = true;
			hurt.newInjury = true;
			for (let i = 0; i < 2000; i++) {
				sim.injuries();
				hurt.injured = true;
			}
			assert.isUndefined(hurt.knock);

			// Knocked, then really injured before he got to the bench: cleared to return leaves the injury
			const other = sim.playersOnCourt[1][0];
			other.injured = true;
			other.newInjury = true;
			other.knock = { evalAt: -1 };
			sim.knocked = [other];
			const random = Math.random;
			Math.random = () => 0;
			try {
				sim.evaluateKnocks();
			} finally {
				Math.random = random;
			}
			assert.isTrue(other.injured);
		},
		{ baseInjuryRate: 0.01 },
	);
});
