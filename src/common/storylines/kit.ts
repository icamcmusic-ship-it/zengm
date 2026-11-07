// Shared types and helpers for the storyline kinds. Storylines: narrative patterns detected in a league's history (ring chasers, homecomings, droughts, Cinderella runs, collapses, one-team legends ...) and written up from templates. Everything is found in the data; only the wording is chosen, deterministically, from a few variants per kind.
//
// Text can carry links as tokens: [[p:PID|Name]] for a player, [[t:TID:SEASON|Name]] for a team season and [[g:GID:TID:SEASON|text]] for a box score (TID is the team whose game log shows it). The UI turns them into links; plainText() strips them.

import type { LeagueIndex, SeasonLine } from "../wrapped/league.ts";
import type { WPlayer, WStat, WTeamSeason } from "../wrapped/types.ts";
import { fmtNum } from "../wrapped/util.ts";

export type StoryShape = "career" | "team" | "season" | "playoffs";

export type Story = {
	id: string;
	kind: string;
	shape: StoryShape;
	season: number;
	score: number;
	headline: string;
	body: string;
	evidence: [string, string][];
	pids: number[];
	tids: number[];
	// First and last season the story covers, when it covers more than `season`
	span?: [number, number];
	// Box scores this story is about, when it is about particular games
	gids?: number[];
};

export const pLink = (p: { pid: number; name: string }) =>
	`[[p:${p.pid}|${p.name}]]`;
export const gLink = (
	g: { gid: number; season: number; teams: { tid: number }[] },
	text: string,
) => `[[g:${g.gid}:${g.teams[0]!.tid}:${g.season}|${text}]]`;
export const tLink = (X: LeagueIndex, tid: number, season: number) =>
	`[[t:${tid}:${season}|${X.teamName(tid, season)}]]`;

export const plainText = (t: string) =>
	t.replace(/\[\[[gpt]:[^\]|]*\|([^\]]*)]]/g, "$1");

export type Draft = Omit<Story, "headline" | "body" | "id"> & {
	key: string;
	heads: string[];
	bodies: string[];
};

export type Kind = { kind: string; find: (X: LeagueIndex) => Draft[] };

// Regular-season rows with games played, computed once per player
const regCache = new WeakMap<WPlayer, WStat[]>();
export const regRows = (p: WPlayer) => {
	let rows = regCache.get(p);
	if (!rows) {
		rows = p.stats.filter((r) => r.gp > 0);
		regCache.set(p, rows);
	}
	return rows;
};

// Consecutive runs with one team: [{tid, from, to, ws, gp}]
export const stints = (p: WPlayer) => {
	const out: {
		tid: number;
		from: number;
		to: number;
		ws: number;
		gp: number;
	}[] = [];
	for (const s of regRows(p)) {
		const last = out.at(-1);
		if (last && last.tid === s.tid && s.season - last.to <= 1) {
			last.to = s.season;
			last.ws += s.ws;
			last.gp += s.gp;
		} else {
			out.push({
				tid: s.tid,
				from: s.season,
				to: s.season,
				ws: s.ws,
				gp: s.gp,
			});
		}
	}
	return out;
};

export const seasonsOf = (rows: WStat[]) =>
	[...new Set(rows.map((r) => r.season))].sort((a, b) => a - b);

export const titleSeasons = (X: LeagueIndex, p: WPlayer) =>
	X.cached(`sl|titles|${p.pid}`, () => {
		const out: number[] = [];
		for (const s of seasonsOf(p.po)) {
			const c = champion(X, s);
			if (
				c &&
				p.po.some((r) => r.season === s && r.tid === c.tid && r.gp > 0)
			) {
				out.push(s);
			}
		}
		return out;
	});

export const isActive = (X: LeagueIndex, p: WPlayer) =>
	p.retiredYear > X.L.season && p.tid >= 0;

// ---- helpers for the kinds ----

