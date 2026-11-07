import { describe, expect, test } from "vitest";
import { buildDeck } from "./build.ts";
import { choose, clampCount, CORE, planDeck } from "./deck.ts";
import { makeLeague } from "./fixture.ts";
import type { Slide } from "./types.ts";
import { isBadText, ordinal, polish, rankScore, seededRng } from "./util.ts";

const slide = (id: string, score: number, theme = "a", group = id): Slide => ({
	id,
	score,
	theme,
	group,
	kicker: "k",
	heads: [id],
	lines: [],
});

describe("util", () => {
	test("rankScore", () => {
		expect(rankScore(1, 1000)).toBeCloseTo(1);
		expect(rankScore(1000, 1000)).toBe(0);
		expect(rankScore(1, 1)).toBe(0);
	});
	test("ordinal and polish", () => {
		expect(ordinal(1)).toBe("1st");
		expect(ordinal(12)).toBe("12th");
		expect(ordinal(23)).toBe("23rd");
		expect(polish("1 seasons from 2040 to 2040")).toBe("1 season in 2040");
		expect(polish("He's")).toBe("He’s");
	});
	test("seeded rng is deterministic", () => {
		const a = seededRng("x");
		const b = seededRng("x");
		expect([a(), a()]).toEqual([b(), b()]);
	});
});

describe("deck", () => {
	test("clampCount", () => {
		expect(clampCount("100", "season")).toBe(30);
		expect(clampCount("x", "season")).toBe(16);
		expect(clampCount(1, "team")).toBe(CORE.team.length + 1);
	});
	test("choose respects group and theme caps and facts", () => {
		const cands = [
			slide("a", 0.9, "t1", "g"),
			slide("b", 0.85, "t1", "g"),
			slide("c", 0.8, "t1", "g"),
			slide("d", 0.3, "t2"),
			slide("e", 0.1, "t3"),
		];
		const picks = choose(cands, 3, "seed");
		expect(picks.filter((s) => s.group === "g").length).toBeLessThanOrEqual(2);
		expect(picks.map((s) => s.id)).toContain("d");
		expect(picks.map((s) => s.id)).not.toContain("e");
		const dup = choose(
			[
				{ ...slide("x", 0.9), facts: ["f"] },
				{ ...slide("y", 0.8), facts: ["f"] },
			],
			5,
			"s",
		);
		expect(dup.length).toBe(1);
	});
	test("plan puts core first and summary last, and drops bad text", () => {
		const cands = [
			slide("summary", 1),
			slide("x", 0.5),
			slide("champ", 1),
			slide("intro", 1),
			{ ...slide("bad", 0.9), lines: ["NaN points"] },
		];
		const out = planDeck(cands, "season", 10, "s");
		expect(out.map((s) => s.id)).toEqual(["intro", "champ", "x", "summary"]);
	});
});

describe("buildDeck on a fake league", () => {
	const L = makeLeague(4);
	for (const [mode, extra] of [
		["season", {}],
		["team", { tid: 1 }],
		["player", { pid: 3 }],
		["all", {}],
	] as const) {
		test(mode, () => {
			const d = buildDeck(L, { mode, season: L.season, ...extra, n: 18 });
			expect(d.slides.length).toBeGreaterThan(4);
			expect(d.slides[0]!.id).toBe("intro");
			expect(d.slides.at(-1)!.id).toBe("summary");
			const text = JSON.stringify(d.slides);
			expect(isBadText(text)).toBe(false);
			// deterministic
			expect(buildDeck(L, { mode, season: L.season, ...extra, n: 18 })).toEqual(
				d,
			);
		});
	}
	test("in-progress season hides the champion and MVP", () => {
		const L2 = { ...makeLeague(3), currentComplete: false };
		const d = buildDeck(L2, { mode: "season", season: L2.season });
		expect(d.soFar).toBe(true);
		expect(d.slides.map((s) => s.id)).not.toContain("champ");
		expect(d.slides.map((s) => s.id)).not.toContain("mvp");
	});
});
