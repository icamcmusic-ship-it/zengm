import { PHASE } from "../constants.ts";
import {
	isPickAsset,
	type VLeague,
	type VPickAsset,
	type VPlayer,
	type VTrade,
} from "./types.ts";

// Trade grader: every logged two-team trade graded A+ to F for each side by the regular-season win shares what it received produced for it. A player counts from the trade until he left (re-signing with the same team keeps him there); a draft pick counts as the player it was used on, while he played for that team. Against that: what the other side got out of the assets it gave up.
//
// A stat row without a win-share figure is unknown, never 0: a side holding one is partial, and a side whose pieces have no win shares on record at all is not graded. A pick traded on before it was used is "flipped" (its value is in the later trade, not here); a pick not used yet keeps the trade open.

// WS added to each side before grading, so a swap of bench players grades near even
export const PRIOR = 3;

// |net| under this many WS counts as an even trade on a report card
export const EVEN = 2;

// Share of the deal's win shares (with the prior) needed for each grade. An even trade is a B for both sides; a clear win tops out at A+, and the loser of a lopsided trade falls through C and D to F.
export const GRADE_CUTS: [number, Grade][] = [
	[0.8, "A+"],
	[0.7, "A"],
	[0.63, "A-"],
	[0.57, "B+"],
	[0.43, "B"],
	[0.37, "B-"],
	[0.32, "C+"],
	[0.27, "C"],
	[0.22, "C-"],
	[0.15, "D"],
	[-Infinity, "F"],
];

export type Grade =
	| "A+"
	| "A"
	| "A-"
	| "B+"
	| "B"
	| "B-"
	| "C+"
	| "C"
	| "C-"
	| "D"
	| "F";

export const POINTS: Record<Grade, number> = {
	"A+": 4.3,
	A: 4,
	"A-": 3.7,
	"B+": 3.3,
	B: 3,
	"B-": 2.7,
	"C+": 2.3,
	C: 2,
	"C-": 1.7,
	D: 1,
	F: 0,
};

const GPA_CUTS: [number, Grade][] = [
	[4.15, "A+"],
	[3.85, "A"],
	[3.5, "A-"],
	[3.15, "B+"],
	[2.85, "B"],
	[2.5, "B-"],
	[2.15, "C+"],
	[1.85, "C"],
	[1.5, "C-"],
	[0.75, "D"],
	[-Infinity, "F"],
];

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

export const gpaLetter = (x: number | null): Grade | null =>
	x === null ? null : GPA_CUTS.find(([t]) => x >= t)![1];

export const gradeLetter = (mine: number, theirs: number, prior = PRIOR) => {
	const a = Math.max(0, mine);
	const b = Math.max(0, theirs);
	const share = (a + prior) / (a + b + 2 * prior);
	const g = GRADE_CUTS.find(([t]) => share >= t)![1];
	return { g, share: Math.round(share * 1000) / 1000 };
};

// The season a trade was made for: in-season deals count for that season, offseason ones for the next
export const madeFor = (season: number, phase: number) =>
	phase > PHASE.PLAYOFFS ? season + 1 : season;

export type GradeItem = {
	kind: "player" | "pick";
	// traded: a player received. drafted: a pick used by this team. flipped: a pick traded on before it was used. pending: a pick not used yet. unknown: a player or pick whose fate is not on record
	how: "traded" | "drafted" | "flipped" | "pending" | "unknown";
	pid: number | null;
	name: string | null;
	pick: {
		season: number | string;
		round: number;
		originalTid: number;
		no: number | null;
	} | null;
	// Win shares for the team (null = unknown)
	now: number | null;
	later: number | null;
	total: number | null;
	seasons: number;
	partial: boolean;
	// Still with the team (or a pick still held)
	living: boolean;
	// For a flipped pick, the trade it went out in
	flipEid: number | null;
};

export type GradeSide = {
	eid: number;
	i: 0 | 1;
	tid: number;
	partner: number;
	season: number;
	phase: number;
	h: number;
	items: GradeItem[];
	got: { now: number; later: number; total: number };
	gave: { now: number; later: number; total: number };
	net: number | null;
	grade: { g: Grade; share: number } | null;
	unknown: boolean;
	partial: boolean;
	open: boolean;
};

export type GradeTrade = {
	eid: number;
	season: number;
	phase: number;
	h: number;
	tids: [number, number];
	sides: [GradeSide, GradeSide];
	open: boolean;
};

export type SideRef = {
	eid: number;
	i: 0 | 1;
	season: number;
	phase: number;
	partner: number;
	net: number;
	g: Grade;
};

