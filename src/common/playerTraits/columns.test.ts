import { assert, test } from "vitest";
import { getCols } from "../getCols.ts";
import {
	allFilters,
	getExtraStatTypeKeys,
	getStats,
} from "../advancedPlayerSearch.ts";
import { TRAIT_KEYS, type TraitScores } from "./index.ts";

test("every trait has a table column", () => {
	for (const key of TRAIT_KEYS) {
		const [col] = getCols([`trait:${key}`]);
		assert.isAbove(col!.title.length, 1);
		assert.include(col!.desc!, "trait");
	}
});

test("advanced player search: traits category filters and shows the scores", () => {
	assert.deepStrictEqual(Object.keys(allFilters.traits!.options), [
		...TRAIT_KEYS,
	]);
	assert.deepStrictEqual(getStats("traits"), [...TRAIT_KEYS]);
	assert.deepStrictEqual(getExtraStatTypeKeys(["traits"]).traits, [
		...TRAIT_KEYS,
	]);
	assert.deepStrictEqual(getExtraStatTypeKeys(["traits"]).stats, []);

	const scores = Object.fromEntries(
		TRAIT_KEYS.map((k, i) => [k, i * 10]),
	) as TraitScores;
	for (const [i, key] of TRAIT_KEYS.entries()) {
		const info = allFilters.traits!.options[key]!;
		assert.strictEqual(info.category, "traits");
		assert.strictEqual(info.valueType, "numeric");
		assert.strictEqual(info.colKey, `trait:${key}`);
		assert.strictEqual(
			info.getValue({ traitScores: scores } as any, "singleSeason"),
			i * 10,
		);
		// No traits (setting off): nothing to match
		assert.isUndefined(info.getValue({} as any, "singleSeason"));
	}
});
