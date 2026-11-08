// More front-office topics: what salaries bought, teammates who stayed together, lottery history, the money left on deals and the best players who came through traded picks.
import { mk, type Topic } from "./helpers.ts";
import { fmtNum, ordinal, plural, rankOf, rankScore } from "../util.ts";
import {
	careerWs,
	contractIn,
	contractRows,
	isPlayerAsset,
	lotteryRows,
	salaryIn,
	tradesWith,
} from "../deals.ts";
import { clamp01, lift, money, sum, ws1 } from "./dealsKit.ts";
import { twoWay } from "./kit.ts";
import type { LeagueIndex } from "../league.ts";

// Every qualified line of a season with its salary that season
const paidLines = (X: LeagueIndex, season: number) =>
	X.cached(`deals|paidlines|${season}`, () =>
		X.qualified(season)
			.map((l) => {
				const c = contractIn(X.players.get(l.pid)!, season);
				return { l, sal: c ? (salaryIn(c, season) ?? 0) : 0 };
			})
			.filter((x) => x.sal > 0),
	);

const perM = (ws: number, sal: number) => (ws / sal) * 1000;

// League-wide win shares per $1M of salary, by season
const leagueRate = (X: LeagueIndex, season: number) => {
	const list = paidLines(X, season);
	const sal = sum(list.map((x) => x.sal));
	return sal > 0 ? perM(sum(list.map((x) => x.l.ws)), sal) : undefined;
};

const topPaidWorth: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const list = paidLines(X, season);
	if (list.length < 15) {
		return null;
	}
	const top = list.toSorted((a, b) => b.sal - a.sal || a.l.pid - b.l.pid)[0]!;
	const r = rankOf(
		list.map((x) => x.l.ws),
		top.l.ws,
	);
	return mk({
		id: "s-toppaid",
		group: "s-value",
		theme: "money",
		score: clamp01(0.22 + (r === 1 ? 0.2 : r > list.length / 3 ? 0.2 : 0)),
		kicker: "The top salary",
		season,
		pid: top.l.pid,
		tid: top.l.tid,
		heads: [
			r === 1
				? `The best-paid player was also the most productive: ${top.l.name}`
				: `${top.l.name} drew the top salary and ranked ${ordinal(r)} in win shares`,
		],
		hero: { text: money(top.sal), unit: `for ${ws1(top.l.ws)} win shares` },
		lines: [],
		facts: [`toppaid|${season}`],
	});
};

const cheapStar: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const pids = new Set(X.awardPids(season, "First Team All-League"));
	const list = paidLines(X, season)
		.filter((x) => pids.has(x.l.pid))
		.sort((a, b) => a.sal - b.sal || a.l.pid - b.l.pid);
	const x = list[0];
	if (!x || list.length < 3) {
		return null;
	}
	return mk({
		id: "s-cheapstar",
		group: "s-value",
		theme: "money",
		score: 0.3,
		kicker: "All-League on a budget",
		season,
		pid: x.l.pid,
		tid: x.l.tid,
		heads: [`${x.l.name} made First Team All-League for ${money(x.sal)}`],
		hero: { text: money(x.sal), unit: "salary" },
		lines: [`The cheapest of the ${plural(list.length, "first-teamer")}`],
		facts: [`cheapstar|${season}`],
	});
};

const leagueValue: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const v = leagueRate(X, season);
	const vals = X.decidedSeasons()
		.map((s) => leagueRate(X, s))
		.filter((x): x is number => x !== undefined);
	if (v === undefined || vals.length < 5) {
		return null;
	}
	const w = twoWay(vals, v);
	if (w.score < 0.3) {
		return null;
	}
	return mk({
		id: "s-rate",
		group: "s-value",
		theme: "money",
		score: w.score * 0.5,
		kicker: "The price of a win",
		season,
		heads: [
			w.high
				? `Production was cheap this year`
				: `Production was expensive this year`,
		],
		hero: { text: fmtNum(v, 2), unit: "win shares per $1M" },
		lines: [
			`${ordinal(w.rank)}-${w.high ? "best" : "worst"} rate of ${vals.length} seasons`,
		],
		facts: [`rate|${season}`],
	});
};

