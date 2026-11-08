// Storyline kinds from the front office: trades that went one way, salary dumps, contract years and paydays, bargains and albatrosses, releases, lottery nights, draft busts and steals, relocations. Facts come from the trades, contracts and lotteries in the snapshot (see wrapped/deals.ts); a kind finds nothing when the league has none. Several kinds also tell their story in the other shapes the Explorer used: a short Q&A, a timeline or a tale of the tape, picked like any other body variant.

import type { LeagueIndex } from "../wrapped/league.ts";
import type { WPlayer } from "../wrapped/types.ts";
import { fmtNum, ordinal, plural, span } from "../wrapped/util.ts";
import {
	assetText,
	careerWs,
	contractRows,
	draftClass,
	isInSeason,
	isPlayerAsset,
	lotteryRows,
	overallPick,
	releases,
	stintFor,
	tradeEvals,
	type TradeEval,
} from "../wrapped/deals.ts";
import { pLink, tLink, type Draft, type Kind } from "./kit.ts";

const ws1 = (x: number) => fmtNum(x, 1);
const money = (k: number) => `$${fmtNum(k / 1000, 1)}M`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ---- Body shapes ------------------------------------------------------------

// "Who won it? The Herons. What did it cost? Two picks."
export const qaBody = (pairs: [string, string][]) =>
	pairs.map(([q, a]) => `${q} ${a}`).join(" ");

// "2025: drafted. 2027: traded. 2029: MVP."
export const timelineBody = (items: [number | string, string][]) =>
	`${items.map(([y, t]) => `${y}: ${t}`).join(". ")}.`;

// "Tale of the tape. Herons: A, 30.2 WS. Foxes: B, 4.1 WS."
export const tapeBody = (title: string, rows: [string, string][]) =>
	`${title}. ${rows.map(([a, b]) => `${a}: ${b}`).join(". ")}.`;

// ---- Shared -----------------------------------------------------------------

const allEvals = (X: LeagueIndex) => tradeEvals(X, X.L.season);

const sideText = (X: LeagueIndex, e: TradeEval, i: 0 | 1) =>
	assetText(X, e.t.got[i]);

const winsIn = (X: LeagueIndex, tid: number, s: number) => X.team(tid, s)?.won;

const players = (X: LeagueIndex) => X.L.players;

const pFor = (X: LeagueIndex, pid: number) => X.players.get(pid);

// ---- Trades -----------------------------------------------------------------

const lopsided: Kind = {
	kind: "Lopsided trade",
	find: (X) => {
		const out: Draft[] = [];
		for (const e of allEvals(X)) {
			if (e.margin < 15 || e.at > X.L.season - 1) {
				continue;
			}
			const w = e.winner;
			const l = (1 - w) as 0 | 1;
			const W = e.sides[w];
			const Lo = e.sides[l];
			const s = e.t.season;
			out.push({
				key: `${e.t.eid}`,
				kind: "Lopsided trade",
				shape: "team",
				season: s,
				span: [s, Math.max(s, ...W.got.flatMap((g) => g.seasons))],
				score: 15 + e.margin,
				pids: W.got.map((g) => g.pid).slice(0, 3),
				tids: [W.tid, Lo.tid],
				heads: [
					`The ${X.teamName(W.tid, s)} won the ${s} trade by a mile`,
					`A one-sided deal: ${sideText(X, e, w)} for ${sideText(X, e, l)}`,
				],
				bodies: [
					`In ${s} the ${tLink(X, W.tid, s)} got ${sideText(X, e, w)} from the ${tLink(X, Lo.tid, s)} for ${sideText(X, e, l)}. What they got produced ${ws1(W.ws)} win shares for them; what they gave up produced ${ws1(Lo.ws)} for the other side.`,
					tapeBody("Tale of the tape", [
						[X.teamName(W.tid, s), `${sideText(X, e, w)}, ${ws1(W.ws)} win shares`],
						[X.teamName(Lo.tid, s), `${sideText(X, e, l)}, ${ws1(Lo.ws)} win shares`],
					]),
					qaBody([
						["Who won the trade?", `The ${tLink(X, W.tid, s)}, by ${ws1(e.margin)} win shares.`],
						["What did they get?", `${sideText(X, e, w)}.`],
						["What did it cost them?", `${sideText(X, e, l)}.`],
					]),
				],
				evidence: [
					["Season", `${s}`],
					[X.teamName(W.tid, s), `${ws1(W.ws)} WS`],
					[X.teamName(Lo.tid, s), `${ws1(Lo.ws)} WS`],
				],
			});
		}
		return out;
	},
};

const salaryDump: Kind = {
	kind: "Salary dump that worked",
	find: (X) => {
		const out: Draft[] = [];
		for (const e of allEvals(X)) {
			for (const i of [0, 1] as const) {
				const gave = e.t.got[1 - i]!;
				const got = e.t.got[i];
				const sentPay = sum(gave.map((a) => (isPlayerAsset(a) ? a.amount : 0)));
				const gotPay = sum(got.map((a) => (isPlayerAsset(a) ? a.amount : 0)));
				const tid = e.t.tids[i];
				const before = winsIn(X, tid, e.at - 1);
				const after = winsIn(X, tid, e.at);
				if (
					sentPay < 15000 ||
					sentPay - gotPay < 10000 ||
					before === undefined ||
					after === undefined ||
					after - before < 8 ||
					!X.decided(e.at)
				) {
					continue;
				}
				const s = e.t.season;
				out.push({
					key: `${e.t.eid}|${tid}`,
					kind: "Salary dump that worked",
					shape: "team",
					season: e.at,
					span: [s, e.at],
					score: 12 + (after - before) + (sentPay - gotPay) / 2000,
					pids: gave.filter(isPlayerAsset).map((a) => a.pid),
					tids: [tid],
					heads: [
						`The ${X.teamName(tid, e.at)} shed salary and got better`,
						`Less money, more wins for the ${X.teamName(tid, e.at)}`,
					],
					bodies: [
						`The ${tLink(X, tid, s)} sent ${assetText(X, gave)} (${money(sentPay)} a year) to the ${tLink(X, e.t.tids[1 - i]!, s)} and took back ${money(gotPay)}. They went from ${plural(before, "win")} to ${after} the next season.`,
						qaBody([
							["What went out?", `${assetText(X, gave)}, ${money(sentPay)} a year in salary.`],
							["What came back?", `${assetText(X, got)}, ${money(gotPay)}.`],
							["And then?", `${plural(before, "win")} became ${after}.`],
						]),
					],
					evidence: [
						["Salary out", money(sentPay)],
						["Salary in", money(gotPay)],
						["Wins", `${before} → ${after}`],
					],
				});
			}
		}
		return out;
	},
};

