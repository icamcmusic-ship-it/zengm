import { assert, beforeAll, describe, test } from "vitest";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { PHASE } from "../../../common/constants.ts";
import { beforeTests } from "./testHelpers.ts";
import {
	addAiOffer,
	buildAiOffer,
	chooseOfferTarget,
	getDailyOfferProbability,
	getOfferReasonText,
	pruneAiOffers,
	type OfferTargetCandidate,
} from "./aiOffers.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";

const first = () => 0;

const candidates: OfferTargetCandidate[] = [
	{ kind: "player", id: 1, age: 31, value: 70, onTradingBlock: false },
	{ kind: "player", id: 2, age: 21, value: 55, onTradingBlock: false },
	{ kind: "pick", id: 10, age: 0, value: 50, onTradingBlock: false },
];

describe("AI trade offers to the user", () => {
	beforeAll(beforeTests);

	test("trading block comes first", () => {
		const target = chooseOfferTarget(
			"contending",
			[
				...candidates,
				{ kind: "player", id: 3, age: 26, value: 40, onTradingBlock: true },
			],
			first,
		);
		assert.strictEqual(target?.reason, "tradingBlock");
		assert.strictEqual(target?.candidate.id, 3);
	});

	test("contenders want veterans, rebuilders want youth and picks", () => {
		const contender = chooseOfferTarget("contending", candidates, first);
		assert.strictEqual(contender?.reason, "contenderNeed");
		assert.strictEqual(contender?.candidate.id, 1);

		const rebuilderIds = new Set<number>();
		for (const index of [0, 1]) {
			const target = chooseOfferTarget("rebuilding", candidates, () => index);
			assert.strictEqual(target?.reason, "rebuilderNeed");
			rebuilderIds.add(target!.candidate.id);
		}
		assert.deepEqual([...rebuilderIds].sort(), [10, 2]);

		assert.isUndefined(chooseOfferTarget("contending", [], first));
	});

	test("reason text and frequency", () => {
		assert.include(
			getOfferReasonText("tradingBlock", "Team", "Joe"),
			"trading block",
		);
		assert.strictEqual(getDailyOfferProbability(0), 0);
		assert.strictEqual(getDailyOfferProbability(1), 0.1);
		assert.strictEqual(getDailyOfferProbability(100), 1);
	});

	test("offers are stored, routed user -> AI, and pruned when assets move", async () => {
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		g.setWithoutSavingToDB("aiTradeOffers", []);

		const userPlayers = await idb.cache.players.indexGetAll(
			"playersByTid",
			g.get("userTid"),
		);
		const aiPlayers = await idb.cache.players.indexGetAll("playersByTid", 1);

		const offer = await addAiOffer(
			1,
			{
				teams: [
					{
						tid: g.get("userTid"),
						pids: [userPlayers[0]!.pid],
						pidsExcluded: [],
						dpids: [],
						dpidsExcluded: [],
					},
					{
						tid: 1,
						pids: [aiPlayers[0]!.pid],
						pidsExcluded: [],
						dpids: [],
						dpidsExcluded: [],
					},
				],
				reason: "test",
			},
			false,
		);
		assert.strictEqual(g.get("aiTradeOffers").length, 1);
		assert.strictEqual(offer.teams[0].tid, g.get("userTid"));

		// Still valid
		await pruneAiOffers();
		assert.strictEqual(g.get("aiTradeOffers").length, 1);

		// Player moved to another team, so the offer is gone
		const p = aiPlayers[0]!;
		p.tid = 2;
		await idb.cache.players.put(p);
		await pruneAiOffers();
		assert.strictEqual(g.get("aiTradeOffers").length, 0);
		p.tid = 1;
		await idb.cache.players.put(p);
	});

	test("built offers ask for a user asset and give AI assets", async () => {
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		const valueChangeCalculator = new ValueChangeCalculator();
		for (let i = 0; i < 10; i++) {
			const built = await buildAiOffer(1, valueChangeCalculator);
			if (!built) {
				continue;
			}
			const [userTeam, aiTeam] = built.teams;
			assert.strictEqual(userTeam.tid, g.get("userTid"));
			assert.strictEqual(aiTeam.tid, 1);
			assert.strictEqual(userTeam.pids.length + userTeam.dpids.length, 1);
			assert.isAbove(aiTeam.pids.length + aiTeam.dpids.length, 0);
			for (const pid of aiTeam.pids) {
				assert.strictEqual((await idb.cache.players.get(pid))!.tid, 1);
			}
		}
	});
});
