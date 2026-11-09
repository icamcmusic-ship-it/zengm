import { describe, expect, test } from "vitest";
import {
	hypeRivalryPoints,
	rivalryDecay,
	rivalryLines,
	rivalryScore,
	rivalryTimeline,
	seriesWeight,
	type RivalSeries,
} from "./index.ts";

const ser = (
	season: number,
	round: number,
	winner: number,
	wLost: number,
	extra: Partial<RivalSeries> = {},
): RivalSeries => ({
	season,
	round,
	numRounds: 4,
	winner,
	loser: winner === 0 ? 1 : 0,
	wWon: 4,
	wLost,
	...extra,
});

describe("rivalry score", () => {
	test("later rounds, long series and upsets weigh more", () => {
		expect(seriesWeight(ser(2020, 3, 0, 0))).toBeGreaterThan(
			seriesWeight(ser(2020, 0, 0, 0)),
		);
		expect(seriesWeight(ser(2020, 0, 0, 3))).toBeGreaterThan(
			seriesWeight(ser(2020, 0, 0, 0)),
		);
		expect(
			seriesWeight(ser(2020, 0, 0, 1, { wSeed: 8, lSeed: 1 })),
		).toBeGreaterThan(seriesWeight(ser(2020, 0, 0, 1, { wSeed: 1, lSeed: 8 })));
	});

	test("history decays", () => {
		expect(rivalryDecay(0)).toBe(1);
		expect(rivalryDecay(6)).toBeCloseTo(0.5);
		const base = { a: 0, b: 1, rs: [] };
		const recent = rivalryScore({
			...base,
			season: 2030,
			series: [ser(2029, 2, 0, 3)],
		});
		const old = rivalryScore({
			...base,
			season: 2050,
			series: [ser(2029, 2, 0, 3)],
		});
		expect(recent.score).toBeGreaterThan(old.score);
		expect(recent.parts.recent).toBe(3);
		expect(old.parts.recent).toBe(0);
	});

	test("close games, division, star duels and even regular seasons add", () => {
		const base = { a: 0, b: 1, season: 2030, series: [] };
		const none = rivalryScore({ ...base, rs: [] });
		expect(none.score).toBe(0);
		expect(none.tier).toBe("None");
		const s = rivalryScore({
			...base,
			rs: [{ season: 2030, aW: 2, bW: 2, tied: 0 }],
			closeGames: [{ season: 2030 }, { season: 2030 }],
			sameDiv: true,
			starDuels: [2030],
		});
		expect(s.parts.regularSeason).toBe(1);
		expect(s.parts.close).toBe(1.2);
		expect(s.parts.geography).toBe(3);
		expect(s.parts.stars).toBe(2);
		// a lopsided season counts for nothing
		expect(
			rivalryScore({ ...base, rs: [{ season: 2030, aW: 4, bW: 0, tied: 0 }] })
				.parts.regularSeason,
		).toBe(0);
	});

	test("timeline and lines", () => {
		const input = {
			a: 0,
			b: 1,
			season: 2031,
			series: [ser(2029, 3, 0, 3), ser(2030, 3, 1, 2), ser(2031, 3, 0, 1)],
			rs: [
				{ season: 2029, aW: 2, bW: 1, tied: 0 },
				{ season: 2030, aW: 0, bW: 3, tied: 0 },
			],
		};
		const tl = rivalryTimeline(input);
		expect(tl.map((r) => r.season)).toEqual([2029, 2030, 2031]);
		expect(tl.map((r) => r.cum)).toEqual([1, -2, -2]);
		expect(tl[2]!.score).toBe(rivalryScore(input).score);
		const lines = rivalryLines(input, (tid) => `T${tid}`);
		expect(lines[0]).toBe(
			"The T0 and T1 have met 3 times in the playoffs, from 2029 to 2031, every one of them in the Finals.",
		);
		expect(lines).toContain("The T0 lead 2-1 in series.");
	});

	test("hype points come from the same score", () => {
		expect(hypeRivalryPoints([], 2030, false)).toBe(0);
		const one = hypeRivalryPoints([ser(2020, 0, 0, 0)], 2030, false);
		const fresh = hypeRivalryPoints([ser(2029, 3, 0, 3)], 2030, false);
		expect(fresh).toBeGreaterThan(one);
		expect(hypeRivalryPoints([ser(2029, 3, 0, 3)], 2030, true)).toBe(fresh + 3);
	});
});