const nextClass: Topic = ({ X, season }) => {
	const list = paidLines(X, season)
		.map((x) => ({ ...x, c: contractIn(X.players.get(x.l.pid)!, season)! }))
		.filter((x) => x.c.start + x.c.amounts.length - 1 === season)
		.sort((a, b) => b.l.ws - a.l.ws || a.l.pid - b.l.pid);
	if (list.length < 4) {
		return null;
	}
	return mk({
		id: "s-nextclass",
		group: "s-fa2",
		theme: "money",
		score: clamp01(0.2 + Math.min(0.2, list[0]!.l.ws / 60)),
		kicker: "Contracts running out",
		season,
		pid: list[0]!.l.pid,
		heads: [
			`${plural(list.length, "contract")} end this season, led by ${list[0]!.l.name}'s`,
		],
		list: list.slice(0, 5).map((x) => ({
			name: x.l.name,
			value: money(x.sal),
			sub: X.teamName(x.l.tid, season),
			pid: x.l.pid,
		})),
		lines: [],
		facts: [`nextclass|${season}`],
	});
};

const teamDuo: Topic = ({ X, season, tid }) => {
	const by = new Map<string, number>();
	for (const s of X.seasons) {
		if (s > season) {
			break;
		}
		const ls = X.teamLines(tid!, s)
			.filter((l) => l.gp >= 20)
			.map((l) => l.pid)
			.sort((a, b) => a - b);
		for (let i = 0; i < ls.length; i++) {
			for (let j = i + 1; j < ls.length; j++) {
				const k = `${ls[i]}|${ls[j]}`;
				by.set(k, (by.get(k) ?? 0) + 1);
			}
		}
	}
	const now = new Set(X.teamLines(tid!, season).map((l) => l.pid));
	const top = [...by]
		.filter(([k]) => k.split("|").every((x) => now.has(Number(x))))
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
	if (!top || top[1] < 4) {
		return null;
	}
	const [a, b] = top[0].split("|").map((x) => X.players.get(Number(x))!);
	return mk({
		id: "t-pair",
		group: "t-people-x",
		theme: "people",
		score: clamp01(0.22 + top[1] * 0.03),
		kicker: "Still together",
		tid,
		season,
		pid: a!.pid,
		heads: [`${a!.name} and ${b!.name}: ${top[1]} seasons side by side`],
		hero: { text: `${top[1]}`, unit: "seasons as teammates" },
		lines: [],
		facts: [`mate|${top[0]}`],
	});
};

const teamValue: Topic = ({ X, season, tid, soFar }) => {
	if (soFar) {
		return null;
	}
	const list = paidLines(X, season)
		.filter((x) => x.l.tid === tid && x.sal >= 1000)
		.map((x) => ({ ...x, v: perM(x.l.ws, x.sal) }))
		.sort((a, b) => b.v - a.v || a.l.pid - b.l.pid);
	if (list.length < 4) {
		return null;
	}
	const best = list[0]!;
	const worst = list.at(-1)!;
	return mk({
		id: "t-value",
		group: "t-books3",
		theme: "money",
		score: clamp01(0.2 + Math.min(0.3, best.v / 10)),
		kicker: "Value for money",
		tid,
		season,
		pid: best.l.pid,
		heads: [`${best.l.name} gave the most per dollar`],
		list: [
			{
				name: best.l.name,
				value: `${fmtNum(best.v, 2)} WS/$1M`,
				sub: money(best.sal),
				pid: best.l.pid,
			},
			{
				name: worst.l.name,
				value: `${fmtNum(worst.v, 2)} WS/$1M`,
				sub: money(worst.sal),
				pid: worst.l.pid,
			},
		],
		lines: ["Best and worst value on the roster"],
		facts: [`t-value|${tid}|${season}`],
	});
};

