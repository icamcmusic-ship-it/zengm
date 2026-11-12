// Box-score stats in the archetype reading: a player with real minutes is read partly from what he actually did (his shot
// profile, assist, rebound, block, steal and usage rates), not only from his ratings. Draft prospects and players without
// minutes are read from their ratings alone.
import { POS_BUCKET, quantiles, rawZ } from "./norms.ts";
import { DEFAULT_STAT_NORMS } from "./statNorms.data.ts";
import type {
	ArchetypeStats,
	DimKey,
	Pos,
	StatKey,
	StatNorms,
} from "./types.ts";

// Share of the reading that comes from stats at STATS_FULL_MIN minutes or more (less below, none without minutes)
export const STATS_W = 0.3;
export const STATS_FULL_MIN = 1000;
export const SCORER_K = 0.3;
const SCORER_POS = new Set<Pos>(["G", "SG", "GF"]);
// Fewer minutes than this: too few to say anything
const STATS_MIN_MIN = 100;

// The dimension each stat feature speaks to
export const STAT_DIM: Record<StatKey, DimKey> = {
	tpar: "three",
	tp36: "three",
	ftr: "draw",
	rimr: "fin",
	postr: "post",
	midr: "mid",
	astp: "pss",
	trbp: "reb",
	blkp: "blk",
	stlp: "stl",
	dbpm: "diq",
	usgp: "usg",
};

// A player's season as rates: 3PA and FTA per FGA, the share of his shots at the rim, in the post and from mid-range (when the
// games recorded shot zones), and his assist, rebound, block, steal and usage percentages
export const statFeatures = (
	s: ArchetypeStats,
): Partial<Record<StatKey, number>> => {
	const out: Partial<Record<StatKey, number>> = {
		astp: s.astp,
		trbp: (s.orbp + s.drbp) / 2,
		blkp: s.blkp,
		stlp: s.stlp,
		usgp: s.usgp,
		dbpm: s.dbpm,
	};
	if (s.fga > 0) {
		// (unknown before the three-point line, or in a file without it)
		if (Number.isFinite(s.tpa)) {
			out.tpar = s.tpa / s.fga;
			// (and how many he takes: a point guard who lets it fly is a shooter even if every point guard shoots threes)
			out.tp36 = (36 * s.tpa) / s.min;
		}
		out.ftr = s.fta / s.fga;
		const zones =
			(s.fgaAtRim ?? 0) + (s.fgaLowPost ?? 0) + (s.fgaMidRange ?? 0);
		if (zones > 0) {
			out.rimr = (s.fgaAtRim ?? 0) / s.fga;
			out.postr = (s.fgaLowPost ?? 0) / s.fga;
			out.midr = (s.fgaMidRange ?? 0) / s.fga;
		}
	}
	return out;
};

export type StatReading = {
	// Share of the reading from stats, 0..STATS_W
	w: number;
	// Per dimension: his standing at his position (z) on the stat that speaks to it
	z: Partial<Record<DimKey, number>>;
};

export const statsWeight = (min: number) =>
	min < STATS_MIN_MIN ? 0 : STATS_W * Math.min(1, min / STATS_FULL_MIN);

// His stats as z at his position. `drb` (creating his own shot) reads usage and assists together: a high-usage,
// high-assist player has the ball in his hands, a low-usage, low-assist one plays off the ball.
export const statReading = (
	s: ArchetypeStats | undefined,
	pos: Pos,
	norms: StatNorms = DEFAULT_STAT_NORMS,
): StatReading | undefined => {
	if (!s) {
		return undefined;
	}
	const w = statsWeight(s.min);
	if (w <= 0) {
		return undefined;
	}
	const table = norms[POS_BUCKET[pos]];
	const f = statFeatures(s);
	const z: Partial<Record<DimKey, number>> = {};
	const n: Partial<Record<DimKey, number>> = {};
	for (const [k, v] of Object.entries(f) as [StatKey, number][]) {
		const q = table?.[k];
		if (q && Number.isFinite(v)) {
			// (two features for one dimension, the three: their mean)
			const d = STAT_DIM[k];
			z[d] = ((z[d] ?? 0) * (n[d] ?? 0) + rawZ(q, v)) / ((n[d] ?? 0) + 1);
			n[d] = (n[d] ?? 0) + 1;
		}
	}
	if (z.usg !== undefined && z.pss !== undefined) {
		z.drb = (z.usg + z.pss) / 2;
		// arch13: a scoring guard's assists. An off guard or wing with a high usage racks up assists because the ball is in
		// his hands: his assist rate says he is a playmaker only as far as it keeps up with his usage, so passing reads
		// SCORER_K per z of usage above his assist rate lower (Kobe Bryant and Ray Allen are scorers, not point guards, for
		// their assists). A point guard's assists are his job, and a big's are read as they are.
		if (SCORER_POS.has(pos)) {
			z.pss -= SCORER_K * Math.max(0, z.usg - z.pss);
		}
	}
	return Object.keys(z).length > 0 ? { w, z } : undefined;
};

