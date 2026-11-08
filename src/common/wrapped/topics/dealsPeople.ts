// Player and all-time topics about the front office: a player's trades, contracts, release and draft night; the league's most lopsided trades, best and worst contracts, lottery luck, draft slots and longest-running teammates.
import { mk, type Topic } from "./helpers.ts";
import { fmtNum, ordinal, plural, rankOf, rankScore } from "../util.ts";
import {
	assetText,
	careerWs,
	contractIn,
	contractRows,
	draftClass,
	isPlayerAsset,
	lotteryRows,
	overallPick,
	releases,
	salaryIn,
	stintFor,
	timesTraded,
	tradeEvals,
	tradesWith,
	type ContractRow,
} from "../deals.ts";
import {
	clamp01,
	lift,
	money,
	sum,
	topGot,
	tradeLine as tradeLineFor,
	ws1,
} from "./dealsKit.ts";
import type { LeagueIndex } from "../league.ts";
import type { WPlayer, WTradeAsset } from "../types.ts";

const KIND: Record<string, string> = {
	rookie: "rookie deal",
	reSign: "re-signing",
	freeAgent: "free-agent deal",
	unknown: "contract",
};

// ---- Player -----------------------------------------------------------------

const tradedP: Topic = ({ X, season, pid }) => {
	const e = tradesWith(X, pid!, season).findLast(
		(x) => x.t.season === season || x.at === season,
	);
	if (!e) {
		return null;
	}
	const i = e.t.got.findIndex((side) =>
		side.some((a) => isPlayerAsset(a) && a.pid === pid),
	) as 0 | 1;
	const to = e.t.tids[i];
	const from = e.t.tids[1 - i]!;
	return mk({
		id: "p-d-traded",
		group: "p-trade",
		theme: "moves",
		score: 0.4,
		kicker: "Traded",
		pid,
		season,
		tid: to,
		heads: [
			`Traded from the ${X.teamName(from, season)} to the ${X.teamName(to, season)}`,
			`A new team: the ${X.teamName(to, season)}`,
		],
		lines: [
			`The ${X.teamName(from, season)} got ${assetText(X, e.t.got[1 - i]!)}`,
			e.t.got[i].length > 1
				? `He came with ${assetText(
						X,
						e.t.got[i].filter((a) => !(isPlayerAsset(a) && a.pid === pid)),
					)}`
				: null,
		],
		facts: [`traded|${pid}|${season}`, `trade|${e.t.eid}`],
	});
};

const tradeCost: Topic = ({ X, season, pid, soFar }) => {
	if (soFar) {
		return null;
	}
	const e = tradesWith(X, pid!, season).findLast((x) => x.at === season);
	if (!e) {
		return null;
	}
	const i = e.t.got.findIndex((side) =>
		side.some((a) => isPlayerAsset(a) && a.pid === pid),
	) as 0 | 1;
	const me = e.sides[i].got.find((g) => g.pid === pid);
	const other = e.sides[1 - i]!;
	if (!me) {
		return null;
	}
	const d = me.ws - other.ws;
	return mk({
		id: "p-d-cost",
		group: "p-trade",
		theme: "moves",
		score: lift(Math.abs(d), 6, 0.25, 0.35),
		kicker: d >= 0 ? "Worth the price" : "The price was high",
		pid,
		season,
		tid: e.sides[i].tid,
		heads: [
			d >= 0
				? `He gave his new team more than they gave up`
				: `What went the other way did more`,
		],
		chips: [
			["His WS", ws1(me.ws)],
			["Sent away", ws1(other.ws)],
		],
		lines: [`For ${assetText(X, e.t.got[1 - i]!)}`],
		facts: [`trade|${e.t.eid}`],
	});
};

const timesTradedP: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	if (!p) {
		return null;
	}
	const n = timesTraded(X, p, season);
	if (n < 2) {
		return null;
	}
	return mk({
		id: "p-d-times",
		group: "p-trade2",
		theme: "moves",
		score: clamp01(0.2 + n * 0.06),
		kicker: "Frequent flyer",
		pid,
		season,
		heads: [`Traded ${n} times so far`, `${n} trades, and counting`],
		hero: { text: `${n}`, unit: "times traded" },
		lines: [],
		facts: [`times|${pid}`],
	});
};

const contractNow: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const c = p ? contractIn(p, season) : undefined;
	const sal = c ? salaryIn(c, season) : undefined;
	if (!p || !c || sal === undefined || sal <= 0) {
		return null;
	}
	const all = contractRows(X, season)
		.map((r) => salaryIn(r.c, season))
		.filter((x): x is number => x !== undefined && x > 0);
	const rank = rankOf(all, sal);
	const end = c.start + c.amounts.length - 1;
	return mk({
		id: "p-ct-now",
		group: "p-contract",
		theme: "money",
		score: clamp01(rankScore(rank, all.length) * 0.45),
		kicker: "The contract",
		pid,
		season,
		heads: [
			`${money(sal)} this season, ${ordinal(rank)}-most in the league`,
			`On a ${KIND[c.type] ?? "contract"} through ${end}`,
		],
		hero: { text: money(sal), unit: "salary" },
		lines: [
			`${plural(c.amounts.length, "season")}, ${money(sum(c.amounts))} in all`,
			end > season ? `Signed through ${end}` : "The last season of the deal",
		],
		facts: [`ctnow|${pid}|${season}`],
	});
};

