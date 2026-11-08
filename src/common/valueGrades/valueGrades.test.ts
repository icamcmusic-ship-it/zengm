import { describe, expect, test } from "vitest";
import {
	gradeLetter,
	gradeTrades,
	gpaLetter,
	madeFor,
	rankSides,
} from "./tradeGrader.ts";
import {
	albatross,
	bargains,
	computeContractValue,
	contractYear,
	deadByTeam,
	teamEfficiency,
	valueDeals,
	valueSeasons,
} from "./contractValue.ts";
import { toVPlayer } from "./convert.ts";
import type { VContract, VLeague, VPlayer, VRow } from "./types.ts";
import { PHASE, PLAYER } from "../constants.ts";
import type { Player } from "../types.ts";

let nextI = 0;
const row = (
	season: number,
	tid: number,
	ws: number | null,
	extra: Partial<VRow> = {},
): VRow => ({
	i: nextI++,
	season,
	tid,
	playoffs: false,
	gp: 70,
	min: 2000,
	ws,
	...extra,
});

const player = (pid: number, o: Partial<VPlayer> = {}): VPlayer => ({
	pid,
	name: `P${pid}`,
	tid: PLAYER.RETIRED,
	retiredYear: 2030,
	bornYear: 1995,
	draft: { year: 2015, round: 0, pick: 0, tid: -1, originalTid: -1 },
	rows: [],
	transactions: [],
	contracts: [],
	...o,
});

const league = (o: Partial<VLeague>): VLeague => ({
	season: 2025,
	phase: PHASE.REGULAR_SEASON,
	players: [],
	trades: [],
	teamSeasons: [],
	...o,
});

describe("grading math", () => {
	test("even trade is a B, lopsided trades go to A+ and D", () => {
		expect(gradeLetter(0, 0).g).toBe("B");
		expect(gradeLetter(5, 5).g).toBe("B");
		expect(gradeLetter(10, 0)).toEqual({ g: "A+", share: 0.813 });
		expect(gradeLetter(0, 10).g).toBe("D");
		expect(gradeLetter(0, 30).g).toBe("F");
		// Negative win shares count as 0
		expect(gradeLetter(-4, 0).g).toBe("B");
	});

	test("GPA letters", () => {
		expect(gpaLetter(4.3)).toBe("A+");
		expect(gpaLetter(3)).toBe("B");
		expect(gpaLetter(0.5)).toBe("F");
		expect(gpaLetter(null)).toBe(null);
	});

	test("offseason trades count for the next season", () => {
		expect(madeFor(2020, PHASE.REGULAR_SEASON)).toBe(2020);
		expect(madeFor(2020, PHASE.DRAFT)).toBe(2021);
	});
});

