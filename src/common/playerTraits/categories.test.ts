import { assert, describe, test } from "vitest";
import {
	AI_TRAIT_WEIGHTS,
	EFFECT_AMPLITUDES,
	NEUTRAL_EFFECTS,
	TRAIT_CATEGORIES,
	TRAIT_DEFINITIONS,
	TRAIT_KEYS,
	TRAIT_STATUS,
	TRAIT_STATUS_UNKNOWN,
	completeTraitSeeds,
	generateTraitSeeds,
	lineupSizeMismatch,
	loyaltyContractMult,
	loyaltyMoodMult,
	personalityTradeRequestProbMult,
	ringChaserContractMult,
	roleAcceptancePlayingTime,
	seedKey,
	teamSwitchDefenseBonus,
	traitEffects,
	traitStatusText,
	NEUTRAL_SCORES,
	winningTeamPerformance,
	type TraitKey,
} from "./index.ts";

const NEW_TRAITS = [
	"loyalty",
	"roleAcceptance",
	"moneyVsWinning",
	"motor",
	"defensiveVersatility",
] as const;

describe("trait categories", () => {
	test("cover every trait exactly once", () => {
		const all = TRAIT_CATEGORIES.flatMap((c) => c.traits as readonly string[]);
		assert.strictEqual(all.length, TRAIT_KEYS.length);
		assert.deepEqual(new Set(all), new Set(TRAIT_KEYS));
		assert.deepEqual(
			TRAIT_CATEGORIES.map((c) => c.name),
			["Mental", "Personality", "Physical", "Playstyle"],
		);
	});

	test("22 traits, new ones defined and weighted", () => {
		assert.strictEqual(TRAIT_KEYS.length, 22);
		for (const key of NEW_TRAITS) {
			assert.strictEqual(TRAIT_DEFINITIONS[key].key, key);
			assert.isNumber(AI_TRAIT_WEIGHTS[key]);
		}
		const sum = Object.values(AI_TRAIT_WEIGHTS).reduce((a, b) => a + b, 0);
		assert.closeTo(sum, 1, 1e-9);
	});
});

describe("new trait seeds", () => {
	test("adding traits did not move the old seeds; missing new seeds are backfilled deterministically", () => {
		const full = generateTraitSeeds(77, 5);
		const old: Record<string, number> = { ...full };
		for (const key of NEW_TRAITS) {
			delete old[seedKey(key)];
		}
		const completed = completeTraitSeeds(old, 77, 5);
		assert.deepEqual(completed, full);
		// Each trait has its own stream: the original 17 do not depend on the list
		assert.isTrue(TRAIT_KEYS.slice(0, 17).every((k) => seedKey(k) in full));
	});
});

describe("per-player status text", () => {
	const keys = TRAIT_KEYS as readonly TraitKey[];
	test("exact, estimate and unknown readings, never the general description", () => {
		for (const key of keys) {
			const texts = [
				traitStatusText({ key, estimate: 90, low: 90, high: 90, exact: true }),
				traitStatusText({ key, estimate: 50, low: 50, high: 50, exact: true }),
				traitStatusText({ key, estimate: 10, low: 10, high: 10, exact: true }),
				traitStatusText({ key, estimate: 80, low: 70, high: 90, exact: false }),
				traitStatusText({ key, estimate: 50, low: 20, high: 80, exact: false }),
			];
			assert.strictEqual(texts[0], TRAIT_STATUS[key].high);
			assert.strictEqual(texts[1], TRAIT_STATUS[key].average);
			assert.strictEqual(texts[2], TRAIT_STATUS[key].low);
			assert.match(texts[3]!, /^Scouts think he [a-z]/);
			assert.strictEqual(texts[4], TRAIT_STATUS_UNKNOWN);
			for (const text of texts) {
				assert.notInclude(text, TRAIT_DEFINITIONS[key].description);
				assert.notInclude(text, TRAIT_DEFINITIONS[key].effect);
			}
		}
	});
});

describe("new trait effects are bounded and neutral at 50", () => {
	test("loyalty", () => {
		assert.strictEqual(loyaltyContractMult(50), 1);
		assert.closeTo(loyaltyContractMult(100), 0.92, 1e-9);
		assert.closeTo(loyaltyContractMult(0), 1.08, 1e-9);
		assert.isAtLeast(loyaltyMoodMult(0), 0.5);
		assert.isBelow(personalityTradeRequestProbMult(100, 50, false), 1);
		assert.isAbove(personalityTradeRequestProbMult(0, 50, false), 1);
		assert.strictEqual(personalityTradeRequestProbMult(50, 50, true), 1);
	});

	test("role acceptance", () => {
		assert.strictEqual(roleAcceptancePlayingTime(-2, 50), -2);
		assert.closeTo(roleAcceptancePlayingTime(-2, 100), -1, 1e-9);
		assert.closeTo(roleAcceptancePlayingTime(-2, 0), -3, 1e-9);
		assert.strictEqual(roleAcceptancePlayingTime(1.5, 0), 1.5);
		assert.isAbove(personalityTradeRequestProbMult(50, 0, true), 1);
		assert.strictEqual(personalityTradeRequestProbMult(50, 0, false), 1);
	});

	test("money vs winning", () => {
		assert.closeTo(winningTeamPerformance(2, 100), 3, 1e-9);
		assert.closeTo(winningTeamPerformance(2, 0), 1, 1e-9);
		assert.strictEqual(winningTeamPerformance(-3, 100), -3);
		assert.closeTo(ringChaserContractMult(100, 2), 0.85, 1e-9);
		assert.strictEqual(ringChaserContractMult(100, -1), 1);
		assert.strictEqual(ringChaserContractMult(0, 2), 1);
		assert.strictEqual(ringChaserContractMult(50, 2), 1);
	});

	test("motor", () => {
		assert.strictEqual(NEUTRAL_EFFECTS.energyDrainRate, 1);
		assert.strictEqual(NEUTRAL_EFFECTS.backToBackEnduranceMult, 1);
		const hi = traitEffects({ ...NEUTRAL_SCORES, motor: 100 });
		const lo = traitEffects({ ...NEUTRAL_SCORES, motor: 0 });
		assert.closeTo(hi.energyDrainRate, 1 - EFFECT_AMPLITUDES.motorDrain, 1e-9);
		assert.closeTo(lo.energyDrainRate, 1 + EFFECT_AMPLITUDES.motorDrain, 1e-9);
		assert.closeTo(hi.backToBackEnduranceMult, 1.05, 1e-9);
	});

	test("defensive versatility", () => {
		assert.strictEqual(lineupSizeMismatch([50, 50, 50, 50, 50]), 0);
		assert.strictEqual(lineupSizeMismatch([30, 35, 45, 70, 80]), 1);
		assert.strictEqual(teamSwitchDefenseBonus([0, 0, 0, 0, 0], 1), 0);
		assert.strictEqual(teamSwitchDefenseBonus([1, 1, 1, 1, 1], 0), 0);
		assert.closeTo(
			teamSwitchDefenseBonus([1, 1, 1, 1, 1], 1),
			EFFECT_AMPLITUDES.switchDefense,
			1e-9,
		);
		assert.closeTo(
			teamSwitchDefenseBonus([-1, -1, -1, -1, -1], 1),
			-EFFECT_AMPLITUDES.switchDefense,
			1e-9,
		);
		assert.isAtMost(EFFECT_AMPLITUDES.switchDefense, 0.02);
	});
});