const contractYearP: Topic = ({ X, season, pid, soFar }) => {
	const p = X.players.get(pid!);
	const c = p ? contractIn(p, season) : undefined;
	if (
		soFar ||
		!p ||
		!c ||
		c.start + c.amounts.length - 1 !== season ||
		c.ended ||
		c.amounts.length < 2
	) {
		return null;
	}
	const now = X.line(pid!, season);
	const prev = X.line(pid!, season - 1);
	if (!now || !prev) {
		return null;
	}
	const d = now.ws - prev.ws;
	if (Math.abs(d) < 2) {
		return null;
	}
	return mk({
		id: "p-ct-year",
		group: "p-contract",
		theme: "money",
		score: lift(Math.abs(d), 6, 0.25, 0.35),
		kicker: "Contract year",
		pid,
		season,
		heads:
			d > 0
				? [`He saved his best for the last year of his deal`]
				: [`A contract year that went the wrong way`],
		hero: {
			text: `${d > 0 ? "+" : ""}${ws1(d)}`,
			unit: "win shares from last season",
		},
		lines: [`${ws1(prev.ws)} WS in ${season - 1}, ${ws1(now.ws)} in ${season}`],
		facts: [`ctyear|${pid}|${season}`],
	});
};

const payday: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const cs = p?.contracts ?? [];
	const i = cs.findIndex((c) => c.start === season);
	if (!p || i <= 0) {
		return null;
	}
	const c = cs[i]!;
	const old = cs[i - 1]!;
	const a = sum(c.amounts) / c.amounts.length;
	const b = sum(old.amounts) / old.amounts.length;
	if (b <= 0 || a / b < 1.5) {
		return null;
	}
	return mk({
		id: "p-ct-payday",
		group: "p-contract",
		theme: "money",
		score: clamp01(0.25 + Math.min(0.35, (a / b - 1) * 0.1)),
		kicker: "Payday",
		pid,
		season,
		tid: c.tid,
		heads: [
			`A ${fmtNum(a / b, 1)}x raise`,
			`From ${money(b)} to ${money(a)} a year`,
		],
		hero: { text: money(a), unit: "a year" },
		lines: [
			`${KIND[c.type] ?? "Contract"} of ${plural(c.amounts.length, "season")}${c.tid !== undefined ? ` with the ${X.teamName(c.tid, season)}` : ""}`,
		],
		facts: [`payday|${pid}|${season}`],
	});
};

const released: Topic = ({ X, season, pid }) => {
	const r = releases(X, season).find(
		(x) => x.p.pid === pid && x.season === season,
	);
	if (!r) {
		return null;
	}
	return mk({
		id: "p-released",
		group: "p-contract2",
		theme: "moves",
		score: clamp01(0.3 + Math.min(0.2, r.owed / 50000)),
		kicker: "Released",
		pid,
		season,
		tid: r.tid,
		heads: [`Released by the ${X.teamName(r.tid, season)}`],
		hero: r.owed > 0 ? { text: money(r.owed), unit: "still owed" } : undefined,
		lines: [
			r.yearsLeft > 0
				? `${plural(r.yearsLeft, "season")} were left on the deal`
				: null,
		],
		facts: [`release|${pid}|${season}`],
	});
};

const rookieValue: Topic = ({ X, season, pid, soFar }) => {
	const p = X.players.get(pid!);
	const c = p ? contractIn(p, season) : undefined;
	const l = X.line(pid!, season);
	if (soFar || !c || c.type !== "rookie" || !l || l.ws < 4) {
		return null;
	}
	const sal = salaryIn(c, season) ?? 0;
	return mk({
		id: "p-ct-rookie",
		group: "p-contract2",
		theme: "money",
		score: lift(l.ws, 10, 0.25, 0.35),
		kicker: "Underpaid",
		pid,
		season,
		heads: [
			`Star production on a rookie contract`,
			`${ws1(l.ws)} win shares for ${money(sal)}`,
		],
		hero: { text: ws1(l.ws), unit: "win shares" },
		lines: [`On the rookie deal through ${c.start + c.amounts.length - 1}`],
		facts: [`ctrookie|${pid}|${season}`],
	});
};

const careerContracts: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const cs = (p?.contracts ?? []).filter((c) => c.start <= season);
	if (!p || cs.length < 3) {
		return null;
	}
	const total = sum(cs.map((c) => sum(c.amounts)));
	const teams = new Set(cs.map((c) => c.tid).filter((t) => t !== undefined));
	return mk({
		id: "p-ct-career",
		group: "p-contract2",
		theme: "money",
		score: clamp01(0.2 + Math.min(0.3, total / 600000)),
		kicker: "The paper trail",
		pid,
		season,
		heads: [`${plural(cs.length, "contract")} worth ${money(total)}`],
		hero: { text: money(total), unit: "in signed contracts" },
		lines: [teams.size > 1 ? `With ${plural(teams.size, "team")}` : null],
		facts: [`ctcareer|${pid}`],
	});
};

