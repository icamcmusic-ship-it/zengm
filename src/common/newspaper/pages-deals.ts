// Front-office pages: trade analysis and the deadline ledger, the contract tracker, the release wire, lottery night, draft night, the rookie report, the summer's movers; and the season preview pages that need no games (rosters ranked by ratings, player profiles, positions, roster ages). Several open with a plain sentence that the variation pass (vary.ts) knows how to rewrite.

import { Ctx, P } from "./ctx.ts";
import {
	ALL_EDS,
	PLAYED,
	PRE_ONLY,
	addPage,
	arcPage,
	table,
} from "./kit.ts";
import { andList, fmt1, money, plural, record, signed } from "./text.ts";
import type { NPPlayer, NPTrade, NPTradeAsset, Seg } from "./types.ts";

const ws = (a: NPTradeAsset) => (a.kind === "player" ? (a.ws ?? 0) : 0);
const sideWs = (side: NPTradeAsset[]) => side.reduce((x, a) => x + ws(a), 0);
const inSeason = (t: NPTrade) => t.phase >= 1 && t.phase <= 3;

const assetSegs = (c: Ctx, side: NPTradeAsset[]): Seg[] =>
	andList(
		side.map((a): Seg[] =>
			a.kind === "player"
				? [c.pl(a.pid, a.name)]
				: [
						`${typeof a.season === "number" ? `a ${a.season} ` : "a "}${a.round === 1 ? "first" : a.round === 2 ? "second" : `round-${a.round}`}-round pick`,
						c.team(a.originalTid) && a.originalTid !== undefined ? ` (${c.team(a.originalTid)!.abbrev})` : "",
					],
		),
	);

const assetText = (c: Ctx, side: NPTradeAsset[]) =>
	assetSegs(c, side)
		.map((s) => (typeof s === "string" ? s : s.t))
		.join("");

// ---- Deadline ledger -----------------------------------------------------------

addPage(
	arcPage<{ n: number; net: { tid: number; v: number; got: number; gave: number }[] }>({
		id: "deadline-ledger",
		section: "money",
		kicker: "Deadline ledger",
		eds: PLAYED,
		beat: "moves",
		prep: (c) => {
			const list = c.f.trades.filter(inSeason);
			if (list.length < 2 || !list.some((t) => t.got.flat().some((a) => a.kind === "player" && a.ws !== undefined))) {
				return undefined;
			}
			const by = new Map<number, { got: number; gave: number }>();
			for (const t of list) {
				for (const i of [0, 1] as const) {
					const tid = t.tids[i];
					const cur = by.get(tid) ?? { got: 0, gave: 0 };
					cur.got += sideWs(t.got[i]);
					cur.gave += sideWs(t.got[1 - i]!);
					by.set(tid, cur);
				}
			}
			const net = [...by]
				.map(([tid, v]) => ({ tid, v: v.got - v.gave, ...v }))
				.toSorted((a, b) => b.v - a.v || a.tid - b.tid);
			return { n: list.length, net };
		},
		arcs: [
			{
				id: "table",
				heads: (x, c) => [
					`The deadline ledger: the ${c.tn(x.net[0]!.tid)} ${c.T("lead", "came out on top")}`,
					`Who ${c.T("is winning", "won")} the in-season trades`,
					`${plural(x.n, "midseason deal")}, scored`,
				],
				build: (x, r, c) => [
					P(
						`${x.n} in-season trades were made. Measured by the win shares each team got from the players it received, minus what the players it sent away produced for their new team the rest of the season:`,
					),
					table(
						["Team", "Got", "Gave up", "Net"],
						x.net.map((y) => [[c.tl(y.tid, c.tfull(y.tid))], [fmt1(y.got)], [fmt1(y.gave)], [signed(y.v)]]),
						[1, 2, 3],
					),
				],
			},
			{
				id: "ends",
				fit: (x) => x.net.length >= 2 && x.net[0]!.v > 0 && x.net.at(-1)!.v < 0,
				heads: (x, c) => [
					`${c.tn(x.net[0]!.tid)} up, ${c.tn(x.net.at(-1)!.tid)} down at the deadline`,
					`The deadline's winner and loser`,
				],
				build: (x, r, c) => {
					const a = x.net[0]!;
					const b = x.net.at(-1)!;
					return [
						P("Two teams at opposite ends of the deadline ledger:"),
						{
							type: "tape",
							a: c.tfull(a.tid),
							b: c.tfull(b.tid),
							rows: [
								{ label: "Win shares received", a: fmt1(a.got), b: fmt1(b.got) },
								{ label: "Win shares sent away", a: fmt1(a.gave), b: fmt1(b.gave) },
								{ label: "Net", a: signed(a.v), b: signed(b.v) },
							],
						},
					];
				},
			},
		],
	}),
);

// ---- Trade analysis ----------------------------------------------------------------

