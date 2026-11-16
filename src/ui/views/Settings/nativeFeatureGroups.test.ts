import { assert, test } from "vitest";
import { NATIVE_FEATURES } from "../../../../common/nativeFeatures.ts";
import { NATIVE_FEATURE_GROUPS } from "./nativeFeatureGroups.ts";

// The League extras groups are keyed by feature id: a key that is not an id (e.g. the setting key featureOffEmphasis) leaves
// that extra in the catch-all "League extras" group
test("every League extras group key is a feature id", () => {
	const ids = new Set<string>(NATIVE_FEATURES.map((f) => f.id));
	assert.deepStrictEqual(
		Object.keys(NATIVE_FEATURE_GROUPS).filter((key) => !ids.has(key)),
		[],
	);
	assert.strictEqual(
		NATIVE_FEATURE_GROUPS.offEmphasis,
		"League extras: Game Simulation",
	);
});
