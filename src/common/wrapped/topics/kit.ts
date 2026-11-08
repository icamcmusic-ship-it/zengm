// Building blocks for the extra topics: rank boards over every player-season or team-season in the league's history, two-way ranking (best or worst, whichever is more unusual), and small formatting helpers.
import type { LeagueIndex, SeasonLine } from "../league.ts";
import type { Slide, WPlayer, WTeamSeason } from "../types.ts";
import {
	fmtNum,
	isNum,
	ordinal,
	rankOf,
	rankScore,
	winPct,
	listText,
} from "../util.ts";
import { mk, type Topic, type TopicCtx } from "./helpers.ts";

export type X = LeagueIndex;

// "The best" for rank 1, "3rd-best" otherwise
export const nth = (r: number, w: string) =>
	r === 1 ? `The ${w}` : `${ordinal(r)}-${w}`;

export const pct = (x: number, d: number = 1) => `${fmtNum(x * 100, d)}%`;

// Contract and salary amounts are in thousands of dollars
export const money = (thousands: number) => {
	const m = thousands / 1000;
	if (Math.abs(m) >= 100) {
		return `$${fmtNum(m, 0)}M`;
	}
	return `$${fmtNum(m, 1)}M`;
};

export const rankLow = (values: readonly number[], v: number) => {
	let r = 1;
	for (const x of values) {
		if (x < v) {
			r += 1;
		}
	}
	return r;
};

export type TwoWay = { high: boolean; rank: number; score: number };

// Whether v is unusually high or unusually low among the values, whichever is more unusual
export const twoWay = (values: readonly number[], v: number): TwoWay => {
	const n = values.length;
	const rh = rankOf(values, v);
	const rl = rankLow(values, v);
	const sh = rankScore(rh, n);
	const sl = rankScore(rl, n);
	return sh >= sl
		? { high: true, rank: rh, score: sh }
		: { high: false, rank: rl, score: sl };
};

export type BoardItem = {
	v: number;
	season: number;
	pid: number;
	name: string;
};

// Last item before `season` that was at least as high (or as low) as v
export const lastLike = (
	items: readonly BoardItem[],
	v: number,
	season: number,
	high: boolean,
	skipPid?: number,
) => {
	let best: BoardItem | undefined;
	for (const it of items) {
		if (it.season >= season || it.pid === skipPid) {
			continue;
		}
		if ((high ? it.v >= v : it.v <= v) && (!best || it.season > best.season)) {
			best = it;
		}
	}
	return best;
};

export type LineDef = {
	id: string;
	group: string;
	theme: string;
	kicker: string;
	val: (l: SeasonLine) => number | undefined;
	// Extra eligibility on top of "qualified"
	ok?: (l: SeasonLine) => boolean;
	show: (v: number) => string;
	unit: string;
	// A count that only makes sense after the season is over
	total?: boolean;
	// Headlines for a high or low value; `low` omitted means only high is interesting
	hi: (name: string, v: number, rank: number) => string[];
	lo?: (name: string, v: number, rank: number) => string[];
	// Extra lines for the slide
	extra?: (l: SeasonLine, v: number) => (string | null)[];
	chips?: (l: SeasonLine) => [string, string][];
	note?: string;
	w: number;
	minBoard?: number;
};

// Every qualified player-season that has this value, over the league's history
export const lineBoard = (X: X, d: LineDef): BoardItem[] =>
	X.cached(`lb|${d.id}`, () => {
		const out: BoardItem[] = [];
		for (const s of X.seasons) {
			if (d.total && !X.decided(s)) {
				continue;
			}
			for (const l of X.qualified(s)) {
				if (d.ok && !d.ok(l)) {
					continue;
				}
				const v = d.val(l);
				if (isNum(v)) {
					out.push({ v, season: s, pid: l.pid, name: l.name });
				}
			}
		}
		return out;
	});

// A slide about how one player-season ranks in the league's history in a stat
export const lineSlide = (
	ctx: TopicCtx,
	d: LineDef,
	l: SeasonLine | undefined,
): Slide | null => {
	const { X, season, soFar } = ctx;
	if (!l || (d.total && soFar) || !X.qualified(season).includes(l)) {
		return null;
	}
	if (d.ok && !d.ok(l)) {
		return null;
	}
	const v = d.val(l);
	if (!isNum(v)) {
		return null;
	}
	const board = lineBoard(X, d);
	if (board.length < (d.minBoard ?? 60)) {
		return null;
	}
	const vals = board.map((x) => x.v);
	const w = d.lo ? twoWay(vals, v) : { high: true, rank: rankOf(vals, v) };
	const score = rankScore(w.rank, vals.length) * d.w;
	if (score < 0.1) {
		return null;
	}
	const heads = w.high ? d.hi(l.name, v, w.rank) : d.lo!(l.name, v, w.rank);
	const last = lastLike(board, v, season, w.high, l.pid);
	return mk({
		id: d.id,
		group: d.group,
		theme: d.theme,
		score,
		kicker: d.kicker,
		pid: l.pid,
		tid: l.tid,
		season,
		heads,
		hero: { text: d.show(v), unit: d.unit },
		chips: d.chips?.(l),
		lines: [
			`${nth(w.rank, w.high ? "highest" : "lowest")} of ${fmtNum(vals.length)} qualified seasons`,
			last
				? `Last one this ${w.high ? "high" : "low"}: ${last.name}, ${last.season}`
				: w.rank === 1
					? "A league record"
					: null,
			...(d.extra?.(l, v) ?? []),
		],
		note: d.note,
		facts: [`lb|${d.id}|${l.pid}`],
	});
};