const franchiseTopSalary: Topic = ({ X, season, tid }) => {
	let best: { name: string; pid: number; s: number; sal: number } | undefined;
	for (const s of X.seasons) {
		if (s > season) {
			break;
		}
		for (const l of X.teamLines(tid!, s)) {
			const c = contractIn(X.players.get(l.pid)!, s);
			const sal = c ? salaryIn(c, s) : undefined;
			if (sal && (!best || sal > best.sal)) {
				best = { name: l.name, pid: l.pid, s, sal };
			}
		}
	}
	if (!best || best.s !== season) {
		return null;
	}
	return mk({
		id: "t-recordsalary",
		group: "t-books3",
		theme: "money",
		score: 0.3,
		kicker: "A franchise record",
		tid,
		season,
		pid: best.pid,
		heads: [`${best.name} drew the biggest salary in franchise history`],
		hero: { text: money(best.sal), unit: "this season" },
		lines: [],
		facts: [`t-recsal|${tid}`],
	});
};

const lotteryHistory: Topic = ({ X, season, tid }) => {
	const rows = lotteryRows(X).filter(
		(r) => r.tid === tid && r.season <= season,
	);
	if (rows.length < 3) {
		return null;
	}
	const net = sum(rows.map((r) => r.jump));
	const wins = rows.filter((r) => r.pick === 1).length;
	return mk({
		id: "t-lothist",
		group: "t-draft3",
		theme: "draft",
		score: clamp01(0.2 + Math.abs(net) * 0.03 + wins * 0.05),
		kicker: "Lottery history",
		tid,
		season,
		heads: [
			`${plural(rows.length, "trip")} to the lottery, ${net >= 0 ? "up" : "down"} ${plural(Math.abs(net), "spot")} in all`,
		],
		hero: {
			text: `${net >= 0 ? "+" : ""}${net}`,
			unit: "spots from lottery luck",
		},
		lines: [
			wins > 0 ? `${plural(wins, "lottery win")}` : "Never won the top pick",
		],
		facts: [`t-lothist|${tid}`],
	});
};

const homegrownNow: Topic = ({ X, season, tid }) => {
	const ls = X.teamLines(tid!, season);
	const own = ls.filter((l) => X.players.get(l.pid)!.draft.tid === tid);
	if (ls.length < 8) {
		return null;
	}
	const share = own.length / ls.length;
	const all = X.teamsIn(season).map((t) => {
		const x = X.teamLines(t.tid, season);
		return x.length > 0
			? x.filter((l) => X.players.get(l.pid)!.draft.tid === t.tid).length /
					x.length
			: 0;
	});
	const w = twoWay(all, share);
	if (w.score < 0.4) {
		return null;
	}
	return mk({
		id: "t-owndrafted",
		group: "t-draft3",
		theme: "draft",
		score: w.score * 0.5,
		kicker: "Drafted here",
		tid,
		season,
		heads: [
			w.high
				? `${own.length} of ${ls.length} players were the team's own picks`
				: `Only ${own.length} of ${ls.length} players were drafted here`,
		],
		hero: {
			text: `${own.length}/${ls.length}`,
			unit: "own draft picks on the roster",
		},
		lines: [`${ordinal(w.rank)}-${w.high ? "most" : "fewest"} in the league`],
		facts: [`t-owndrafted|${tid}|${season}`],
	});
};

const playerValue: Topic = ({ X, season, pid, soFar }) => {
	if (soFar) {
		return null;
	}
	const list = paidLines(X, season).filter((x) => x.sal >= 1000);
	const me = list.find((x) => x.l.pid === pid);
	if (!me || list.length < 20) {
		return null;
	}
	const vals = list.map((x) => perM(x.l.ws, x.sal));
	const v = perM(me.l.ws, me.sal);
	const w = twoWay(vals, v);
	if (w.score < 0.4) {
		return null;
	}
	return mk({
		id: "p-perdollar",
		group: "p-contract3",
		theme: "money",
		score: w.score * 0.5,
		kicker: w.high ? "A bargain" : "Pricey",
		pid,
		season,
		heads: [
			w.high
				? `One of the best values in the league`
				: `Not much back for the money`,
		],
		hero: { text: fmtNum(v, 2), unit: "win shares per $1M" },
		lines: [
			`${ordinal(w.rank)}-${w.high ? "best" : "worst"} of ${list.length} paid players`,
		],
		facts: [`perdollar|${pid}|${season}`],
	});
};

