import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g, local } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { planMinutes, USER_STARTER_FLOOR } from "./rotationPlanner.ts";
import { range } from "../../../common/utils.ts";

/*
 * Realistic Rotations on the user's own team: the plan ranks by value x playing time, the starters he picked get a minutes floor and
 * the playing time buttons move real minutes (rotationPlanner.ts, userControlled). AI teams are planned as before.
 */

afterAll(() => {
	resetG();
});

const values = [68, 62, 58, 55, 52, 50, 48, 46, 44, 42, 40, 38, 36];
const roster = (starters = [0, 1, 2, 3, 4]) =>
	values.map((valueNoPot, i) => ({
		valueNoPot,
		injured: false,
		ptModifier: 1,
		userStarter: starters.includes(i),
	}));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const opts = {
	playoffs: false,
	backToBack: false,
	numPlayersOnCourt: 5,
	allStarGame: false,
};
const user = { ...opts, userControlled: true };

test("planned minutes: by default the user's team is planned like an AI team", () => {
	const ai = planMinutes(roster(), opts);
	const mine = planMinutes(roster(), user);
	for (const [i, m] of ai.entries()) {
		assert.closeTo(mine[i]!, m, 0.01);
	}
});

test("planned minutes: a starter the user picks gets the floor, the total stays 240", () => {
	const ai = planMinutes(roster(), opts);
	// The 10th best player starts in place of the 5th best
	const plan = planMinutes(roster([0, 1, 2, 3, 9]), user);
	assert.isAtLeast(plan[9]!, USER_STARTER_FLOOR - 0.01);
	// (he was planned for ~2.4)
	assert.isBelow(ai[9]!, 5);
	assert.closeTo(sum(plan), 240, 0.1);
	assert.isAtMost(Math.max(...plan), 42 + 1e-9);
	// Two end-of-bench starters: both floored, the rest give the minutes
	const two = planMinutes(roster([0, 1, 2, 11, 12]), user);
	assert.isAtLeast(two[11]!, USER_STARTER_FLOOR - 0.01);
	assert.isAtLeast(two[12]!, USER_STARTER_FLOOR - 0.01);
	assert.closeTo(sum(two), 240, 0.1);

	// No floor when he's injured or on a minutes restriction
	const injured = roster([0, 1, 2, 3, 9]);
	injured[9]!.injured = true;
	assert.strictEqual(planMinutes(injured, user)[9], 0);
	const restricted = roster([0, 1, 2, 3, 9]);
	restricted[9]!.ptModifier = 0.55;
	(restricted[9] as any).injuryRestriction = 0.55;
	assert.isBelow(planMinutes(restricted, user)[9]!, 10);
});

test('planned minutes: "+" and "++" move a bench player into the rotation, "-" cuts a starter', () => {
	const base = planMinutes(roster(), user);
	const withPt = (i: number, pt: number) => {
		const players = roster();
		players[i]!.ptModifier = pt;
		const plan = planMinutes(players, user);
		assert.closeTo(sum(plan), 240, 0.1);
		assert.isAtMost(Math.max(...plan), 42 + 1e-9);
		return plan[i]!;
	};
	// 10th man: ~2.4 -> "+" ~10, "++" ~20 (before: 2.4 -> 3.6)
	assert.isAbove(withPt(9, 1.25), base[9]! + 5);
	assert.isAbove(withPt(9, 1.75), 15);
	// 7th man "++": a starter's minutes
	assert.isAbove(withPt(6, 1.75), 30);
	// "-": the star loses about a quarter of his minutes (before: ~32 of ~40 with the rescale giving some back)
	assert.isBelow(withPt(0, 0.75), base[0]! - 7);
	assert.isBelow(withPt(2, 0.75), base[2]! - 6);
	// "0": out of the plan
	assert.strictEqual(withPt(0, 0), 0);
	// "+" on a starter: more, up to the cap
	assert.isAbove(withPt(4, 1.25), base[4]! + 3);
	// The floor for a "-" starter is a quarter lower
	const cut = roster([0, 1, 2, 3, 9]);
	cut[9]!.ptModifier = 0.75;
	assert.closeTo(planMinutes(cut, user)[9]!, USER_STARTER_FLOOR * 0.75, 0.5);
});

test("planned minutes: AI teams ignore userStarter", () => {
	const plan = planMinutes(roster([0, 1, 2, 3, 9]), opts);
	assert.isBelow(plan[9]!, 5);
});

// Whole games: the user's team 0 starts its 10th best player in place of its 5th best, AI team 1 as usual
const simMinutes = (seed: number, opts2: { autoPlay?: boolean }) =>
	withSeededRandom(seed, async () => {
		await genTeams();
		g.setWithoutSavingToDB("storePlayByPlay", false);
		g.setWithoutSavingToDB("realisticRotations", true);
		g.setWithoutSavingToDB("simFixes", true);
		g.setWithoutSavingToDB("userTids", [0]);
		local.autoPlayUntil = opts2.autoPlay
			? {
					season: 2013,
					phase: 0,
					start: 0,
					resolve: () => {},
					reject: () => {},
				}
			: undefined;
		const teams = await loadTeams([0, 1], {});
		local.autoPlayUntil = undefined;
		const players = teams[0]!.player;
		// (genTeams sorts the roster by value)
		const fifth = players[4]!;
		const tenth = players[9]!;
		players[4] = tenth;
		players[9] = fifth;
		const sim: any = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: 0,
			doPlayByPlay: false,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: true,
		});
		const planned = sim.minutesTargets.get(tenth);
		sim.run();
		return { planned, min: tenth.stat.min, gs: tenth.stat.gs };
	});

test("whole games: the user's chosen starter plays starter minutes, not ~2 as before", async () => {
	const seeds = range(6).map((i) => 300 + i);
	let min = 0;
	let minAuto = 0;
	for (const seed of seeds) {
		const r = await simMinutes(seed, {});
		assert.isAtLeast(r.planned, USER_STARTER_FLOOR - 0.01);
		assert.strictEqual(r.gs, 1);
		min += r.min / seeds.length;
		// Auto play: the AI runs the team, the plan is by value only
		const auto = await simMinutes(seed, { autoPlay: true });
		assert.isBelow(auto.planned, 10);
		minAuto += auto.min / seeds.length;
	}
	assert.isAbove(min, 18, `user starter ${min}`);
	assert.isBelow(minAuto, 12, `auto play ${minAuto}`);
});
