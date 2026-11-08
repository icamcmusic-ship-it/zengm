// Season topics about the front office: the trade market, free agency, contracts, releases, the draft lottery and the draft. Value-based ones (win shares a deal bought) wait for the season to be over; nothing uses what happened after the season.
import { mk, type Topic } from "./helpers.ts";
import { fmtNum, ordinal, plural, rankOf, rankScore } from "../util.ts";
import {
	careerWs,
	contractRows,
	draftClass,
	isInSeason,
	isPlayerAsset,
	lotteryOf,
	lotteryRows,
	releases,
	salaryIn,
	signingsFor,
	tradesFor,
} from "../deals.ts";
import { twoWay } from "./kit.ts";
import {
	abbrev,
	clamp01,
	lift,
	money,
	sideRow,
	sum,
	topGot,
	ws1,
} from "./dealsKit.ts";
import type { LeagueIndex } from "../league.ts";

// Seasons the trade log covers: from the first season with a trade on
const tradeSeasons = (X: LeagueIndex) =>
	X.cached("deals|tseasons", () => {
		const first = Math.min(...(X.L.trades ?? []).map((t) => t.season));
		return X.seasons.filter((s) => s >= first);
	});

const tradeCount: Topic = ({ X, season }) => {
	const ss = tradeSeasons(X);
	if (ss.length < 4 || !ss.includes(season)) {
		return null;
	}
	const counts = ss.map((s) => tradesFor(X, s).length);
	const n = counts[ss.indexOf(season)]!;
	const w = twoWay(counts, n);
	if (w.score < 0.25) {
		return null;
	}
	const busy = new Map<number, number>();
	for (const e of tradesFor(X, season)) {
		for (const tid of e.t.tids) {
			busy.set(tid, (busy.get(tid) ?? 0) + 1);
		}
	}
	const top = [...busy].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
	return mk({
		id: "s-d-count",
		group: "s-trades",
		theme: "moves",
		score: w.score * 0.6,
		kicker: w.high ? "Trade frenzy" : "Quiet phones",
		season,
		heads: w.high
			? [`${n} trades: a busy year on the phones`, `The trade market never slept`]
			: [`Only ${plural(n, "trade")} all year`, `A quiet trade market`],
		hero: { text: `${n}`, unit: plural(n, "trade", "trades") },
		lines: [
			`${ordinal(w.rank)}-${w.high ? "most" : "fewest"} of ${ss.length} seasons in the trade log`,
			top && top[1] >= 2
				? `Busiest: the ${X.teamName(top[0], season)}, in ${top[1]} of them`
				: null,
		],
		facts: [`s-trades-n|${season}`],
	});
};

const biggestTrade: Topic = ({ X, season }) => {
	const list = tradesFor(X, season).filter((e) => e.size >= 3);
	const e = list.toSorted((a, b) => b.size - a.size || a.t.eid - b.t.eid)[0];
	if (!e) {
		return null;
	}
	const players = sum(
		e.t.got.map((g) => g.filter((a) => isPlayerAsset(a)).length),
	);
	const picks = e.size - players;
	return mk({
		id: "s-d-biggest",
		group: "s-trades",
		theme: "moves",
		score: clamp01(0.25 + e.size * 0.05),
		kicker: "The blockbuster",
		season,
		tid: e.t.tids[0],
		heads: [
			`The biggest deal: ${e.size} pieces between two teams`,
			`${X.teamName(e.t.tids[0], season)} and ${X.teamName(e.t.tids[1], season)} swapped ${e.size} assets`,
		],
		hero: { text: `${e.size}`, unit: "assets in one trade" },
		list: [sideRow(X, e, 0, season, false), sideRow(X, e, 1, season, false)],
		lines: [
			`${plural(players, "player")}${picks > 0 ? ` and ${plural(picks, "draft pick")}` : ""}`,
		],
		facts: [`trade|${e.t.eid}`],
	});
};

const bestTrade: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const e = tradesFor(X, season)
		.filter((x) => x.margin >= 2)
		.toSorted((a, b) => b.margin - a.margin || a.t.eid - b.t.eid)[0];
	if (!e) {
		return null;
	}
	const win = e.sides[e.winner];
	const lose = e.sides[1 - e.winner]!;
	const star = topGot(win);
	return mk({
		id: "s-d-best",
		group: "s-trades",
		theme: "moves",
		score: lift(e.margin, 10, 0.3, 0.4),
		kicker: "Trade of the year",
		season,
		tid: win.tid,
		heads: [
			`The ${X.teamName(win.tid, season)} won the trade of the year`,
			`One trade, one clear winner`,
			star ? `${star.name} made the deal for the ${X.teamName(win.tid, season)}` : null,
		].filter((h): h is string => !!h),
		hero: { text: `+${ws1(e.margin)}`, unit: "win shares in the deal" },
		list: [sideRow(X, e, 0, season, true), sideRow(X, e, 1, season, true)],
		lines: [
			`Win shares this season from what each side got: ${ws1(win.ws)} to ${ws1(lose.ws)}`,
		],
		facts: [`trade|${e.t.eid}`],
	});
};

