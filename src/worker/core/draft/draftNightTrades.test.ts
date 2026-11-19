import { afterAll, assert, beforeAll, describe, test, vi } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { mockIDBLeague } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, local } from "../../util/index.ts";
import { draft, player } from "../index.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import {
	acceptDraftNightOffer,
	aiAttemptChance,
	cheapestTopUp,
	DRAFT_NIGHT_NOTE_PREFIX,
	getDraftNightOffers,
	getPickValueChart,
	MAX_AI_TRADES_PER_DRAFT,
	maybeAiDraftNightTrade,
	mostWithinBudget,
	tradeUpUrgency,
} from "./draftNightTrades.ts";
import { loadTeamSeasons } from "./testHelpers.ts";

describe("pricing helpers", () => {
	test("cheapestTopUp takes the cheapest single extra that is enough", () => {
		const extras = [
			{ id: 1, value: 1 },
			{ id: 2, value: 5 },
			{ id: 3, value: 10 },
		];
		assert.deepStrictEqual(cheapestTopUp(10, 10, extras), []);
		assert.deepStrictEqual(cheapestTopUp(10, 14, extras), [2]);
		assert.deepStrictEqual(cheapestTopUp(10, 11, extras), [1]);
		// Nothing alone is enough: the biggest, then the cheapest that finishes it
		assert.deepStrictEqual(cheapestTopUp(0, 12, extras), [3, 2]);
		// Too far apart, at most 2 extras
		assert.strictEqual(cheapestTopUp(0, 100, extras), undefined);
	});

	test("mostWithinBudget adds the most valuable extras that fit", () => {
		const extras = [
			{ id: 1, value: 1 },
			{ id: 2, value: 5 },
			{ id: 3, value: 10 },
		];
		assert.deepStrictEqual(mostWithinBudget(7, extras), [2, 1]);
		assert.deepStrictEqual(mostWithinBudget(20, extras), [3, 2]);
		assert.deepStrictEqual(mostWithinBudget(0.5, extras), []);
	});

	test("a team trades up only for a prospect who won't last but is still there at the new pick", () => {
		// Its top prospect is 3rd by consensus, its pick is 6th: likely gone
		assert.strictEqual(tradeUpUrgency(2, 0, 5), 3);
		// He should last until its own pick
		assert.strictEqual(tradeUpUrgency(7, 0, 5), 0);
		// He's likely gone before the pick it would move up to
		assert.strictEqual(tradeUpUrgency(1, 2, 5), 0);
	});

	test("attempts are rarer after the first round and scale with the AI trades setting", () => {
		assert(aiAttemptChance(1, 1) > aiAttemptChance(2, 1));
		assert.strictEqual(aiAttemptChance(1, 0), 0);
		assert.strictEqual(aiAttemptChance(1, 100), 1);
	});
});

const countDraftNightTrades = async () =>
	(await idb.cache.events.getAll()).filter(
		(e) => e.type === "trade" && e.note?.startsWith(DRAFT_NIGHT_NOTE_PREFIX),
	).length;

describe("in a draft", () => {
	beforeAll(async () => {
		await loadTeamSeasons();
		idb.league = mockIDBLeague();
		g.setWithoutSavingToDB("featureDraftNightTrades", true);
		g.setWithoutSavingToDB("phase", PHASE.DRAFT);
		// Rosters, so teams have needs and the trade AI has players to compare prospects to
		for (let tid = 0; tid < g.get("numTeams"); tid++) {
			for (let i = 0; i < 10; i++) {
				const p = player.generate(
					tid,
					22 + (i % 10),
					g.get("season") - 4,
					false,
					DEFAULT_LEVEL,
				);
				await player.develop(p, 0);
				await player.updateValues(p);
				await idb.cache.players.add(p);
			}
		}
		await draft.genPlayers(g.get("season"), DEFAULT_LEVEL);
		await draft.genOrder(false, undefined, "nba1994");
		local.playerOvrMeanStdStale = true;
		await idb.cache.trade.put({
			rid: 0,
			teams: [
				{ tid: 0, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
				{ tid: 1, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
			],
		});
	});
	afterAll(() => {
		// @ts-expect-error
		idb.league = undefined;
	});

	test("the chart has every pick of the draft, best first", async () => {
		const { rows } = await getPickValueChart();
		assert.strictEqual(rows.length, 60);
		for (let i = 1; i < rows.length; i++) {
			assert(rows[i]!.points <= rows[i - 1]!.points);
			assert(rows[i]!.typicalPoints <= rows[i - 1]!.typicalPoints);
		}
		assert(rows[0]!.points > rows[29]!.points);
		assert(rows[0]!.typicalPoints > 0);
	});

	test("AI trade attempts never draw from the main random stream", async () => {
		const prospects = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
		).sort((a, b) => b.value - a.value);
		const order = await draft.getOrder();
		const before = await countDraftNightTrades();
		const spy = vi.spyOn(Math, "random");
		g.setWithoutSavingToDB("aiTradesFactor", 100);
		try {
			// Every pick of the first round as if it were on the clock (all considered, not made)
			for (let i = 0; i < 30; i++) {
				const traded = await maybeAiDraftNightTrade(order.slice(i), prospects);
				if (traded) {
					break;
				}
			}
			assert.strictEqual(spy.mock.calls.length, 0);
		} finally {
			spy.mockRestore();
			g.setWithoutSavingToDB("aiTradesFactor", 1);
		}
		// Undo the possible trade's effect on the count check below
		assert((await countDraftNightTrades()) - before <= 1);
	});

	test("offers to the user are priced so the AI gains by its own valuation, and accepting one trades the picks", async () => {
		const userTid = g.get("userTid");
		const userDp = (await draft.getOrder()).find((dp) => dp.tid === userTid);
		assert(userDp);
		const { offers } = await getDraftNightOffers(userDp.dpid);
		const vcc = new ValueChangeCalculator();
		for (const offer of offers) {
			const dv = await vcc.evaluate({
				tid: offer.teams[1].tid,
				pidsAdd: [],
				pidsRemove: [],
				dpidsAdd: offer.teams[0].dpids,
				dpidsRemove: offer.teams[1].dpids,
				tradingPartnerTid: userTid,
			});
			assert(dv > 0, "AI side gains");
			assert(offer.teams[0].dpids.includes(userDp.dpid));
		}

		const offer = offers[0];
		if (offer) {
			const result = await acceptDraftNightOffer(offer.teams);
			assert.strictEqual(result.accepted, true);
			const dp = await idb.cache.draftPicks.get(userDp.dpid);
			assert.strictEqual(dp?.tid, offer.tid);
			for (const dpid of offer.teams[1].dpids) {
				assert.strictEqual(
					(await idb.cache.draftPicks.get(dpid))?.tid,
					userTid,
				);
			}
		}

		// A stale offer is refused
		if (offer) {
			const again = await acceptDraftNightOffer(offer.teams);
			assert.strictEqual(again.accepted, false);
		}
	});

	test("the whole draft runs with AI trades, a handful at most", async () => {
		await draft.runPicks({ type: "untilEnd" });
		assert.strictEqual((await draft.getOrder()).length, 0);
		const undrafted = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
		).filter((p) => p.draft.year === g.get("season"));
		assert.strictEqual(undrafted.length, 10);
		assert((await countDraftNightTrades()) <= MAX_AI_TRADES_PER_DRAFT);
	});
});