const pickOrigin: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	if (!p || p.draftDpid === undefined || p.draft.year > season) {
		return null;
	}
	const t = (X.L.trades ?? []).findLast(
		(x) =>
			x.season <= p.draft.year &&
			x.got.some((side) =>
				side.some((a) => !isPlayerAsset(a) && a.dpid === p.draftDpid),
			),
	);
	if (!t) {
		return null;
	}
	const i = t.got.findIndex((side) =>
		side.some((a) => !isPlayerAsset(a) && a.dpid === p.draftDpid),
	) as 0 | 1;
	return mk({
		id: "p-pickorigin",
		group: "p-draft",
		theme: "draft",
		score: 0.38,
		kicker: "Where the pick came from",
		pid,
		season,
		tid: t.tids[i],
		heads: [
			`The pick that became ${p.name} was traded in ${t.season}`,
			`He was drafted with a pick from the ${X.teamName(t.tids[1 - i]!, t.season)}`,
		],
		lines: [
			`The ${X.teamName(t.tids[1 - i]!, t.season)} got ${assetText(X, t.got[1 - i]!)} for it`,
		],
		facts: [`pickorigin|${pid}`],
	});
};

const lotteryPick: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	if (!p || p.draft.round !== 1) {
		return null;
	}
	const r = lotteryRows(X).find(
		(x) =>
			x.season === p.draft.year &&
			x.tid === p.draft.tid &&
			x.pick === p.draft.pick,
	);
	if (!r || r.jump === 0) {
		return null;
	}
	return mk({
		id: "p-lottery",
		group: "p-draft",
		theme: "draft",
		score: clamp01(0.25 + Math.abs(r.jump) * 0.06),
		kicker: "Lottery ball",
		pid,
		season,
		heads: [
			r.jump > 0
				? `The lottery moved his team up ${r.jump} ${r.jump === 1 ? "spot" : "spots"} to draft him`
				: `His team slid ${-r.jump} ${r.jump === -1 ? "spot" : "spots"} in the lottery and took him anyway`,
		],
		hero: { text: `#${r.slot} → #${r.pick}`, unit: `${p.draft.year} lottery` },
		lines: [],
		facts: [`plot|${pid}`],
	});
};

const draftNightP: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	if (!p || p.draft.year !== season || p.draft.round < 1) {
		return null;
	}
	return mk({
		id: "p-draftnight",
		group: "p-draft",
		theme: "draft",
		score: clamp01(
			0.3 + (p.draft.round === 1 ? Math.max(0, 0.2 - p.draft.pick * 0.01) : 0),
		),
		kicker: "Draft night",
		pid,
		season,
		tid: p.draft.tid,
		heads: [
			`Drafted ${p.draft.round > 1 ? `in round ${p.draft.round}, ` : ""}No. ${p.draft.pick} by the ${X.teamName(p.draft.tid, season)}`,
		],
		hero:
			p.draftOvr !== undefined && p.draftPot !== undefined
				? { text: `${p.draftOvr}/${p.draftPot}`, unit: "ovr/pot" }
				: { text: `#${overallPick(X, p)}`, unit: "overall" },
		lines: [
			`Age ${season - p.bornYear}${p.college ? `, out of ${p.college}` : ""}`,
		],
		facts: [`pdraft|${pid}`],
	});
};

const redraft: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	if (!p || p.draft.round < 1 || p.draft.year > season - 3) {
		return null;
	}
	const cls = draftClass(X, p.draft.year);
	if (cls.length < 8) {
		return null;
	}
	const ws = cls.map((x) => careerWs(x, season));
	const rank = rankOf(ws, careerWs(p, season));
	const pick = overallPick(X, p);
	const d = pick - rank;
	if (Math.abs(d) < 5) {
		return null;
	}
	return mk({
		id: "p-redraft",
		group: "p-draft2",
		theme: "draft",
		score: clamp01(0.25 + Math.min(0.35, Math.abs(d) / 40)),
		kicker: "Redraft",
		pid,
		season,
		heads: [
			d > 0
				? `Picked ${ordinal(pick)}, he would go ${ordinal(rank)} in a redraft`
				: `Picked ${ordinal(pick)}, he ranks ${ordinal(rank)} in his class now`,
		],
		hero: {
			text: `#${pick} → #${rank}`,
			unit: `${p.draft.year} class by career WS`,
		},
		lines: [],
		facts: [`redraft|${pid}`],
	});
};

const teammate: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	if (!p) {
		return null;
	}
	const mine = new Map<number, number>();
	for (const r of p.stats) {
		if (r.season <= season && r.gp > 0) {
			mine.set(r.season, r.tid);
		}
	}
	const counts = new Map<number, number>();
	for (const [s, tid] of mine) {
		for (const l of X.teamLines(tid, s)) {
			if (l.pid !== pid) {
				counts.set(l.pid, (counts.get(l.pid) ?? 0) + 1);
			}
		}
	}
	const top = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
	if (!top || top[1] < 4) {
		return null;
	}
	const o = X.players.get(top[0])!;
	return mk({
		id: "p-teammate",
		group: "p-people",
		theme: "people",
		score: clamp01(0.2 + top[1] * 0.03),
		kicker: "Longtime teammate",
		pid,
		season,
		heads: [
			`${top[1]} seasons alongside ${o.name}`,
			`${o.name}, his most constant teammate`,
		],
		hero: { text: `${top[1]}`, unit: "seasons together" },
		lines: [],
		facts: [`mate|${[pid, o.pid].sort().join("|")}`],
	});
};