const deadline: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const list = tradesFor(X, season).filter((e) => isInSeason(e.t));
	if (list.length < 2) {
		return null;
	}
	const net = new Map<number, number>();
	for (const e of list) {
		for (const i of [0, 1] as const) {
			const tid = e.sides[i].tid;
			net.set(
				tid,
				(net.get(tid) ?? 0) + e.sides[i].ws - e.sides[1 - i]!.ws,
			);
		}
	}
	const rows = [...net].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
	const [tid, v] = rows[0]!;
	if (v < 1) {
		return null;
	}
	return mk({
		id: "s-d-deadline",
		group: "s-trades",
		theme: "moves",
		score: lift(v, 8, 0.28, 0.35),
		kicker: "Midseason moves",
		season,
		tid,
		heads: [
			`The ${X.teamName(tid, season)} won the in-season market`,
			`${plural(list.length, "in-season trade")}, and who came out ahead`,
		],
		hero: { text: `+${ws1(v)}`, unit: "net win shares" },
		list: rows.slice(0, 5).map(([t, x]) => ({
			name: X.teamName(t, season),
			value: `${x >= 0 ? "+" : ""}${ws1(x)}`,
			tid: t,
		})),
		lines: [
			"Win shares from the players each team got, minus what the players it sent away gave their new teams, for the rest of the season",
		],
		facts: [`s-deadline|${season}`],
	});
};

const champTrades: Topic = ({ X, season, soFar }) => {
	const c = X.champion(season);
	if (soFar || !c) {
		return null;
	}
	const got = tradesFor(X, season).flatMap((e) =>
		e.sides.filter((s) => s.tid === c.tid).flatMap((s) => s.got),
	);
	const useful = got.filter((g) => g.ws > 0).sort((a, b) => b.ws - a.ws);
	if (useful.length === 0) {
		return null;
	}
	const ws = sum(useful.map((g) => g.ws));
	return mk({
		id: "s-d-champ",
		group: "s-trades",
		theme: "moves",
		score: lift(ws, 10, 0.3, 0.4),
		kicker: "Built by trade",
		season,
		tid: c.tid,
		// It is about the champion even where it doesn't name them
		spoiler: true,
		heads: [
			`The champions traded for ${useful[0]!.name}`,
			`Trades that built a champion`,
		],
		hero: { text: ws1(ws), unit: "win shares from trade arrivals" },
		list: useful.slice(0, 4).map((g) => ({
			name: g.name,
			value: `${ws1(g.ws)} WS`,
			pid: g.pid,
		})),
		lines: [],
		facts: [`s-champtrades|${season}`],
	});
};

const picksMoved: Topic = ({ X, season }) => {
	const list = (X.L.trades ?? []).filter((t) => t.season === season);
	const picks = sum(
		list.map((t) => t.got.flat().filter((a) => !isPlayerAsset(a)).length),
	);
	if (picks < 2) {
		return null;
	}
	const got = new Map<number, number>();
	for (const t of list) {
		t.got.forEach((side, i) => {
			const n = side.filter((a) => !isPlayerAsset(a)).length;
			if (n > 0) {
				got.set(t.tids[i]!, (got.get(t.tids[i]!) ?? 0) + n);
			}
		});
	}
	const top = [...got].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
	return mk({
		id: "s-d-picks",
		group: "s-trades2",
		theme: "moves",
		score: clamp01(0.2 + picks * 0.03 + (top[1] >= 3 ? 0.1 : 0)),
		kicker: "Picks on the move",
		season,
		tid: top[0],
		heads: [
			`${picks} draft picks changed hands`,
			`The ${X.teamName(top[0], season)} stockpiled picks`,
		],
		hero: { text: `${picks}`, unit: "picks traded" },
		lines: [
			`Most picks taken in: the ${X.teamName(top[0], season)}, ${top[1]}`,
		],
		facts: [`s-picks|${season}`],
	});
};

