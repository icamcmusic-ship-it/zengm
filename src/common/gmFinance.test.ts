import { assert, test } from "vitest";
import {
	GM_FINANCE_STYLE_KEYS,
	applyDeptMultipliers,
	effectiveGmFinanceProfile,
	genGmFinanceStyle,
	getGmFinanceStyle,
} from "./gmFinance.ts";
import { NEUTRAL_GM_TRAITS } from "./gmPersonality.ts";
import { aiAllocate, aiDeptWeights } from "./frontOffice.ts";

test("finance style is stable for a GM id and uses the stored style", () => {
	const gm = { gmid: 17, traits: NEUTRAL_GM_TRAITS };
	const style = genGmFinanceStyle(gm);
	for (let i = 0; i < 5; i++) {
		assert.strictEqual(genGmFinanceStyle(gm), style);
	}
	assert.strictEqual(
		getGmFinanceStyle({ ...gm, financeStyle: "frugal" }),
		"frugal",
	);
	assert.strictEqual(getGmFinanceStyle(gm), style);
});

test("finance styles are spread over GMs and follow the traits", () => {
	const counts: Record<string, number> = {};
	let spendTolerant = 0;
	let frugalTolerant = 0;
	for (let gmid = 0; gmid < 3000; gmid++) {
		const style = genGmFinanceStyle({ gmid, traits: NEUTRAL_GM_TRAITS });
		counts[style] = (counts[style] ?? 0) + 1;
		const tolerant = genGmFinanceStyle({
			gmid,
			traits: { ...NEUTRAL_GM_TRAITS, taxTolerance: 0.8 },
		});
		if (tolerant === "spendthrift") {
			spendTolerant += 1;
		} else if (tolerant === "frugal") {
			frugalTolerant += 1;
		}
	}
	for (const key of GM_FINANCE_STYLE_KEYS) {
		assert.isAbove(counts[key] ?? 0, 200, key);
	}
	assert.isAbove(spendTolerant, 2 * frugalTolerant);
});

test("owner type wins on conflicts", () => {
	const spendthrift = effectiveGmFinanceProfile("spendthrift", "profit");
	assert.isAtMost(spendthrift.spend, 0);
	assert.isAtMost(spendthrift.tax, 0);
	assert.isAtLeast(spendthrift.ticket, 1);
	const frugal = effectiveGmFinanceProfile("frugal", "spendHappy");
	assert.isAtLeast(frugal.spend, 0);
	assert.isAtLeast(frugal.tax, 0);
	const traditional = effectiveGmFinanceProfile("frugal", "traditional");
	assert.isBelow(traditional.spend, 0);
	assert.isBelow(traditional.tax, 0);
});

test("department multipliers keep the total spend", () => {
	const depts = [
		"scouting",
		"analytics",
		"health",
		"travel",
		"coaching",
		"facilities",
	] as const;
	const weights = aiDeptWeights({ analytics: 0.2, patience: -0.1 }, depts);
	const out = applyDeptMultipliers(weights, { analytics: 1.6 }, depts);
	const sum = (x: Record<string, number>) =>
		depts.reduce((total, d) => total + x[d]!, 0);
	assert.closeTo(sum(out), sum(weights), 1e-9);
	assert.isAbove(out.analytics, weights.analytics);
	const levels = aiAllocate(40, { analytics: 0, patience: 0 }, depts, {
		analytics: 1.6,
		coaching: 0.8,
	});
	assert.isAbove(levels.analytics, levels.coaching);
});
