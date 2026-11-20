import { afterAll, assert, beforeEach, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import type {
	PlayoffSeries,
	PlayoffSeriesTeam,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import team from "../team/index.ts";
import newSchedulePlayoffsDay from "./newSchedulePlayoffsDay.ts";
import {
	betterSeedHome,
	groupByConf,
	interleaveForReseed,
} from "./playoffBracketUtils.ts";

const NUM_TEAMS = 10;

// Seed n is tid n - 1, all in conference cid
const pt = (
	seed: number,
	won = 0,
	extra?: Partial<PlayoffSeriesTeam>,
): PlayoffSeriesTeam => ({
	tid: seed - 1,
	cid: 0,
	seed,
	won,
	...extra,
});

const setup = async (playoffSeries: PlayoffSeries) => {
	resetG();
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	g.setWithoutSavingToDB("playoffsByConf", false);
	g.setWithoutSavingToDB("numGamesPlayoffSeries", [
		{ start: -Infinity, value: [1, 1, 1] },
	] as any);
	idb.league = mockIDBLeague();
	const teamsDefault = helpers.getTeamsDefault().slice(0, NUM_TEAMS);
	await resetCache({
		teams: teamsDefault.map((t) => team.generate(t)),
		teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
		teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
	});
	await idb.cache.playoffSeries.put(playoffSeries);
};

const scheduled = async () =>
	(await idb.cache.schedule.getAll()).map((game) => [
		game.homeTid,
		game.awayTid,
	]);

// 6 teams in a 3 round bracket: the top 2 seeds get byes. In the first round, 5 beat 4 and 6 beat 3.
const byesBracket = (): PlayoffSeries => ({
	byConf: false,
	season: 2016,
	currentRound: 0,
	series: [
		[
			{ home: pt(1), away: undefined },
			{ home: pt(4, 0, { pts: 90 }), away: pt(5, 1, { pts: 100 }) },
			{ home: pt(3, 0, { pts: 90 }), away: pt(6, 1, { pts: 100 }) },
			{ home: pt(2), away: undefined },
		],
		[],
		[],
	],
});

describe("newSchedulePlayoffsDay", () => {
	afterAll(() => {
		resetG();
		// @ts-expect-error
		idb.league = undefined;
	});

	beforeEach(() => {
		resetG();
	});

	test("byes go through, next round keeps the bracket without reseeding", async () => {
		await setup(byesBracket());
		g.setWithoutSavingToDB("playoffsReseed", false);

		const over = await newSchedulePlayoffsDay();
		assert.isFalse(over);

		const ps = (await idb.cache.playoffSeries.get(2016))!;
		assert.strictEqual(ps.currentRound, 1);
		const round = ps.series[1]!.map((m) => [m.home.seed, m.away?.seed]);
		assert.deepEqual(round, [
			[1, 5],
			[2, 6],
		]);
		for (const m of ps.series[1]!) {
			assert.strictEqual(m.home.won, 0);
			assert.strictEqual(m.away!.won, 0);
			assert.isUndefined(m.home.pts);
			assert.isUndefined(m.away!.pts);
		}

		// Better seed at home in game 1
		assert.deepEqual(await scheduled(), [
			[0, 4],
			[1, 5],
		]);
	});

	test("reseeding: best remaining seed plays the worst", async () => {
		await setup(byesBracket());
		g.setWithoutSavingToDB("playoffsReseed", true);

		await newSchedulePlayoffsDay();

		const ps = (await idb.cache.playoffSeries.get(2016))!;
		const round = ps.series[1]!.map((m) => [m.home.seed, m.away?.seed]);
		assert.deepEqual(round, [
			[1, 6],
			[2, 5],
		]);
		assert.deepEqual(await scheduled(), [
			[0, 5],
			[1, 4],
		]);
	});

	test("play-in: game 1 loser hosts game 2 winner, with points and shootout points reset", async () => {
		const series0 = [
			{ home: pt(1), away: pt(8, 0, { pendingPlayIn: true }) },
			{ home: pt(4), away: pt(5) },
			{ home: pt(3), away: pt(6) },
			{ home: pt(2), away: pt(7, 0, { pendingPlayIn: true }) },
		];
		await setup({
			byConf: false,
			season: 2016,
			currentRound: -1,
			series: [series0, [], []],
			playIns: [
				[
					// 8 beats 7 (the winner is the 7 seed), 9 beats 10
					{
						home: pt(7, 0, { pts: 100, sPts: 1 }),
						away: pt(8, 1, { pts: 101, sPts: 2 }),
					},
					{
						home: pt(9, 1, { pts: 110 }),
						away: pt(10, 0, { pts: 100 }),
					},
				],
			],
		});

		const over = await newSchedulePlayoffsDay();
		assert.isFalse(over);

		const ps = (await idb.cache.playoffSeries.get(2016))!;
		assert.strictEqual(ps.currentRound, -1);
		const game3 = ps.playIns![0]![2]!;
		assert.strictEqual(game3.home.tid, 6);
		assert.strictEqual(game3.away.tid, 8);
		for (const t of [game3.home, game3.away]) {
			assert.strictEqual(t.won, 0);
			assert.isUndefined(t.pts);
			assert.isUndefined(t.sPts);
		}
		assert.deepEqual(await scheduled(), [[6, 8]]);
	});

	test("play-in over: the first round starts", async () => {
		await setup({
			byConf: false,
			season: 2016,
			currentRound: -1,
			series: [
				[
					{ home: pt(1), away: pt(8) },
					{ home: pt(4), away: pt(5) },
					{ home: pt(3), away: pt(6) },
					{ home: pt(2), away: pt(7) },
				],
				[],
				[],
			],
			playIns: [
				[
					{ home: pt(7, 0), away: pt(8, 1) },
					{ home: pt(9, 1), away: pt(10, 0) },
					{ home: pt(7, 1), away: pt(9, 0) },
				],
			],
		});

		await newSchedulePlayoffsDay();
		const ps = (await idb.cache.playoffSeries.get(2016))!;
		assert.strictEqual(ps.currentRound, 0);
		assert.deepEqual(await scheduled(), [
			[0, 7],
			[3, 4],
			[2, 5],
			[1, 6],
		]);
	});
});

describe("playoff bracket utils", () => {
	test("betterSeedHome: 2-2-1-1-1 for 7 games, better seed hosts the last game of any length", () => {
		const pattern = (n: number) =>
			Array.from({ length: n }, (_, i) =>
				betterSeedHome(n, i) ? "H" : "A",
			).join("");
		assert.strictEqual(pattern(7), "HHAAHAH");
		assert.strictEqual(pattern(5), "HHAAH");
		assert.strictEqual(pattern(3), "HAH");
		assert.strictEqual(pattern(1), "H");
		for (const n of [1, 3, 5, 7, 9, 11, 13]) {
			assert.isTrue(betterSeedHome(n, n - 1), String(n));
		}
	});

	test("groupByConf: grouped by the stored cid, not the bracket position", () => {
		const a = { tid: 0, cid: 0 };
		const b = { tid: 1, cid: 1 };
		const c = { tid: 2, cid: 0 };
		const d = { tid: 3, cid: 1 };
		assert.deepEqual(groupByConf([a, b, c, d], 2), [
			[a, c],
			[b, d],
		]);
	});

	test("groupByConf: an odd group falls back to bracket positions", () => {
		const teams = [
			{ tid: 0, cid: 0 },
			{ tid: 1, cid: 0 },
			{ tid: 2, cid: 0 },
			{ tid: 3, cid: 1 },
		];
		assert.deepEqual(groupByConf(teams, 2), [
			[teams[0], teams[1]],
			[teams[2], teams[3]],
		]);
	});

	test("interleaveForReseed", () => {
		assert.deepEqual(
			interleaveForReseed([1, 2, 3, 4, 5, 6]),
			[1, 6, 2, 5, 3, 4],
		);
		const input = [1, 2];
		interleaveForReseed(input);
		assert.deepEqual(input, [1, 2]);
	});
});
