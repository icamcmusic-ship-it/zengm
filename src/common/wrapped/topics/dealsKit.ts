// Small helpers shared by the front-office topics (dealsSeason.ts, dealsTeam.ts, dealsPeople.ts)
import type { LeagueIndex } from "../league.ts";
import type { SlideListRow } from "../types.ts";
import { clamp01, fmtNum, plural } from "../util.ts";
import { assetText, type TradeEval, type TradeSide } from "../deals.ts";
import { money } from "./kit.ts";

export { clamp01, money };

export const ws1 = (x: number) => fmtNum(x, 1);

export const abbrev = (X: LeagueIndex, tid: number, s: number) =>
	X.teamAny(tid, s)?.abbrev ?? "";

// "the Aurora Herons"
export const theTeam = (X: LeagueIndex, tid: number, s: number) =>
	`the ${X.teamName(tid, s)}`;

// One side of a trade as a list row
export const sideRow = (
	X: LeagueIndex,
	e: TradeEval,
	i: 0 | 1,
	s: number,
	withWs: boolean,
): SlideListRow => ({
	name: X.teamName(e.sides[i].tid, s),
	value: withWs
		? `${ws1(e.sides[i].ws)} WS`
		: plural(e.t.got[i].length, "asset"),
	sub: `Got ${assetText(X, e.t.got[i])}`,
	tid: e.sides[i].tid,
});

export const tradeLine = (X: LeagueIndex, e: TradeEval, s: number) =>
	`${X.teamName(e.t.tids[0], s)} got ${assetText(X, e.t.got[0])}; ${X.teamName(e.t.tids[1], s)} got ${assetText(X, e.t.got[1])}`;

export const topGot = (side: TradeSide) =>
	side.got.toSorted((a, b) => b.ws - a.ws || a.pid - b.pid)[0];

// A score from a value and the value where it gets interesting
export const lift = (v: number, at: number, base = 0.3, w = 0.4) =>
	clamp01(base + Math.min(w, (v / at) * w));

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const yrs = (n: number) => plural(n, "year");
