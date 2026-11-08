import { assert, describe, test } from "vitest";
import "../../util/index.ts";
import "../index.ts";
import {
	SCOUTING_ACTIONS,
	applyScouting,
	getScoutingPointsForLevel,
	getUncertainty,
} from "./scouting.ts";
import { MAX_LEVEL, DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";

describe("scouting system", () => {
	test("more budget, more points", () => {
		assert.isBelow(
			getScoutingPointsForLevel(1),
			getScoutingPointsForLevel(DEFAULT_LEVEL),
		);
		assert.isBelow(
			getScoutingPointsForLevel(DEFAULT_LEVEL),
			getScoutingPointsForLevel(MAX_LEVEL),
		);
		assert.strictEqual(getScoutingPointsForLevel(MAX_LEVEL), 20);
	});

	test("scouting narrows fuzz and uncertainty", () => {
		const p: any = { ratings: [{ fuzz: 5 }] };
		applyScouting(p, "scout", 2025);
		assert.closeTo(p.ratings[0].fuzz, 5 * SCOUTING_ACTIONS.scout.factor, 1e-9);
		assert.strictEqual(p.scouting[0].fuzzBefore, 5);
		applyScouting(p, "workout", 2025);
		assert.isBelow(Math.abs(p.ratings[0].fuzz), 1);
		assert.isBelow(getUncertainty(p.scouting), getUncertainty([]));
		assert.isBelow(getUncertainty(p.scouting), 1);

		// Negative fuzz shrinks toward 0 too
		const q: any = { ratings: [{ fuzz: -4 }] };
		applyScouting(q, "scout", 2025);
		assert.closeTo(q.ratings[0].fuzz, -2.4, 1e-9);
	});
});
