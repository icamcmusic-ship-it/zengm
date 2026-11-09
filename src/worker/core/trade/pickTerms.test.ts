import { assert, beforeEach, describe, test } from "vitest";
import type {
	DraftPick,
	TradePickCondition,
	TradeTeams,
} from "../../../common/types.ts";
import {
	getPickConditionChanges,
	getProtectionLoosenings,
	pickConditionChangeText,
} from "../../../common/draftPickConditions.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import makeItWork, {
	getPickTermsVariants,
	withStartingProtections,
} from "./makeItWork.ts";
import {
	makeItWorkMulti,
	validateAssets,
	type MultiTeamTrade,
} from "./multiTeam.ts";
import { validatePickConditionSpec } from "../../../common/draftPickConditions.ts";
import type { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";

const dp = (x: Partial<DraftPick> & { dpid: number }): DraftPick => ({
	tid: 0,
	originalTid: 0,
	round: 1,
	pick: 0,
	season: 2027,
	...x,
});

const protection = (
	top: number,
	rollover: number[] = [],
): TradePickCondition => ({
	type: "protection",
	dpid: 1,
	tid: 1,
	top,
	rollover,
	then: "unprotected",
});

const tradeTeams = (userConditions?: TradePickCondition[]): TradeTeams => [
	{
		tid: 0,
		pids: [],
		pidsExcluded: [],
		dpids: [1],
		dpidsExcluded: [],
		...(userConditions ? { pickConditions: userConditions } : {}),
	},
	{ tid: 1, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
];

// The AI likes the trade only if the user's pick is at most top `maxTop` protected, and dislikes anything else being added
const mockCalculator = (maxTop: number, base = 0) =>
	({
		evaluate: (args: {
			pidsAdd: number[];
			pidsRemove: number[];
			dpidsAdd: number[];
			dpidsRemove: number[];
			pickConditions?: TradePickCondition[];
		}) => {
			if (
				args.pidsAdd.length + args.pidsRemove.length > 0 ||
				args.dpidsRemove.length > 0 ||
				args.dpidsAdd.length !== 1
			) {
				return Promise.resolve(-10);
			}
			const c = args.pickConditions?.find((c) => c.dpid === 1);
			const top = c?.type === "protection" ? c.top : 0;
			return Promise.resolve(base + (top <= maxTop ? 1 - top / 100 : -1));
		},
	}) as unknown as ValueChangeCalculator;

describe("AI asking for terms on the other team's picks", () => {
	beforeEach(async () => {
		resetG();
		await resetCache({});
		for (const pick of [dp({ dpid: 1 }), dp({ dpid: 2, round: 2 })]) {
			await idb.cache.draftPicks.put(pick);
		}
		g.setWithoutSavingToDB("featureDraftPickConditions", true);
		g.setWithoutSavingToDB("numActiveTeams", 30);
	});

	test("loosenings go from smallest to removing the protection", () => {
		const out = getProtectionLoosenings({
			type: "protection",
			top: 10,
			rollover: [8],
			then: "secondRound",
		});
		assert.deepEqual(out[0], {
			type: "protection",
			top: 10,
			rollover: [],
			then: "secondRound",
		});
		assert.strictEqual(out[1]?.then, "unprotected");
		assert.deepEqual(
			out.slice(2, -1).map((x) => x?.top),
			[8, 5, 3, 1],
		);
		assert.deepEqual(out[3]?.rollover, [5]);
		assert.isUndefined(out.at(-1));
	});

	test("change text", () => {
		const pick = "your 2027 1st";
		assert.strictEqual(
			pickConditionChangeText(protection(10), protection(5), pick),
			"They want the top 10 protection on your 2027 1st lowered to top 5.",
		);
		assert.include(
			pickConditionChangeText(protection(10), undefined, pick)!,
			"removed",
		);
		assert.include(
			pickConditionChangeText(undefined, protection(5), pick)!,
			"accept top 5 protected",
		);
		const changes = getPickConditionChanges(
			tradeTeams([protection(10)])[0],
			tradeTeams([protection(5)])[0],
		);
		assert.strictEqual(changes.length, 1);
		assert.strictEqual(
			getPickConditionChanges(
				tradeTeams([protection(10)])[0],
				tradeTeams([protection(10)])[0],
			).length,
			0,
		);
	});

	test("variants", async () => {
		const loosen = await getPickTermsVariants(
			tradeTeams([protection(10)]),
			true,
		);
		assert.isAbove(loosen.length, 1);
		assert.isUndefined(loosen.at(-1)!.condition);
		// Nothing to loosen on an unprotected pick, but a protection can be accepted
		assert.lengthOf(await getPickTermsVariants(tradeTeams(), true), 0);
		const accept = await getPickTermsVariants(tradeTeams(), false);
		assert.isAbove(accept.length, 0);
		assert.isTrue(accept.every((v) => v.condition?.type === "protection"));
	});

	test("makeItWork asks for the smallest loosening that works", async () => {
		const teams = await makeItWork(tradeTeams([protection(10)]), {
			holdUserConstant: false,
			valueChangeCalculator: mockCalculator(5),
		});
		assert.isDefined(teams);
		const c = teams![0].pickConditions?.find((c) => c.dpid === 1);
		assert.strictEqual(c?.type, "protection");
		assert.strictEqual(c?.type === "protection" && c.top, 5);
		assert.deepEqual(teams![0].dpids, [1]);
	});

	test("no changes asked when the feature is off", async () => {
		g.setWithoutSavingToDB("featureDraftPickConditions", false);
		const teams = await makeItWork(tradeTeams([protection(10)]), {
			holdUserConstant: false,
			valueChangeCalculator: mockCalculator(5),
		});
		assert.isUndefined(teams);
	});

	test("AI getting more than it needs accepts a protection", async () => {
		const teams = await makeItWork(tradeTeams(), {
			holdUserConstant: false,
			valueChangeCalculator: mockCalculator(30),
		});
		const c = teams?.[0].pickConditions?.find((c) => c.dpid === 1);
		assert.strictEqual(c?.type, "protection");
	});

	test("starting protections on picks the AI asks for", async () => {
		const always = await withStartingProtections(tradeTeams(), () => 0);
		assert.strictEqual(always[0].pickConditions?.[0]?.type, "protection");
		assert.strictEqual(always[0].pickConditions?.[0]?.tid, 1);
		const never = await withStartingProtections(tradeTeams(), () => 0.99);
		assert.isUndefined(never[0].pickConditions);
		g.setWithoutSavingToDB("featureDraftPickConditions", false);
		const off = await withStartingProtections(tradeTeams(), () => 0);
		assert.isUndefined(off[0].pickConditions);
	});

	test("validation of changes to a stored protection", () => {
		const pick = dp({
			dpid: 3,
			tid: 2,
			protection: { tid: 0, top: 10, rollover: [], then: "unprotected" },
		});
		const amend = {
			type: "protection" as const,
			top: 5,
			rollover: [],
			then: "unprotected" as const,
			amend: true as const,
		};
		// Protecting team in the trade
		assert.isUndefined(
			validatePickConditionSpec(amend, pick, 30, {
				participants: [0, 1, 2],
				toTid: 1,
			}),
		);
		assert.isUndefined(
			validatePickConditionSpec({ ...amend, top: 0 }, pick, 30, {
				participants: [0, 1, 2],
				toTid: 1,
			}),
		);
		// Protecting team not in the trade, or no info (2-team Trade page)
		assert.isDefined(
			validatePickConditionSpec(amend, pick, 30, {
				participants: [1, 2],
				toTid: 1,
			}),
		);
		assert.isDefined(validatePickConditionSpec(amend, pick, 30));
		// Pick going back to the protecting team
		assert.isDefined(
			validatePickConditionSpec(amend, pick, 30, {
				participants: [0, 2],
				toTid: 0,
			}),
		);
		// Nothing to change
		assert.isDefined(
			validatePickConditionSpec(amend, { ...pick, protection: undefined }, 30, {
				participants: [0, 1, 2],
				toTid: 1,
			}),
		);
		// A new condition still can't go on a protected pick
		assert.isDefined(
			validatePickConditionSpec({ ...amend, amend: undefined }, pick, 30),
		);
	});

	describe("3-team trades", () => {
		// Team 1 wants dpid 1 (new protection) and dpid 3 (stored protection held by the user) protected at most top maxTop
		const multiCalculator = (maxTop: number) =>
			({
				evaluate: (args: {
					tid: number;
					pickConditions?: TradePickCondition[];
				}) => {
					if (args.tid !== 1) {
						return Promise.resolve(1);
					}
					let dv = 1;
					for (const [dpid, storedTop] of [
						[1, 0],
						[3, 10],
					] as const) {
						const c = args.pickConditions?.find((c) => c.dpid === dpid);
						const top = c?.type === "protection" ? c.top : storedTop;
						if (top > maxTop) {
							dv -= 2;
						}
						dv -= top / 100;
					}
					return Promise.resolve(dv);
				},
			}) as unknown as ValueChangeCalculator;

		beforeEach(async () => {
			await idb.cache.draftPicks.put(
				dp({
					dpid: 3,
					tid: 2,
					originalTid: 2,
					protection: { tid: 0, top: 10, rollover: [], then: "unprotected" },
				}),
			);
		});

		test("asks to loosen a new protection and a stored one held by the user", async () => {
			const trade: MultiTeamTrade = {
				tids: [0, 1, 2],
				assets: [
					{
						type: "pick",
						id: 1,
						fromTid: 0,
						toTid: 1,
						condition: {
							type: "protection",
							top: 10,
							rollover: [],
							then: "unprotected",
						},
					},
					{ type: "pick", id: 3, fromTid: 2, toTid: 1 },
				],
			};
			assert.isUndefined(await validateAssets(trade));
			const result = await makeItWorkMulti(trade, 0, multiCalculator(5));
			assert.isTrue(result.changed);
			const c1 = result.trade.assets.find((a) => a.id === 1)!.condition;
			const c3 = result.trade.assets.find((a) => a.id === 3)!.condition;
			assert.strictEqual(c1?.type === "protection" && c1.top, 5);
			assert.isTrue(c3?.type === "protection" && c3.amend && c3.top === 5);
			assert.isUndefined(await validateAssets(result.trade));
			assert.include(result.message, "lowered to top 5");
			assert.include(result.message, "existing top 10 protection");
		});

		test("nothing to change", async () => {
			const trade: MultiTeamTrade = {
				tids: [0, 1, 2],
				assets: [{ type: "pick", id: 1, fromTid: 0, toTid: 1 }],
			};
			const result = await makeItWorkMulti(trade, 0, multiCalculator(-1));
			assert.isFalse(result.changed);
			assert.strictEqual(result.trade, trade);
		});
	});
});
