import {
	BADGE_GROUP_NAMES,
	SKILL_BADGES,
	SKILL_BADGES_BY_LABEL,
	type BadgeComposite,
	type BadgeCondition,
	type BadgeRatings,
	type BadgeRatingKey,
	type SkillBadgeDef,
} from "./definitions.ts";

export const BADGE_RATING_KEYS: BadgeRatingKey[] = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
];

const bound = (x: number) => Math.min(1, Math.max(0, x));

// Same maths as worker compositeRating (without fuzz), but free of worker imports so the sim, worker and UI can all use it.
export const badgeComposite = (
	ratings: BadgeRatings,
	{ ratings: components, weights }: BadgeComposite,
) => {
	let numerator = 0;
	let denominator = 0;
	for (const [i, component] of components.entries()) {
		const factor = component === 50 ? 50 : ratings[component];
		const weight = weights[i] ?? 1;
		numerator += factor * weight;
		denominator += 100 * weight;
	}
	return bound(numerator / denominator);
};

export const conditionMet = (
	ratings: BadgeRatings,
	condition: BadgeCondition,
) => {
	const value = badgeComposite(ratings, condition);
	return condition.dir === "below"
		? value <= condition.cutoff
		: value >= condition.cutoff;
};

export const hasBadge = (ratings: BadgeRatings, def: SkillBadgeDef) =>
	def.conditions.every((cond) => conditionMet(ratings, cond));

// The main composite of a badge (0-1), used to rank leaders. For flags, higher is "more of a problem".
export const badgeScore = (ratings: BadgeRatings, def: SkillBadgeDef) => {
	const cond = def.conditions[0]!;
	const value = badgeComposite(ratings, cond);
	return cond.dir === "below" ? 1 - value : value;
};

const compute = (ratings: BadgeRatings) => {
	const out: string[] = [];
	for (const def of SKILL_BADGES) {
		if (hasBadge(ratings, def)) {
			out.push(def.label);
		}
	}
	return out;
};

// Memoized by the 15 rating values, so identical rows (and repeated renders) cost one Map lookup
const cache = new Map<string, string[]>();
const MAX_CACHE = 50000;

/**
 * Pure function: ratings in, badge labels out (positives first in definition order, then flags). Deterministic, no side effects besides the memo cache. Returned arrays are shared, do not mutate.
 */
export const getSkillBadges = (ratings: BadgeRatings): string[] => {
	if (SKILL_BADGES.length === 0) {
		return [];
	}
	let key = "";
	for (const k of BADGE_RATING_KEYS) {
		key += `${Math.round(ratings[k])},`;
	}
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}
	const result = compute(ratings);
	if (cache.size >= MAX_CACHE) {
		cache.clear();
	}
	cache.set(key, result);
	return result;
};

export const clearSkillBadgeCache = () => {
	cache.clear();
};

export const pickBadgeRatings = (
	row: Partial<Record<BadgeRatingKey, number>>,
): BadgeRatings | undefined => {
	const out: any = {};
	for (const k of BADGE_RATING_KEYS) {
		const v = row[k];
		if (typeof v !== "number") {
			return undefined;
		}
		out[k] = v;
	}
	return out;
};

// ---- Display helpers (pure, no React) ----

const fmt = (x: number) => Math.round(x * 100);

export const describeBadge = (label: string) => {
	const def = SKILL_BADGES_BY_LABEL[label];
	if (!def) {
		return label;
	}
	const rules = def.conditions
		.map((cond) => `${cond.dir === "below" ? "<=" : ">="} ${fmt(cond.cutoff)}`)
		.join(" and ");
	return `${def.name}: ${def.meaning} (score ${rules} of 100; ${BADGE_GROUP_NAMES[def.group]})`;
};

/** Order badges by definition priority, dropping unknown labels. */
export const sortBadges = (labels: string[]) =>
	labels
		.filter((label) => SKILL_BADGES_BY_LABEL[label])
		.sort(
			(a, b) =>
				SKILL_BADGES.indexOf(SKILL_BADGES_BY_LABEL[a]!) -
				SKILL_BADGES.indexOf(SKILL_BADGES_BY_LABEL[b]!),
		);

export type BadgeMode = "off" | "compact" | "full";
export const COMPACT_BADGE_COUNT = 3;

/** Which badges to show, and how many are hidden behind a "+N", for a display mode. */
export const selectBadgesForMode = (
	labels: string[] | undefined,
	mode: BadgeMode,
) => {
	if (!labels || mode === "off" || labels.length === 0) {
		return { shown: [] as string[], hidden: [] as string[] };
	}
	if (mode === "full" || labels.length <= COMPACT_BADGE_COUNT) {
		return { shown: labels, hidden: [] as string[] };
	}
	return {
		shown: labels.slice(0, COMPACT_BADGE_COUNT),
		hidden: labels.slice(COMPACT_BADGE_COUNT),
	};
};
