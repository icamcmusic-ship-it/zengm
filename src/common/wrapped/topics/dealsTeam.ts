// Team topics about the front office: the team's trades, signings, releases and contracts, its lottery and draft night, its pick stash, and how the roster was put together.
import { mk, type Topic } from "./helpers.ts";
import { fmtNum, ordinal, plural, rankOf, rankScore } from "../util.ts";
import {
	careerWs,
	contractIn,
	contractRows,
	draftClass,
	isPlayerAsset,
	lotteryOf,
	releases,
	salaryIn,
	sideOf,
	signingsFor,
	stintFor,
	tradeEvals,
	tradesFor,
	type TradeEval,
} from "../deals.ts";
import { clamp01, lift, money, sideRow, sum, topGot, ws1 } from "./dealsKit.ts";
import type { LeagueIndex } from "../league.ts";
import { pct } from "./kit.ts";

const net = (e: TradeEval, tid: number) => {
	const i = sideOf(e, tid);
	return i < 0 ? 0 : e.sides[i]!.ws - e.sides[1 - i]!.ws;
};

const myTrades = (X: LeagueIndex, season: number, tid: number) =>
	tradesFor(X, season).filter((e) => sideOf(e, tid) >= 0);

const ledger: Topic = ({ X, season, tid, soFar }) => {
	if (soFar) {
		return null;
	}
	const list = myTrades(X, season, tid!);
	if (list.length < 2) {
		return null;
	}
	const v = sum(list.map((e) => net(e, tid!)));
	return mk({
		id: "t-d-ledger",
		group: "t-trades2",
		theme: "moves",
		score: lift(Math.abs(v), 8, 0.25, 0.35),
		kicker: "The trade ledger",
		tid,
		season,
		heads: [
			v >= 0
				? `${plural(list.length, "trade")}, and the team came out ahead`
				: `${plural(list.length, "trade")} that cost more than they gave`,
			`Every deal of ${season}, added up`,
		],
		hero: {
			text: `${v >= 0 ? "+" : ""}${ws1(v)}`,
			unit: "net win shares from trades",
		},
		list: list.map((e) => {
			const i = sideOf(e, tid!) as 0 | 1;
			return {
				...sideRow(X, e, i, season, true),
				value: `${net(e, tid!) >= 0 ? "+" : ""}${ws1(net(e, tid!))}`,
			};
		}),
		lines: [],
		facts: [`t-ledger|${tid}|${season}`],
	});
};

const bestOrWorst =
	(best: boolean): Topic =>
	({ X, season, tid, soFar }) => {
		if (soFar) {
			return null;
		}
		const list = myTrades(X, season, tid!).toSorted(
			(a, b) =>
				(best ? net(b, tid!) - net(a, tid!) : net(a, tid!) - net(b, tid!)) ||
				a.t.eid - b.t.eid,
		);
		const e = list[0];
		if (!e) {
			return null;
		}
		const v = net(e, tid!);
		if (best ? v < 1.5 : v > -1.5) {
			return null;
		}
		const i = sideOf(e, tid!) as 0 | 1;
		const star = topGot(best ? e.sides[i] : e.sides[1 - i]!);
		return mk({
			id: best ? "t-d-best" : "t-d-worst",
			group: "t-trades",
			theme: "moves",
			score: lift(Math.abs(v), 8, 0.3, 0.4),
			kicker: best ? "The trade that worked" : "The one that hurt",
			tid,
			season,
			heads: best
				? [
						star
							? `Trading for ${star.name} paid off`
							: "A trade that paid off",
						`The ${X.teamName(e.sides[1 - i]!.tid, season)} got the short end`,
					]
				: [
						star
							? `${star.name} did more for the other side`
							: "A trade that backfired",
						`The ${X.teamName(e.sides[1 - i]!.tid, season)} won this one`,
					],
			hero: {
				text: `${v >= 0 ? "+" : ""}${ws1(v)}`,
				unit: "win shares in the deal",
			},
			list: [
				sideRow(X, e, i, season, true),
				sideRow(X, e, (1 - i) as 0 | 1, season, true),
			],
			lines: [],
			facts: [`trade|${e.t.eid}`],
		});
	};