addPage(
	arcPage<{ t: NPTrade; w: [number, number] }>({
		id: "trade-analysis",
		section: "money",
		kicker: "Trade analysis",
		eds: PLAYED,
		beat: "moves",
		size: "feature",
		prep: (c) => {
			const t = c.f.trades
				.filter((x) => x.got.flat().some((a) => a.kind === "player" && a.ws !== undefined))
				.toSorted((a, b) => sideWs(b.got[0]) + sideWs(b.got[1]) - (sideWs(a.got[0]) + sideWs(a.got[1])) || b.score - a.score)[0];
			return t ? { t, w: [sideWs(t.got[0]), sideWs(t.got[1])] } : undefined;
		},
		photo: (x) => {
			const a = x.t.got.flat().find((y) => y.kind === "player");
			return a?.kind === "player" ? a.pid : undefined;
		},
		arcs: [
			{
				id: "qa",
				heads: (x, c) => [
					`Trade analysis: ${c.tn(x.t.tids[0])} and ${c.tn(x.t.tids[1])}`,
					`Breaking down the ${c.tn(x.t.tids[0])}-${c.tn(x.t.tids[1])} deal`,
					`Who ${c.T("is winning", "won")} the ${c.tn(x.t.tids[0])}-${c.tn(x.t.tids[1])} trade?`,
				],
				build: (x, r, c) => {
					const [a, b] = x.t.tids;
					const lead = x.w[0] >= x.w[1] ? 0 : 1;
					return [
						P(`The `, c.tl(a, c.tfull(a)), ` got `, ...assetSegs(c, x.t.got[0]), `; the `, c.tl(b, c.tfull(b)), ` got `, ...assetSegs(c, x.t.got[1]), `.`),
						{
							type: "notebook",
							items: [
								{ lead: "When was it made?", segs: [inSeason(x.t) ? "During the season." : "Before the season."] },
								{
									lead: `Who ${c.T("is ahead", "came out ahead")}?`,
									segs: Math.abs(x.w[0] - x.w[1]) < 0.5
										? [`Neither side, so far: ${fmt1(x.w[0])} win shares to ${fmt1(x.w[1])}.`]
										: [`The `, c.tl(x.t.tids[lead]), `, ${fmt1(x.w[lead])} win shares to ${fmt1(x.w[1 - lead]!)} for what each side received.`],
								},
								{ lead: "What counts?", segs: ["Only win shares earned this season for the team that received the player; picks count once they are used."] },
							],
						},
					];
				},
			},
			{
				id: "tape",
				heads: (x, c) => [
					`Tale of the tape: the ${c.tn(x.t.tids[0])}-${c.tn(x.t.tids[1])} trade`,
					`One trade, two sides: ${c.tn(x.t.tids[0])} and ${c.tn(x.t.tids[1])}`,
				],
				build: (x, r, c) => [
					P(`Side by side, what each team ${c.T("has gotten", "got")} from the deal this season.`),
					{
						type: "tape",
						a: c.tfull(x.t.tids[0]),
						b: c.tfull(x.t.tids[1]),
						rows: [
							{ label: "Received", a: assetText(c, x.t.got[0]), b: assetText(c, x.t.got[1]) },
							{ label: "Win shares for them", a: fmt1(x.w[0]), b: fmt1(x.w[1]) },
							{ label: "Record", a: c.rec(x.t.tids[0]), b: c.rec(x.t.tids[1]) },
						],
					},
				],
			},
		],
	}),
);

// ---- Contract tracker -------------------------------------------------------------

const onBooks = (c: Ctx) =>
	c.f.players.filter((p) => p.contractAmount !== undefined && p.contractAmount > 0 && p.tid >= 0);

addPage(
	arcPage<{ books: NPPlayer[]; paid: NPPlayer[] }>({
		id: "contract-tracker",
		section: "money",
		kicker: "Contract tracker",
		eds: ALL_EDS,
		beat: "moves",
		prep: (c) => {
			const books = onBooks(c).toSorted((a, b) => b.contractAmount! - a.contractAmount! || a.pid - b.pid);
			if (books.length < 8 && c.f.signings.length < 4) {
				return undefined;
			}
			return { books, paid: books.filter((p) => p.gp > 0) };
		},
		photo: (x) => x.books[0]?.pid,
		arcs: [
			{
				id: "signed",
				fit: (x, c) => c.f.signings.length >= 4,
				heads: (x, c) => {
					const s = c.f.signings.toSorted((a, b) => b.amount - a.amount)[0]!;
					return [`${s.name} tops the new contracts at ${money(s.amount)}`, `The richest new deals`, `Four contracts that set the market`];
				},
				build: (x, r, c) => [
					P("The four largest contracts signed this season:"),
					{
						type: "list",
						ordered: true,
						items: c.f.signings
							.toSorted((a, b) => b.amount - a.amount || a.pid - b.pid)
							.slice(0, 4)
							.map((s): Seg[] => [c.pl(s.pid, s.name), `, `, c.tl(s.tid), `: ${money(s.amount)} a year through ${s.exp}${s.kind === "reSigned" ? " (re-signed)" : ""}`]),
					},
				],
			},
			{
				id: "books",
				fit: (x) => x.books.length >= 8,
				heads: (x, c) => [`The biggest contracts on the books`, `${x.books[0]!.name} and the league's richest deals`, `Who ${c.T("earns", "earned")} the most`],
				build: (x, r, c) => [
					P(`The ${Math.min(8, x.books.length)} biggest contracts on the books in ${c.season}:`),
					table(
						["Player", "Team", "Salary", "Through"],
						x.books.slice(0, 8).map((p) => [[c.pl(p.pid)], [c.tl(p.tid)], [money(p.contractAmount!)], [String(p.contractExp ?? "")]]),
						[2, 3],
					),
				],
			},
			{
				id: "value",
				fit: (x, c) => !c.pre && x.paid.filter((p) => p.contractAmount! >= 15000).length >= 3 && x.paid.length >= 10,
				heads: (x, c) => [`Bargain and burden, ${c.season}`, `The best and worst value among the paid`],
				build: (x, r, c) => {
					const per = (p: NPPlayer) => p.ws / (p.contractAmount! / 1000);
					const best = x.paid.toSorted((a, b) => per(b) - per(a) || a.pid - b.pid)[0]!;
					const worst = x.paid.filter((p) => p.contractAmount! >= 15000).toSorted((a, b) => per(a) - per(b) || a.pid - b.pid)[0]!;
					return [
						P(`The best-value contract of ${c.season} against the worst among big deals:`),
						{
							type: "tape",
							a: best.name,
							b: worst.name,
							rows: [
								{ label: "Salary", a: money(best.contractAmount!), b: money(worst.contractAmount!) },
								{ label: "Win shares", a: fmt1(best.ws), b: fmt1(worst.ws) },
								{ label: "Per $1M", a: fmt1(per(best)), b: fmt1(per(worst)) },
							],
						},
					];
				},
			},
			{
				id: "rate",
				fit: (x, c) => !c.pre && x.paid.length >= 10,
				heads: (x, c) => [`What a win share ${c.T("costs", "cost")} in ${c.season}`, `Paid more than they produced, and less`],
				build: (x, r, c) => {
					const total = x.paid.reduce((a, p) => a + p.contractAmount!, 0);
					const rate = x.paid.reduce((a, p) => a + p.ws, 0) / (total / 1000);
					const over = x.paid
						.map((p) => ({ p, d: p.ws - (rate * p.contractAmount!) / 1000 }))
						.toSorted((a, b) => b.d - a.d || a.p.pid - b.p.pid)
						.slice(0, 6);
					return [
						P(`Teams paid ${x.paid.length} players ${money(total)} this season; the league-wide rate was ${rate.toFixed(2)} win shares per $1M. Measured against that rate:`),
						table(
							["Player", "Salary", "WS", "Above rate"],
							over.map((y) => [[c.pl(y.p.pid)], [money(y.p.contractAmount!)], [fmt1(y.p.ws)], [signed(y.d)]]),
							[1, 2, 3],
						),
					];
				},
			},
			{
				id: "fa-recap",
				fit: (x, c) => !c.pre && c.f.signings.filter((s) => s.kind === "freeAgent" && (c.player(s.pid)?.gp ?? 0) > 0).length >= 3 && x.paid.length >= 10,
				heads: (x, c) => [`Free agency, graded on year one`, `Did the new money buy wins?`],
				build: (x, r, c) => {
					const total = x.paid.reduce((a, p) => a + p.contractAmount!, 0);
					const rate = x.paid.reduce((a, p) => a + p.ws, 0) / (total / 1000);
					const list = c.f.signings
						.filter((s) => s.kind === "freeAgent" && (c.player(s.pid)?.gp ?? 0) > 0)
						.map((s) => ({ s, p: c.player(s.pid)!, exp: (rate * s.amount) / 1000 }))
						.toSorted((a, b) => b.p.ws - b.exp - (a.p.ws - a.exp) || a.s.pid - b.s.pid)
						.slice(0, 6);
					return [
						P("Free-agent deals measured against what that money bought league-wide in their first season:"),
						table(
							["Player", "Salary", "WS", "Expected"],
							list.map((y) => [[c.pl(y.s.pid, y.s.name)], [money(y.s.amount)], [fmt1(y.p.ws)], [fmt1(y.exp)]]),
							[1, 2, 3],
						),
					];
				},
			},
			{
				id: "expiring",
				fit: (x, c) => x.books.filter((p) => p.contractExp === c.season).length >= 4,
				heads: (x, c) => [`Deals running out in ${c.season}`, `Contract years: who ${c.T("is", "was")} playing for a new deal`],
				build: (x, r, c) => {
					const list = x.books.filter((p) => p.contractExp === c.season).slice(0, 8);
					return [
						P(`${plural(list.length, "big contract")} ${c.T("end", "ended")} after ${c.season}. The largest:`),
						table(
							["Player", "Team", "Salary", c.pre ? "Rating" : "WS"],
							list.map((p) => [[c.pl(p.pid)], [c.tl(p.tid)], [money(p.contractAmount!)], [c.pre ? String(p.ovr) : fmt1(p.ws)]]),
							[2, 3],
						),
					];
				},
			},
		],
	}),
);

