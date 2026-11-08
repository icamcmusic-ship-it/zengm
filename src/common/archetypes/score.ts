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

export const gateFactor = (hgt: number, [lo, hi]: [number, number]) => {
	const d = hgt < lo ? lo - hgt : hgt > hi ? hgt - hi : 0;
	return Math.exp(-((d / HGT_SOFT) ** 2));
};

// How well one player's ratings fit one archetype's profile, 0..1. Absolute: not yet read against the league.
export const rawMatch = (
	a: Archetype,
	z: Record<DimKey, number>,
	hgt: number,
	skills: SkillLabel[],
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
		num += imp * (z[dim] - (w ?? 0) * TARGET_SCALE) ** 2;
		den += imp;
	}
	let score = (1 / (1 + num / den)) * gateFactor(hgt, a.hgt);
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

export const prepare = (ratings: ArchetypeRatings, norms: Norms) => ({
	z: zVector(ratings, norms).z,
	skills: skillsOf(ratings),
	hgt: ratings.hgt,
});