const tradePair: Topic = ({ X, season }) => {
	const by = new Map<string, number>();
	for (const e of tradesFor(X, season)) {
		const k = [...e.t.tids].sort((a, b) => a - b).join("|");
		by.set(k, (by.get(k) ?? 0) + 1);
	}
	const top = [...by].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
	if (!top || top[1] < 2) {
		return null;
	}
	const [a, b] = top[0].split("|").map(Number) as [number, number];
	return mk({
		id: "s-d-pair",
		group: "s-trades2",
		theme: "moves",
		score: clamp01(0.25 + top[1] * 0.08),
		kicker: "Frequent callers",
		season,
		tid: a,
		heads: [
			`The ${X.teamName(a, season)} and ${X.teamName(b, season)} kept dealing`,
			`${top[1]} trades between the same two teams`,
		],
		hero: { text: `${top[1]}`, unit: "trades with each other" },
		lines: [],
		facts: [`s-pair|${season}`],
	});
};

const allStarMoved: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const pids = new Set(X.awardPids(season, "All-Star"));
	for (const e of tradesFor(X, season)) {
		for (const side of e.sides) {
			for (const g of side.got) {
				if (pids.has(g.pid) && !g.pick && g.ws > 0) {
					return mk({
						id: "s-d-allstar",
						group: "s-trades2",
						theme: "moves",
						score: 0.4,
						kicker: "New team, same star",
						season,
						pid: g.pid,
						tid: side.tid,
						heads: [
							`${g.name} was traded and still made the All-Star team`,
							`An All-Star on the move: ${g.name}`,
						],
						lines: [
							`Traded to the ${X.teamName(side.tid, season)}: ${ws1(g.ws)} win shares for them`,
						],
						facts: [`traded|${g.pid}|${season}`],
					});
				}
			}
		}
	}
	return null;
};

const faClass: Topic = ({ X, season }) => {
	const list = signingsFor(X, season, ["freeAgent"]).toSorted(
		(a, b) => b.avg - a.avg || a.p.pid - b.p.pid,
	);
	if (list.length < 3) {
		return null;
	}
	const top = list[0]!;
	const total = sum(list.map((r) => r.total));
	return mk({
		id: "s-fa-class",
		group: "s-fa",
		theme: "money",
		score: clamp01(0.25 + Math.min(0.25, list.length / 60)),
		kicker: "Free agency",
		season,
		pid: top.p.pid,
		heads: [
			`${top.p.name} led the free-agent class`,
			`${plural(list.length, "free agent")} found new deals`,
		],
		hero: { text: money(top.avg), unit: "a year, the top deal" },
		list: list.slice(0, 5).map((r) => ({
			name: r.p.name,
			value: `${money(r.avg)} × ${r.c.amounts.length}`,
			sub: r.tid !== undefined ? X.teamName(r.tid, season) : undefined,
			pid: r.p.pid,
		})),
		lines: [`${money(total)} in total contract value`],
		facts: [`contract|${top.p.pid}|${top.c.start}`],
	});
};

const faBest: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const list = signingsFor(X, season, ["freeAgent"]).filter((r) => r.ws > 0);
	const top = list.toSorted((a, b) => b.ws - a.ws || a.p.pid - b.p.pid)[0];
	if (!top || top.ws < 3) {
		return null;
	}
	const t = top.tid ?? X.line(top.p.pid, season)?.tid;
	return mk({
		id: "s-fa-best",
		group: "s-fa",
		theme: "money",
		score: lift(top.ws, 12, 0.28, 0.4),
		kicker: "Best signing",
		season,
		pid: top.p.pid,
		tid: t,
		heads: [
			`${top.p.name} was the signing of the summer`,
			`The free agent who paid off: ${top.p.name}`,
		],
		hero: { text: ws1(top.ws), unit: "win shares in year one" },
		lines: [
			`Signed for ${money(top.avg)} a year${t !== undefined ? ` by the ${X.teamName(t, season)}` : ""}`,
		],
		facts: [`contract|${top.p.pid}|${top.c.start}`],
	});
};

const faBust: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const list = signingsFor(X, season, ["freeAgent", "reSign"]);
	if (list.length < 6) {
		return null;
	}
	const cut = list.map((r) => r.avg).sort((a, b) => b - a)[
		Math.floor(list.length / 5)
	]!;
	const big = list.filter((r) => r.avg >= cut && r.avg > 0);
	const worst = big.toSorted((a, b) => a.ws - b.ws || a.p.pid - b.p.pid)[0];
	if (!worst || worst.ws > 2) {
		return null;
	}
	return mk({
		id: "s-fa-bust",
		group: "s-fa",
		theme: "money",
		score: 0.32,
		kicker: "Buyer's remorse",
		season,
		pid: worst.p.pid,
		tid: worst.tid,
		heads: [
			`${worst.p.name}'s new deal got off to a rough start`,
			`Big money, little return: ${worst.p.name}`,
		],
		hero: { text: money(worst.avg), unit: "a year" },
		lines: [
			`${ws1(worst.ws)} win shares in the first season`,
			`${plural(worst.c.amounts.length, "season")} on the deal`,
		],
		facts: [`contract|${worst.p.pid}|${worst.c.start}`],
	});
};