const acquired: Topic = ({ X, season, tid, soFar }) => {
	if (soFar) {
		return null;
	}
	const got = myTrades(X, season, tid!)
		.flatMap((e) => e.sides[sideOf(e, tid!)]!.got)
		.filter((g) => !g.pick)
		.sort((a, b) => b.ws - a.ws || a.pid - b.pid);
	const g = got[0];
	if (!g || g.ws < 2) {
		return null;
	}
	const line = X.line(g.pid, season);
	return mk({
		id: "t-d-acquired",
		group: "t-trades",
		theme: "moves",
		score: lift(g.ws, 8, 0.3, 0.35),
		kicker: "The new arrival",
		tid,
		season,
		pid: g.pid,
		heads: [
			`${g.name} arrived by trade and delivered`,
			`The trade for ${g.name}`,
		],
		hero: { text: ws1(g.ws), unit: "win shares for the team" },
		lines: [
			line ? `${fmtNum(line.ppg, 1)} points a game this season` : null,
			got.length > 1
				? `${plural(got.length, "player")} came in by trade`
				: null,
		],
		facts: [`traded|${g.pid}|${season}`],
	});
};

const departed: Topic = ({ X, season, tid, soFar }) => {
	if (soFar) {
		return null;
	}
	const gone = myTrades(X, season, tid!)
		.flatMap((e) =>
			e.sides[1 - sideOf(e, tid!)]!.got.map((g) => ({
				g,
				to: e.sides[1 - sideOf(e, tid!)]!.tid,
			})),
		)
		.filter((x) => !x.g.pick)
		.sort((a, b) => b.g.ws - a.g.ws || a.g.pid - b.g.pid);
	const x = gone[0];
	if (!x || x.g.ws < 3) {
		return null;
	}
	return mk({
		id: "t-d-departed",
		group: "t-trades",
		theme: "moves",
		score: lift(x.g.ws, 8, 0.28, 0.35),
		kicker: "The one who left",
		tid,
		season,
		pid: x.g.pid,
		heads: [`${x.g.name} thrived after the trade`, `Traded away: ${x.g.name}`],
		hero: {
			text: ws1(x.g.ws),
			unit: `win shares for the ${X.teamAny(x.to, season)?.name ?? "new team"}`,
		},
		lines: [`Sent to the ${X.teamName(x.to, season)}`],
		facts: [`traded|${x.g.pid}|${season}`],
	});
};

const pickFlow: Topic = ({ X, season, tid }) => {
	let inn = 0;
	let out = 0;
	for (const t of X.L.trades ?? []) {
		if (t.season !== season) {
			continue;
		}
		t.tids.forEach((x, i) => {
			const n = t.got[i]!.filter((a) => !isPlayerAsset(a)).length;
			if (x === tid) {
				inn += n;
			} else if (t.tids.includes(tid!)) {
				out += n;
			}
		});
	}
	if (inn + out < 2) {
		return null;
	}
	return mk({
		id: "t-d-picks",
		group: "t-trades2",
		theme: "draft",
		score: clamp01(0.2 + Math.abs(inn - out) * 0.06),
		kicker: "Draft capital",
		tid,
		season,
		heads: [
			inn > out
				? `Collecting picks: ${inn} in, ${out} out`
				: inn < out
					? `Spending picks: ${out} out, ${inn} in`
					: `Draft picks: ${inn} in, ${out} out`,
		],
		hero: {
			text: `${inn >= out ? "+" : ""}${inn - out}`,
			unit: "draft picks by trade",
		},
		lines: [],
		facts: [`t-picks|${tid}|${season}`],
	});
};

const faHaul: Topic = ({ X, season, tid }) => {
	const list = signingsFor(X, season, ["freeAgent"])
		.filter((r) => r.tid === tid)
		.sort((a, b) => b.avg - a.avg || a.p.pid - b.p.pid);
	if (list.length < 2) {
		return null;
	}
	const done = X.decided(season);
	const ws = sum(list.map((r) => r.ws));
	return mk({
		id: "t-fa-haul",
		group: "t-fa",
		theme: "money",
		score: clamp01(
			0.22 + list.length * 0.03 + (done ? Math.min(0.2, ws / 40) : 0),
		),
		kicker: "Free agency",
		tid,
		season,
		pid: list[0]!.p.pid,
		heads: [
			`${plural(list.length, "free agent")} signed, led by ${list[0]!.p.name}`,
			`The summer shopping list`,
		],
		hero: {
			text: money(sum(list.map((r) => r.avg))),
			unit: "a year in new deals",
		},
		list: list.slice(0, 5).map((r) => ({
			name: r.p.name,
			value: money(r.avg),
			sub: done ? `${ws1(r.ws)} WS` : `${plural(r.c.amounts.length, "season")}`,
			pid: r.p.pid,
		})),
		lines: [],
		facts: [`t-fa|${tid}|${season}`],
	});
};

