import { assert, describe, test } from "vitest";
import {
	NATIVE_FEATURES,
	NATIVE_FEATURE_SETTING_KEYS,
	nativeFeatureDefaults,
	nativeFeatureEnabled,
	nativeFeatureEnabledForSport,
	nativeFeatureJsonSchemaProperties,
	nativeFeatureKeysOtherSportsFor,
	nativeFeatureNewLeagueDefaults,
	nativeFeatureOption,
	type NativeFeatureDef,
} from "./nativeFeatures.ts";
import { defaultGameAttributes } from "./defaultGameAttributes.ts";
import { gameAttributesSyncedToUi } from "./gameAttributesSyncedToUi.ts";

const defs: readonly NativeFeatureDef[] = NATIVE_FEATURES;

describe("League extras registry", () => {
	test("ids and setting keys are unique", () => {
		const ids = defs.map((f) => f.id);
		assert.strictEqual(new Set(ids).size, ids.length);
		assert.strictEqual(
			new Set(NATIVE_FEATURE_SETTING_KEYS).size,
			NATIVE_FEATURE_SETTING_KEYS.length,
		);
	});

	test("every switch and option has a default game attribute and is synced to the UI", () => {
		const synced = new Set<string>(gameAttributesSyncedToUi);
		for (const key of NATIVE_FEATURE_SETTING_KEYS) {
			assert.notStrictEqual(
				(defaultGameAttributes as Record<string, unknown>)[key],
				undefined,
				key,
			);
			assert(synced.has(key), key);
		}
	});

	test("defaults: features on for existing leagues, unretirements off", () => {
		assert.strictEqual(nativeFeatureDefaults.featureNewspaper, true);
		assert.strictEqual(nativeFeatureDefaults.featureUnretire, false);
		assert.strictEqual(nativeFeatureDefaults.unretireChance, 10);
		// Existing game attributes keep their own defaults
		assert.strictEqual(defaultGameAttributes.technicalFouls, false);
		assert.strictEqual(
			(nativeFeatureDefaults as Record<string, unknown>).technicalFouls,
			undefined,
		);
		assert.strictEqual(
			(nativeFeatureNewLeagueDefaults() as Record<string, unknown>)
				.featureTimeline,
			true,
		);
	});

	test("missing values count as the default, set values win", () => {
		const get = (values: Record<string, unknown>) => (key: string) =>
			values[key];
		assert.strictEqual(nativeFeatureEnabled("newspaper", get({})), true);
		assert.strictEqual(nativeFeatureEnabled("unretire", get({})), false);
		assert.strictEqual(
			nativeFeatureEnabled("newspaper", get({ featureNewspaper: false })),
			false,
		);
		assert.strictEqual(
			nativeFeatureEnabled("unretire", get({ featureUnretire: true })),
			true,
		);
	});

	test("bool options read false while their feature is off", () => {
		const on = (key: string) =>
			({ featureLeagueAchievements: true, featureAchievementToasts: true })[
				key
			];
		const off = (key: string) =>
			({ featureLeagueAchievements: false, featureAchievementToasts: true })[
				key
			];
		assert.strictEqual(
			nativeFeatureOption("featureAchievementToasts", on),
			true,
		);
		assert.strictEqual(
			nativeFeatureOption("featureAchievementToasts", off),
			false,
		);
		// Number options fall back to the default
		assert.strictEqual(
			nativeFeatureOption("unretireMinAge", () => undefined),
			35,
		);
	});

	test("basketball-only features are off and hidden in other sports", () => {
		const get = () => true;
		assert.strictEqual(
			nativeFeatureEnabledForSport("newspaper", get, "football"),
			false,
		);
		assert.strictEqual(
			nativeFeatureEnabledForSport("newspaper", get, "basketball"),
			true,
		);
		// Extra Frivolities is for every sport (each page has its own sport check)
		assert.strictEqual(
			nativeFeatureEnabledForSport("frivolities", get, "hockey"),
			true,
		);
		const hidden = nativeFeatureKeysOtherSportsFor("football");
		assert(hidden.includes("featureNewspaper"));
		assert(hidden.includes("unretireChance"));
		assert(!hidden.includes("featureFrivolities"));
		assert.deepStrictEqual(nativeFeatureKeysOtherSportsFor("basketball"), []);
	});

	test("league file schema lists the new game attributes", () => {
		const props = nativeFeatureJsonSchemaProperties();
		assert.deepStrictEqual(props.featureNewspaper, { type: "boolean" });
		assert.deepStrictEqual(props.unretireChance, {
			type: "number",
			minimum: 0,
			maximum: 100,
		});
		assert.strictEqual(props.technicalFouls, undefined);
	});
});
