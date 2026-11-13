import { assert, test } from "vitest";
import { ownerDistribution } from "./ownerDistribution.ts";

test("owner distribution takes 75% of cash above one cap", () => {
	assert.strictEqual(ownerDistribution(100000, 150000), 0);
	assert.strictEqual(ownerDistribution(-5000, 150000), 0);
	assert.strictEqual(ownerDistribution(350000, 150000), 150000);
});