export type ReportCard = {
	tid: number;
	n: number;
	graded: number;
	won: number;
	lost: number;
	even: number;
	open: number;
	got: number;
	gave: number;
	net: number;
	gpa: number | null;
	grade: Grade | null;
	best: SideRef | null;
	worst: SideRef | null;
	// Net WS by the season the trades were made for
	bySeason: { season: number; net: number }[];
};

export type TradeGrades = {
	trades: GradeTrade[];
	cards: ReportCard[];
	seasons: number[];
};

type Ctx = {
	cur: number;
	phase: number;
	players: Map<number, VPlayer>;
	byDpid: Map<number, VPlayer>;
	byPickKey: Map<string, VPlayer>;
	// dpid -> trades it moved in, by eid
	pickMoves: Map<number, { eid: number; to: number; from: number }[]>;
};

const isNum = (x: unknown): x is number =>
	typeof x === "number" && Number.isFinite(x);

const pickKey = (season: number | string, round: number, originalTid: number) =>
	`${season}|${round}|${originalTid}`;

export const makeCtx = (L: VLeague): Ctx => {
	const players = new Map<number, VPlayer>();
	const byDpid = new Map<number, VPlayer>();
	const byPickKey = new Map<string, VPlayer>();
	for (const p of L.players) {
		players.set(p.pid, p);
		if (p.draft.round > 0 && p.draft.tid >= 0) {
			if (isNum(p.draft.dpid)) {
				byDpid.set(p.draft.dpid, p);
			}
			byPickKey.set(
				pickKey(p.draft.year, p.draft.round, p.draft.originalTid),
				p,
			);
		}
	}
	const pickMoves = new Map<number, { eid: number; to: number; from: number }[]>();
	const trades = L.trades.toSorted((a, b) => a.eid - b.eid);
	for (const t of trades) {
		for (const i of [0, 1] as const) {
			for (const a of t.assets[i]) {
				if (isPickAsset(a)) {
					let arr = pickMoves.get(a.dpid);
					if (!arr) {
						arr = [];
						pickMoves.set(a.dpid, arr);
					}
					arr.push({ eid: t.eid, to: t.tids[i], from: t.tids[1 - i]! });
				}
			}
		}
	}
	return { cur: L.season, phase: L.phase, players, byDpid, byPickKey, pickMoves };
};

type Stint = {
	now: number;
	later: number;
	known: number;
	unknown: number;
	seasons: number;
	living: boolean;
};

// Win shares a player produced for team tid from a start (a trade or his draft) until he left, split at season h
export const stintFor = (
	p: VPlayer,
	tid: number,
	start: {
		type: "trade" | "draft";
		season: number;
		phase: number;
		eid?: number;
		statsIndex?: number;
	},
	h: number,
): Stint => {
	const from = start.phase > PHASE.PLAYOFFS ? start.season + 1 : start.season;

	// Where the start is in his transactions, then the first move to another team after it
	const txs = p.transactions;
	let startIdx = -1;
	if (start.type === "trade") {
		startIdx = txs.findIndex((t) => t.type === "trade" && t.eid === start.eid);
		if (startIdx < 0) {
			startIdx = txs.findLastIndex(
				(t) => t.type === "trade" && t.tid === tid && t.season === start.season,
			);
		}
	} else {
		startIdx = txs.findIndex((t) => t.type === "draft");
	}
	if (startIdx < 0) {
		startIdx =
			txs.findIndex(
				(t) =>
					t.season > start.season ||
					(t.season === start.season && t.phase > start.phase),
			) - 1;
		if (startIdx < -1) {
			startIdx = txs.length - 1;
		}
	}
	let endSeason = Infinity;
	let left = false;
	for (let k = startIdx + 1; k < txs.length; k++) {
		const t = txs[k]!;
		if (t.tid !== tid) {
			left = true;
			endSeason = t.phase > PHASE.PRESEASON ? t.season : t.season - 1;
			break;
		}
	}
	const living = !left && p.tid === tid;

	// Which of his stats rows came after the trade. Trade events store statsIndex like processTrade does: for a trade before the playoffs end, the index his first row with the new team will have (it may not exist yet); after the playoffs, the index of his last row with the old team. Used only if the row there is where it should be, else rows are picked by season
	let firstIndex: number | null = null;
	if (start.type === "trade" && isNum(start.statsIndex) && start.statsIndex >= 0) {
		const duringSeason = start.phase <= PHASE.PLAYOFFS;
		const row = p.rows.find((r) => r.i === start.statsIndex);
		if (duringSeason) {
			if (!row || (row.season === start.season && row.tid === tid)) {
				firstIndex = start.statsIndex;
			}
		} else if (row && row.season === start.season) {
			firstIndex = start.statsIndex + 1;
		}
	}

	let now = 0;
	let later = 0;
	let known = 0;
	let unknown = 0;
	const seasons = new Set<number>();
	for (const r of p.rows) {
		if (r.playoffs) {
			continue;
		}
		if (firstIndex !== null ? r.i < firstIndex : r.season < from) {
			continue;
		}
		if (r.season < from || r.season > endSeason) {
			continue;
		}
		if (r.tid !== tid) {
			// Played for someone else: he's gone. Without a valid statsIndex, rows of his old team in the season of an in-season trade may come before it
			if (
				(firstIndex !== null || r.season > from) &&
				(r.gp === null || r.gp > 0)
			) {
				break;
			}
			continue;
		}
		if (r.ws === null) {
			if (r.gp !== 0) {
				unknown += 1;
			}
			continue;
		}
		known += 1;
		if (r.gp === null || r.gp > 0) {
			seasons.add(r.season);
		}
		if (r.season <= h) {
			now += r.ws;
		} else {
			later += r.ws;
		}
	}
	return { now, later, known, unknown, seasons: seasons.size, living };
};