const resignBig: Topic = ({ X, season }) => {
	const list = signingsFor(X, season, ["reSign"]).toSorted(
		(a, b) => b.total - a.total || a.p.pid - b.p.pid,
	);
	const top = list[0];
	if (!top || list.length < 2) {
		return null;
	}
	return mk({
		id: "s-resign",
		group: "s-fa",
		theme: "money",
		score: clamp01(0.22 + Math.min(0.2, top.total / 300000)),
		kicker: "Staying put",
		season,
		pid: top.p.pid,
		tid: top.tid,
		heads: [
			`${top.p.name} signed the biggest extension`,
			`${plural(list.length, "player")} re-signed, led by ${top.p.name}`,
		],
		hero: { text: money(top.total), unit: `over ${plural(top.c.amounts.length, "season")}` },
		list: list.slice(0, 4).map((r) => ({
			name: r.p.name,
			value: money(r.total),
			sub: r.tid !== undefined ? X.teamName(r.tid, season) : undefined,
			pid: r.p.pid,
		})),
		lines: [],
		facts: [`contract|${top.p.pid}|${top.c.start}`],
	});
};

const releasesTopic: Topic = ({ X, season }) => {
	const list = releases(X, season).filter((r) => r.season === season);
	if (list.length < 2) {
		return null;
	}
	const top = list.toSorted((a, b) => b.owed - a.owed || a.p.pid - b.p.pid)[0]!;
	return mk({
		id: "s-releases",
		group: "s-wire",
		theme: "money",
		score: clamp01(0.2 + Math.min(0.25, top.owed / 80000)),
		kicker: "Cut loose",
		season,
		pid: top.p.pid,
		tid: top.tid,
		heads: [
			`${plural(list.length, "player")} released`,
			top.owed > 0
				? `The ${X.teamName(top.tid, season)} still owe ${top.p.name} ${money(top.owed)}`
				: `${top.p.name} among the players let go`,
		],
		hero: { text: `${list.length}`, unit: "releases" },
		lines: [
			top.owed > 0
				? `Biggest bill: ${top.p.name}, ${money(top.owed)} still owed over ${plural(top.yearsLeft, "season")}`
				: null,
		],
		facts: [`release|${top.p.pid}|${season}`],
	});
};

const contractYear: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	let best: { pid: number; d: number; ws: number; prev: number } | undefined;
	for (const r of contractRows(X, season)) {
		if (r.end !== season || r.c.ended || r.c.amounts.length < 2) {
			continue;
		}
		const now = X.line(r.p.pid, season);
		const prev = X.line(r.p.pid, season - 1);
		if (!now || !prev) {
			continue;
		}
		const d = now.ws - prev.ws;
		if (!best || d > best.d) {
			best = { pid: r.p.pid, d, ws: now.ws, prev: prev.ws };
		}
	}
	if (!best || best.d < 3) {
		return null;
	}
	const p = X.players.get(best.pid)!;
	return mk({
		id: "s-ct-year",
		group: "s-contracts",
		theme: "money",
		score: lift(best.d, 8, 0.3, 0.35),
		kicker: "Contract year",
		season,
		pid: best.pid,
		heads: [
			`${p.name} picked the right time for his best year`,
			`Playing for a new deal: ${p.name}`,
		],
		hero: { text: `+${ws1(best.d)}`, unit: "win shares from last season" },
		lines: [
			`${ws1(best.prev)} to ${ws1(best.ws)} win shares in the last season of his contract`,
		],
		facts: [`ctyear|${best.pid}|${season}`],
	});
};

const paydayDip: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	let worst: { pid: number; d: number; avg: number; old: number } | undefined;
	for (const r of contractRows(X, season)) {
		if (r.c.start !== season || r.i === 0 || r.c.type === "rookie") {
			continue;
		}
		const old = r.p.contracts![r.i - 1]!;
		const oldAvg = sum(old.amounts) / old.amounts.length;
		if (r.avg < oldAvg * 1.5 || r.avg < 5000) {
			continue;
		}
		const now = X.line(r.p.pid, season);
		const prev = X.line(r.p.pid, season - 1);
		if (!now || !prev) {
			continue;
		}
		const d = now.ws - prev.ws;
		if (!worst || d < worst.d) {
			worst = { pid: r.p.pid, d, avg: r.avg, old: oldAvg };
		}
	}
	if (!worst || worst.d > -3) {
		return null;
	}
	const p = X.players.get(worst.pid)!;
	return mk({
		id: "s-ct-dip",
		group: "s-contracts",
		theme: "money",
		score: lift(-worst.d, 8, 0.28, 0.35),
		kicker: "After the payday",
		season,
		pid: worst.pid,
		heads: [
			`${p.name} got paid, then slipped`,
			`A big raise and a step back for ${p.name}`,
		],
		hero: { text: ws1(worst.d), unit: "win shares from last season" },
		lines: [
			`From ${money(worst.old)} to ${money(worst.avg)} a year`,
		],
		facts: [`ctdip|${worst.pid}|${season}`],
	});
};