const newMates: Topic = ({ X, season, pid }) => {
	const l = X.line(pid!, season);
	const prev = X.line(pid!, season - 1);
	if (!l || !prev || prev.tid !== l.tid) {
		return null;
	}
	const before = new Set(X.teamLines(l.tid, season - 1).map((x) => x.pid));
	const now = X.teamLines(l.tid, season).filter((x) => x.pid !== pid);
	const fresh = now.filter((x) => !before.has(x.pid));
	if (now.length < 6 || fresh.length / now.length < 0.6) {
		return null;
	}
	return mk({
		id: "p-newmates",
		group: "p-people2",
		theme: "people",
		score: clamp01(0.2 + (fresh.length / now.length - 0.6)),
		kicker: "New faces",
		pid,
		season,
		heads: [`${fresh.length} of his ${now.length} teammates were new`],
		hero: { text: `${fresh.length}`, unit: "new teammates" },
		lines: [],
		facts: [`newmates|${pid}|${season}`],
	});
};

const moneyLeft: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const c = p ? contractIn(p, season) : undefined;
	if (!p || !c || c.ended) {
		return null;
	}
	const left = c.amounts.slice(season - c.start + 1);
	if (left.length < 2) {
		return null;
	}
	return mk({
		id: "p-left",
		group: "p-contract3",
		theme: "money",
		score: clamp01(0.18 + Math.min(0.25, sum(left) / 200000)),
		kicker: "Still to come",
		pid,
		season,
		heads: [`${money(sum(left))} left on his deal after this season`],
		hero: {
			text: money(sum(left)),
			unit: `over ${plural(left.length, "more season")}`,
		},
		lines: [],
		facts: [`left|${pid}|${season}`],
	});
};

const priceTag: Topic = ({ X, season, pid }) => {
	const e = tradesWith(X, pid!, season)
		.map((x) => {
			const i = x.t.got.findIndex((side) =>
				side.some((a) => isPlayerAsset(a) && a.pid === pid),
			);
			return { x, gave: x.t.got[1 - i]!.length, to: x.t.tids[i]! };
		})
		.sort((a, b) => b.gave - a.gave || a.x.t.eid - b.x.t.eid)[0];
	if (!e || e.gave < 3) {
		return null;
	}
	return mk({
		id: "p-pricetag",
		group: "p-trade",
		theme: "moves",
		score: clamp01(0.25 + e.gave * 0.04),
		kicker: "The price tag",
		pid,
		season,
		tid: e.to,
		heads: [
			`The ${X.teamName(e.to, e.x.t.season)} gave up ${e.gave} assets to get him`,
		],
		hero: { text: `${e.gave}`, unit: "players and picks" },
		lines: [`In ${e.x.t.season}`],
		facts: [`trade|${e.x.t.eid}`],
	});
};

const tradedStar: Topic = ({ X, season }) => {
	let best:
		| { pid: number; ws: number; s: number; from: number; to: number }
		| undefined;
	for (const t of X.L.trades ?? []) {
		if (t.season > season) {
			continue;
		}
		t.got.forEach((side, i) => {
			for (const a of side) {
				if (isPlayerAsset(a)) {
					const p = X.players.get(a.pid);
					const ws = p ? careerWs(p, season) : 0;
					if (!best || ws > best.ws) {
						best = {
							pid: a.pid,
							ws,
							s: t.season,
							from: t.tids[1 - i]!,
							to: t.tids[i]!,
						};
					}
				}
			}
		});
	}
	if (!best || best.ws < 30) {
		return null;
	}
	const p = X.players.get(best.pid)!;
	return mk({
		id: "a-d-star",
		group: "a-trades-z",
		theme: "moves",
		score: lift(best.ws, 100, 0.25, 0.35),
		kicker: "Nobody is untouchable",
		season: best.s,
		pid: best.pid,
		heads: [
			`Even ${p.name} got traded`,
			`The greatest player ever traded: ${p.name}`,
		],
		hero: { text: ws1(best.ws), unit: "career win shares" },
		lines: [
			`${best.s}: from the ${X.teamName(best.from, best.s)} to the ${X.teamName(best.to, best.s)}`,
		],
		facts: [`a-dstar`],
	});
};

