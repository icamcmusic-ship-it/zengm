// Money and moves: free agency, the trade scorecard, bargains and burdens, the luxury tax line and the transaction wire.

import { Ctx, P } from "./ctx.ts";
import { ALL_EDS, PLAYED, addPage, arcPage, table } from "./kit.ts";
import { andList, capFirst, fmt1, money, plural, word } from "./text.ts";
import type { NPPlayer, NPTrade, NPTradeAsset } from "./types.ts";

// ---- Free agency --------------------------------------------------------------

addPage(
	arcPage<{
		spend: { tid: number; total: number; n: number }[];
		top: Ctx["f"]["signings"];
		fa: number;
		re: number;
	}>({
		id: "free-agency",
		section: "money",
		kicker: "Free agency",
		eds: ALL_EDS,
		beat: "moves",
		prep: (c) => {
			const list = c.f.signings;
			if (list.length < 4) {
				return undefined;
			}
			const by = new Map<number, { total: number; n: number }>();
			for (const s of list) {
				const cur = by.get(s.tid) ?? { total: 0, n: 0 };
				by.set(s.tid, { total: cur.total + s.amount, n: cur.n + 1 });
			}
			const spend = [...by.entries()]
				.map(([tid, v]) => ({ tid, ...v }))
				.toSorted((a, b) => b.total - a.total)
				.slice(0, 6);
			return {
				spend,
				top: list.toSorted((a, b) => b.amount - a.amount).slice(0, 5),
				fa: list.filter((s) => s.kind === "freeAgent").length,
				re: list.filter((s) => s.kind === "reSigned").length,
			};
		},
		photo: (x) => x.top[0]?.pid,
		arcs: [
			{
				id: "spenders",
				heads: (x, c) => [
					`${c.tn(x.spend[0]!.tid)} ${c.T("spend", "spent")} the most on new contracts`,
					`The big spenders: ${c.tn(x.spend[0]!.tid)}, ${c.tn(x.spend[1]?.tid ?? x.spend[0]!.tid)}`,
					`Free agency, team by team: who ${c.T("paid", "paid")} what`,
					`${money(x.spend[0]!.total)} in new money for the ${c.tn(x.spend[0]!.tid)}`,
				],
				build: (x, r, c) => [
					P(
						`${plural(x.fa, "free agent")} signed and ${plural(x.re, "player")} re-signed. The most money in new yearly salary went to the `,
						c.tl(x.spend[0]!.tid, c.tfull(x.spend[0]!.tid)),
						` (${money(x.spend[0]!.total)} across ${plural(x.spend[0]!.n, "deal")}).`,
					),
					table(
						["Team", "Deals", "Added salary"],
						x.spend.map((y) => [
							[c.tl(y.tid, c.tfull(y.tid))],
							[String(y.n)],
							[money(y.total)],
						]),
						[1, 2],
					),
				],
			},
			{
				id: "top",
				heads: (x, c) => [
					`${x.top[0]!.name} ${x.top[0]!.kind === "reSigned" ? "re-signs" : "cashes in"} at ${money(x.top[0]!.amount)} a year`,
					`The five richest deals of the market`,
					`${money(x.top[0]!.amount)}: the market's top price`,
					`Who got paid`,
				],
				build: (x, r, c) => [
					P(
						"The five largest contracts: ",
						...andList(
							x.top.map((s) => [
								c.pl(s.pid, s.name),
								` (`,
								c.tl(s.tid, c.team(s.tid)?.abbrev),
								`, ${money(s.amount)} through ${s.exp})`,
							]),
						),
						".",
					),
				],
			},
		],
	}),
);

// ---- Trade scorecard ------------------------------------------------------------

const assetPlayers = (assets: NPTradeAsset[]) =>
	assets.filter(
		(a): a is Extract<NPTradeAsset, { kind: "player" }> => a.kind === "player",
	);