const deadlineDeal: Kind = {
	kind: "Deadline deal",
	find: (X) => {
		const out: Draft[] = [];
		for (const e of allEvals(X)) {
			if (!isInSeason(e.t) || !X.decided(e.t.season)) {
				continue;
			}
			for (const i of [0, 1] as const) {
				const side = e.sides[i];
				const t = X.team(side.tid, e.t.season);
				const star = side.got.toSorted((a, b) => b.ws - a.ws)[0];
				if (!t || !star || star.ws < 2 || t.playoffRoundsWon < 1) {
					continue;
				}
				const s = e.t.season;
				const won = t.playoffRoundsWon >= X.numRounds(s);
				out.push({
					key: `${e.t.eid}|${side.tid}`,
					kind: "Deadline deal",
					shape: "playoffs",
					season: s,
					score: 10 + star.ws * 2 + t.playoffRoundsWon * 4 + (won ? 10 : 0),
					pids: [star.pid],
					tids: [side.tid],
					heads: [
						`${star.name} arrived midseason and the ${X.teamName(side.tid, s)} went deep`,
						`The in-season trade for ${star.name}`,
					],
					bodies: [
						`The ${tLink(X, side.tid, s)} traded for ${pLink(star)} during the ${s} season. He gave them ${ws1(star.ws)} win shares the rest of the way, and they won ${plural(t.playoffRoundsWon, "playoff round")}${won ? ", and the title" : ""}.`,
						timelineBody([
							[s, `the ${tLink(X, side.tid, s)} trade ${sideText(X, e, (1 - i) as 0 | 1)} for ${pLink(star)}`],
							["The rest of the season", `${ws1(star.ws)} win shares`],
							["The playoffs", won ? "champions" : `${plural(t.playoffRoundsWon, "round")} won`],
						]),
					],
					evidence: [
						["WS after the trade", ws1(star.ws)],
						["Playoff rounds won", `${t.playoffRoundsWon}`],
					],
				});
			}
		}
		return out;
	},
};

const blockbuster: Kind = {
	kind: "Blockbuster",
	find: (X) => {
		const out: Draft[] = [];
		for (const e of allEvals(X)) {
			if (e.size < 5) {
				continue;
			}
			const s = e.t.season;
			out.push({
				key: `${e.t.eid}`,
				kind: "Blockbuster",
				shape: "season",
				season: s,
				score: 8 + e.size * 3 + Math.min(20, e.sides[0].ws + e.sides[1].ws) / 2,
				pids: e.sides.flatMap((x) => x.got.map((g) => g.pid)).slice(0, 4),
				tids: [...e.t.tids],
				heads: [
					`${e.size} pieces in one trade`,
					`The ${X.teamName(e.t.tids[0], s)} and ${X.teamName(e.t.tids[1], s)} made a blockbuster`,
				],
				bodies: [
					`The ${tLink(X, e.t.tids[0], s)} got ${sideText(X, e, 0)}; the ${tLink(X, e.t.tids[1], s)} got ${sideText(X, e, 1)}. ${e.size} players and picks moved in one deal in ${s}.`,
					tapeBody(`One trade, ${e.size} pieces`, [
						[X.teamName(e.t.tids[0], s), sideText(X, e, 0)],
						[X.teamName(e.t.tids[1], s), sideText(X, e, 1)],
					]),
				],
				evidence: [
					["Assets", `${e.size}`],
					["Season", `${s}`],
				],
			});
		}
		return out;
	},
};

const starSwap: Kind = {
	kind: "Star swap",
	find: (X) => {
		const out: Draft[] = [];
		for (const e of allEvals(X)) {
			const stars = e.t.got.map((side) =>
				side
					.filter(isPlayerAsset)
					.map((a) => ({ a, l: X.line(a.pid, e.t.season) ?? X.line(a.pid, e.t.season - 1) }))
					.filter((x) => x.l && x.l.ws >= 7)
					.sort((a, b) => b.l!.ws - a.l!.ws)[0],
			);
			if (!stars[0] || !stars[1]) {
				continue;
			}
			const s = e.t.season;
			const [a, b] = [stars[0].a, stars[1].a];
			out.push({
				key: `${e.t.eid}`,
				kind: "Star swap",
				shape: "season",
				season: s,
				score: 15 + stars[0].l!.ws + stars[1].l!.ws,
				pids: [a.pid, b.pid],
				tids: [...e.t.tids],
				heads: [`${a.name} for ${b.name}`, `Two stars traded for each other`],
				bodies: [
					`In ${s} the ${tLink(X, e.t.tids[0], s)} and the ${tLink(X, e.t.tids[1], s)} swapped stars: ${pLink(a)} went one way, ${pLink(b)} the other. Afterwards, ${a.name} gave his new team ${ws1(e.sides[0].got.find((g) => g.pid === a.pid)?.ws ?? 0)} win shares and ${b.name} gave his ${ws1(e.sides[1].got.find((g) => g.pid === b.pid)?.ws ?? 0)}.`,
					tapeBody("Tale of the tape", [
						[a.name, `${ws1(e.sides[0].got.find((g) => g.pid === a.pid)?.ws ?? 0)} win shares for the ${X.teamName(e.t.tids[0], s)}`],
						[b.name, `${ws1(e.sides[1].got.find((g) => g.pid === b.pid)?.ws ?? 0)} win shares for the ${X.teamName(e.t.tids[1], s)}`],
					]),
				],
				evidence: [
					[a.name, `${ws1(stars[0].l!.ws)} WS before`],
					[b.name, `${ws1(stars[1].l!.ws)} WS before`],
				],
			});
		}
		return out;
	},
};

const partners: Kind = {
	kind: "Trading partners",
	find: (X) => {
		const by = new Map<string, TradeEval[]>();
		for (const e of allEvals(X)) {
			const k = [...e.t.tids].sort((a, b) => a - b).join("|");
			by.set(k, [...(by.get(k) ?? []), e]);
		}
		const out: Draft[] = [];
		for (const [k, list] of by) {
			if (list.length < 4) {
				continue;
			}
			const [a, b] = k.split("|").map(Number) as [number, number];
			const first = list[0]!.t.season;
			const last = list.at(-1)!.t.season;
			let netA = 0;
			for (const e of list) {
				const i = e.t.tids[0] === a ? 0 : 1;
				netA += e.sides[i].ws - e.sides[1 - i]!.ws;
			}
			const ahead = netA >= 0 ? a : b;
			out.push({
				key: k,
				kind: "Trading partners",
				shape: "team",
				season: last,
				span: [first, last],
				score: 8 + list.length * 4,
				pids: [],
				tids: [a, b],
				heads: [
					`The ${X.teamName(a, last)} and ${X.teamName(b, last)} keep calling each other`,
					`${list.length} trades between the same two teams`,
				],
				bodies: [
					`The ${tLink(X, a, last)} and the ${tLink(X, b, last)} made ${list.length} trades with each other from ${first} to ${last}. Adding them up, the ${tLink(X, ahead, last)} came out ${ws1(Math.abs(netA))} win shares ahead.`,
					timelineBody(
						list
							.toSorted((x, y) => x.t.season - y.t.season || x.t.eid - y.t.eid)
							.slice(0, 6)
							.map((e) => [e.t.season, `the ${X.teamName(e.t.tids[0], e.t.season)} got ${sideText(X, e, 0)}`]),
					),
				],
				evidence: [
					["Trades", `${list.length}`],
					["Seasons", span(first, last)],
					["Net", `${ws1(Math.abs(netA))} WS to the ${X.teamName(ahead, last)}`],
				],
			});
		}
		return out;
	},
};

