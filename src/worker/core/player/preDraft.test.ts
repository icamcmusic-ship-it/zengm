import { assert, beforeEach, describe, test } from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { player } from "../index.ts";
import { g } from "../../util/index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import madeHofBasketball from "./madeHof.basketball.ts";
import type { Player } from "../../../common/types.ts";

// A drafted player with college rows (tid DNE, season <= draft.year) and pro rows after
const DRAFT_YEAR = 2020;

const makeStatsRow = (season: number, tid: number, extra: any = {}) => {
	const row: any = {
		season,
		tid,
		playoffs: false,
		gp: 30,
		gs: 30,
		min: 1000,
		fg: 200,
		fga: 400,
		pts: 600,
		trb: 200,
		orb: 50,
		drb: 150,
		ast: 100,
		yearsWithTeam: 1,
		per: 20,
		ws: 3,
		ows: 2,
		dws: 1,
		ewa: 4,
		...extra,
	};
	return row;
};

let p: Player;
beforeEach(async () => {
	resetG();
	g.setWithoutSavingToDB("season", 2023);
	p = {
		pid: 0,
		...player.generate(PLAYER.UNDRAFTED, 19, DRAFT_YEAR, false, DEFAULT_LEVEL),
	};
	p.tid = 4;
	p.draft.year = DRAFT_YEAR;
	await resetCache({ players: [p] });
	p.stats = [
		makeStatsRow(2018, PLAYER.DOES_NOT_EXIST, { pts: 800, per: 40 }),
		makeStatsRow(2019, PLAYER.DOES_NOT_EXIST, { pts: 900, per: 40 }),
		makeStatsRow(DRAFT_YEAR, PLAYER.DOES_NOT_EXIST, { pts: 1000, per: 40 }),
		makeStatsRow(2021, 4, { pts: 300 }),
		makeStatsRow(2022, 4, { pts: 400 }),
	];
	p.awards = [
		{ season: 2019, type: "College: All-Conference First Team" },
		{ season: DRAFT_YEAR, type: "College: All-American" },
		{ season: 2022, type: "All-Star" },
	];
});

describe("experience", () => {
	test("does not count pre-draft rows", async () => {
		const pf = await player.format(p, { attrs: ["experience"] });
		assert.strictEqual(pf!.experience, 2);
	});

	test("is 0 for a prospect with only college rows", async () => {
		p.stats = p.stats.filter((row) => row.tid === PLAYER.DOES_NOT_EXIST);
		p.tid = PLAYER.UNDRAFTED;
		const pf = await player.format(p, { attrs: ["experience"] });
		assert.strictEqual(pf!.experience, 0);
	});

	test("counts DNE rows after the draft year (imported / defunct team seasons)", async () => {
		p.stats.push(makeStatsRow(2023, PLAYER.DOES_NOT_EXIST));
		const pf = await player.format(p, { attrs: ["experience"] });
		assert.strictEqual(pf!.experience, 3);
	});

	test("with a season", async () => {
		const pf = await player.format(p, { attrs: ["experience"], season: 2021 });
		assert.strictEqual(pf!.experience, 1);
	});

	test("player with unknown draft year keeps counting all rows", async () => {
		p.draft.year = 0;
		const pf = await player.format(p, { attrs: ["experience"] });
		assert.strictEqual(pf!.experience, 5);
	});
});

describe("career stats", () => {
	test("exclude pre-draft rows by default", async () => {
		const pf = await player.format(p, {
			stats: ["season", "pts", "gp"],
			statType: "totals",
		});
		assert.strictEqual(pf!.stats.length, 2);
		assert.deepStrictEqual(
			pf!.stats.map((row) => row.season),
			[2021, 2022],
		);
		assert.strictEqual(pf!.careerStats.pts, 700);
		assert.strictEqual(pf!.careerStats.gp, 60);
	});

	test("combined career includes only pro rows", async () => {
		const pf = await player.format(p, {
			stats: ["season", "pts"],
			statType: "totals",
			seasonType: "combined",
			mergeStats: "totAndTeams",
		});
		assert.strictEqual(pf!.careerStatsCombined.pts, 700);
	});

	test('preDraftStats "only" returns just the college rows', async () => {
		const pf = await player.format(p, {
			stats: ["season", "pts"],
			statType: "totals",
			preDraftStats: "only",
		});
		assert.deepStrictEqual(
			pf!.stats.map((row) => row.season),
			[2018, 2019, 2020],
		);
		assert.strictEqual(pf!.careerStats.pts, 2700);
	});

	test('preDraftStats "include" returns everything', async () => {
		const pf = await player.format(p, {
			stats: ["season", "pts"],
			statType: "totals",
			preDraftStats: "include",
		});
		assert.strictEqual(pf!.stats.length, 5);
		assert.strictEqual(pf!.careerStats.pts, 3400);
	});

	test("a prospect with only college rows has no stats rows, and a draft prospect season request is unaffected", async () => {
		p.stats = p.stats.filter((row) => row.tid === PLAYER.DOES_NOT_EXIST);
		p.tid = PLAYER.UNDRAFTED;
		const pf = await player.format(p, {
			stats: ["season", "pts", "gp"],
			statType: "totals",
		});
		assert.strictEqual(pf!.stats.length, 0);
		assert.strictEqual(pf!.careerStats.gp, 0);
		assert.strictEqual(pf!.careerStats.pts, 0);
	});
});

describe("awards", () => {
	test("awards attr excludes pre-draft honors", async () => {
		const pf = await player.format(p, { attrs: ["awards"] });
		assert.deepStrictEqual(
			pf!.awards.map((a) => a.type),
			["All-Star"],
		);
	});

	test("numAllStar ignores pre-draft honors", async () => {
		p.awards.push({ season: DRAFT_YEAR, type: "All-Star" });
		const pf = await player.format(p, { attrs: ["numAllStar"] });
		assert.strictEqual(pf!.numAllStar, 1);
	});
});

describe("value, retirement and HoF logic", () => {
	test("value does not change when pre-draft rows are added", () => {
		const options = { ovrMean: 47, ovrStd: 10 };
		const withCollege = player.value(p, options);

		const p2: Player = { ...p, stats: p.stats.filter((row) => row.tid === 4) };
		const without = player.value(p2, options);
		assert.strictEqual(withCollege, without);
	});

	test("value of a drafted player who has not played yet ignores college PER", () => {
		const options = { ovrMean: 47, ovrStd: 10 };
		const prospect: Player = {
			...p,
			stats: p.stats.filter((row) => row.tid === PLAYER.DOES_NOT_EXIST),
		};
		const noStats: Player = { ...p, stats: [] };
		assert.strictEqual(
			player.value(prospect, options),
			player.value(noStats, options),
		);
	});

	test("madeHof ignores pre-draft win shares", () => {
		const heavy = { ...p, stats: [] as any[] };
		for (let i = 0; i < 12; i++) {
			heavy.stats.push(
				makeStatsRow(2000 + i, PLAYER.DOES_NOT_EXIST, {
					ows: 40,
					dws: 40,
					ewa: 40,
				}),
			);
		}
		heavy.draft = { ...heavy.draft, year: 2015 };
		assert.strictEqual(madeHofBasketball(heavy), false);
		// Sanity check: the same rows as pro rows would make the HoF
		heavy.draft = { ...heavy.draft, year: 0 };
		assert.strictEqual(madeHofBasketball(heavy), true);
	});
});
