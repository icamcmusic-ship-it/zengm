// The front office, from the snapshot: what each side of a trade got out of it, what contracts bought, lottery luck, draft slots and releases. Shared by the Wrapped topics, the storylines and anything else that wants to talk about deals. Everything is computed through X.cached, so it is done once per snapshot, and takes an `upTo` season so a deck about one season never uses what happened after it.
import type { LeagueIndex } from "./league.ts";
import type {
	WContract,
	WLottery,
	WPlayer,
	WStat,
	WTrade,
	WTradeAsset,
} from "./types.ts";

// PHASE.PLAYOFFS: a trade made after it counts from the next season
const PLAYOFFS = 3;
// PHASE.REGULAR_SEASON and PHASE.AFTER_TRADE_DEADLINE
export const isInSeason = (t: WTrade) => t.phase >= 1 && t.phase <= PLAYOFFS;

// The first season a trade (or anything else made in that phase) can make a difference in
export const effSeason = (season: number, phase: number) =>
	phase > PLAYOFFS ? season + 1 : season;

export const tradeSeason = (t: WTrade) => effSeason(t.season, t.phase);

export const isPlayerAsset = (
	a: WTradeAsset,
): a is Extract<WTradeAsset, { pid: number }> => "pid" in a;

const regRows = (p: WPlayer) => p.stats.filter((r) => r.gp > 0);

// What a player gave team `tid` from season `from` on, until he left it (a season without a row is skipped, a season with only other teams ends it)
export const stintFor = (
	p: WPlayer,
	tid: number,
	from: number,
	upTo: number,
) => {
	let ws = 0;
	let gp = 0;
	let pts = 0;
	const seasons: number[] = [];
	const rows = regRows(p);
	const last = Math.min(upTo, rows.at(-1)?.season ?? from - 1);
	for (let s = from; s <= last; s++) {
		const inS = rows.filter((r) => r.season === s);
		if (inS.length === 0) {
			continue;
		}
		const mine = inS.filter((r) => r.tid === tid);
		if (mine.length === 0) {
			break;
		}
		for (const r of mine) {
			ws += r.ws;
			gp += r.gp;
			pts += r.pts;
		}
		seasons.push(s);
	}
	return { ws, gp, pts, seasons };
};

export type TradeGot = {
	pid: number;
	name: string;
	ws: number;
	gp: number;
	seasons: number[];
	// Set when the asset was a draft pick: the pick, and who was drafted with it
	pick?: { season: number | string; round: number; originalTid: number };
};

export type TradeSide = {
	tid: number;
	ws: number;
	got: TradeGot[];
	// Picks not used yet (or used by someone else), as text-ready facts
	pending: { season: number | string; round: number; originalTid: number }[];
	// Titles won with a player it got on the roster
	titles: number[];
};

export type TradeEval = {
	t: WTrade;
	at: number;
	sides: [TradeSide, TradeSide];
	// Index of the side that got more, and by how much
	winner: 0 | 1;
	margin: number;
	// Players and picks that changed hands
	size: number;
};

const byDpid = (X: LeagueIndex) =>
	X.cached("deals|dpid", () => {
		const m = new Map<number, WPlayer>();
		for (const p of X.L.players) {
			if (p.draftDpid !== undefined) {
				m.set(p.draftDpid, p);
			}
		}
		return m;
	});

const evalSide = (
	X: LeagueIndex,
	t: WTrade,
	i: 0 | 1,
	upTo: number,
): TradeSide => {
	const tid = t.tids[i];
	const at = tradeSeason(t);
	const got: TradeGot[] = [];
	const pending: TradeSide["pending"] = [];
	for (const a of t.got[i]) {
		if (isPlayerAsset(a)) {
			const p = X.players.get(a.pid);
			const st = p
				? stintFor(p, tid, at, upTo)
				: { ws: 0, gp: 0, pts: 0, seasons: [] };
			got.push({
				pid: a.pid,
				name: p?.name ?? a.name,
				ws: st.ws,
				gp: st.gp,
				seasons: st.seasons,
			});
		} else {
			const p = byDpid(X).get(a.dpid);
			const pick = {
				season: a.season,
				round: a.round,
				originalTid: a.originalTid,
			};
			if (p && p.draft.tid === tid && p.draft.year <= upTo) {
				const st = stintFor(p, tid, p.draft.year, upTo);
				got.push({
					pid: p.pid,
					name: p.name,
					ws: st.ws,
					gp: st.gp,
					seasons: st.seasons,
					pick,
				});
			} else {
				pending.push(pick);
			}
		}
	}
	const titles: number[] = [];
	for (let s = at; s <= upTo; s++) {
		if (!X.decided(s) || X.champion(s)?.tid !== tid) {
			continue;
		}
		const on = got.some((g) =>
			X.players
				.get(g.pid)
				?.po.some((r) => r.season === s && r.tid === tid && r.gp > 0),
		);
		if (on) {
			titles.push(s);
		}
	}
	return {
		tid,
		ws: got.reduce((a, g) => a + g.ws, 0),
		got,
		pending,
		titles,
	};
};