describe("trade grader", () => {
	// Trade 10, in-season 2020: team 0 gets player 1 from team 1, team 1 gets player 2 and team 0's 2021 1st round pick (dpid 50)
	const p1 = player(1, {
		tid: 2,
		rows: [
			row(2019, 1, 3),
			row(2020, 1, 1), // i = 1, before the trade
			row(2020, 0, 2),
			row(2021, 0, 5),
			row(2022, 2, 8), // signed elsewhere
		],
		transactions: [
			{ type: "trade", tid: 0, season: 2020, phase: 1, eid: 10 },
			{ type: "freeAgent", tid: 2, season: 2021, phase: 8 },
		],
	});
	// Re-signs with team 1 (still counts), then is traded on
	const p2 = player(2, {
		rows: [row(2020, 0, 0.5), row(2020, 1, 1), row(2021, 1, 1), row(2022, 1, 1), row(2023, 3, 9)],
		transactions: [
			{ type: "trade", tid: 1, season: 2020, phase: 1, eid: 10 },
			{ type: "freeAgent", tid: 1, season: 2021, phase: 7 },
			{ type: "trade", tid: 3, season: 2022, phase: 8, eid: 20 },
		],
	});
	// Drafted with the pick by team 1; his college row is not in the snapshot
	const p3 = player(3, {
		tid: 1,
		draft: { year: 2021, round: 1, pick: 7, tid: 1, originalTid: 0, dpid: 50 },
		rows: [row(2022, 1, 4), row(2023, 1, 6)],
		transactions: [{ type: "draft", tid: 1, season: 2021, phase: 5 }],
	});
	const statsIndexP1 = p1.rows[1]!.i;
	const statsIndexP2 = p2.rows[0]!.i;
	const L = league({
		season: 2024,
		phase: PHASE.REGULAR_SEASON,
		players: [p1, p2, p3],
		trades: [
			{
				eid: 10,
				season: 2020,
				phase: 1,
				tids: [0, 1],
				assets: [
					[{ pid: 1, name: "P1", statsIndex: statsIndexP1 }],
					[
						{ pid: 2, name: "P2", statsIndex: statsIndexP2 },
						{ dpid: 50, season: 2021, round: 1, originalTid: 0 },
					],
				],
			},
		],
	});
	const G = gradeTrades(L);
	const t = G.trades[0]!;

	test("players count from the trade until they leave", () => {
		const s0 = t.sides[0];
		expect(s0.items[0]).toMatchObject({ how: "traded", now: 2, later: 5, total: 7, seasons: 2 });
		expect(s0.got).toEqual({ now: 2, later: 5, total: 7 });
		// re-signing keeps him; the trade away ends it
		const it = t.sides[1].items[0]!;
		expect(it).toMatchObject({ how: "traded", now: 1, later: 2, total: 3 });
	});

	test("a draft pick counts as the player picked, while with the team", () => {
		const pick = t.sides[1].items[1]!;
		expect(pick).toMatchObject({ kind: "pick", how: "drafted", pid: 3, total: 10, now: 0, later: 10, living: true });
		expect(pick.pick?.no).toBe(7);
		expect(t.sides[1].got.total).toBe(13);
		expect(t.sides[1].net).toBe(6);
		expect(t.sides[0].net).toBe(-6);
		expect(t.sides[1].grade!.g).toBe(gradeLetter(13, 7).g);
		expect(t.open).toBe(true);
	});

	test("report cards", () => {
		const c1 = G.cards.find((c) => c.tid === 1)!;
		expect(c1).toMatchObject({ n: 1, graded: 1, won: 1, lost: 0, net: 6 });
		expect(c1.bySeason).toEqual([{ season: 2020, net: 6 }]);
		expect(c1.best?.eid).toBe(10);
		expect(G.cards[0]!.tid).toBe(1);
		expect(rankSides(t.sides)[0]!.tid).toBe(1);
	});

	test("flipped, pending and unknown picks, unknown and partial players", () => {
		const q1 = player(11, { rows: [row(2020, 0, null), row(2021, 0, null)], transactions: [{ type: "trade", tid: 0, season: 2020, phase: 0, eid: 30 }] });
		const q2 = player(12, { rows: [row(2020, 1, null), row(2021, 1, 4)], transactions: [{ type: "trade", tid: 1, season: 2020, phase: 0, eid: 30 }] });
		const drafted = player(13, { draft: { year: 2021, round: 2, pick: 40, tid: 5, originalTid: 1, dpid: 60 }, rows: [row(2022, 5, 9)] });
		const L2 = league({
			season: 2024,
			players: [q1, q2, drafted],
			trades: [
				{ eid: 30, season: 2020, phase: 0, tids: [0, 1], assets: [[{ pid: 11, name: "Q1" }, { dpid: 60, season: 2021, round: 2, originalTid: 1 }], [{ pid: 12, name: "Q2" }, { dpid: 70, season: 2026, round: 1, originalTid: 0 }]] },
				{ eid: 31, season: 2021, phase: 1, tids: [5, 0], assets: [[{ dpid: 60, season: 2021, round: 2, originalTid: 1 }], []] },
				{ eid: 32, season: 2021, phase: 1, tids: [5, 6], assets: [[{ dpid: 80, season: 2020, round: 1, originalTid: 6 }], []] },
			],
		});
		const G2 = gradeTrades(L2);
		const [a, b] = G2.trades[0]!.sides;
		// all of Q1's rows lack win shares: unknown, not 0
		expect(a.items[0]).toMatchObject({ how: "traded", total: null });
		expect(a.unknown).toBe(true);
		expect(a.items[1]).toMatchObject({ how: "flipped", flipEid: 31, total: 0, pid: 13 });
		expect(a.grade).toBe(null);
		expect(a.net).toBe(null);
		// partial: one season known
		expect(b.items[0]).toMatchObject({ total: 4, partial: true });
		expect(b.partial).toBe(true);
		expect(b.items[1]).toMatchObject({ how: "pending", total: 0, living: true });
		expect(b.grade).toBe(null); // the other side is unknown
		// a used pick whose player is not on record
		expect(G2.trades[2]!.sides[0].items[0]).toMatchObject({ how: "unknown", total: null });
		const card0 = G2.cards.find((c) => c.tid === 0)!;
		// trade 30 is not graded, trade 31 (the pick for nothing, drafted by team 5) is
		expect(card0).toMatchObject({ n: 2, graded: 1, lost: 1, net: -9 });
		expect(G2.trades[1]!.sides[0]).toMatchObject({ net: 9 });
	});

	test("offseason trade: win shares from the next season, in-season split by statsIndex", () => {
		const p = player(21, {
			rows: [row(2020, 1, 3), row(2021, 0, 4)],
			transactions: [{ type: "trade", tid: 0, season: 2020, phase: PHASE.DRAFT, eid: 40 }],
		});
		const G3 = gradeTrades(league({ players: [p], trades: [{ eid: 40, season: 2020, phase: PHASE.DRAFT, tids: [0, 1], assets: [[{ pid: 21, name: "x", statsIndex: p.rows[0]!.i }], []] }] }));
		expect(G3.trades[0]!.h).toBe(2021);
		expect(G3.trades[0]!.sides[0].items[0]).toMatchObject({ now: 4, later: 0, total: 4 });
	});
});