const teamSalaryRank: Topic = ({ X, season, pid }) => {
	const l = X.line(pid!, season);
	const p = X.players.get(pid!);
	const c = p ? contractIn(p, season) : undefined;
	const sal = c ? salaryIn(c, season) : undefined;
	if (!l || !sal) {
		return null;
	}
	const mates = X.teamLines(l.tid, season)
		.map((x) => {
			const cc = contractIn(X.players.get(x.pid)!, season);
			return cc ? (salaryIn(cc, season) ?? 0) : 0;
		})
		.filter((x) => x > 0);
	if (mates.length < 6) {
		return null;
	}
	const r = rankOf(mates, sal);
	const wsr = rankOf(
		X.teamLines(l.tid, season).map((x) => x.ws),
		l.ws,
	);
	if (r > 1 && wsr > 1) {
		return null;
	}
	return mk({
		id: "p-teampay",
		group: "p-contract",
		theme: "money",
		score: 0.28,
		kicker: "On the payroll",
		pid,
		season,
		heads: [
			r === 1 && wsr === 1
				? `Highest-paid on the team, and worth it`
				: r === 1
					? `Highest-paid on the team`
					: `The team's best player, but ${ordinal(r)} in pay`,
		],
		chips: [
			["Pay rank", `${r} of ${mates.length}`],
			["WS rank", `${wsr}`],
		],
		lines: [],
		facts: [`teampay|${pid}|${season}`],
	});
};

const signedBy: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const fa = (p?.contracts ?? []).filter(
		(c) => c.type === "freeAgent" && c.start <= season,
	);
	const teams = new Set(
		fa.map((c) => c.tid).filter((t): t is number => t !== undefined),
	);
	if (!p || teams.size < 3) {
		return null;
	}
	return mk({
		id: "p-signedby",
		group: "p-contract2",
		theme: "moves",
		score: clamp01(0.2 + teams.size * 0.05),
		kicker: "Open market",
		pid,
		season,
		heads: [`Signed as a free agent by ${teams.size} teams`],
		hero: { text: `${teams.size}`, unit: "teams signed him" },
		lines: [],
		facts: [`signedby|${pid}`],
	});
};

// ---- All-time ---------------------------------------------------------------

const lopsided: Topic = ({ X, season }) => {
	const e = tradeEvals(X, season)
		.filter((x) => x.at <= season - 2)
		.toSorted((a, b) => b.margin - a.margin || a.t.eid - b.t.eid)[0];
	if (!e || e.margin < 10) {
		return null;
	}
	const win = e.sides[e.winner];
	const star = topGot(win);
	return mk({
		id: "a-d-lopsided",
		group: "a-trades-x",
		theme: "moves",
		score: lift(e.margin, 60, 0.35, 0.4),
		kicker: "The most lopsided trade",
		season: e.t.season,
		tid: win.tid,
		pid: star?.pid,
		heads: [
			star
				? `The trade for ${star.name}, ${e.t.season}`
				: `The ${e.t.season} heist`,
			`The ${X.teamName(win.tid, e.t.season)} won a trade by ${ws1(e.margin)} win shares`,
		],
		hero: { text: ws1(e.margin), unit: "win-share margin" },
		lines: [tradeLineFor(X, e, e.t.season)],
		facts: [`trade|${e.t.eid}`],
	});
};

const partners: Topic = ({ X, season }) => {
	const by = new Map<string, number>();
	for (const t of X.L.trades ?? []) {
		if (t.season <= season) {
			const k = [...t.tids].sort((a, b) => a - b).join("|");
			by.set(k, (by.get(k) ?? 0) + 1);
		}
	}
	const top = [...by].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
	if (!top || top[1] < 4) {
		return null;
	}
	const [a, b] = top[0].split("|").map(Number) as [number, number];
	return mk({
		id: "a-d-partners",
		group: "a-trades-x",
		theme: "moves",
		score: clamp01(0.25 + top[1] * 0.03),
		kicker: "Trading partners",
		season,
		tid: a,
		heads: [
			`The ${X.teamName(a, season)} and the ${X.teamName(b, season)}: ${top[1]} trades`,
		],
		hero: { text: `${top[1]}`, unit: "trades between them" },
		lines: [],
		facts: [`a-partners`],
	});
};

const franchiseTrades = (X: LeagueIndex, season: number) => {
	const by = new Map<number, { n: number; net: number; titles: number }>();
	for (const e of tradeEvals(X, season)) {
		for (const i of [0, 1] as const) {
			const t = e.t.tids[i];
			const cur = by.get(t) ?? { n: 0, net: 0, titles: 0 };
			cur.n += 1;
			cur.net += e.sides[i].ws - e.sides[1 - i]!.ws;
			cur.titles += e.sides[i].titles.length;
			by.set(t, cur);
		}
	}
	return [...by];
};

const busiest: Topic = ({ X, season }) => {
	const list = franchiseTrades(X, season).sort(
		(a, b) => b[1].n - a[1].n || a[0] - b[0],
	);
	if (list.length < 4 || list[0]![1].n < 5) {
		return null;
	}
	const [tid, v] = list[0]!;
	return mk({
		id: "a-d-busiest",
		group: "a-trades-y",
		theme: "moves",
		score: clamp01(0.25 + (v.n - list[1]![1].n) * 0.03),
		kicker: "Always dealing",
		season,
		tid,
		heads: [`The ${X.teamName(tid, season)} made the most trades`],
		hero: { text: `${v.n}`, unit: "trades" },
		list: list
			.slice(0, 5)
			.map(([t, x]) => ({
				name: X.teamName(t, season),
				value: `${x.n}`,
				tid: t,
			})),
		lines: [],
		facts: [`a-busiest`],
	});
};