const faBest: Topic = ({ X, season, tid, soFar }) => {
	if (soFar) {
		return null;
	}
	const r = signingsFor(X, season, ["freeAgent"])
		.filter((x) => x.tid === tid && x.ws > 0)
		.sort(
			(a, b) =>
				b.ws / Math.max(1, b.avg) - a.ws / Math.max(1, a.avg) ||
				a.p.pid - b.p.pid,
		)[0];
	if (!r || r.ws < 2.5) {
		return null;
	}
	return mk({
		id: "t-fa-best",
		group: "t-fa",
		theme: "money",
		score: lift(r.ws, 8, 0.28, 0.35),
		kicker: "Money well spent",
		tid,
		season,
		pid: r.p.pid,
		heads: [
			`${r.p.name} was worth every dollar`,
			`The signing that paid off: ${r.p.name}`,
		],
		hero: { text: ws1(r.ws), unit: `win shares for ${money(r.avg)}` },
		lines: [
			`${fmtNum((r.ws / Math.max(1, r.avg)) * 1000, 2)} win shares per $1M`,
		],
		facts: [`contract|${r.p.pid}|${r.c.start}`],
	});
};

const resigned: Topic = ({ X, season, tid }) => {
	const list = signingsFor(X, season, ["reSign"])
		.filter((r) => r.tid === tid)
		.sort((a, b) => b.total - a.total || a.p.pid - b.p.pid);
	const top = list[0];
	if (!top || top.total < 5000) {
		return null;
	}
	return mk({
		id: "t-resign",
		group: "t-fa",
		theme: "money",
		score: clamp01(0.2 + Math.min(0.25, top.total / 250000)),
		kicker: "Keeping the band together",
		tid,
		season,
		pid: top.p.pid,
		heads: [
			`${top.p.name} signed on again`,
			`${money(top.total)} to keep ${top.p.name}`,
		],
		hero: {
			text: money(top.avg),
			unit: `a year for ${plural(top.c.amounts.length, "season")}`,
		},
		list: list
			.slice(1, 4)
			.map((r) => ({ name: r.p.name, value: money(r.avg), pid: r.p.pid })),
		lines: [],
		facts: [`contract|${top.p.pid}|${top.c.start}`],
	});
};

const teamReleases: Topic = ({ X, season, tid }) => {
	const list = releases(X, season).filter(
		(r) => r.tid === tid && r.season === season,
	);
	if (list.length === 0) {
		return null;
	}
	const owed = sum(list.map((r) => r.owed));
	const top = list.toSorted((a, b) => b.owed - a.owed || a.p.pid - b.p.pid)[0]!;
	return mk({
		id: "t-releases",
		group: "t-books",
		theme: "money",
		score: clamp01(0.2 + Math.min(0.3, owed / 60000)),
		kicker: "Waived",
		tid,
		season,
		pid: top.p.pid,
		heads: [
			list.length === 1
				? `${top.p.name} was released`
				: `${plural(list.length, "player")} released`,
			owed > 0
				? `${money(owed)} still owed to players no longer here`
				: `Roster cuts`,
		],
		hero: {
			text: owed > 0 ? money(owed) : `${list.length}`,
			unit: owed > 0 ? "left on the books" : "released",
		},
		list: list
			.slice(0, 4)
			.map((r) => ({ name: r.p.name, value: money(r.owed), pid: r.p.pid })),
		lines: [],
		facts: [`t-rel|${tid}|${season}`],
	});
};

