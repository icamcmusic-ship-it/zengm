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
import makeItWork, { getPickTermsVariants } from "./makeItWork.ts";
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
});
