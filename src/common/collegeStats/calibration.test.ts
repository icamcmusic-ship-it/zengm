import { assert, describe, test } from "vitest";
import { generateCollegeClass } from "./index.ts";
import { makeClass } from "./career.testutil.ts";
import { isOverseasLeague } from "./overseas.ts";
import { Rng } from "./rng.ts";
import type { CollegeProspect } from "./types.ts";

// Calibration against real Division I numbers (colstats round): level and spread of the draft year line, and that each stat follows the ratings that drive it

const DRAFT_YEAR = 2027;

const withExpanded = (prospects: CollegeProspect[]) => {
	const rng = new Rng("expanded");
	return prospects.map((p) => {
		const r = p.ratings;
		const split = (sd: number) => rng.normal(0, sd);
		const d = split(8);
		const o = split(8);
		const s = split(8);
		return {
			...p,
			ratings: {
				...r,
				wng: Math.max(0, Math.min(100, r.hgt + split(6))),
				pdef: r.diq + d,
				idef: r.diq - d,
				oreb: r.reb + o,
				dreb: r.reb - o,
				csh: (r.fg + r.tp) / 2 + s,
				dsh: (r.fg + r.tp) / 2 - s,
				bsc: (r.drb + r.oiq) / 2 + split(8),
			},
		};
	});
};

const getRows = (prospects: CollegeProspect[], seed: string) => {
	const results = generateCollegeClass(prospects, {
		seed,
		draftYear: DRAFT_YEAR,
	});
	return results.flatMap((result, i) => {
		const season = result.seasons.at(-1);
		if (
			!season ||
			season.season !== DRAFT_YEAR ||
			isOverseasLeague(season.school) ||
			season.gameMinutes !== 40 ||
			season.stats.gp! < 10
		) {
			return [];
		}
		const s = season.stats as Record<string, number>;
		const per40 = (x: number) => (x / s.min!) * 40;
		return [
			{
				p: prospects[i]!,
				mpg: s.min! / s.gp!,
				ppg: s.pts! / s.gp!,
				pts40: per40(s.pts!),
				trb40: per40(s.orb! + s.drb!),
				orbShare: s.orb! / Math.max(1, s.orb! + s.drb!),
				ast40: per40(s.ast!),
				stl40: per40(s.stl!),
				blk40: per40(s.blk!),
				tovPct: s.tov! / Math.max(1, s.fga! + 0.44 * s.fta! + s.tov!),
				tpar: s.tpa! / Math.max(1, s.fga!),
				ftr: s.fta! / Math.max(1, s.fga!),
				s,
			},
		];
	});
};

type Row = ReturnType<typeof getRows>[number];

const corr = (rows: Row[], f: (r: Row) => number, g: (r: Row) => number) => {
	const a = rows.map(f);
	const b = rows.map(g);
	const ma = a.reduce((x, y) => x + y, 0) / a.length;
	const mb = b.reduce((x, y) => x + y, 0) / b.length;
	let c = 0;
	let va = 0;
	let vb = 0;
	for (let i = 0; i < a.length; i++) {
		c += (a[i]! - ma) * (b[i]! - mb);
		va += (a[i]! - ma) ** 2;
		vb += (b[i]! - mb) ** 2;
	}
	return c / Math.sqrt(va * vb);
};

const quantile = (xs: number[], q: number) => {
	const sorted = [...xs].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};

const sum = (rows: Row[], key: string) =>
	rows.reduce((total, row) => total + row.s[key]!, 0);

