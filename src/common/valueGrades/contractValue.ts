import { PHASE } from "../constants.ts";
import type { VContract, VLeague, VPlayer } from "./types.ts";

// Contract value: what teams paid (contract payments, thousands of dollars) against the regular-season win shares they got back.
// - value index: win shares per dollar against the league's rate that season (1 = average, shown as 100)
// - surplus: win shares above what the league rate buys with the same money
// - dead money: what a team paid (or still owes) a player it released, for seasons he didn't play for it
// Only completed seasons are ranked. A player-season whose stat rows have no win-share figure is unknown, never 0: it is left out and counted.

export type Metric = "surplus" | "perM" | "index";

export type ValueRow = {
	pid: number;
	name: string;
	season: number;
	tid: number;
	amount: number;
	ws: number;
	min: number;
	gp: number;
	expected: number;
	surplus: number;
	perM: number;
	index: number | null;
	big: boolean;
};

export type Deal = {
	pid: number;
	name: string;
	type: string;
	eid: number | undefined;
	start: number;
	exp: number;
	years: number;
	amount: number;
	released: boolean;
	ongoing: boolean;
	elapsed: number;
	paid: number;
	ws: number;
	min: number;
	expected: number;
	surplus: number;
	perM: number | null;
	index: number | null;
	wasted: number | null;
	dead: number;
	known: boolean;
	tids: number[];
	bornYear: number;
};

export type DeadEntry = {
	pid: number;
	name: string;
	tid: number;
	season: number;
	amount: number;
	releasedIn: number;
	// Not paid yet (the season is still being played, or later)
	owed: boolean;
};

export type TeamSeasonValue = {
	tid: number;
	season: number;
	payroll: number;
	ws: number;
	expected: number;
	index: number;
	surplus: number;
	dead: number;
	won: number | null;
	lost: number | null;
};

type Line = {
	ws: number;
	min: number;
	gp: number;
	tid: number | null;
	unknown: boolean;
	// teams he played for (gp > 0)
	tids: Set<number>;
};

export type ContractValue = {
	season: number;
	lastDone: number;
	seasons: number[];
	rows: ValueRow[];
	// pid|season of completed player-seasons with salary but unknown win shares
	unknownCount: number;
	rate: Map<number, number>;
	bigLine: Map<number, number>;
	deals: Deal[];
	dead: DeadEntry[];
	teamSeasons: TeamSeasonValue[];
	lines: Map<number, Map<number, Line>>;
};

const M = (k: number) => k / 1000;

export const lastDoneSeason = (season: number, phase: number) =>
	phase > PHASE.PLAYOFFS ? season : season - 1;

const seasonLines = (p: VPlayer) => {
	const m = new Map<number, Line>();
	for (const r of p.rows) {
		if (r.playoffs) {
			continue;
		}
		let e = m.get(r.season);
		if (!e) {
			e = { ws: 0, min: 0, gp: 0, tid: null, unknown: false, tids: new Set() };
			m.set(r.season, e);
		}
		const played = r.gp === null || r.gp > 0;
		if (r.ws === null) {
			if (r.gp !== 0) {
				e.unknown = true;
			}
		} else {
			e.ws += r.ws;
		}
		e.min += r.min;
		e.gp += r.gp ?? 0;
		if (played) {
			e.tid = r.tid;
			e.tids.add(r.tid);
		}
	}
	return m;
};

const exp = (c: VContract) => c.start + c.amounts.length - 1;

// The team that released him: endedEarly.tid until the contract is fully paid, then the biggest payer in the release season
const releasingTid = (c: VContract) => {
	const ee = c.endedEarly;
	if (!ee || ee.reason !== "released") {
		return undefined;
	}
	if (ee.tid !== undefined) {
		return ee.tid;
	}
	let best: { tid: number; amount: number } | undefined;
	for (const pay of c.payments) {
		if (pay.season === ee.season && pay.tid >= 0) {
			if (!best || pay.amount > best.amount) {
				best = pay;
			}
		}
	}
	return best?.tid;
};

const percentile = (values: number[], q: number) => {
	if (values.length === 0) {
		return Infinity;
	}
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};

