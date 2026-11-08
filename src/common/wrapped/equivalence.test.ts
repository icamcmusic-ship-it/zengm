import { describe, expect, test } from "vitest";
import { buildDeck, candidates } from "./build.ts";
import { makeLeague } from "./fixture.ts";
import { makeBigLeague } from "./fixtureBig.ts";
import { addDeals } from "./fixtureDeals.ts";
import { LeagueIndex, newLinesCache } from "./league.ts";
import { LegacyLeagueIndex } from "./legacyLeagueIndex.ts";
import type { WLeague, WrappedMode } from "./types.ts";
import { findStories } from "../storylines/index.ts";
import { gameLines } from "./topics/helpers.ts";

// The optimized LeagueIndex has to give exactly what the original, unindexed one gave, through every topic and every storyline kind (including ones added later, as long as they use the same methods)
const legacy = (L: WLeague) =>
	new LegacyLeagueIndex(L) as unknown as LeagueIndex;

type Case = { mode: WrappedMode; season: number; tid?: number; pid?: number };

const cases = (L: WLeague): Case[] => {
	const out: Case[] = [{ mode: "all", season: L.season }];
	const seasons = [L.season, L.season - 1, L.startingSeason + 2];
	for (const season of seasons) {
		out.push({ mode: "season", season });
		for (const tid of [0, 3, 5]) {
			out.push({ mode: "team", season, tid });
		}
		const withStats = L.players.filter(
			(p) => p.stats.length > 3 && p.stats.some((r) => r.season === season),
		);
		for (const p of [withStats[0], withStats[7], withStats.at(-1)]) {
			if (p) {
				out.push({ mode: "player", season, pid: p.pid });
			}
		}
	}
	return out;
};

const fixtures: [string, WLeague][] = [
	["small", makeLeague(6)],
	["big", makeBigLeague({ numSeasons: 14, seed: "eq" })],
	// With trades, contracts and lotteries, so the front-office topics and storylines are covered too
	["deals", addDeals(makeBigLeague({ numSeasons: 10, seed: "deals" }), { perSeason: 6 })],
	[
		"in progress",
		{ ...makeBigLeague({ numSeasons: 6, seed: "ip" }), currentComplete: false },
	],
];

describe.each(fixtures)(
	"optimized index equals the original: %s",
	(_name, L) => {
		const old = legacy(L);
		const fresh = new LeagueIndex(L);
		const cache = newLinesCache();
		const reuse = (s: number) => s < L.season;
		// Twice, so the second index gets its lines from the cache
		const cachedA = new LeagueIndex(L, {
			linesCache: cache,
			reuseLines: reuse,
		});
		const cachedB = new LeagueIndex(L, {
			linesCache: cache,
			reuseLines: reuse,
		});

		test("candidates", () => {
			let total = 0;
			for (const c of cases(L)) {
				const ctx = { ...c, soFar: c.mode !== "all" && !old.decided(c.season) };
				const expected = candidates({ ...ctx, X: old });
				total += expected.length;
				for (const X of [fresh, cachedA, cachedB]) {
					expect(candidates({ ...ctx, X })).toEqual(expected);
				}
			}
			expect(total).toBeGreaterThan(50);
		});

		test("decks", () => {
			for (const c of cases(L)) {
				expect(buildDeck(fresh, { ...c, n: 20 })).toEqual(
					buildDeck(old, { ...c, n: 20 }),
				);
			}
		});

		test("storylines", () => {
			const expected = findStories(old);
			expect(expected.length).toBeGreaterThan(0);
			expect(findStories(fresh)).toEqual(expected);
			expect(findStories(cachedB)).toEqual(expected);
		});

		test("box score lines are made once for the same box scores", () => {
			const withGames = old.seasons.filter((s) => old.hasBoxScores(s));
			expect(withGames.length).toBeGreaterThan(0);
			for (const s of withGames) {
				expect(gameLines(cachedA, s)).toBe(gameLines(cachedB, s));
				expect(gameLines(cachedA, s)).toEqual(gameLines(old, s));
			}
		});

		test("index lookups", () => {
			for (const s of old.seasons) {
				expect(fresh.teamsIn(s)).toEqual(old.teamsIn(s));
				expect(fresh.champion(s)).toEqual(old.champion(s));
				expect(fresh.runnerUp(s)).toEqual(old.runnerUp(s));
				expect(fresh.lines(s)).toEqual(old.lines(s));
				expect(fresh.poLines(s)).toEqual(old.poLines(s));
				for (const type of ["Most Valuable Player", "All-Star", "Finals MVP"]) {
					expect(fresh.awardPids(s, type)).toEqual(old.awardPids(s, type));
				}
				for (const l of old.lines(s).slice(0, 20)) {
					expect(fresh.line(l.pid, s)).toBe(
						fresh.lines(s).find((x) => x.pid === l.pid),
					);
				}
			}
			for (const tid of [0, 1, 7, 99]) {
				expect(fresh.titlesOf(tid)).toEqual(old.titlesOf(tid));
				expect(fresh.teamHistory(tid)).toEqual(old.teamHistory(tid));
				for (const s of [
					old.seasons[0]! - 3,
					old.seasons[2]!,
					old.seasons.at(-1)! + 2,
				]) {
					expect(fresh.teamAny(tid, s)).toBe(old.teamAny(tid, s));
				}
			}
		});
	},
);