const rookieDeals: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const list = contractRows(X, season)
		.filter(
			(r) =>
				r.c.type === "rookie" &&
				r.c.start <= season &&
				r.end >= season &&
				!(r.c.ended && r.c.ended.season < season),
		)
		.map((r) => ({ r, l: X.line(r.p.pid, season) }))
		.filter((x) => x.l && x.l.ws > 0)
		.sort((a, b) => b.l!.ws - a.l!.ws || a.r.p.pid - b.r.p.pid);
	const top = list[0];
	if (!top || top.l!.ws < 5) {
		return null;
	}
	const sal = salaryIn(top.r.c, season) ?? top.r.avg;
	return mk({
		id: "s-ct-rookie",
		group: "s-contracts",
		theme: "money",
		score: lift(top.l!.ws, 12, 0.28, 0.35),
		kicker: "Rookie-scale bargain",
		season,
		pid: top.r.p.pid,
		tid: top.l!.tid,
		heads: [
			`${top.r.p.name} produced like a star on a rookie deal`,
			`The best bargain in the league: ${top.r.p.name}`,
		],
		hero: { text: ws1(top.l!.ws), unit: `win shares for ${money(sal)}` },
		list: list.slice(1, 4).map((x) => ({
			name: x.r.p.name,
			value: `${ws1(x.l!.ws)} WS`,
			pid: x.r.p.pid,
		})),
		lines: [],
		facts: [`ctrookie|${top.r.p.pid}|${season}`],
	});
};

const lotteryJump: Topic = ({ X, season }) => {
	const rows = lotteryOf(X, season);
	const top = rows.toSorted((a, b) => b.jump - a.jump || a.slot - b.slot)[0];
	if (!top || top.jump < 2) {
		return null;
	}
	const all = lotteryRows(X).map((r) => r.jump);
	return mk({
		id: "s-lot-jump",
		group: "s-lottery",
		theme: "draft",
		score: clamp01(rankScore(rankOf(all, top.jump), all.length) * 0.6 + 0.1),
		kicker: "Lottery night",
		season,
		tid: top.tid,
		heads: [
			`The ${X.teamName(top.tid, season)} jumped ${top.jump} spots in the lottery`,
			`Lottery luck for the ${X.teamName(top.tid, season)}`,
		],
		hero: { text: `#${top.slot} → #${top.pick}`, unit: "in the draft order" },
		list: rows
			.toSorted((a, b) => a.pick - b.pick)
			.slice(0, 5)
			.map((r) => ({
				name: X.teamName(r.tid, season),
				value: `#${r.pick}`,
				sub: `Started at #${r.slot}`,
				tid: r.tid,
			})),
		lines: [],
		facts: [`lottery|${season}|${top.tid}`],
	});
};

const lotteryWin: Topic = ({ X, season }) => {
	const rows = lotteryOf(X, season);
	const no1 = rows.find((r) => r.pick === 1);
	if (!no1 || rows.length < 3) {
		return null;
	}
	const tot = sum(rows.map((r) => r.chances));
	const odds = tot > 0 ? no1.chances / tot : 0;
	return mk({
		id: "s-lot-no1",
		group: "s-lottery",
		theme: "draft",
		score: clamp01(0.22 + (no1.slot > 1 ? 0.1 : 0) + (odds > 0 && odds < 0.1 ? 0.15 : 0)),
		kicker: "The top pick",
		season,
		tid: no1.tid,
		heads: [
			`The ${X.teamName(no1.tid, season)} won the lottery`,
			no1.slot === 1
				? `The worst record got the top pick`
				: `From #${no1.slot} to the top pick`,
		],
		hero:
			odds > 0
				? { text: `${fmtNum(odds * 100, 1)}%`, unit: "chance at No. 1" }
				: { text: "#1", unit: "pick" },
		lines: [
			no1.originalTid !== no1.tid
				? `With a pick that came from the ${X.teamName(no1.originalTid, season)}`
				: null,
		],
		facts: [`lottery|${season}|${no1.tid}`],
	});
};