export const computeContractValue = (L: VLeague): ContractValue => {
	const lastDone = lastDoneSeason(L.season, L.phase);
	const lines = new Map<number, Map<number, Line>>();
	const rows: ValueRow[] = [];
	const dead: DeadEntry[] = [];
	let unknownCount = 0;

	// Live payments per player-season, and per payer-season for team payrolls
	type PlayerWork = {
		p: VPlayer;
		// contract index -> season -> live paid
		live: Map<number, Map<number, number>>;
		deadByContract: Map<number, number>;
	};
	const work: PlayerWork[] = [];
	const payroll = new Map<string, number>(); // tid|season
	const deadPaid = new Map<string, number>(); // tid|season

	for (const p of L.players) {
		const sl = seasonLines(p);
		lines.set(p.pid, sl);
		if (p.contracts.length === 0) {
			continue;
		}
		const w: PlayerWork = { p, live: new Map(), deadByContract: new Map() };
		for (const [ci, c] of p.contracts.entries()) {
			const relTid = releasingTid(c);
			const deadSeasons = new Set<number>();
			if (c.endedEarly?.reason === "released" && relTid !== undefined) {
				for (let s = c.endedEarly.season; s <= exp(c); s++) {
					const line = sl.get(s);
					if (line && line.tids.has(relTid)) {
						continue;
					}
					deadSeasons.add(s);
					let amount: number;
					const owed = s > lastDone;
					if (owed) {
						amount = c.amounts[s - c.start] ?? 0;
					} else {
						amount = 0;
						for (const pay of c.payments) {
							if (pay.season === s && pay.tid === relTid) {
								amount += pay.amount;
							}
						}
					}
					if (amount > 0) {
						dead.push({
							pid: p.pid,
							name: p.name,
							tid: relTid,
							season: s,
							amount,
							releasedIn: c.endedEarly.season,
							owed,
						});
						w.deadByContract.set(ci, (w.deadByContract.get(ci) ?? 0) + amount);
						if (!owed) {
							const k = `${relTid}|${s}`;
							deadPaid.set(k, (deadPaid.get(k) ?? 0) + amount);
						}
					}
				}
			}
			const live = new Map<number, number>();
			for (const pay of c.payments) {
				if (pay.season > lastDone) {
					continue;
				}
				if (deadSeasons.has(pay.season) && pay.tid === relTid) {
					continue;
				}
				live.set(pay.season, (live.get(pay.season) ?? 0) + pay.amount);
				// Payments from before teams were tracked go to the team he played for
				const payer =
					pay.tid >= 0 ? pay.tid : (sl.get(pay.season)?.tid ?? null);
				if (payer !== null && payer >= 0) {
					const k = `${payer}|${pay.season}`;
					payroll.set(k, (payroll.get(k) ?? 0) + pay.amount);
				}
			}
			w.live.set(ci, live);
		}
		work.push(w);

		// Player-seasons: live pay across his contracts
		const paidBySeason = new Map<number, number>();
		for (const live of w.live.values()) {
			for (const [s, a] of live) {
				paidBySeason.set(s, (paidBySeason.get(s) ?? 0) + a);
			}
		}
		for (const [season, amount] of paidBySeason) {
			if (!(amount > 0) || season > lastDone) {
				continue;
			}
			const line = sl.get(season);
			if (line?.unknown) {
				unknownCount += 1;
				continue;
			}
			let tid = line?.tid ?? null;
			if (tid === null) {
				// Paid but never played: the team that paid most
				let best = -1;
				let bestAmount = 0;
				for (const c of p.contracts) {
					for (const pay of c.payments) {
						if (pay.season === season && pay.amount > bestAmount) {
							best = pay.tid;
							bestAmount = pay.amount;
						}
					}
				}
				tid = best;
			}
			rows.push({
				pid: p.pid,
				name: p.name,
				season,
				tid,
				amount,
				ws: line?.ws ?? 0,
				min: line?.min ?? 0,
				gp: line?.gp ?? 0,
				expected: 0,
				surplus: 0,
				perM: 0,
				index: null,
				big: false,
			});
		}
	}

	// League rate: win shares per $M paid, per season
	const bySeason = new Map<number, ValueRow[]>();
	for (const r of rows) {
		let a = bySeason.get(r.season);
		if (!a) {
			a = [];
			bySeason.set(r.season, a);
		}
		a.push(r);
	}
	const rate = new Map<number, number>();
	const bigLine = new Map<number, number>();
	for (const [s, a] of bySeason) {
		let ws = 0;
		let pay = 0;
		for (const r of a) {
			ws += Math.max(0, r.ws);
			pay += M(r.amount);
		}
		rate.set(s, pay > 0 ? ws / pay : 0);
		bigLine.set(
			s,
			percentile(
				a.map((r) => r.amount),
				0.85,
			),
		);
	}
	for (const r of rows) {
		r.perM = r.ws / M(r.amount);
		r.expected = M(r.amount) * (rate.get(r.season) ?? 0);
		r.surplus = r.ws - r.expected;
		r.index = r.expected > 0 ? r.ws / r.expected : null;
		r.big = r.amount >= (bigLine.get(r.season) ?? Infinity);
	}

	// Whole contracts
	const deals: Deal[] = [];
	for (const w of work) {
		const p = w.p;
		const sl = lines.get(p.pid)!;
		for (const [ci, c] of p.contracts.entries()) {
			const ee = c.endedEarly;
			let stop = exp(c);
			if (ee) {
				const relTid = releasingTid(c);
				if (ee.reason === "released") {
					const line = sl.get(ee.season);
					stop =
						relTid !== undefined && line?.tids.has(relTid)
							? ee.season
							: ee.season - 1;
				} else {
					stop = Math.min(stop, ee.season);
				}
			}
			const live = w.live.get(ci)!;
			const hasPayments = c.payments.length > 0;
			let ws = 0;
			let min = 0;
			let paid = 0;
			let expected = 0;
			let elapsed = 0;
			let known = true;
			const tids: number[] = [];
			for (let s = c.start; s <= Math.min(stop, lastDone); s++) {
				const line = sl.get(s);
				const amount = hasPayments
					? (live.get(s) ?? 0)
					: (c.amounts[s - c.start] ?? 0);
				if (line?.unknown) {
					known = false;
				}
				ws += line?.ws ?? 0;
				min += line?.min ?? 0;
				paid += amount;
				expected += M(amount) * (rate.get(s) ?? 0);
				elapsed += 1;
				if (
					line?.tid !== null &&
					line?.tid !== undefined &&
					!tids.includes(line.tid)
				) {
					tids.push(line.tid);
				}
			}
			if (tids.length === 0) {
				for (const pay of c.payments) {
					if (pay.tid >= 0 && !tids.includes(pay.tid)) {
						tids.push(pay.tid);
					}
				}
			}
			deals.push({
				pid: p.pid,
				name: p.name,
				type: c.type,
				eid: c.eid,
				start: c.start,
				exp: exp(c),
				years: c.amounts.length,
				amount: Math.max(...c.amounts),
				released: ee?.reason === "released",
				ongoing: !ee && exp(c) > lastDone,
				elapsed,
				paid,
				ws,
				min,
				expected,
				surplus: ws - expected,
				perM: paid > 0 ? ws / M(paid) : null,
				index: expected > 0 ? ws / expected : null,
				wasted:
					expected > 0
						? Math.max(0, paid * (1 - Math.max(0, ws) / expected))
						: null,
				dead: w.deadByContract.get(ci) ?? 0,
				known,
				tids,
				bornYear: p.bornYear,
			});
		}
	}

	// Team-seasons: payroll by the team that paid, against the win shares of its players that season
	const tsWs = new Map<string, { ws: number; unknown: number; n: number }>();
	for (const [, sl] of lines) {
		for (const [season, line] of sl) {
			if (season > lastDone) {
				continue;
			}
			for (const tid of line.tids) {
				const k = `${tid}|${season}`;
				let e = tsWs.get(k);
				if (!e) {
					e = { ws: 0, unknown: 0, n: 0 };
					tsWs.set(k, e);
				}
				if (line.unknown) {
					e.unknown += 1;
				} else {
					e.n += 1;
				}
			}
		}
	}
	// Exact WS by team (a player traded in-season counts for each team)
	for (const p of L.players) {
		for (const r of p.rows) {
			if (r.playoffs || r.season > lastDone || r.ws === null) {
				continue;
			}
			const e = tsWs.get(`${r.tid}|${r.season}`);
			if (e) {
				e.ws += r.ws;
			}
		}
	}
	const records = new Map(
		L.teamSeasons.map((t) => [`${t.tid}|${t.season}`, t]),
	);
	const teamSeasons: TeamSeasonValue[] = [];
	for (const [k, pay] of payroll) {
		const [tidS, seasonS] = k.split("|");
		const tid = Number(tidS);
		const season = Number(seasonS);
		const e = tsWs.get(k);
		if (!e || e.n === 0 || e.n < 0.5 * (e.n + e.unknown)) {
			continue;
		}
		const expected = M(pay) * (rate.get(season) ?? 0);
		if (!(expected > 0)) {
			continue;
		}
		const rec = records.get(k);
		teamSeasons.push({
			tid,
			season,
			payroll: pay,
			ws: e.ws,
			expected,
			index: e.ws / expected,
			surplus: e.ws - expected,
			dead: deadPaid.get(k) ?? 0,
			won: rec ? rec.won : null,
			lost: rec ? rec.lost : null,
		});
	}
	teamSeasons.sort((a, b) => a.season - b.season || a.tid - b.tid);

	return {
		season: L.season,
		lastDone,
		seasons: [...bySeason.keys()].sort((a, b) => a - b),
		rows,
		unknownCount,
		rate,
		bigLine,
		deals,
		dead,
		teamSeasons,
		lines,
	};
};

