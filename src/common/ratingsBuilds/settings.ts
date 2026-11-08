import { DEFAULT_LEVEL } from "../budgetLevels.ts";
// The number of builds in the table. Kept here, not read off the table, so the UI can import settings without bundling it (a test asserts they agree).
export const TABLE_SIZE = 447;

export type FuzzMode = "keep" | "zero" | "regenerate";

// How pot is handled. "keep" leaves each player's pot alone, "estimate" re-reads it off the game's own (noise free) pot
// estimator, "build" keeps pot and adds the build's upside (a Raw Project carries more, a Glue Guy less).
export type PotMode = "keep" | "estimate" | "build";

export type BuildSettings = {
	// Same seed + settings + players = same results
	seed: string;

	// Re-rolls every individual player while keeping the flavor, the build pool and the diversity plan
	variation: number;

	// Class flavor: "" draws one from the seed
	flavor: string;
	flavorStrength: number;
	flavorBlend: number;

	// How many of the builds one class is drawn from. 0 makes every build eligible.
	buildsPerClass: number;

	// Exactly 100 - diversity percent of the class stays Balanced
	diversity: number;

	// 0 = keep the ratings' shape, 2.5 = extreme specialists
	specialization: number;
	buildNoise: number;

	// Rookie soft caps, 0 = off
	skillCap: number;
	physCap: number;

	// Promise the 3 / A / R badge to builds tagged for it
	signatureSkills: boolean;

	// Archetype ids (see src/common/archetypes) the class is aimed at. Empty: the class is drawn from the builds as before.
	archetypePool: string[];

	// Keep every player's height (default). Off: height is part of what a reroll redraws.
	keepHeights: boolean;
	fuzz: FuzzMode;
	pot: PotMode;
	scoutingLevel: number;
};

export const DEFAULT_SETTINGS: BuildSettings = {
	seed: "regen",
	variation: 0,
	flavor: "",
	flavorStrength: 1,
	flavorBlend: 0,
	buildsPerClass: 46,
	diversity: 85,
	specialization: 1,
	buildNoise: 5,
	skillCap: 70,
	physCap: 80,
	signatureSkills: false,
	archetypePool: [],
	keepHeights: true,
	fuzz: "keep",
	pot: "keep",
	scoutingLevel: DEFAULT_LEVEL,
};

type Range = { min: number; max: number; step: number };

export const SETTING_RANGES = {
	variation: { min: 0, max: 12, step: 1 },
	flavorStrength: { min: 0, max: 2, step: 0.05 },
	flavorBlend: { min: 0, max: 1, step: 0.05 },
	buildsPerClass: { min: 0, max: TABLE_SIZE, step: 1 },
	diversity: { min: 0, max: 100, step: 1 },
	specialization: { min: 0, max: 2.5, step: 0.05 },
	buildNoise: { min: 0, max: 14, step: 0.5 },
	skillCap: { min: 0, max: 99, step: 1 },
	physCap: { min: 0, max: 99, step: 1 },
} satisfies Record<string, Range>;

export type NumericSettingKey = keyof typeof SETTING_RANGES;

// Clamp every setting to what it may legally be, so a stale or hand-edited object cannot break the engine
export const normalizeSettings = (
	input: Partial<BuildSettings>,
): BuildSettings => {
	const s: BuildSettings = { ...DEFAULT_SETTINGS, ...input };
	for (const key of Object.keys(SETTING_RANGES) as NumericSettingKey[]) {
		const { min, max } = SETTING_RANGES[key];
		const v = Number(s[key]);
		s[key] = Number.isFinite(v)
			? Math.min(max, Math.max(min, v))
			: DEFAULT_SETTINGS[key];
	}
	s.variation = Math.round(s.variation);
	s.seed = String(s.seed ?? "");
	if (!["keep", "zero", "regenerate"].includes(s.fuzz)) {
		s.fuzz = "keep";
	}
	if (!["keep", "estimate", "build"].includes(s.pot)) {
		s.pot = "keep";
	}
	s.archetypePool = Array.isArray(s.archetypePool)
		? s.archetypePool.filter((x) => typeof x === "string")
		: [];
	s.keepHeights = !!s.keepHeights;
	s.signatureSkills = !!s.signatureSkills;
	return s;
};
