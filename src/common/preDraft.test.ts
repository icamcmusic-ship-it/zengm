import { assert, describe, test } from "vitest";
import { PLAYER } from "./constants.ts";
import {
	getPreDraftAwards,
	getPreDraftStats,
	getProAwards,
	getProStats,
	hasPreDraftStats,
	isPreDraftAward,
	isPreDraftStatsRow,
} from "./preDraft.ts";

describe("isPreDraftStatsRow", () => {
	test("DNE rows up to and including the draft year are pre-draft", () => {
		assert.strictEqual(
			isPreDraftStatsRow({ tid: PLAYER.DOES_NOT_EXIST, season: 2023 }, 2025),
			true,
		);
		assert.strictEqual(
			isPreDraftStatsRow({ tid: PLAYER.DOES_NOT_EXIST, season: 2025 }, 2025),
			true,
		);
	});

	test("DNE rows after the draft year are real pro seasons (imported, or defunct team)", () => {
		assert.strictEqual(
			isPreDraftStatsRow({ tid: PLAYER.DOES_NOT_EXIST, season: 2026 }, 2025),
			false,
		);
	});

	test("rows with a real tid are never pre-draft", () => {
		assert.strictEqual(
			isPreDraftStatsRow({ tid: 3, season: 2020 }, 2025),
			false,
		);
		assert.strictEqual(
			isPreDraftStatsRow({ tid: PLAYER.TOT, season: 2020 }, 2025),
			false,
		);
	});

	test("unknown draft year means nothing is pre-draft", () => {
		for (const draftYear of [0, undefined, null, Number.NaN]) {
			assert.strictEqual(
				isPreDraftStatsRow(
					{ tid: PLAYER.DOES_NOT_EXIST, season: 2020 },
					draftYear,
				),
				false,
			);
		}
	});
});

describe("isPreDraftAward", () => {
	test("simple awards at or before the draft year are pre-draft", () => {
		assert.strictEqual(
			isPreDraftAward({ season: 2025, type: "College: All-American" }, 2025),
			true,
		);
		assert.strictEqual(
			isPreDraftAward({ season: 2026, type: "All-Star" }, 2025),
			false,
		);
	});

	test("built-in awards are never pre-draft", () => {
		assert.strictEqual(
			isPreDraftAward({ season: 2020, type: undefined }, 2025),
			false,
		);
	});

	test("unknown draft year", () => {
		assert.strictEqual(
			isPreDraftAward({ season: 2020, type: "Foo" }, undefined),
			false,
		);
	});
});

describe("filter helpers", () => {
	const college = { tid: PLAYER.DOES_NOT_EXIST, season: 2024 };
	const pro = { tid: 1, season: 2026 };
	const proDne = { tid: PLAYER.DOES_NOT_EXIST, season: 2027 };

	test("getProStats / getPreDraftStats split rows", () => {
		const p = { draft: { year: 2025 }, stats: [college, pro, proDne] };
		assert.deepStrictEqual(getProStats(p), [pro, proDne]);
		assert.deepStrictEqual(getPreDraftStats(p), [college]);
		assert.strictEqual(hasPreDraftStats(p), true);
	});

	test("getProStats returns the same array when nothing to remove", () => {
		const p = { draft: { year: 2025 }, stats: [pro] };
		assert.strictEqual(getProStats(p), p.stats);
		assert.strictEqual(hasPreDraftStats(p), false);
	});

	test("awards", () => {
		const a1 = { season: 2025, type: "Foo" };
		const a2 = { season: 2027, type: "All-Star" };
		const p = { draft: { year: 2025 }, awards: [a1, a2] };
		assert.deepStrictEqual(getProAwards(p), [a2]);
		assert.deepStrictEqual(getPreDraftAwards(p), [a1]);
	});
});
