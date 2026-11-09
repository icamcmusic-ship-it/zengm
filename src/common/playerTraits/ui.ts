import { TRAIT_DEFINITIONS } from "./definitions.ts";
import { TRAIT_KEYS, type TraitKey, type TraitScores } from "./types.ts";

export type TraitLevel = "elite" | "strong" | "average" | "weak" | "poor";

export const traitLevel = (score: number): TraitLevel => {
	if (score >= 80) {
		return "elite";
	}
	if (score >= 65) {
		return "strong";
	}
	if (score > 35) {
		return "average";
	}
	if (score > 20) {
		return "weak";
	}
	return "poor";
};

export const TRAIT_LEVEL_LABELS: Record<TraitLevel, string> = {
	elite: "Elite",
	strong: "Strong",
	average: "Average",
	weak: "Weak",
	poor: "Poor",
};

export type TraitBadge = {
	key: TraitKey;
	label: string;
	score: number;
	tone: "good" | "bad";
};

// Badges for the notable traits only (score at least 70 or at most 30), most extreme first
export const traitBadges = (
	scores: TraitScores,
	{
		max = 4,
		upper = 70,
		lower = 30,
	}: { max?: number; upper?: number; lower?: number } = {},
): TraitBadge[] => {
	const badges: TraitBadge[] = [];
	for (const key of TRAIT_KEYS) {
		const score = scores[key];
		if (score >= upper) {
			badges.push({
				key,
				label: TRAIT_DEFINITIONS[key].badgeHigh,
				score,
				tone: "good",
			});
		} else if (score <= lower) {
			badges.push({
				key,
				label: TRAIT_DEFINITIONS[key].badgeLow,
				score,
				tone: "bad",
			});
		}
	}
	badges.sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
	return badges.slice(0, max);
};

// Which end of the scale is described
export const traitDescription = (key: TraitKey, score: number) => {
	const def = TRAIT_DEFINITIONS[key];
	return score >= 50 ? def.high : def.low;
};

export type TraitFilter = {
	key: TraitKey;
	// Inclusive bounds on the 0-100 score
	min?: number;
	max?: number;
};

export const matchesTraitFilters = (
	scores: TraitScores | undefined,
	filters: TraitFilter[],
) => {
	if (filters.length === 0) {
		return true;
	}
	if (!scores) {
		return false;
	}
	return filters.every((f) => {
		const score = scores[f.key];
		return (
			(f.min === undefined || score >= f.min) &&
			(f.max === undefined || score <= f.max)
		);
	});
};

// Short text for a table cell or column header
export const TRAIT_SHORT: Record<TraitKey, string> = {
	clutch: "Clu",
	consistency: "Con",
	durability: "Dur",
	shotDiscipline: "Dis",
	offBall: "OBM",
	screen: "Scr",
	hustle: "Hus",
	foulDiscipline: "FDi",
	recovery: "Rec",
	handle: "HUP",
	lateGameIq: "LIQ",
	leadership: "Ldr",
	veteranSavvy: "Vet",
};

export const isTraitKey = (x: unknown): x is TraitKey =>
	typeof x === "string" && (TRAIT_KEYS as readonly string[]).includes(x);
