// Family heredity (basketball): a player generated as the son or brother of an existing player takes after him in size (height, length,
// weight for his height), athleticism (speed, jumping, endurance), a few trait seeds and, for players generated with prospect variety, his shooting and skill
// tendencies (how much they stand out from the rest of his game; his ovr kept). Each one is a correlated blend around the
// league mean: new = mean + h * (relative - mean) + sqrt(1 - h^2) * (own - mean), so a son of a 7-footer is tall but regresses toward
// the mean, the spread of the league's players stays what it was, and every shift is bounded. No random numbers are drawn.

import { seedKey } from "../../../common/playerTraits/seeds.ts";
import type { TraitKey } from "../../../common/playerTraits/types.ts";
import type { Player } from "../../../common/types.ts";
import { g, helpers } from "../../util/index.ts";
import { BASKETBALL_WEIGHT } from "./genWeight.ts";
import limitRating from "./limitRating.ts";
import { getTraitSeeds, traitsEnabled } from "./traits.ts";
import { HEREDITY_SKILL } from "../../../common/prospectVariety.ts";
import { reshapeKeepingOvr, SKILL_KEYS } from "./prospectVariety.ts";

export const HEREDITY = {
	// Correlation with the relative (father-son and brother-brother height correlation is about 0.5 in people; athleticism and temperament
	// less)
	h: {
		father: {
			size: 0.45,
			length: 0.4,
			weight: 0.35,
			athleticism: 0.3,
			trait: 0.3,
		},
		brother: {
			size: 0.4,
			length: 0.35,
			weight: 0.3,
			athleticism: 0.3,
			trait: 0.3,
		},
	},
	// League means the blend regresses toward (raw generated height in inches, before heightFactor; prospect ratings)
	meanHeight: 78.9,
	athleticismMean: { spd: 51, jmp: 51, endu: 23 } as Record<string, number>,
	// Bounds on each shift
	maxHeightShift: 4,
	maxLengthShift: 8,
	maxWeightShift: 20,
	maxAthleticismShift: 8,
	maxTraitShift: 1.5,
	// Above this age a relative's earliest row says little about his endurance as a prospect (it grows with age), so it is not inherited
	enduMaxAge: 23,
	// Trait seeds that run in families (temperament and physical makeup)
	traits: [
		"workEthic",
		"competitiveness",
		"motor",
		"durability",
		"temper",
	] as TraitKey[],
};

type Kind = keyof typeof HEREDITY.h;

// Tendencies: a group's mean rating minus the mean of all 14 skill ratings, and its average among prospects (what the blend regresses to)
const HEREDITY_TENDENCY_KEYS: Record<string, string[]> = {
	shooting: ["ft", "fg", "tp"],
	skill: ["drb", "pss", "oiq"],
};
const HEREDITY_TENDENCY_MEAN: Record<string, number> = {
	shooting: 1,
	skill: -1.5,
};
const tendency = (r: any, keys: string[]) => {
	if (!r) {
		return Number.NaN;
	}
	let all = 0;
	for (const key of SKILL_KEYS) {
		all += r[key];
	}
	let group = 0;
	for (const key of keys) {
		group += r[key];
	}
	return group / keys.length - all / SKILL_KEYS.length;
};

const blend = (
	own: number,
	rel: number,
	mean: number,
	h: number,
	maxShift: number,
) => {
	const target = mean + h * (rel - mean) + Math.sqrt(1 - h * h) * (own - mean);
	return own + helpers.bound(target - own, -maxShift, maxShift);
};

// The relative's ratings row closest in age to the player's
const closestRow = (rel: Player, age: number) => {
	let best = rel.ratings[0];
	let bestDiff = Infinity;
	for (const r of rel.ratings) {
		const diff = Math.abs(r.season - rel.born.year - age);
		if (diff < bestDiff) {
			best = r;
			bestDiff = diff;
		}
	}
	return { row: best as any, age: best.season - rel.born.year };
};