// Every trade with both sides measured through `upTo`, oldest first
export const tradeEvals = (X: LeagueIndex, upTo: number): TradeEval[] =>
	X.cached(`deals|ev|${upTo}`, () =>
		(X.L.trades ?? [])
			.filter((t) => t.season <= upTo)
			.map((t) => {
				const sides: [TradeSide, TradeSide] = [
					evalSide(X, t, 0, upTo),
					evalSide(X, t, 1, upTo),
				];
				const winner = sides[0].ws >= sides[1].ws ? 0 : 1;
				return {
					t,
					at: tradeSeason(t),
					sides,
					winner,
					margin: Math.abs(sides[0].ws - sides[1].ws),
					size: t.got[0].length + t.got[1].length,
				};
			}),
	);

// Trades that first count in season s (in-season trades of s and the summer before it)
export const tradesFor = (X: LeagueIndex, s: number, upTo: number = s) =>
	tradeEvals(X, upTo).filter((e) => e.at === s);

export const sideOf = (e: TradeEval, tid: number): number =>
	e.t.tids[0] === tid ? 0 : e.t.tids[1] === tid ? 1 : -1;

// Text for one side's haul, like "Ann Bell and a 2027 1st-round pick"
export const assetText = (
	X: LeagueIndex,
	assets: WTradeAsset[],
	max: number = 3,
) => {
	const parts = assets.map((a) =>
		isPlayerAsset(a)
			? (X.players.get(a.pid)?.name ?? a.name)
			: pickText(X, a),
	);
	if (parts.length > max) {
		return `${parts.slice(0, max).join(", ")} and ${parts.length - max} more`;
	}
	if (parts.length <= 1) {
		return parts[0] ?? "nothing";
	}
	return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
};

const ROUND = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

export const pickText = (
	X: LeagueIndex,
	a: { season: number | string; round: number; originalTid: number },
	season?: number,
) => {
	const yr = typeof a.season === "number" ? `${a.season} ` : "";
	const rd = ROUND[a.round - 1] ?? `round ${a.round}`;
	const s = season ?? (typeof a.season === "number" ? a.season : X.L.season);
	const t = X.teamAny(a.originalTid, s);
	return `a ${yr}${rd}-round pick${t ? ` (${t.abbrev})` : ""}`;
};

// ---- Contracts --------------------------------------------------------------

export type ContractRow = {
	p: WPlayer;
	c: WContract;
	// Index of the contract in his list
	i: number;
	// Last season it pays, after a release too
	end: number;
	// Last season he played on it (it ends early when he is released)
	playedTo: number;
	total: number;
	avg: number;
	// Win shares in the seasons he played on it, through `upTo`
	ws: number;
	seasons: number;
	tid?: number;
};

const sumRows = (rows: WStat[], from: number, to: number) => {
	let ws = 0;
	let gp = 0;
	const seen = new Set<number>();
	for (const r of rows) {
		if (r.season >= from && r.season <= to && r.gp > 0) {
			ws += r.ws;
			gp += r.gp;
			seen.add(r.season);
		}
	}
	return { ws, gp, seasons: seen.size };
};

// Every contract of every player, measured through `upTo`
export const contractRows = (X: LeagueIndex, upTo: number): ContractRow[] =>
	X.cached(`deals|ct|${upTo}`, () => {
		const out: ContractRow[] = [];
		for (const p of X.L.players) {
			const cs = p.contracts ?? [];
			for (let i = 0; i < cs.length; i++) {
				const c = cs[i]!;
				if (c.amounts.length === 0 || c.start > upTo) {
					continue;
				}
				const end = c.start + c.amounts.length - 1;
				const playedTo = Math.min(
					c.ended?.reason === "released" ? c.ended.season : end,
					upTo,
				);
				const total = c.amounts.reduce((a, b) => a + b, 0);
				const st = sumRows(p.stats, c.start, playedTo);
				out.push({
					p,
					c,
					i,
					end,
					playedTo,
					total,
					avg: total / c.amounts.length,
					ws: st.ws,
					seasons: st.seasons,
					tid: c.tid,
				});
			}
		}
		return out;
	});

// Salary of a contract in one season, if it pays then
export const salaryIn = (c: WContract, s: number) =>
	s >= c.start && s < c.start + c.amounts.length
		? c.amounts[s - c.start]
		: undefined;