const pickGotAway: Kind = {
	kind: "The pick that got away",
	find: (X) => {
		const out: Draft[] = [];
		for (const p of players(X)) {
			const orig = p.draftOriginalTid;
			if (orig === undefined || orig < 0 || orig === p.draft.tid || p.draft.round < 1) {
				continue;
			}
			const ws = careerWs(p, X.L.season);
			if (ws < 25) {
				continue;
			}
			const y = p.draft.year;
			const t = (X.L.trades ?? []).findLast(
				(x) => x.got.some((side) => side.some((a) => !isPlayerAsset(a) && a.dpid === p.draftDpid)),
			);
			out.push({
				key: `${p.pid}`,
				kind: "The pick that got away",
				shape: "career",
				season: y,
				span: [y, Math.min(X.L.season, p.retiredYear)],
				score: 10 + ws / 2,
				pids: [p.pid],
				tids: [orig, p.draft.tid],
				heads: [
					`The ${X.teamName(orig, y)} traded the pick that became ${p.name}`,
					`${p.name} came from someone else's pick`,
				],
				bodies: [
					`${pLink(p)} was drafted ${ordinal(p.draft.pick)}${p.draft.round > 1 ? ` in round ${p.draft.round}` : ""} in ${y} by the ${tLink(X, p.draft.tid, y)} with a pick that had belonged to the ${tLink(X, orig, y)}${t ? `, traded away in ${t.season}` : ""}. He has ${ws1(ws)} career win shares.`,
					timelineBody([
						...(t ? ([[t.season, `the ${X.teamName(orig, t.season)} trade the pick`]] as [number, string][]) : []),
						[y, `the ${tLink(X, p.draft.tid, y)} use it on ${pLink(p)}`],
						["Since", `${ws1(ws)} win shares`],
					]),
				],
				evidence: [
					["Pick", `${p.draft.round > 1 ? `R${p.draft.round} ` : ""}#${p.draft.pick}, ${y}`],
					["Original owner", X.teamName(orig, y)],
					["Career WS", ws1(ws)],
				],
			});
		}
		return out;
	},
};

const twiceInAYear: Kind = {
	kind: "Traded twice in a year",
	find: (X) => {
		const out: Draft[] = [];
		const by = new Map<string, TradeEval[]>();
		for (const e of allEvals(X)) {
			for (const side of e.t.got) {
				for (const a of side) {
					if (isPlayerAsset(a)) {
						const k = `${a.pid}|${e.t.season}`;
						by.set(k, [...(by.get(k) ?? []), e]);
					}
				}
			}
		}
		for (const [k, list] of by) {
			if (list.length < 2) {
				continue;
			}
			const [pid, s] = k.split("|").map(Number) as [number, number];
			const p = pFor(X, pid);
			if (!p) {
				continue;
			}
			const stops = list.map((e) => e.t.tids[e.t.got.findIndex((side) => side.some((a) => isPlayerAsset(a) && a.pid === pid))]!);
			out.push({
				key: k,
				kind: "Traded twice in a year",
				shape: "season",
				season: s,
				score: 10 + list.length * 6,
				pids: [pid],
				tids: stops,
				heads: [`${p.name} was traded ${list.length} times in ${s}`, `No time to unpack for ${p.name}`],
				bodies: [
					`${pLink(p)} was traded ${list.length} times in ${s}: to the ${stops.map((t) => tLink(X, t, s)).join(", then the ")}.`,
					timelineBody(list.map((e, j) => [s, `traded to the ${tLink(X, stops[j]!, s)}`])),
				],
				evidence: [
					["Trades", `${list.length}`],
					["Season", `${s}`],
				],
			});
		}
		return out;
	},
};

const pickHaul: Kind = {
	kind: "Pick haul",
	find: (X) => {
		const by = new Map<string, number>();
		for (const t of X.L.trades ?? []) {
			t.got.forEach((side, i) => {
				const n = side.filter((a) => !isPlayerAsset(a)).length;
				if (n > 0) {
					const k = `${t.tids[i]}|${t.season}`;
					by.set(k, (by.get(k) ?? 0) + n);
				}
			});
		}
		const out: Draft[] = [];
		for (const [k, n] of by) {
			if (n < 3) {
				continue;
			}
			const [tid, s] = k.split("|").map(Number) as [number, number];
			out.push({
				key: k,
				kind: "Pick haul",
				shape: "team",
				season: s,
				score: 6 + n * 4,
				pids: [],
				tids: [tid],
				heads: [`The ${X.teamName(tid, s)} collected ${n} draft picks in ${s}`, `Building through the draft: the ${X.teamName(tid, s)}`],
				bodies: [
					`The ${tLink(X, tid, s)} took in ${n} draft picks by trade in ${s}.`,
					qaBody([
						["How many picks?", `${n}, all by trade.`],
						["When?", `In ${s}.`],
					]),
				],
				evidence: [["Picks acquired", `${n}`]],
			});
		}
		return out;
	},
};

const tradeBait: Kind = {
	kind: "Trade bait",
	find: (X) => {
		const n = new Map<number, number[]>();
		for (const t of X.L.trades ?? []) {
			for (const side of t.got) {
				for (const a of side) {
					if (isPlayerAsset(a)) {
						n.set(a.pid, [...(n.get(a.pid) ?? []), t.season]);
					}
				}
			}
		}
		const out: Draft[] = [];
		for (const [pid, seasons] of n) {
			const p = pFor(X, pid);
			if (!p || seasons.length < 4) {
				continue;
			}
			out.push({
				key: `${pid}`,
				kind: "Trade bait",
				shape: "career",
				season: seasons.at(-1)!,
				span: [seasons[0]!, seasons.at(-1)!],
				score: 6 + seasons.length * 5,
				pids: [pid],
				tids: [],
				heads: [`${p.name} has been traded ${seasons.length} times`, `Always in the deal: ${p.name}`],
				bodies: [
					`${pLink(p)} was traded ${seasons.length} times between ${seasons[0]} and ${seasons.at(-1)}.`,
					timelineBody(seasons.map((s) => [s, "traded"])),
				],
				evidence: [["Trades", `${seasons.length}`]],
			});
		}
		return out;
	},
};

