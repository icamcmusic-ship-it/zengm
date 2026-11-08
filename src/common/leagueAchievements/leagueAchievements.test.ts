import { describe, expect, test } from "vitest";
import type {
	WGame,
	WLeague,
	WPlayer,
	WStat,
	WTeamSeason,
} from "../wrapped/types.ts";
import { makeRichLeague } from "../wrapped/fixture.ts";
import {
	applyNativeRules,
	bestText,
	DEF_BY_ID,
	DEFS,
	Defs,
	formatValue,
	MERGED,
	newUnlocks,
	progressOf,
	progressPct,
	runAchievements,
	toAData,
	TOPICS,
	type AExtras,
	type AchResult,
	type EngineRun,
} from "./index.ts";

const noExtras = (phase = 4): AExtras => ({
	phase,
	numGames: 82,
	events: [],
	awards: [],
	allStars: [],
	lottery: [],
	h2h: [],
	feats: [],
	teams: [],
});

const run = (L: WLeague, extras = noExtras()) =>
	runAchievements(toAData(L, extras));

const R = (res: EngineRun, id: string): AchResult => {
	const r = res.results.get(id);
	if (!r) {
		throw new Error(`No result for ${id}`);
	}
	return r;
};

describe("catalogue", () => {
	test("tiers are unique, well formed and grouped by metric", () => {
		expect(DEFS.length).toBe(1663);
		const ids = new Set<string>();
		const topics = new Set(TOPICS.map(([key]) => key));
		const byMetric = new Map<string, typeof DEFS>();
		for (const d of [...DEFS, ...Defs.retired]) {
			expect(ids.has(d.id)).toBe(false);
			ids.add(d.id);
			expect(d.id).toBe(`${d.metric}-${d.t}`);
			expect(topics.has(d.topic)).toBe(true);
			expect(["common", "rare", "legendary", "impossible"]).toContain(d.rarity);
			expect(Number.isFinite(d.t)).toBe(true);
			expect(d.name.length).toBeGreaterThan(0);
			expect(d.desc).not.toContain("{n}");
			let a = byMetric.get(d.metric);
			if (!a) {
				a = [];
				byMetric.set(d.metric, a);
			}
			a.push(d);
		}
		// The tiers of one metric share direction, kind and the data they need
		for (const list of byMetric.values()) {
			expect(new Set(list.map((d) => d.low)).size).toBe(1);
			expect(new Set(list.map((d) => d.kind)).size).toBe(1);
			expect(new Set(list.map((d) => d.need)).size).toBe(1);
		}
		expect(new Set(DEFS.map((d) => d.metric)).size).toBe(563);
	});

	test("every topic has tiers and every rarity is used", () => {
		for (const [key] of TOPICS) {
			expect(DEFS.some((d) => d.topic === key)).toBe(true);
		}
		for (const r of ["common", "rare", "legendary", "impossible"]) {
			expect(DEFS.filter((d) => d.rarity === r).length).toBeGreaterThan(100);
		}
	});

	test("merged duplicates point at shown tiers, and are not shown themselves", () => {
		for (const [from, to] of Object.entries(MERGED)) {
			expect(DEF_BY_ID.has(from)).toBe(false);
			// (two are merged into tiers that were calibrated out, which are still computed)
			expect(DEF_BY_ID.has(to) || Defs.retired.some((d) => d.id === to)).toBe(
				true,
			);
		}
	});

	test("every tier gets a result, and an empty league unlocks nothing", () => {
		const L: WLeague = {
			startingSeason: 2030,
			season: 2030,
			currentComplete: false,
			userTid: 0,
			numPlayoffRounds: {},
			teamSeasons: [],
			players: [],
			series: [],
			games: [],
		};
		const res = run(L, noExtras(0));
		for (const d of DEFS) {
			const r = R(res, d.id);
			expect(r.state).not.toBe("unlocked");
		}
		// No box scores: box-score tiers are unknown, not locked at zero
		expect(R(res, "pts-60").state).toBe("unavailable");
		expect(R(res, "pts-60").best).toBe(null);
	});
});