addPage(
	arcPage<{
		cards: {
			tr: NPTrade;
			ws: [number, number];
			stars: [NPPlayer | undefined, NPPlayer | undefined];
		}[];
	}>({
		id: "trade-scorecard",
		section: "money",
		kicker: "The trade ledger",
		eds: PLAYED,
		beat: "moves",
		prep: (c) => {
			const cards = c.f.trades
				.filter((t) => t.phase >= 0 && t.phase <= 3)
				.map((tr) => {
					const side = (i: 0 | 1) =>
						assetPlayers(tr.got[i])
							.map((a) => c.player(a.pid))
							.filter((p): p is NPPlayer => p !== undefined && p.gp > 0);
					const a = side(0);
					const b = side(1);
					return {
						tr,
						ws: [
							a.reduce((s, p) => s + p.ws, 0),
							b.reduce((s, p) => s + p.ws, 0),
						] as [number, number],
						stars: [
							a.toSorted((p, q) => q.ws - p.ws)[0],
							b.toSorted((p, q) => q.ws - p.ws)[0],
						] as [NPPlayer | undefined, NPPlayer | undefined],
					};
				})
				.filter((x) => x.stars[0] || x.stars[1])
				.toSorted(
					(p, q) => Math.abs(q.ws[0] - q.ws[1]) - Math.abs(p.ws[0] - p.ws[1]),
				)
				.slice(0, 5);
			return cards.length >= 1 ? { cards } : undefined;
		},
		photo: (x) => (x.cards[0]!.stars[0] ?? x.cards[0]!.stars[1])?.pid,
		arcs: [
			{
				id: "card",
				heads: (x, c) => {
					const t = x.cards[0]!;
					const [a, b] = t.tr.tids;
					return [
						`${c.tn(a)}-${c.tn(b)}: ${c.T("who is winning", "who won")} the trade?`,
						`Scoring the ${c.tn(a)} and ${c.tn(b)} deal`,
						`The trade ledger: ${c.T("early returns", "final returns")}`,
						`Deal check: the players ${c.tn(t.ws[0] >= t.ws[1] ? a : b)} ${c.T("got", "got")}`,
					];
				},
				build: (x, r, c) => [
					P(
						c.cycle("trade-ledger", [
							`${plural(x.cards.length, "trade")} measured by this season's win shares for the players each side received, some of it earned before the deal.`,
							`Scoring ${plural(x.cards.length, "deal")} by the win shares of what each side got, keeping in mind that part of that came before the trade.`,
							`The ledger counts ${c.season} win shares for every player received, including those earned elsewhere before the move.`,
							`${capFirst(word(x.cards.length))} ${x.cards.length === 1 ? "trade" : "trades"}, judged only by the win shares the players have this season, wherever they earned them.`,
						]),
					),
					table(
						["Teams", "Received", "Win shares"],
						x.cards.flatMap((card) =>
							([0, 1] as const).map((i) => [
								[c.tl(card.tr.tids[i], c.tfull(card.tr.tids[i]))],
								card.stars[i]
									? [
											c.pl(card.stars[i]!.pid),
											` (${fmt1(card.stars[i]!.pts)} ppg)`,
										]
									: ["picks and depth"],
								[fmt1(card.ws[i])],
							]),
						),
						[2],
					),
				],
			},
		],
	}),
);

// ---- Bargains and burdens ---------------------------------------------------------