const signedAndWon: Kind = {
	kind: "Signing that won a title",
	find: (X) => {
		const out: Draft[] = [];
		for (const r of contractRows(X, X.L.season)) {
			if (r.c.type !== "freeAgent" || r.tid === undefined) {
				continue;
			}
			const s = r.c.start;
			const c = X.decided(s) ? X.champion(s) : undefined;
			const l = X.line(r.p.pid, s);
			if (!c || c.tid !== r.tid || !l || l.tid !== r.tid || l.ws < 4) {
				continue;
			}
			out.push({
				key: `${r.p.pid}|${s}`,
				kind: "Signing that won a title",
				shape: "playoffs",
				season: s,
				score: 15 + l.ws * 2,
				pids: [r.p.pid],
				tids: [r.tid],
				heads: [`${r.p.name} signed, and the title followed`, `The free agent who finished the job`],
				bodies: [
					`${pLink(r.p)} signed with the ${tLink(X, r.tid, s)} for ${money(r.avg)} a year before the ${s} season, gave them ${ws1(l.ws)} win shares and won the title in his first year.`,
					timelineBody([
						[s - 1, `signs with the ${tLink(X, r.tid, s)}, ${money(r.avg)} a year`],
						[s, `${ws1(l.ws)} win shares, champions`],
					]),
				],
				evidence: [
					["Salary", money(r.avg)],
					["WS", ws1(l.ws)],
					["Title", `${s}`],
				],
			});
		}
		return out;
	},
};

// ---- Contracts --------------------------------------------------------------

const contractYear: Kind = {
	kind: "Contract-year breakout",
	find: (X) => {
		const out: Draft[] = [];
		for (const r of contractRows(X, X.L.season)) {
			const end = r.end;
			const next = r.p.contracts?.[r.i + 1];
			const now = X.line(r.p.pid, end);
			const prev = X.line(r.p.pid, end - 1);
			if (!next || r.c.ended || !now || !prev || !X.decided(end) || r.c.amounts.length < 2) {
				continue;
			}
			const d = now.ws - prev.ws;
			const nextAvg = sum(next.amounts) / next.amounts.length;
			if (d < 4 || nextAvg < r.avg * 1.4) {
				continue;
			}
			out.push({
				key: `${r.p.pid}|${end}`,
				kind: "Contract-year breakout",
				shape: "season",
				season: end,
				span: [end - 1, end + 1],
				score: 10 + d * 2 + (nextAvg / r.avg) * 2,
				pids: [r.p.pid],
				tids: [now.tid],
				heads: [`${r.p.name} timed his best year perfectly`, `A contract year that paid: ${r.p.name}`],
				bodies: [
					`In the last season of his deal, ${pLink(r.p)} went from ${ws1(prev.ws)} to ${ws1(now.ws)} win shares. His next contract paid ${money(nextAvg)} a year, up from ${money(r.avg)}.`,
					timelineBody([
						[end - 1, `${ws1(prev.ws)} win shares`],
						[end, `${ws1(now.ws)} win shares in the final year of his contract`],
						[next.start, `a new deal at ${money(nextAvg)} a year`],
					]),
				],
				evidence: [
					["WS jump", `+${ws1(d)}`],
					["Old deal", money(r.avg)],
					["New deal", money(nextAvg)],
				],
			});
		}
		return out;
	},
};

const paydayDip: Kind = {
	kind: "Payday dip",
	find: (X) => {
		const out: Draft[] = [];
		for (const r of contractRows(X, X.L.season)) {
			if (r.i === 0 || r.c.type === "rookie" || !X.decided(r.c.start)) {
				continue;
			}
			const old = r.p.contracts![r.i - 1]!;
			const oldAvg = sum(old.amounts) / old.amounts.length;
			const now = X.line(r.p.pid, r.c.start);
			const prev = X.line(r.p.pid, r.c.start - 1);
			if (!now || !prev || r.avg < oldAvg * 1.5 || r.avg < 5000) {
				continue;
			}
			const d = prev.ws - now.ws;
			if (d < 4) {
				continue;
			}
			const s = r.c.start;
			out.push({
				key: `${r.p.pid}|${s}`,
				kind: "Payday dip",
				shape: "season",
				season: s,
				span: [s - 1, s],
				score: 8 + d * 2,
				pids: [r.p.pid],
				tids: [now.tid],
				heads: [`${r.p.name} got paid, then fell off`, `After the raise, a step back for ${r.p.name}`],
				bodies: [
					`${pLink(r.p)} went from ${money(oldAvg)} to ${money(r.avg)} a year in ${s}, and from ${ws1(prev.ws)} win shares to ${ws1(now.ws)}.`,
					qaBody([
						["How big was the raise?", `${money(oldAvg)} to ${money(r.avg)} a year.`],
						["And the production?", `${ws1(prev.ws)} win shares the year before, ${ws1(now.ws)} after.`],
					]),
				],
				evidence: [
					["Raise", `${money(oldAvg)} → ${money(r.avg)}`],
					["WS", `${ws1(prev.ws)} → ${ws1(now.ws)}`],
				],
			});
		}
		return out;
	},
};

const bigBoard = (X: LeagueIndex) =>
	X.cached("sl|deals|big", () => {
		const list = contractRows(X, X.L.season).filter((r) => r.c.amounts.length >= 3 && r.end <= X.L.season && r.seasons > 0);
		const avgs = list.map((r) => r.avg).sort((a, b) => b - a);
		return { list, cut: avgs[Math.floor(avgs.length / 10)] ?? Infinity, mid: avgs[Math.floor(avgs.length / 2)] ?? 0 };
	});

const bargain: Kind = {
	kind: "Bargain deal",
	find: (X) => {
		const { list, mid } = bigBoard(X);
		const out: Draft[] = [];
		for (const r of list) {
			const per = r.ws / r.seasons;
			if (r.avg > mid || per < 7) {
				continue;
			}
			out.push({
				key: `${r.p.pid}|${r.c.start}`,
				kind: "Bargain deal",
				shape: "career",
				season: r.playedTo,
				span: [r.c.start, r.playedTo],
				score: 8 + per * 2,
				pids: [r.p.pid],
				tids: r.tid !== undefined ? [r.tid] : [],
				heads: [`${r.p.name}'s contract was a steal`, `${ws1(r.ws)} win shares for ${money(r.total)}`],
				bodies: [
					`${pLink(r.p)} played ${span(r.c.start, r.playedTo)} on a ${money(r.avg)}-a-year contract and gave ${ws1(r.ws)} win shares, ${ws1(per)} a season.`,
					tapeBody("The deal", [
						["Cost", `${money(r.total)} over ${plural(r.c.amounts.length, "season")}`],
						["Return", `${ws1(r.ws)} win shares`],
					]),
				],
				evidence: [
					["Salary", money(r.avg)],
					["WS per season", ws1(per)],
				],
			});
		}
		return out;
	},
};