// A small league worked out by hand: two seasons (2030, 2031), four teams, one box score
const stat = (season: number, tid: number, o: Partial<WStat> = {}): WStat => ({
	season,
	tid,
	gp: 80,
	gs: 80,
	min: 2800,
	pts: 1600,
	trb: 400,
	ast: 300,
	stl: 80,
	blk: 40,
	tov: 150,
	tp: 100,
	tpa: 280,
	fg: 600,
	fga: 1300,
	ft: 300,
	fta: 380,
	per: 18,
	ws: 8,
	bpm: 2,
	vorp: 2,
	...o,
});

const player = (
	pid: number,
	tid: number,
	o: Partial<WPlayer> = {},
): WPlayer => ({
	pid,
	name: `Player ${pid}`,
	firstName: "Player",
	lastName: `${pid}`,
	bornYear: 2005,
	bornLoc: "Boston, MA",
	college: "",
	draft: { year: 2028, round: 1, pick: pid + 1, tid },
	tid,
	retiredYear: Infinity,
	hof: false,
	awards: [],
	stats: [stat(2030, tid), stat(2031, tid)],
	po: [],
	injuries: [],
	ovr: { 2030: 60, 2031: 64 },
	moves: [],
	relatives: [],
	...o,
});

const teamSeason = (
	tid: number,
	season: number,
	won: number,
	lost: number,
	playoffRoundsWon = -1,
): WTeamSeason => ({
	tid,
	season,
	abbrev: `T${tid}`,
	region: `Region${tid}`,
	name: `Team${tid}`,
	colors: ["#000", "#fff", "#888"],
	won,
	lost,
	tied: 0,
	otl: 0,
	playoffRoundsWon,
	gp: won + lost,
	pts: 0,
	oppPts: 0,
	wonHome: Math.ceil(won / 2),
	lostHome: Math.floor(lost / 2),
	wonAway: Math.floor(won / 2),
	lostAway: Math.ceil(lost / 2),
});

const line = (pid: number, pts: number, o: Record<string, number> = {}) => ({
	pid,
	name: `Player ${pid}`,
	min: 36,
	pts,
	trb: 5,
	ast: 4,
	stl: 1,
	blk: 0,
	tp: 2,
	tpa: 6,
	fg: Math.floor(pts / 2),
	fga: pts,
	ft: 2,
	fta: 3,
	tov: 2,
	gs: 1,
	...o,
});

const tinyLeague = (withGames = true): WLeague => {
	const game: WGame = {
		gid: 7,
		season: 2031,
		day: 10,
		playoffs: false,
		overtimes: 0,
		teams: [
			{
				tid: 0,
				pts: 160,
				ptsQtrs: [40, 40, 40, 40],
				players: [line(0, 62), line(1, 50), line(2, 48)],
			},
			{
				tid: 1,
				pts: 98,
				ptsQtrs: [25, 25, 24, 24],
				players: [line(10, 40), line(11, 30), line(12, 28)],
			},
		],
	};
	return {
		startingSeason: 2030,
		season: 2031,
		currentComplete: true,
		userTid: 0,
		numPlayoffRounds: { 2030: 1, 2031: 1 },
		teamSeasons: [
			teamSeason(0, 2030, 50, 32, 0),
			teamSeason(1, 2030, 45, 37, 1),
			teamSeason(2, 2030, 40, 42),
			teamSeason(3, 2030, 29, 53),
			// 70-12 is .854: over .800, short of .890
			teamSeason(0, 2031, 70, 12, 1),
			teamSeason(1, 2031, 50, 32, 0),
			teamSeason(2, 2031, 36, 46),
			// 8-74 is .098, under .100
			teamSeason(3, 2031, 8, 74),
		],
		players: [0, 1, 2, 10, 11, 12].map((pid) => player(pid, pid < 10 ? 0 : 1)),
		series: [
			{
				season: 2030,
				rounds: [
					[
						{
							home: { tid: 0, seed: 1, won: 2 },
							away: { tid: 1, seed: 2, won: 4 },
						},
					],
				],
			},
			{
				season: 2031,
				rounds: [
					[
						{
							home: { tid: 0, seed: 1, won: 4 },
							away: { tid: 1, seed: 2, won: 0 },
						},
					],
				],
			},
		],
		games: withGames ? [game] : [],
	};
};