// The first n of arr sorted by cmp, without sorting everything
export const topN = <T>(arr: T[], n: number, cmp: (a: T, b: T) => number) => {
	if (arr.length <= n * 4) {
		return arr.toSorted(cmp).slice(0, n);
	}
	const out = arr.slice(0, n).sort(cmp);
	for (let i = n; i < arr.length; i++) {
		const x = arr[i]!;
		if (!(cmp(x, out[n - 1]!) < 0)) {
			continue;
		}
		let lo = 0;
		let hi = n - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (cmp(out[mid]!, x) <= 0) {
				lo = mid + 1;
			} else {
				hi = mid;
			}
		}
		out.splice(lo, 0, x);
		out.pop();
	}
	return out;
};

const metricValue = (
	x: { surplus: number; perM: number | null; index: number | null },
	m: Metric,
) =>
	m === "surplus" ? x.surplus : m === "perM" ? (x.perM ?? 0) : (x.index ?? 0);

type Filter = { season?: number; tid?: number };

// Best and worst value player-seasons by a metric. Per $ measures need 1,000+ minutes for the best list and look only at big contracts (top 15% that season) for the worst, or cheap deals dominate
export const valueSeasons = (
	cv: ContractValue,
	metric: Metric,
	o: Filter = {},
	n = 100,
) => {
	const pool = cv.rows.filter(
		(r) =>
			(o.season === undefined || r.season === o.season) &&
			(o.tid === undefined || r.tid === o.tid),
	);
	const v = (r: ValueRow) => metricValue(r, metric);
	if (metric === "surplus") {
		return {
			best: topN(pool, n, (a, b) => v(b) - v(a) || a.pid - b.pid),
			worst: topN(pool, n, (a, b) => v(a) - v(b) || a.pid - b.pid),
		};
	}
	return {
		best: topN(
			pool.filter((r) => r.min >= 1000 && r.ws > 0 && r.index !== null),
			n,
			(a, b) => v(b) - v(a) || a.pid - b.pid,
		),
		worst: topN(
			pool.filter((r) => r.big && r.index !== null),
			n,
			(a, b) => v(a) - v(b) || a.pid - b.pid,
		),
	};
};