const deadMoney: Topic = ({ X, season, tid }) => {
	const list = releases(X, season)
		.filter((r) => r.tid === tid && r.season < season)
		.map((r) => ({ r, amt: salaryIn(r.c, season) ?? 0 }))
		.filter((x) => x.amt > 0);
	if (list.length === 0) {
		return null;
	}
	const tot = sum(list.map((x) => x.amt));
	return mk({
		id: "t-dead",
		group: "t-books",
		theme: "money",
		score: clamp01(0.2 + Math.min(0.3, tot / 30000)),
		kicker: "Dead money",
		tid,
		season,
		heads: [
			`Still paying for players gone`,
			`${money(tot)} for players on other rosters or none`,
		],
		hero: { text: money(tot), unit: "to released players" },
		list: list.map((x) => ({
			name: x.r.p.name,
			value: money(x.amt),
			sub: `Released ${x.r.season}`,
			pid: x.r.p.pid,
		})),
		lines: [],
		facts: [`t-dead|${tid}|${season}`],
	});
};

const rosterPay = (X: LeagueIndex, tid: number, season: number) =>
	X.teamLines(tid, season)
		.map((l) => {
			const p = X.players.get(l.pid)!;
			const c = contractIn(p, season);
			return { l, p, sal: c ? (salaryIn(c, season) ?? 0) : 0, c };
		})
		.filter((x) => x.sal > 0)
		.sort((a, b) => b.sal - a.sal || a.p.pid - b.p.pid);

const topShare: Topic = ({ X, season, tid }) => {
	const list = rosterPay(X, tid!, season);
	if (list.length < 5) {
		return null;
	}
	const tot = sum(list.map((x) => x.sal));
	const top3 = sum(list.slice(0, 3).map((x) => x.sal));
	const share = top3 / tot;
	if (share < 0.5) {
		return null;
	}
	return mk({
		id: "t-top3pay",
		group: "t-books",
		theme: "money",
		score: clamp01(0.2 + (share - 0.5) * 0.9),
		kicker: "Top-heavy payroll",
		tid,
		season,
		heads: [
			`Three players took ${pct(share, 0)} of the payroll`,
			`The money went to the top`,
		],
		hero: { text: pct(share, 0), unit: "of salary to the top three" },
		list: list
			.slice(0, 3)
			.map((x) => ({ name: x.p.name, value: money(x.sal), pid: x.p.pid })),
		lines: [
			`${money(tot)} paid to ${plural(list.length, "player")} who played`,
		],
		facts: [`t-top3|${tid}|${season}`],
	});
};

const expiring: Topic = ({ X, season, tid }) => {
	const list = rosterPay(X, tid!, season).filter(
		(x) => x.c && x.c.start + x.c.amounts.length - 1 === season,
	);
	if (list.length < 2) {
		return null;
	}
	const ws = X.decided(season) ? sum(list.map((x) => x.l.ws)) : undefined;
	return mk({
		id: "t-expiring",
		group: "t-books",
		theme: "money",
		score: clamp01(
			0.18 +
				list.length * 0.03 +
				(ws !== undefined ? Math.min(0.2, ws / 40) : 0),
		),
		kicker: "Expiring deals",
		tid,
		season,
		heads: [
			`${plural(list.length, "contract")} ran out this season`,
			`Decisions ahead: ${list[0]!.p.name} and more`,
		],
		hero: {
			text: money(sum(list.map((x) => x.sal))),
			unit: "coming off the books",
		},
		list: list.slice(0, 5).map((x) => ({
			name: x.p.name,
			value: money(x.sal),
			sub: ws !== undefined ? `${ws1(x.l.ws)} WS` : undefined,
			pid: x.p.pid,
		})),
		lines: [],
		facts: [`t-exp|${tid}|${season}`],
	});
};

const books: Topic = ({ X, season, tid }) => {
	if (season !== X.L.season) {
		return null;
	}
	const next = X.L.players
		.filter((p) => p.tid === tid)
		.map((p) => {
			const c = contractIn(p, season + 1);
			return c ? (salaryIn(c, season + 1) ?? 0) : 0;
		});
	const committed = sum(next);
	const n = next.filter((x) => x > 0).length;
	if (n === 0) {
		return null;
	}
	const all = new Map<number, number>();
	for (const p of X.L.players) {
		if (p.tid >= 0) {
			const c = contractIn(p, season + 1);
			all.set(
				p.tid,
				(all.get(p.tid) ?? 0) + (c ? (salaryIn(c, season + 1) ?? 0) : 0),
			);
		}
	}
	const vals = [...all.values()];
	const rank = rankOf(vals, committed);
	return mk({
		id: "t-committed",
		group: "t-books2",
		theme: "money",
		score: clamp01(
			rankScore(Math.min(rank, vals.length + 1 - rank), vals.length) * 0.5,
		),
		kicker: "Next season's books",
		tid,
		season,
		heads: [`${money(committed)} already committed for ${season + 1}`],
		hero: { text: money(committed), unit: `for ${season + 1}` },
		lines: [
			`${plural(n, "player")} under contract`,
			`${ordinal(rank)}-most in the league`,
		],
		facts: [`t-committed|${tid}`],
	});
};