export const playerTopic =
	(d: LineDef): Topic =>
	(ctx) =>
		lineSlide(ctx, d, ctx.X.line(ctx.pid!, ctx.season));

// The league leader in a stat, as a slide, scored by how the leader's number ranks in history
export const leaderSlide = (
	ctx: TopicCtx,
	d: LineDef,
	heads: (name: string, v: number) => string[],
	kicker: string,
	low: boolean = false,
): Slide | null => {
	const { X, season, soFar } = ctx;
	if (d.total && soFar) {
		return null;
	}
	const rows = X.qualified(season)
		.filter((l) => (d.ok ? d.ok(l) : true) && isNum(d.val(l)))
		.sort((a, b) => (low ? 1 : -1) * (d.val(a)! - d.val(b)!));
	const r = rows[0];
	if (!r || rows.length < 10) {
		return null;
	}
	const v = d.val(r)!;
	const board = lineBoard(X, d);
	if (board.length < (d.minBoard ?? 60)) {
		return null;
	}
	const vals = board.map((x) => x.v);
	const rank = low ? rankLow(vals, v) : rankOf(vals, v);
	const second = rows[1];
	const last = lastLike(board, v, season, !low, r.pid);
	return mk({
		id: d.id.replace(/^p-/, "s-lead-"),
		group: `${d.group}-lead`,
		theme: d.theme,
		score: Math.max(0.12, rankScore(rank, vals.length) * d.w),
		kicker,
		pid: r.pid,
		tid: r.tid,
		season,
		heads: heads(r.name, v),
		hero: { text: d.show(v), unit: d.unit },
		lines: [
			`${nth(rank, low ? "lowest" : "highest")} of ${fmtNum(vals.length)} qualified seasons`,
			last ? `Last one this good: ${last.name}, ${last.season}` : null,
			second ? `Runner-up: ${second.name}, ${d.show(d.val(second)!)}` : null,
		],
		note: d.note,
		facts: [`lb|${d.id}|${r.pid}`],
	});
};

// Slides for team-season boards: rank of a value among every team-season with games
export const allTeamSeasons = (X: X) =>
	X.cached("allTS", () =>
		X.L.teamSeasons.filter((t) => t.gp > 0 && t.won + t.lost + t.tied > 10),
	);

export const wpOf = (t: WTeamSeason) => winPct(t.won, t.lost, t.tied);

export const recText = (t: WTeamSeason) =>
	`${t.won}-${t.lost}${t.tied ? `-${t.tied}` : ""}${t.otl ? `-${t.otl}` : ""}`;

// A pair of wins and losses as "x-y", or undefined when either is missing
export const wl = (w: number | undefined, l: number | undefined) =>
	isNum(w) && isNum(l) ? { w, l } : undefined;

export const pctOf = (x: { w: number; l: number }) =>
	x.w + x.l > 0 ? x.w / (x.w + x.l) : 0;

// Players of a team in a season, with the best first by minutes
export const rosterByMin = (X: X, tid: number, season: number) =>
	[...X.teamLines(tid, season)].sort((a, b) => b.min - a.min);

export const age = (p: WPlayer, season: number) => season - p.bornYear;

// Minutes-weighted average of a value over a roster
export const wavg = (rows: SeasonLine[], f: (l: SeasonLine) => number) => {
	const m = rows.reduce((a, l) => a + l.min, 0);
	return m > 0 ? rows.reduce((a, l) => a + f(l) * l.min, 0) / m : 0;
};

export const names = (list: string[], max = 3) =>
	list.length > max
		? `${list.slice(0, max).join(", ")} and ${list.length - max} more`
		: listText(list);

export const firstSeasonOf = (p: WPlayer) =>
	p.stats.find((r) => r.gp > 0)?.season;

export const isRookieIn = (p: WPlayer, season: number) =>
	firstSeasonOf(p) === season;

// Career lines through a season, one per season, summed over teams
export const careerSeasons = (X: X, p: WPlayer, upTo: number = Infinity) => {
	const out: SeasonLine[] = [];
	for (const s of X.seasons) {
		if (s > upTo) {
			break;
		}
		const l = X.line(p.pid, s);
		if (l) {
			out.push(l);
		}
	}
	return out;
};

// A topic that returns nothing when the data it needs is missing
export const guard =
	(f: Topic): Topic =>
	(ctx) => {
		try {
			return f(ctx);
		} catch {
			return null;
		}
	};
