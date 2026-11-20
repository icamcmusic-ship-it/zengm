import { assert, describe, test } from "vitest";
import {
	MOV_SCALE,
	getPowerRankingsScore,
	parseLastTen,
} from "./powerRankings.ts";

describe("power rankings score", () => {
	test("parses last ten records", () => {
		assert.deepEqual(parseLastTen("7-3"), { won: 7, played: 10 });
		assert.deepEqual(parseLastTen("2-1"), { won: 2, played: 3 });
		assert.deepEqual(parseLastTen("5-3-2"), { won: 5, played: 10 });
		assert.deepEqual(parseLastTen("0-0"), { won: 0, played: 0 });
		assert.deepEqual(parseLastTen(""), { won: 0, played: 0 });
	});

	test("full last ten matches the old formula (-10 + 2 * wins)", () => {
		const base = {
			mov: 4,
			gp: 41,
			numGames: 82,
			ovr: 55,
		};
		for (let won = 0; won <= 10; won++) {
			const score = getPowerRankingsScore({
				...base,
				lastTen: `${won}-${10 - won}`,
			});
			const old =
				(MOV_SCALE * base.mov * base.gp) / base.numGames +
				base.ovr * 0.6 -
				30 +
				(-10 + 2 * won);
			assert.closeTo(score, old, 1e-9);
		}
	});

	test("last ten is normalized by games played", () => {
		const base = { mov: 0, gp: 3, numGames: 82, ovr: 50 };
		const unbeaten = getPowerRankingsScore({ ...base, lastTen: "3-0" });
		const tenAndOh = getPowerRankingsScore({ ...base, lastTen: "10-0" });
		assert.closeTo(unbeaten, tenAndOh, 1e-9);
		// No games: no recent record term at all (not -10)
		const none = getPowerRankingsScore({ ...base, gp: 0, lastTen: "0-0" });
		assert.closeTo(none, 0, 1e-9);
		// A 2-1 team ranks above a 1-2 team with everything else equal
		assert.isAbove(
			getPowerRankingsScore({ ...base, lastTen: "2-1" }),
			getPowerRankingsScore({ ...base, lastTen: "1-2" }),
		);
	});

	test("rating term uses the rating passed (callers pass the injury-aware one)", () => {
		const base = { mov: 0, gp: 0, numGames: 82, lastTen: "0-0" };
		assert.isAbove(
			getPowerRankingsScore({ ...base, ovr: 60 }),
			getPowerRankingsScore({ ...base, ovr: 50 }),
		);
	});

	test("MOV scale is 1 in basketball", () => {
		if (__SPORT === "basketball") {
			assert.strictEqual(MOV_SCALE, 1);
		} else if (__SPORT === "hockey" || __SPORT === "baseball") {
			assert.isAbove(MOV_SCALE, 1);
		}
	});
});
