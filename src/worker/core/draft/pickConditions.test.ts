import { assert, beforeAll, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import type {
	DraftPick,
	TradePickCondition,
	TradeTeams,
} from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";
import {
	draftPickConditionText,
	getTradePickConditions,
	parseRollover,
	protectionText,
	validatePickConditionSpec,
} from "../../../common/draftPickConditions.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local } from "../../util/index.ts";
import { player, team } from "../index.ts";
import {
	CONDITION_SURVIVE_PROB,
	getFallbackDeliveredProb,
	protectedTradeValue,
	swapTradeValue,
	ValueChangeCalculator,
} from "../team/ValueChangeCalculator.ts";
import makeItWork, { getConditionVariants } from "../trade/makeItWork.ts";
import processTrade from "../trade/processTrade.ts";
import { resolvePickConditionsPure } from "./pickConditions.ts";

const dp = (x: Partial<DraftPick> & { dpid: number }): DraftPick => ({
	tid: 0,
	originalTid: 0,
	round: 1,
	pick: 0,
	season: 2025,
	...x,
});

const teamName = (tid: number) => `T${tid}`;

const AI_PICK_TIDS = [0];

describe("resolvePickConditionsPure", () => {
	test("protected pick conveys when outside the protection", () => {
		const pick = dp({
			dpid: 1,
			tid: 5,
			originalTid: 0,
			pick: 11,
			protection: { tid: 0, top: 10, rollover: [8], then: "unprotected" },
		});
		const { changed, messages } = resolvePickConditionsPure({
			draftPicks: [pick],
			futurePicks: [],
			teamName,
		});
		assert.strictEqual(pick.tid, 5);
		assert.isUndefined(pick.protection);
		assert.deepEqual(changed, [pick]);
		assert.include(messages[0]!.text, "conveyed to the T5");
	});

	test("protected pick is retained and rolls over with the next protection", () => {
		const pick = dp({
			dpid: 1,
			tid: 5,
			pick: 4,
			protection: { tid: 0, top: 10, rollover: [8], then: "unprotected" },
		});
		const next = dp({ dpid: 2, season: 2026 });
		const { changed, messages } = resolvePickConditionsPure({
			draftPicks: [pick],
			futurePicks: [next],
			teamName,
		});
		assert.strictEqual(pick.tid, 0);
		assert.strictEqual(next.tid, 5);
		assert.deepEqual(next.protection, {
			tid: 0,
			top: 8,
			rollover: [],
			then: "unprotected",
		});
		assert.strictEqual(changed.length, 2);
		assert.include(messages[0]!.text, "keep it");
		assert.include(messages[0]!.text, "top 8 protected");

		// Next year it's protected again, so the last step applies: unprotected
		next.pick = 2;
		const next2 = dp({ dpid: 3, season: 2027 });
		resolvePickConditionsPure({
			draftPicks: [next],
			futurePicks: [next2],
			teamName,
		});
		assert.strictEqual(next.tid, 0);
		assert.strictEqual(next2.tid, 5);
		assert.isUndefined(next2.protection);
	});

	test("converts to a 2nd round pick, or is extinguished", () => {
		const pick = dp({
			dpid: 1,
			tid: 5,
			pick: 3,
			protection: { tid: 0, top: 5, rollover: [], then: "secondRound" },
		});
		const second = dp({ dpid: 2, season: 2026, round: 2 });
		const first = dp({ dpid: 3, season: 2026, round: 1 });
		resolvePickConditionsPure({
			draftPicks: [pick],
			futurePicks: [first, second],
			teamName,
		});
		assert.strictEqual(pick.tid, 0);
		assert.strictEqual(second.tid, 5);
		assert.strictEqual(first.tid, 0);

		const pick2 = dp({
			dpid: 4,
			tid: 5,
			pick: 3,
			protection: { tid: 0, top: 5, rollover: [], then: "extinguish" },
		});
		const future = dp({ dpid: 5, season: 2026 });
		const { messages } = resolvePickConditionsPure({
			draftPicks: [pick2],
			futurePicks: [future],
			teamName,
		});
		assert.strictEqual(pick2.tid, 0);
		assert.strictEqual(future.tid, 0);
		assert.include(messages[0]!.text, "extinguished");
	});

	test("rollover pick no longer owned extinguishes the obligation", () => {
		const pick = dp({
			dpid: 1,
			tid: 5,
			pick: 3,
			protection: { tid: 0, top: 5, rollover: [3], then: "unprotected" },
		});
		const future = dp({ dpid: 2, season: 2026, tid: 7 });
		const { messages } = resolvePickConditionsPure({
			draftPicks: [pick],
			futurePicks: [future],
			teamName,
		});
		assert.strictEqual(pick.tid, 0);
		assert.strictEqual(future.tid, 7);
		assert.include(messages[0]!.text, "no longer own");
	});

	test("swap executes only when the other pick is better", () => {
		// T1 has the right to swap with T2's pick
		const t2Pick = dp({
			dpid: 1,
			tid: 2,
			originalTid: 2,
			pick: 3,
			swap: { tid: 1 },
		});
		const t1Pick = dp({ dpid: 2, tid: 1, originalTid: 1, pick: 20 });
		const { messages } = resolvePickConditionsPure({
			draftPicks: [t2Pick, t1Pick],
			futurePicks: [],
			teamName,
		});
		assert.strictEqual(t2Pick.tid, 1);
		assert.strictEqual(t1Pick.tid, 2);
		assert.isUndefined(t2Pick.swap);
		assert.include(messages[0]!.text, "exercised");

		const t4Pick = dp({
			dpid: 3,
			tid: 4,
			originalTid: 4,
			pick: 25,
			swap: { tid: 3 },
		});
		const t3Pick = dp({ dpid: 4, tid: 3, originalTid: 3, pick: 2 });
		const result = resolvePickConditionsPure({
			draftPicks: [t4Pick, t3Pick],
			futurePicks: [],
			teamName,
		});
		assert.strictEqual(t4Pick.tid, 4);
		assert.strictEqual(t3Pick.tid, 3);
		assert.include(result.messages[0]!.text, "kept their own");
	});

	test("swap right on a pick the swapping team now owns just goes away, with no lapsed message", () => {
		const pick = dp({
			dpid: 1,
			tid: 3,
			originalTid: 0,
			pick: 2,
			swap: { tid: 3 },
		});
		const own = dp({ dpid: 2, tid: 3, originalTid: 3, pick: 20 });
		const { changed, messages } = resolvePickConditionsPure({
			draftPicks: [pick, own],
			futurePicks: [],
			teamName,
		});
		assert.isUndefined(pick.swap);
		assert.strictEqual(pick.tid, 3);
		assert.strictEqual(own.tid, 3);
		assert.deepEqual(changed, [pick]);
		assert.lengthOf(messages, 0);
	});
});

describe("condition helpers", () => {
	test("text", () => {
		assert.strictEqual(
			protectionText({ top: 10, rollover: [8], then: "unprotected" }),
			"top 10 protected (then top 8, then unprotected)",
		);
		assert.strictEqual(
			draftPickConditionText(
				dp({
					dpid: 1,
					protection: { tid: 3, top: 5, rollover: [], then: "extinguish" },
				}),
				(tid) => `A${tid}`,
			),
			"top 5 protected (then extinguished), else to A3",
		);
		assert.deepEqual(parseRollover("8, 5 -> 3"), [8, 5, 3]);
	});

	test("validation", () => {
		const spec = {
			type: "protection" as const,
			top: 10,
			rollover: [],
			then: "unprotected" as const,
		};
		assert.isUndefined(validatePickConditionSpec(spec, dp({ dpid: 1 }), 30));
		assert.isDefined(
			validatePickConditionSpec(spec, dp({ dpid: 1, round: 2 }), 30),
		);
		assert.isDefined(
			validatePickConditionSpec({ ...spec, top: 30 }, dp({ dpid: 1 }), 30),
		);
		assert.isDefined(
			validatePickConditionSpec(spec, dp({ dpid: 1, season: "fantasy" }), 30),
		);
		assert.isDefined(
			validatePickConditionSpec(spec, dp({ dpid: 1, pick: 4 }), 30),
		);
		assert.isDefined(
			validatePickConditionSpec(spec, dp({ dpid: 1, swap: { tid: 2 } }), 30),
		);
	});

	test("valuation math", () => {
		const probs = [0.25, 0.25, 0.25, 0.25];
		const values = [10, 6, 3, 1];
		const unprotected = 5;
		const top2 = protectedTradeValue(probs, values, {
			top: 2,
			rollover: [],
			then: "extinguish",
		});
		assert.closeTo(top2.tradeValue, 1, 1e-9);
		assert.closeTo(top2.probConvey, 0.5, 1e-9);
		const top2Unprotected = protectedTradeValue(probs, values, {
			top: 2,
			rollover: [],
			then: "unprotected",
		});
		assert.isAbove(top2Unprotected.tradeValue, top2.tradeValue);
		assert.isBelow(top2Unprotected.tradeValue, unprotected);
		const top1 = protectedTradeValue(probs, values, {
			top: 1,
			rollover: [],
			then: "extinguish",
		});
		assert.isAbove(top1.tradeValue, top2.tradeValue);

		// Better of two picks is at least as good as either one
		const max = swapTradeValue(probs, values, [0, 0, 0, 1], values, "max");
		assert.closeTo(max, 5, 1e-9);
		const min = swapTradeValue(probs, values, [1, 0, 0, 0], values, "min");
		assert.closeTo(min, 5, 1e-9);
	});

	test("conditions survive a league file round trip", () => {
		const pick = dp({
			dpid: 1,
			protection: { tid: 1, top: 10, rollover: [8], then: "secondRound" },
			swap: { tid: 3 },
		});
		// eslint-disable-next-line unicorn/prefer-structured-clone -- testing the JSON round trip of a league file
		assert.deepEqual(JSON.parse(JSON.stringify(pick)), pick);
	});
});

const NUM_TEAMS = 30;

describe("with a league", () => {
	const dpids: number[][] = [];

	beforeAll(async () => {
		resetG();
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		g.setWithoutSavingToDB("featureDraftPickConditions", true);
		const season = g.get("season");

		const players = [];
		for (let tid = 0; tid < NUM_TEAMS; tid++) {
			for (let i = 0; i < 10; i++) {
				const p = player.generate(tid, 25, season - 5, true, DEFAULT_LEVEL);
				last(p.ratings).ovr = 40 + tid;
				p.value = 40 + tid;
				players.push(p);
			}
		}
		for (let i = 0; i < NUM_TEAMS * 2 + 10; i++) {
			const p = player.generate(
				PLAYER.UNDRAFTED,
				19,
				season,
				false,
				DEFAULT_LEVEL,
			);
			p.value = 73.5 - 17.5 * Math.sqrt(i / 60);
			players.push(p);
		}

		await resetCache({
			players,
			teams: helpers.getTeamsDefault().map(team.generate),
		});
		idb.league = mockIDBLeague();
		local.playerOvrMeanStdStale = true;

		for (let tid = 0; tid < NUM_TEAMS; tid++) {
			dpids[tid] = [];
			for (let round = 1; round <= 2; round++) {
				dpids[tid]![round] = await idb.cache.draftPicks.add({
					tid,
					originalTid: tid,
					round,
					pick: 0,
					season,
				});
			}
		}
	});

	const evaluate = (
		tid: number,
		dpid: number,
		condition?: TradePickCondition[],
	) =>
		new ValueChangeCalculator().evaluate({
			tid,
			pidsAdd: [],
			pidsRemove: [],
			dpidsAdd: [dpid],
			dpidsRemove: [],
			tradingPartnerTid: 16,
			pickConditions: condition?.map((c) => ({ ...c, tid })),
		});

	test("protected picks are worth less, more protection is worth less", async () => {
		// Worst team's pick
		const dpid = dpids[0]![1]!;
		const unprotected = await evaluate(15, dpid);
		const top3 = await evaluate(15, dpid, [
			{ type: "protection", dpid, top: 3, rollover: [], then: "extinguish" },
		]);
		const top14 = await evaluate(15, dpid, [
			{ type: "protection", dpid, top: 14, rollover: [], then: "extinguish" },
		]);
		const top14Rollover = await evaluate(15, dpid, [
			{
				type: "protection",
				dpid,
				top: 14,
				rollover: [10],
				then: "unprotected",
			},
		]);
		assert.isBelow(top3, unprotected);
		assert.isBelow(top14, top3);
		assert.isAbove(top14Rollover, top14);

		// A good team's pick barely changes with a top 3 protection
		const goodDpid = dpids[29]![1]!;
		const goodUnprotected = await evaluate(15, goodDpid);
		const goodTop3 = await evaluate(15, goodDpid, [
			{
				type: "protection",
				dpid: goodDpid,
				top: 3,
				rollover: [],
				then: "extinguish",
			},
		]);
		assert.isAtMost(goodTop3, goodUnprotected);
		assert.isAbove(goodTop3 - top3, goodUnprotected - unprotected);
	});

	test("swap rights are valuable for a good team swapping with a bad team, not vice versa", async () => {
		// Team 29 (best) gets the right to swap with team 1's (bad) pick
		const good = await evaluate(29, dpids[1]![1]!, [
			{ type: "swap", dpid: dpids[1]![1]! },
		]);
		// Team 1 gets the right to swap with team 28's pick
		const bad = await evaluate(1, dpids[28]![1]!, [
			{ type: "swap", dpid: dpids[28]![1]! },
		]);
		const full = await evaluate(29, dpids[1]![1]!);
		assert.isAbove(good, bad);
		assert.isBelow(good, full);
	});

	test("process and undo a trade with a protected pick and a swap", async () => {
		g.setWithoutSavingToDB("userTid", 0);
		g.setWithoutSavingToDB("userTids", [0]);
		await idb.cache.trade.put({
			rid: 0,
			teams: [
				{ tid: 0, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
				{ tid: 1, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
			],
		});
		const protectedDpid = dpids[0]![1]!;
		const swapDpid = dpids[1]![1]!;
		const teams: TradeTeams = [
			{
				tid: 0,
				pids: [],
				pidsExcluded: [],
				dpids: [protectedDpid],
				dpidsExcluded: [],
				pickConditions: [
					{
						type: "protection",
						dpid: protectedDpid,
						top: 10,
						rollover: [8],
						then: "secondRound",
					},
				],
			},
			{
				tid: 1,
				pids: [],
				pidsExcluded: [],
				dpids: [swapDpid],
				dpidsExcluded: [],
				pickConditions: [{ type: "swap", dpid: swapDpid }],
			},
		];
		const undo = await processTrade(teams, undefined);

		const p = (await idb.cache.draftPicks.get(protectedDpid))!;
		assert.strictEqual(p.tid, 1);
		assert.deepEqual(p.protection, {
			tid: 0,
			top: 10,
			rollover: [8],
			then: "secondRound",
		});
		const s = (await idb.cache.draftPicks.get(swapDpid))!;
		assert.strictEqual(s.tid, 1);
		assert.deepEqual(s.swap, { tid: 0 });

		const event = (await idb.cache.events.getAll()).at(-1)!;
		assert.strictEqual(event.type, "trade");
		if (event.type === "trade") {
			const assets = event.teams!.flatMap((t) => t.assets);
			assert.isTrue(
				assets.some(
					(a) => "dpid" in a && a.condition?.includes("top 10 protected"),
				),
			);
			assert.isTrue(assets.some((a) => "dpid" in a && a.swap));
		}

		assert.isTrue(await undo());
		const p2 = (await idb.cache.draftPicks.get(protectedDpid))!;
		assert.strictEqual(p2.tid, 0);
		assert.isUndefined(p2.protection);
		const s2 = (await idb.cache.draftPicks.get(swapDpid))!;
		assert.strictEqual(s2.tid, 1);
		assert.isUndefined(s2.swap);
	});

	test("a rollover the original team can't deliver is valued like an extinguished obligation", async () => {
		const dpid = dpids[2]![1]!;
		const rollover: TradePickCondition = {
			type: "protection",
			dpid,
			top: 14,
			rollover: [10],
			then: "unprotected",
		};
		const extinguish: TradePickCondition = {
			type: "protection",
			dpid,
			top: 14,
			rollover: [],
			then: "extinguish",
		};
		const beyondHorizon = await evaluate(15, dpid, [rollover]);
		const extinguished = await evaluate(15, dpid, [extinguish]);
		assert.isAbove(beyondHorizon, extinguished);

		// Next year's pick already belongs to someone else, so nothing can roll over
		const nextDpid = await idb.cache.draftPicks.add({
			tid: 7,
			originalTid: 2,
			round: 1,
			pick: 0,
			season: g.get("season") + 1,
		});
		const traded = await evaluate(15, dpid, [rollover]);
		assert.closeTo(traded, extinguished, 1e-6);

		// Owned, so it's worth something again
		const next = (await idb.cache.draftPicks.get(nextDpid))!;
		next.tid = 2;
		await idb.cache.draftPicks.put(next);
		const owned = await evaluate(15, dpid, [rollover]);
		assert.isAbove(owned, extinguished);

		await idb.cache.draftPicks.delete(nextDpid);
	});

	test("getFallbackDeliveredProb", () => {
		const season = 2030;
		const base = { season, round: 1, originalTid: 4 };
		const prot = { rollover: [5], then: "unprotected" as const };
		const next = dp({ dpid: 50, season: season + 1, originalTid: 4, tid: 4 });
		const next2 = dp({
			dpid: 51,
			season: season + 1,
			originalTid: 4,
			tid: 4,
			round: 2,
		});
		assert.strictEqual(
			getFallbackDeliveredProb(base, prot, 4, [next], new Set()),
			CONDITION_SURVIVE_PROB,
		);
		// Being traded away in this same trade
		assert.strictEqual(
			getFallbackDeliveredProb(base, prot, 4, [next], new Set([50])),
			0,
		);
		// Owned by another team
		assert.strictEqual(
			getFallbackDeliveredProb(base, prot, 4, [{ ...next, tid: 9 }], new Set()),
			0,
		);
		// 2nd round conversion looks at the 2nd round pick
		assert.strictEqual(
			getFallbackDeliveredProb(
				base,
				{ rollover: [], then: "secondRound" },
				4,
				[next, { ...next2, tid: 9 }],
				new Set(),
			),
			0,
		);
		// Not generated yet
		assert.strictEqual(
			getFallbackDeliveredProb(base, prot, 4, [], new Set()),
			CONDITION_SURVIVE_PROB,
		);
		const probs = [0.5, 0.5];
		const values = [10, 2];
		const full = protectedTradeValue(probs, values, {
			top: 1,
			rollover: [1],
			then: "unprotected",
		});
		const none = protectedTradeValue(
			probs,
			values,
			{ top: 1, rollover: [1], then: "unprotected" },
			0,
		);
		assert.closeTo(none.tradeValue, 1, 1e-9);
		assert.isAbove(full.tradeValue, none.tradeValue);
	});

	test("AI condition variants: protections on its 1sts and swap rights", async () => {
		const teams: TradeTeams = [
			{ tid: 3, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
			{ tid: 0, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
		];
		const aiPicks = await idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			0,
		);
		let i = 0;
		const variants = await getConditionVariants(teams, aiPicks, () => {
			i += 1;
			return (i * 0.37) % 1;
		});
		const protections = variants.filter(
			(v) => v.condition.type === "protection",
		);
		const swaps = variants.filter((v) => v.condition.type === "swap");
		assert.isAbove(protections.length, 0);
		assert.isAbove(swaps.length, 0);
		for (const v of protections) {
			assert.strictEqual(v.dp.round, 1);
			assert.isUndefined(
				validatePickConditionSpec(v.condition, v.dp, g.get("numActiveTeams")),
			);
		}
		for (const v of variants) {
			assert.include(AI_PICK_TIDS, v.dp.tid);
		}

		// Partner already trading its own pick: no swap on that pick
		const partnerPick = dpids[3]![1]!;
		const variants2 = await getConditionVariants(
			[{ ...teams[0], dpids: [partnerPick] }, teams[1]],
			aiPicks.filter((dp) => dp.round === 1),
		);
		assert.isFalse(variants2.some((v) => v.condition.type === "swap"));
	});

	test("makeItWork with AI pick conditions gives a trade the AI likes, with valid conditions", async () => {
		const valueChangeCalculator = new ValueChangeCalculator();
		const players3 = await idb.cache.players.indexGetAll("playersByTid", 3);
		for (let k = 0; k < 5; k++) {
			const teams = await makeItWork(
				[
					{
						tid: 3,
						pids: [players3[k]!.pid],
						pidsExcluded: [],
						dpids: [],
						dpidsExcluded: [],
					},
					{ tid: 0, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
				],
				{
					holdUserConstant: true,
					valueChangeCalculator,
					aiPickConditions: true,
				},
			);
			if (!teams) {
				continue;
			}
			for (const c of teams[1].pickConditions ?? []) {
				assert.include(teams[1].dpids, c.dpid);
				assert.strictEqual(c.tid, 3);
			}
			const dv = await valueChangeCalculator.evaluate({
				tid: 0,
				pidsAdd: teams[0].pids,
				pidsRemove: teams[1].pids,
				dpidsAdd: teams[0].dpids,
				dpidsRemove: teams[1].dpids,
				tradingPartnerTid: 3,
				pickConditions: getTradePickConditions(teams),
			});
			assert.isAbove(dv, 0);
		}
	});

	test("a trade can't be undone once the draft order settled a condition in it", async () => {
		await idb.cache.trade.put({
			rid: 0,
			teams: [
				{ tid: 0, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
				{ tid: 1, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
			],
		});
		const protectedDpid = dpids[0]![1]!;
		const undo = await processTrade(
			[
				{
					tid: 0,
					pids: [],
					pidsExcluded: [],
					dpids: [protectedDpid],
					dpidsExcluded: [],
					pickConditions: [
						{
							type: "protection",
							dpid: protectedDpid,
							top: 5,
							rollover: [],
							then: "extinguish",
						},
					],
				},
				{ tid: 1, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
			],
			undefined,
		);

		// Draft order: conveys, so the pick stays with team 1 but its protection is gone
		const dp = (await idb.cache.draftPicks.get(protectedDpid))!;
		dp.pick = 20;
		resolvePickConditionsPure({
			draftPicks: [dp],
			futurePicks: [],
			teamName,
		});
		await idb.cache.draftPicks.put(dp);

		const result = await undo();
		assert.isString(result);
		const after = (await idb.cache.draftPicks.get(protectedDpid))!;
		assert.strictEqual(after.tid, 1);
		dp.pick = 0;
		await idb.cache.draftPicks.put(dp);
	});
});