describe("metrics on a hand-made league", () => {
	const res = run(tinyLeague());

	test("the league's own seasons start at startingSeason", () => {
		expect(res.own).toBe(2030);
	});

	test("single-game lines", () => {
		// 62 points: Sixty Club, not yet Eighty-One
		const sixty = R(res, "pts-60");
		expect(sixty.state).toBe("unlocked");
		expect(sixty.first?.pid).toBe(0);
		expect(sixty.first?.season).toBe(2031);
		expect(sixty.first?.gid).toBe(7);
		const eightyOne = R(res, "pts-81");
		expect(eightyOne.state).toBe("locked");
		expect(eightyOne.best?.v).toBe(62);
		expect(eightyOne.progress).toBeCloseTo(62 / 81);
	});

	test("game results", () => {
		// 160-98: a 62-point win
		expect(R(res, "gMargin-50").state).toBe("unlocked");
		expect(R(res, "gMargin-50").first?.tid).toBe(0);
		expect(R(res, "gMargin-65").state).toBe("locked");
		expect(R(res, "gMargin-65").best?.v).toBe(62);
		expect(R(res, "gWinPts-155").state).toBe("unlocked");
		expect(R(res, "gWinPts-180").progress).toBeCloseTo(160 / 180);
		// Three players with 40+ in one game is "dual40" at 3
		expect(R(res, "dual40-3").state).toBe("unlocked");
	});

	test("team seasons", () => {
		expect(R(res, "winp-0.8").state).toBe("unlocked");
		expect(R(res, "winp-0.8").first?.tid).toBe(0);
		expect(R(res, "winp-0.89").state).toBe("locked");
		expect(R(res, "winp-0.89").best?.v).toBeCloseTo(70 / 82);
		// Lower is better: 8-74 is under .100
		expect(R(res, "winpLow-0.1").state).toBe("unlocked");
		expect(R(res, "winpLow-0.1").first?.tid).toBe(3);
	});

	test("playoffs", () => {
		expect(R(res, "champ-1").state).toBe("unlocked");
		expect(R(res, "sFinalsSweep-1").state).toBe("unlocked");
		expect(R(res, "sFinalsSweep-1").first?.tid).toBe(0);
		expect(R(res, "sFinalsSweep-1").first?.season).toBe(2031);
		// Two different champions in two seasons
		expect(R(res, "firstTitleN-1").state).toBe("unlocked");
	});

	test("data the league doesn't have is unknown, not zero", () => {
		const noGames = run(tinyLeague(false));
		for (const id of ["pts-60", "gMargin-50", "gWinPts-155"]) {
			expect(R(noGames, id).state).toBe("unavailable");
			expect(R(noGames, id).progress).toBe(0);
			expect(R(noGames, id).best).toBe(null);
		}
		// No award data at all
		expect(R(noGames, "mvpN-2").state).toBe("unavailable");
	});

	test("records count only after a warm-up", () => {
		const L = tinyLeague();
		const data = toAData(L, noExtras());
		const res2 = applyNativeRules(runAchievements(data), data);
		for (const id of ["recHolder-2", "recYear-3", "recBreaks-5"]) {
			expect(R(res2, id).state).toBe("unavailable");
			expect(R(res2, id).warmup).toBe(true);
		}
		expect(res2.summary.unavailable).toBeGreaterThan(res.summary.unavailable);
		expect(
			res2.summary.unlocked + res2.summary.unavailable,
		).toBeLessThanOrEqual(res2.summary.total);
	});

	test("a series still being played is not read as decided", () => {
		const L = tinyLeague();
		L.currentComplete = false;
		// 3-0 in a best-of-seven final
		L.series[1]!.rounds[0]![0]!.home.won = 3;
		const extras = { ...noExtras(3), seriesWinsNeeded: [4] };
		const data = toAData(L, extras);
		expect(data.champions[2031]).toBe(undefined);
		expect(data.champions[2030]?.tid).toBe(1);
		const res2 = runAchievements(data);
		expect(R(res2, "sFinalsSweep-1").state).not.toBe("unlocked");
		// Once it's 4-0 it is
		L.series[1]!.rounds[0]![0]!.home.won = 4;
		const res3 = run(L, extras);
		expect(R(res3, "sFinalsSweep-1").state).toBe("unlocked");
	});
});

