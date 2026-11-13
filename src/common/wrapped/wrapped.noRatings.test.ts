// No Visible Player Ratings challenge: no Wrapped slide quotes a player rating (overall, potential, draft night ratings) or a
// roster rating. Without the challenge the slides quote the scouts' fuzzed ratings, not the true ones.
import { describe, expect, test } from "vitest";
import { candidates } from "./build.ts";
import { makeRichLeague } from "./fixture.ts";
import { LeagueIndex, viewRatings } from "./league.ts";
import type { Slide, WLeague, WrappedMode } from "./types.ts";

// Box score stats named "rating" are fine (offensive/defensive rating, player efficiency rating)
const STAT_RATINGS =
	/\b(offensive|defensive|efficiency|net) rating\b|best defender by rating/gi;
const RATING_WORDS =
	/\b(rated|ratings?|potential|ovr|pot|highest-rated)\b|\boverall rating/i;

const slideText = (s: Slide) =>
	JSON.stringify({
		kicker: s.kicker,
		heads: s.heads,
		hero: s.hero,
		lines: s.lines,
		chips: s.chips,
		list: s.list,
		note: s.note,
		who: s.who,
		quiz: s.quiz,
	}).replace(STAT_RATINGS, "");

const allSlides = (X: LeagueIndex) => {
	const out: Slide[] = [];
	for (const mode of ["season", "team", "player", "all"] as WrappedMode[]) {
		for (const season of X.seasons) {
			const subjects =
				mode === "team"
					? Array.from({ length: 4 }, (_, tid) => ({ tid: tid * 2 }))
					: mode === "player"
						? Array.from({ length: 22 }, (_, i) => ({ pid: i * 10 }))
						: [{}];
			for (const sub of subjects) {
				out.push(
					...candidates({
						X,
						mode,
						season,
						soFar: !X.decided(season),
						...sub,
					}),
				);
			}
			if (mode === "all") {
				break;
			}
		}
	}
	return out;
};

const leaks = (slides: Slide[]) =>
	slides
		.map((s) => `${s.id}: ${slideText(s)}`)
		.filter((t) => RATING_WORDS.test(t));

describe("Wrapped and player ratings", () => {
	const L: WLeague = makeRichLeague(12);
	// Every rating has some scouting fuzz
	for (const p of L.players) {
		p.fuzz = Object.fromEntries(
			Object.keys(p.ovr).map((s) => [s, ((p.pid % 7) - 3) * 1.5]),
		);
	}
	const X = new LeagueIndex(L);

	test("the true ratings are quoted somewhere (so the check below can fail)", () => {
		expect(leaks(allSlides(X)).length).toBeGreaterThan(5);
	}, 60_000);

	test("under the challenge, no slide quotes a rating", () => {
		const hidden = X.withRatings("hidden");
		expect(leaks(allSlides(hidden))).toEqual([]);
		// The snapshot itself keeps the true ratings
		expect(Object.keys(X.L.players[0]!.ovr).length).toBeGreaterThan(0);
		expect(X.withRatings("hidden")).toBe(hidden);
	}, 60_000);

	test("otherwise, slides quote the fuzzed ratings", () => {
		const p = L.players.find((x) => x.pid % 7 === 6)!;
		const v = viewRatings(p, "fuzz");
		const season = Number(Object.keys(p.ovr)[0]);
		expect(v.ovr[season]).toBe(
			Math.round(Math.min(100, Math.max(0, p.ovr[season]! + 4.5))),
		);
		expect(X.withRatings("fuzz").players.get(p.pid)!.ovr[season]).toBe(
			v.ovr[season],
		);
		expect(X.withRatings("true")).toBe(X);
	});
});