const bestTrader: Topic = ({ X, season }) => {
	const list = franchiseTrades(X, season)
		.filter(([, v]) => v.n >= 3)
		.sort((a, b) => b[1].net - a[1].net || a[0] - b[0]);
	if (list.length < 4) {
		return null;
	}
	const [tid, v] = list[0]!;
	const [wt, w] = list.at(-1)!;
	return mk({
		id: "a-d-net",
		group: "a-trades-y",
		theme: "moves",
		score: lift(v.net, 40, 0.3, 0.35),
		kicker: "The sharpest front office",
		season,
		tid,
		heads: [
			`The ${X.teamName(tid, season)} have won their trades`,
			`Best trade record: the ${X.teamName(tid, season)}`,
		],
		hero: { text: `+${ws1(v.net)}`, unit: "net win shares from trades" },
		lines: [`At the other end: the ${X.teamName(wt, season)}, ${ws1(w.net)}`],
		facts: [`a-net`],
	});
};

const tradeTitles: Topic = ({ X, season }) => {
	const e = tradeEvals(X, season)
		.map((x) => ({
			x,
			n: Math.max(x.sides[0].titles.length, x.sides[1].titles.length),
		}))
		.filter((y) => y.n > 0)
		.sort(
			(a, b) => b.n - a.n || b.x.margin - a.x.margin || a.x.t.eid - b.x.t.eid,
		)[0];
	if (!e) {
		return null;
	}
	const side =
		e.x.sides[0].titles.length >= e.x.sides[1].titles.length
			? e.x.sides[0]
			: e.x.sides[1];
	const star = topGot(side);
	return mk({
		id: "a-d-titles",
		group: "a-trades-x",
		theme: "moves",
		score: clamp01(0.35 + e.n * 0.1),
		kicker: "The trade that won titles",
		season: e.x.t.season,
		tid: side.tid,
		pid: star?.pid,
		heads: [
			star
				? `Trading for ${star.name} brought ${plural(e.n, "title")}`
				: `A trade worth ${plural(e.n, "title")}`,
		],
		hero: { text: `${e.n}`, unit: plural(e.n, "title") },
		lines: [
			`${e.x.t.season}: ${tradeLineFor(X, e.x, e.x.t.season)}`,
			`Titles: ${side.titles.join(", ")}`,
		],
		facts: [`trade|${e.x.t.eid}`],
	});
};

const contractBoard = (X: LeagueIndex, season: number) =>
	contractRows(X, season).filter((r) => r.c.amounts.length > 0 && r.avg > 0);

const biggestContract: Topic = ({ X, season }) => {
	const r = contractBoard(X, season).toSorted(
		(a, b) => b.total - a.total || a.p.pid - b.p.pid,
	)[0];
	if (!r) {
		return null;
	}
	return mk({
		id: "a-ct-biggest",
		group: "a-money-x",
		theme: "money",
		score: 0.35,
		kicker: "The biggest payday",
		season: r.c.start,
		pid: r.p.pid,
		tid: r.tid,
		heads: [`${r.p.name} signed the richest contract in league history`],
		hero: {
			text: money(r.total),
			unit: `over ${plural(r.c.amounts.length, "season")}`,
		},
		lines: [
			`${KIND[r.c.type] ?? "Contract"} starting ${r.c.start}${r.tid !== undefined ? `, ${X.teamName(r.tid, r.c.start)}` : ""}`,
			r.ws > 0 ? `${ws1(r.ws)} win shares while it ran` : null,
		],
		facts: [`contract|${r.p.pid}|${r.c.start}`],
	});
};

const contractValue = (r: ContractRow) => r.ws / Math.max(1, r.seasons);

const bestFa: Topic = ({ X, season }) => {
	const r = contractBoard(X, season)
		.filter((x) => x.c.type === "freeAgent" && x.playedTo < season + 1)
		.toSorted((a, b) => b.ws - a.ws || a.p.pid - b.p.pid)[0];
	if (!r || r.ws < 15) {
		return null;
	}
	return mk({
		id: "a-ct-bestfa",
		group: "a-money-x",
		theme: "money",
		score: lift(r.ws, 50, 0.3, 0.35),
		kicker: "Best free-agent signing",
		season: r.c.start,
		pid: r.p.pid,
		tid: r.tid,
		heads: [`${r.p.name}: the best free-agent deal ever`],
		hero: { text: ws1(r.ws), unit: "win shares on the deal" },
		lines: [
			`${money(r.avg)} a year from ${r.c.start}${r.tid !== undefined ? ` with the ${X.teamName(r.tid, r.c.start)}` : ""}`,
		],
		facts: [`contract|${r.p.pid}|${r.c.start}`],
	});
};

const worstContract: Topic = ({ X, season }) => {
	const list = contractBoard(X, season).filter(
		(x) => x.c.amounts.length >= 2 && x.end <= season,
	);
	if (list.length < 20) {
		return null;
	}
	const cut = list.map((x) => x.avg).sort((a, b) => b - a)[
		Math.floor(list.length / 10)
	]!;
	const r = list
		.filter((x) => x.avg >= cut)
		.toSorted(
			(a, b) => contractValue(a) - contractValue(b) || a.p.pid - b.p.pid,
		)[0];
	if (!r || contractValue(r) > 3) {
		return null;
	}
	return mk({
		id: "a-ct-worst",
		group: "a-money-x",
		theme: "money",
		score: 0.33,
		kicker: "The albatross",
		season: r.c.start,
		pid: r.p.pid,
		tid: r.tid,
		heads: [`${r.p.name}'s deal: big money, little back`],
		hero: { text: money(r.total), unit: `for ${ws1(r.ws)} win shares` },
		lines: [`${money(r.avg)} a year from ${r.c.start} to ${r.end}`],
		facts: [`contract|${r.p.pid}|${r.c.start}`],
	});
};