const contractYearT: Topic = ({ X, season, tid, soFar }) => {
	if (soFar) {
		return null;
	}
	const x = rosterPay(X, tid!, season)
		.filter(
			(y) =>
				y.c &&
				y.c.start + y.c.amounts.length - 1 === season &&
				y.c.amounts.length >= 2,
		)
		.map((y) => ({ ...y, prev: X.line(y.p.pid, season - 1) }))
		.filter((y) => y.prev && y.l.ws - y.prev.ws >= 2.5)
		.sort(
			(a, b) =>
				b.l.ws - b.prev!.ws - (a.l.ws - a.prev!.ws) || a.p.pid - b.p.pid,
		)[0];
	if (!x) {
		return null;
	}
	return mk({
		id: "t-ct-year",
		group: "t-contracts",
		theme: "money",
		score: lift(x.l.ws - x.prev!.ws, 6, 0.25, 0.3),
		kicker: "Contract year",
		tid,
		season,
		pid: x.p.pid,
		heads: [
			`${x.p.name} raised his price`,
			`A contract year to remember for ${x.p.name}`,
		],
		hero: {
			text: `+${ws1(x.l.ws - x.prev!.ws)}`,
			unit: "win shares from last season",
		},
		lines: [
			`The last season of a ${money(x.c!.amounts.reduce((a, b) => a + b, 0) / x.c!.amounts.length)}-a-year deal`,
		],
		facts: [`ctyear|${x.p.pid}|${season}`],
	});
};

const lottery: Topic = ({ X, season, tid }) => {
	const r = lotteryOf(X, season).find((x) => x.tid === tid);
	if (!r) {
		return null;
	}
	return mk({
		id: "t-lottery",
		group: "t-draft",
		theme: "draft",
		score: clamp01(0.22 + Math.abs(r.jump) * 0.07 + (r.pick === 1 ? 0.15 : 0)),
		kicker:
			r.jump > 0
				? "Lottery luck"
				: r.jump < 0
					? "Lottery heartbreak"
					: "Lottery night",
		tid,
		season,
		heads: [
			r.pick === 1
				? `The ping-pong balls landed on No. 1`
				: r.jump > 0
					? `Up ${r.jump} ${r.jump === 1 ? "spot" : "spots"} on lottery night`
					: r.jump < 0
						? `Down ${-r.jump} ${r.jump === -1 ? "spot" : "spots"} on lottery night`
						: `The lottery held them at No. ${r.pick}`,
		],
		hero: { text: `#${r.slot} → #${r.pick}`, unit: "draft position" },
		lines: [
			r.originalTid !== r.tid
				? `The pick came from the ${X.teamName(r.originalTid, season)}`
				: null,
		],
		facts: [`lottery|${season}|${tid}`],
	});
};

const draftNight: Topic = ({ X, season, tid }) => {
	const list = draftClass(X, season).filter((p) => p.draft.tid === tid);
	if (list.length === 0) {
		return null;
	}
	const top = list[0]!;
	return mk({
		id: "t-draftnight",
		group: "t-draft",
		theme: "draft",
		score: clamp01(
			0.2 +
				(top.draft.round === 1 ? Math.max(0, 0.25 - top.draft.pick * 0.02) : 0),
		),
		kicker: "Draft night",
		tid,
		season,
		pid: top.pid,
		heads: [
			`${top.name} at ${top.draft.round > 1 ? `round ${top.draft.round}, pick ${top.draft.pick}` : `No. ${top.draft.pick}`}`,
			`The ${season} draft class: ${list
				.map((p) => p.name)
				.slice(0, 2)
				.join(" and ")}`,
		],
		list: list.slice(0, 5).map((p) => ({
			name: p.name,
			value: `${p.draft.round > 1 ? `R${p.draft.round} ` : ""}#${p.draft.pick}`,
			sub:
				p.draftOvr !== undefined && p.draftPot !== undefined
					? `${p.draftOvr} ovr, ${p.draftPot} pot`
					: undefined,
			pid: p.pid,
		})),
		lines: [],
		facts: [`t-draft|${tid}|${season}`],
	});
};

