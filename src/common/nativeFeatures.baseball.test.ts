import { assert, test } from "vitest";
import { nativeFeatureEnabled } from "./nativeFeatures.ts";
import { gameAttributesKeysOtherSports } from "./defaultGameAttributes.ts";

test("League extras: basketball-only features are off in baseball, and their settings hidden", () => {
	const get = () => true;
	assert.strictEqual(nativeFeatureEnabled("newspaper", get), false);
	assert.strictEqual(nativeFeatureEnabled("unretire", get), false);
	assert.strictEqual(nativeFeatureEnabled("frivolities", get), true);
	assert(gameAttributesKeysOtherSports.has("featureNewspaper" as any));
	assert(!gameAttributesKeysOtherSports.has("featureFrivolities" as any));
});
