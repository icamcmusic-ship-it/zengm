import { assert, describe, test } from "vitest";
import { draftOutlook, expectedPeakAtPick } from "./draftOutlook.ts";

describe("draftOutlook", () => {
	test("second-round picks are never busts or reaches", () => {
		for (let pick = 31; pick <= 60; pick++) {
			for (const peak of [20, 35, 42, 46, 50]) {
				const o = draftOutlook(peak, pick, 30);
				assert.notInclude(o.label, "Bust");
				assert.notInclude(o.slot!.label, "Reach");
			}
		}
	});

	test("a lottery pick who projects out of the league is a bust risk", () => {
		assert.strictEqual(draftOutlook(40, 3, 30).label, "Bust risk");
	});

	test("no pick: never a bust", () => {
		assert.strictEqual(draftOutlook(38, undefined, 30).label, "Camp invite");
		assert.isUndefined(draftOutlook(38, undefined, 30).slot);
	});

	test("more tiers and slot tags", () => {
		assert.strictEqual(draftOutlook(73, 1, 30).label, "Franchise player");
		assert.strictEqual(draftOutlook(55, 15, 30).label, "Sixth man");
		assert.strictEqual(draftOutlook(66, 40, 30).slot!.label, "Steal");
		assert.strictEqual(draftOutlook(52, 2, 30).slot!.label, "Reach");
	});

	test("expected peak falls from the first pick to the last", () => {
		assert.isAbove(expectedPeakAtPick(1), expectedPeakAtPick(30));
		assert.isAbove(expectedPeakAtPick(30), expectedPeakAtPick(60));
	});

	test("a typical pick reads Fair value in any league size", () => {
		for (const numTeams of [10, 20, 30, 40]) {
			for (const pick of [1, 5, 10, 20, 30, 40, 55]) {
				const o = draftOutlook(
					Math.round(expectedPeakAtPick(pick)),
					pick,
					numTeams,
				);
				assert.strictEqual(o.slot!.label, "Fair value", `${numTeams}/${pick}`);
			}
		}
		// The 30-team scale is unchanged: 66 at #1, 46 at #60
		assert.closeTo(expectedPeakAtPick(1), 66, 1e-9);
		assert.closeTo(expectedPeakAtPick(60), 46, 1e-9);
	});
});