const fromStint = (w: Stint) => {
	const none = w.unknown > 0 && w.known === 0;
	return {
		now: none ? null : r1(w.now),
		later: none ? null : r1(w.later),
		total: none ? null : r1(w.now + w.later),
		seasons: w.seasons,
		partial: w.unknown > 0 && w.known > 0,
		living: w.living,
	};
};

// Has the draft for a pick's season happened?
const draftDone = (ctx: Ctx, season: number | string) => {
	if (typeof season !== "number") {
		// Fantasy and expansion draft picks are used right away
		return true;
	}
	return season < ctx.cur || (season === ctx.cur && ctx.phase >= PHASE.DRAFT);
};

const pickItem = (
	ctx: Ctx,
	a: VPickAsset,
	tid: number,
	t: VTrade,
	h: number,
): GradeItem => {
	const base: GradeItem = {
		kind: "pick",
		how: "pending",
		pid: null,
		name: null,
		pick: {
			season: a.season,
			round: a.round,
			originalTid: a.originalTid,
			no: null,
		},
		now: 0,
		later: 0,
		total: 0,
		seasons: 0,
		partial: false,
		living: false,
		flipEid: null,
	};
	const p =
		ctx.byDpid.get(a.dpid) ??
		(typeof a.season === "number"
			? ctx.byPickKey.get(pickKey(a.season, a.round, a.originalTid))
			: undefined);
	// Traded on later by this team?
	const nextMove = (ctx.pickMoves.get(a.dpid) ?? []).find(
		(m) => m.eid > t.eid && m.from === tid,
	);
	if (p) {
		base.pick!.no = p.draft.pick > 0 ? p.draft.pick : null;
		if (p.draft.tid === tid && !nextMove) {
			const w = stintFor(
				p,
				tid,
				{ type: "draft", season: p.draft.year, phase: PHASE.DRAFT },
				h,
			);
			return {
				...base,
				how: "drafted",
				pid: p.pid,
				name: p.name,
				...fromStint(w),
			};
		}
		return {
			...base,
			how: "flipped",
			pid: p.pid,
			name: p.name,
			flipEid: nextMove ? nextMove.eid : null,
		};
	}
	if (nextMove) {
		return { ...base, how: "flipped", flipEid: nextMove.eid };
	}
	if (!draftDone(ctx, a.season)) {
		return { ...base, how: "pending", living: true };
	}
	// Used, but the player it was used on is not on record
	return {
		...base,
		how: "unknown",
		now: null,
		later: null,
		total: null,
	};
};

