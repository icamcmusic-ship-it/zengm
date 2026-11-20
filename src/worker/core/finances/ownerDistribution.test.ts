import { assert, test } from "vitest";
import {
	CASH_SPENDING_MAX_NUDGE,
	cashSpendingNudge,
	ownerDistribution,
} from "./ownerDistribution.ts";

test("owner distribution takes 75% of cash above one cap", () => {
	assert.strictEqual(ownerDistribution(100000, 150000), 0);
	assert.strictEqual(ownerDistribution(-5000, 150000), 0);
	assert.strictEqual(ownerDistribution(350000, 150000), 150000);
});

test("cash reserves nudge AI spending a few levels, bounded", () => {
	const cap = 150000;
	// At the reserve: no change
	assert.strictEqual(cashSpendingNudge(cap, cap), 0);
	// Half a cap above it: +2 levels; below it: fewer
	assert.strictEqual(cashSpendingNudge(1.5 * cap, cap), 2);
	assert.strictEqual(cashSpendingNudge(0.5 * cap, cap), -2);
	// Bounded both ways
	assert.strictEqual(
		cashSpendingNudge(100 * cap, cap),
		CASH_SPENDING_MAX_NUDGE,
	);
	assert.strictEqual(
		cashSpendingNudge(-100 * cap, cap),
		-CASH_SPENDING_MAX_NUDGE,
	);
	assert.strictEqual(cashSpendingNudge(Number.NaN, cap), 0);
	assert.strictEqual(cashSpendingNudge(cap, 0), 0);
});
