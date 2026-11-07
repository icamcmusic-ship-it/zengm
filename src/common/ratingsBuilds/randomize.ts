// The settings randomizer: draws new settings from a seed, so a draw can be replayed. Never touches the seed, the
// variation, the named flavor or the keep-heights / fuzz / pot modes: Reroll owns the seed, and the rest are choices
// about what to do to the data rather than properties of the class.

import { Rng } from "./rng.ts";
import {
	DEFAULT_SETTINGS,
	SETTING_RANGES,
	type BuildSettings,
	type NumericSettingKey,
} from "./settings.ts";

export const RANDOM_GROUPS = {
	// How many builds a class is drawn from and how many stay Balanced
	mix: ["buildsPerClass", "diversity"],
	// How lopsided each player gets
	shape: ["specialization", "buildNoise"],
	// How strongly the class leans, and whether it has two flavors
	flavor: ["flavorStrength", "flavorBlend"],
} satisfies Record<string, NumericSettingKey[]>;

export type RandomScope = "gentle" | "wide" | keyof typeof RANDOM_GROUPS;

export const RANDOM_SCOPES: RandomScope[] = [
	"gentle",
	"wide",
	...(Object.keys(RANDOM_GROUPS) as (keyof typeof RANDOM_GROUPS)[]),
];

const decimals = (step: number) => {
	const s = String(step);
	const i = s.indexOf(".");
	return i === -1 ? 0 : s.length - i - 1;
};

const drawOne = (key: NumericSettingKey, mode: "gentle" | "wide", rng: Rng) => {
	const { min, max, step } = SETTING_RANGES[key];
	let v;
	if (mode === "gentle") {
		// Triangular, centered on the setting's default, reaching about a third of the range each way
		const d = Number(DEFAULT_SETTINGS[key]);
		const center = Math.min(max, Math.max(min, d));
		v = center + (rng.random() - rng.random()) * 0.34 * (max - min);
	} else {
		v = min + rng.random() * (max - min);
	}
	v = min + Math.round((Math.min(max, Math.max(min, v)) - min) / step) * step;
	v = Math.min(max, Math.max(min, v));
	return Number(v.toFixed(decimals(step)));
};

// One draw for a scope, as a patch. Keys are drawn in a fixed order, so the same seed gives the same patch.
export const randomizeSettings = (
	current: BuildSettings,
	scope: RandomScope,
	randomSeed: string,
	// Settings the user locked, which are never touched
	skip: Partial<Record<NumericSettingKey, boolean>> = {},
) => {
	const rng = new Rng(`randomize|${randomSeed}`);
	const mode = scope === "gentle" ? "gentle" : "wide";
	const groups: (keyof typeof RANDOM_GROUPS)[] =
		scope === "gentle" || scope === "wide"
			? (Object.keys(RANDOM_GROUPS) as (keyof typeof RANDOM_GROUPS)[])
			: [scope];
	const patch: Partial<BuildSettings> = {};
	for (const g of groups) {
		for (const key of RANDOM_GROUPS[g] as NumericSettingKey[]) {
			// Drawn even when skipped, so locking one setting does not reshuffle the others
			const v = drawOne(key, mode, rng);
			if (skip[key] || v === current[key]) {
				continue;
			}
			patch[key] = v;
		}
	}
	return patch;
};
