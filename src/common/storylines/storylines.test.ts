import { describe, expect, test } from "vitest";
import { diversify, findStories, plainText, stints } from "./index.ts";
import { makeLeague } from "../wrapped/fixture.ts";

describe("storylines", () => {
	test("diversify spreads kinds", () => {
		const mk = (kind: string, score: number) => ({
			id: kind + score,
			kind,
			shape: "career" as const,
			season: 1,
			score,
			headline: "",
			body: "",
			evidence: [],
			pids: [],
			tids: [],
		});
		const out = diversify([
			mk("a", 100),
			mk("a", 99),
			mk("a", 98),
			mk("b", 90),
		]);
		expect(out.map((s) => s.kind)).toEqual(["a", "b", "a", "a"]);
	});
	test("plainText strips link tokens", () => {
		expect(
			plainText("[[p:3|Joe Smith]] beat the [[t:1:2030|Boston Celtics]]"),
		).toBe("Joe Smith beat the Boston Celtics");
	});
	test("stints merges consecutive seasons", () => {
		const L = makeLeague(3);
		const st = stints(L.players[0]!);
		expect(st.length).toBe(1);
		expect(st[0]!.to - st[0]!.from).toBe(2);
	});
	test("finds clean, sorted, deterministic stories", () => {
		const L = makeLeague(6);
		// a one-team legend needs 10 seasons, a drought 10 years; add a homecoming by hand
		const p = L.players[5]!;
		p.stats = p.stats.map((r, i) => ({
			...r,
			tid: i === 3 ? 2 : i === 4 ? 3 : r.tid,
		}));
		const stories = findStories(L);
		expect(stories.length).toBeGreaterThan(0);
		// within a kind, biggest first
		for (const k of new Set(stories.map((s) => s.kind))) {
			const sc = stories.filter((s) => s.kind === k).map((s) => s.score);
			expect([...sc].sort((a, b) => b - a)).toEqual(sc);
		}
		expect(JSON.stringify(stories)).not.toMatch(/undefined|NaN/);
		expect(findStories(L)).toEqual(stories);
		expect(new Set(stories.map((s) => s.id)).size).toBe(stories.length);
	});
});
