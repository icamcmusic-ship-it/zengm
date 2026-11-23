import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import {
	CONTEST_CONTESTED,
	CONTEST_HEAVY,
	CONTEST_OPEN,
	contestLevel,
	contestTables,
} from "./gameFlow.ts";
import {
	SIM_FIX_ADJUST,
	SIM_FIX_CONTEST,
	SIM_FIX_GARBAGE,
} from "./simSettings.ts";
import { NEUTRAL_COACH_SIM } from "../../../common/coachSystems.ts";
import { range } from "../../../common/utils.ts";

/*
 * Game flow (Game Sim Fixes, gameFlow.ts): contest levels, help defense, runs and timeouts, coaching adjustments, fatigue and garbage
 * time. With Game Sim Fixes off none of it runs (outcomeInvariance.test.ts); here the pieces with the clock and the score set by hand,
 * and whole games with the new-league sim. League totals: threeGradient.script.test.ts (docs/native-features.md, Game flow).
 */

afterAll(() => {
	resetG();
});

const ALL_FEATURES: Record<string, boolean> = {
	realisticPossessions: true,
	playerTraits: true,
	expandedRatings: true,
	simFixes: true,
	positionalComposites: true,
	realisticRotations: true,
	coachSystems: true,
	spacingCreation: true,
	matchupDefense: true,
	smartEndgame: true,
	scheduleLoad: true,
	realisticPlayTypes: true,
	advStats: true,
	shotZones: true,
};

type Sim = any;