// Sum a season's rows (one per team when he was traded) into one; rates weighted by minutes. Regular season only.
export const seasonStats = (
	rows: Partial<Record<keyof ArchetypeStats, number>>[],
): ArchetypeStats | undefined => {
	let min = 0;
	const out: ArchetypeStats = {
		min: 0,
		fga: 0,
		tpa: 0,
		fta: 0,
		fgaAtRim: 0,
		fgaLowPost: 0,
		fgaMidRange: 0,
		astp: 0,
		orbp: 0,
		drbp: 0,
		blkp: 0,
		stlp: 0,
		usgp: 0,
		dbpm: 0,
	};
	// Minutes behind each rate (old seasons, or a custom file, may not have them all: a missing rate is unknown, not zero)
	const rateMin: Record<string, number> = {};
	for (const r of rows) {
		const m = r.min ?? 0;
		if (!(m > 0)) {
			continue;
		}
		min += m;
		for (const k of [
			"fga",
			"tpa",
			"fta",
			"fgaAtRim",
			"fgaLowPost",
			"fgaMidRange",
		] as const) {
			out[k] = (out[k] ?? 0) + (r[k] ?? 0);
		}
		for (const k of [
			"astp",
			"orbp",
			"drbp",
			"blkp",
			"stlp",
			"usgp",
			"dbpm",
		] as const) {
			const v = r[k];
			if (typeof v === "number" && Number.isFinite(v)) {
				out[k] += m * v;
				rateMin[k] = (rateMin[k] ?? 0) + m;
			}
		}
	}
	if (min <= 0) {
		return undefined;
	}
	if (!rows.some((r) => typeof r.tpa === "number" && (r.min ?? 0) > 0)) {
		out.tpa = Number.NaN;
	}
	out.min = min;
	for (const k of [
		"astp",
		"orbp",
		"drbp",
		"blkp",
		"stlp",
		"usgp",
		"dbpm",
	] as const) {
		out[k] = rateMin[k] ? out[k]! / rateMin[k] : Number.NaN;
	}
	return out;
};

// Stat references from a league's players with real minutes (at least `minMin` in the season), by position bucket
export const buildStatNorms = (
	rows: { stats: ArchetypeStats; pos: Pos }[],
	minMin = 500,
): StatNorms => {
	const by: Record<string, Partial<Record<StatKey, number[]>>> = {};
	for (const { stats, pos } of rows) {
		if (stats.min < minMin) {
			continue;
		}
		const b = (by[POS_BUCKET[pos]] ??= {});
		for (const [k, v] of Object.entries(statFeatures(stats)) as [
			StatKey,
			number,
		][]) {
			if (Number.isFinite(v)) {
				(b[k] ??= []).push(v);
			}
		}
	}
	const out = {} as StatNorms;
	for (const [b, feats] of Object.entries(by)) {
		const t: Partial<Record<StatKey, number[]>> = {};
		for (const [k, vals] of Object.entries(feats) as [StatKey, number[]][]) {
			if (vals.length >= 30) {
				t[k] = quantiles(vals, 21).map((x) => Math.round(x * 10000) / 10000);
			}
		}
		out[b as keyof StatNorms] = t;
	}
	return out;
};
