import { describe, expect, test } from "vitest";
import { makeRichLeague as wrappedRich } from "../wrapped/fixture.ts";
import { makeBigLeague } from "../wrapped/fixtureBig.ts";
import { addDeals } from "../wrapped/fixtureDeals.ts";
import { makeLeague } from "../wrapped/fixture.ts";
import { findStories, plainText } from "./index.ts";
import { DEAL_KINDS, qaBody, tapeBody, timelineBody } from "./kindsDeals.ts";
import { makeRichLeague } from "./richFixture.ts";

const leagues = () => [
	makeRichLeague(30),
	wrappedRich(12),
	addDeals(makeBigLeague({ numSeasons: 14, seed: "deals" }), { perSeason: 6 }),
];

describe("front-office storylines", () => {
	const all = leagues().map((L) => findStories(L));
	const names = new Set(DEAL_KINDS.map((k) => k.kind));
	const deal = all.flat().filter((s) => names.has(s.kind));

	test("30+ kinds, nearly all of them fire on the fixtures", () => {
		expect(DEAL_KINDS.length).toBeGreaterThanOrEqual(30);
		const fired = new Set(deal.map((s) => s.kind));
		const missing = [...names].filter((k) => !fired.has(k));
		expect(missing.length, missing.join(", ")).toBeLessThanOrEqual(2);
	});

	test("clean text that ends a sentence", () => {
		for (const s of deal) {
			const text = plainText(`${s.headline} ${s.body} ${s.evidence.flat().join(" ")}`);
			expect(text, s.id).not.toMatch(/\b(undefined|NaN|null|Infinity)\b/);
			expect(text, s.id).not.toMatch(/ {2}|\[\[|]]|\${|\.\./);
			expect(text, s.id).not.toMatch(/\b1 (seasons|games|wins|titles|years|trades|picks)\b/);
			expect(s.body.endsWith("."), s.id).toBe(true);
		}
	});

	test("Q&A, timeline and tale-of-the-tape bodies are used", () => {
		const bodies = deal.map((s) => plainText(s.body));
		expect(bodies.some((b) => /^\w[^.?]*\? /.test(b))).toBe(true);
		expect(bodies.some((b) => /^\d{4}: /.test(b))).toBe(true);
		expect(bodies.some((b) => b.startsWith("Tale of the tape."))).toBe(true);
		expect(qaBody([["Who?", "Him."], ["When?", "Then."]])).toBe("Who? Him. When? Then.");
		expect(timelineBody([[2020, "drafted"], [2022, "traded"]])).toBe("2020: drafted. 2022: traded.");
		expect(tapeBody("Tape", [["A", "1"], ["B", "2"]])).toBe("Tape. A: 1. B: 2.");
	});

	test("deterministic", () => {
		expect(leagues().map((L) => findStories(L))).toEqual(all);
	});

	test("unfinished season: no title or playoff claims from the new kinds", () => {
		const L = { ...wrappedRich(10), currentComplete: false };
		const out = findStories(L).filter((s) => names.has(s.kind) && s.season === L.season);
		for (const s of out) {
			expect(s.shape, s.id).not.toBe("playoffs");
			expect(plainText(`${s.headline} ${s.body}`), s.id).not.toMatch(/champions?|title|playoff/i);
		}
	});

	test("a league without trades, contracts or lotteries finds none of the kinds that need them", () => {
		// These only need the draft, team seasons and transactions
		const ok = new Set(["Relocation", "Homegrown champion", "Champion built by trade", "Drafted, traded, back again", "Draft steal", "Draft bust", "The one they passed on"]);
		const out = findStories(makeLeague(8)).filter((s) => names.has(s.kind) && !ok.has(s.kind));
		expect(out).toEqual([]);
	});
});