const albatross: Kind = {
	kind: "Albatross contract",
	find: (X) => {
		const { list, cut } = bigBoard(X);
		const out: Draft[] = [];
		for (const r of list) {
			const per = r.ws / r.seasons;
			if (r.avg < cut || per > 2) {
				continue;
			}
			out.push({
				key: `${r.p.pid}|${r.c.start}`,
				kind: "Albatross contract",
				shape: "career",
				season: r.playedTo,
				span: [r.c.start, r.playedTo],
				score: 8 + r.total / 10000 - per * 2,
				pids: [r.p.pid],
				tids: r.tid !== undefined ? [r.tid] : [],
				heads: [`${r.p.name}'s deal never paid off`, `${money(r.total)} for ${ws1(r.ws)} win shares`],
				bodies: [
					`${pLink(r.p)} signed for ${money(r.avg)} a year starting in ${r.c.start}${r.tid !== undefined ? ` with the ${tLink(X, r.tid, r.c.start)}` : ""}, one of the biggest deals of the league, and produced ${ws1(r.ws)} win shares over ${plural(r.seasons, "season")} on it.`,
					qaBody([
						["What did it cost?", `${money(r.total)} over ${plural(r.c.amounts.length, "season")}.`],
						["What did it buy?", `${ws1(r.ws)} win shares.`],
					]),
				],
				evidence: [
					["Salary", money(r.avg)],
					["WS on the deal", ws1(r.ws)],
				],
			});
		}
		return out;
	},
};

const deadMoney: Kind = {
	kind: "Dead money",
	find: (X) => {
		const out: Draft[] = [];
		for (const r of releases(X, X.L.season)) {
			if (r.owed < 15000) {
				continue;
			}
			out.push({
				key: `${r.p.pid}|${r.season}`,
				kind: "Dead money",
				shape: "team",
				season: r.season,
				span: [r.season, r.season + Math.max(0, r.yearsLeft)],
				score: 6 + r.owed / 3000,
				pids: [r.p.pid],
				tids: [r.tid],
				heads: [`The ${X.teamName(r.tid, r.season)} paid ${r.p.name} to go away`, `${money(r.owed)} for a player no longer there`],
				bodies: [
					`The ${tLink(X, r.tid, r.season)} released ${pLink(r.p)} in ${r.season} with ${money(r.owed)} still to pay over ${plural(r.yearsLeft, "season")}.`,
				],
				evidence: [
					["Owed", money(r.owed)],
					["Seasons left", `${r.yearsLeft}`],
				],
			});
		}
		return out;
	},
};

const cutAndThrived: Kind = {
	kind: "Cut and thrived",
	find: (X) => {
		const out: Draft[] = [];
		for (const r of releases(X, X.L.season)) {
			const after = r.p.stats.filter((x) => x.season > r.season && x.tid !== r.tid && x.gp > 0);
			const best = after.toSorted((a, b) => b.ws - a.ws)[0];
			if (!best || best.ws < 5 || !X.decided(best.season)) {
				continue;
			}
			out.push({
				key: `${r.p.pid}|${r.season}`,
				kind: "Cut and thrived",
				shape: "career",
				season: best.season,
				span: [r.season, best.season],
				score: 8 + best.ws * 2,
				pids: [r.p.pid],
				tids: [r.tid, best.tid],
				heads: [`Released, then a ${ws1(best.ws)}-win-share season: ${r.p.name}`, `The ${X.teamName(r.tid, r.season)} gave up on ${r.p.name} too soon`],
				bodies: [
					`The ${tLink(X, r.tid, r.season)} released ${pLink(r.p)} in ${r.season}. In ${best.season} he gave the ${tLink(X, best.tid, best.season)} ${ws1(best.ws)} win shares.`,
					timelineBody([
						[r.season, `released by the ${tLink(X, r.tid, r.season)}`],
						[best.season, `${ws1(best.ws)} win shares for the ${tLink(X, best.tid, best.season)}`],
					]),
				],
				evidence: [
					["Released", `${r.season}`],
					["Best season after", `${best.season}, ${ws1(best.ws)} WS`],
				],
			});
		}
		return out;
	},
};

const loyal: Kind = {
	kind: "Signed again and again",
	find: (X) => {
		const out: Draft[] = [];
		for (const p of players(X)) {
			const by = new Map<number, number[]>();
			for (const c of p.contracts ?? []) {
				if (c.type === "reSign" && c.tid !== undefined) {
					by.set(c.tid, [...(by.get(c.tid) ?? []), c.start]);
				}
			}
			for (const [tid, starts] of by) {
				if (starts.length < 3) {
					continue;
				}
				out.push({
					key: `${p.pid}|${tid}`,
					kind: "Signed again and again",
					shape: "career",
					season: starts.at(-1)!,
					span: [starts[0]!, starts.at(-1)!],
					score: 6 + starts.length * 5,
					pids: [p.pid],
					tids: [tid],
					heads: [`${p.name} kept re-signing with the ${X.teamName(tid, starts.at(-1)!)}`],
					bodies: [
						`${pLink(p)} re-signed with the ${tLink(X, tid, starts.at(-1)!)} ${starts.length} times, with new deals starting in ${starts.join(", ")}.`,
						timelineBody(starts.map((s) => [s, "a new deal with the same team"])),
					],
					evidence: [["Re-signings", `${starts.length}`]],
				});
			}
		}
		return out;
	},
};

const rookieDealStar: Kind = {
	kind: "Rookie-deal star",
	find: (X) => {
		const out: Draft[] = [];
		for (const r of contractRows(X, X.L.season)) {
			if (r.c.type !== "rookie" || r.ws < 25) {
				continue;
			}
			out.push({
				key: `${r.p.pid}`,
				kind: "Rookie-deal star",
				shape: "career",
				season: r.playedTo,
				span: [r.c.start, r.playedTo],
				score: 8 + r.ws / 2,
				pids: [r.p.pid],
				tids: r.tid !== undefined ? [r.tid] : [],
				heads: [`${r.p.name} was a star on a rookie contract`, `${ws1(r.ws)} win shares before his first big deal`],
				bodies: [
					`On his rookie deal (${money(r.total)} in all), ${pLink(r.p)} produced ${ws1(r.ws)} win shares from ${span(r.c.start, r.playedTo)}.`,
				],
				evidence: [
					["Rookie deal", money(r.total)],
					["WS", ws1(r.ws)],
				],
			});
		}
		return out;
	},
};