const lotteryFall: Topic = ({ X, season }) => {
	const rows = lotteryOf(X, season);
	const top = rows.toSorted((a, b) => a.jump - b.jump || a.slot - b.slot)[0];
	if (!top || top.jump > -2) {
		return null;
	}
	return mk({
		id: "s-lot-fall",
		group: "s-lottery",
		theme: "draft",
		score: clamp01(0.25 + -top.jump * 0.05),
		kicker: "Lottery heartbreak",
		season,
		tid: top.tid,
		heads: [
			`The ${X.teamName(top.tid, season)} slid ${-top.jump} spots in the lottery`,
			`No luck for the ${X.teamName(top.tid, season)}`,
		],
		hero: { text: `#${top.slot} → #${top.pick}`, unit: "in the draft order" },
		lines: [],
		facts: [`lottery|${season}|${top.tid}`],
	});
};

const draftNo1: Topic = ({ X, season }) => {
	const cls = draftClass(X, season);
	const p = cls.find((x) => x.draft.round === 1 && x.draft.pick === 1);
	if (!p) {
		return null;
	}
	const rated = p.draftOvr !== undefined && p.draftPot !== undefined;
	return mk({
		id: "s-draft-no1",
		group: "s-draft",
		theme: "draft",
		score: 0.3,
		kicker: `The ${season} draft`,
		season,
		pid: p.pid,
		tid: p.draft.tid,
		heads: [
			`${p.name} went first overall`,
			`The ${X.teamName(p.draft.tid, season)} took ${p.name} at No. 1`,
		],
		hero: rated
			? { text: `${p.draftOvr}/${p.draftPot}`, unit: "ovr/pot on draft night" }
			: { text: "#1", unit: "pick" },
		list: cls.slice(1, 5).map((x) => ({
			name: x.name,
			value: `#${x.draft.pick}`,
			sub: X.teamName(x.draft.tid, season),
			pid: x.pid,
		})),
		lines: [
			`Age ${season - p.bornYear}${p.college ? `, from ${p.college}` : ""}`,
		],
		facts: [`draft1|${season}`],
	});
};

const draftTradedPicks: Topic = ({ X, season }) => {
	const cls = draftClass(X, season).filter(
		(p) =>
			p.draftOriginalTid !== undefined &&
			p.draftOriginalTid >= 0 &&
			p.draftOriginalTid !== p.draft.tid,
	);
	if (cls.length < 2) {
		return null;
	}
	const top = cls[0]!;
	return mk({
		id: "s-draft-traded",
		group: "s-draft",
		theme: "draft",
		score: clamp01(0.22 + cls.length * 0.02 + (top.draft.round === 1 && top.draft.pick <= 5 ? 0.1 : 0)),
		kicker: "Other teams' picks",
		season,
		pid: top.pid,
		heads: [
			`${plural(cls.length, "pick")} made with someone else's selection`,
			`Traded picks shaped the ${season} draft`,
		],
		hero: { text: `${cls.length}`, unit: "traded picks used" },
		list: cls.slice(0, 5).map((p) => ({
			name: p.name,
			value: `${p.draft.round > 1 ? `R${p.draft.round} ` : ""}#${p.draft.pick}`,
			sub: `${abbrev(X, p.draft.tid, season)}, from ${abbrev(X, p.draftOriginalTid!, season)}`,
			pid: p.pid,
		})),
		lines: [],
		facts: [`drafttraded|${season}`],
	});
};

const draftYoungest: Topic = ({ X, season }) => {
	const cls = draftClass(X, season);
	if (cls.length < 8) {
		return null;
	}
	const ages = cls.map((p) => season - p.bornYear);
	const young = cls.toSorted((a, b) => b.bornYear - a.bornYear || a.pid - b.pid)[0]!;
	const avg = sum(ages) / ages.length;
	return mk({
		id: "s-draft-age",
		group: "s-draft",
		theme: "draft",
		score: 0.2,
		kicker: "Draft class",
		season,
		pid: young.pid,
		heads: [
			`The ${season} draft class averaged ${fmtNum(avg, 1)} years old`,
			`${young.name} was the youngest pick`,
		],
		hero: { text: `${season - young.bornYear}`, unit: "the youngest pick's age" },
		lines: [
			`${young.name}, ${young.draft.round > 1 ? `round ${young.draft.round}, ` : ""}pick ${young.draft.pick}`,
			`${plural(cls.length, "player")} drafted`,
		],
		facts: [`draftage|${season}`],
	});
};

