import { assert, beforeEach, describe, test } from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { player } from "../index.ts";
import { g } from "../../util/index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { getPreDraftAwards, getProAwards } from "../../../common/preDraft.ts";
import {
	makeBlankPreDraftStatsRow,
	normalizePreDraftAwards,
	normalizePreDraftStats,
	prepareUploadedProspectPreDraft,
	replacePreDraftAwards,
	replacePreDraftStats,
} from "./normalizePreDraft.ts";
import stats from "./stats.ts";

// A prospect the way the Draft Class Workshop writes one: complete rows, tid -7, honors at their own seasons
const makeFilePlayer = (draftYear: number) => {
	const base = player.generate(
		PLAYER.UNDRAFTED,
		19,
		draftYear,
		false,
		DEFAULT_LEVEL,
	);
	const p: any = {
		...base,
		pid: 7,
		tid: PLAYER.UNDRAFTED,
		college: "Duke",
	};
	const row = (season: number, pts: number, extra: any = {}) => ({
		...makeBlankPreDraftStatsRow(season),
		gp: 30,
		gs: 30,
		min: 900,
		fg: 200,
		fga: 400,
		pts,
		...extra,
	});
	p.stats = [
		row(draftYear - 1, 400, { jerseyNumber: 5 }),
		row(draftYear, 600),
		// A duplicate, which is what exporting the same class a second time gives
		row(draftYear, 650),
		// Stats that can't be pro stats for a prospect
		row(draftYear + 1, 999),
		{ ...row(draftYear, 123), playoffs: true },
		// Junk
		{ season: "x", pts: 3 },
		null,
	];
	p.awards = [
		{ season: draftYear, type: "Naismith Player of the Year" },
		{ season: draftYear, type: "Naismith Player of the Year" },
		{ season: draftYear - 1, type: "All-Conference First Team" },
		{ season: draftYear - 1, type: "" },
		{ season: "nope", type: "Bad" },
	];
	return p;
};

beforeEach(() => {
	resetG();
	g.setWithoutSavingToDB("season", 2030);
});

describe("normalizePreDraftStats", () => {
	test("complete rows, tid DNE, sorted, de-duplicated, shifted", () => {
		const p = makeFilePlayer(2027);
		const rows = normalizePreDraftStats(p.stats, {
			draftYear: 2031,
			seasonOffset: 4,
		});
		assert.deepStrictEqual(
			rows.map((row) => row.season),
			[2030, 2031],
		);
		assert.strictEqual(rows[1]!.pts, 650);

		for (const row of rows) {
			assert.strictEqual(row.tid, PLAYER.DOES_NOT_EXIST);
			assert.strictEqual(row.playoffs, false);
			for (const key of [...stats.raw, ...stats.derived, ...stats.max]) {
				assert(Object.hasOwn(row, key), `missing ${key}`);
			}
		}
		assert.strictEqual(rows[0]!.jerseyNumber, "5");
	});

	test("invalid numbers are zeroed and a school name is kept", () => {
		const rows = normalizePreDraftStats(
			[
				{
					season: 2020,
					tid: 5,
					pts: "lots",
					gp: Number.NaN,
					min: 100,
					school: " Kentucky ",
				},
			],
			{ draftYear: 2020, seasonOffset: 0 },
		);
		assert.strictEqual(rows.length, 1);
		assert.strictEqual(rows[0]!.pts, 0);
		assert.strictEqual(rows[0]!.gp, 0);
		assert.strictEqual(rows[0]!.min, 100);
		assert.strictEqual(rows[0]!.tid, PLAYER.DOES_NOT_EXIST);
		assert.strictEqual(rows[0]!.teamName, "Kentucky");
	});

	test("non-arrays give nothing", () => {
		assert.deepStrictEqual(
			normalizePreDraftStats(undefined, { draftYear: 2020, seasonOffset: 0 }),
			[],
		);
	});
});

describe("normalizePreDraftAwards", () => {
	test("keeps valid simple awards, de-duplicated, shifted, nothing after the draft year", () => {
		const p = makeFilePlayer(2027);
		const awards = normalizePreDraftAwards(p.awards, {
			draftYear: 2031,
			seasonOffset: 4,
		});
		assert.deepStrictEqual(awards, [
			{ season: 2030, type: "All-Conference First Team" },
			{ season: 2031, type: "Naismith Player of the Year" },
		]);
	});
});

