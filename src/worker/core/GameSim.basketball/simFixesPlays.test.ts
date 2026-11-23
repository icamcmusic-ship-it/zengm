import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { SIM_FIX_BLOCK } from "./simSettings.ts";
import { range } from "../../../common/utils.ts";

/*
 * Game Sim Fixes plays: blocks out of bounds. The league totals are in docs/native-features.md (threeGradient.script.test.ts).
 */

afterAll(() => {
	resetG();
});

type Sim = any;

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