// Only a freshly generated player (one ratings row, not real, not locked) is changed. Returns true if anything changed; the caller
// recomputes ovr/pot/pos (develop with 0 years) and value.
export const inheritFromRelative = (
	p: Player,
	rel: Player,
	kind: Kind,
): boolean => {
	if (__SPORT !== "basketball" || p.real || p.ratings.length !== 1) {
		return false;
	}
	const r = p.ratings[0] as any;
	if (r.locked) {
		return false;
	}
	const H = HEREDITY.h[kind];
	const relLast = rel.ratings.at(-1) as any;

	// Size: height in inches (listed heights carry the league's height factors, so compare in raw inches)
	const female = g.get("gender") === "female";
	const hf = g.get("heightFactor") * (female ? 0.92 : 1);
	const ownIn = p.hgt / hf;
	const relIn = rel.hgt / hf;
	const newIn = blend(
		ownIn,
		relIn,
		HEREDITY.meanHeight,
		H.size,
		HEREDITY.maxHeightShift,
	);
	const deltaIn = Math.round(newIn) - Math.round(ownIn);
	if (deltaIn !== 0) {
		p.hgt = Math.round(newIn * hf);
		const hgtBefore = r.hgt;
		r.hgt = limitRating(r.hgt + Math.round((deltaIn * 100) / 27));
		if (typeof r.wng === "number") {
			r.wng = limitRating(r.wng + (r.hgt - hgtBefore));
		}
	}

	// Length: the wingspan rating's gap to height (expanded ratings)
	if (typeof r.wng === "number" && typeof relLast?.wng === "number") {
		const gap = r.wng - r.hgt;
		const newGap = blend(
			gap,
			relLast.wng - relLast.hgt,
			0,
			H.length,
			HEREDITY.maxLengthShift,
		);
		r.wng = limitRating(Math.round(r.hgt + newGap));
	}

	// Weight for his height (his new height moves his weight with it)
	const W = BASKETBALL_WEIGHT;
	const wf = g.get("weightFactor") * (female ? 0.75 : 1);
	const resid = (weight: number, inches: number) =>
		weight / wf - (W.intercept + W.perInch * (inches - W.refHeight));
	const ownResid = resid(p.weight, ownIn);
	const newResid = blend(
		ownResid,
		resid(rel.weight, relIn),
		0,
		H.weight,
		HEREDITY.maxWeightShift,
	);
	p.weight = Math.round(
		p.weight + wf * (W.perInch * deltaIn + newResid - ownResid),
	);

	// Athleticism, against the relative at about the same age
	const age = r.season - p.born.year;
	const { row: relRow, age: relAge } = closestRow(rel, age);
	for (const key of ["spd", "jmp", "endu"]) {
		if (key === "endu" && relAge > HEREDITY.enduMaxAge) {
			continue;
		}
		if (typeof relRow?.[key] !== "number") {
			continue;
		}
		r[key] = limitRating(
			Math.round(
				blend(
					r[key],
					relRow[key],
					HEREDITY.athleticismMean[key]!,
					H.athleticism,
					HEREDITY.maxAthleticismShift,
				),
			),
		);
	}

	// Shooting and skill tendencies (prospect variety, only for players generated with it): how much his shooting and his skill (handle,
	// passing, IQ) stand out from the rest of his game, blended with the relative's at about the same age, his ovr kept
	if (p.genVar) {
		const deltas: Record<string, number> = {};
		for (const [group, keys] of Object.entries(HEREDITY_TENDENCY_KEYS)) {
			const own = tendency(r, keys);
			const relT = tendency(relRow, keys);
			if (!Number.isFinite(own) || !Number.isFinite(relT)) {
				continue;
			}
			const mean = HEREDITY_TENDENCY_MEAN[group]!;
			const shift = Math.round(
				blend(own, relT, mean, HEREDITY_SKILL.h, HEREDITY_SKILL.maxShift) - own,
			);
			if (shift !== 0) {
				for (const key of keys) {
					deltas[key] = (deltas[key] ?? 0) + shift;
				}
			}
		}
		if (Object.keys(deltas).length > 0) {
			reshapeKeepingOvr(r, deltas);
		}
	}

	// Trait seeds (only stored with the Player Traits setting on; with it off they are derived later from the pid, as for anyone)
	if (traitsEnabled() && typeof p.pid === "number") {
		const own = getTraitSeeds(p as any) as Record<string, number>;
		const relSeeds = getTraitSeeds(rel as any) as Record<string, number>;
		const next: Record<string, number> = { ...own };
		for (const key of HEREDITY.traits) {
			const k = seedKey(key);
			if (typeof own[k] === "number" && typeof relSeeds[k] === "number") {
				next[k] =
					Math.round(
						blend(own[k], relSeeds[k], 0, H.trait, HEREDITY.maxTraitShift) *
							100,
					) / 100;
			}
		}
		p.traits = next as any;
	}

	return true;
};