addPage(
	arcPage<{ bargains: NPPlayer[]; burdens: NPPlayer[] }>({
		id: "bargains",
		section: "money",
		kicker: "Value for money",
		eds: PLAYED,
		beat: "moves",
		prep: (c) => {
			const paid = c.f.players.filter(
				(p) =>
					p.contractAmount !== undefined &&
					p.contractAmount > 0 &&
					p.gp >= Math.max(10, c.f.gp * 0.4),
			);
			if (paid.length < 20) {
				return undefined;
			}
			const bargains = paid
				.filter((p) => p.ws > 1)
				.toSorted((a, b) => b.ws / b.contractAmount! - a.ws / a.contractAmount!)
				.slice(0, 5);
			const burdens = paid
				.toSorted((a, b) => b.contractAmount! - a.contractAmount!)
				.slice(0, 15)
				.toSorted((a, b) => a.ws - b.ws)
				.slice(0, 4);
			return bargains.length >= 3 && burdens.length >= 2
				? { bargains, burdens }
				: undefined;
		},
		photo: (x) => x.bargains[0]?.pid,
		arcs: [
			{
				id: "bargains",
				heads: (x, c) => [
					`${x.bargains[0]!.name} ${c.T("is", "was")} the best value in the league`,
					`Bargain bin: ${money(x.bargains[0]!.contractAmount!)} for ${fmt1(x.bargains[0]!.ws)} win shares`,
					`Cheap and good: the best contracts of ${c.season}`,
					`The league's best deals`,
				],
				build: (x, r, c) => [
					P(
						c.pl(x.bargains[0]!.pid),
						` ${c.T("is", "was")} paid ${money(x.bargains[0]!.contractAmount!)} a year and ${c.T("has", "had")} ${fmt1(x.bargains[0]!.ws)} win shares${c.done ? "" : " so far"}, the best return per dollar among regulars.`,
					),
					table(
						["Player", "Team", "Salary", "WS"],
						x.bargains.map((p) => [
							[c.pl(p.pid)],
							[c.tl(p.tid, c.team(p.tid)?.abbrev)],
							[money(p.contractAmount!)],
							[fmt1(p.ws)],
						]),
						[2, 3],
					),
				],
			},
			{
				id: "burdens",
				heads: (x, c) => [
					`${money(x.burdens[0]!.contractAmount!)} for ${fmt1(x.burdens[0]!.ws)} win shares: ${x.burdens[0]!.name}`,
					`Big contracts, small returns`,
					`The priciest deals that ${c.T("have not", "did not")} paid off`,
					`Burden or bargain? ${x.burdens[0]!.name}`,
				],
				build: (x, r, c) => [
					P(
						"Of the 15 biggest contracts among regulars, these ",
						c.T("have", "had"),
						" the lowest win-share totals: ",
						...andList(
							x.burdens.map((p) => [
								c.pl(p.pid),
								` (${money(p.contractAmount!)}, ${fmt1(p.ws)} WS)`,
							]),
						),
						".",
					),
					{
						type: "aside",
						segs: [
							"Win shares reward more than scoring, but they are one number; ratings and age matter too.",
						],
					},
				],
			},
		],
	}),
);

// ---- The tax line -----------------------------------------------------------------

