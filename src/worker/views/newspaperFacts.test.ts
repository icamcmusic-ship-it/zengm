import { assert, describe, test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import type { Game } from "../../common/types.ts";
import {
	aggregateGames,
	decideRebuild,
	pickEdition,
	careerBefore,
	honorsBefore,
	lineFor,
	num,
	seasonTid,
} from "./newspaperFacts.ts";

const row = (o: Record<string, unknown>) =>
	({ playoffs: false, season: 2024, tid: 0, gp: 0, ...o }) as any;

describe("newspaper facts from the worker", () => {
	test("the edition follows the phase and the games played", () => {
		const e = (o: { season?: number; phase: number; gp: number }) =>
			pickEdition({ season: 2025, currentSeason: 2025, ...o });
		assert.strictEqual(e({ phase: PHASE.PRESEASON, gp: 0 }), "preseason");
		assert.strictEqual(e({ phase: PHASE.REGULAR_SEASON, gp: 0 }), "preseason");
		assert.strictEqual(e({ phase: PHASE.REGULAR_SEASON, gp: 12 }), "midseason");
		assert.strictEqual(e({ phase: PHASE.PLAYOFFS, gp: 82 }), "playoffs");
		assert.strictEqual(e({ phase: PHASE.DRAFT_LOTTERY, gp: 82 }), "final");
		assert.strictEqual(e({ phase: PHASE.FREE_AGENCY, gp: 82 }), "final");
		// Any earlier season is over, whatever phase the league is in
		assert.strictEqual(e({ season: 2024, phase: PHASE.PRESEASON, gp: 0 }), "final");
	});

	test("the paper is not rebuilt on every simmed day", () => {
		const base = {
			inputsChanged: false,
			structural: false,
			simmed: false,
			isCurrent: true,
			cached: true,
			sameStamp: true,
			gpDelta: 0,
		};
		// Nothing happened that matters
		assert.strictEqual(decideRebuild(base), "skip");
		// A day or two simmed: keep the paper
		assert.strictEqual(decideRebuild({ ...base, simmed: true, gpDelta: 2 }), "skip");
		// Many days: build again
		assert.strictEqual(decideRebuild({ ...base, simmed: true, gpDelta: 9 }), "build");
		// A new phase or a trade always rebuilds the season in progress
		assert.strictEqual(decideRebuild({ ...base, structural: true }), "build");
		assert.strictEqual(decideRebuild({ ...base, simmed: true, sameStamp: false }), "build");
		// Opening a paper that was built already reuses it
		assert.strictEqual(decideRebuild({ ...base, inputsChanged: true }), "reuse");
		// A past season is kept for good and never rebuilt by a sim
		const past = { ...base, isCurrent: false };
		assert.strictEqual(decideRebuild({ ...past, simmed: true, gpDelta: 50 }), "skip");
		assert.strictEqual(decideRebuild({ ...past, inputsChanged: true }), "reuse");
		// Nothing cached: build
		assert.strictEqual(decideRebuild({ ...base, inputsChanged: true, cached: false }), "build");
	});

	test("num never lets an unknown number through", () => {
		assert.strictEqual(num(undefined), 0);
		assert.strictEqual(num(Number.NaN), 0);
		assert.strictEqual(num(Number.POSITIVE_INFINITY), 0);
		assert.strictEqual(num(3), 3);
	});

	test("lineFor sums stints into per-game numbers and leaves out unplayed seasons", () => {
		const p = {
			stats: [
				row({ gp: 10, min: 300, pts: 200, orb: 10, drb: 40, ast: 30, stl: 5, blk: 5, ows: 1, dws: 0.5, fg: 80, fga: 160, ft: 30, fta: 40, tp: 10, tpa: 30, gs: 10, tov: 20, pf: 25, pm: 20 }),
				row({ gp: 10, min: 340, pts: 240, orb: 20, drb: 50, ast: 20, stl: 5, blk: 5, ows: 1, dws: 0.5, fg: 90, fga: 180, ft: 20, fta: 40, tp: 10, tpa: 30, gs: 0, tov: 10, pf: 15, pm: -10, tid: 1 }),
				row({ gp: 5, season: 2023, pts: 50 }),
				row({ gp: 3, playoffs: true, pts: 60 }),
			],
		};
		const line = lineFor(p, 2024, false)!;
		assert.strictEqual(line.gp, 20);
		assert.strictEqual(line.pts, 22);
		assert.strictEqual(line.trb, 6);
		assert.strictEqual(line.ws, 3);
		assert.strictEqual(line.ftp, 62.5);
		assert.strictEqual(line.gs, 0.5);
		assert.strictEqual(line.pm, 0.5);
		assert.strictEqual(lineFor(p, 2025, false), undefined);
		assert.strictEqual(lineFor(p, 2024, true)!.pts, 20);
		// A season of zero games is not a line
		assert.strictEqual(lineFor({ stats: [row({ gp: 0 })] }, 2024, false), undefined);
	});

	test("free throw percentage is unknown, not zero, with no attempts", () => {
		const line = lineFor({ stats: [row({ gp: 2, min: 20, pts: 10, fta: 0, ft: 0 })] }, 2024, false)!;
		assert.strictEqual(line.ftp, -1);
	});

	test("seasonTid is the last stint", () => {
		const p = {
			tid: 9,
			stats: [row({ tid: 1, gp: 3 }), row({ tid: 4, gp: 2 })],
		};
		assert.strictEqual(seasonTid(p, 2024), 4);
		assert.strictEqual(seasonTid(p, 2020), 9);
	});

	test("careerBefore counts earlier seasons only and not playoffs", () => {
		const p = {
			stats: [
				row({ season: 2021, gp: 80, pts: 1600, orb: 100, drb: 400, ast: 300, ows: 4, dws: 2 }),
				row({ season: 2022, gp: 60, pts: 1200, orb: 80, drb: 300, ast: 200, ows: 3, dws: 1 }),
				row({ season: 2022, gp: 10, pts: 300, playoffs: true }),
				row({ season: 2023, gp: 70, pts: 2000 }),
			],
		};
		const c = careerBefore(p, 2023)!;
		assert.strictEqual(c.pts, 2800);
		assert.strictEqual(c.gp, 140);
		assert.strictEqual(c.trb, 880);
		assert.strictEqual(c.seasons, 2);
		assert.strictEqual(c.ws, 10);
		assert.strictEqual(careerBefore(p, 2021), undefined);
	});

	test("honorsBefore reads awards by name and ignores the current season", () => {
		const p = {
			awards: [
				{ season: 2020, type: "Won Championship" },
				{ season: 2021, type: "All-Star" },
				{ season: 2021, type: "All-Star" },
				{ season: 2022, name: "Most Valuable Player" },
				{ season: 2022, name: "Most Valuable Player", group: { type: "conf" } },
				{ season: 2022, name: "All-League", numTeams: 3, rank: 1 },
				{ season: 2024, name: "Most Valuable Player" },
			],
		} as any;
		const h = honorsBefore(p, 2024);
		assert.deepStrictEqual(h, { mvp: 1, dpoy: 0, allStar: 2, allLeague: 1, titles: 1 });
	});

	test("aggregateGames finds close records, streaks, double-doubles and series", () => {
		const box = (pid: number, pts: number, trb: number, ast = 0) => ({
			pid,
			min: 30,
			pts,
			orb: 0,
			drb: trb,
			ast,
			stl: 0,
			blk: 0,
		});
		const game = (
			gid: number,
			day: number,
			won: [number, number],
			lost: [number, number],
			players: ReturnType<typeof box>[][],
			overtimes = 0,
		): Game =>
			({
				gid,
				day,
				overtimes,
				season: 2024,
				won: { tid: won[0], pts: won[1] },
				lost: { tid: lost[0], pts: lost[1] },
				teams: [
					{ tid: won[0], players: players[0] },
					{ tid: lost[0], players: players[1] },
				],
			}) as any;
		const games = [
			game(1, 1, [0, 100], [1, 98], [[box(10, 32, 11)], [box(20, 12, 4)]]),
			game(2, 2, [0, 110], [1, 90], [[box(10, 41, 10, 10)], [box(20, 8, 2)]]),
			game(3, 3, [1, 105], [0, 100], [[box(20, 20, 10)], [box(10, 9, 3)]], 1),
			game(4, 4, [0, 120], [2, 119], [[box(10, 15, 5)], [box(30, 10, 10)]]),
			{ ...game(5, 5, [0, 100], [1, 50], [[], []]), playoffs: true } as Game,
		];
		const a = aggregateGames(games);
		const t0 = a.teams.get(0)!;
		assert.deepStrictEqual(t0.close, { w: 2, l: 1 });
		assert.deepStrictEqual(t0.ot, { w: 0, l: 1 });
		assert.strictEqual(t0.bestStreak, 2);
		assert.strictEqual(a.teams.get(1)!.bestStreak, 1);
		const p10 = a.players.get(10)!;
		assert.strictEqual(p10.boxGp, 4);
		assert.strictEqual(p10.dd, 2);
		assert.strictEqual(p10.td, 1);
		assert.strictEqual(p10.g30, 2);
		assert.strictEqual(p10.g40, 1);
		assert.strictEqual(p10.hi, 41);
		// Playoff games stay out of the season series
		const h = a.h2h.find((x) => x.a === 0 && x.b === 1)!;
		assert.strictEqual(h.aw, 2);
		assert.strictEqual(h.bw, 1);
		assert.strictEqual(h.margin, 2 + 20 - 5);
	});
});
