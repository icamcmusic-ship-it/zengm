import { assert, beforeAll, describe, test } from "vitest";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { PHASE } from "../../../common/constants.ts";
import { beforeTests } from "./testHelpers.ts";
import {
	acceptAiOffer,
	addAiOffer,
	buildAiOffer,
	chooseOfferTarget,
	getDailyOfferProbability,
	getOfferAge,
	getPhaseOfferProbability,
	requestAiOffers,
	rosterKeyStillValid,
	getOfferReasonText,
	pruneAiOffers,
	type OfferTargetCandidate,
} from "./aiOffers.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import { team } from "../index.ts";
import { helpers } from "../../util/index.ts";

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

	test("unsolicited offers can skip the trading block", () => {
		const target = chooseOfferTarget(
			"contending",
			[
				...candidates,
				{ kind: "player", id: 3, age: 26, value: 40, onTradingBlock: true },
			],
			first,
			false,
		);
		assert.strictEqual(target?.reason, "contenderNeed");
	});

	test("roster changes: losing a player expires, signing one doesn't", () => {
		assert.isTrue(rosterKeyStillValid("1,2,3", "1,2,3"));
		assert.isTrue(rosterKeyStillValid("1,2,3", "1,2,3,4"));
		assert.isFalse(rosterKeyStillValid("1,2,3", "1,3,4"));
		assert.isTrue(rosterKeyStillValid("", "1"));
	});

	test("offer age by phase", () => {
		assert.strictEqual(
			getOfferAge({ gp: 3, daysLeft: 30 }, PHASE.REGULAR_SEASON, 10, 0),
			7,
		);
		assert.strictEqual(
			getOfferAge({ gp: 0, daysLeft: 30 }, PHASE.FREE_AGENCY, 0, 25),
			5,
		);
		// Old offers without daysLeft, and phases without days, last until the phase changes
		assert.isUndefined(getOfferAge({ gp: 0 }, PHASE.FREE_AGENCY, 0, 25));
		assert.isUndefined(
			getOfferAge({ gp: 0, daysLeft: 30 }, PHASE.AFTER_DRAFT, 0, 25),
		);
		assert.strictEqual(getPhaseOfferProbability(1), 0.5);
		assert.strictEqual(getPhaseOfferProbability(0), 0);
	});

	test("offers expire when the AI team's roster changes", async () => {
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		g.setWithoutSavingToDB("aiTradeOffers", []);
		const userPlayers = await idb.cache.players.indexGetAll(
			"playersByTid",
			g.get("userTid"),
		);
		const aiPlayers = await idb.cache.players.indexGetAll("playersByTid", 1);
		await addAiOffer(
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
				source: "unsolicited",
			},
			false,
		);
		assert.strictEqual(g.get("aiTradeOffers")[0]!.source, "unsolicited");
		await pruneAiOffers();
		assert.strictEqual(g.get("aiTradeOffers").length, 1);

		// A player not in the offer leaves the AI team
		const other = aiPlayers.at(-1)!;
		other.tid = 2;
		await idb.cache.players.put(other);
		await pruneAiOffers();
		assert.strictEqual(g.get("aiTradeOffers").length, 0);
		other.tid = 1;
		await idb.cache.players.put(other);
	});

	test("requested offers land in the inbox and can be accepted", async () => {
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		g.setWithoutSavingToDB("aiTradeOffers", []);
		g.setWithoutSavingToDB("featureAiTradeOffers" as any, true);
		// The shared trade test league has no teams in the cache
		for (const t of helpers.getTeamsDefault().slice(0, 3)) {
			if (!(await idb.cache.teams.get(t.tid))) {
				await idb.cache.teams.put(
					team.generate({ ...t, strategy: "contending" }),
				);
				await idb.cache.teamSeasons.put(team.genSeasonRow(t));
			}
		}
		const userPlayers = await idb.cache.players.indexGetAll(
			"playersByTid",
			g.get("userTid"),
		);
		const pid = userPlayers[0]!.pid;
		const count = await requestAiOffers([pid], []);
		assert.isAtMost(count, 3);
		const offers = g.get("aiTradeOffers");
		assert.strictEqual(offers.length, count);
		for (const offer of offers) {
			assert.strictEqual(offer.source, "requested");
			assert.deepEqual(offer.teams[0].pids, [pid]);
		}

		g.setWithoutSavingToDB("aiTradeOffers", []);
		const best = [...userPlayers].sort((a, b) => b.value - a.value)[0]!;
		const aiPlayers = await idb.cache.players.indexGetAll("playersByTid", 1);
		const worst = [...aiPlayers].sort((a, b) => a.value - b.value)[0]!;
		const offer = await addAiOffer(
			1,
			{
				teams: [
					{
						tid: g.get("userTid"),
						pids: [best.pid],
						pidsExcluded: [],
						dpids: [],
						dpidsExcluded: [],
					},
					{
						tid: 1,
						pids: [worst.pid],
						pidsExcluded: [],
						dpids: [],
						dpidsExcluded: [],
					},
				],
				reason: "test",
			},
			false,
		);
		// The test league has no player values, so the AI turns it down. Accepting still goes through the normal trade
		// proposal with the offer's assets, and a turned down offer stays in the inbox
		const result = await acceptAiOffer(offer.id);
		const tr = await idb.cache.trade.get(0);
		assert.deepEqual(tr!.teams[0].pids, [best.pid]);
		assert.deepEqual(tr!.teams[1].pids, [worst.pid]);
		if (result.accepted) {
			assert.strictEqual((await idb.cache.players.get(best.pid))!.tid, 1);
			assert.strictEqual(g.get("aiTradeOffers").length, 0);
		} else {
			assert.strictEqual(g.get("aiTradeOffers").length, 1);
		}

		const missing = await acceptAiOffer(12345);
		assert.isFalse(missing.accepted);
	});
});