addPage(
	arcPage<{
		over: { tid: number; payroll: number }[];
		space: { tid: number; payroll: number }[];
		cap: number;
		tax?: number;
	}>({
		id: "tax-line",
		section: "money",
		kicker: "The cap and the tax",
		eds: ALL_EDS,
		beat: "moves",
		prep: (c) => {
			const cap = c.f.salaryCap;
			if (!cap) {
				return undefined;
			}
			const withPay = c.f.teams
				.filter((t) => t.payroll !== undefined)
				.map((t) => ({ tid: t.tid, payroll: t.payroll! }));
			if (withPay.length < 10) {
				return undefined;
			}
			const tax = c.f.luxuryPayroll;
			return {
				cap,
				tax,
				over: tax
					? withPay
							.filter((x) => x.payroll > tax)
							.toSorted((a, b) => b.payroll - a.payroll)
					: [],
				space: withPay
					.filter((x) => x.payroll < cap)
					.toSorted((a, b) => a.payroll - b.payroll)
					.slice(0, 5),
			};
		},
		arcs: [
			{
				id: "tax",
				fit: (x) => x.over.length > 0,
				heads: (x, c) => [
					`${plural(x.over.length, "team")} ${c.T("are", "were")} over the tax line`,
					`${c.tn(x.over[0]!.tid)} ${c.T("pay", "paid")} the luxury tax`,
					`Over the line: the luxury tax payers`,
					`${money(x.over[0]!.payroll)}: the ${c.tn(x.over[0]!.tid)} payroll`,
				],
				build: (x, r, c) => [
					P(
						`The luxury tax line ${c.T("is", "was")} ${money(x.tax!)}, and ${plural(x.over.length, "team")} ${c.T(x.over.length === 1 ? "is" : "are", x.over.length === 1 ? "was" : "were")} above it: `,
						...andList(
							x.over
								.slice(0, 5)
								.map((y) => [c.tl(y.tid), ` (${money(y.payroll)})`]),
						),
						".",
					),
				],
			},
			{
				id: "space",
				fit: (x) => x.space.length > 0,
				heads: (x, c) => [
					`${c.tn(x.space[0]!.tid)} ${c.T("have", "had")} the most room under the cap`,
					`Cap space: who ${c.T("can", "could")} spend`,
					`${money(x.cap - x.space[0]!.payroll)} of space for the ${c.tn(x.space[0]!.tid)}`,
					`Room to maneuver`,
				],
				build: (x, r, c) => [
					P(
						`The salary cap ${c.T("is", "was")} ${money(x.cap)}. The most room belongs to the `,
						c.tl(x.space[0]!.tid, c.tfull(x.space[0]!.tid)),
						`, with ${money(x.cap - x.space[0]!.payroll)} of space.`,
					),
					table(
						["Team", "Payroll", "Room"],
						x.space.map((y) => [
							[c.tl(y.tid, c.tfull(y.tid))],
							[money(y.payroll)],
							[money(x.cap - y.payroll)],
						]),
						[1, 2],
					),
				],
			},
		],
	}),
);

// ---- The wire ------------------------------------------------------------------------------

addPage(
	arcPage<{ wire: NonNullable<Ctx["f"]["wire"]> }>({
		id: "wire",
		section: "money",
		kicker: "The wire",
		eds: PLAYED,
		beat: "moves",
		prep: (c) => {
			const w = c.f.wire;
			if (!w || w.trades + w.freeAgents + w.reSigned + w.releases < 5) {
				return undefined;
			}
			return { wire: w };
		},
		arcs: [
			{
				id: "log",
				heads: (x, c) => [
					`${x.wire.trades + x.wire.freeAgents + x.wire.reSigned + x.wire.releases} moves on the wire`,
					`The transaction log, ${c.season}`,
					`Trades, signings and cuts: the ledger`,
					`The wire: ${plural(x.wire.trades, "trade")}, ${plural(x.wire.releases, "release")}`,
				],
				build: (x, r, c) => {
					const w = x.wire;
					const top = c.f.signings.toSorted((a, b) => b.amount - a.amount)[0];
					return [
						P(
							`${w.trades} ${w.trades === 1 ? "trade" : "trades"}, ${w.freeAgents} free-agent ${w.freeAgents === 1 ? "signing" : "signings"}, ${w.reSigned} re-${w.reSigned === 1 ? "signing" : "signings"} and ${w.releases} ${w.releases === 1 ? "release" : "releases"} this season. The headliners:`,
						),
						{
							type: "list",
							items: [
								...(top
									? [
											[
												"Biggest contract: ",
												c.pl(top.pid, top.name),
												` to the `,
												c.tl(top.tid),
												`, ${money(top.amount)} a year`,
											],
										]
									: []),
								...c.f.trades
									.slice(0, 1)
									.map((tr) => [
										`A trade: the `,
										c.tl(tr.tids[0]),
										` and `,
										c.tl(tr.tids[1]),
									]),
							],
						},
						{
							type: "nums",
							items: [
								{ value: String(w.trades), label: "trades" },
								{ value: String(w.freeAgents), label: "free-agent signings" },
								{ value: String(w.reSigned), label: "re-signings" },
								{ value: String(w.releases), label: "releases" },
							],
						},
					];
				},
			},
		],
	}),
);