describe("converter", () => {
	test("pre-draft rows are left out, indexes kept, missing win shares are unknown", () => {
		const p = {
			pid: 5,
			firstName: "A",
			lastName: "B",
			tid: 1,
			retiredYear: Infinity,
			born: { year: 2000, loc: "" },
			draft: { year: 2020, round: 1, pick: 3, tid: 1, originalTid: 1, dpid: 9 },
			stats: [
				{ season: 2020, tid: PLAYER.DOES_NOT_EXIST, playoffs: false, gp: 30, min: 900, ows: 3, dws: 2 },
				{ season: 2021, tid: 1, playoffs: false, gp: 60, min: 1500, ows: 1, dws: 1.5 },
				{ season: 2022, tid: 1, playoffs: false, gp: 60, min: 1500 },
			],
			transactions: [],
			contracts: [],
		} as unknown as Player;
		const v = toVPlayer(p);
		expect(v.rows.map((r) => [r.i, r.season, r.ws])).toEqual([
			[1, 2021, 2.5],
			[2, 2022, null],
		]);
	});
});

const contract = (start: number, amounts: number[], tid: number, o: Partial<VContract> = {}): VContract => ({
	type: "freeAgent",
	start,
	amounts,
	payments: amounts.map((amount, k) => ({ season: start + k, tid, amount })),
	...o,
});