const teamValueAll: Topic = ({ X, season }) => {
	const by = new Map<number, { ws: number; sal: number }>();
	for (const s of X.decidedSeasons()) {
		if (s > season) {
			continue;
		}
		for (const x of paidLines(X, s)) {
			const cur = by.get(x.l.tid) ?? { ws: 0, sal: 0 };
			cur.ws += x.l.ws;
			cur.sal += x.sal;
			by.set(x.l.tid, cur);
		}
	}
	const list = [...by]
		.filter(([, v]) => v.sal > 0)
		.map(([t, v]) => ({ t, v: perM(v.ws, v.sal) }))
		.sort((a, b) => b.v - a.v || a.t - b.t);
	if (list.length < 4) {
		return null;
	}
	return mk({
		id: "a-value",
		group: "a-money-w",
		theme: "money",
		score: clamp01(0.22 + (list[0]!.v / list.at(-1)!.v - 1) * 0.2),
		kicker: "Thrifty",
		season,
		tid: list[0]!.t,
		heads: [
			`The ${X.teamName(list[0]!.t, season)} got the most for their money`,
		],
		list: list.slice(0, 5).map((x) => ({
			name: X.teamName(x.t, season),
			value: `${fmtNum(x.v, 2)} WS/$1M`,
			tid: x.t,
		})),
		lines: ["All-time win shares per $1M of salary"],
		facts: [`a-value`],
	});
};

const longShot: Topic = ({ X }) => {
	const bySeason = new Map<number, number>();
	for (const r of lotteryRows(X)) {
		bySeason.set(r.season, (bySeason.get(r.season) ?? 0) + r.chances);
	}
	const wins = lotteryRows(X)
		.filter((r) => r.pick === 1 && r.chances > 0)
		.map((r) => ({ r, odds: r.chances / (bySeason.get(r.season) ?? 1) }))
		.sort((a, b) => a.odds - b.odds || a.r.season - b.r.season);
	const x = wins[0];
	if (!x || wins.length < 3) {
		return null;
	}
	return mk({
		id: "a-lot-longshot",
		group: "a-lottery-y",
		theme: "draft",
		score: clamp01(0.25 + Math.max(0, 0.15 - x.odds) * 2),
		kicker: "Against the odds",
		season: x.r.season,
		tid: x.r.tid,
		heads: [
			`The ${X.teamName(x.r.tid, x.r.season)} won the ${x.r.season} lottery with ${fmtNum(x.odds * 100, 1)}% odds`,
		],
		hero: { text: `${fmtNum(x.odds * 100, 1)}%`, unit: "chance, and they won" },
		lines: [`They started at #${x.r.slot}`],
		facts: [`lottery|${x.r.season}|${x.r.tid}`],
	});
};

const undraftedEarner: Topic = ({ X, season }) => {
	const by = new Map<number, number>();
	for (const r of contractRows(X, season)) {
		if (r.p.draft.round === 0) {
			const paid = sum(
				r.c.amounts.filter(
					(_, i) => r.c.start + i <= Math.min(season, r.playedTo),
				),
			);
			by.set(r.p.pid, (by.get(r.p.pid) ?? 0) + paid);
		}
	}
	const top = [...by].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
	if (!top || top[1] < 20000) {
		return null;
	}
	const p = X.players.get(top[0])!;
	return mk({
		id: "a-undrafted-pay",
		group: "a-money-w",
		theme: "money",
		score: clamp01(0.25 + Math.min(0.25, top[1] / 400000)),
		kicker: "Undrafted, well paid",
		season,
		pid: p.pid,
		heads: [`No team drafted ${p.name}; he earned ${money(top[1])}`],
		hero: { text: money(top[1]), unit: "in contracts" },
		lines: [],
		facts: [`a-undraftedpay`],
	});
};