const salaryBooks: Topic = ({ X, season }) => {
	const total = (s: number) =>
		sum(
			contractRows(X, s).map((r) =>
				r.c.ended && r.c.ended.season < s && r.c.ended.reason !== "released"
					? 0
					: (salaryIn(r.c, s) ?? 0),
			),
		);
	const now = total(season);
	const prev = total(season - 1);
	if (now <= 0 || prev <= 0) {
		return null;
	}
	const g = now / prev - 1;
	if (Math.abs(g) < 0.04) {
		return null;
	}
	return mk({
		id: "s-books",
		group: "s-money",
		theme: "money",
		score: clamp01(0.2 + Math.min(0.3, Math.abs(g))),
		kicker: "The league's books",
		season,
		heads: [
			g > 0
				? `Salaries rose ${fmtNum(g * 100, 0)}% in a year`
				: `Salaries fell ${fmtNum(-g * 100, 0)}% in a year`,
			`${money(now)} in player salaries`,
		],
		hero: { text: money(now), unit: "on the books" },
		lines: [`${g > 0 ? "Up" : "Down"} from ${money(prev)} the season before`],
		facts: [`books|${season}`],
	});
};

const wire: Topic = ({ X, season }) => {
	const trades = tradesFor(X, season).length;
	const fa = signingsFor(X, season, ["freeAgent"]).length;
	const re = signingsFor(X, season, ["reSign"]).length;
	const rel = releases(X, season).filter((r) => r.season === season).length;
	const tot = trades + fa + re + rel;
	if (tot < 6 || trades === 0) {
		return null;
	}
	return mk({
		id: "s-wire",
		group: "s-wire",
		theme: "moves",
		score: 0.22,
		kicker: "The transaction wire",
		season,
		heads: [`${tot} moves around the league`, `A year of comings and goings`],
		hero: { text: `${tot}`, unit: "transactions" },
		chips: [
			["Trades", `${trades}`],
			["Signings", `${fa}`],
			["Re-signings", `${re}`],
			["Releases", `${rel}`],
		],
		lines: [],
		facts: [`wire|${season}`],
	});
};

const journeymen: Topic = ({ X, season }) => {
	const by = new Map<number, Set<number>>();
	for (const p of X.L.players) {
		const t = new Set(
			p.stats.filter((r) => r.season === season && r.gp > 0).map((r) => r.tid),
		);
		if (t.size >= 3) {
			by.set(p.pid, t);
		}
	}
	const list = [...by].sort((a, b) => b[1].size - a[1].size || a[0] - b[0]);
	if (list.length === 0) {
		return null;
	}
	const [pid, ts] = list[0]!;
	const p = X.players.get(pid)!;
	return mk({
		id: "s-journey",
		group: "s-wire",
		theme: "moves",
		score: clamp01(0.25 + ts.size * 0.06),
		kicker: "Suitcase season",
		season,
		pid,
		heads: [
			`${p.name} played for ${ts.size} teams in one season`,
			`${ts.size} jerseys in a year for ${p.name}`,
		],
		hero: { text: `${ts.size}`, unit: "teams" },
		lines: [[...ts].map((t) => abbrev(X, t, season)).join(", ")],
		facts: [`journey|${pid}|${season}`],
	});
};

const ownedPicks: Topic = ({ X, season }) => {
	if (season !== X.L.season || !X.L.picks?.length) {
		return null;
	}
	const firsts = X.L.picks.filter((d) => d.round === 1);
	const extra = new Map<number, number>();
	for (const d of firsts) {
		if (d.tid !== d.originalTid) {
			extra.set(d.tid, (extra.get(d.tid) ?? 0) + 1);
		}
	}
	const top = [...extra].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
	if (!top || top[1] < 2) {
		return null;
	}
	const owners = firsts.filter((d) => d.tid === top[0]).length;
	return mk({
		id: "s-picks-owned",
		group: "s-money",
		theme: "draft",
		score: clamp01(0.25 + top[1] * 0.06),
		kicker: "Stockpile",
		season,
		tid: top[0],
		heads: [
			`The ${X.teamName(top[0], season)} hold ${plural(top[1], "extra first-round pick")}`,
			`The future belongs to the ${X.teamName(top[0], season)}`,
		],
		hero: { text: `${owners}`, unit: "future first-rounders" },
		lines: [`${top[1]} of them from other teams`],
		facts: [`picks|${top[0]}`],
	});
};