describe("college stats calibration", () => {
	const rows = getRows(makeClass(400, "calib"), "calib");

	test("minutes and points: rotation players, not a class of 30 minute stars", () => {
		assert.isAbove(rows.length, 200);
		const mpg = rows.map((r) => r.mpg);
		const ppg = rows.map((r) => r.ppg);
		// Real D-I: a typical prospect is a 20-25 minute rotation player scoring 6-12, the best are 30-34 minute, 15-22 point stars
		assert.isAbove(quantile(mpg, 0.5), 19);
		assert.isBelow(quantile(mpg, 0.5), 27);
		assert.isBelow(quantile(mpg, 0.1), 19);
		assert.isBelow(Math.max(...mpg), 37.5);
		assert.isAbove(quantile(ppg, 0.5), 7);
		assert.isBelow(quantile(ppg, 0.5), 13);
		assert.isBelow(quantile(ppg, 0.1), 7.5);
		assert.isAbove(quantile(ppg, 0.9), 14);
		assert.isBelow(quantile(ppg, 0.9), 22);
		assert.isBelow(Math.max(...ppg), 32);
		// Per 40, the level of a D-I rotation (team about 72 points in 200 minutes, so 14-15 per 40 for the average player)
		const pts40 = quantile(
			rows.map((r) => r.pts40),
			0.5,
		);
		assert.isAbove(pts40, 14);
		assert.isBelow(pts40, 22);
	});

	test("shooting splits", () => {
		const fg = sum(rows, "fg") / sum(rows, "fga");
		const tp = sum(rows, "tp") / sum(rows, "tpa");
		const ft = sum(rows, "ft") / sum(rows, "fta");
		const tpar = sum(rows, "tpa") / sum(rows, "fga");
		assert.isAbove(fg, 0.42);
		assert.isBelow(fg, 0.52);
		assert.isAbove(tp, 0.31);
		assert.isBelow(tp, 0.38);
		assert.isAbove(ft, 0.65);
		assert.isBelow(ft, 0.77);
		assert.isAbove(tpar, 0.2);
		assert.isBelow(tpar, 0.45);
		for (const r of rows) {
			const s = r.s;
			assert.isAtMost(s.fg!, s.fga!);
			assert.isAtMost(s.tp!, s.tpa!);
			assert.isAtMost(s.ft!, s.fta!);
			for (const value of Object.values(s)) {
				assert(Number.isFinite(value));
			}
			if (s.tpa! >= 50) {
				// 50 attempts is a small sample: a 45% shooter runs above 52% about one season in eight
				assert.isBelow(s.tp! / s.tpa!, 0.56);
			}
			if (s.fga! >= 100) {
				// A low-volume big who lives at the rim can run hot over a season (his expected FG% is capped near 70%)
				assert.isBelow(s.fg! / s.fga!, 0.8);
			}
		}
	});

	test("rebounds, assists, steals, blocks and turnovers at D-I levels by size", () => {
		const bigs = rows.filter((r) => r.p.ratings.hgt >= 62);
		const guards = rows.filter((r) => r.p.ratings.hgt <= 38);
		const mean = (xs: Row[], f: (r: Row) => number) =>
			xs.reduce((total, r) => total + f(r), 0) / xs.length;
		assert.isAbove(
			mean(bigs, (r) => r.trb40),
			9,
		);
		assert.isBelow(
			mean(bigs, (r) => r.trb40),
			14,
		);
		assert.isAbove(
			mean(guards, (r) => r.trb40),
			3.5,
		);
		assert.isBelow(
			mean(guards, (r) => r.trb40),
			7,
		);
		assert.isAbove(
			mean(bigs, (r) => r.blk40),
			1.5,
		);
		assert.isBelow(
			mean(guards, (r) => r.blk40),
			0.6,
		);
		const stl40 = mean(rows, (r) => r.stl40);
		assert.isAbove(stl40, 1);
		assert.isBelow(stl40, 2);
		const tovPct =
			sum(rows, "tov") /
			(sum(rows, "fga") + 0.44 * sum(rows, "fta") + sum(rows, "tov"));
		assert.isAbove(tovPct, 0.13);
		assert.isBelow(tovPct, 0.2);
	});

	test("each stat follows the ratings that drive it", () => {
		const r = (x: Row) => x.p.ratings;
		const shooters = rows.filter((x) => x.s.tpa! >= 40);
		assert.isAbove(
			corr(
				shooters,
				(x) => x.s.tp! / x.s.tpa!,
				(x) => r(x).tp,
			),
			0.3,
		);
		assert.isAbove(
			corr(
				rows,
				(x) => x.tpar,
				(x) => r(x).tp,
			),
			0.6,
		);
		const ftRows = rows.filter((x) => x.s.fta! >= 40);
		assert.isAbove(
			corr(
				ftRows,
				(x) => x.s.ft! / x.s.fta!,
				(x) => r(x).ft,
			),
			0.5,
		);
		assert.isAbove(
			corr(
				rows,
				(x) => x.ast40,
				(x) => r(x).pss,
			),
			0.6,
		);
		assert.isAbove(
			corr(
				rows,
				(x) => x.trb40,
				(x) => r(x).hgt,
			),
			0.6,
		);
		assert.isAbove(
			corr(
				rows,
				(x) => x.blk40,
				(x) => r(x).hgt,
			),
			0.6,
		);
		assert.isAbove(
			corr(
				rows,
				(x) => x.stl40,
				(x) => r(x).diq,
			),
			0.2,
		);
		assert.isAbove(
			corr(
				rows,
				(x) => x.ftr,
				(x) => r(x).dnk + r(x).ins,
			),
			0.2,
		);
		assert.isAbove(
			corr(
				rows,
				(x) => x.ppg,
				(x) => x.p.ovr,
			),
			0.5,
		);
		assert.isAbove(
			corr(
				rows,
				(x) => x.mpg,
				(x) => x.p.ovr,
			),
			0.5,
		);
		// Non-shooters don't shoot threes
		for (const x of rows.filter((x) => r(x).tp <= 22)) {
			assert.isBelow(x.tpar, 0.06);
		}
	});

	test("expanded ratings move their stats", () => {
		const ex = getRows(withExpanded(makeClass(400, "calib")), "calib");
		const r = (x: Row) => x.p.ratings;
		// Partial effects: compare against the part the base ratings already explain by correlating with the split, which is independent of them
		assert.isAbove(
			corr(
				ex,
				(x) => x.stl40,
				(x) => r(x).pdef! - r(x).idef!,
			),
			0.15,
		);
		assert.isAbove(
			corr(
				ex,
				(x) => x.blk40,
				(x) => r(x).wng! - r(x).hgt,
			),
			0.1,
		);
		assert.isAbove(
			corr(
				ex,
				(x) => x.orbShare,
				(x) => r(x).oreb! - r(x).dreb!,
			),
			0.2,
		);
		assert.isAbove(
			corr(
				ex,
				(x) => x.tpar,
				(x) => r(x).csh! - r(x).dsh!,
			),
			0.1,
		);
		assert.isBelow(
			corr(
				ex,
				(x) => x.tovPct,
				(x) => r(x).bsc! - (r(x).drb + r(x).oiq) / 2,
			),
			-0.1,
		);
	});

	test("freshmen play less than upperclassmen of the same talent", () => {
		const fresh = rows.filter((x) => x.p.age <= 19);
		const old = rows.filter((x) => x.p.age >= 22);
		const resid = (xs: Row[]) =>
			xs.reduce((total, x) => total + x.mpg - 0.9 * (x.p.ovr - 42), 0) /
			xs.length;
		assert.isBelow(resid(fresh), resid(old));
	});
});