const foreignPick: Topic = ({ X, season, tid }) => {
	const p = draftClass(X, season).find(
		(x) =>
			x.draft.tid === tid &&
			x.draftOriginalTid !== undefined &&
			x.draftOriginalTid >= 0 &&
			x.draftOriginalTid !== tid,
	);
	if (!p) {
		return null;
	}
	return mk({
		id: "t-foreignpick",
		group: "t-draft",
		theme: "draft",
		score: clamp01(
			0.25 + (p.draft.round === 1 ? Math.max(0, 0.2 - p.draft.pick * 0.01) : 0),
		),
		kicker: "Someone else's pick",
		tid,
		season,
		pid: p.pid,
		heads: [
			`${p.name} came with the ${X.teamAny(p.draftOriginalTid!, season)?.name ?? "other team"}' pick`,
			`A traded pick became ${p.name}`,
		],
		lines: [
			`${p.draft.round > 1 ? `Round ${p.draft.round}, ` : ""}pick ${p.draft.pick}, originally belonging to the ${X.teamName(p.draftOriginalTid!, season)}`,
		],
		facts: [`t-fpick|${p.pid}`],
	});
};

const futurePicks: Topic = ({ X, season, tid }) => {
	if (season !== X.L.season || !X.L.picks?.length) {
		return null;
	}
	const firsts = X.L.picks.filter((d) => d.round === 1);
	const own = firsts.filter(
		(d) => d.tid === tid && d.originalTid === tid,
	).length;
	const extra = firsts.filter((d) => d.tid === tid && d.originalTid !== tid);
	const owed = firsts.filter((d) => d.originalTid === tid && d.tid !== tid);
	if (extra.length + owed.length === 0) {
		return null;
	}
	return mk({
		id: "t-futurepicks",
		group: "t-books2",
		theme: "draft",
		score: clamp01(0.2 + Math.abs(extra.length - owed.length) * 0.07),
		kicker: "Future picks",
		tid,
		season,
		heads: [
			extra.length >= owed.length
				? `Holding ${plural(extra.length, "extra first-round pick")}`
				: `${plural(owed.length, "first-round pick")} owed to other teams`,
		],
		hero: { text: `${own + extra.length}`, unit: "future first-rounders" },
		chips: [
			["Own", `${own}`],
			["From others", `${extra.length}`],
			["Owed away", `${owed.length}`],
		],
		lines: [],
		facts: [`picks|${tid}`],
	});
};

const partner: Topic = ({ X, season, tid }) => {
	const by = new Map<number, number>();
	for (const e of tradeEvals(X, season)) {
		const i = sideOf(e, tid!);
		if (i >= 0) {
			const o = e.t.tids[1 - i]!;
			by.set(o, (by.get(o) ?? 0) + 1);
		}
	}
	const top = [...by].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
	if (!top || top[1] < 3) {
		return null;
	}
	return mk({
		id: "t-partner",
		group: "t-trades3",
		theme: "moves",
		score: clamp01(0.22 + top[1] * 0.04),
		kicker: "Favorite trading partner",
		tid,
		season,
		heads: [
			`${top[1]} trades with the ${X.teamName(top[0], season)}`,
			`Old friends on the phone`,
		],
		hero: {
			text: `${top[1]}`,
			unit: `trades with the ${X.teamAny(top[0], season)?.name ?? "same team"}`,
		},
		lines: [`Of ${plural(sum([...by.values()]), "trade")} in the log`],
		facts: [`t-partner|${tid}`],
	});
};