const undraftedPaid: Topic = ({ X, season }) => {
	const list = contractRows(X, season)
		.filter(
			(r) =>
				r.p.draft.round === 0 &&
				salaryIn(r.c, season) !== undefined &&
				X.line(r.p.pid, season),
		)
		.sort(
			(a, b) =>
				(salaryIn(b.c, season) ?? 0) - (salaryIn(a.c, season) ?? 0) ||
				a.p.pid - b.p.pid,
		);
	const top = list[0];
	if (!top) {
		return null;
	}
	const sal = salaryIn(top.c, season)!;
	const all = contractRows(X, season)
		.map((r) => salaryIn(r.c, season))
		.filter((x): x is number => x !== undefined);
	const rank = rankOf(all, sal);
	if (rank > Math.max(10, all.length / 6)) {
		return null;
	}
	return mk({
		id: "s-undrafted-paid",
		group: "s-money",
		theme: "money",
		score: clamp01(rankScore(rank, all.length) * 0.5),
		kicker: "Nobody picked him",
		season,
		pid: top.p.pid,
		heads: [
			`Undrafted, and now one of the best-paid players: ${top.p.name}`,
			`From undrafted to ${money(sal)}`,
		],
		hero: { text: money(sal), unit: "this season" },
		lines: [`${ordinal(rank)}-highest salary in the league`],
		facts: [`undraftedpaid|${top.p.pid}|${season}`],
	});
};

const rookieSlot: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const rookies = draftClass(X, season - 1)
		.map((p) => ({ p, l: X.line(p.pid, season) }))
		.filter((x) => x.l && x.l.gp >= 20);
	const late = rookies
		.filter((x) => x.p.draft.round > 1 || x.p.draft.pick > 10)
		.sort((a, b) => b.l!.ws - a.l!.ws || a.p.pid - b.p.pid)[0];
	if (!late || rookies.length < 6) {
		return null;
	}
	const rank = rookies.filter((x) => x.l!.ws > late.l!.ws).length + 1;
	if (rank > 3) {
		return null;
	}
	return mk({
		id: "s-rookie-late",
		group: "s-draft",
		theme: "draft",
		score: clamp01(0.3 + (rank === 1 ? 0.15 : 0) + Math.min(0.15, late.p.draft.pick / 100)),
		kicker: "Found money",
		season,
		pid: late.p.pid,
		tid: late.l!.tid,
		heads: [
			`${late.p.name} went ${late.p.draft.round > 1 ? `in round ${late.p.draft.round}` : `No. ${late.p.draft.pick}`} and outplayed the top picks`,
			`The rookie nobody saw coming: ${late.p.name}`,
		],
		hero: { text: ws1(late.l!.ws), unit: "rookie win shares" },
		lines: [`${ordinal(rank)} among ${plural(rookies.length, "rookie")} with 20 games`],
		facts: [`rookielate|${late.p.pid}`],
	});
};

const firstBust: Topic = ({ X, season, soFar }) => {
	// The No. 1 pick of a few years ago, against his class
	if (soFar) {
		return null;
	}
	const year = season - 4;
	const cls = draftClass(X, year);
	const no1 = cls.find((p) => p.draft.round === 1 && p.draft.pick === 1);
	if (!no1 || cls.length < 8) {
		return null;
	}
	const ws = cls.map((p) => careerWs(p, season));
	const mine = careerWs(no1, season);
	const rank = rankOf(ws, mine);
	const best = cls[ws.indexOf(Math.max(...ws))]!;
	if (rank <= 3 || best === no1) {
		return null;
	}
	return mk({
		id: "s-no1-later",
		group: "s-draft2",
		theme: "draft",
		score: clamp01(0.25 + Math.min(0.3, rank / 30)),
		kicker: `The ${year} draft, four years on`,
		season,
		pid: best.pid,
		heads: [
			`Four years later, ${best.name} looks like the real No. 1 of ${year}`,
			`${no1.name} went first; ${best.name} has done more`,
		],
		list: [
			{ name: no1.name, value: `${ws1(mine)} WS`, sub: "Pick 1", pid: no1.pid },
			{
				name: best.name,
				value: `${ws1(careerWs(best, season))} WS`,
				sub: `${best.draft.round > 1 ? `Round ${best.draft.round}, ` : ""}pick ${best.draft.pick}`,
				pid: best.pid,
			},
		],
		lines: [`The No. 1 pick ranks ${ordinal(rank)} in his class in career win shares`],
		facts: [`no1later|${year}`],
	});
};

export const DEAL_SEASON: Topic[] = [
	tradeCount,
	biggestTrade,
	bestTrade,
	deadline,
	champTrades,
	picksMoved,
	tradePair,
	allStarMoved,
	faClass,
	faBest,
	faBust,
	resignBig,
	releasesTopic,
	contractYear,
	paydayDip,
	rookieDeals,
	lotteryJump,
	lotteryWin,
	lotteryFall,
	draftNo1,
	draftTradedPicks,
	draftYoungest,
	salaryBooks,
	wire,
	journeymen,
	ownedPicks,
	undraftedPaid,
	rookieSlot,
	firstBust,
];
