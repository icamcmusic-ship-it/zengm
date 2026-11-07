import type { LeagueIndex, SeasonLine } from "../league.ts";
import type { Slide, WBoxLine, WrappedMode } from "../types.ts";
import { fmtNum, isNum } from "../util.ts";

export type TopicCtx = {
	X: LeagueIndex;
	mode: WrappedMode;
	season: number;
	tid?: number;
	pid?: number;
	// Season still being played: only rates, no awards, champion or totals
	soFar: boolean;
};

export type Topic = (ctx: TopicCtx) => Slide | Slide[] | null | undefined;

export const mk = (
	o: Omit<Slide, "lines"> & { lines?: (string | null | undefined | false)[] },
): Slide => ({
	...o,
	lines: (o.lines ?? []).filter(
		(x): x is string => typeof x === "string" && x !== "",
	),
});

export type Metric = {
	k: "ppg" | "rpg" | "apg" | "spg" | "bpg" | "tpg" | "per" | "ws" | "tsPct" | "vorp" | "bpm";
	label: string;
	what: string;
	unit: string;
	d: number;
	pct?: boolean;
	total?: boolean;
	minPpg?: number;
	theme: string;
};

export const METRICS: Metric[] = [
	{ k: "ppg", label: "points per game", what: "scoring", unit: "PPG", d: 1, theme: "scoring" },
	{ k: "rpg", label: "rebounds per game", what: "rebounding", unit: "RPG", d: 1, theme: "inside" },
	{ k: "apg", label: "assists per game", what: "playmaking", unit: "APG", d: 1, theme: "playmaking" },
	{ k: "spg", label: "steals per game", what: "steals", unit: "SPG", d: 1, theme: "defense" },
	{ k: "bpg", label: "blocks per game", what: "shot-blocking", unit: "BPG", d: 1, theme: "defense" },
	{ k: "tpg", label: "threes per game", what: "three-point shooting", unit: "3PM per game", d: 1, theme: "scoring" },
	{ k: "per", label: "PER", what: "efficiency", unit: "PER", d: 1, theme: "efficiency" },
	{ k: "ws", label: "win shares", what: "win shares", unit: "WS", d: 1, total: true, theme: "efficiency" },
	{ k: "tsPct", label: "true shooting", what: "true shooting", unit: "TS%", d: 1, pct: true, minPpg: 10, theme: "efficiency" },
	{ k: "bpm", label: "box plus-minus", what: "box plus-minus", unit: "BPM", d: 1, theme: "efficiency" },
];

export const metricVal = (l: SeasonLine, m: Metric) => {
	const v = l[m.k];
	return isNum(v) ? v : NaN;
};

export const showMetric = (v: number, m: Metric) =>
	m.pct ? fmtNum(v * 100, 1) : fmtNum(v, m.d);

export const NOTES: Record<string, string> = {
	PER: "PER: player efficiency rating, a per-minute summary of a box score (15 is average)",
	WS: "Win shares: an estimate of the wins a player added",
	BPM: "BPM: box plus-minus, points per 100 possessions above an average player",
	"TS%": "TS%: true shooting, scoring efficiency counting threes and free throws",
	"game score": "Game score: a one-number summary of a box-score line (40 is a great night)",
};

// A box-score line with its game context
export type GameLine = WBoxLine & {
	gid: number;
	season: number;
	day: number;
	playoffs: boolean;
	tid: number;
	opp: number;
	won: boolean;
	pf: number;
	pa: number;
};

export const gameLines = (X: LeagueIndex, season: number): GameLine[] =>
	X.cached(`gl|${season}`, () => {
		const out: GameLine[] = [];
		for (const g of X.games(season)) {
			for (let i = 0; i < 2; i++) {
				const t = g.teams[i]!;
				const o = g.teams[1 - i]!;
				for (const p of t.players) {
					if (p.min <= 0) {
						continue;
					}
					out.push({
						...p,
						gid: g.gid,
						season: g.season,
						day: g.day,
						playoffs: g.playoffs,
						tid: t.tid,
						opp: o.tid,
						won: t.pts > o.pts,
						pf: t.pts,
						pa: o.pts,
					});
				}
			}
		}
		return out;
	});

export const allGameLines = (X: LeagueIndex) =>
	X.cached("gl|all", () => X.seasons.flatMap((s) => gameLines(X, s)));

export const isTripleDouble = (l: WBoxLine) =>
	[l.pts, l.trb, l.ast, l.stl, l.blk].filter((v) => v >= 10).length >= 3;

export const gameScoreText = (l: GameLine) =>
	`${l.pts} pts, ${l.trb} reb, ${l.ast} ast`;

export const lineText = (l: SeasonLine) =>
	`${fmtNum(l.ppg, 1)} pts, ${fmtNum(l.rpg, 1)} reb, ${fmtNum(l.apg, 1)} ast`;

export const BOX_STATS = [
	{ k: "pts", noun: "points", unit: "PTS" },
	{ k: "trb", noun: "rebounds", unit: "REB" },
	{ k: "ast", noun: "assists", unit: "AST" },
	{ k: "tp", noun: "three-pointers", unit: "3PM" },
	{ k: "blk", noun: "blocks", unit: "BLK" },
	{ k: "stl", noun: "steals", unit: "STL" },
] as const;

export const vsText = (X: LeagueIndex, l: GameLine) =>
	`${l.won ? "Win" : "Loss"} vs ${X.teamName(l.opp, l.season)}, ${l.pf}–${l.pa}${l.playoffs ? " (playoffs)" : ""}`;

export const teamFull = (X: LeagueIndex, tid: number, season: number) =>
	X.teamName(tid, season);
