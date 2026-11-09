import { DIMS, skillsOf } from "./composites.ts";
import { zVector } from "./norms.ts";
import type {
	Archetype,
	ArchetypeRatings,
	DimKey,
	Norms,
	SkillLabel,
} from "./types.ts";

// Profile weights are in units of 0.55 standard deviations
const TARGET_SCALE = 0.55;
// Dimensions an archetype does not mention are expected to be ordinary, with this much weight
const BASE_IMPORTANCE = 0.3;
const HGT_SOFT = 5;
const MISSING_REQ = 0.6;
const BONUS = 0.04;
const OVERSHOOT = 0.3;
// Size-driven skills are read partly in absolute terms: a seven-footer who blocks everything is a rim protector even if
// every seven-footer blocks shots
const ABS_MIX: Partial<Record<DimKey, number>> = {
	blk: 0.4,
	dint: 0.4,
	reb: 0.3,
	rim: 0.25,
	post: 0.25,
};

export const gateFactor = (
	hgt: number,
	[lo, hi]: [number, number],
	soft = HGT_SOFT,
) => {
	const d = hgt < lo ? lo - hgt : hgt > hi ? hgt - hi : 0;
	return Math.exp(-((d / soft) ** 2));
};

// Level gate (his overall level, the mean of his size-adjusted skills, in z): softer than the height gate
const LEVEL_SOFT = 0.3;
// Outside the level gate the fit z is cut too (a table can be mostly near zero, which would read a miss as ordinary)
// A level gate below the league's (raw prospects, journeymen), as opposed to a star's gate above it
export const isLowLevel = (a: Archetype) =>
	a.level !== undefined && a.level[1] <= 0;

export const levelPenalty = (a: Archetype, level: number) =>
	a.level ? 3 * (1 - gateFactor(level, a.level, LEVEL_SOFT)) : 0;

// A label's defining skills must actually be there, not just be his relative best. Every dimension an archetype weights at
// NEED_W or more is defining: he must be at least ordinary at it for his size (sz) and above his own norm (z), and the
// explicit `need` floors are on the league-wide (absolute) z. Each z of shortfall costs NEED_K in fit z, plus NEED_STEP once.
export const NEED_W = 2;
export const NEED_K = 4;
export const NEED_STEP = 0.1;
// Dimensions whose weight describes a style, not a skill, so they are never gates
const NOT_A_SKILL = new Set<DimKey>(["usg", "end", "hgt"]);

export type Prepared = {
	z: Record<DimKey, number>;
	sz: Record<DimKey, number>;
	abs: Record<DimKey, number>;
	level: number;
	skills: SkillLabel[];
	hgt: number;
};

// A player well below the league's level (a prospect) is held to lower absolute floors: a promising shooter for a 19 year
// old is still a shooter
const LEVEL_SLACK = 0.5;
const LEVEL_SLACK_FROM = -0.6;

export const needShortfall = (a: Archetype, p: Prepared) => {
	let short = 0;
	const slack = isLowLevel(a)
		? 0
		: LEVEL_SLACK * Math.max(0, LEVEL_SLACK_FROM - p.level);
	for (const dim of DIMS) {
		const w = a.w[dim];
		if (w === undefined || w < NEED_W || NOT_A_SKILL.has(dim)) {
			continue;
		}
		short += Math.max(0, 0.1 * w - 0.1 - p.z[dim]);
		// A raw prospect is read against himself only: his skills are not there yet in league terms
		if (!isLowLevel(a)) {
			short += Math.max(0, 0.1 * (w - 2) - 0.05 - slack - p.sz[dim]);
		}
	}
	for (const [dim, floor] of Object.entries(a.need ?? {}) as [
		DimKey,
		number,
	][]) {
		short += Math.max(0, floor - slack - p.abs[dim]);
	}
	for (const [dim, floor] of Object.entries(a.needFor ?? {}) as [
		DimKey,
		number,
	][]) {
		short += Math.max(0, floor - slack - p.sz[dim]);
	}
	return short;
};

export const needPenalty = (a: Archetype, p: Prepared) => {
	const s = needShortfall(a, p);
	return s > 0.02 ? NEED_STEP + NEED_K * s : NEED_K * s;
};

// How well one player's ratings fit one archetype's profile, 0..1. Absolute: not yet read against the league.
export const rawMatch = (
	a: Archetype,
	z: Record<DimKey, number>,
	hgt: number,
	skills: SkillLabel[],
	level = 0,
) => {
	let num = 0;
	let den = 0;
	for (const dim of DIMS) {
		const w = a.w[dim];
		// Height is a gate, it only counts when the archetype names it
		if (dim === "hgt" && w === undefined) {
			continue;
		}
		const imp = BASE_IMPORTANCE + Math.abs(w ?? 0);
		const target = (w ?? 0) * TARGET_SCALE;
		// Being even better than the profile asks at a skill it wants (or even lower where it wants low) costs little: an
		// elite shooter is still a shooter
		const over = w !== undefined && w !== 0 && (z[dim] - target) * w > 0;
		num += imp * (over ? OVERSHOOT : 1) * (z[dim] - target) ** 2;
		den += imp;
	}
	let score = (1 / (1 + num / den)) * gateFactor(hgt, a.hgt);
	if (a.level) {
		score *= gateFactor(level, a.level, LEVEL_SOFT);
	}
	for (const s of a.req ?? []) {
		if (!skills.includes(s)) {
			score *= MISSING_REQ;
		}
	}
	for (const s of a.bonus ?? []) {
		if (skills.includes(s)) {
			score *= 1 + BONUS;
		}
	}
	return score;
};

export const prepare = (ratings: ArchetypeRatings, norms: Norms): Prepared => {
	const v = zVector(ratings, norms);
	const z = { ...v.z };
	for (const [dim, m] of Object.entries(ABS_MIX) as [DimKey, number][]) {
		z[dim] += m * (v.abs[dim] - v.sz[dim]);
	}
	return {
		z,
		sz: v.sz,
		abs: v.abs,
		level: v.level,
		skills: skillsOf(ratings),
		hgt: ratings.hgt,
	};
};