const spree: Kind = {
	kind: "Spending spree",
	find: (X) => {
		const by = new Map<string, { n: number; total: number; ws: number }>();
		for (const r of contractRows(X, X.L.season)) {
			if (r.c.type !== "freeAgent" || r.tid === undefined) {
				continue;
			}
			const k = `${r.tid}|${r.c.start}`;
			const cur = by.get(k) ?? { n: 0, total: 0, ws: 0 };
			cur.n += 1;
			cur.total += r.avg;
			cur.ws += X.line(r.p.pid, r.c.start)?.tid === r.tid ? (X.line(r.p.pid, r.c.start)?.ws ?? 0) : 0;
			by.set(k, cur);
		}
		const out: Draft[] = [];
		for (const [k, v] of by) {
			const [tid, s] = k.split("|").map(Number) as [number, number];
			const before = winsIn(X, tid, s - 1);
			const after = winsIn(X, tid, s);
			if (v.n < 3 || v.total < 30000 || before === undefined || after === undefined || !X.decided(s)) {
				continue;
			}
			const d = after - before;
			out.push({
				key: k,
				kind: "Spending spree",
				shape: "team",
				season: s,
				score: 6 + v.total / 5000 + Math.abs(d) / 2,
				pids: [],
				tids: [tid],
				heads: [
					d >= 0
						? `The ${X.teamName(tid, s)} spent big and it worked`
						: `The ${X.teamName(tid, s)} spent big and got worse`,
				],
				bodies: [
					`The ${tLink(X, tid, s)} signed ${v.n} free agents for ${money(v.total)} a year before ${s}. They gave ${ws1(v.ws)} win shares, and the team went from ${plural(before, "win")} to ${after}.`,
					qaBody([
						["How much?", `${money(v.total)} a year for ${v.n} free agents.`],
						["Did it work?", `${plural(before, "win")} became ${after}.`],
					]),
				],
				evidence: [
					["Signings", `${v.n}`],
					["Per year", money(v.total)],
					["Wins", `${before} → ${after}`],
				],
			});
		}
		return out;
	},
};

// ---- Lottery and draft ------------------------------------------------------

const lotteryLuck: Kind = {
	kind: "Lottery luck",
	find: (X) => {
		const out: Draft[] = [];
		for (const r of lotteryRows(X)) {
			if (r.jump < 3 && !(r.pick === 1 && r.slot >= 3)) {
				continue;
			}
			const p = draftClass(X, r.season).find((x) => x.draft.round === 1 && x.draft.pick === r.pick && x.draft.tid === r.tid);
			const ws = p ? careerWs(p, X.L.season) : 0;
			out.push({
				key: `${r.season}|${r.tid}`,
				kind: "Lottery luck",
				shape: "season",
				season: r.season,
				score: 6 + r.jump * 4 + (r.pick === 1 ? 8 : 0) + ws / 5,
				pids: p ? [p.pid] : [],
				tids: [r.tid],
				heads: [`The ${X.teamName(r.tid, r.season)} jumped from #${r.slot} to #${r.pick}`, `Lottery night belonged to the ${X.teamName(r.tid, r.season)}`],
				bodies: [
					`The ${tLink(X, r.tid, r.season)} went into the ${r.season} lottery at #${r.slot} and came out with the #${r.pick} pick${p ? `, which they used on ${pLink(p)} (${ws1(ws)} career win shares so far)` : ""}.`,
					timelineBody([
						[r.season, `the ${tLink(X, r.tid, r.season)} enter the lottery at #${r.slot}`],
						["Lottery night", `they get #${r.pick}`],
						...(p ? ([["Draft night", `they take ${pLink(p)}`]] as [string, string][]) : []),
					]),
				],
				evidence: [
					["Before", `#${r.slot}`],
					["After", `#${r.pick}`],
				],
			});
		}
		return out;
	},
};

const lotteryHeartbreak: Kind = {
	kind: "Lottery heartbreak",
	find: (X) => {
		const out: Draft[] = [];
		for (const r of lotteryRows(X)) {
			if (r.jump > -3) {
				continue;
			}
			out.push({
				key: `${r.season}|${r.tid}`,
				kind: "Lottery heartbreak",
				shape: "season",
				season: r.season,
				score: 6 - r.jump * 4,
				pids: [],
				tids: [r.tid],
				heads: [`The ${X.teamName(r.tid, r.season)} fell from #${r.slot} to #${r.pick}`, `Bad luck on lottery night for the ${X.teamName(r.tid, r.season)}`],
				bodies: [
					`The ${tLink(X, r.tid, r.season)} had the #${r.slot} spot going into the ${r.season} lottery and left with the #${r.pick} pick.`,
				],
				evidence: [
					["Before", `#${r.slot}`],
					["After", `#${r.pick}`],
				],
			});
		}
		return out;
	},
};

const classRanks = (X: LeagueIndex, year: number) =>
	X.cached(`sl|deals|cls|${year}`, () => {
		const cls = draftClass(X, year);
		const ws = cls.map((p) => ({ p, ws: careerWs(p, X.L.season) })).sort((a, b) => b.ws - a.ws || a.p.pid - b.p.pid);
		return ws.map((x, i) => ({ ...x, rank: i + 1, pick: overallPick(X, x.p) }));
	});

const draftBust: Kind = {
	kind: "Draft bust",
	find: (X) => {
		const out: Draft[] = [];
		for (const p of players(X)) {
			if (p.draft.round !== 1 || p.draft.pick > 3 || p.draft.year > X.L.season - 5) {
				continue;
			}
			const cls = classRanks(X, p.draft.year);
			const me = cls.find((x) => x.p === p);
			if (!me || cls.length < 8 || me.ws > 8 || me.rank <= cls.length / 3) {
				continue;
			}
			const top = cls[0]!;
			const y = p.draft.year;
			out.push({
				key: `${p.pid}`,
				kind: "Draft bust",
				shape: "career",
				season: y,
				span: [y, Math.min(X.L.season, p.retiredYear)],
				score: 8 + (4 - p.draft.pick) * 4 + top.ws / 6,
				pids: [p.pid, top.p.pid],
				tids: [p.draft.tid],
				heads: [`${p.name} went No. ${p.draft.pick} and never delivered`, `The ${y} draft: ${p.name} at No. ${p.draft.pick}`],
				bodies: [
					`The ${tLink(X, p.draft.tid, y)} took ${pLink(p)} with the No. ${p.draft.pick} pick in ${y}. He has ${ws1(me.ws)} career win shares, ${ordinal(me.rank)} in his class; ${pLink(top.p)}, taken ${ordinal(top.pick)}, leads it with ${ws1(top.ws)}.`,
					tapeBody(`The ${y} draft`, [
						[`${p.name}, pick ${me.pick}`, `${ws1(me.ws)} win shares`],
						[`${top.p.name}, pick ${top.pick}`, `${ws1(top.ws)} win shares`],
					]),
				],
				evidence: [
					["Pick", `#${p.draft.pick}, ${y}`],
					["Career WS", ws1(me.ws)],
					["Class rank", `${me.rank} of ${cls.length}`],
				],
			});
		}
		return out;
	},
};