describe("contract value", () => {
	test("value index against the league rate, unknown seasons left out", () => {
		const a = player(1, { rows: [row(2020, 0, 10)], contracts: [contract(2020, [10000], 0)] });
		const b = player(2, { rows: [row(2020, 1, 0)], contracts: [contract(2020, [5000], 1)] });
		const c = player(3, { rows: [row(2020, 1, null)], contracts: [contract(2020, [5000], 1)] });
		const cv = computeContractValue(league({ season: 2021, phase: PHASE.PRESEASON, players: [a, b, c] }));
		expect(cv.lastDone).toBe(2020);
		expect(cv.rate.get(2020)).toBeCloseTo(10 / 15);
		const ra = cv.rows.find((r) => r.pid === 1)!;
		expect(ra.index).toBeCloseTo(1.5);
		expect(ra.surplus).toBeCloseTo(10 - 10 * (10 / 15));
		expect(cv.rows.find((r) => r.pid === 2)!.index).toBe(0);
		expect(cv.rows.some((r) => r.pid === 3)).toBe(false);
		expect(cv.unknownCount).toBe(1);
		const ts = cv.teamSeasons.find((t) => t.tid === 0)!;
		expect(ts.index).toBeCloseTo(1.5);
		// team 1: one known and one unknown row, half known is enough
		expect(cv.teamSeasons.find((t) => t.tid === 1)!.ws).toBe(0);
		expect(teamEfficiency(cv)[0]!.tid).toBe(0);
	});

	test("the season in progress is not ranked", () => {
		const a = player(1, { rows: [row(2020, 0, 5), row(2021, 0, 5)], contracts: [contract(2020, [1000, 1000], 0)] });
		const cv = computeContractValue(league({ season: 2021, phase: PHASE.REGULAR_SEASON, players: [a] }));
		expect(cv.rows.map((r) => r.season)).toEqual([2020]);
	});

	test("dead money: seasons a released player didn't play for the team", () => {
		const released = contract(2020, [8000, 8000, 8000, 8000], 0, {
			payments: [
				{ season: 2020, tid: 0, amount: 8000 },
				{ season: 2021, tid: 0, amount: 8000 },
			],
			endedEarly: { season: 2021, phase: PHASE.PRESEASON, reason: "released", tid: 0 },
		});
		const p = player(1, {
			rows: [row(2020, 0, 1), row(2021, 4, 2)],
			contracts: [released, contract(2021, [750], 4)],
		});
		const cv = computeContractValue(league({ season: 2022, phase: PHASE.REGULAR_SEASON, players: [p] }));
		expect(cv.dead.map((d) => [d.tid, d.season, d.amount, d.owed])).toEqual([
			[0, 2021, 8000, false],
			[0, 2022, 8000, true],
			[0, 2023, 8000, true],
		]);
		// his 2021 salary is only what his new team paid
		expect(cv.rows.find((r) => r.season === 2021)!.amount).toBe(750);
		const byTeam = deadByTeam(cv);
		expect(byTeam[0]).toMatchObject({ tid: 0, paid: 8000, owed: 16000, releases: 1, lastOwed: 2023 });
		const deal = cv.deals.find((d) => d.start === 2020)!;
		expect(deal).toMatchObject({ released: true, elapsed: 1, paid: 8000, dead: 24000 });
		// the team's 2021 payroll doesn't include the dead money
		expect(cv.teamSeasons.find((t) => t.tid === 0 && t.season === 2021)).toBe(undefined);
		expect(cv.teamSeasons.find((t) => t.tid === 4 && t.season === 2021)!.payroll).toBe(750);
	});

	test("albatross and bargain selection", () => {
		const players: VPlayer[] = [];
		// 10 deals of 2 seasons: pid k earns k * 1000 per year and produces 4 WS a year; pid 10 (the biggest) produces 0
		for (let k = 1; k <= 10; k++) {
			players.push(
				player(k, {
					rows: [row(2020, k % 3, k === 10 ? 0 : 4), row(2021, k % 3, k === 10 ? 0 : 4)],
					contracts: [contract(2020, [k * 1000, k * 1000], k % 3)],
				}),
			);
		}
		const cv = computeContractValue(league({ season: 2022, phase: PHASE.PRESEASON, players }));
		const alb = albatross(cv);
		// top 20% of salaries: pids 9 and 10; both under the league rate, 10 is worse
		expect(alb.map((c) => c.pid)).toEqual([10, 9]);
		expect(alb[0]!.cost).toBeCloseTo(20000);
		expect(albatross(cv, { tid: 0 }).map((c) => c.pid)).toEqual([9]);
		const bs = bargains(cv);
		expect(bs.map((x) => x.season)).toEqual([2021, 2020]);
		expect(bs[0]!.best!.pid).toBe(1);
		// worst big-money season (top 15% of salaries): pid 10
		expect(bs[0]!.worst!.pid).toBe(10);
		expect(valueSeasons(cv, "surplus").best[0]!.pid).toBe(1);
		expect(valueDeals(cv, "index").worst[0]!.pid).toBe(10);
		expect(valueDeals(cv, "surplus", { season: 2021, tid: 1 }).best.every((c) => c.tids.includes(1))).toBe(true);
	});

	test("contract year", () => {
		const p = player(1, {
			bornYear: 1990,
			rows: [row(2018, 0, 2, { min: 2400 }), row(2019, 0, 2, { min: 2400 }), row(2020, 0, 6, { min: 2400 }), row(2021, 2, 3, { min: 2400 })],
			contracts: [contract(2018, [1000, 1000, 1000], 0), contract(2021, [5000], 2)],
		});
		const cy = contractYear(computeContractValue(league({ season: 2022, phase: PHASE.PRESEASON, players: [p] })));
		expect(cy.n).toBe(1);
		expect(cy.rows[0]!.before).toBeCloseTo(0.04);
		expect(cy.rows[0]!.final).toBeCloseTo(0.12);
		expect(cy.rows[0]!.after).toBeCloseTo(0.06);
		expect(cy.rows[0]!.age).toBe(30);
		expect(cy.up).toBe(1);
	});
});