export type RateKey =
	| "ppg"
	| "rpg"
	| "apg"
	| "spg"
	| "bpg"
	| "mpg"
	| "ws"
	| "per";

// The season's qualified players, best first by a rate (ties by pid, so the order never changes)
export const leadersBy = (X: LeagueIndex, season: number, key: RateKey) =>
	X.cached(`lead|${season}|${key}`, () =>
		[...X.qualified(season)].sort((a, b) => b[key] - a[key] || a.pid - b.pid),
	);

export const winpOf = (X: LeagueIndex, ts: WTeamSeason) => X.teamWinp(ts);

// The best player (by win shares) who finished the season with a team
export const topOn = (X: LeagueIndex, tid: number, season: number) =>
	[...X.lines(season)]
		.filter((l) => l.tid === tid)
		.sort((a, b) => b.ws - a.ws || a.pid - b.pid)[0];

// "the semifinals", "the finals" ... for a team that won `won` rounds and lost the next
export const roundLabel = (won: number, numRounds: number) => {
	const r = won + 1;
	if (r >= numRounds) {
		return "the finals";
	}
	if (r === numRounds - 1) {
		return "the semifinals";
	}
	if (r === numRounds - 2 && numRounds >= 4) {
		return "the quarterfinals";
	}
	return r === 1 ? "the first round" : `round ${r}`;
};

export const topN = <T>(list: T[], n: number, by: (x: T) => number) =>
	[...list].sort((a, b) => by(b) - by(a)).slice(0, n);

// "18.2 points, 8.1 rebounds and 6.4 assists a game"
export const lineText = (l: { ppg: number; rpg: number; apg: number }) =>
	`${fmtNum(l.ppg, 1)} points, ${fmtNum(l.rpg, 1)} rebounds and ${fmtNum(l.apg, 1)} assists a game`;

// Consecutive-season runs: maximal runs of seasons for which ok(season) holds, among the given sorted seasons
export const runsOf = (seasons: number[], ok: (s: number) => boolean) => {
	const out: number[][] = [];
	let cur: number[] = [];
	for (const s of seasons) {
		if (ok(s) && (cur.length === 0 || s === cur.at(-1)! + 1)) {
			cur.push(s);
		} else {
			if (cur.length > 0) {
				out.push(cur);
			}
			cur = ok(s) ? [s] : [];
		}
	}
	if (cur.length > 0) {
		out.push(cur);
	}
	return out;
};

export const teamsWithHistory = (X: LeagueIndex) => [
	...new Set(X.L.teamSeasons.map((t) => t.tid)),
];

// The seasons a story covers
export const spanOf = (s: Pick<Story, "season" | "span">): [number, number] =>
	s.span ?? [s.season, s.season];

export const overlapsSeason = (
	s: Pick<Story, "season" | "span">,
	season: number,
) => {
	const [a, b] = spanOf(s);
	return season >= a && season <= b;
};

// ---- shared indexes, built once per league snapshot (the LeagueIndex lookups scan lists, which is too slow inside loops over every player and season) ----

export const champion = (X: LeagueIndex, season: number) =>
	X.cached(`sl|champ|${season}`, () => X.champion(season));

export const teamsInSeason = (X: LeagueIndex, season: number) =>
	X.cached(`sl|teams|${season}`, () => X.teamsIn(season));

const lineIndex = (X: LeagueIndex) =>
	X.cached("sl|lines", () => {
		const m = new Map<string, SeasonLine>();
		for (const s of X.seasons) {
			for (const l of X.lines(s)) {
				m.set(`${l.pid}|${s}`, l);
			}
		}
		return m;
	});

export const lineOf = (X: LeagueIndex, pid: number, season: number) =>
	lineIndex(X).get(`${pid}|${season}`);

export const careerOf = (X: LeagueIndex, p: WPlayer) =>
	X.cached(`sl|career|${p.pid}`, () => X.career(p));