const draftSteal: Kind = {
	kind: "Draft steal",
	find: (X) => {
		const out: Draft[] = [];
		const years = [...new Set(players(X).map((p) => p.draft.year))].filter((y) => y <= X.L.season - 3);
		for (const y of years) {
			const cls = classRanks(X, y);
			if (cls.length < 8) {
				continue;
			}
			for (const x of cls.slice(0, 2)) {
				if (x.pick - x.rank < 10 || x.ws < 15) {
					continue;
				}
				out.push({
					key: `${x.p.pid}`,
					kind: "Draft steal",
					shape: "career",
					season: y,
					span: [y, Math.min(X.L.season, x.p.retiredYear)],
					score: 8 + (x.pick - x.rank) + x.ws / 4,
					pids: [x.p.pid],
					tids: [x.p.draft.tid],
					heads: [`${x.p.name}: picked ${ordinal(x.pick)}, ${x.rank === 1 ? "the best" : `${ordinal(x.rank)}-best`} of his class`, `${x.pick - 1} picks before ${x.p.name}`],
					bodies: [
						`${pLink(x.p)} was the ${ordinal(x.pick)} pick of the ${y} draft, by the ${tLink(X, x.p.draft.tid, y)}. With ${ws1(x.ws)} career win shares he ranks ${ordinal(x.rank)} in the class.`,
						qaBody([
							["Where was he picked?", `${ordinal(x.pick)}, in ${y}.`],
							["Where would he go now?", `${ordinal(x.rank)}, by career win shares.`],
						]),
					],
					evidence: [
						["Pick", `${x.pick}`],
						["Class rank", `${x.rank}`],
						["Career WS", ws1(x.ws)],
					],
				});
			}
		}
		return out;
	},
};

const passedOver: Kind = {
	kind: "The one they passed on",
	find: (X) => {
		const out: Draft[] = [];
		const years = [...new Set(players(X).map((p) => p.draft.year))].filter((y) => y <= X.L.season - 4);
		for (const y of years) {
			const cls = classRanks(X, y);
			const no1 = cls.find((x) => x.pick === 1);
			const top = cls[0];
			if (!no1 || !top || top === no1 || top.ws < 20 || top.ws < no1.ws * 2) {
				continue;
			}
			out.push({
				key: `${y}`,
				kind: "The one they passed on",
				shape: "season",
				season: y,
				span: [y, X.L.season],
				score: 8 + (top.ws - no1.ws) / 3,
				pids: [no1.p.pid, top.p.pid],
				tids: [no1.p.draft.tid],
				heads: [`The ${X.teamName(no1.p.draft.tid, y)} took ${no1.p.name} over ${top.p.name}`, `The ${y} draft, redone`],
				bodies: [
					`With the first pick in ${y}, the ${tLink(X, no1.p.draft.tid, y)} took ${pLink(no1.p)} (${ws1(no1.ws)} career win shares). ${pLink(top.p)}, the ${ordinal(top.pick)} pick, has ${ws1(top.ws)}.`,
					tapeBody(`The ${y} draft`, [
						[`No. 1, ${no1.p.name}`, `${ws1(no1.ws)} win shares`],
						[`No. ${top.pick}, ${top.p.name}`, `${ws1(top.ws)} win shares`],
					]),
				],
				evidence: [
					[no1.p.name, ws1(no1.ws)],
					[top.p.name, ws1(top.ws)],
				],
			});
		}
		return out;
	},
};

// ---- Franchises -------------------------------------------------------------

const relocation: Kind = {
	kind: "Relocation",
	find: (X) => {
		const out: Draft[] = [];
		const tids = [...new Set(X.L.teamSeasons.map((t) => t.tid))];
		for (const tid of tids) {
			const rows = X.L.teamSeasons.filter((t) => t.tid === tid).sort((a, b) => a.season - b.season);
			for (let i = 1; i < rows.length; i++) {
				const a = rows[i - 1]!;
				const b = rows[i]!;
				if (a.region === b.region && a.name === b.name) {
					continue;
				}
				const moved = a.region !== b.region;
				const before = rows.slice(Math.max(0, i - 3), i);
				const after = rows.slice(i, i + 3);
				const wp = (xs: typeof rows) => {
					const w = sum(xs.map((x) => x.won));
					const l = sum(xs.map((x) => x.lost));
					return w + l > 0 ? w / (w + l) : 0;
				};
				out.push({
					key: `${tid}|${b.season}`,
					kind: "Relocation",
					shape: "team",
					season: b.season,
					span: [before[0]!.season, after.at(-1)!.season],
					score: moved ? 25 : 15,
					pids: [],
					tids: [tid],
					heads: moved
						? [`The ${a.region} ${a.name} moved to ${b.region}`, `A new home: the ${b.region} ${b.name}`]
						: [`The ${a.region} ${a.name} became the ${b.region} ${b.name}`, `New name in ${b.region}`],
					bodies: [
						moved
							? `After ${a.season}, the ${a.region} ${a.name} left for ${b.region} and became the ${tLink(X, tid, b.season)}. They won ${fmtNum(wp(before) * 100, 0)}% of their games in their last seasons in ${a.region} and ${fmtNum(wp(after) * 100, 0)}% in their first in ${b.region}.`
							: `In ${b.season} the ${a.region} ${a.name} took a new name: the ${tLink(X, tid, b.season)}.`,
						timelineBody([
							[a.season, `last season as the ${a.region} ${a.name}, ${a.won}-${a.lost}`],
							[b.season, `first season as the ${tLink(X, tid, b.season)}, ${b.won}-${b.lost}`],
						]),
					],
					evidence: [
						["Before", `${a.region} ${a.name}`],
						["After", `${b.region} ${b.name}`],
						["Season", `${b.season}`],
					],
				});
			}
		}
		return out;
	},
};

const stillPaying: Kind = {
	kind: "Still paying",
	find: (X) => {
		const by = new Map<string, { owed: number; names: WPlayer[] }>();
		for (const r of releases(X, X.L.season)) {
			for (let s = r.season + 1; s < r.c.start + r.c.amounts.length; s++) {
				const amt = r.c.amounts[s - r.c.start] ?? 0;
				const k = `${r.tid}|${s}`;
				const cur = by.get(k) ?? { owed: 0, names: [] };
				cur.owed += amt;
				if (!cur.names.includes(r.p)) {
					cur.names.push(r.p);
				}
				by.set(k, cur);
			}
		}
		const out: Draft[] = [];
		for (const [k, v] of by) {
			const [tid, s] = k.split("|").map(Number) as [number, number];
			if (v.names.length < 2 || v.owed < 10000 || s > X.L.season) {
				continue;
			}
			out.push({
				key: k,
				kind: "Still paying",
				shape: "team",
				season: s,
				score: 5 + v.owed / 2500,
				pids: v.names.map((p) => p.pid),
				tids: [tid],
				heads: [`The ${X.teamName(tid, s)} paid ${money(v.owed)} to players they had cut`],
				bodies: [
					`In ${s} the ${tLink(X, tid, s)} still owed ${money(v.owed)} to ${plural(v.names.length, "released player")}: ${v.names.map(pLink).join(", ")}.`,
				],
				evidence: [
					["Dead money", money(v.owed)],
					["Players", `${v.names.length}`],
				],
			});
		}
		return out;
	},
};

