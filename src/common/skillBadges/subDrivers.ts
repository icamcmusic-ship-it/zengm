// Sub-ratings (the subRatings setting) and skill badges: which sub-rating drives a badge, for its tooltip ("Shot blocker — driven by
// Shot Blocking 78"). Display only: badges are still awarded from the base ratings. Shared with the UI, pure.
import {
	SUB_DEFS,
	SUB_INDEX,
	isValidSubArray,
	subsOfBase,
} from "../subRatings.ts";
import { SKILL_BADGES_BY_LABEL } from "./definitions.ts";

// The subs that make a badge, where its ratings composite alone would be too broad (the original skills and the badges whose name says
// which part of a base they're about)
const EXPLICIT: Record<string, string[]> = {
	// Original skills
	"3": ["rng", "tcs", "tod"],
	A: ["sls", "lat", "stj", "mxv"],
	B: ["hnd", "sec", "crt"],
	Di: ["blk", "idf"],
	Dp: ["pdf", "stl", "lat"],
	Po: ["pst", "cls"],
	Ps: ["vis", "acc"],
	R: ["orb", "drd"],
	V: ["crt", "pul", "tod", "con"],
	// Extended badges
	Cs: ["tcs", "rng"],
	Pu: ["tod", "pul", "crt"],
	Mr: ["pul", "spu"],
	Fn: ["con", "fns", "cls"],
	Dk: ["con", "mxv"],
	Bk: ["blk", "stj"],
	St: ["stl"],
	Pa: ["pdf", "lat"],
	Or: ["orb"],
	// Combos with one clear core (other combos are too broad to name one sub)
	Bm: ["orb", "drd"],
	Oc: ["orb"],
	Sw: ["pdf", "lat", "idf"],
	Ex: ["mxv", "sls"],
	Ib: ["pst", "cls", "con"],
	Rp: ["blk", "idf"],
};

const subsOfDef = (label: string): string[] => {
	const explicit = EXPLICIT[label];
	if (explicit) {
		return explicit;
	}
	const badge = SKILL_BADGES_BY_LABEL[label];
	if (badge) {
		// The bases of its main composite that have sub-ratings, by weight
		const main = badge.conditions[0];
		if (!main) {
			return [];
		}
		const out: string[] = [];
		main.ratings.forEach((rating, i) => {
			if (rating !== 50 && (main.weights[i] ?? 0) > 0) {
				for (const { def } of subsOfBase(rating)) {
					out.push(def.key);
				}
			}
		});
		return out;
	}
	return [];
};

const cache = new Map<string, string[]>();
export const badgeSubs = (label: string) => {
	let out = cache.get(label);
	if (!out) {
		out = [...new Set(subsOfDef(label))].filter((k) => k in SUB_INDEX);
		cache.set(label, out);
	}
	return out;
};

// The sub-rating that drives a badge for this player: the best of its subs (as scouted). Undefined without sub-ratings.
export const badgeDriver = (
	label: string,
	sub: unknown,
): { key: string; name: string; value: number } | undefined => {
	if (!isValidSubArray(sub)) {
		return;
	}
	let best: { key: string; name: string; value: number } | undefined;
	for (const key of badgeSubs(label)) {
		const i = SUB_INDEX[key]!;
		const value = sub[i]!;
		if (!best || value > best.value) {
			best = { key, name: SUB_DEFS[i]!.name, value };
		}
	}
	return best;
};

export const badgeDriverText = (label: string, sub: unknown) => {
	const d = badgeDriver(label, sub);
	return d ? `driven by ${d.name} ${d.value}` : undefined;
};
