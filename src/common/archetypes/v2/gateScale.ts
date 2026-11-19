// archreview: the absolute gates (tests.ts ABS_GATES) are on the scale of a random-players league, where the user's
// review fitted them. A league whose ratings sit on another scale (real players: Chris Paul 2025 passes at 58, Giannis
// at 54) reads each cutoff as the same standing among its own players: the cutoff's percentile among the reference
// league's players (gateScale.data.ts, a new random league's players on rosters and in free agency, made by
// gateScale.script.test.ts) is mapped to the rating at that percentile among the league's own players (Norms.rq, built
// with the league's norms). In a random league the two tables are about the same, so the cutoffs are the user's.
import type { ArchetypeRatings } from "../types.ts";
import { GATE_REF } from "./gateScale.data.ts";

export const GATE_SCALE_KEYS = [
	"tp",
	"fg",
	"ins",
	"dnk",
	"spd",
	"jmp",
	"stre",
	"pss",
	"drb",
	"reb",
	"oiq",
	"diq",
	"pdef",
	"idef",
	"hgt",
	"fin",
	"best",
	"ath",
	"ovr",
] as const;
export type GateScaleKey = (typeof GATE_SCALE_KEYS)[number];
export type RatingQuantiles = Partial<Record<GateScaleKey, number[]>>;

// 41 points, 0%..100%
export const RQ_POINTS = 41;

export const gateScaleValue = (
	r: ArchetypeRatings,
	k: GateScaleKey,
	ovr?: number,
): number | undefined => {
	switch (k) {
		case "fin":
			return Math.max(r.ins ?? 0, r.dnk ?? 0);
		case "best":
			return Math.max(r.tp ?? 0, r.fg ?? 0, r.ins ?? 0, r.dnk ?? 0);
		case "ath":
			return Math.max(r.spd ?? 0, r.jmp ?? 0);
		case "ovr":
			return ovr;
		default: {
			const v = r[k];
			return typeof v === "number" ? v : undefined;
		}
	}
};

// The quantiles of each gate key among some players (ratings with their ovr)
export const ratingQuantiles = (
	rows: readonly { ratings: ArchetypeRatings; ovr?: number }[],
): RatingQuantiles => {
	const out: RatingQuantiles = {};
	for (const k of GATE_SCALE_KEYS) {
		const v = rows
			.map((x) => gateScaleValue(x.ratings, k, x.ovr))
			.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
			.sort((a, b) => a - b);
		if (v.length < 50) {
			continue;
		}
		out[k] = Array.from({ length: RQ_POINTS }, (_, i) => {
			const pos = (i / (RQ_POINTS - 1)) * (v.length - 1);
			const lo = Math.floor(pos);
			const hi = Math.min(v.length - 1, lo + 1);
			return Math.round((v[lo]! + (v[hi]! - v[lo]!) * (pos - lo)) * 10) / 10;
		});
	}
	return out;
};

// Where x sits in q (0..1), linear between the points
const percentileIn = (q: readonly number[], x: number) => {
	if (x <= q[0]!) {
		return 0;
	}
	if (x >= q.at(-1)!) {
		return 1;
	}
	for (let i = 1; i < q.length; i++) {
		if (x <= q[i]!) {
			const span = q[i]! - q[i - 1]!;
			return (i - 1 + (span > 0 ? (x - q[i - 1]!) / span : 1)) / (q.length - 1);
		}
	}
	return 1;
};
const valueAt = (q: readonly number[], p: number) => {
	const pos = p * (q.length - 1);
	const lo = Math.floor(pos);
	const hi = Math.min(q.length - 1, lo + 1);
	return q[lo]! + (q[hi]! - q[lo]!) * (pos - lo);
};

// A cutoff on the reference scale, as the league reads it (the cutoff itself without the league's table)
export const scaleCutoff = (
	cutoff: number,
	k: GateScaleKey,
	rq: RatingQuantiles | undefined,
): number => {
	const ref = GATE_REF[k];
	const own = rq?.[k];
	if (!ref || !own) {
		return cutoff;
	}
	return valueAt(own, percentileIn(ref, cutoff));
};