const builtByTrade: Kind = {
	kind: "Champion built by trade",
	find: (X) => {
		const out: Draft[] = [];
		for (const s of X.decidedSeasons()) {
			const c = X.champion(s);
			if (!c) {
				continue;
			}
			const lines = X.lines(s).filter((l) => l.tid === c.tid && l.ws > 0);
			const total = sum(lines.map((l) => l.ws));
			const viaTrade = lines.filter((l) => {
				const p = pFor(X, l.pid)!;
				const last = p.moves.findLast((m) => m.tid === c.tid && m.season <= s);
				return last?.type === "trade";
			});
			const ws = sum(viaTrade.map((l) => l.ws));
			if (total <= 0 || viaTrade.length < 3 || ws / total < 0.5) {
				continue;
			}
			out.push({
				key: `${s}`,
				kind: "Champion built by trade",
				shape: "playoffs",
				season: s,
				score: 10 + (ws / total) * 30,
				pids: viaTrade.map((l) => l.pid).slice(0, 4),
				tids: [c.tid],
				heads: [`The ${s} champions were built by trade`, `Traded for, then champions`],
				bodies: [
					`${fmtNum((ws / total) * 100, 0)}% of the win shares of the ${s} champion ${tLink(X, c.tid, s)} came from players they had traded for: ${viaTrade.slice(0, 4).map((l) => pLink(l)).join(", ")}.`,
				],
				evidence: [
					["From trades", `${fmtNum((ws / total) * 100, 0)}%`],
					["Players", `${viaTrade.length}`],
				],
			});
		}
		return out;
	},
};

const homegrownChamp: Kind = {
	kind: "Homegrown champion",
	find: (X) => {
		const out: Draft[] = [];
		for (const s of X.decidedSeasons()) {
			const c = X.champion(s);
			if (!c) {
				continue;
			}
			const lines = X.lines(s).filter((l) => l.tid === c.tid && l.ws > 0);
			const total = sum(lines.map((l) => l.ws));
			const own = lines.filter((l) => pFor(X, l.pid)!.draft.tid === c.tid);
			const ws = sum(own.map((l) => l.ws));
			if (total <= 0 || own.length < 3 || ws / total < 0.6) {
				continue;
			}
			out.push({
				key: `${s}`,
				kind: "Homegrown champion",
				shape: "playoffs",
				season: s,
				score: 10 + (ws / total) * 30,
				pids: own.map((l) => l.pid).slice(0, 4),
				tids: [c.tid],
				heads: [`The ${s} champions drafted their own`, `A title built through the draft`],
				bodies: [
					`The ${s} champion ${tLink(X, c.tid, s)} got ${fmtNum((ws / total) * 100, 0)}% of their win shares from players they drafted: ${own.slice(0, 4).map((l) => pLink(l)).join(", ")}.`,
				],
				evidence: [
					["From own picks", `${fmtNum((ws / total) * 100, 0)}%`],
					["Players", `${own.length}`],
				],
			});
		}
		return out;
	},
};

const tradedBeforeBreakout: Kind = {
	kind: "Traded before the breakout",
	find: (X) => {
		const out: Draft[] = [];
		for (const e of allEvals(X)) {
			for (const i of [0, 1] as const) {
				for (const g of e.sides[i].got) {
					const p = pFor(X, g.pid);
					if (!p || g.pick) {
						continue;
					}
					const before = X.line(g.pid, e.at - 1);
					const best = Math.max(0, ...p.stats.filter((r) => r.season >= e.at && r.tid === e.sides[i].tid && X.decided(r.season)).map((r) => r.ws));
					if (!before || before.ws > 4 || best < 10) {
						continue;
					}
					const from = e.t.tids[1 - i]!;
					out.push({
						key: `${e.t.eid}|${g.pid}`,
						kind: "Traded before the breakout",
						shape: "career",
						season: e.t.season,
						span: [e.t.season, Math.max(...g.seasons, e.t.season)],
						score: 10 + best * 2,
						pids: [g.pid],
						tids: [from, e.sides[i].tid],
						heads: [`The ${X.teamName(from, e.t.season)} traded ${p.name} just before he took off`],
						bodies: [
							`${pLink(p)} had ${ws1(before.ws)} win shares the season before the ${tLink(X, from, e.t.season)} traded him to the ${tLink(X, e.sides[i].tid, e.t.season)} in ${e.t.season}. With his new team he had a season of ${ws1(best)}.`,
						],
						evidence: [
							["Before", `${ws1(before.ws)} WS`],
							["Best after", `${ws1(best)} WS`],
						],
					});
				}
			}
		}
		return out;
	},
};

const draftedTradedBack: Kind = {
	kind: "Drafted, traded, back again",
	find: (X) => {
		const out: Draft[] = [];
		for (const p of players(X)) {
			const tid = p.draft.tid;
			if (p.draft.round < 1 || tid < 0) {
				continue;
			}
			const away = p.moves.find((m) => m.type === "trade" && m.fromTid === tid);
			const back = away ? p.moves.find((m) => m.tid === tid && m.season > away.season && m.type !== "draft") : undefined;
			if (!away || !back) {
				continue;
			}
			const ws = stintFor(p, tid, back.season, X.L.season).ws;
			out.push({
				key: `${p.pid}`,
				kind: "Drafted, traded, back again",
				shape: "career",
				season: back.season,
				span: [p.draft.year, back.season],
				score: 8 + ws,
				pids: [p.pid],
				tids: [tid],
				heads: [`${p.name} found his way back to the team that drafted him`],
				bodies: [
					`${pLink(p)} was drafted by the ${tLink(X, tid, p.draft.year)} in ${p.draft.year}, traded away in ${away.season} and back with them in ${back.season}.`,
					timelineBody([
						[p.draft.year, `drafted by the ${tLink(X, tid, p.draft.year)}`],
						[away.season, `traded to the ${tLink(X, away.tid, away.season)}`],
						[back.season, `back with the ${tLink(X, tid, back.season)}`],
					]),
				],
				evidence: [
					["Drafted", `${p.draft.year}`],
					["Traded", `${away.season}`],
					["Back", `${back.season}`],
				],
			});
		}
		return out;
	},
};

export const DEAL_KINDS: Kind[] = [
	lopsided,
	salaryDump,
	deadlineDeal,
	blockbuster,
	starSwap,
	partners,
	pickGotAway,
	twiceInAYear,
	pickHaul,
	tradeBait,
	signedAndWon,
	contractYear,
	paydayDip,
	bargain,
	albatross,
	deadMoney,
	cutAndThrived,
	loyal,
	rookieDealStar,
	spree,
	lotteryLuck,
	lotteryHeartbreak,
	draftBust,
	draftSteal,
	passedOver,
	relocation,
	stillPaying,
	builtByTrade,
	homegrownChamp,
	tradedBeforeBreakout,
	draftedTradedBack,
];
