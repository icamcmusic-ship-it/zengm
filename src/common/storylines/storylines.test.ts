import { describe, expect, test } from "vitest";
import {
	diversify,
	findStories,
	KIND_NAMES,
	kindSlug,
	overlapsSeason,
	plainText,
	stints,
} from "./index.ts";
import { keyGames, whyOf } from "./why.ts";
import { buildThreads, subjectOf } from "./threads.ts";
import { makeLeague } from "../wrapped/fixture.ts";
import { LeagueIndex } from "../wrapped/league.ts";
import { makeRichLeague } from "./richFixture.ts";

const ctx = { kindRank: 1, kindCount: 3, rank: 5, total: 100 };

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
			plainText(
				"[[p:3|Joe Smith]] beat the [[t:1:2030|Boston Celtics]] ([[g:9:1:2030|Box score]])",
			),
		).toBe("Joe Smith beat the Boston Celtics (Box score)");
	});
	test("stints merges consecutive seasons", () => {
		const L = makeLeague(3);
		const st = stints(L.players[0]!);
		expect(st.length).toBe(1);
		expect(st[0]!.to - st[0]!.from).toBe(2);
	});
	test("kind names are unique and slugs are url safe", () => {
		expect(new Set(KIND_NAMES).size).toBe(KIND_NAMES.length);
		expect(new Set(KIND_NAMES.map(kindSlug)).size).toBe(KIND_NAMES.length);
		for (const k of KIND_NAMES) {
			expect(kindSlug(k)).toMatch(/^[\da-z-]+$/);
		}
		expect(KIND_NAMES.length).toBeGreaterThanOrEqual(70);
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

describe("many kinds", () => {
	const L = makeRichLeague(30);
	const stories = findStories(L);
	const kinds = new Set(stories.map((s) => s.kind));

	test("most kinds fire on a busy league", () => {
		expect(kinds.size).toBeGreaterThanOrEqual(60);
		// the new kinds in particular
		for (const k of [
			"50-40-90",
			"Hall of Famer",
			"Three-point barrage",
			"Playoff rivalry",
			"Awards haul",
			"All-Star team",
			"Career milestone",
			"Lost years",
			"Late-pick star",
			"Like father, like son",
			"Finals to the last game",
		]) {
			expect(kinds.has(k), k).toBe(true);
		}
	});

	test("every story is clean text with unique ids", () => {
		const ids = new Set<string>();
		for (const s of stories) {
			const text = plainText(
				`${s.headline} ${s.body} ${s.evidence.flat().join(" ")}`,
			);
			expect(text, s.id).not.toMatch(/\b(undefined|NaN|null|Infinity)\b/);
			expect(text, s.id).not.toMatch(/ {2}|\[\[|]]|\${/);
			expect(text, s.id).not.toMatch(/\b1 (seasons|games|wins|titles|years)\b/);
			expect(s.headline.length, s.id).toBeGreaterThan(5);
			expect(/\.( \[\[g:\d+:\d+:\d+\|Box score]])?$/.test(s.body), s.id).toBe(
				true,
			);
			expect(ids.has(s.id), s.id).toBe(false);
			ids.add(s.id);
		}
	});

	test("deterministic", () => {
		expect(findStories(makeRichLeague(30))).toEqual(stories);
	});

	test("stories about games name their box scores", () => {
		const games = stories.filter((s) => s.gids?.length);
		expect(games.length).toBeGreaterThan(10);
		for (const s of games) {
			expect(s.body).toMatch(/\[\[g:\d+:\d+:\d+\|Box score]]/);
		}
	});

	test("unfinished season: nothing about its playoffs, awards or champion", () => {
		const open = makeRichLeague(12);
		open.currentComplete = false;
		const out = findStories(open);
		for (const s of out.filter((x) => x.season === open.season)) {
			if (s.gids?.length) {
				continue;
			}
			const text = plainText(`${s.headline} ${s.body}`);
			expect(text, `${s.id}: ${text}`).not.toMatch(
				/won the (\d+ )?titles?|champions|finals|rookie of the year|player of the year/i,
			);
		}
		// and no new playoff-shaped story for the open season
		expect(
			out.filter((s) => s.shape === "playoffs" && s.season === open.season),
		).toEqual([]);
	});
});

describe("why and key games", () => {
	const L = makeRichLeague(14);
	const X = new LeagueIndex(L);
	const stories = findStories(X);

	test("every story has a why with rank, evidence and a clean table", () => {
		for (const s of stories.slice(0, 300)) {
			const sections = whyOf(X, s, ctx);
			expect(sections[0]!.id).toBe("rank");
			expect(sections.map((x) => x.id)).toContain("evidence");
			for (const sec of sections) {
				for (const row of sec.rows) {
					expect(row.length, `${s.id} ${sec.id}`).toBe(sec.cols.length);
					expect(plainText(row.join(" ")), `${s.id} ${sec.id}`).not.toMatch(
						/undefined|NaN|null/,
					);
				}
			}
		}
	});

	test("player stories show where the player ranked", () => {
		const s = stories.find(
			(x) =>
				x.shape === "season" &&
				x.pids.length === 1 &&
				x.kind === "Twenty and twelve",
		)!;
		const ids = whyOf(X, s, ctx).map((x) => x.id);
		expect(ids).toContain("players");
		expect(ids).toContain("ranks");
	});

	test("key games: the game itself for game stories, nothing without box scores", () => {
		const g = stories.find((s) => s.gids?.length)!;
		const kg = keyGames(X, g);
		expect(kg.map((k) => k.g.gid)).toEqual(g.gids);
		const none = new LeagueIndex({ ...L, games: [] });
		expect(keyGames(none, g)).toEqual([]);
	});

	test("key games for a player season are his own games", () => {
		const s = stories.find(
			(x) => x.pids.length === 1 && X.hasBoxScores(x.season) && !x.gids,
		)!;
		const kg = keyGames(X, s);
		expect(kg.length).toBeGreaterThan(0);
		for (const k of kg) {
			expect(k.g.season).toBe(s.season);
			expect(
				k.g.teams.some((t) => t.players.some((p) => p.pid === s.pids[0])),
			).toBe(true);
		}
	});
});

describe("threads", () => {
	const L = makeRichLeague(20);
	const X = new LeagueIndex(L);
	const stories = findStories(X);
	const threads = buildThreads(X, stories);

	test("a thread spans two or more seasons and is ordered", () => {
		expect(threads.length).toBeGreaterThan(5);
		const byId = new Map(stories.map((s) => [s.id, s]));
		for (const t of threads) {
			expect(t.seasons.length).toBeGreaterThanOrEqual(2);
			const seasons = t.chapters.map((c) => c.season);
			expect([...seasons].sort((a, b) => a - b)).toEqual(seasons);
			for (const c of t.chapters) {
				const s = byId.get(c.id)!;
				expect(s.season).toBe(c.season);
				expect(subjectOf(X, s)?.key).toBe(t.key);
			}
		}
		// longest first
		for (let i = 1; i < threads.length; i++) {
			expect(threads[i - 1]!.seasons.length).toBeGreaterThanOrEqual(
				threads[i]!.seasons.length,
			);
		}
	});

	test("player threads get phases from win shares", () => {
		const t = threads.find((x) => x.kind === "player")!;
		const ph = t.chapters.map((c) => c.phase?.id).filter((x) => x !== "before");
		expect(ph.every((x) => x !== undefined)).toBe(true);
		// a peak exists among the player's own seasons, and nothing is labeled before it but "rise"
		const peak = ph.indexOf("peak");
		if (peak > 0) {
			expect(ph.slice(0, peak).every((x) => x === "rise")).toBe(true);
		}
	});

	test("team threads carry the season's record", () => {
		const t = threads.find((x) => x.kind === "team")!;
		for (const c of t.chapters) {
			expect(c.phase?.note).toMatch(/^\d+-\d+/);
		}
	});

	test("deterministic", () => {
		expect(buildThreads(X, stories)).toEqual(threads);
	});
});

describe("season filter", () => {
	const L = makeRichLeague(20);
	const stories = findStories(L);
	const seasons = [...new Set(L.teamSeasons.map((t) => t.season))];

	test("a story matches the seasons it covers, and every season has stories", () => {
		expect(overlapsSeason({ season: 2030 }, 2030)).toBe(true);
		expect(overlapsSeason({ season: 2030 }, 2031)).toBe(false);
		expect(overlapsSeason({ season: 2031, span: [2028, 2031] }, 2029)).toBe(
			true,
		);
		expect(overlapsSeason({ season: 2031, span: [2028, 2031] }, 2032)).toBe(
			false,
		);
		for (const y of seasons) {
			expect(
				stories.filter((s) => overlapsSeason(s, y)).length,
				`${y}`,
			).toBeGreaterThan(0);
		}
	});

	test("multi-season stories carry their span, within their own season range", () => {
		const spans = stories.filter((s) => s.span);
		expect(spans.length).toBeGreaterThan(20);
		for (const s of spans) {
			expect(s.span![0], s.id).toBeLessThanOrEqual(s.span![1]);
			expect(overlapsSeason(s, s.season), s.id).toBe(true);
		}
	});

	test("the season filter combines with team and kind filters", () => {
		const y = seasons[5]!;
		const tid = stories.find((s) => s.tids.length > 0 && s.season === y)!
			.tids[0]!;
		const both = stories.filter(
			(s) => s.tids.includes(tid) && overlapsSeason(s, y),
		);
		expect(both.length).toBeGreaterThan(0);
		expect(both.length).toBeLessThan(stories.length);
		for (const s of both) {
			expect(s.tids).toContain(tid);
		}
	});
});
