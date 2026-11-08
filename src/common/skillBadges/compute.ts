import { COMPOSITE_WEIGHTS, SKILLS } from "../constants.ts";
import { TRAIT_DEFINITIONS } from "../playerTraits/definitions.ts";
import { TRAIT_KEYS, type TraitKey } from "../playerTraits/types.ts";
import {
	BADGE_GROUP_NAMES,
	ORIGINAL_SKILL_LABELS,
	SKILL_BADGES,
	SKILL_COMBOS,
	SKILL_COMBOS_BY_LABEL,
	SKILL_BADGES_BY_LABEL,
	type BadgeComposite,
	type BadgeCondition,
	type BadgeRatings,
	type BadgeTraits,
	type BadgeRatingKey,
	type SkillBadgeDef,
	type SkillComboDef,
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

const traitsMet = (
	traits: BadgeTraits | undefined,
	conds: { trait: TraitKey; cutoff: number }[],
) =>
	conds.every((cond) => {
		const value = traits?.[cond.trait];
		return value !== undefined && value >= cond.cutoff;
	});

/** traits: the visible 0-100 trait scores (missing = unknown/hidden/off, so trait badges are not awarded). */
export const hasBadge = (
	ratings: BadgeRatings,
	def: SkillBadgeDef,
	traits?: BadgeTraits,
) => {
	if (def.traitConditions && !traitsMet(traits, def.traitConditions)) {
		return false;
	}
	if (def.conditions.every((cond) => conditionMet(ratings, cond))) {
		return true;
	}
	return (
		def.traitAlternative !== undefined &&
		traitsMet(traits, [def.traitAlternative])
	);
};

// The main composite of a badge (0-1), used to rank leaders.
export const badgeScore = (
	ratings: BadgeRatings,
	def: SkillBadgeDef,
	traits?: BadgeTraits,
) => {
	const traitCond = def.traitConditions?.[0];
	if (traitCond) {
		return (traits?.[traitCond.trait] ?? 0) / 100;
	}
	const cond = def.conditions[0]!;
	const value = badgeComposite(ratings, cond);
	return cond.dir === "below" ? 1 - value : value;
};

const compute = (ratings: BadgeRatings, traits?: BadgeTraits) => {
	const out: string[] = [];
	for (const def of SKILL_BADGES) {
		if (hasBadge(ratings, def, traits)) {
			out.push(def.label);
		}
	}
	return out;
};

// Memoized by the 15 rating values, so identical rows (and repeated renders) cost one Map lookup
const cache = new Map<string, string[]>();
const MAX_CACHE = 50000;

/**
 * Pure function: ratings in, badge labels out (in definition order). Deterministic, no side effects besides the memo cache. Returned arrays are shared, do not mutate.
 */
const traitsKey = (traits: BadgeTraits | undefined) => {
	if (!traits) {
		return "";
	}
	let key = "";
	for (const k of TRAIT_KEYS) {
		key += `${traits[k] ?? ""},`;
	}
	return key;
};

export const getSkillBadges = (
	ratings: BadgeRatings,
	traits?: BadgeTraits,
): string[] => {
	if (SKILL_BADGES.length === 0) {
		return [];
	}
	let key = traitsKey(traits) + "|";
	for (const k of BADGE_RATING_KEYS) {
		key += `${Math.round(ratings[k])},`;
	}
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}
	const result = compute(ratings, traits);
	if (cache.size >= MAX_CACHE) {
		cache.clear();
	}
	cache.set(key, result);
	return result;
};

