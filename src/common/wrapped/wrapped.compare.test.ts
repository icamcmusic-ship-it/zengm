import { describe, expect, test } from "vitest";
import {
	matchCands,
	parseSide,
	sideLabel,
	sideSlides,
	sideSpec,
	statRows,
	tally,
	validSides,
	type Side,
} from "./compare.ts";
import { makeRichLeague } from "./fixture.ts";
import { LeagueIndex } from "./league.ts";
import type { Slide } from "./types.ts";
import { isBadText } from "./util.ts";

const L = makeRichLeague(10);
const X = new LeagueIndex(L);
const season = L.season - 1;

const slide = (id: string, score: number): Slide => ({
	id,
	group: id,
	theme: "t",
	score,
	kicker: "k",
	heads: [id],
	lines: [],
});

describe("compare specs", () => {
	test("parse and print", () => {
		expect(parseSide("p12-2040")).toEqual({ k: "p", id: 12, season: 2040 });
		expect(parseSide("t5-2033")).toEqual({ k: "t", id: 5, season: 2033 });
		expect(parseSide("s2040")).toEqual({ k: "s", season: 2040 });
		expect(parseSide("x1-2")).toBeUndefined();
		expect(parseSide("p12")).toBeUndefined();
		expect(parseSide(undefined)).toBeUndefined();
		for (const s of ["p12-2040", "t5-2033", "s2040"]) {
			expect(sideSpec(parseSide(s)!)).toBe(s);
		}
	});
	test("validation", () => {
		const a: Side = { k: "p", id: 6, season };
		expect(validSides(X, a, { k: "t", id: 1, season })).toMatch(/of a kind/);
		expect(validSides(X, a, { k: "p", id: 6, season: 1900 })).toMatch(
			/no 1900 season/,
		);
		expect(
			validSides(X, { k: "t", id: 99, season }, { k: "t", id: 1, season }),
		).toMatch(/did not play/);
		expect(
			validSides(X, { k: "t", id: 2, season }, { k: "t", id: 1, season }),
		).toBeUndefined();
	});
});

describe("matching", () => {
	test("pairs, evens and exclusives", () => {
		const m = matchCands(
			[slide("x", 0.9), slide("y", 0.5), slide("only-a", 0.7)],
			[slide("x", 0.4), slide("y", 0.51), slide("only-b", 0.6)],
		);
		expect(m.both.map((p) => [p.id, p.win])).toEqual([
			["x", "a"],
			["y", "even"],
		]);
		expect(m.onlyA.map((s) => s.id)).toEqual(["only-a"]);
		expect(m.onlyB.map((s) => s.id)).toEqual(["only-b"]);
		expect(tally(m)).toEqual({
			both: 2,
			a: 1,
			b: 0,
			even: 1,
			onlyA: 1,
			onlyB: 1,
		});
	});
});

describe("two sides of each kind", () => {
	const pairs: [Side, Side][] = [
		[
			{ k: "p", id: 6, season },
			{ k: "p", id: 7, season },
		],
		[
			{ k: "p", id: 6, season },
			{ k: "p", id: 6, season: season - 2 },
		],
		[
			{ k: "t", id: 1, season },
			{ k: "t", id: 2, season },
		],
		[
			{ k: "t", id: 1, season },
			{ k: "t", id: 1, season: season - 3 },
		],
		[
			{ k: "s", season },
			{ k: "s", season: season - 4 },
		],
	];
	for (const [a, b] of pairs) {
		test(`${sideSpec(a)} vs ${sideSpec(b)}`, () => {
			expect(validSides(X, a, b)).toBeUndefined();
			const sa = sideSlides(X, a);
			const sb = sideSlides(X, b);
			expect(sa.length).toBeGreaterThan(5);
			const m = matchCands(sa, sb);
			expect(m.both.length).toBeGreaterThan(0);
			const t = tally(m);
			expect(t.a + t.b + t.even).toBe(t.both);
			for (const s of [...sa, ...sb]) {
				expect(s.head).toBeTruthy();
				expect(s.id).not.toBe("intro");
			}
			const rows = statRows(X, a, b);
			expect(rows.length).toBeGreaterThan(3);
			expect(
				isBadText(rows.map((r) => `${r.label} ${r.a} ${r.b}`).join(" ")),
			).toBe(false);
			expect(isBadText(sideLabel(X, a))).toBe(false);
			for (const r of rows) {
				if (r.a === "–" || r.b === "–") {
					expect(r.better).toBeNull();
				}
			}
			// deterministic
			expect(sideSlides(X, a)).toEqual(sa);
		});
	}
});