const tradeHistory: Topic = ({ X, season, tid, soFar }) => {
	const evs = tradeEvals(X, soFar ? season - 1 : season);
	const by = new Map<number, number>();
	for (const e of evs) {
		for (const i of [0, 1] as const) {
			const t = e.t.tids[i];
			by.set(t, (by.get(t) ?? 0) + net(e, t));
		}
	}
	const mine = by.get(tid!);
	if (mine === undefined || by.size < 4) {
		return null;
	}
	const vals = [...by.values()];
	const hi = rankOf(vals, mine);
	const lo = vals.length + 1 - hi;
	if (Math.min(hi, lo) > 3) {
		return null;
	}
	const n = evs.filter((e) => sideOf(e, tid!) >= 0).length;
	return mk({
		id: "t-tradehist",
		group: "t-trades3",
		theme: "moves",
		score: clamp01(0.25 + (Math.min(hi, lo) === 1 ? 0.15 : 0)),
		kicker: "All-time trade record",
		tid,
		season,
		heads: [
			hi <= lo
				? `The franchise has won its trades: ${ordinal(hi)}-best net in the log`
				: `The franchise has lost its trades: ${ordinal(lo)}-worst net in the log`,
		],
		hero: {
			text: `${mine >= 0 ? "+" : ""}${ws1(mine)}`,
			unit: "net win shares from trades",
		},
		lines: [`Over ${plural(n, "trade")}`],
		facts: [`t-tradehist|${tid}`],
	});
};

const faHistory: Topic = ({ X, season, tid }) => {
	const r = contractRows(X, season)
		.filter((x) => x.c.type === "freeAgent" && x.tid === tid)
		.map((x) => ({
			x,
			ws: stintFor(x.p, tid!, x.c.start, Math.min(season, x.end)).ws,
		}))
		.sort((a, b) => b.ws - a.ws || a.x.p.pid - b.x.p.pid)[0];
	if (!r || r.ws < 10) {
		return null;
	}
	return mk({
		id: "t-fa-ever",
		group: "t-fa2",
		theme: "money",
		score: lift(r.ws, 40, 0.25, 0.35),
		kicker: "Best signing ever",
		tid,
		season,
		pid: r.x.p.pid,
		heads: [`${r.x.p.name}: the best free agent the franchise ever signed`],
		hero: { text: ws1(r.ws), unit: "win shares on the deal" },
		lines: [
			`Signed in ${r.x.c.signed ?? r.x.c.start - 1} for ${money(r.x.avg)} a year`,
		],
		facts: [`t-faever|${tid}`],
	});
};

const bestPick: Topic = ({ X, season, tid }) => {
	const list = X.L.players
		.filter(
			(p) => p.draft.tid === tid && p.draft.round > 0 && p.draft.year < season,
		)
		.map((p) => ({ p, ws: stintFor(p, tid!, p.draft.year, season).ws }))
		.sort((a, b) => b.ws - a.ws || a.p.pid - b.p.pid);
	const top = list[0];
	if (!top || top.ws < 15 || list.length < 5) {
		return null;
	}
	return mk({
		id: "t-bestpick",
		group: "t-draft2",
		theme: "draft",
		score: lift(top.ws, 60, 0.25, 0.35),
		kicker: "Best draft pick",
		tid,
		season,
		pid: top.p.pid,
		heads: [
			`${top.p.name} is the franchise's best draft pick`,
			`Drafted ${top.p.draft.year}: ${top.p.name}`,
		],
		hero: { text: ws1(top.ws), unit: "win shares for the team" },
		lines: [
			`${top.p.draft.round > 1 ? `Round ${top.p.draft.round}, ` : ""}pick ${top.p.draft.pick} in ${top.p.draft.year}`,
		],
		facts: [`t-bestpick|${tid}`],
	});
};

const topPickBust: Topic = ({ X, season, tid }) => {
	const list = X.L.players
		.filter(
			(p) =>
				p.draft.tid === tid &&
				p.draft.round === 1 &&
				p.draft.pick <= 5 &&
				p.draft.year <= season - 4,
		)
		.map((p) => ({ p, ws: careerWs(p, season) }))
		.sort((a, b) => a.ws - b.ws || a.p.pid - b.p.pid);
	const x = list[0];
	if (!x || x.ws > 6) {
		return null;
	}
	return mk({
		id: "t-pickbust",
		group: "t-draft2",
		theme: "draft",
		score: clamp01(0.3 - x.ws * 0.02 + (x.p.draft.pick <= 2 ? 0.1 : 0)),
		kicker: "The pick that got away",
		tid,
		season,
		pid: x.p.pid,
		heads: [`${x.p.name} went No. ${x.p.draft.pick} and never took off`],
		hero: { text: ws1(x.ws), unit: "career win shares" },
		lines: [`Drafted in ${x.p.draft.year}`],
		facts: [`t-pickbust|${tid}`],
	});
};