const bestRookieDeal: Topic = ({ X, season }) => {
	const r = contractBoard(X, season)
		.filter((x) => x.c.type === "rookie")
		.toSorted((a, b) => b.ws - a.ws || a.p.pid - b.p.pid)[0];
	if (!r || r.ws < 10) {
		return null;
	}
	return mk({
		id: "a-ct-rookie",
		group: "a-money-y",
		theme: "money",
		score: lift(r.ws, 40, 0.28, 0.35),
		kicker: "The best rookie deal",
		season: r.c.start,
		pid: r.p.pid,
		heads: [`${r.p.name} on his rookie contract: ${ws1(r.ws)} win shares`],
		hero: { text: money(r.total), unit: `for ${ws1(r.ws)} WS` },
		lines: [`${r.c.start}–${r.playedTo}`],
		facts: [`contract|${r.p.pid}|${r.c.start}`],
	});
};

const yearJumps = (X: LeagueIndex, season: number) =>
	X.cached(`deals|yj|${season}`, () => {
		const out: { p: WPlayer; s: number; d: number; dip: number }[] = [];
		for (const r of contractRows(X, season)) {
			const end = r.end;
			const a = X.line(r.p.pid, end);
			const b = X.line(r.p.pid, end - 1);
			if (
				!r.c.ended &&
				r.c.amounts.length >= 2 &&
				end <= season &&
				a &&
				b &&
				X.decided(end)
			) {
				out.push({ p: r.p, s: end, d: a.ws - b.ws, dip: 0 });
			}
		}
		return out;
	});

const contractYearAll: Topic = ({ X, season }) => {
	const x = yearJumps(X, season).toSorted(
		(a, b) => b.d - a.d || a.p.pid - b.p.pid,
	)[0];
	if (!x || x.d < 5) {
		return null;
	}
	return mk({
		id: "a-ct-year",
		group: "a-money-y",
		theme: "money",
		score: lift(x.d, 10, 0.28, 0.35),
		kicker: "The ultimate contract year",
		season: x.s,
		pid: x.p.pid,
		heads: [`${x.p.name} in ${x.s}: the best contract year on record`],
		hero: { text: `+${ws1(x.d)}`, unit: "win shares in the final year" },
		lines: [],
		facts: [`ctyear|${x.p.pid}|${x.s}`],
	});
};

const deadMoneyAll: Topic = ({ X, season }) => {
	const r = releases(X, season).toSorted(
		(a, b) => b.owed - a.owed || a.p.pid - b.p.pid,
	)[0];
	if (!r || r.owed < 5000) {
		return null;
	}
	return mk({
		id: "a-rel-dead",
		group: "a-money-y",
		theme: "money",
		score: clamp01(0.3 + Math.min(0.3, r.owed / 150000)),
		kicker: "Dead money",
		season: r.season,
		pid: r.p.pid,
		tid: r.tid,
		heads: [
			`The ${X.teamName(r.tid, r.season)} cut ${r.p.name} with ${money(r.owed)} left`,
		],
		hero: { text: money(r.owed), unit: "owed after the release" },
		lines: [`Released in ${r.season}, ${plural(r.yearsLeft, "season")} early`],
		facts: [`release|${r.p.pid}|${r.season}`],
	});
};

const releaseTeam: Topic = ({ X, season }) => {
	const by = new Map<number, number>();
	for (const r of releases(X, season)) {
		by.set(r.tid, (by.get(r.tid) ?? 0) + 1);
	}
	const list = [...by].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
	if (list.length < 4 || list[0]![1] < 4) {
		return null;
	}
	return mk({
		id: "a-rel-team",
		group: "a-money-z",
		theme: "moves",
		score: 0.22,
		kicker: "Quick hooks",
		season,
		tid: list[0]![0],
		heads: [`The ${X.teamName(list[0]![0], season)} released the most players`],
		hero: { text: `${list[0]![1]}`, unit: "releases" },
		list: list
			.slice(0, 5)
			.map(([t, n]) => ({
				name: X.teamName(t, season),
				value: `${n}`,
				tid: t,
			})),
		lines: [],
		facts: [`a-relteam`],
	});
};

const lotteryLegend: Topic = ({ X }) => {
	const r = lotteryRows(X).toSorted(
		(a, b) => b.jump - a.jump || a.season - b.season,
	)[0];
	if (!r || r.jump < 3) {
		return null;
	}
	return mk({
		id: "a-lot-jump",
		group: "a-lottery-x",
		theme: "draft",
		score: clamp01(0.3 + r.jump * 0.04),
		kicker: "Lottery legends",
		season: r.season,
		tid: r.tid,
		heads: [
			`The ${X.teamName(r.tid, r.season)} jumped from #${r.slot} to #${r.pick} in ${r.season}`,
		],
		hero: { text: `+${r.jump}`, unit: "spots, the biggest jump ever" },
		lines: [],
		facts: [`lottery|${r.season}|${r.tid}`],
	});
};