const newSim = (seed: number, settings: Record<string, unknown> = {}) =>
	withSeededRandom(seed, async () => {
		await genTeams();
		g.setWithoutSavingToDB("storePlayByPlay", false);
		for (const [key, value] of Object.entries({
			...ALL_FEATURES,
			...settings,
		})) {
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
		return sim;
	});

const setScore = (sim: Sim, period: number, t: number, pts: number[]) => {
	sim.t = t;
	for (const i of [0, 1]) {
		sim.team[i].stat.pts = pts[i];
		sim.team[i].stat.ptsQtrs = range(period).map(() => pts[i]! / period);
	}
};

test("contest levels: the make changes, block and foul multipliers are centered on the base shares", () => {
	for (const [ti, tb] of contestTables().entries()) {
		const [open, heavy] = SIM_FIX_CONTEST.base[ti]!;
		const shares = [open!, 1 - open! - heavy!, heavy!];
		let make = 0;
		let blk = 0;
		let foul = 0;
		for (let l = 0; l < 3; l++) {
			make += shares[l]! * tb.make[l]!;
			blk += shares[l]! * tb.blk[l]!;
			foul += shares[l]! * tb.foul[l]!;
		}
		assert.closeTo(make, SIM_FIX_CONTEST.makeOffset, 1e-12);
		assert.closeTo(blk, 1, 1e-12);
		assert.closeTo(foul, SIM_FIX_CONTEST.foulScale, 1e-12);
		// Open shots go in more often than contested ones, contested more than heavily contested
		assert.isAbove(tb.make[CONTEST_OPEN]!, tb.make[CONTEST_CONTESTED]!);
		assert.isAbove(tb.make[CONTEST_CONTESTED]!, tb.make[CONTEST_HEAVY]!);
	}
});

test("contest levels: a tighter score means fewer open and more heavily contested shots", () => {
	const shares = (z: number) => {
		const n = [0, 0, 0];
		for (let i = 0; i < 1000; i++) {
			n[contestLevel(0, z, (i + 0.5) / 1000)]! += 1;
		}
		return n;
	};
	const loose = shares(-1);
	const base = shares(0);
	const tight = shares(1);
	assert.isAbove(loose[CONTEST_OPEN]!, base[CONTEST_OPEN]!);
	assert.isAbove(base[CONTEST_OPEN]!, tight[CONTEST_OPEN]!);
	assert.isBelow(loose[CONTEST_HEAVY]!, base[CONTEST_HEAVY]!);
	assert.isBelow(base[CONTEST_HEAVY]!, tight[CONTEST_HEAVY]!);
	// z = 0 gives the base shares
	assert.closeTo(
		base[CONTEST_OPEN]! / 1000,
		SIM_FIX_CONTEST.base[0]![0]!,
		0.002,
	);
	// Never all open or all heavily contested
	const extreme = shares(20);
	assert.isAbove(extreme[CONTEST_CONTESTED]!, 0);
});

test("runs: the run is the most one team outscored the other while it scored at most 2", async () => {
	const sim = await newSim(1);
	sim.clearRuns();
	// 2-0, 3-0, 0-2, 2-0, 3-0 by team 0 and team 1 (in order): team 0's run is 10-2
	const log: [number, number][] = [
		[0, 2],
		[0, 3],
		[1, 2],
		[0, 2],
		[0, 3],
	];
	for (const [t, pts] of log) {
		sim.runLogTeam.push(t);
		sim.runLogPts.push(pts);
	}
	assert.strictEqual(sim.runNet(0), 8);
	assert.strictEqual(sim.runNet(1), 0);
	// Another basket by team 1 ends the 10-2 run (it scored 4)
	sim.runLogTeam.push(1);
	sim.runLogPts.push(2);
	// (team 0 is up 5-2 since team 1 last scored 3 or more)
	assert.strictEqual(sim.runNet(0), 3);
	assert.strictEqual(sim.runNet(1), 2);
});

test("runs: a quick-trigger, well-managed coach calls the timeout sooner than a patient one", async () => {
	const sim = await newSim(2);
	sim.coachSys = true;
	sim.cs = [
		{
			...NEUTRAL_COACH_SIM,
			off: "motion",
			def: "switch",
			timeoutDial: 1,
			mgmt: 80,
		},
		{
			...NEUTRAL_COACH_SIM,
			off: "motion",
			def: "switch",
			timeoutDial: -1,
			mgmt: 20,
		},
	];
	assert.isBelow(sim.runTimeoutNet(0), sim.runTimeoutNet(1));
});

test("garbage time: on with a big lead late, off only when the lead shrinks well below the line", async () => {
	const sim = await newSim(3);
	const G = SIM_FIX_GARBAGE;
	// Final period, 5 minutes left: the line is base + 5 perMin
	const line = G.base + 5 * G.perMin;
	setScore(sim, 4, 300, [100, 100 - Math.ceil(line)]);
	assert.isTrue(sim.updateGarbage());
	// The lead shrinks a little: still garbage time (no stat padding)
	setScore(sim, 4, 290, [100, 100 - Math.ceil(line - G.exit + 1)]);
	assert.isTrue(sim.updateGarbage());
	// ...and a lot: the starters come back
	setScore(sim, 4, 280, [100, 100 - Math.floor(line - G.exit - 1)]);
	assert.isFalse(sim.updateGarbage());
	// Early in the game, no lead is garbage time
	setScore(sim, 2, 300, [80, 30]);
	assert.isFalse(sim.updateGarbage());
	// The starters sit, the deep bench plays
	const byRank = [...sim.valueRanks.entries()]
		.filter(([p]: any) => sim.team[0].player.includes(p))
		.sort((a: any, b: any) => a[1] - b[1]);
	assert.isBelow(
		sim.garbageFactor(byRank[0][0]),
		sim.garbageFactor(byRank[9][0]),
	);
});

test("value ranks: injured and rested players don't count, so the healthy starters sit in garbage time", async () => {
	const sim = await newSim(3);
	const players = sim.team[0].player.toSorted(
		(a: any, b: any) => b.valueNoPot - a.valueNoPot,
	);
	players[0].injured = true;
	players[1].injured = true;
	sim.planRotations();
	const healthy = players.slice(2);
	for (const [i, p] of healthy.entries()) {
		assert.strictEqual(sim.valueRanks.get(p), i);
	}
	assert.isAtLeast(sim.valueRanks.get(players[0]), healthy.length);
	// The 4th and 5th best healthy players sit with the other starters (before: rotation players, they stayed in blowouts)
	assert.strictEqual(
		sim.garbageFactor(healthy[4]),
		sim.garbageFactor(healthy[0]),
	);
});

test("No Visible Ratings: the minutes plan ranks by planValue (the fuzzed value the user sees) when it's set", async () => {
	const sim = await newSim(3);
	const players = sim.team[0].player.toSorted(
		(a: any, b: any) => b.valueNoPot - a.valueNoPot,
	);
	// The user sees the 10th best player as the best one
	for (const [i, p] of players.entries()) {
		p.planValue = i === 9 ? 1000 : p.valueNoPot;
	}
	sim.planRotations();
	assert.strictEqual(sim.valueRanks.get(players[9]), 0);
	assert.isAbove(
		sim.minutesTargets.get(players[9]),
		sim.minutesTargets.get(players[0]),
	);
});

test("coaching adjustments: the hot hand gets more minutes from a good coach, the rotation gives them", async () => {
	const minutesGain = async (mgmt: number, adapt: number) => {
		const sim = await newSim(4);
		sim.cs = [
			{ ...NEUTRAL_COACH_SIM, off: "motion", def: "switch", mgmt, adapt },
			{ ...NEUTRAL_COACH_SIM, off: "motion", def: "switch", mgmt, adapt },
		];
		setScore(sim, 3, 720, [60, 60]);
		const hot = sim.team[0].player.find(
			(p: any) => (sim.minutesTargets.get(p) ?? 0) > 20,
		);
		hot.stat.pts = 22;
		hot.stat.fga = 12;
		hot.stat.fta = 4;
		const before = sim.minutesTargets.get(hot);
		let sumBefore = 0;
		for (const p of sim.team[0].player) {
			sumBefore += sim.minutesTargets.get(p) ?? 0;
		}
		sim.coachAdjust(1);
		let sumAfter = 0;
		for (const p of sim.team[0].player) {
			sumAfter += sim.minutesTargets.get(p) ?? 0;
		}
		assert.closeTo(sumAfter, sumBefore, 1e-9);
		return sim.minutesTargets.get(hot) - before;
	};
	const good = await minutesGain(90, 90);
	const poor = await minutesGain(20, 20);
	assert.isAbove(good, 0);
	assert.isAtMost(good, SIM_FIX_ADJUST.hotMin);
	assert.isAbove(good, poor);
});

test("whole games: timeouts are a team stat, contest levels are recorded, and Game Sim Fixes off adds nothing", async () => {
	for (const seed of [5, 6]) {
		const sim = await newSim(seed);
		const result = sim.run();
		for (const t of result.team) {
			assert.isAtLeast(t.stat.tmo, 0);
			assert.isAtMost(t.stat.tmo, 9);
		}
	}
	const off = await newSim(7, { simFixes: false });
	const result = off.run();
	assert.isUndefined(result.team[0].stat.tmo);
	assert.isFalse(off.contestOn);
});