const dealPool = (cv: ContractValue) =>
	cv.deals.filter((c) => c.known && c.elapsed >= 2 && c.index !== null);

const dealMatches = (c: Deal, o: Filter) =>
	(o.season === undefined || (c.start <= o.season && c.exp >= o.season)) &&
	(o.tid === undefined || c.tids.includes(o.tid));

// Best and worst whole contracts (two or more completed seasons)
export const valueDeals = (
	cv: ContractValue,
	metric: Metric,
	o: Filter = {},
	n = 100,
) => {
	const all = dealPool(cv);
	const bigCut = percentile(
		all.map((c) => c.amount),
		0.8,
	);
	const pool = all.filter((c) => dealMatches(c, o));
	const v = (c: Deal) => metricValue(c, metric);
	if (metric === "surplus") {
		return {
			best: topN(pool, n, (a, b) => v(b) - v(a) || a.pid - b.pid),
			worst: topN(pool, n, (a, b) => v(a) - v(b) || a.pid - b.pid),
		};
	}
	return {
		best: topN(
			pool.filter((c) => c.min >= 3000 && c.ws > 0),
			n,
			(a, b) => v(b) - v(a) || a.pid - b.pid,
		),
		worst: topN(
			pool.filter((c) => c.amount >= bigCut),
			n,
			(a, b) => v(a) - v(b) || a.pid - b.pid,
		),
	};
};

