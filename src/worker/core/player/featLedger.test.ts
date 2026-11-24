// Feat Rarity & Streaks: rarity labels, team feats, streaks and the feat score
import { assert, beforeEach, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import {
	comebackDeficit,
	emptyLedger,
	eraMultipliers,
	featScore,
	ledgerKinds,
	rarityLabel,
	recordKinds,
	teamFeatKinds,
	updateStreaks,
	type GameLine,
} from "../../../common/featLedger.ts";
import type { Player } from "../../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import checkStatisticalFeat from "./checkStatisticalFeat.ts";
import { endRunningStreaks, getLedger, ledgerForView } from "./featLedger.ts";

const line = (x: Partial<GameLine>): GameLine => ({
	pts: 0,
	orb: 0,
	drb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tp: 0,
	...x,
});

describe("feat ledger (pure)", () => {
	test("kinds, most notable first, with scaled cutoffs", () => {
		assert.deepEqual(ledgerKinds(line({ pts: 62, drb: 10, ast: 11 }), 1), [
			"pts60",
			"td",
		]);
		assert.deepEqual(
			ledgerKinds(line({ pts: 12, drb: 10, ast: 10, stl: 10, blk: 10 }), 1),
			["quint", "fxf", "stl10", "blk10"],
		);
		// Longer games: higher cutoffs
		assert.deepEqual(ledgerKinds(line({ pts: 52 }), 1.1), []);
	});

	test("rarity labels", () => {
		assert.strictEqual(
			rarityLabel("60-point game", undefined, 2030, 2025),
			"first 60-point game in league history",
		);
		assert.strictEqual(
			rarityLabel("60-point game", { n: 4, last: 2026 }, 2030, 2025),
			"first 60-point game since 2026",
		);
		assert.strictEqual(
			rarityLabel("quintuple-double", { n: 2, last: 2029 }, 2030, 2025),
			"3rd quintuple-double ever",
		);
		assert.isUndefined(
			rarityLabel("triple-double", { n: 400, last: 2030 }, 2030, 2025),
		);
		const state = emptyLedger();
		assert.deepEqual(recordKinds(state, ["pts60"], 2025, 2025), [
			"first 60-point game of the league",
		]);
		assert.deepEqual(recordKinds(state, ["pts60"], 2025, 2025), [
			"2nd 60-point game ever",
		]);
		assert.deepEqual(recordKinds(state, ["pts60"], 2029, 2025), [
			"first 60-point game since 2025",
		]);
	});

	test("team feats and comebacks", () => {
		// Winner (team 1) down 32 after 2 quarters
		assert.strictEqual(
			comebackDeficit(
				[
					[40, 35, 10, 15],
					[20, 23, 40, 30],
				],
				1,
			),
			32,
		);
		assert.deepEqual(
			teamFeatKinds({ pts: 151, tp: 26 }, 31, true, 1).map((x) => x.kind),
			["pts150", "tp25", "comeback30"],
		);
		assert.deepEqual(teamFeatKinds({ pts: 151, tp: 26 }, 31, false, 1.1), []);
	});

	test("streaks: running counters, news and the longest", () => {
		const state = emptyLedger();
		const p = { pid: 1, name: "A", tid: 0 };
		const hit = { td: true, dd: true, p30: false };
		const miss = { td: false, dd: false, p30: false };
		let news = updateStreaks(state, p, hit, 2025);
		news = updateStreaks(state, p, hit, 2025);
		assert.deepEqual(news, []);
		news = updateStreaks(state, p, hit, 2025);
		assert.deepEqual(news, [{ kind: "td", n: 3 }]);
		assert.strictEqual(state.running["1"]!.td!.n, 3);
		updateStreaks(state, p, miss, 2025);
		assert.isUndefined(state.running["1"]);
		assert.strictEqual(state.longest.td![0]!.n, 3);
	});

	test("feat score: the same line is worth more in a low-scoring era and a shorter game", () => {
		const state = emptyLedger();
		const l = line({ pts: 50, drb: 10, ast: 5, fg: 18, fga: 30 });
		const ref = featScore(l, 1, eraMultipliers(state, 2025));
		// A league scoring 90 a game
		state.era[2025] = {
			g: 200,
			pts: 90 * 200,
			trb: 44 * 200,
			ast: 25 * 200,
			stl: 7.5 * 200,
			blk: 5 * 200,
			tp: 12.5 * 200,
		};
		assert.isAbove(featScore(l, 1, eraMultipliers(state, 2025)), ref);
		assert.isAbove(featScore(l, 0.8, eraMultipliers(state, 2025)), ref);
	});
});

const gamePlayer = (pid: number, stat: Partial<GameLine> & { min?: number }) =>
	({
		id: pid,
		name: `P${pid}`,
		pos: "G",
		stat: {
			min: 30,
			fg: 0,
			fga: 0,
			ft: 0,
			fta: 0,
			tov: 0,
			...line(stat),
			...stat,
		},
	}) as any;

const results = (gid: number, pts: [number, number], tp: [number, number]) =>
	({
		gid,
		overtimes: 0,
		team: [
			{
				id: 0,
				stat: {
					pts: pts[0],
					tp: tp[0],
					orb: 10,
					drb: 30,
					ast: 25,
					stl: 7,
					blk: 5,
					ptsQtrs: [10, 20, 60, pts[0] - 90],
				},
			},
			{
				id: 1,
				stat: {
					pts: pts[1],
					tp: tp[1],
					orb: 10,
					drb: 30,
					ast: 25,
					stl: 7,
					blk: 5,
					ptsQtrs: [45, 30, 20, pts[1] - 95],
				},
			},
		],
	}) as any;

describe("feat ledger in games", () => {
	beforeEach(async () => {
		resetG();
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		g.setWithoutSavingToDB("featureFeatRarity" as any, true);
		idb.league = mockIDBLeague();
		await resetCache({});
	});

	test("labels the feat, tracks the team feat, the streak and the career high", async () => {
		const p2 = { pid: 5, stats: [], tid: 0 } as unknown as Player;
		const conditions = {};
		// Game 1: his first game, 30 points (no feat, starts his career highs)
		checkStatisticalFeat(
			5,
			0,
			gamePlayer(5, { pts: 30, drb: 5 }),
			results(1, [151, 120], [26, 10]),
			conditions,
			false,
			false,
			p2,
		);
		// Game 2: 62 points, a triple-double
		const hasFeat = checkStatisticalFeat(
			5,
			0,
			gamePlayer(5, { pts: 62, drb: 11, ast: 10 }),
			results(2, [130, 120], [10, 10]),
			conditions,
			false,
			false,
			p2,
		);
		assert.isTrue(hasFeat);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const feats = await idb.cache.playerFeats.getAll();
		assert.strictEqual(feats.length, 1);
		const feat = feats[0]!;
		assert.include(feat.notes!, "first 60-point game of the league");
		assert.include(feat.notes!, "career-high 62 points");
		assert.include(feat.notes!, "2nd straight 30-point game");
		assert.isAbove(feat.fs!, 60);

		const ledger = getLedger();
		// 150 points and 25 threes in game 1; game 2: down 30-75 at the half, won 130-120
		const kinds = ledger.teamFeats.map((tf) => tf.kind);
		assert.includeMembers(kinds, ["pts150", "tp25", "comeback30"]);
		assert.strictEqual(ledger.running["5"]!.p30!.n, 2);
		assert.isDefined(ledgerForView());

		// All-Star games and players who didn't play are left out
		checkStatisticalFeat(
			5,
			0,
			gamePlayer(5, { pts: 0, min: 0 }),
			results(3, [100, 90], [10, 10]),
			conditions,
			false,
			false,
			p2,
		);
		assert.strictEqual(getLedger().running["5"]!.p30!.n, 2);

		// Retirement ends his running streaks; the longest-streaks rows stay
		endRunningStreaks(5);
		assert.isUndefined(getLedger().running["5"]);
		assert.isTrue(getLedger().longest.p30!.some((r) => r.pid === 5));
		await new Promise((resolve) => setTimeout(resolve, 0));
		const saved = (await idb.cache.gameAttributes.get(
			"featLedger" as any,
		)) as any;
		assert.isUndefined(saved.value.running["5"]);
	});

	test("off: nothing is stored", async () => {
		g.setWithoutSavingToDB("featureFeatRarity" as any, false);
		checkStatisticalFeat(
			5,
			0,
			gamePlayer(5, { pts: 62 }),
			results(2, [151, 120], [26, 10]),
			{},
			false,
			false,
			{ pid: 5, stats: [], tid: 0 } as unknown as Player,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const feats = await idb.cache.playerFeats.getAll();
		assert.isUndefined(feats[0]!.notes);
		assert.isUndefined(feats[0]!.fs);
		assert.isFalse(Object.hasOwn(g, "featLedger"));
	});
});
