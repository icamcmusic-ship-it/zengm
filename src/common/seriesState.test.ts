import { assert, describe, test } from "vitest";
import { seriesGameState } from "./seriesState.ts";
import { planMinutes } from "../worker/core/GameSim.basketball/rotationPlanner.ts";

const roster = Array.from({ length: 13 }, (_, i) => ({
	valueNoPot: 70 - 2 * i,
	injured: false,
	ptModifier: 1,
}));

const plan = (seriesUrgency: number | undefined, playoffs = true) =>
	planMinutes(roster, {
		playoffs,
		backToBack: false,
		numPlayersOnCourt: 5,
		allStarGame: false,
		seriesUrgency,
	});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("playoff series state", () => {
	test("decider, elimination, up 3-0 and normal games", () => {
		assert.strictEqual(
			seriesGameState({ homeWon: 3, awayWon: 3, numToWin: 4 }).kind,
			"decider",
		);
		const elim = seriesGameState({ homeWon: 2, awayWon: 3, numToWin: 4 });
		assert.strictEqual(elim.kind, "elimination");
		assert.deepEqual(elim.urgency, [0.8, 0]);
		assert.isAbove(elim.crowdBoost, 0);
		const sweep = seriesGameState({ homeWon: 3, awayWon: 0, numToWin: 4 });
		assert.strictEqual(sweep.kind, "comfortable");
		assert.deepEqual(sweep.urgency, [-0.5, 0.8]);
		assert.strictEqual(
			seriesGameState({ homeWon: 1, awayWon: 1, numToWin: 4 }).kind,
			"normal",
		);
		// Single games and best-of-3 series are left alone
		assert.strictEqual(
			seriesGameState({ homeWon: 0, awayWon: 0, numToWin: 1 }).kind,
			"normal",
		);
		assert.strictEqual(
			seriesGameState({ homeWon: 1, awayWon: 1, numToWin: 2 }).kind,
			"normal",
		);
	});

	test("rotations: a Game 7 tightens, up 3-0 rests the stars, the minutes still add up, the regular season is untouched", () => {
		const normal = plan(0);
		const game7 = plan(1);
		const rest = plan(-0.5);
		for (const targets of [normal, game7, rest]) {
			assert.closeTo(sum(targets), 240, 0.5);
		}
		assert.isAtLeast(game7[0]!, 44);
		assert.isAbove(game7[0]!, normal[0]!);
		assert.isBelow(game7[7]!, normal[7]!);
		assert.isBelow(rest[0]!, normal[0]!);
		assert.isAbove(rest[7]!, normal[7]!);
		assert.deepEqual(plan(1, false), plan(undefined, false));
	});
});