export const gradeTrade = (ctx: Ctx, t: VTrade): GradeTrade => {
	const h = madeFor(t.season, t.phase);
	const sides = ([0, 1] as const).map((i): GradeSide => {
		const tid = t.tids[i];
		const items = t.assets[i].map((a): GradeItem => {
			if (isPickAsset(a)) {
				return pickItem(ctx, a, tid, t, h);
			}
			const p = ctx.players.get(a.pid);
			if (!p) {
				return {
					kind: "player",
					how: "unknown",
					pid: a.pid,
					name: a.name,
					pick: null,
					now: null,
					later: null,
					total: null,
					seasons: 0,
					partial: false,
					living: false,
					flipEid: null,
				};
			}
			const w = stintFor(
				p,
				tid,
				{
					type: "trade",
					season: t.season,
					phase: t.phase,
					eid: t.eid,
					statsIndex: a.statsIndex,
				},
				h,
			);
			return {
				kind: "player",
				how: "traded",
				pid: p.pid,
				name: p.name,
				pick: null,
				flipEid: null,
				...fromStint(w),
			};
		});
		const got = { now: 0, later: 0, total: 0 };
		let unknown = false;
		let partial = false;
		let open = false;
		for (const x of items) {
			if (x.total === null) {
				unknown = true;
			} else {
				got.now += x.now!;
				got.later += x.later!;
				got.total += x.total;
			}
			if (x.partial) {
				partial = true;
			}
			if (x.living) {
				open = true;
			}
		}
		got.now = r1(got.now);
		got.later = r1(got.later);
		got.total = r1(got.total);
		return {
			eid: t.eid,
			i,
			tid,
			partner: t.tids[1 - i]!,
			season: t.season,
			phase: t.phase,
			h,
			items,
			got,
			gave: { now: 0, later: 0, total: 0 },
			net: null,
			grade: null,
			unknown,
			partial: partial || unknown,
			open,
		};
	}) as [GradeSide, GradeSide];
	for (const s of sides) {
		const o = sides[1 - s.i]!;
		s.gave = { ...o.got };
		// Graded only when both sides have win shares on record
		const known =
			!s.unknown && !o.unknown && (s.items.length > 0 || o.items.length > 0);
		s.net = known ? r1(s.got.total - o.got.total) : null;
		s.grade = known ? gradeLetter(s.got.total, o.got.total) : null;
	}
	return {
		eid: t.eid,
		season: t.season,
		phase: t.phase,
		h,
		tids: [t.tids[0], t.tids[1]],
		sides,
		open: sides[0].open || sides[1].open,
	};
};

const sideRef = (s: GradeSide): SideRef => ({
	eid: s.eid,
	i: s.i,
	season: s.season,
	phase: s.phase,
	partner: s.partner,
	net: s.net!,
	g: s.grade!.g,
});

// Report cards per team, from a list of sides (all of them, or one season's)
export const reportCards = (sides: GradeSide[]): ReportCard[] => {
	type Acc = ReportCard & { pts: number; by: Map<number, number> };
	const m = new Map<number, Acc>();
	for (const s of sides) {
		let c = m.get(s.tid);
		if (!c) {
			c = {
				tid: s.tid,
				n: 0,
				graded: 0,
				won: 0,
				lost: 0,
				even: 0,
				open: 0,
				got: 0,
				gave: 0,
				net: 0,
				gpa: null,
				grade: null,
				best: null,
				worst: null,
				bySeason: [],
				pts: 0,
				by: new Map(),
			};
			m.set(s.tid, c);
		}
		c.n += 1;
		if (s.open) {
			c.open += 1;
		}
		if (!s.grade || s.net === null) {
			continue;
		}
		c.graded += 1;
		c.got += s.got.total;
		c.gave += s.gave.total;
		c.pts += POINTS[s.grade.g];
		if (Math.abs(s.net) < EVEN) {
			c.even += 1;
		} else if (s.net > 0) {
			c.won += 1;
		} else {
			c.lost += 1;
		}
		if (!c.best || s.net > c.best.net) {
			c.best = sideRef(s);
		}
		if (!c.worst || s.net < c.worst.net) {
			c.worst = sideRef(s);
		}
		c.by.set(s.h, r1((c.by.get(s.h) ?? 0) + s.net));
	}
	const out: ReportCard[] = [];
	for (const c of m.values()) {
		const { pts, by, ...card } = c;
		card.got = r1(card.got);
		card.gave = r1(card.gave);
		card.net = r1(card.got - card.gave);
		card.gpa = card.graded > 0 ? r2(pts / card.graded) : null;
		card.grade = gpaLetter(card.gpa);
		card.bySeason = [...by.entries()]
			.map(([season, net]) => ({ season, net }))
			.sort((a, b) => a.season - b.season);
		out.push(card);
	}
	return out.sort((a, b) => b.net - a.net || a.tid - b.tid);
};

export const gradeTrades = (L: VLeague): TradeGrades => {
	const ctx = makeCtx(L);
	const trades = L.trades
		.toSorted((a, b) => a.eid - b.eid)
		.map((t) => gradeTrade(ctx, t));
	const sides = trades.flatMap((t) => t.sides);
	return {
		trades,
		cards: reportCards(sides),
		seasons: [...new Set(trades.map((t) => t.season))].sort((a, b) => a - b),
	};
};

// Graded sides best first (net WS, then the grade share)
export const rankSides = (sides: GradeSide[]) =>
	sides
		.filter((s) => s.grade !== null && s.net !== null)
		.sort(
			(a, b) =>
				b.net! - a.net! ||
				b.grade!.share - a.grade!.share ||
				a.eid - b.eid ||
				a.i - b.i,
		);