// Big deals (top 20% of per-year salaries among deals with 2+ completed seasons) under the league rate, by money paid over what the production was worth, plus dead money
export const albatross = (cv: ContractValue, o: Filter = {}) => {
	const pool = dealPool(cv);
	if (pool.length === 0) {
		return [];
	}
	const cut = percentile(
		pool.map((c) => c.amount),
		0.8,
	);
	return pool
		.filter((c) => c.amount >= cut && c.index! < 1 && dealMatches(c, o))
		.map((c) => ({ ...c, cost: (c.wasted ?? 0) + c.dead }))
		.sort((a, b) => b.cost - a.cost || a.pid - b.pid);
};

// The biggest bargain (most surplus WS) and the worst big-money season of every season
export const bargains = (cv: ContractValue, o: Filter = {}) => {
	const by = new Map<
		number,
		{
			season: number;
			best: ValueRow | null;
			worst: ValueRow | null;
			n: number;
			top: ValueRow[];
		}
	>();
	for (const r of cv.rows) {
		if (
			(o.season !== undefined && r.season !== o.season) ||
			(o.tid !== undefined && r.tid !== o.tid)
		) {
			continue;
		}
		let x = by.get(r.season);
		if (!x) {
			x = { season: r.season, best: null, worst: null, n: 0, top: [] };
			by.set(r.season, x);
		}
		x.n += 1;
		if (!x.best || r.surplus > x.best.surplus) {
			x.best = r;
		}
		if (r.big && (!x.worst || r.surplus < x.worst.surplus)) {
			x.worst = r;
		}
		x.top.push(r);
	}
	const out = [...by.values()].sort((a, b) => b.season - a.season);
	for (const x of out) {
		x.top = topN(x.top, 5, (a, b) => b.surplus - a.surplus || a.pid - b.pid);
	}
	return out;
};

export type TeamValue = {
	tid: number;
	payroll: number;
	ws: number;
	expected: number;
	index: number;
	surplus: number;
	dead: number;
	seasons: number;
	wins: number;
	games: number;
	winp: number | null;
	best: TeamSeasonValue;
	worst: TeamSeasonValue;
	rank: number;
};

// Teams ranked by value index over the chosen seasons
export const teamEfficiency = (
	cv: ContractValue,
	o: { season?: number } = {},
) => {
	const m = new Map<
		number,
		Omit<TeamValue, "index" | "surplus" | "winp" | "rank">
	>();
	for (const t of cv.teamSeasons) {
		if (o.season !== undefined && t.season !== o.season) {
			continue;
		}
		let x = m.get(t.tid);
		if (!x) {
			x = {
				tid: t.tid,
				payroll: 0,
				ws: 0,
				expected: 0,
				dead: 0,
				seasons: 0,
				wins: 0,
				games: 0,
				best: t,
				worst: t,
			};
			m.set(t.tid, x);
		}
		x.payroll += t.payroll;
		x.ws += t.ws;
		x.expected += t.expected;
		x.dead += t.dead;
		x.seasons += 1;
		if (t.won !== null && t.lost !== null) {
			x.wins += t.won;
			x.games += t.won + t.lost;
		}
		if (t.index > x.best.index) {
			x.best = t;
		}
		if (t.index < x.worst.index) {
			x.worst = t;
		}
	}
	const out: TeamValue[] = [...m.values()]
		.filter((x) => x.expected > 0)
		.map((x) => ({
			...x,
			index: x.ws / x.expected,
			surplus: x.ws - x.expected,
			winp: x.games > 0 ? x.wins / x.games : null,
			rank: 0,
		}));
	out.sort((a, b) => b.index - a.index || a.tid - b.tid);
	for (const [i, x] of out.entries()) {
		x.rank = i + 1;
	}
	return out;
};

