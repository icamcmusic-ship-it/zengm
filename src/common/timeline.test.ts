import { assert, describe, test } from "vitest";
import {
	findScoringRecords,
	findTeamRecords,
	groupTimeline,
	pickMajorTrades,
	type TimelineItem,
} from "./timeline.ts";

const ts = (season: number, tid: number, won: number, lost: number) => ({
	season,
	tid,
	abbrev: `T${tid}`,
	name: `Team ${tid}`,
	won,
	lost,
});

describe("League timeline", () => {
	test("team records: only when a later season beats the bar", () => {
		const items = findTeamRecords(
			[
				ts(2020, 0, 60, 22),
				ts(2020, 1, 20, 62),
				ts(2021, 0, 65, 17),
				ts(2021, 1, 25, 57),
				ts(2022, 0, 50, 32),
				ts(2022, 1, 10, 72),
				// Unfinished season
				ts(2023, 0, 70, 2),
			],
			{ lastFinishedSeason: 2022, minGp: 60 },
		);
		assert.deepStrictEqual(
			items.map((x) => [x.season, x.tids[0], x.order]),
			[
				[2021, 0, 0],
				[2022, 1, 1],
			],
		);
		assert.match(items[0]!.title, /65-17, the best record/);
		assert.deepStrictEqual(items[0]!.url, ["roster", "T0_0", 2021]);
	});

	test("team records skip short seasons", () => {
		const items = findTeamRecords([ts(2020, 0, 40, 42), ts(2021, 0, 10, 0)], {
			lastFinishedSeason: 2021,
			minGp: 60,
		});
		assert.strictEqual(items.length, 0);
	});

	test("scoring records: the first season only sets the bar", () => {
		const feat = (gid: number, season: number, pts: number) => ({
			gid,
			season,
			pts,
			pid: gid,
			tid: 0,
			name: `P${gid}`,
			playoffs: false,
		});
		const items = findScoringRecords(
			[
				feat(1, 2020, 50),
				feat(2, 2020, 55),
				feat(3, 2021, 54),
				feat(4, 2021, 60),
				feat(5, 2022, 61),
			],
			() => "ATL",
		);
		assert.deepStrictEqual(
			items.map((x) => x.pids[0]),
			[4, 5],
		);
		assert.deepStrictEqual(items[0]!.url, ["game_log", "ATL_0", 2021, 4]);
	});

	test("major trades: top N per season above the minimum score", () => {
		const trades = [
			{ eid: 1, season: 2020, score: 5 },
			{ eid: 2, season: 2020, score: 30 },
			{ eid: 3, season: 2020, score: 20 },
			{ eid: 4, season: 2021, score: 0 },
		];
		assert.deepStrictEqual(
			pickMajorTrades(trades, 2, 1).map((t) => t.eid),
			[2, 3],
		);
	});

	test("grouping: newest season first, kinds in a fixed order", () => {
		const item = (
			season: number,
			kind: TimelineItem["kind"],
		): TimelineItem => ({
			season,
			kind,
			order: 0,
			title: kind,
			url: [],
			tids: [],
			pids: [],
		});
		const grouped = groupTimeline([
			item(2020, "trade"),
			item(2021, "storyline"),
			item(2020, "champion"),
			item(2021, "award"),
		]);
		assert.deepStrictEqual(
			grouped.map((row) => [row.season, row.items.map((x) => x.kind)]),
			[
				[2021, ["award", "storyline"]],
				[2020, ["champion", "trade"]],
			],
		);
	});
});
