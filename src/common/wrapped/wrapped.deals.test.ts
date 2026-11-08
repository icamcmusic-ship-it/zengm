import { describe, expect, test } from "vitest";
import { buildDeck, candidates, DEAL_TOPICS } from "./build.ts";
import { isClean } from "./deck.ts";
import { tradeEvals } from "./deals.ts";
import { makeLeague, makeRichLeague } from "./fixture.ts";
import { LeagueIndex } from "./league.ts";
import type { Slide, WrappedMode } from "./types.ts";
import { isBadText } from "./util.ts";

const L = makeRichLeague(12);
const X = new LeagueIndex(L);

const subjects = (mode: WrappedMode) => {
	const out: { season: number; tid?: number; pid?: number }[] = [];
	for (const season of mode === "all" ? [L.season] : X.seasons) {
		if (mode === "team") {
			for (let tid = 0; tid < 8; tid++) {
				out.push({ season, tid });
			}
		} else if (mode === "player") {
			for (let pid = 0; pid < 240; pid += 4) {
				out.push({ season, pid });
			}
		} else {
			out.push({ season });
		}
	}
	return out;
};

const fire = (mode: WrappedMode, x = X) => {
	const slides: Slide[] = [];
	for (const sub of subjects(mode)) {
		const ctx = { X: x, mode, soFar: mode !== "all" && !x.decided(sub.season), ...sub };
		for (const t of DEAL_TOPICS[mode]) {
			const r = t(ctx);
			slides.push(...(Array.isArray(r) ? r : r ? [r] : []));
		}
	}
	return slides;
};

describe("front-office topics", () => {
	const ids = new Set<string>();
	for (const mode of ["season", "team", "player", "all"] as const) {
		test(`${mode}: fire with clean text and sane scores`, () => {
			const slides = fire(mode);
			const mine = new Set(slides.map((s) => s.id));
			for (const id of mine) {
				ids.add(id);
			}
			expect(mine.size).toBeGreaterThanOrEqual({ season: 25, team: 25, player: 15, all: 20 }[mode]);
			for (const s of slides) {
				expect(isClean(s), s.id).toBe(true);
				expect(isBadText(JSON.stringify(s)), s.id).toBe(false);
				expect(s.score, s.id).toBeGreaterThanOrEqual(0);
				expect(s.score, s.id).toBeLessThanOrEqual(1);
				expect(JSON.stringify(s), s.id).not.toMatch(/\b1 (seasons|trades|players|picks|teams)\b|  /);
			}
		});
	}
	test("100+ topics, 95+ of them fire on the fixture", () => {
		const n = Object.values(DEAL_TOPICS).reduce((a, b) => a + b.length, 0);
		expect(n).toBeGreaterThanOrEqual(100);
		expect(ids.size).toBeGreaterThanOrEqual(95);
	});

	test("a season's slides only use trades made by then", () => {
		const byEid = new Map((L.trades ?? []).map((t) => [t.eid, t]));
		for (const season of X.seasons) {
			for (const s of candidates({ X, mode: "season", season, soFar: false })) {
				for (const f of s.facts ?? []) {
					const m = /^trade\|(\d+)$/.exec(f);
					if (m) {
						expect(byEid.get(Number(m[1]))!.season, s.id).toBeLessThanOrEqual(season);
					}
				}
			}
		}
	});

	test("trade values never look past the season asked for", () => {
		const s = L.season - 4;
		const early = tradeEvals(X, s);
		for (const e of early) {
			for (const side of e.sides) {
				for (const g of side.got) {
					expect(Math.max(0, ...g.seasons)).toBeLessThanOrEqual(s);
				}
			}
		}
	});

	test("the champion's trade slide is a spoiler", () => {
		let seen = 0;
		for (const season of X.decidedSeasons()) {
			const s = candidates({ X, mode: "season", season, soFar: false }).find((x) => x.id === "s-d-champ");
			if (s) {
				seen += 1;
				expect(s.spoiler, `${season}`).toBe(true);
			}
		}
		expect(seen).toBeGreaterThan(0);
	});

	test("in-progress season: nothing that needs the season to be over", () => {
		const L2 = { ...makeRichLeague(8), currentComplete: false };
		const X2 = new LeagueIndex(L2);
		const done = ["s-d-best", "s-d-deadline", "s-d-champ", "s-d-allstar", "s-fa-best", "s-fa-bust", "s-ct-year", "s-ct-dip", "s-ct-rookie", "t-d-ledger", "t-d-best", "t-d-worst", "t-d-acquired", "t-d-departed", "t-fa-best", "p-d-cost", "p-ct-year", "p-ct-rookie", "s-cheapstar", "s-toppaid", "p-perdollar"];
		for (const mode of ["season", "team", "player"] as const) {
			for (const s of fire(mode, X2).filter((x) => x.season === L2.season)) {
				expect(done, s.id).not.toContain(s.id);
			}
		}
	});

	test("decks with deals: deterministic, group caps, unique ids", () => {
		for (const [mode, extra] of [
			["season", {}],
			["team", { tid: 3 }],
			["player", { pid: 20 }],
			["all", {}],
		] as const) {
			const a = buildDeck(L, { mode, season: L.season - 2, ...extra, n: 30 });
			expect(buildDeck(makeRichLeague(12), { mode, season: L.season - 2, ...extra, n: 30 })).toEqual(a);
			const groups = new Map<string, number>();
			for (const s of a.slides) {
				groups.set(s.group, (groups.get(s.group) ?? 0) + 1);
			}
			for (const [g, n] of groups) {
				if (g !== "intro" && g !== "summary") {
					expect(n, g).toBeLessThanOrEqual(2);
				}
			}
			expect(new Set(a.slides.map((s) => s.id)).size).toBe(a.slides.length);
			expect(isBadText(JSON.stringify(a))).toBe(false);
		}
	});

	test("a snapshot without trades or contracts gives no front-office slides that need them", () => {
		const L3 = makeLeague(6);
		const X3 = new LeagueIndex(L3);
		const ids3 = new Set<string>();
		for (const mode of ["season", "team", "player", "all"] as const) {
			for (const s of fire(mode, X3)) {
				ids3.add(s.id);
				expect(isBadText(JSON.stringify(s))).toBe(false);
			}
		}
		for (const id of ids3) {
			expect(id, id).not.toMatch(/^(s|t|p|a)-(d|ct|fa|lot|rel)-/);
		}
	});
});