describe("metrics recomputed independently on a generated league", () => {
	const L = makeRichLeague(12);
	const data = toAData(L, noExtras());
	const res = runAchievements(data);
	const own = res.own;

	test("best single-game points", () => {
		let best = -Infinity;
		for (const gm of data.games) {
			if (gm.season < own) {
				continue;
			}
			for (const t of gm.teams) {
				for (const l of t.players) {
					best = Math.max(best, l.pts);
				}
			}
		}
		const r = R(res, "pts-81");
		if (r.state === "locked") {
			expect(r.best?.v).toBe(best);
		} else {
			expect(best).toBeGreaterThanOrEqual(81);
		}
	});

	test("best combined score and margin", () => {
		let total = -Infinity;
		let margin = -Infinity;
		for (const gm of data.games) {
			total = Math.max(total, gm.won.pts + gm.lost.pts);
			margin = Math.max(margin, gm.won.pts - gm.lost.pts);
		}
		const t = R(res, "gTotal-400");
		const m = R(res, "gMargin-90");
		if (t.state === "locked") {
			expect(t.best?.v).toBe(total);
		}
		if (m.state === "locked") {
			expect(m.best?.v).toBe(margin);
		}
		expect(R(res, "gMargin-50").state).toBe(
			margin >= 50 ? "unlocked" : "locked",
		);
	});

	test("titles of a franchise", () => {
		const titles = new Map<number, number>();
		for (const c of Object.values(data.champions)) {
			titles.set(c.tid, (titles.get(c.tid) ?? 0) + 1);
		}
		const most = Math.max(0, ...titles.values());
		expect(R(res, "frTitles-2").state).toBe(most >= 2 ? "unlocked" : "locked");
		expect(R(res, "champ-1").state).toBe(
			Object.keys(data.champions).length > 0 ? "unlocked" : "locked",
		);
	});

	test("unlocked tiers are credited to teams that exist", () => {
		const tids = new Set(data.teams.map((t) => t.tid));
		for (const d of DEFS) {
			const r = R(res, d.id);
			if (r.state === "unlocked" && r.byTeam) {
				for (const tid of r.byTeam.keys()) {
					expect(tids.has(tid)).toBe(true);
				}
			}
		}
	});
});

// The league as it was after a given season: what the engine sees when checking during a replay
const asOf = (L: WLeague, season: number): WLeague => ({
	...L,
	season,
	currentComplete: true,
	teamSeasons: L.teamSeasons.filter((ts) => ts.season <= season),
	players: L.players
		.filter(
			(p) => p.draft.year <= season || p.stats.some((r) => r.season <= season),
		)
		.map((p) => ({
			...p,
			stats: p.stats.filter((r) => r.season <= season),
			po: p.po.filter((r) => r.season <= season),
			injuries: p.injuries.filter((r) => r.season <= season),
			retiredYear: p.retiredYear <= season ? p.retiredYear : Infinity,
		})),
	series: L.series.filter((s) => s.season <= season),
	games: L.games.filter((gm) => gm.season <= season),
});

