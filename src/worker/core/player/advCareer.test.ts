// League Extras "Keep Career Tracking for Retired Players": at retirement every stats row's tracking (adv) is folded into
// p.advCareer and deleted from the rows. Careers read advCareer + the rows' remaining adv, so they are the same before and after.
import {
	afterAll,
	assert,
	beforeAll,
	beforeEach,
	describe,
	test,
} from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import {
	ADV_LEN,
	ADV_STAT_KEYS,
	advCareerUse,
	careerAdv,
	newAdv,
	sumAdv,
} from "../../../common/advStats.ts";
import type { Player } from "../../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import player from "./index.ts";
import {
	ADV_RETIRED_SEASONS,
	foldAdvCareer,
	foldRetiredAdvCareers,
	getPlayTypeProfile,
} from "./advStatsStorage.ts";
import augmentPartialPlayer from "./augmentPartialPlayer.ts";

// A deterministic adv array (no Math.random: integers from a small LCG)
let seed = 1;
const randomAdv = () => {
	const a = newAdv();
	for (let i = 0; i < ADV_LEN; i++) {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		a[i] = seed % 200;
	}
	return a;
};

const ADV_STATS = ADV_STAT_KEYS;

const statsRow = (
	season: number,
	tid: number,
	playoffs: boolean,
	adv: number[] | undefined,
) =>
	({
		season,
		tid,
		playoffs,
		yearsWithTeam: 1,
		jerseyNumber: "1",
		gp: 20,
		gs: 20,
		min: 400,
		pts: 150,
		...(adv ? { adv } : {}),
	}) as unknown as Player["stats"][number];

// A player with 6 pro seasons of tracking (regular season and playoffs, a traded season with two partial rows) and one season from
// before the setting (no adv)
const makePlayer = (pid: number) => {
	const p = {
		pid,
		...player.generate(PLAYER.FREE_AGENT, 25, 2005, true, DEFAULT_LEVEL),
	} as Player;
	p.tid = 3;
	p.draft.year = 2005;
	// (a ratings row inside the season ranges asked for below)
	p.ratings[0]!.season = 2012;
	p.stats = [];
	const addRow = (
		season: number,
		tid: number,
		playoffs: boolean,
		adv = true,
	) => {
		p.stats.push(
			statsRow(season, tid, playoffs, adv ? randomAdv() : undefined),
		);
	};
	addRow(2009, 3, false, false);
	for (let season = 2010; season <= 2015; season++) {
		if (season === 2012) {
			// Traded: two partial seasons
			addRow(season, 3, false);
			addRow(season, 5, false);
		} else {
			addRow(season, 3, false);
		}
		if (season % 2 === 0) {
			addRow(season, season === 2012 ? 5 : 3, true);
		}
	}
	p.statsTids = [3, 5];
	return p;
};

const formatCareer = async (
	p: Player,
	extra: { tid?: number; seasonRange?: [number, number] } = {},
) => {
	const out: any = await player.format(p, {
		stats: ["gp", ...ADV_STATS] as any,
		seasonType: ["regularSeason", "playoffs", "combined"],
		mergeStats: "totOnly",
		...extra,
	});
	return {
		rs: out?.careerStats,
		po: out?.careerStatsPlayoffs,
		combined: out?.careerStatsCombined,
	};
};

const rowsAdv = (p: Player, playoffs: boolean) =>
	sumAdv(p.stats.filter((row) => row.playoffs === playoffs));

beforeAll(() => {
	resetG();
	g.setWithoutSavingToDB("season", 2016);
	idb.league = mockIDBLeague();
});
afterAll(() => {
	// @ts-expect-error
	idb.league = undefined;
});
beforeEach(async () => {
	await resetCache({});
	g.setWithoutSavingToDB("advCareerTracking", true);
	g.setWithoutSavingToDB("advCareerFolded", true);
});