const tradedPickStar: Topic = ({ X, season }) => {
	const list = X.L.players
		.filter(
			(p) =>
				p.draftOriginalTid !== undefined &&
				p.draftOriginalTid >= 0 &&
				p.draftOriginalTid !== p.draft.tid &&
				p.draft.year <= season,
		)
		.map((p) => ({ p, ws: careerWs(p, season) }))
		.sort((a, b) => b.ws - a.ws || a.p.pid - b.p.pid);
	const x = list[0];
	if (!x || x.ws < 15) {
		return null;
	}
	return mk({
		id: "a-pickstar",
		group: "a-trades-z",
		theme: "draft",
		score: lift(x.ws, 60, 0.28, 0.35),
		kicker: "The pick that got away",
		season: x.p.draft.year,
		pid: x.p.pid,
		tid: x.p.draft.tid,
		heads: [
			`${x.p.name} was drafted with the ${X.teamAny(x.p.draftOriginalTid!, x.p.draft.year)?.name ?? "other team"}' pick`,
			`The best player ever taken with a traded pick: ${x.p.name}`,
		],
		hero: { text: ws1(x.ws), unit: "career win shares" },
		lines: [
			`${x.p.draft.year}, pick ${x.p.draft.pick}, by the ${X.teamName(x.p.draft.tid, x.p.draft.year)}`,
		],
		facts: [`a-pickstar`],
	});
};

const salaryRankSeason: Topic = ({ X, season }) => {
	const list = paidLines(X, season);
	if (list.length < 20) {
		return null;
	}
	const sals = list.map((x) => x.sal).sort((a, b) => b - a);
	const top10 = sum(sals.slice(0, 10));
	const share = top10 / sum(sals);
	const hist = X.seasons
		.filter((s) => s <= season)
		.map((s) => {
			const x = paidLines(X, s)
				.map((y) => y.sal)
				.sort((a, b) => b - a);
			return x.length >= 20 ? sum(x.slice(0, 10)) / sum(x) : undefined;
		})
		.filter((x): x is number => x !== undefined);
	if (hist.length < 4) {
		return null;
	}
	const w = twoWay(hist, share);
	if (w.score < 0.35) {
		return null;
	}
	return mk({
		id: "s-paytop10",
		group: "s-value",
		theme: "money",
		score: rankScore(w.rank, hist.length) * 0.45,
		kicker: "Where the money went",
		season,
		heads: [
			w.high
				? `The ten best-paid players took ${fmtNum(share * 100, 0)}% of the money`
				: `Salaries were spread out: the top ten took ${fmtNum(share * 100, 0)}%`,
		],
		hero: {
			text: `${fmtNum(share * 100, 0)}%`,
			unit: "of salary to the top ten",
		},
		lines: [
			`${ordinal(w.rank)}-${w.high ? "most" : "least"} top-heavy of ${hist.length} seasons`,
		],
		facts: [`paytop10|${season}`],
	});
};

export const MORE_DEAL_SEASON: Topic[] = [
	topPaidWorth,
	cheapStar,
	leagueValue,
	nextClass,
	salaryRankSeason,
];
export const MORE_DEAL_TEAM: Topic[] = [
	teamDuo,
	teamValue,
	franchiseTopSalary,
	lotteryHistory,
	homegrownNow,
];
export const MORE_DEAL_PLAYER: Topic[] = [
	playerValue,
	newMates,
	moneyLeft,
	priceTag,
];
export const MORE_DEAL_ALL: Topic[] = [
	tradedStar,
	teamValueAll,
	longShot,
	undraftedEarner,
	tradedPickStar,
];