describe("unlock detection", () => {
	const L = makeRichLeague(8);

	test("deterministic", () => {
		const a = run(L);
		const b = run(L);
		const ids = (x: EngineRun) =>
			newUnlocks(x.results, new Set()).map((d) => d.id);
		expect(ids(a)).toEqual(ids(b));
		for (const d of DEFS) {
			expect(R(a, d.id).state).toBe(R(b, d.id).state);
			expect(R(a, d.id).first?.at).toBe(R(b, d.id).first?.at);
		}
	});

	test("rarest first", () => {
		const list = newUnlocks(run(L).results, new Set());
		const rank = { common: 0, rare: 1, legendary: 2, impossible: 3 };
		for (let i = 1; i < list.length; i++) {
			expect(rank[list[i - 1]!.rarity]).toBeGreaterThanOrEqual(
				rank[list[i]!.rarity],
			);
		}
	});

	test("replaying season by season announces each tier once", () => {
		const seen = new Set<string>();
		const announced: string[] = [];
		for (let s = L.startingSeason; s <= L.season; s++) {
			const res = run(asOf(L, s));
			const fresh = newUnlocks(res.results, seen);
			for (const d of fresh) {
				expect(R(res, d.id).state).toBe("unlocked");
				expect(seen.has(d.id)).toBe(false);
				seen.add(d.id);
				announced.push(d.id);
			}
			// Checking again with nothing new finds nothing
			expect(newUnlocks(res.results, seen)).toEqual([]);
		}
		expect(new Set(announced).size).toBe(announced.length);
		expect(announced.length).toBeGreaterThan(20);
		// Everything unlocked at the end was announced along the way
		const end = run(L);
		for (const d of DEFS) {
			if (R(end, d.id).state === "unlocked") {
				expect(seen.has(d.id), d.id).toBe(true);
			}
		}
	}, 120_000);
});

describe("progress", () => {
	const high = DEF_BY_ID.get("pts-60")!;
	const low = DEF_BY_ID.get("gLowPts-60")!;
	const lowZero = DEF_BY_ID.get("champLoss-0")!;

	test("higher is better: value over threshold", () => {
		expect(progressOf(high, 30)).toBeCloseTo(0.5);
		expect(progressOf(high, 60)).toBe(1);
		expect(progressOf(high, 90)).toBe(1);
		expect(progressOf(high, 0)).toBe(0);
	});

	test("lower is better: threshold over value", () => {
		expect(low.low).toBe(true);
		expect(progressOf(low, 120)).toBeCloseTo(0.5);
		expect(progressOf(low, 60)).toBe(1);
		expect(progressOf(low, 45)).toBe(1);
		// A ceiling of zero is all or nothing
		expect(lowZero.low).toBe(true);
		expect(progressOf(lowZero, 1)).toBe(0);
		expect(progressOf(lowZero, 0)).toBe(1);
	});

	test("unknown is no progress", () => {
		expect(progressOf(high, null)).toBe(0);
		expect(progressOf(high, Number.NaN)).toBe(0);
	});

	test("a locked tier never shows 100%", () => {
		expect(progressPct(0.999)).toBe(99);
		expect(progressPct(0.5)).toBe(50);
		expect(progressPct(1)).toBe(100);
		expect(progressPct(-1)).toBe(0);
	});

	test("best text", () => {
		expect(bestText(high, { v: 54 })).toBe("54 of 60 points");
		expect(bestText(low, { v: 72 })).toBe("72 points (needs 60 or fewer)");
		expect(bestText(high, null)).toBe(undefined);
		// Nothing yet toward a one-off is not "0 of 1"
		expect(bestText(DEF_BY_ID.get("sUpsetSweep-1")!, { v: 0 })).toBe(undefined);
		const winp = DEF_BY_ID.get("winp-0.89")!;
		expect(formatValue(0.854, winp)).toBe(".854");
	});
});