const lotteryTeam: Topic = ({ X, season }) => {
	const by = new Map<number, { wins: number; net: number }>();
	for (const r of lotteryRows(X)) {
		const cur = by.get(r.tid) ?? { wins: 0, net: 0 };
		cur.net += r.jump;
		if (r.pick === 1) {
			cur.wins += 1;
		}
		by.set(r.tid, cur);
	}
	const list = [...by].sort((a, b) => b[1].net - a[1].net || a[0] - b[0]);
	if (list.length < 4) {
		return null;
	}
	const [lt, lv] = list[0]!;
	const [ut, uv] = list.at(-1)!;
	if (lv.net - uv.net < 4) {
		return null;
	}
	return mk({
		id: "a-lot-team",
		group: "a-lottery-x",
		theme: "draft",
		score: clamp01(0.25 + (lv.net - uv.net) * 0.02),
		kicker: "Luck of the draw",
		season,
		tid: lt,
		heads: [
			`The ${X.teamName(lt, season)} have been the luckiest lottery team`,
		],
		list: [
			{
				name: X.teamName(lt, season),
				value: `${lv.net >= 0 ? "+" : ""}${lv.net}`,
				sub: plural(lv.wins, "lottery win"),
				tid: lt,
			},
			{
				name: X.teamName(ut, season),
				value: `${uv.net}`,
				sub: plural(uv.wins, "lottery win"),
				tid: ut,
			},
		],
		lines: ["Spots gained or lost on lottery nights, all-time"],
		facts: [`a-lotteam`],
	});
};

const slotValue: Topic = ({ X, season }) => {
	const by = new Map<number, number[]>();
	for (const p of X.L.players) {
		if (
			p.draft.round === 1 &&
			p.draft.pick <= 10 &&
			p.draft.year <= season - 5
		) {
			const list = by.get(p.draft.pick) ?? [];
			list.push(careerWs(p, season));
			by.set(p.draft.pick, list);
		}
	}
	const rows = [...by]
		.filter(([, v]) => v.length >= 3)
		.map(([k, v]) => ({ k, avg: sum(v) / v.length, n: v.length }))
		.sort((a, b) => a.k - b.k);
	if (rows.length < 6) {
		return null;
	}
	const best = rows.toSorted((a, b) => b.avg - a.avg)[0]!;
	return mk({
		id: "a-slot",
		group: "a-draft-x",
		theme: "draft",
		score: clamp01(0.25 + (best.k > 1 ? 0.2 : 0)),
		kicker: "What a pick is worth",
		season,
		heads: [
			best.k === 1
				? `No. 1 picks have been worth it`
				: `The best pick to have has been No. ${best.k}`,
		],
		list: rows
			.slice(0, 8)
			.map((r) => ({
				name: `Pick ${r.k}`,
				value: `${fmtNum(r.avg, 1)} WS`,
				sub: plural(r.n, "player"),
			})),
		lines: ["Average career win shares by draft slot"],
		facts: [`a-slot`],
	});
};

const no1Bust: Topic = ({ X, season }) => {
	const list = X.L.players
		.filter(
			(p) =>
				p.draft.round === 1 && p.draft.pick === 1 && p.draft.year <= season - 5,
		)
		.map((p) => ({ p, ws: careerWs(p, season) }))
		.sort((a, b) => a.ws - b.ws || a.p.pid - b.p.pid);
	if (list.length < 4 || list[0]!.ws > 10) {
		return null;
	}
	const x = list[0]!;
	return mk({
		id: "a-no1bust",
		group: "a-draft-x",
		theme: "draft",
		score: 0.32,
		kicker: "The bust",
		season: x.p.draft.year,
		pid: x.p.pid,
		tid: x.p.draft.tid,
		heads: [`${x.p.name}: the No. 1 pick who never was`],
		hero: { text: ws1(x.ws), unit: "career win shares" },
		lines: [
			`First overall in ${x.p.draft.year}, by the ${X.teamName(x.p.draft.tid, x.p.draft.year)}`,
		],
		facts: [`a-no1bust`],
	});
};

const draftFranchise: Topic = ({ X, season }) => {
	const by = new Map<number, number>();
	for (const p of X.L.players) {
		if (p.draft.round > 0 && p.draft.tid >= 0) {
			by.set(
				p.draft.tid,
				(by.get(p.draft.tid) ?? 0) +
					stintFor(p, p.draft.tid, p.draft.year, season).ws,
			);
		}
	}
	const list = [...by].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
	if (list.length < 4 || list[0]![1] < 30) {
		return null;
	}
	return mk({
		id: "a-draftfr",
		group: "a-draft-y",
		theme: "draft",
		score: lift(list[0]![1] - list[1]![1], 40, 0.25, 0.3),
		kicker: "The best drafting team",
		season,
		tid: list[0]![0],
		heads: [`The ${X.teamName(list[0]![0], season)} drafted best`],
		hero: { text: ws1(list[0]![1]), unit: "win shares from their own picks" },
		list: list
			.slice(0, 5)
			.map(([t, v]) => ({
				name: X.teamName(t, season),
				value: ws1(v),
				tid: t,
			})),
		lines: [],
		facts: [`a-draftfr`],
	});
};

