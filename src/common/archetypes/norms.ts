import {
	DIMS,
	STYLE_DIMS,
	compositeValues,
	hasExpanded,
} from "./composites.ts";
import type { ArchetypeRatings, DimKey, Norms } from "./types.ts";

// The dimensions whose mean is "how good is he, period", used to read shape instead of level
export const CORE_DIMS: DimKey[] = [
	"usg",
	"drb",
	"pss",
	"rim",
	"post",
	"mid",
	"three",
	"ft",
	"reb",
	"dint",
	"dper",
	"blk",
	"ath",
	"end",
	"stl",
	"draw",
];

// Inverse of the standard normal CDF (Acklam's approximation)
export const probit = (p: number) => {
	const a = [
		-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
		1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
	];
	const b = [
		-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
		6.680131188771972e1, -1.328068155288572e1,
	];
	const c = [
		-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
		-2.549732539343734, 4.374664141464968, 2.938163982698783,
	];
	const d = [
		7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
		3.754408661907416,
	];
	const lo = 0.02425;
	if (p < lo) {
		const q = Math.sqrt(-2 * Math.log(p));
		return (
			(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
				c[5]!) /
			((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
		);
	}
	if (p > 1 - lo) {
		const q = Math.sqrt(-2 * Math.log(1 - p));
		return (
			-(
				((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
				c[5]!
			) /
			((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
		);
	}
	const q = p - 0.5;
	const r = q * q;
	return (
		((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r +
			a[5]!) *
			q) /
		(((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
	);
};

export const quantiles = (values: number[], n = 101) => {
	const sorted = [...values].sort((x, y) => x - y);
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const pos = (i / (n - 1)) * (sorted.length - 1);
		const lo = Math.floor(pos);
		const hi = Math.ceil(pos);
		out.push(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
	}
	return out;
};

// Fraction of the reference league at or below v, 0..1, with mid-rank handling of ties
export const percentile = (q: number[], v: number) => {
	const n = q.length - 1;
	if (v <= q[0]!) {
		return v < q[0]! ? 0 : countTies(q, v, n);
	}
	if (v >= q[n]!) {
		return v > q[n]! ? 1 : countTies(q, v, n);
	}
	let lo = 0;
	let hi = n;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (q[mid]! <= v) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	if (q[lo]! === v) {
		return countTies(q, v, n);
	}
	return (lo + (v - q[lo]!) / (q[hi]! - q[lo]!)) / n;
};

const countTies = (q: number[], v: number, n: number) => {
	let first = -1;
	let last = -1;
	for (let i = 0; i <= n; i++) {
		if (q[i] === v) {
			if (first < 0) {
				first = i;
			}
			last = i;
		}
	}
	return (first + last) / 2 / n;
};

const P_MIN = 0.004;
const clampZ = (z: number) => Math.min(2.65, Math.max(-2.65, z));

export const rawZ = (q: number[], v: number) =>
	clampZ(probit(Math.min(1 - P_MIN, Math.max(P_MIN, percentile(q, v)))));

// A reference league's quantiles. `rows` are the ratings (and ovr) of its players.
export const buildBaseNorms = (
	rows: { ratings: ArchetypeRatings; ovr?: number }[],
): Omit<Norms, "match"> => {
	const vals = rows.map((r) => compositeValues(r.ratings));
	const q = {} as Norms["q"];
	for (const dim of DIMS) {
		q[dim] = quantiles(vals.map((v) => v[dim]));
	}
	// Correlation of each dimension's z with height's z
	const zs = vals.map((v) => {
		const z = {} as Record<DimKey, number>;
		for (const dim of DIMS) {
			z[dim] = rawZ(q[dim], v[dim]);
		}
		return z;
	});
	const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
	const hz = zs.map((z) => z.hgt);
	const hm = mean(hz);
	const hs = Math.sqrt(mean(hz.map((x) => (x - hm) ** 2))) || 1;
	const beta = {} as Norms["beta"];
	for (const dim of DIMS) {
		// Length is a body measurement like height: read as is
		if (dim === "hgt" || STYLE_DIMS.has(dim)) {
			beta[dim] = 0;
			continue;
		}
		const xz = zs.map((z) => z[dim]);
		const xm = mean(xz);
		const xs = Math.sqrt(mean(xz.map((x) => (x - xm) ** 2))) || 1;
		const cov = mean(xz.map((x, i) => (x - xm) * (hz[i]! - hm)));
		beta[dim] = Math.round((cov / (xs * hs)) * 1000) / 1000;
	}
	const ovrs = rows
		.map((r) => r.ovr)
		.filter((x): x is number => x !== undefined);
	return {
		q,
		beta,
		ovr: ovrs.length > 0 ? quantiles(ovrs) : [],
	};
};

const SHRINK_FLOOR = 0.55;

// z-scores for one player: each dimension "for his size" (height's part removed) and relative to HIS OWN level (the mean
// of his core skills is taken out in full), so the reading is the shape of his game, whatever his overall: a 45 and an 80
// whose ratings have the same shape read the same. `abs` (league-wide) and `sz` (for his size) are relative to his own
// level too. Height (and the style dimensions) stay as they are.
export const zVector = (r: ArchetypeRatings, norms: Norms) => {
	const v = compositeValues(r);
	const z = {} as Record<DimKey, number>;
	// Absolute (league-wide) z, and z for his size before his level is taken out
	const abs = {} as Record<DimKey, number>;
	const sz = {} as Record<DimKey, number>;
	const hz = rawZ(norms.q.hgt, v.hgt);
	const expanded = hasExpanded(r);
	for (const dim of DIMS) {
		// Perimeter and interior defense are his defensive IQ when he has no expanded ratings (or the norms do not know them)
		const src =
			(dim === "pdef" || dim === "idef") && (!expanded || !norms.q[dim])
				? "diq"
				: dim;
		if (STYLE_DIMS.has(dim) && (!expanded || !norms.q[dim])) {
			abs[dim] = 0;
			z[dim] = 0;
			sz[dim] = 0;
			continue;
		}
		const raw = rawZ(norms.q[src], v[src]);
		abs[dim] = raw;
		if (dim === "hgt" || STYLE_DIMS.has(dim)) {
			z[dim] = raw;
			sz[dim] = raw;
			continue;
		}
		const b = norms.beta[src];
		const adj = (raw - b * hz) / Math.max(Math.sqrt(1 - b * b), SHRINK_FLOOR);
		z[dim] = clampZ(adj);
		sz[dim] = z[dim];
	}
	// His overall level is read at an ordinary wingspan for his height: length is a body measurement (often only estimated,
	// for real or older players), not how good he is, so it must not move him across a level gate (star, raw prospect)
	const v0 =
		expanded && r.wng !== r.hgt ? compositeValues({ ...r, wng: r.hgt }) : v;
	let level = 0;
	for (const dim of CORE_DIMS) {
		if (v0 === v) {
			level += z[dim];
			continue;
		}
		const b = norms.beta[dim];
		level += clampZ(
			(rawZ(norms.q[dim], v0[dim]) - b * hz) /
				Math.max(Math.sqrt(1 - b * b), SHRINK_FLOOR),
		);
	}
	level /= CORE_DIMS.length;
	let absLevel = 0;
	for (const dim of CORE_DIMS) {
		absLevel += abs[dim];
	}
	absLevel /= CORE_DIMS.length;
	for (const dim of DIMS) {
		if (dim !== "hgt" && !STYLE_DIMS.has(dim)) {
			z[dim] = clampZ(z[dim] - level);
			sz[dim] = z[dim];
			abs[dim] = clampZ(abs[dim] - absLevel);
		}
	}
	return { z, level, hgtZ: hz, abs, sz, expanded };
};

export const ovrPercentile = (norms: Norms, ovr: number) =>
	norms.ovr.length > 0 ? percentile(norms.ovr, ovr) : 0.5;