export const MIN_CY = 500;

export type ContractYearRow = {
	deal: Deal;
	tid: number;
	season: number;
	age: number;
	before: number;
	final: number;
	after: number | null;
	d: number;
	dAfter: number | null;
};

// The last season of a finished multi-year deal against its earlier seasons (WS per 48 minutes, MIN_CY+ minutes in each), and the season after
export const contractYear = (cv: ContractValue, o: Filter = {}) => {
	const per48 = (ws: number, min: number) => (ws * 48) / min;
	const rows: ContractYearRow[] = [];
	for (const c of cv.deals) {
		if (!c.known || c.years < 2 || c.exp > cv.lastDone || c.released) {
			continue;
		}
		if (o.season !== undefined && c.exp !== o.season) {
			continue;
		}
		const sl = cv.lines.get(c.pid);
		const fin = sl?.get(c.exp);
		if (!sl || !fin || fin.unknown || fin.min < MIN_CY || fin.tid === null) {
			continue;
		}
		if (o.tid !== undefined && fin.tid !== o.tid) {
			continue;
		}
		let ws = 0;
		let min = 0;
		for (let s = c.start; s < c.exp; s++) {
			const r = sl.get(s);
			if (r && !r.unknown) {
				ws += r.ws;
				min += r.min;
			}
		}
		if (min < MIN_CY) {
			continue;
		}
		const aft = sl.get(c.exp + 1);
		const final = per48(fin.ws, fin.min);
		const before = per48(ws, min);
		const after =
			aft && !aft.unknown && aft.min >= MIN_CY && c.exp + 1 <= cv.lastDone
				? per48(aft.ws, aft.min)
				: null;
		rows.push({
			deal: c,
			tid: fin.tid,
			season: c.exp,
			age: c.exp - c.bornYear,
			before,
			final,
			after,
			d: final - before,
			dAfter: after === null ? null : after - final,
		});
	}
	rows.sort((a, b) => b.d - a.d || a.deal.pid - b.deal.pid);
	const mean = (xs: number[]) =>
		xs.length > 0 ? xs.reduce((t, x) => t + x, 0) / xs.length : null;
	const withAfter = rows.filter((r) => r.after !== null);
	return {
		rows,
		n: rows.length,
		up: rows.filter((r) => r.d > 0).length,
		meanBefore: mean(rows.map((r) => r.before)),
		meanFinal: mean(rows.map((r) => r.final)),
		meanFinalWithAfter: mean(withAfter.map((r) => r.final)),
		meanAfter: mean(withAfter.map((r) => r.after!)),
		nAfter: withAfter.length,
		drop: withAfter.filter((r) => r.dAfter! < 0).length,
	};
};

// Dead money per team: paid so far and still owed
export const deadByTeam = (cv: ContractValue) => {
	const m = new Map<
		number,
		{
			tid: number;
			paid: number;
			owed: number;
			releases: Set<string>;
			owedPids: Set<number>;
			lastOwed: number | null;
		}
	>();
	for (const d of cv.dead) {
		let e = m.get(d.tid);
		if (!e) {
			e = {
				tid: d.tid,
				paid: 0,
				owed: 0,
				releases: new Set(),
				owedPids: new Set(),
				lastOwed: null,
			};
			m.set(d.tid, e);
		}
		if (d.owed) {
			e.owed += d.amount;
			e.owedPids.add(d.pid);
			e.lastOwed = Math.max(e.lastOwed ?? 0, d.season);
		} else {
			e.paid += d.amount;
		}
		e.releases.add(`${d.pid}|${d.releasedIn}`);
	}
	return [...m.values()]
		.map((e) => ({
			tid: e.tid,
			paid: e.paid,
			owed: e.owed,
			total: e.paid + e.owed,
			releases: e.releases.size,
			owedPlayers: e.owedPids.size,
			lastOwed: e.lastOwed,
		}))
		.sort((a, b) => b.owed - a.owed || b.total - a.total || a.tid - b.tid);
};

// A player's value index by completed season, for his page
export const playerValueIndex = (cv: ContractValue, pid: number) =>
	cv.rows
		.filter((r) => r.pid === pid)
		.map((r) => ({ season: r.season, index: r.index, surplus: r.surplus }));
