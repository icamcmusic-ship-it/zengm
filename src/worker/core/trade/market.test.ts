import { assert, describe, test } from "vitest";
import {
	AVAILABLE_THRESHOLD,
	getAskingPrice,
	getAvailability,
	type AvailabilityInput,
} from "./market.ts";

const input = (extra: Partial<AvailabilityInput>): AvailabilityInput => ({
	strategy: "rebuilding",
	age: 27,
	valueRank: 3,
	rosterSize: 14,
	value: 55,
	contractAmount: 10000,
	contractExp: 2026,
	season: 2025,
	minContract: 1000,
	maxContract: 40000,
	untradable: false,
	...extra,
});

describe("trade market", () => {
	test("rebuilding teams shop veterans, not young players", () => {
		const vet = getAvailability(input({ age: 31 }));
		const young = getAvailability(input({ age: 22 }));
		assert.isAtLeast(vet.score, AVAILABLE_THRESHOLD);
		assert.include(vet.reasons.join(" "), "Veteran");
		assert.isBelow(young.score, AVAILABLE_THRESHOLD);
	});

	test("contenders keep their core but move depth", () => {
		const core = getAvailability(
			input({ strategy: "contending", valueRank: 1, age: 29 }),
		);
		const depth = getAvailability(
			input({ strategy: "contending", valueRank: 9, age: 29 }),
		);
		assert.isBelow(core.score, AVAILABLE_THRESHOLD);
		assert.isAtLeast(depth.score, AVAILABLE_THRESHOLD);
	});

	test("overpaid contracts are more available", () => {
		const fair = getAvailability(input({ age: 27, contractAmount: 15000 }));
		const overpaid = getAvailability(input({ age: 27, contractAmount: 38000 }));
		assert.isAbove(overpaid.score, fair.score);
		assert.include(overpaid.reasons.join(" "), "shed");
	});

	test("untradable players are never available", () => {
		assert.strictEqual(
			getAvailability(input({ age: 33, untradable: true })).score,
			0,
		);
	});

	test("asking price tiers relative to a first round pick", () => {
		assert.strictEqual(getAskingPrice(0.1, 1, "rebuilding").tier, "low");
		assert.strictEqual(getAskingPrice(1, 1, "rebuilding").tier, "medium");
		assert.include(getAskingPrice(1, 1, "rebuilding").text, "picks");
		assert.strictEqual(getAskingPrice(2, 1, "contending").tier, "high");
		assert.include(getAskingPrice(2, 1, "contending").text, "help now");
		assert.strictEqual(getAskingPrice(5, 1, "contending").tier, "veryHigh");
	});
});