const rookieScale: Topic = ({ X, season, tid, soFar }) => {
	if (soFar) {
		return null;
	}
	const list = X.teamLines(tid!, season);
	const tot = sum(list.map((l) => Math.max(0, l.ws)));
	if (tot <= 0) {
		return null;
	}
	const rook = list.filter(
		(l) => contractIn(X.players.get(l.pid)!, season)?.type === "rookie",
	);
	const ws = sum(rook.map((l) => Math.max(0, l.ws)));
	const share = ws / tot;
	if (rook.length === 0 || share < 0.25) {
		return null;
	}
	return mk({
		id: "t-rookiescale",
		group: "t-contracts",
		theme: "money",
		score: clamp01(0.2 + share * 0.5),
		kicker: "Cheap production",
		tid,
		season,
		heads: [`${pct(share, 0)} of the win shares came from rookie-scale deals`],
		hero: { text: pct(share, 0), unit: "from rookie contracts" },
		list: rook
			.toSorted((a, b) => b.ws - a.ws)
			.slice(0, 4)
			.map((l) => ({ name: l.name, value: `${ws1(l.ws)} WS`, pid: l.pid })),
		lines: [],
		facts: [`t-rookiescale|${tid}|${season}`],
	});
};

const howBuilt: Topic = ({ X, season, tid, soFar }) => {
	if (soFar) {
		return null;
	}
	const list = X.teamLines(tid!, season);
	const parts = { drafted: 0, traded: 0, signed: 0 };
	for (const l of list) {
		const p = X.players.get(l.pid)!;
		const ws = Math.max(0, l.ws);
		const lastIn = p.moves.findLast((m) => m.tid === tid && m.season <= season);
		if (p.draft.tid === tid && (!lastIn || lastIn.type === "draft")) {
			parts.drafted += ws;
		} else if (lastIn?.type === "trade") {
			parts.traded += ws;
		} else {
			parts.signed += ws;
		}
	}
	const tot = parts.drafted + parts.traded + parts.signed;
	if (tot < 10) {
		return null;
	}
	const top = (Object.entries(parts) as [keyof typeof parts, number][]).sort(
		(a, b) => b[1] - a[1],
	)[0]!;
	const share = top[1] / tot;
	if (share < 0.45) {
		return null;
	}
	const word = {
		drafted: "the draft",
		traded: "trades",
		signed: "free agency",
	}[top[0]];
	return mk({
		id: "t-built",
		group: "t-roster-src",
		theme: "moves",
		score: clamp01(0.2 + (share - 0.45)),
		kicker: "How the roster was built",
		tid,
		season,
		heads: [
			`Built through ${word}`,
			`${pct(share, 0)} of the win shares came via ${word}`,
		],
		hero: { text: pct(share, 0), unit: `of win shares via ${word}` },
		chips: [
			["Drafted", pct(parts.drafted / tot, 0)],
			["Traded for", pct(parts.traded / tot, 0)],
			["Signed", pct(parts.signed / tot, 0)],
		],
		lines: [],
		facts: [`t-built|${tid}|${season}`],
	});
};

const tradedBack: Topic = ({ X, season, tid }) => {
	for (const p of X.L.players) {
		const ms = p.moves.filter((m) => m.type === "trade" && m.season <= season);
		const away = ms.find((m) => m.fromTid === tid);
		const back = away
			? ms.find((m) => m.tid === tid && m.season > away.season)
			: undefined;
		if (away && back && back.season === season) {
			return mk({
				id: "t-tradedback",
				group: "t-trades3",
				theme: "moves",
				score: 0.35,
				kicker: "Return trip",
				tid,
				season,
				pid: p.pid,
				heads: [`They traded ${p.name} away, then traded to get him back`],
				lines: [`Sent off in ${away.season}, back in ${back.season}`],
				facts: [`tradedback|${p.pid}`],
			});
		}
	}
	return null;
};

export const DEAL_TEAM: Topic[] = [
	ledger,
	bestOrWorst(true),
	bestOrWorst(false),
	acquired,
	departed,
	pickFlow,
	faHaul,
	faBest,
	resigned,
	teamReleases,
	deadMoney,
	topShare,
	expiring,
	books,
	contractYearT,
	lottery,
	draftNight,
	foreignPick,
	futurePicks,
	partner,
	tradeHistory,
	faHistory,
	bestPick,
	topPickBust,
	rookieScale,
	howBuilt,
	tradedBack,
];