// ---- Release wire -------------------------------------------------------------------

addPage(
	arcPage<{ list: NonNullable<Ctx["f"]["releases"]> }>({
		id: "release-wire",
		section: "money",
		kicker: "Waived",
		eds: ALL_EDS,
		beat: "moves",
		prep: (c) => {
			const list = c.f.releases ?? [];
			return list.length >= 3 ? { list } : undefined;
		},
		arcs: [
			{
				id: "list",
				heads: (x, c) => [`${plural(x.list.length, "player")} released`, `The waiver wire, ${c.season}`, `Cut: ${x.list[0]!.name} and others`],
				build: (x, r, c) => {
					const by = new Map<number, number>();
					for (const y of x.list) {
						by.set(y.tid, (by.get(y.tid) ?? 0) + 1);
					}
					const top = [...by].toSorted((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
					return [
						P(`${plural(x.list.length, "release")} so far this season. The `, c.tl(top[0], c.tfull(top[0])), ` ${top[1] > 1 ? `made the most, ${top[1]}` : "made one"}.`),
						{
							type: "list",
							items: x.list.slice(0, 10).map((y): Seg[] => [c.pl(y.pid, y.name), ", released by the ", c.tl(y.tid)]),
						},
					];
				},
			},
		],
	}),
);

// ---- Lottery night ------------------------------------------------------------------

addPage(
	arcPage<{ rows: NonNullable<Ctx["f"]["lottery"]> }>({
		id: "lottery-night",
		section: "draft",
		kicker: "Lottery night",
		eds: ALL_EDS,
		beat: "draft",
		prep: (c) => {
			const rows = c.f.lottery ?? [];
			return rows.length >= 3 ? { rows } : undefined;
		},
		arcs: [
			{
				id: "jump",
				fit: (x) => x.rows.some((r) => r.slot - r.pick >= 2),
				heads: (x, c) => {
					const j = x.rows.toSorted((a, b) => b.slot - b.pick - (a.slot - a.pick))[0]!;
					return [`The ${c.tn(j.tid)} jump from No. ${j.slot} to No. ${j.pick}`, `Lottery luck for the ${c.tn(j.tid)}`];
				},
				build: (x, r, c) => {
					const j = x.rows.toSorted((a, b) => b.slot - b.pick - (a.slot - a.pick) || a.slot - b.slot)[0]!;
					const tot = x.rows.reduce((a, y) => a + y.chances, 0);
					return [
						P(
							`The `,
							c.tl(j.tid, c.tfull(j.tid)),
							` went into the lottery in the No. ${j.slot} spot and came out with the No. ${j.pick} pick`,
							tot > 0 ? `, with ${((j.chances / tot) * 100).toFixed(1)}% of the chances` : "",
							j.originalTid !== j.tid ? [`, using a pick that belonged to the `, c.tl(j.originalTid)] : "",
							".",
						),
						table(
							["Team", "Before", "After"],
							x.rows.toSorted((a, b) => a.pick - b.pick).slice(0, 8).map((y) => [[c.tl(y.tid, c.tfull(y.tid))], [`No. ${y.slot}`], [`No. ${y.pick}`]]),
							[1, 2],
						),
					];
				},
			},
			{
				id: "table",
				heads: (x, c) => [`The ${c.season} lottery, slot by slot`, `Who got the top pick`, `Lottery results`],
				build: (x, r, c) => {
					const no1 = x.rows.find((y) => y.pick === 1);
					const tot = x.rows.reduce((a, y) => a + y.chances, 0);
					return [
						P(
							no1 ? [`The `, c.tl(no1.tid, c.tfull(no1.tid)), ` won the No. 1 pick from the No. ${no1.slot} spot.`] : `The ${c.season} lottery set the top of the draft.`,
						),
						table(
							["Team", "Odds", "Before", "Pick"],
							x.rows.slice(0, 10).map((y) => [[c.tl(y.tid)], [tot > 0 ? `${((y.chances / tot) * 100).toFixed(1)}%` : "–"], [String(y.slot)], [String(y.pick)]]),
							[1, 2, 3],
						),
					];
				},
			},
		],
	}),
);

// ---- Draft night -------------------------------------------------------------------

addPage(
	arcPage<{ first: Ctx["f"]["draft"] }>({
		id: "draft-night",
		section: "draft",
		kicker: "Draft night",
		eds: ALL_EDS,
		beat: "draft",
		prep: (c) => {
			const first = c.f.draft.filter((d) => d.round === 1).toSorted((a, b) => a.pick - b.pick);
			return first.length >= 6 ? { first } : undefined;
		},
		photo: (x) => x.first[0]?.pid,
		arcs: [
			{
				id: "top",
				heads: (x, c) => [`${x.first[0]!.name} goes first`, `The first round, pick by pick`, `Draft night: the ${c.tn(x.first[0]!.tid)} take ${x.first[0]!.name}`],
				build: (x, r, c) => [
					P(`The top of the ${c.season} first round, with each team's record:`),
					table(
						["Pick", "Player", "Team", "Record", "Ovr/Pot"],
						x.first.slice(0, 10).map((d) => [[String(d.pick)], [c.pl(d.pid, d.name)], [c.tl(d.tid)], [c.rec(d.tid) || "–"], [`${d.ovr}/${d.pot}`]]),
						[0, 4],
					),
				],
			},
			{
				id: "profile",
				heads: (x, c) => [`Meet the class: ${x.first.slice(0, 3).map((d) => d.name).join(", ")}`, `Three to watch from the ${c.season} draft`],
				build: (x, r, c) => [
					P(`The first three picks of ${c.season}, by the numbers on draft night.`),
					{
						type: "notebook",
						items: x.first.slice(0, 3).map((d) => ({
							lead: `No. ${d.pick}: ${d.name}`,
							segs: [`${d.age}-year-old ${d.pos || "prospect"}${d.college ? ` from ${d.college}` : ""}, to the `, c.tl(d.tid), `. Rated ${d.ovr} now, ${d.pot} potential.`],
						})),
					},
				],
			},
		],
	}),
);

// ---- Rookie report -------------------------------------------------------------------

addPage(
	arcPage<{ rookies: NPPlayer[]; slow: NPPlayer[] }>({
		id: "rookie-report",
		section: "draft",
		kicker: "Rookie report",
		eds: PLAYED,
		beat: "draft",
		prep: (c) => {
			const rookies = c.f.players.filter((p) => p.rookie && p.gp >= 5 && p.draftRound > 0).toSorted((a, b) => b.ws - a.ws || a.pid - b.pid);
			const slow = c.f.players
				.filter((p) => p.draftRound === 1 && p.draftPick <= 5 && p.draftYear >= c.season - 3 && p.draftYear < c.season && p.gp >= 5 && p.ws < 2)
				.toSorted((a, b) => a.ws - b.ws || a.pid - b.pid);
			return rookies.length >= 4 || slow.length >= 2 ? { rookies, slow } : undefined;
		},
		photo: (x) => x.rookies[0]?.pid,
		arcs: [
			{
				id: "leader",
				fit: (x) => x.rookies.length >= 4 && x.rookies.some((p) => p.draftRound > 1 || p.draftPick > 10),
				heads: (x, c) => [`${x.rookies[0]!.name} ${c.T("leads", "led")} the rookie class`, `The best of the rookies, and the best bargain`],
				build: (x, r, c) => {
					const a = x.rookies[0]!;
					const b = x.rookies.find((p) => p !== a && (p.draftRound > 1 || p.draftPick > 10));
					return [
						P("The class leader and the best value outside the top 10 picks."),
						{
							type: "list",
							items: [a, b].filter((p): p is NPPlayer => p !== undefined).map((p): Seg[] => [c.pl(p.pid), `, ${p.draftRound > 1 ? `round ${p.draftRound}, ` : ""}pick ${p.draftPick}: ${c.lineWords(p)} a game, ${fmt1(p.ws)} win shares`]),
						},
					];
				},
			},
			{
				id: "slow",
				fit: (x) => x.slow.length >= 2,
				heads: (x, c) => [`Slow starts for recent top picks`, `${x.slow[0]!.name} and the waiting game`],
				build: (x, r, c) => [
					P("Slow starts: top-five picks from the last few drafts."),
					table(
						["Player", "Drafted", "Team", "WS"],
						x.slow.slice(0, 6).map((p) => [[c.pl(p.pid)], [`${p.draftYear}, No. ${p.draftPick}`], [c.tl(p.tid)], [fmt1(p.ws)]]),
						[3],
					),
				],
			},
		],
	}),
);

// ---- The summer's movers ----------------------------------------------------------------

addPage(
	arcPage<{ moved: NPPlayer[] }>({
		id: "movers-ledger",
		section: "money",
		kicker: "New addresses",
		eds: PLAYED,
		beat: "moves",
		prep: (c) => {
			const moved = c.f.players
				.filter((p) => p.prevTid !== undefined && p.prevTid >= 0 && p.prevTid !== p.tid && p.gp > 0)
				.toSorted((a, b) => b.ws - a.ws || a.pid - b.pid);
			return moved.length >= 6 ? { moved } : undefined;
		},
		photo: (x) => x.moved[0]?.pid,
		arcs: [
			{
				id: "ledger",
				heads: (x, c) => [`${x.moved[0]!.name} ${c.T("leads", "led")} the newcomers`, `New teams, new numbers`, `How the movers ${c.T("are doing", "did")}`],
				build: (x, r, c) => [
					P(`${x.moved.length} players changed franchises between seasons. Counting the win shares they produced this season:`),
					table(
						["Player", "From", "To", "WS"],
						x.moved.slice(0, 8).map((p) => [[c.pl(p.pid)], [c.tl(p.prevTid!)], [c.tl(p.tid)], [fmt1(p.ws)]]),
						[3],
					),
				],
			},
			{
				id: "net",
				heads: (x, c) => [`The summer's balance sheet`, `Who won the offseason, in win shares`],
				build: (x, r, c) => {
					const by = new Map<number, number>();
					for (const p of x.moved) {
						by.set(p.tid, (by.get(p.tid) ?? 0) + p.ws);
						by.set(p.prevTid!, (by.get(p.prevTid!) ?? 0) - p.ws);
					}
					const list = [...by].filter(([tid]) => c.team(tid)).toSorted((a, b) => b[1] - a[1] || a[0] - b[0]);
					return [
						P("Net win shares from players who arrived or left between seasons:"),
						table(
							["Team", "Net WS", "Record"],
							list.slice(0, 10).map(([tid, v]) => [[c.tl(tid, c.tfull(tid))], [signed(v)], [c.rec(tid)]]),
							[1],
						),
					];
				},
			},
		],
	}),
);

// ---- League swings and capsules -----------------------------------------------------------

const pace = (c: Ctx, t: { won: number; lost: number; tied?: number; otl?: number }) => {
	const gp = t.won + t.lost + (t.tied ?? 0) + (t.otl ?? 0);
	return gp > 0 ? t.won / gp : 0;
};

addPage(
	arcPage<{ list: { tid: number; d: number }[] }>({
		id: "league-swings",
		section: "teams",
		kicker: "Swings",
		eds: PLAYED,
		beat: "league",
		prep: (c) => {
			const list = c.f.teams
				.filter((t) => t.prev && t.gp >= 10)
				.map((t) => ({ tid: t.tid, d: Math.round((pace(c, t) - pace(c, t.prev!)) * c.f.numGames) }))
				.toSorted((a, b) => Math.abs(b.d) - Math.abs(a.d) || a.tid - b.tid);
			return list.length >= 6 && Math.abs(list[0]!.d) >= 5 ? { list } : undefined;
		},
		arcs: [
			{
				id: "table",
				heads: (x, c) => [`The biggest swings from last season`, `${c.tn(x.list[0]!.tid)}: the year's biggest change`],
				build: (x, r, c) => [
					P(`Against last season's records, the biggest swings in ${c.season}:`),
					table(
						["Team", "Last year", "Now", `Over ${c.f.numGames}`],
						x.list.slice(0, 8).map((y) => [[c.tl(y.tid, c.tfull(y.tid))], [record(c.team(y.tid)!.prev!)], [c.rec(y.tid)], [signed(y.d, 0)]]),
						[3],
					),
				],
			},
			{
				id: "tape",
				fit: (x) => x.list.some((y) => y.d > 4) && x.list.some((y) => y.d < -4),
				heads: (x, c) => [`One climbing, one falling`, `Up and down: two franchises`],
				build: (x, r, c) => {
					const up = x.list.filter((y) => y.d > 0).toSorted((a, b) => b.d - a.d)[0]!;
					const down = x.list.filter((y) => y.d < 0).toSorted((a, b) => a.d - b.d)[0]!;
					return [
						P("Two franchises moving in opposite directions:"),
						{
							type: "tape",
							a: c.tfull(up.tid),
							b: c.tfull(down.tid),
							rows: [
								{ label: "Last season", a: record(c.team(up.tid)!.prev!), b: record(c.team(down.tid)!.prev!) },
								{ label: "This season", a: c.rec(up.tid), b: c.rec(down.tid) },
								{ label: `Change over ${c.f.numGames} games`, a: signed(up.d, 0), b: signed(down.d, 0) },
							],
						},
					];
				},
			},
		],
	}),
);

addPage(
	arcPage<{ n: number }>({
		id: "team-capsules",
		section: "teams",
		kicker: "Around the league",
		eds: PLAYED,
		beat: "league",
		prep: (c) => (c.rows.length >= 8 ? { n: c.rows.length } : undefined),
		arcs: [
			{
				id: "list",
				heads: (x, c) => [`Every team in a line`, `The league at a glance, ${c.season}`],
				build: (x, r, c) => [
					P("One entry per team, best record first, with the change from last season and each roster's leader in win shares."),
					{
						type: "list",
						items: c.rows.map((t): Seg[] => {
							const lead = c.teamPlayers(t.tid)[0];
							return [
								c.tl(t.tid, c.tfull(t.tid)),
								` ${record(t)}`,
								t.prev ? ` (${signed(Math.round((pace(c, t) - pace(c, t.prev)) * c.f.numGames), 0)} wins against last year's pace)` : "",
								...(lead ? [`; `, c.pl(lead.pid), ` ${fmt1(lead.ws)} WS`] : []),
							];
						}),
					},
				],
			},
			{
				id: "tiers",
				heads: (x, c) => [`Four tiers`, `The league, sorted into tiers`],
				build: (x, r, c) => {
					const n = c.rows.length;
					const top = Math.max(2, Math.round(n / 8));
					const half = Math.ceil(n / 2);
					const q3 = Math.ceil((n * 3) / 4);
					const groups: [string, typeof c.rows][] = [
						["The top", c.rows.slice(0, top)],
						["The rest of the upper half", c.rows.slice(top, half)],
						["The middle", c.rows.slice(half, q3)],
						["The bottom quarter", c.rows.slice(q3)],
					];
					return [
						P(`Sorted into four tiers by record: the top ${top}, the rest of the upper half, the middle, and the bottom quarter.`),
						{
							type: "notebook",
							items: groups
								.filter(([, g]) => g.length > 0)
								.map(([lead, g]) => ({ lead, segs: andList(g.map((t) => [c.tl(t.tid), ` ${record(t)}`])) })),
						},
					];
				},
			},
		],
	}),
);

// ---- Streaks side by side ----------------------------------------------------------------

addPage(
	arcPage<{ run: { tid: number; n: number }; dry: { tid: number; n: number } }>({
		id: "streak-runs",
		section: "history",
		kicker: "Streaks",
		eds: ALL_EDS,
		beat: "league",
		prep: (c) => {
			const runs = c.f.teams.map((t) => {
				const hist = [...(t.hist ?? [])].reverse();
				let n = 0;
				for (const h of hist) {
					if (h.playoffRoundsWon < 0) {
						break;
					}
					n += 1;
				}
				let d = 0;
				for (const h of hist) {
					if (h.playoffRoundsWon >= 0) {
						break;
					}
					d += 1;
				}
				return { tid: t.tid, n, d };
			});
			const run = runs.toSorted((a, b) => b.n - a.n || a.tid - b.tid)[0];
			const dry = runs.toSorted((a, b) => b.d - a.d || a.tid - b.tid)[0];
			if (!run || !dry || run.n < 3 || dry.d < 3) {
				return undefined;
			}
			return { run: { tid: run.tid, n: run.n }, dry: { tid: dry.tid, n: dry.d } };
		},
		arcs: [
			{
				id: "tape",
				heads: (x, c) => [`${c.tn(x.run.tid)} keep going; ${c.tn(x.dry.tid)} keep waiting`, `The longest streaks, good and bad`],
				build: (x, r, c) => [
					P("The longest active playoff streak and the longest active drought, side by side:"),
					{
						type: "tape",
						a: c.tfull(x.run.tid),
						b: c.tfull(x.dry.tid),
						rows: [
							{ label: "Run through last season", a: plural(x.run.n, "playoff trip"), b: plural(x.dry.n, "season") + " without one" },
						],
					},
				],
			},
		],
	}),
);

// ---- Old players still going -----------------------------------------------------------------

addPage(
	arcPage<{ list: NPPlayer[]; age: number }>({
		id: "aging-well",
		section: "players",
		kicker: "Aging well",
		eds: PLAYED,
		beat: "features",
		prep: (c) => {
			const age = 33;
			const list = c.qual.filter((p) => p.age >= age).toSorted((a, b) => b.ws - a.ws || a.pid - b.pid);
			return list.length >= 3 ? { list, age } : undefined;
		},
		photo: (x) => x.list[0]?.pid,
		arcs: [
			{
				id: "list",
				heads: (x, c) => [`${x.list[0]!.name}, ${x.list[0]!.age}, ${c.T("is", "was")} still producing`, `Thirty-three and up`],
				build: (x, r, c) => [
					P(`${x.list.length} players aged ${x.age} or older held regular roles this season. The most productive:`),
					table(
						["Player", "Age", "Team", "WS"],
						x.list.slice(0, 6).map((p) => [[c.pl(p.pid)], [String(p.age)], [c.tl(p.tid)], [fmt1(p.ws)]]),
						[1, 3],
					),
				],
			},
		],
	}),
);

// ---- The draft class, ranked again ---------------------------------------------------------

addPage(
	arcPage<{ year: number; picks: NonNullable<Ctx["f"]["draftRetro"]>["picks"] }>({
		id: "retro-ranks",
		section: "history",
		kicker: "Redraft",
		eds: ALL_EDS,
		beat: "draft",
		prep: (c) => {
			const d = c.f.draftRetro;
			return d && d.picks.length >= 8 ? { year: d.year, picks: d.picks } : undefined;
		},
		arcs: [
			{
				id: "ranks",
				heads: (x, c) => [`The ${x.year} draft, ranked again`, `If the ${x.year} draft were held today`],
				build: (x, r, c) => {
					const byWs = x.picks.toSorted((a, b) => b.ws - a.ws || a.pick - b.pick);
					const first = x.picks.filter((p) => p.round === 1).toSorted((a, b) => a.pick - b.pick).slice(0, 8);
					return [
						P(`How the first picks of ${x.year} ranked in their class by career win shares:`),
						table(
							["Pick", "Player", "WS", "Class rank"],
							first.map((p) => [[String(p.pick)], [c.pl(p.pid, p.name)], [fmt1(p.ws)], [String(byWs.indexOf(p) + 1)]]),
							[0, 2, 3],
						),
					];
				},
			},
		],
	}),
);

// ---- Season preview: everything from ratings, for the preseason edition (it works for a brand-new league too) ----

const top8 = (c: Ctx, tid: number) =>
	c.f.players.filter((p) => p.tid === tid).toSorted((a, b) => b.ovr - a.ovr || a.pid - b.pid);

addPage(
	arcPage<{ order: { tid: number; ovr: number; best: NPPlayer }[] }>({
		id: "preview-ratings",
		section: "teams",
		kicker: "Preview",
		eds: PRE_ONLY,
		beat: "league",
		size: "feature",
		prep: (c) => {
			const order = c.f.teams
				.map((t) => ({ tid: t.tid, ovr: c.teamOvr(t.tid), best: top8(c, t.tid)[0] }))
				.filter((x): x is { tid: number; ovr: number; best: NPPlayer } => x.ovr !== undefined && x.best !== undefined)
				.toSorted((a, b) => b.ovr - a.ovr || a.tid - b.tid);
			return order.length >= 6 ? { order } : undefined;
		},
		photo: (x) => x.order[0]?.best.pid,
		arcs: [
			{
				id: "order",
				heads: (x, c) => [`On paper, the ${c.tn(x.order[0]!.tid)} are the team to beat`, `The ratings preview: ${c.tn(x.order[0]!.tid)} first, ${c.tn(x.order.at(-1)!.tid)} last`, `Before a game is played: the league by ratings`],
				build: (x, r, c) => [
					P(c.cycle("prevrat|lead", [`Ranked by the average rating of each roster's top eight, ${c.season}:`, `The ${c.season} preseason order, by the mean rating of each team's eight best players:`, `Before ${c.season} tips off, the rosters ranked by their top eight:`])),
					table(
						["", "Team", "Top 8", "Best player", c.f.teams.some((t) => t.prev) ? "Last year" : "Ovr"],
						x.order.map((y, i) => [
							[String(i + 1)],
							[c.tl(y.tid, c.tfull(y.tid))],
							[fmt1(y.ovr)],
							[c.pl(y.best.pid)],
							[c.team(y.tid)?.prev ? record(c.team(y.tid)!.prev!) : String(y.best.ovr)],
						]),
						[0, 2],
					),
					P(`Ratings are not results: a rating gap of ${fmt1(x.order[0]!.ovr - x.order.at(-1)!.ovr)} separates the top roster from the bottom one.`),
				],
			},
			{
				id: "tiers",
				heads: (x, c) => [`Contenders, hopefuls and the rest, by the ratings`, `Three tiers before tip-off`],
				build: (x, r, c) => {
					const n = x.order.length;
					const a = x.order.slice(0, Math.ceil(n / 4));
					const b = x.order.slice(Math.ceil(n / 4), Math.ceil((n * 3) / 4));
					const z = x.order.slice(Math.ceil((n * 3) / 4));
					return [
						P(c.cycle("prevtier|lead", [`Grouped by the average rating of each team's eight best players, ${c.season}.`, `Three tiers for ${c.season}, from the ratings of each team's top eight.`, `The ${c.season} rosters in three groups by top-eight rating.`])),
						{
							type: "notebook",
							items: [
								{ lead: "Top of the ratings", segs: andList(a.map((y) => [c.tl(y.tid), ` (${fmt1(y.ovr)})`])) },
								{ lead: "The middle", segs: andList(b.map((y) => [c.tl(y.tid), ` (${fmt1(y.ovr)})`])) },
								{ lead: "The bottom", segs: andList(z.map((y) => [c.tl(y.tid), ` (${fmt1(y.ovr)})`])) },
							],
						},
					];
				},
			},
		],
	}),
);

const profile = (c: Ctx, p: NPPlayer): Seg[] => [
	`${p.age}-year-old ${p.pos || "player"} for the `,
	c.tl(p.tid),
	`, rated ${p.ovr} with ${p.pot} potential`,
	p.contractAmount ? `, paid ${money(p.contractAmount)} a year${p.contractExp ? ` through ${p.contractExp}` : ""}` : "",
	p.career && p.career.gp > 0 ? `. Career: ${plural(p.career.seasons, "season")}, ${fmt1(p.career.pts / p.career.gp)} points a game` : "",
	p.honors && p.honors.allStar > 0 ? `, ${plural(p.honors.allStar, "All-Star selection")}` : "",
	p.college ? `. School: ${p.college}` : "",
	p.country && p.country !== "USA" ? `. From ${p.country}` : "",
	".",
];

addPage(
	arcPage<{ stars: NPPlayer[]; young: NPPlayer[]; old: NPPlayer[] }>({
		id: "preview-profiles",
		section: "players",
		kicker: "Players to know",
		eds: PRE_ONLY,
		beat: "features",
		size: "feature",
		prep: (c) => {
			const ps = c.f.players.filter((p) => p.tid >= 0);
			const stars = ps.toSorted((a, b) => b.ovr - a.ovr || a.pid - b.pid).slice(0, 3);
			const young = ps.filter((p) => p.age <= 22).toSorted((a, b) => b.pot - a.pot || b.ovr - a.ovr || a.pid - b.pid).slice(0, 3);
			const old = ps.filter((p) => p.age >= 32).toSorted((a, b) => b.ovr - a.ovr || a.pid - b.pid).slice(0, 3);
			return stars.length >= 3 ? { stars, young, old } : undefined;
		},
		photo: (x) => x.stars[0]?.pid,
		arcs: [
			{
				id: "stars",
				heads: (x) => [`The highest-rated players in the league: ${x.stars[0]!.name} and company`, `Three stars, by the ratings`],
				build: (x, r, c) => [
					P(c.cycle("stars|lead", [`The three highest-rated players going into ${c.season}.`, `${x.stars[0]!.name} tops the ${c.season} ratings. The top three:`, `By rating, the league's three best players before ${c.season}:`])),
					{ type: "notebook", items: x.stars.map((p) => ({ lead: p.name, segs: profile(c, p) })) },
				],
			},
			{
				id: "young",
				fit: (x) => x.young.length >= 2,
				heads: (x) => [`Prospects: ${x.young[0]!.name} leads the young talent`, `The future, by potential`],
				build: (x, r, c) => [
					P(c.cycle("young|lead", [`The highest potential ratings among players 22 or younger, ${c.season}.`, `${x.young[0]!.name} heads the young talent of ${c.season}, by potential.`, `Twenty-two or younger, and rated for big things in ${c.season}:`])),
					{ type: "notebook", items: x.young.map((p) => ({ lead: p.name, segs: profile(c, p) })) },
				],
			},
			{
				id: "old",
				fit: (x) => x.old.length >= 2,
				heads: (x) => [`Still rated among the best: ${x.old[0]!.name} at ${x.old[0]!.age}`, `Veterans with something left`],
				build: (x, r, c) => [
					P(c.cycle("old|lead", [`The best-rated players aged 32 or older going into ${c.season}.`, `${x.old[0]!.name} leads the veterans of ${c.season}, by rating.`, `Age 32 and up, and still rated near the top in ${c.season}:`])),
					{ type: "notebook", items: x.old.map((p) => ({ lead: p.name, segs: profile(c, p) })) },
				],
			},
		],
	}),
);

const POSITIONS = ["PG", "SG", "SF", "PF", "C", "G", "GF", "F", "FC"];

addPage(
	arcPage<{ rows: NPPlayer[] }>({
		id: "preview-positions",
		section: "players",
		kicker: "Position by position",
		eds: PRE_ONLY,
		beat: "features",
		prep: (c) => {
			const rows: NPPlayer[] = [];
			for (const pos of POSITIONS) {
				const best = c.f.players.filter((p) => p.pos === pos && p.tid >= 0).toSorted((a, b) => b.ovr - a.ovr || a.pid - b.pid)[0];
				if (best) {
					rows.push(best);
				}
			}
			return rows.length >= 4 ? { rows } : undefined;
		},
		photo: (x) => x.rows[0]?.pid,
		arcs: [
			{
				id: "table",
				heads: (x, c) => [`The best at every position, by the ratings`, `An all-ratings team for ${c.season}`],
				build: (x, r, c) => [
					P(c.cycle("pos|lead", [`The highest-rated player at each position going into ${c.season}:`, `${x.rows[0]!.name} and the rest of the ${c.season} all-ratings team, one per position:`, `Position by position, the best ratings in the league before ${c.season} tips off:`])),
					table(
						["Pos", "Player", "Team", "Ovr", "Age"],
						x.rows.map((p) => [[p.pos], [c.pl(p.pid)], [c.tl(p.tid)], [String(p.ovr)], [String(p.age)]]),
						[3, 4],
					),
				],
			},
		],
	}),
);

addPage(
	arcPage<{ ages: { tid: number; age: number; deep: number }[] }>({
		id: "preview-rosters",
		section: "teams",
		kicker: "Roster check",
		eds: PRE_ONLY,
		beat: "league",
		prep: (c) => {
			const ages = c.f.teams
				.map((t) => {
					const ps = top8(c, t.tid).slice(0, 10);
					const best = ps[0]?.ovr ?? 0;
					return {
						tid: t.tid,
						age: ps.length > 0 ? ps.reduce((a, p) => a + p.age, 0) / ps.length : 0,
						deep: ps.filter((p) => p.ovr >= best - 8).length,
					};
				})
				.filter((x) => x.age > 0);
			return ages.length >= 6 ? { ages } : undefined;
		},
		arcs: [
			{
				id: "age",
				heads: (x, c) => {
					const y = x.ages.toSorted((a, b) => a.age - b.age)[0]!;
					return [`The ${c.tn(y.tid)} have the youngest core`, `Young and old: the league's rosters by age`];
				},
				build: (x, r, c) => {
					const sorted = x.ages.toSorted((a, b) => a.age - b.age || a.tid - b.tid);
					const y = sorted[0]!;
					const o = sorted.at(-1)!;
					return [
						P(`The average age of each roster's ten best players runs from ${fmt1(y.age)} (`, c.tl(y.tid, c.tfull(y.tid)), `) to ${fmt1(o.age)} (`, c.tl(o.tid, c.tfull(o.tid)), `).`),
						table(["Team", "Avg age, top 10"], sorted.map((z) => [[c.tl(z.tid)], [fmt1(z.age)]]), [1]),
					];
				},
			},
			{
				id: "depth",
				heads: (x, c) => {
					const d = x.ages.toSorted((a, b) => b.deep - a.deep || a.tid - b.tid)[0]!;
					return [`The ${c.tn(d.tid)} go deepest`, `Depth charts, by the ratings`];
				},
				build: (x, r, c) => {
					const sorted = x.ages.toSorted((a, b) => b.deep - a.deep || a.tid - b.tid);
					return [
						P(c.cycle("depth|lead", [`Counting the players within eight rating points of each team's best player, ${c.season}:`, `Depth before ${c.season}: how many players sit within eight rating points of each team's best.`, `The ${c.tfull(sorted[0]!.tid)} have the most players close to their best. Within eight rating points, by team:`])),
						table(["Team", "Players"], sorted.slice(0, 10).map((z) => [[c.tl(z.tid, c.tfull(z.tid))], [String(z.deep)]]), [1]),
					];
				},
			},
		],
	}),
);

addPage(
	arcPage<{ list: NPPlayer[] }>({
		id: "preview-rising",
		section: "players",
		kicker: "Room to grow",
		eds: PRE_ONLY,
		beat: "features",
		prep: (c) => {
			const list = c.f.players.filter((p) => p.tid >= 0 && p.pot - p.ovr >= 8).toSorted((a, b) => b.pot - b.ovr - (a.pot - a.ovr) || b.pot - a.pot || a.pid - b.pid);
			return list.length >= 4 ? { list } : undefined;
		},
		photo: (x) => x.list[0]?.pid,
		arcs: [
			{
				id: "gap",
				heads: (x) => [`The biggest gaps between rating and potential: ${x.list[0]!.name}`, `Who could grow the most`],
				build: (x, r, c) => [
					P(c.cycle("rising|lead", [`Potential minus current rating, largest first, going into ${c.season}:`, `The widest gaps between rating and potential before the ${c.season} season, led by ${x.list[0]!.name}:`, `${plural(x.list.length, "player")} carry a potential at least eight points above their rating in ${c.season}. The biggest gaps:`])),
					table(
						["Player", "Team", "Age", "Ovr", "Pot"],
						x.list.slice(0, 8).map((p) => [[c.pl(p.pid)], [c.tl(p.tid)], [String(p.age)], [String(p.ovr)], [String(p.pot)]]),
						[2, 3, 4],
					),
				],
			},
		],
	}),
);

addPage(
	arcPage<{ moved: NPPlayer[] }>({
		id: "preview-movers",
		section: "money",
		kicker: "New uniforms",
		eds: PRE_ONLY,
		beat: "moves",
		prep: (c) => {
			const moved = c.f.players
				.filter((p) => p.tid >= 0 && p.prevTid !== undefined && p.prevTid >= 0 && p.prevTid !== p.tid)
				.toSorted((a, b) => b.ovr - a.ovr || a.pid - b.pid);
			return moved.length >= 4 ? { moved } : undefined;
		},
		photo: (x) => x.moved[0]?.pid,
		arcs: [
			{
				id: "list",
				heads: (x) => [`${x.moved[0]!.name} heads the list of players in new colors`, `Who moved this summer`],
				build: (x, r, c) => [
					P(c.cycle("pmovers|lead", [`${plural(x.moved.length, "player")} who finished ${c.season - 1} elsewhere, best rated first:`, `New uniforms for ${c.season}, led by ${x.moved[0]!.name}:`, `The summer moved ${plural(x.moved.length, "player")} to new teams before ${c.season}. The best rated:`])),
					table(
						["Player", "From", "To", "Ovr"],
						x.moved.slice(0, 8).map((p) => [[c.pl(p.pid)], [c.tl(p.prevTid!)], [c.tl(p.tid)], [String(p.ovr)]]),
						[3],
					),
				],
			},
		],
	}),
);

export const DEAL_PAGE_IDS = [
	"deadline-ledger",
	"trade-analysis",
	"contract-tracker",
	"release-wire",
	"lottery-night",
	"draft-night",
	"rookie-report",
	"movers-ledger",
	"league-swings",
	"team-capsules",
	"streak-runs",
	"aging-well",
	"retro-ranks",
	"preview-ratings",
	"preview-profiles",
	"preview-positions",
	"preview-rosters",
	"preview-rising",
	"preview-movers",
];
