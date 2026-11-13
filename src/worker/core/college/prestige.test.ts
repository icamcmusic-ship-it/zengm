import { assert, describe, test } from "vitest";
import { prestigeDeltas } from "./offseason.ts";

describe("college prestige", () => {
	test("a league of strong programs doesn't sink: results average zero", () => {
		// Power conference schools: all near 93, half of them winning
		const rows = Array.from({ length: 20 }, (_, i) => ({
			current: 90 + (i % 7),
			base: 90 + (i % 7),
			winp: i % 2 === 0 ? 0.65 : 0.35,
			playoffRoundsWon: i < 8 ? i % 3 : -1,
		}));
		const deltas = prestigeDeltas(rows, 5);
		const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
		assert.closeTo(mean, 0, 1e-9);
		// Winning still beats losing, and the tournament still counts
		assert.isAbove(deltas[0]!, deltas[1]!);
		assert.isAbove(deltas[2]!, deltas[18]!);
	});

	test("expectations from the league's average prestige, and a pull back to the base", () => {
		const rows = [
			{ current: 95, base: 95, winp: 0.5, playoffRoundsWon: -1 },
			{ current: 85, base: 85, winp: 0.5, playoffRoundsWon: -1 },
			{ current: 80, base: 90, winp: 0.5, playoffRoundsWon: -1 },
		];
		const deltas = prestigeDeltas(rows, 5);
		// The same record is worth less to the program that was expected to win more
		assert.isBelow(deltas[0]!, deltas[1]!);
		// Below its base: pulled back up
		assert.isAbove(deltas[2]!, deltas[1]!);
	});
});
