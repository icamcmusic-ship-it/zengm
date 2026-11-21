import { assert, describe, test } from "vitest";
import type { CollegeFieldTeam } from "../../../common/college/types.ts";
import { buildNationalBracket } from "./postseason.ts";

// A region's teams, tids region * 100 + seed
const regionField = (region: number, seeds: number[]): CollegeFieldTeam[] =>
	seeds.map((seed, i) => ({
		tid: region * 100 + seed + (seeds.indexOf(seed) === i ? 0 : 50),
		seed,
		region,
		bid: "at-large",
		overall: seed * 4 + region + i,
	}));

const range = (a: number, b: number) =>
	Array.from({ length: b - a + 1 }, (_, i) => a + i);

const cids = new Map<number, number>();

const pairs = (series: ReturnType<typeof buildNationalBracket>["series"]) =>
	series[0]!.map((m) => [m.home.seed, m.away?.seed]);

describe("buildNationalBracket", () => {
	test("full field: 1 v 8, 4 v 5, 2 v 7, 3 v 6 in each region", () => {
		const field = [
			...regionField(0, range(1, 8)),
			...regionField(1, range(1, 8)),
		];
		const { series, placed } = buildNationalBracket(field, 4, cids);
		assert.strictEqual(series.length, 4);
		assert.strictEqual(placed.length, 16);
		assert.deepEqual(pairs(series), [
			[1, 8],
			[4, 5],
			[2, 7],
			[3, 6],
			[1, 8],
			[4, 5],
			[2, 7],
			[3, 6],
		]);
		// Unknown cid: -1 rather than undefined
		assert.strictEqual(series[0]![0]!.home.cid, -1);
	});

	test("0 rounds: no tournament", () => {
		const { series, placed } = buildNationalBracket(
			regionField(0, range(1, 4)),
			0,
			cids,
		);
		assert.deepEqual(series, []);
		assert.deepEqual(placed, []);
	});

	test("empty field: clear error", () => {
		assert.throws(
			() => buildNationalBracket([], 3, cids),
			/College national tournament: no teams/,
		);
	});

	test("missing seed: worse seeds move up a line, the top seed gets a bye", () => {
		const field = regionField(0, [1, 2, 4, 5, 6, 7, 8]);
		const { series, placed } = buildNationalBracket(field, 3, cids);
		assert.strictEqual(placed.length, 7);
		assert.deepEqual(pairs(series), [
			[1, undefined],
			[5, 6],
			[2, 8],
			[4, 7],
		]);
	});

	test("duplicate seed keeps both teams", () => {
		const field = regionField(0, [1, 2, 3, 3]);
		const { series, placed } = buildNationalBracket(field, 2, cids);
		assert.strictEqual(placed.length, 4);
		assert.strictEqual(
			new Set(series[0]!.flatMap((m) => [m.home.tid, m.away?.tid])).size,
			4,
		);
	});

	test("field bigger than the bracket: the worst seeds are left out", () => {
		const { series, placed } = buildNationalBracket(
			regionField(0, range(1, 16)),
			3,
			cids,
		);
		assert.strictEqual(placed.length, 8);
		assert.strictEqual(series[0]!.length, 4);
		assert.isTrue(placed.every((t) => t.seed <= 8));
	});

	test("more rounds than the field fills: byes", () => {
		const { series } = buildNationalBracket(
			regionField(0, range(1, 4)),
			3,
			cids,
		);
		assert.deepEqual(pairs(series), [
			[1, undefined],
			[4, undefined],
			[2, undefined],
			[3, undefined],
		]);
	});

	test("too few teams for the bracket: clear error", () => {
		assert.throws(
			() => buildNationalBracket(regionField(0, [1, 2]), 3, cids),
			/region 1 has 2 teams, but needs at least 4/,
		);
	});

	test("region count that can't split the bracket: one region in seed order", () => {
		// 3 regions for an 8 team bracket
		const field = [
			...regionField(0, [1, 2, 3]),
			...regionField(1, [1, 2, 3]),
			...regionField(2, [1, 2]),
		];
		const { series, placed } = buildNationalBracket(field, 3, cids);
		assert.strictEqual(placed.length, 8);
		assert.strictEqual(series[0]!.length, 4);
		assert.isTrue(series[0]!.every((m) => m.away !== undefined));
	});
});
