import { assert, describe, test } from "vitest";
import {
	buildDraftSlotHof,
	matureClassYears,
	type DraftSlotPlayer,
} from "./draftSlotHof.ts";

const cls = (year: number, hofPicks: number[], allStarPicks: number[] = []) => {
	const out: DraftSlotPlayer[] = [];
	for (let round = 1; round <= 2; round++) {
		for (let pick = 1; pick <= 30; pick++) {
			const overall = (round - 1) * 30 + pick;
			out.push({
				year,
				round,
				pick,
				hof: hofPicks.includes(overall),
				allStar: allStarPicks.includes(overall),
			});
		}
	}
	return out;
};

describe("Hall of Fame rate by draft slot", () => {
	test("mature classes: the most seasons back that leaves 3 classes", () => {
		assert.deepEqual(matureClassYears(2000, 2030), {
			mature: 15,
			from: 2000,
			to: 2015,
		});
		// 2000-2002 with 12 seasons
		assert.deepEqual(matureClassYears(2000, 2014), {
			mature: 12,
			from: 2000,
			to: 2002,
		});
		assert.isUndefined(matureClassYears(2000, 2011));
	});

	test("rates by overall pick band, only classes in range, second round counted on", () => {
		const players = [
			...cls(2000, [1, 3], [1, 2, 3, 40]),
			...cls(2001, [1, 45]),
			...cls(2002, []),
			// Too recent: left out
			...cls(2020, [1, 2, 3, 4, 5]),
			// Undrafted: left out
			{ year: 2001, round: 0, pick: 0, hof: true, allStar: true },
		];
		const r = buildDraftSlotHof(players, { from: 2000, to: 2015, mature: 15 })!;
		assert.strictEqual(r.classes, 3);
		assert.strictEqual(r.numPlayers, 180);
		assert.strictEqual(r.numHof, 4);
		const band = (label: string) => r.bands.find((b) => b.label === label)!;
		assert.deepEqual(
			{ n: band("1").n, hof: band("1").hof, allStar: band("1").allStar },
			{ n: 3, hof: 2, allStar: 1 },
		);
		assert.strictEqual(band("2-3").hof, 1);
		assert.strictEqual(band("2-3").allStar, 2);
		assert.strictEqual(band("31-45").hof, 1);
		assert.strictEqual(band("31-45").allStar, 1);
		// The last band ends at the last pick
		assert.strictEqual(r.bands.at(-1)!.label, "46-60");
		assert.strictEqual(
			r.bands.reduce((a, b) => a + b.n, 0),
			r.numPlayers,
		);
	});

	test("nothing drafted in range: undefined", () => {
		assert.isUndefined(
			buildDraftSlotHof(cls(2020, [1]), { from: 2000, to: 2015, mature: 15 }),
		);
	});
});