const teammatesAll: Topic = ({ X, season }) => {
	const pairs = X.cached(`deals|mates|${season}`, () => {
		const m = new Map<string, number>();
		for (const s of X.seasons) {
			if (s > season) {
				continue;
			}
			for (const t of X.teamsIn(s)) {
				const ls = X.teamLines(t.tid, s)
					.filter((l) => l.gp >= 20)
					.map((l) => l.pid)
					.sort((a, b) => a - b);
				for (let i = 0; i < ls.length; i++) {
					for (let j = i + 1; j < ls.length; j++) {
						const k = `${ls[i]}|${ls[j]}`;
						m.set(k, (m.get(k) ?? 0) + 1);
					}
				}
			}
		}
		return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
	});
	const top = pairs[0];
	if (!top || top[1] < 6) {
		return null;
	}
	const [a, b] = top[0].split("|").map((x) => X.players.get(Number(x))!);
	return mk({
		id: "a-mates",
		group: "a-people-x",
		theme: "people",
		score: clamp01(0.25 + top[1] * 0.02),
		kicker: "Inseparable",
		season,
		pid: a!.pid,
		heads: [`${a!.name} and ${b!.name}: ${top[1]} seasons as teammates`],
		hero: { text: `${top[1]}`, unit: "seasons together" },
		list: pairs.slice(1, 4).map(([k, n]) => {
			const [x, y] = k.split("|").map((v) => X.players.get(Number(v))!);
			return { name: `${x!.name} & ${y!.name}`, value: `${n}` };
		}),
		lines: [],
		facts: [`mate|${top[0]}`],
	});
};

const topSalaryEver: Topic = ({ X, season }) => {
	let best: { r: ContractRow; s: number; sal: number } | undefined;
	for (const r of contractBoard(X, season)) {
		r.c.amounts.forEach((sal, i) => {
			const s = r.c.start + i;
			if (s <= season && (!best || sal > best.sal)) {
				best = { r, s, sal };
			}
		});
	}
	if (!best) {
		return null;
	}
	return mk({
		id: "a-ct-topsal",
		group: "a-money-z",
		theme: "money",
		score: 0.28,
		kicker: "The top salary",
		season: best.s,
		pid: best.r.p.pid,
		heads: [
			`${best.r.p.name} drew the biggest single-season salary: ${money(best.sal)}`,
		],
		hero: { text: money(best.sal), unit: `in ${best.s}` },
		lines: [],
		facts: [`a-topsal`],
	});
};

const loyalResign: Topic = ({ X, season }) => {
	let best: { p: WPlayer; n: number; tid: number } | undefined;
	for (const p of X.L.players) {
		const by = new Map<number, number>();
		for (const c of p.contracts ?? []) {
			if (c.type === "reSign" && c.tid !== undefined && c.start <= season) {
				by.set(c.tid, (by.get(c.tid) ?? 0) + 1);
			}
		}
		for (const [tid, n] of by) {
			if (!best || n > best.n) {
				best = { p, n, tid };
			}
		}
	}
	if (!best || best.n < 3) {
		return null;
	}
	return mk({
		id: "a-ct-loyal",
		group: "a-money-z",
		theme: "people",
		score: clamp01(0.22 + best.n * 0.05),
		kicker: "Signed, and signed again",
		season,
		pid: best.p.pid,
		tid: best.tid,
		heads: [
			`${best.p.name} re-signed with the ${X.teamName(best.tid, season)} ${best.n} times`,
		],
		hero: { text: `${best.n}`, unit: "re-signings with one team" },
		lines: [],
		facts: [`a-loyal`],
	});
};

const travelPick: Topic = ({ X, season }) => {
	const by = new Map<
		number,
		{ n: number; a: Extract<WTradeAsset, { dpid: number }> }
	>();
	for (const t of X.L.trades ?? []) {
		if (t.season > season) {
			continue;
		}
		for (const side of t.got) {
			for (const a of side) {
				if (!isPlayerAsset(a)) {
					const cur = by.get(a.dpid) ?? { n: 0, a };
					cur.n += 1;
					by.set(a.dpid, cur);
				}
			}
		}
	}
	const top = [...by].sort((a, b) => b[1].n - a[1].n || a[0] - b[0])[0];
	if (!top || top[1].n < 3) {
		return null;
	}
	const p = X.L.players.find((x) => x.draftDpid === top[0]);
	return mk({
		id: "a-d-pick",
		group: "a-trades-y",
		theme: "draft",
		score: clamp01(0.25 + top[1].n * 0.06),
		kicker: "The well-traveled pick",
		season,
		pid: p?.pid,
		heads: [`One draft pick was traded ${top[1].n} times`],
		hero: { text: `${top[1].n}`, unit: "trades" },
		lines: [p ? `It became ${p.name}` : `It was ${assetText(X, [top[1].a])}`],
		facts: [`a-travelpick`],
	});
};

export const DEAL_PLAYER: Topic[] = [
	tradedP,
	tradeCost,
	timesTradedP,
	contractNow,
	contractYearP,
	payday,
	released,
	rookieValue,
	careerContracts,
	pickOrigin,
	lotteryPick,
	draftNightP,
	redraft,
	teammate,
	teamSalaryRank,
	signedBy,
];

export const DEAL_ALL: Topic[] = [
	lopsided,
	partners,
	busiest,
	bestTrader,
	tradeTitles,
	biggestContract,
	bestFa,
	worstContract,
	bestRookieDeal,
	contractYearAll,
	deadMoneyAll,
	releaseTeam,
	lotteryLegend,
	lotteryTeam,
	slotValue,
	no1Bust,
	draftFranchise,
	teammatesAll,
	topSalaryEver,
	loyalResign,
	travelPick,
];
