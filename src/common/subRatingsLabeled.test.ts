import { assert, test } from "vitest";
import { SUB_DEFS, labeledSubs, subFromLabeled } from "./subRatings.ts";

test("exported sub-ratings are labeled by name and read back by name, key or short label", () => {
	const sub = SUB_DEFS.map((_d, i) => 30 + i);
	const labeled = labeledSubs(sub);
	assert.strictEqual(labeled["Shot Blocking"], 30);
	assert.strictEqual(labeled["Max Vertical"], 30 + SUB_DEFS.length - 1);
	assert.deepStrictEqual(subFromLabeled(labeled), sub);

	const byKey = Object.fromEntries(SUB_DEFS.map((d, i) => [d.key, sub[i]]));
	assert.deepStrictEqual(subFromLabeled(byKey), sub);

	// Missing one: not usable
	const partial = { ...labeled };
	delete partial["Steals"];
	assert.strictEqual(subFromLabeled(partial), undefined);
	assert.strictEqual(subFromLabeled([1, 2]), undefined);
});