describe("replace helpers", () => {
	test("replacePreDraftStats replaces rows in the window, keeps older college rows and pro rows", () => {
		const draftYear = 2027;
		const old = [
			{ ...makeBlankPreDraftStatsRow(2015), pts: 1 }, // older than the window
			{ ...makeBlankPreDraftStatsRow(2026), pts: 2 },
			{ ...makeBlankPreDraftStatsRow(2027), pts: 3 },
			{ ...makeBlankPreDraftStatsRow(2028), tid: 4, pts: 4 }, // pro
		];
		const added = [
			{ ...makeBlankPreDraftStatsRow(2026), pts: 20 },
			{ ...makeBlankPreDraftStatsRow(2027), pts: 30 },
		];
		const once = replacePreDraftStats(old, added, draftYear);
		assert.deepStrictEqual(
			once.map((row) => [row.season, row.pts]),
			[
				[2015, 1],
				[2026, 20],
				[2027, 30],
				[2028, 4],
			],
		);
		// Doing it again changes nothing
		const twice = replacePreDraftStats(once, added, draftYear);
		assert.deepStrictEqual(twice, once);
	});

	test("replacePreDraftAwards", () => {
		const draftYear = 2027;
		const old = [
			{ season: 2026, type: "A" },
			{ season: 2027, type: "B" },
			{ season: 2029, type: "All-Star" },
		];
		const added = [{ season: 2027, type: "C" }];
		const once = replacePreDraftAwards(old, added, draftYear);
		assert.deepStrictEqual(once, [
			{ season: 2027, type: "C" },
			{ season: 2029, type: "All-Star" },
		]);
		assert.deepStrictEqual(replacePreDraftAwards(once, added, draftYear), once);
	});
});

describe("uploaded draft class file -> prospects", () => {
	test("statlines and honors survive, shifted to the draft year, with experience 0", async () => {
		const draftYear = 2031;
		const p = makeFilePlayer(2027);
		p.draft.year = 2027;
		p.born.year = 2008;
		prepareUploadedProspectPreDraft(p, { draftYear, fileSeason: 2027 });

		p.ratings[0].season = draftYear;
		const p2 = await player.augmentPartialPlayer(p, DEFAULT_LEVEL, 70);
		p2.draft.year = draftYear;
		p2.tid = PLAYER.UNDRAFTED;
		p2.pid = 1;
		await resetCache({ players: [p2 as any] });

		assert.deepStrictEqual(
			p2.stats.map((row) => [row.season, row.tid, row.pts]),
			[
				[2030, PLAYER.DOES_NOT_EXIST, 400],
				[2031, PLAYER.DOES_NOT_EXIST, 650],
			],
		);
		assert.deepStrictEqual(
			getPreDraftAwards(p2).map((a) => [a.season, a.type]),
			[
				[2030, "All-Conference First Team"],
				[2031, "Naismith Player of the Year"],
			],
		);
		assert.strictEqual(getProAwards(p2).length, 0);
		// statsTids doesn't include college rows
		assert.deepStrictEqual(p2.statsTids, []);

		const pf = await player.format(p2 as any, {
			attrs: ["experience", "awards"],
			stats: ["season", "pts"],
			showNoStats: true,
		});
		assert.strictEqual(pf!.experience, 0);
		assert.strictEqual(pf!.awards.length, 0);
		assert.strictEqual(pf!.careerStats.pts, 0);
	});

	test("re-importing a file of already-imported rows gives no duplicates", () => {
		const p = makeFilePlayer(2027);
		prepareUploadedProspectPreDraft(p, { draftYear: 2027, fileSeason: 2027 });
		const first = structuredClone(p);
		// Exporting it again and importing again
		prepareUploadedProspectPreDraft(first, {
			draftYear: 2027,
			fileSeason: 2027,
		});
		assert.deepStrictEqual(first.stats, p.stats);
		assert.deepStrictEqual(first.awards, p.awards);
		assert.strictEqual(p.stats.length, 2);
	});

	test("file with no stats or awards is fine", () => {
		const p: any = { draft: { year: 2027 } };
		prepareUploadedProspectPreDraft(p, { draftYear: 2027, fileSeason: 2027 });
		assert.deepStrictEqual(p.stats, []);
		assert.deepStrictEqual(p.awards, []);
	});

	test("pro awards in the file are left alone", () => {
		const p: any = {
			draft: { year: 2027 },
			awards: [
				{ season: 2028, type: "All-Star" },
				{ season: 2027, type: "X" },
			],
		};
		prepareUploadedProspectPreDraft(p, { draftYear: 2027, fileSeason: 2027 });
		assert.deepStrictEqual(p.awards, [
			{ season: 2027, type: "X" },
			{ season: 2028, type: "All-Star" },
		]);
	});
});