describe("Keep Career Tracking for Retired Players", () => {
	test("folding at retirement equals the old career sum exactly, and the career view is unchanged", async () => {
		const p = makePlayer(1);
		const rsBefore = rowsAdv(p, false)!;
		const poBefore = rowsAdv(p, true)!;
		const careerBefore = await formatCareer(p);
		const profileBefore = getPlayTypeProfile(p);

		await player.retire(p);

		assert.strictEqual(p.tid, PLAYER.RETIRED);
		assert.deepStrictEqual(p.advCareer?.rs, rsBefore);
		assert.deepStrictEqual(p.advCareer?.po, poBefore);
		assert.strictEqual(p.advCareer?.from, 2010);
		assert.strictEqual(p.advCareer?.to, 2015);
		assert(p.stats.every((row) => row.adv === undefined));

		const careerAfter = await formatCareer(p);
		assert.deepStrictEqual(careerAfter, careerBefore);
		// Rates exist (not NaN, not all zero)
		assert(Number.isFinite(careerAfter.rs.dfgp));
		assert(careerAfter.rs.ptPoss > 0);
		assert(careerAfter.po.ptPoss > 0);
		assert.strictEqual(
			careerAfter.combined.ptPoss,
			careerAfter.rs.ptPoss + careerAfter.po.ptPoss,
		);
		assert.deepStrictEqual(getPlayTypeProfile(p), profileBefore);
	});

	test("folding again or a comeback never counts a row twice", async () => {
		const p = makePlayer(2);
		const allRs = rowsAdv(p, false)!;
		await player.retire(p);
		const folded = helpers.deepCopy(p.advCareer);

		// A repeat fold adds nothing
		assert.isFalse(foldAdvCareer(p));
		assert.deepStrictEqual(p.advCareer, folded);

		// Comeback (God Mode or an unretirement): new seasons get rows again
		p.tid = 4;
		const addSeason = (season: number) => {
			const adv = randomAdv();
			p.stats.push(statsRow(season, 4, false, adv));
			return adv;
		};
		const new1 = addSeason(2017);
		const new2 = addSeason(2018);
		const expectedRs = sumAdv([{ adv: allRs }, { adv: new1 }, { adv: new2 }])!;

		const active = await formatCareer(p);
		// While active again: career = folded total + the new rows
		assert.deepStrictEqual(
			careerAdv(
				p.advCareer,
				p.stats.filter((row) => !row.playoffs),
				"regularSeason",
			),
			expectedRs,
		);

		g.setWithoutSavingToDB("season", 2018);
		await player.retire(p);
		g.setWithoutSavingToDB("season", 2016);
		assert.deepStrictEqual(p.advCareer?.rs, expectedRs);
		assert.deepStrictEqual(p.advCareer?.po, folded?.po);
		assert.strictEqual(p.advCareer?.to, 2018);
		assert.deepStrictEqual(await formatCareer(p), active);
	});

	test("a team's career or part of the folded seasons shows no tracking, a range covering them all shows it", async () => {
		const p = makePlayer(3);
		const before = await formatCareer(p, { seasonRange: [2009, 2015] });
		await player.retire(p);

		const all = await formatCareer(p, { seasonRange: [2009, 2016] });
		assert.deepStrictEqual(all.rs.ptPoss, before.rs.ptPoss);

		const part = await formatCareer(p, { seasonRange: [2011, 2013] });
		assert.isUndefined(part.rs.ptPoss);
		assert.isUndefined(part.rs.dfgp);
		// Box score stats are still there
		assert(part.rs.gp > 0);

		const team = await formatCareer(p, { tid: 5 });
		assert.isUndefined(team.rs.ptPoss);

		// No overlap: none
		assert.strictEqual(
			advCareerUse(p.advCareer, { seasonRange: [2000, 2008], rows: [] }),
			"none",
		);
	});

	test("setting off: today's trim, and the fold pass folds the kept seasons later", async () => {
		g.setWithoutSavingToDB("advCareerTracking", false);
		const p = makePlayer(4);
		await resetCache({ players: [p] });
		const kept = [
			...new Set(p.stats.filter((row) => row.adv).map((row) => row.season)),
		]
			.sort((a, b) => b - a)
			.slice(0, ADV_RETIRED_SEASONS);
		const expectedRs = sumAdv(
			p.stats.filter((row) => !row.playoffs && kept.includes(row.season)),
		);

		await player.retire(p);
		assert.isUndefined(p.advCareer);
		assert.deepStrictEqual(
			[
				...new Set(p.stats.filter((row) => row.adv).map((row) => row.season)),
			].sort(),
			kept.toSorted(),
		);
		// Some retired player now has rows to fold
		assert.isFalse(g.get("advCareerFolded"));
		await idb.cache.players.put(p);

		// Still off: the pass does nothing
		assert.strictEqual(await foldRetiredAdvCareers(), 0);

		// Turned on: the kept seasons are folded, once
		g.setWithoutSavingToDB("advCareerTracking", true);
		assert.strictEqual(await foldRetiredAdvCareers(), 1);
		assert.isTrue(g.get("advCareerFolded"));
		const p2 = (await idb.cache.players.get(4))!;
		assert.deepStrictEqual(p2.advCareer?.rs, expectedRs);
		assert(p2.stats.every((row) => row.adv === undefined));
		assert.strictEqual(await foldRetiredAdvCareers(), 0);

		// Even forced, a second pass doesn't change anything
		g.setWithoutSavingToDB("advCareerFolded", false);
		assert.strictEqual(await foldRetiredAdvCareers(), 0);
		assert.deepStrictEqual(
			(await idb.cache.players.get(4))!.advCareer?.rs,
			expectedRs,
		);
	});

	test("export/import round trip keeps the career total", async () => {
		const p = makePlayer(5);
		await player.retire(p);
		const career = await formatCareer(p);

		// A league file is JSON; importing goes through augmentPartialPlayer
		// eslint-disable-next-line unicorn/prefer-structured-clone -- a league file is JSON
		const fromFile = JSON.parse(JSON.stringify(p));
		const imported = await augmentPartialPlayer(fromFile, 0, undefined);
		assert.deepStrictEqual(imported.advCareer, p.advCareer);
		assert.deepStrictEqual(await formatCareer(imported as Player), career);
	});
});
