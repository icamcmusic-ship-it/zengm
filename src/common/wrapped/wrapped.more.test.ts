import { describe, expect, test } from "vitest";
import { BASE_TOPICS, buildDeck, candidates, EXTRA_TOPICS } from "./build.ts";
import { isClean } from "./deck.ts";
import { makeRichLeague } from "./fixture.ts";
import { LeagueIndex } from "./league.ts";
import type { Slide, WrappedMode } from "./types.ts";
import { isBadText } from "./util.ts";

const L = makeRichLeague(12);
const X = new LeagueIndex(L);

// Every slide the extra topics produce across a spread of subjects
const fired = (mode: WrappedMode, extraOnly: boolean) => {
	const ids = new Set<string>();
	const slides: Slide[] = [];
	const subjects: { season: number; tid?: number; pid?: number }[] = [];
	for (const season of X.seasons) {
		if (mode === "season") {
			subjects.push({ season });
		} else if (mode === "team") {
			for (let tid = 0; tid < 8; tid++) {
				subjects.push({ season, tid });
			}
		} else if (mode === "player") {
			for (let pid = 0; pid < 220; pid += 4) {
				subjects.push({ season, pid });
			}
		}
	}
	if (mode === "all") {
		subjects.push({ season: L.season });
	}
	const base = new Set<string>();
	for (const sub of subjects) {
		const ctx = { X, mode, soFar: !X.decided(sub.season), ...sub };
		for (const t of BASE_TOPICS[mode]) {
			const r = t(ctx);
			for (const s of Array.isArray(r) ? r : r ? [r] : []) {
				base.add(s.id);
			}
		}
		for (const s of candidates(ctx)) {
			if (!extraOnly || !base.has(s.id)) {
				ids.add(s.id);
				slides.push(s);
			}
		}
	}
	return { ids, slides, base };
};

describe("extra topics", () => {
	const counts: Record<string, number> = {};
	for (const [mode, min] of [
		["season", 40],
		["team", 35],
		["player", 45],
		["all", 25],
	] as const) {
		test(`${mode}: many extra slide ids fire and none has bad text`, () => {
			const { ids, slides } = fired(mode, true);
			counts[mode] = ids.size;
			expect(ids.size).toBeGreaterThanOrEqual(min);
			for (const s of slides) {
				expect(isClean(s), `${mode}:${s.id}`).toBe(true);
				expect(isBadText(JSON.stringify(s)), `${mode}:${s.id}`).toBe(false);
				expect(s.score).toBeGreaterThanOrEqual(0);
				expect(s.score).toBeLessThanOrEqual(1.0001);
			}
		}, 60000);
	}
	test("together they add 150+ slide kinds", () => {
		const total = Object.values(counts).reduce((a, b) => a + b, 0);
		expect(total).toBeGreaterThanOrEqual(150);
	});
	test("extra topic lists are non-empty", () => {
		for (const m of ["season", "team", "player", "all"] as const) {
			expect(EXTRA_TOPICS[m].length).toBeGreaterThan(10);
		}
	});
});

describe("decks with the extra topics", () => {
	for (const [mode, extra] of [
		["season", {}],
		["team", { tid: 2 }],
		["player", { pid: 6 }],
		["all", {}],
	] as const) {
		test(`${mode}: deterministic, no repeated facts, group caps`, () => {
			const a = buildDeck(L, { mode, season: L.season - 1, ...extra, n: 30 });
			const b = buildDeck(L, { mode, season: L.season - 1, ...extra, n: 30 });
			expect(a).toEqual(b);
			expect(isBadText(JSON.stringify(a))).toBe(false);
			const groups = new Map<string, number>();
			for (const s of a.slides) {
				groups.set(s.group, (groups.get(s.group) ?? 0) + 1);
			}
			for (const [g, n] of groups) {
				if (g !== "intro" && g !== "summary") {
					expect(n, g).toBeLessThanOrEqual(3);
				}
			}
			const ids = a.slides.map((s) => s.id);
			expect(new Set(ids).size).toBe(ids.length);
		});
	}
	test("different seasons get different decks", () => {
		const a = buildDeck(L, { mode: "season", season: L.season - 1, n: 20 });
		const b = buildDeck(L, { mode: "season", season: L.season - 3, n: 20 });
		expect(a.slides.map((s) => s.id)).not.toEqual(b.slides.map((s) => s.id));
	});
	test("in-progress season shows no awards, champion or playoff-only slides", () => {
		const L2 = { ...makeRichLeague(6), currentComplete: false };
		const X2 = new LeagueIndex(L2);
		for (const [mode, extra] of [
			["season", {}],
			["team", { tid: 1 }],
			["player", { pid: 6 }],
		] as const) {
			const d = buildDeck(X2, { mode, season: L2.season, ...extra, n: 30 });
			expect(d.soFar).toBe(true);
			const ids = d.slides.map((s) => s.id);
			for (const bad of [
				"champ",
				"mvp",
				"s-champrun",
				"s-champpay",
				"s-repeat",
				"s-newchamp",
				"s-gameseven",
				"s-chalk",
				"s-allleague",
				"s-mvpws",
				"s-mvpage",
				"p-ring",
				"p-pogames",
				"t-upset",
				"t-rival",
				"t-draftclass",
			]) {
				expect(ids, bad).not.toContain(bad);
			}
		}
	});
	test("without box scores or optional stats nothing breaks and highs come from stat rows", () => {
		const L3 = makeRichLeague(6);
		L3.games = [];
		for (const p of L3.players) {
			for (const r of [...p.stats, ...p.po]) {
				delete r.pm;
				delete r.ortg;
				delete r.usgp;
				delete r.dd;
			}
			delete p.paid;
			delete p.pot;
		}
		for (const t of L3.teamSeasons) {
			delete t.wonHome;
			delete t.payroll;
			delete t.att;
		}
		const X3 = new LeagueIndex(L3);
		const ids = new Set<string>();
		for (let pid = 0; pid < 80; pid += 2) {
			for (const s of candidates({ X: X3, mode: "player", season: L3.season, pid, soFar: false })) {
				expect(isBadText(JSON.stringify(s))).toBe(false);
				ids.add(s.id);
			}
		}
		expect([...ids].some((i) => i.startsWith("p-hi-"))).toBe(true);
		expect(ids.has("p-plusminus")).toBe(false);
		for (const mode of ["season", "team", "all"] as const) {
			const d = buildDeck(X3, { mode, season: L3.season, tid: 1, n: 30 });
			expect(isBadText(JSON.stringify(d))).toBe(false);
		}
	});
});
