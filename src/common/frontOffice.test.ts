import { assert, describe, test } from "vitest";
import { DEFAULT_LEVEL, healthEffect } from "./budgetLevels.ts";
import {
	FRONT_OFFICE_DEPTS,
	aiAllocate,
	aiDeptWeights,
	analyticsGmShift,
	analyticsMgmtBoost,
	analyticsProjection,
	analyticsRotationBias,
	analyticsWidthFactor,
	deptEffectLine,
	envelopeAmount,
	medicalAgeDurationFactor,
	medicalInjuryRateFactor,
	overspendMoodPenalty,
	ownerTargetLevel,
	travelEnduranceFallback,
	travelPenaltyScale,
} from "./frontOffice.ts";
import { getNativeFeature } from "./nativeFeatures.ts";

const factors = [
	medicalInjuryRateFactor,
	(level: number) => medicalAgeDurationFactor(level, 34),
	travelPenaltyScale,
	analyticsWidthFactor,
	analyticsRotationBias,
	// (a benefit above 1)
	(level: number) => 2 - travelEnduranceFallback(level),
];

describe("Front Office Budget", () => {
	test("registered as a League Extra: off for existing leagues, on for new ones, not in college", () => {
		const f = getNativeFeature("frontOffice");
		assert.strictEqual(f.default, false);
		assert.strictEqual(f.defaultNewLeague, true);
		assert.strictEqual(f.college, false);
		assert.deepEqual(f.sports, ["basketball"]);
	});

	test("every effect is neutral at the league-average level", () => {
		for (const f of factors) {
			assert.closeTo(f(DEFAULT_LEVEL), 1, 1e-12);
		}
		assert.strictEqual(analyticsMgmtBoost(DEFAULT_LEVEL), 0);
		assert.strictEqual(analyticsGmShift(DEFAULT_LEVEL), 0);
		// Young players get no extra Medical recovery
		assert.strictEqual(medicalAgeDurationFactor(100, 25), 1);
	});

	test("effects are bounded and better with more spending", () => {
		for (const f of factors) {
			const top = f(100);
			const bottom = f(1);
			assert.isBelow(top, 1);
			assert.isAbove(bottom, 1);
			assert.isAtLeast(top, 0.5);
			assert.isAtMost(bottom, 1.5);
		}
		assert.isAbove(medicalInjuryRateFactor(100), 0.92);
		assert.isBelow(medicalInjuryRateFactor(1), 1.08);
		assert.isAbove(analyticsMgmtBoost(100), 0);
		assert.isAtMost(analyticsMgmtBoost(100), 13);
	});

	test("diminishing returns above the average", () => {
		const gain1 = travelPenaltyScale(34) - travelPenaltyScale(67);
		const gain2 = travelPenaltyScale(67) - travelPenaltyScale(100);
		assert.isAbove(gain1, 2 * gain2);
		// The bottom costs more than the top buys
		assert.isAbove(
			medicalInjuryRateFactor(1) - 1,
			1 - medicalInjuryRateFactor(100),
		);
	});

	test("Medical doesn't double count the health budget's duration effect", () => {
		// Young players: only the existing health effect changes the duration
		assert.strictEqual(medicalAgeDurationFactor(80, 22), 1);
		assert.isBelow(healthEffect(80), 0);
	});

	test("owner envelope grows with market size and is neutral in the middle", () => {
		assert.strictEqual(ownerTargetLevel(15.5, 30), DEFAULT_LEVEL);
		assert.isAbove(ownerTargetLevel(1, 30), 50);
		assert.isBelow(ownerTargetLevel(30, 30), 15);
		assert.isAbove(envelopeAmount(60, 90000), envelopeAmount(34, 90000));
	});

	test("overspending costs owner mood, only above a small tolerance", () => {
		assert.strictEqual(overspendMoodPenalty(100, 100), 0);
		assert.strictEqual(overspendMoodPenalty(101, 100), 0);
		assert.closeTo(overspendMoodPenalty(120, 100), 0.75 * 0.18, 1e-9);
	});

	test("AI allocation moves money between departments without changing the total", () => {
		const leanings = [
			{ analytics: 1, patience: -1 },
			{ analytics: -1, patience: 1 },
			{ analytics: 0.3, patience: 0.2 },
		];
		for (const l of leanings) {
			const w = aiDeptWeights(l, FRONT_OFFICE_DEPTS);
			const mean =
				FRONT_OFFICE_DEPTS.reduce((s, d) => s + w[d], 0) /
				FRONT_OFFICE_DEPTS.length;
			assert.closeTo(mean, 1, 1e-9);
		}
		const analyticsGm = aiAllocate(40, leanings[0]!, FRONT_OFFICE_DEPTS);
		const oldSchool = aiAllocate(40, leanings[1]!, FRONT_OFFICE_DEPTS);
		assert.isAbove(analyticsGm.analytics, oldSchool.analytics);
		assert.isAbove(oldSchool.scouting, analyticsGm.scouting);
		// Win-now spends on keeping players healthy and fresh
		assert.isAbove(analyticsGm.health, oldSchool.health);
		// Neutral leanings: every department at the target
		const neutral = aiAllocate(40, { analytics: 0, patience: 0 }, [
			"analytics",
			"health",
			"travel",
		]);
		assert.isAtMost(Math.abs(neutral.analytics - 40), 3);
	});

	test("analytics projection ranges narrow with spending and see through some of the fuzz", () => {
		const args = { ovr: 55, fuzz: 3, age: 24 };
		const low = analyticsProjection({ ...args, level: 1 });
		const avg = analyticsProjection({ ...args, level: DEFAULT_LEVEL });
		const high = analyticsProjection({ ...args, level: 100 });
		assert.isAbove(low.hi - low.lo, avg.hi - avg.lo);
		assert.isAbove(avg.hi - avg.lo, high.hi - high.lo);
		// The true ovr is 52: a better department's center is closer to the truth (plus the age curve)
		assert.isBelow(high.mid, low.mid);
	});

	test("effect lines", () => {
		assert.include(deptEffectLine("health", 70), "injury rate");
		assert.include(
			deptEffectLine("travel", 70, { scheduleLoad: true }),
			"3-in-4",
		);
		assert.include(deptEffectLine("travel", 70), "endurance");
		assert.include(
			deptEffectLine("analytics", 70, { coachSystems: true }),
			"game management",
		);
		assert.include(deptEffectLine("scouting", 70, { scouts: 4 }), "4 scouts");
	});
});
