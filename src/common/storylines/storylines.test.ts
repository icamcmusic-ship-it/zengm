import { describe, expect, test } from "vitest";
import { findStories, plainText, stints } from "./index.ts";
import { makeLeague } from "../wrapped/fixture.ts";

describe("storylines", () => {
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
		for (let i = 1; i < stories.length; i++) {
			expect(stories[i - 1]!.score).toBeGreaterThanOrEqual(stories[i]!.score);
		}
		expect(JSON.stringify(stories)).not.toMatch(/undefined|NaN/);
		expect(findStories(L)).toEqual(stories);
		expect(new Set(stories.map((s) => s.id)).size).toBe(stories.length);
	});
});
