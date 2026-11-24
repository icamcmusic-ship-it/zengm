import { assert, beforeEach, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { defaultInjuries } from "../../util/defaultInjuries.ts";
import injury from "./injury.ts";

beforeEach(() => {
	resetG();
});

const defaultNames = new Set(defaultInjuries.map((row) => row.name));

test("an empty injuries list (from a league file) falls back to the default injuries", () => {
	g.setWithoutSavingToDB("injuries", []);
	for (let i = 0; i < 50; i++) {
		const inj = injury(DEFAULT_LEVEL);
		assert.isTrue(defaultNames.has(inj.type), inj.type);
		assert.isAtLeast(inj.gamesRemaining, 1);
	}
});

test("all-zero frequencies fall back to the default injuries instead of always the first", () => {
	g.setWithoutSavingToDB("injuries", [
		{ name: "Custom A", frequency: 0, games: 10 },
		{ name: "Custom B", frequency: 0, games: 10 },
	]);
	const types = new Set<string>();
	for (let i = 0; i < 50; i++) {
		types.add(injury(DEFAULT_LEVEL).type);
	}
	assert.isFalse(types.has("Custom A"));
	assert.isTrue([...types].every((type) => defaultNames.has(type)));
	assert.isAbove(types.size, 1);

	// A usable list is still used
	g.setWithoutSavingToDB("injuries", [
		{ name: "Custom A", frequency: 0, games: 10 },
		{ name: "Custom B", frequency: 1, games: 10 },
	]);
	assert.strictEqual(injury(DEFAULT_LEVEL).type, "Custom B");
});

test("never a 0-game injury", () => {
	g.setWithoutSavingToDB("injuries", [
		{ name: "Tiny", frequency: 1, games: 0.3 },
	]);
	let neutral: number | undefined;
	for (let i = 0; i < 50; i++) {
		const inj = injury(DEFAULT_LEVEL, {
			extraFactor: 1,
			onNeutral: (games) => {
				neutral = games;
			},
		});
		assert.strictEqual(inj.gamesRemaining, 1);
		assert.strictEqual(neutral, 1);
	}
});