// Contracts that started paying in season s, of the given kinds
export const signingsFor = (
	X: LeagueIndex,
	s: number,
	types: string[] = ["freeAgent", "reSign"],
) =>
	contractRows(X, s).filter(
		(r) => r.c.start === s && types.includes(r.c.type),
	);

// Released players: what was still owed after the release, in thousands
export type Release = {
	p: WPlayer;
	c: WContract;
	season: number;
	tid: number;
	owed: number;
	yearsLeft: number;
};

export const releases = (X: LeagueIndex, upTo: number): Release[] =>
	X.cached(`deals|rel|${upTo}`, () => {
		const out: Release[] = [];
		for (const p of X.L.players) {
			for (const c of p.contracts ?? []) {
				const e = c.ended;
				if (!e || e.reason !== "released" || e.season > upTo) {
					continue;
				}
				const tid = e.tid ?? c.tid;
				if (tid === undefined || tid < 0) {
					continue;
				}
				const left = c.amounts.slice(Math.max(0, e.season + 1 - c.start));
				out.push({
					p,
					c,
					season: e.season,
					tid,
					owed: left.reduce((a, b) => a + b, 0),
					yearsLeft: left.length,
				});
			}
		}
		return out;
	});

// The contract a player was on in season s
export const contractIn = (p: WPlayer, s: number) =>
	(p.contracts ?? []).findLast(
		(c) => s >= c.start && s < c.start + c.amounts.length,
	);

// ---- Lottery and draft ------------------------------------------------------

export type LotteryRow = WLottery["rows"][number] & {
	slot: number;
	// Places moved up (negative: down)
	jump: number;
	season: number;
};

export const lotteryRows = (X: LeagueIndex): LotteryRow[] =>
	X.cached("deals|lot", () => {
		const out: LotteryRow[] = [];
		for (const l of X.L.lottery ?? []) {
			l.rows.forEach((r, i) => {
				if (r.pick > 0) {
					out.push({
						...r,
						slot: i + 1,
						jump: i + 1 - r.pick,
						season: l.season,
					});
				}
			});
		}
		return out;
	});

export const lotteryOf = (X: LeagueIndex, s: number) =>
	lotteryRows(X).filter((r) => r.season === s);

// Drafted players of a class (round > 0), by pick
export const draftClass = (X: LeagueIndex, year: number) =>
	X.cached(`deals|class|${year}`, () =>
		X.L.players
			.filter((p) => p.draft.year === year && p.draft.round > 0)
			.sort(
				(a, b) =>
					a.draft.round - b.draft.round ||
					a.draft.pick - b.draft.pick ||
					a.pid - b.pid,
			),
	);

// Overall pick number within the draft (round 2 pick 3 in a 30-team league is 33)
export const overallPick = (X: LeagueIndex, p: WPlayer) => {
	const cls = draftClass(X, p.draft.year);
	const perRound = Math.max(
		1,
		...cls.filter((x) => x.draft.round === 1).map((x) => x.draft.pick),
	);
	return (p.draft.round - 1) * perRound + p.draft.pick;
};

// Career win shares through upTo
export const careerWs = (p: WPlayer, upTo: number) => {
	let ws = 0;
	for (const r of p.stats) {
		if (r.season <= upTo && r.gp > 0) {
			ws += r.ws;
		}
	}
	return ws;
};

export const teamsOf = (p: WPlayer, upTo: number = Infinity) => {
	const out: number[] = [];
	for (const r of p.stats) {
		if (r.season <= upTo && r.gp > 0 && !out.includes(r.tid)) {
			out.push(r.tid);
		}
	}
	return out;
};

// How many times a player was traded through upTo (from the trade events, or his own transactions if those are gone)
export const timesTraded = (X: LeagueIndex, p: WPlayer, upTo: number) => {
	const ev = (X.L.trades ?? []).filter(
		(t) =>
			t.season <= upTo &&
			t.got.some((side) =>
				side.some((a) => isPlayerAsset(a) && a.pid === p.pid),
			),
	).length;
	const mv = p.moves.filter(
		(m) => m.type === "trade" && m.season <= upTo,
	).length;
	return Math.max(ev, mv);
};

// Trades a player was part of, through upTo
export const tradesWith = (X: LeagueIndex, pid: number, upTo: number) =>
	tradeEvals(X, upTo).filter((e) =>
		e.t.got.some((side) =>
			side.some((a) => isPlayerAsset(a) && a.pid === pid),
		),
	);

export const hasDeals = (X: LeagueIndex) =>
	(X.L.trades?.length ?? 0) > 0 ||
	X.L.players.some((p) => (p.contracts?.length ?? 0) > 0);