export const clearSkillBadgeCache = () => {
	cache.clear();
	displayCache.clear();
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

// ---- Display (pure, no React) ----

const fmt = (x: number) => Math.round(x * 100);

/** Longer explanation for the legend page. Hover text in tables is just the name, see badgeTitle. */
export const describeBadge = (label: string) => {
	const def = SKILL_BADGES_BY_LABEL[label];
	if (!def) {
		const combo = SKILL_COMBOS_BY_LABEL[label];
		return combo ? `${combo.name}: ${combo.meaning}` : label;
	}
	const rules = [
		...(def.traitConditions ?? []).map(
			(cond) => `${TRAIT_DEFINITIONS[cond.trait].name} trait >= ${cond.cutoff}`,
		),
		...def.conditions.map(
			(cond) =>
				`score ${cond.dir === "below" ? "<=" : ">="} ${fmt(cond.cutoff)}`,
		),
		...(def.traitAlternative
			? [
					`or ${TRAIT_DEFINITIONS[def.traitAlternative.trait].name} trait >= ${def.traitAlternative.cutoff}`,
				]
			: []),
	].join(" and ");
	return `${def.name}: ${def.meaning} (${rules}; ${BADGE_GROUP_NAMES[def.group]})`;
};

const ORIGINAL_COMPOSITES: Record<
	string,
	{ composite: BadgeComposite; cutoff: number }
> = {};
for (const { ratings, weights, skill } of Object.values(
	COMPOSITE_WEIGHTS as Record<
		string,
		{
			ratings: (string | number)[];
			weights?: number[];
			skill?: { label: string; cutoff?: number };
		}
	>,
)) {
	if (skill && ORIGINAL_SKILL_LABELS.includes(skill.label)) {
		ORIGINAL_COMPOSITES[skill.label] = {
			composite: {
				ratings: ratings as BadgeComposite["ratings"],
				weights: weights ?? ratings.map(() => 1),
			},
			cutoff: skill.cutoff ?? 0.61,
		};
	}
}

// How far (0-1 composite points) a player is past the cutoff of a skill or badge
export const skillMargin = (
	ratings: BadgeRatings,
	label: string,
	traits?: BadgeTraits,
) => {
	const original = ORIGINAL_COMPOSITES[label];
	if (original) {
		return badgeComposite(ratings, original.composite) - original.cutoff;
	}
	const def = SKILL_BADGES_BY_LABEL[label];
	if (!def) {
		return 0;
	}
	return Math.min(
		...def.conditions.map((cond) => {
			const value = badgeComposite(ratings, cond);
			return cond.dir === "below" ? cond.cutoff - value : value - cond.cutoff;
		}),
		...(def.traitConditions ?? []).map(
			(cond) => ((traits?.[cond.trait] ?? 0) - cond.cutoff) / 100,
		),
	);
};

/** Hover text: just the name, like the original skills' title. */
export const badgeTitle = (label: string) =>
	SKILL_COMBOS_BY_LABEL[label]?.name ??
	SKILL_BADGES_BY_LABEL[label]?.name ??
	SKILLS[label] ??
	label;

/** Which of a combo's parts a player has (what it replaced for him). */
export const comboParts = (def: SkillComboDef, available: Set<string>) => {
	if (!def.all.every((c) => available.has(c))) {
		return undefined;
	}
	const anyHit = def.any?.filter((c) => available.has(c)) ?? [];
	if (def.any && anyHit.length < (def.minAny ?? 1)) {
		return undefined;
	}
	return [
		...def.all,
		...anyHit,
		...(def.extra?.filter((c) => available.has(c)) ?? []),
	];
};

const displayCache = new Map<string, string[]>();

/**
 * THE display function: given (fuzzed) ratings and the player's original ratings.skills, returns the extended labels to show: combos first (one greedy pass, largest first, each part used once), then remaining badges. Original skills consumed by a combo are hidden by visibleOriginalSkills. ratings.skills itself is never changed.
 */
export const getDisplayBadges = (
	ratings: BadgeRatings,
	skills: string[],
	traits?: BadgeTraits,
): string[] => {
	if (SKILL_BADGES.length === 0) {
		return [];
	}
	let key = skills.join(",") + "|" + traitsKey(traits) + "|";
	for (const k of BADGE_RATING_KEYS) {
		key += `${Math.round(ratings[k])},`;
	}
	const cached = displayCache.get(key);
	if (cached) {
		return cached;
	}

	const extended = getSkillBadges(ratings, traits);
	const available = new Set([...skills, ...extended]);
	const combos: string[] = [];
	for (const combo of SKILL_COMBOS) {
		const consumed = comboParts(combo, available);
		if (!consumed) {
			continue;
		}
		for (const c of consumed) {
			available.delete(c);
		}
		// A level 2 combo can absorb level 1 combos, so the new one is available for later combos
		available.add(combo.label);
		combos.push(combo.label);
	}
	const result = [
		...combos.filter((c) => available.has(c)),
		...extended.filter((b) => available.has(b)),
	];

	if (displayCache.size >= MAX_CACHE) {
		displayCache.clear();
	}
	displayCache.set(key, result);
	return result;
};

/** Original skills still shown next to some display tokens (the ones not consumed by a combo in the tokens). */
export const visibleOriginalSkills = (skills: string[], tokens: string[]) => {
	const consumed = new Set<string>();
	for (const token of tokens) {
		const stack = [token];
		while (stack.length > 0) {
			const combo = SKILL_COMBOS_BY_LABEL[stack.pop()!];
			if (combo) {
				for (const c of [
					...combo.all,
					...(combo.any ?? []),
					...(combo.extra ?? []),
				]) {
					if (!consumed.has(c)) {
						consumed.add(c);
						stack.push(c);
					}
				}
			}
		}
	}
	return consumed.size === 0
		? skills
		: skills.filter((skill) => !consumed.has(skill));
};

export const MAX_VISIBLE_BADGES = 7;

export type DisplayItem = { token: string; original: boolean };

/** Everything shown next to a player's name, in priority order: combos, remaining original skills, other badges. */
export const orderDisplayItems = (
	skills: string[],
	tokens: string[],
): DisplayItem[] => {
	const combos: DisplayItem[] = [];
	const positives: DisplayItem[] = [];
	for (const token of tokens) {
		const label = token;
		(SKILL_COMBOS_BY_LABEL[label] ? combos : positives).push({
			token,
			original: false,
		});
	}
	return [
		...combos,
		...visibleOriginalSkills(skills, tokens).map((token) => ({
			token,
			original: true,
		})),
		...positives,
	];
};

/** Up to MAX_VISIBLE_BADGES items unless expanded; hasMore says whether to render the "…" toggle. */
export const capDisplayItems = <T>(items: T[], expanded: boolean) => {
	const hasMore = items.length > MAX_VISIBLE_BADGES;
	return {
		shown: hasMore && !expanded ? items.slice(0, MAX_VISIBLE_BADGES) : items,
		hasMore,
	};
};
