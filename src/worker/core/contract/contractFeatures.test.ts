import { afterEach, assert, beforeEach, describe, test, vi } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import {
	describeContractTerms,
	getContractTermsFactor,
	getGuaranteedAmounts,
	getTermsFromContract,
	normalizeContractTerms,
} from "../../../common/contractTerms.ts";
import type {
	Contract,
	MoodComponents,
	Player,
} from "../../../common/types.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { contractNegotiation, player, team } from "../index.ts";
import { createContract } from "./index.ts";
import {
	applyOptionDecision,
	applyReleaseGuarantees,
	decideContractOptions,
	getPendingOption,
	getReleaseCost,
	pickAiContractTerms,
	playerOptsOut,
	teamExercises,
	userDecideTeamOption,
} from "./options.ts";
import { extendContract, getExtensionIneligibleReason } from "./extension.ts";
import { aiExtensions, beforeNewPhase } from "./hooks.ts";
import {
	addMoodSnapshot,
	makeMoodSnapshot,
	MAX_MOOD_SNAPSHOTS,
	recordMoodSnapshots,
	sumMoodComponents,
} from "./moodHistory.ts";
import {
	endHoldouts,
	hasActiveTradeRequest,
	isHoldingOut,
	shouldHoldOut,
	shouldRequestTrade,
	startHoldouts,
	updateHoldouts,
	updateTradeRequests,
} from "./unrest.ts";
import { combineMarket, getFreeAgentMarket } from "../freeAgents/market.ts";
import { getPlayerContractPanel } from "./playerPanel.ts";
import moodInfo from "../player/moodInfo.ts";
import { getNeedInfo, needAttempt } from "../trade/betweenAiTeams.ts";

const setup = async () => {
	resetG();
	g.setWithoutSavingToDB("contractOptions", true);
	g.setWithoutSavingToDB("contractExtensions", true);
	g.setWithoutSavingToDB("tradeRequests", true);
	g.setWithoutSavingToDB("featureHoldouts", true);
	g.setWithoutSavingToDB("holdoutFrequency", 1);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);

	const teams = helpers.getTeamsDefault().slice(0, 3).map(team.generate);
	const players = [];
	for (let i = 0; i < 4; i++) {
		players.push(
			player.generate(PLAYER.FREE_AGENT, 27, 2015, true, DEFAULT_LEVEL),
		);
	}
	for (const tid of [0, 1, 2]) {
		for (let i = 0; i < 8; i++) {
			players.push(player.generate(tid, 27, 2015, true, DEFAULT_LEVEL));
		}
	}
	await resetCache({ players, teams });
};

// Replace a player's contract with one from start through exp at amount
const setContract = async (
	p: Player,
	{
		start,
		exp,
		amount,
		extra,
	}: { start: number; exp: number; amount: number; extra?: Partial<Contract> },
) => {
	p.contracts = [
		{
			type: "freeAgent",
			start,
			amounts: Array.from({ length: exp - start + 1 }, () => amount),
			payments: [],
			...extra,
		},
	];
	delete p.contractDemand;
	await idb.cache.players.put(p);
};

const getTeamPlayer = async (tid: number, index = 0) => {
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	return players[index]!;
};

describe("contract terms", () => {
	beforeEach(setup);

	test("pricing: player option is cheaper, team option and partial guarantees cost more, 1 year deals have no terms", () => {
		assert.strictEqual(getContractTermsFactor({ option: "player" }, 3), 0.95);
		assert.strictEqual(getContractTermsFactor({ option: "team" }, 3), 1.1);
		assert.closeTo(getContractTermsFactor({ guaranteed: 0.5 }, 3), 1.1, 1e-9);
		assert.strictEqual(getContractTermsFactor({ option: "team" }, 1), 1);
		assert.strictEqual(normalizeContractTerms({ guaranteed: 1 }, 3), undefined);
		assert.strictEqual(
			describeContractTerms({ option: "player", guaranteed: 0.5 }, 2020),
			"player option 2020, 50% guaranteed after year 1",
		);
	});

	test("createContract stores the option on the final season and guaranteed amounts", () => {
		const contract = createContract({
			contract: {
				amount: 1000,
				exp: 2018,
				terms: { option: "team", guaranteed: 0.5 },
			},
			type: "freeAgent",
		});
		assert.deepStrictEqual(contract.amounts, [1000, 1000, 1000]);
		assert.deepStrictEqual(contract.option, { type: "team", season: 2018 });
		assert.deepStrictEqual(contract.guaranteed, [1000, 500, 500]);
		assert.deepStrictEqual(getGuaranteedAmounts(contract), [1000, 500, 500]);
		assert.deepStrictEqual(getTermsFromContract(contract), {
			option: "team",
			guaranteed: 0.5,
		});

		// No terms on a 1 season contract
		const oneSeason = createContract({
			contract: { amount: 1000, exp: 2016, terms: { option: "team" } },
			type: "freeAgent",
		});
		assert.strictEqual(oneSeason.option, undefined);
	});

	test("player.sign keeps negotiated terms and AI teams sometimes add their own", async () => {
		const [fa] = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.FREE_AGENT,
		);
		await player.sign(
			fa!,
			0,
			{ amount: 2000, exp: 2019, terms: { option: "player" } },
			PHASE.REGULAR_SEASON,
		);
		assert.deepStrictEqual(getCurrentContract(fa!)!.option, {
			type: "player",
			season: 2019,
		});

		// AI terms: old player gets team-friendly terms, short contracts get none
		const old = { born: { year: 1980, loc: "" }, value: 50 };
		assert.deepStrictEqual(
			pickAiContractTerms(old, { amount: 1000, exp: 2018 }, () => 0.1),
			{ option: "team" },
		);
		assert.deepStrictEqual(
			pickAiContractTerms(old, { amount: 1000, exp: 2018 }, () => 0.4),
			{ guaranteed: 0.5 },
		);
		assert.strictEqual(
			pickAiContractTerms(old, { amount: 1000, exp: 2016 }, () => 0.1),
			undefined,
		);
	});

	test("releasing a partially guaranteed contract only owes the guaranteed part of future seasons, and not a team option", async () => {
		const p = await getTeamPlayer(0);
		await setContract(p, {
			start: 2016,
			exp: 2019,
			amount: 4000,
			extra: {
				guaranteed: [4000, 2000, 2000, 2000],
				option: { type: "team", season: 2019 },
			},
		});
		const cost = getReleaseCost(getCurrentContract(p)!);
		assert.strictEqual(cost.full, 16000);
		assert.strictEqual(cost.owed, 8000);

		await player.release(p, false);
		const released = p.contracts.at(-1)!;
		assert.strictEqual(released.endedEarly?.reason, "released");
		assert.deepStrictEqual(released.amounts, [4000, 2000, 2000]);
		assert.strictEqual(released.option?.decision, "declined");

		// Fully guaranteed contracts are unchanged
		const contract: Contract = {
			type: "freeAgent",
			start: 2016,
			amounts: [1, 1],
			payments: [],
		};
		applyReleaseGuarantees(contract, 2016);
		assert.deepStrictEqual(contract.amounts, [1, 1]);
	});
});

describe("options", () => {
	beforeEach(setup);

	test("decision rules", () => {
		assert.isTrue(
			playerOptsOut({
				age: 27,
				marketValue: 5000,
				optionAmount: 3000,
				probWilling: 0.9,
			}),
		);
		assert.isFalse(
			playerOptsOut({
				age: 27,
				marketValue: 2000,
				optionAmount: 3000,
				probWilling: 0.9,
			}),
		);
		// Unhappy and wouldn't lose much
		assert.isTrue(
			playerOptsOut({
				age: 27,
				marketValue: 2900,
				optionAmount: 3000,
				probWilling: 0.1,
			}),
		);
		// Old players take the money
		assert.isFalse(
			playerOptsOut({
				age: 35,
				marketValue: 3300,
				optionAmount: 3000,
				probWilling: 0.1,
			}),
		);
		assert.isTrue(teamExercises({ marketValue: 3000, optionAmount: 3000 }));
		assert.isFalse(teamExercises({ marketValue: 1000, optionAmount: 3000 }));
	});

	test("options are decided before the re-signing phase, and a declined option makes the contract expire now", async () => {
		g.setWithoutSavingToDB("phase", PHASE.AFTER_DRAFT);
		const optOut = await getTeamPlayer(1, 0);
		const optIn = await getTeamPlayer(1, 1);
		const teamOpt = await getTeamPlayer(1, 2);

		// Way underpaid, so he opts out
		await setContract(optOut, {
			start: 2015,
			exp: 2017,
			amount: g.get("minContract"),
			extra: { option: { type: "player", season: 2017 } },
		});
		optOut.value = 80;
		// Way overpaid, so he opts in
		await setContract(optIn, {
			start: 2015,
			exp: 2017,
			amount: g.get("maxContract"),
			extra: { option: { type: "player", season: 2017 } },
		});
		optIn.value = 40;
		// Overpaid, so team declines
		await setContract(teamOpt, {
			start: 2015,
			exp: 2017,
			amount: g.get("maxContract"),
			extra: { option: { type: "team", season: 2017 } },
		});
		teamOpt.value = 40;

		assert.ok(getPendingOption(optOut));

		await beforeNewPhase(PHASE.RESIGN_PLAYERS);

		assert.strictEqual(
			getCurrentContract(optOut)!.option!.decision,
			"declined",
		);
		assert.strictEqual(getContractExp(getCurrentContract(optOut)!), 2016);
		assert.strictEqual(
			getCurrentContract(optIn)!.option!.decision,
			"exercised",
		);
		assert.strictEqual(getContractExp(getCurrentContract(optIn)!), 2017);
		assert.strictEqual(
			getCurrentContract(teamOpt)!.option!.decision,
			"declined",
		);

		const events = await idb.cache.events.getAll();
		assert.strictEqual(
			events.filter((event) => event.type === "contractOption").length,
			3,
		);

		// Already decided, so nothing happens the second time
		await decideContractOptions();
		assert.strictEqual(
			(await idb.cache.events.getAll()).filter(
				(event) => event.type === "contractOption",
			).length,
			3,
		);
	});

	test("user can decide his team option early", async () => {
		const p = await getTeamPlayer(0);
		await setContract(p, {
			start: 2015,
			exp: 2017,
			amount: 1000,
			extra: { option: { type: "team", season: 2017 } },
		});
		assert.strictEqual(
			await userDecideTeamOption(p.pid, "declined"),
			undefined,
		);
		assert.strictEqual(getContractExp(getCurrentContract(p)!), 2016);

		// Not on user's team
		const other = await getTeamPlayer(1);
		assert.isString(await userDecideTeamOption(other.pid, "exercised"));

		// Can't decide twice
		const contract = getCurrentContract(p)!;
		assert.isFalse(applyOptionDecision(contract, "exercised"));
	});
});

describe("extensions", () => {
	beforeEach(setup);

	test("eligibility window", async () => {
		const p = await getTeamPlayer(0);
		await setContract(p, { start: 2015, exp: 2020, amount: 1000 });
		assert.include(getExtensionIneligibleReason(p, 0), "last 2 seasons");

		await setContract(p, { start: 2015, exp: 2017, amount: 1000 });
		assert.strictEqual(getExtensionIneligibleReason(p, 0), undefined);
		assert.isString(getExtensionIneligibleReason(p, 1));

		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		assert.isString(getExtensionIneligibleReason(p, 0));
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);

		g.setWithoutSavingToDB("contractExtensions", false);
		assert.include(getExtensionIneligibleReason(p, 0), "disabled");
	});

	test("extendContract appends seasons and keeps this season's salary", async () => {
		const p = await getTeamPlayer(0);
		await setContract(p, { start: 2015, exp: 2016, amount: 1000 });
		p.holdout = { season: 2016, tid: 0, gamesRemaining: 3, gamesMissed: 0 };
		await extendContract(p, {
			amount: 3000,
			exp: 2019,
			terms: { option: "player", guaranteed: 0.5 },
		});
		const contract = getCurrentContract(p)!;
		assert.deepStrictEqual(contract.amounts, [1000, 1000, 3000, 3000, 3000]);
		assert.deepStrictEqual(contract.guaranteed, [1000, 1000, 3000, 1500, 1500]);
		assert.deepStrictEqual(contract.option, { type: "player", season: 2019 });
		assert.strictEqual(contract.extensions?.[0]?.firstSeason, 2017);
		assert.strictEqual(p.holdout, undefined);
		assert.include(getExtensionIneligibleReason(p, 0), "last 2 seasons");
	});

	test("negotiate and accept an extension, and undo it", async () => {
		g.setWithoutSavingToDB("playersRefuseToNegotiate", false);
		const p = await getTeamPlayer(0);
		await setContract(p, { start: 2015, exp: 2016, amount: 1000 });

		const negotiation = await contractNegotiation.create(p.pid, false, 0);
		if (typeof negotiation === "string") {
			throw new Error(negotiation);
		}
		assert.ok(negotiation.extension);
		assert.isAbove(negotiation.extension.exp, 2016);

		const undo = await contractNegotiation.accept({
			negotiation,
			amount: 2000,
			exp: 2018,
			dryRun: false,
		});
		if (typeof undo !== "function") {
			throw new Error(String(undo));
		}
		assert.deepStrictEqual(
			getCurrentContract(p)!.amounts,
			[1000, 1000, 2000, 2000],
		);
		assert.strictEqual(p.tid, 0);

		assert.isTrue(await undo());
		const p2 = await idb.cache.players.get(p.pid);
		assert.deepStrictEqual(getCurrentContract(p2!)!.amounts, [1000, 1000]);
	});

	test("AI teams extend some players in their final season", async () => {
		g.setWithoutSavingToDB("playersRefuseToNegotiate", false);
		for (let i = 0; i < 8; i++) {
			const p = await getTeamPlayer(1, i);
			await setContract(p, { start: 2015, exp: 2016, amount: 1000 });
		}
		await aiExtensions(1);
		const players = await idb.cache.players.indexGetAll("playersByTid", 1);
		const extended = players.filter(
			(p) => getCurrentContract(p)!.extensions !== undefined,
		);
		assert.strictEqual(extended.length, 1);

		// User's team is never extended automatically
		const user = await idb.cache.players.indexGetAll("playersByTid", 0);
		assert.isTrue(user.every((p) => !getCurrentContract(p)!.extensions));
	});

	test("AI teams try to settle holdouts with an extension, but not into the luxury tax", async () => {
		g.setWithoutSavingToDB("playersRefuseToNegotiate", false);
		const p = await getTeamPlayer(2);
		await setContract(p, { start: 2015, exp: 2017, amount: 1000 });
		p.holdout = {
			season: g.get("season"),
			tid: 2,
			gamesRemaining: 5,
			gamesMissed: 0,
		};
		await idb.cache.players.put(p);
		assert.isTrue(isHoldingOut(p));

		// A routine extension would never happen at this probability, a holdout is tried first
		vi.spyOn(Math, "random").mockReturnValue(0.1);
		await aiExtensions(0);
		const p2 = (await idb.cache.players.get(p.pid))!;
		assert.isDefined(getCurrentContract(p2)!.extensions);
		assert.isFalse(isHoldingOut(p2));
		vi.restoreAllMocks();

		// Routine extensions don't take a team into the luxury tax
		for (let i = 0; i < 8; i++) {
			const p3 = await getTeamPlayer(1, i);
			await setContract(p3, {
				start: 2015,
				exp: i === 0 ? 2016 : 2020,
				amount: i === 0 ? 1000 : g.get("luxuryPayroll") / 7,
			});
		}
		await aiExtensions(1);
		const players = await idb.cache.players.indexGetAll("playersByTid", 1);
		assert.isTrue(players.every((p3) => !getCurrentContract(p3)!.extensions));
	});
});

describe("mood history and projections", () => {
	beforeEach(setup);

	test("snapshots are one per season and phase, and trimmed", async () => {
		const p = await getTeamPlayer(0);
		const components: MoodComponents = {
			marketSize: 1.23,
			facilities: 0,
			teamPerformance: -2,
			hype: 0,
			loyalty: 0,
			trades: 0,
			playingTime: 0,
			rookieContract: 0,
			difficulty: 0,
			relatives: 0,
			lockerRoom: 0,
			coachFit: 0,
			custom: [{ amount: 1, text: "x" }],
		};
		assert.closeTo(sumMoodComponents(components), 0.23, 1e-9);
		const snapshot = makeMoodSnapshot({ components, probWilling: 0.456 }, 0);
		assert.strictEqual(snapshot.components.marketSize, 1.2);
		assert.strictEqual(snapshot.probWilling, 0.46);

		addMoodSnapshot(p, snapshot);
		addMoodSnapshot(p, { ...snapshot, sum: 5 });
		assert.strictEqual(p.moodHistory!.length, 1);
		assert.strictEqual(p.moodHistory![0]!.sum, 5);

		for (let i = 0; i < MAX_MOOD_SNAPSHOTS + 5; i++) {
			addMoodSnapshot(p, { ...snapshot, season: 2000 + i });
		}
		assert.strictEqual(p.moodHistory!.length, MAX_MOOD_SNAPSHOTS);

		await recordMoodSnapshots();
		const other = await getTeamPlayer(2);
		assert.strictEqual(other.moodHistory?.length, 1);
	});

	test("adjustComponents projections, and the player panel", async () => {
		const p = await getTeamPlayer(0);
		p.customMoodItems = [{ amount: -4, text: "test" }];
		const base = await moodInfo(p, 0);
		const better = await moodInfo(p, 0, {
			adjustComponents: (c) => {
				c.teamPerformance = 2;
				c.hype = 2;
			},
		});
		assert.isAbove(better.probWilling, base.probWilling);

		const panel = await getPlayerContractPanel(p.pid);
		assert.ok(panel);
		assert.strictEqual(panel.scenarios[0]!.key, "current");
		assert.isAtLeast(
			panel.scenarios.at(-1)!.probWilling,
			panel.scenarios[0]!.probWilling,
		);
		assert.ok(panel.contract);
	});
});

describe("free agent market", () => {
	beforeEach(setup);

	test("combineMarket", () => {
		const market = combineMarket(
			[
				{ tid: 1, tier: "topTarget", probPerDay: 0.25 },
				{ tid: 2, tier: "backup", probPerDay: 0.1 },
			],
			1000,
		);
		assert.strictEqual(market.numInterested, 2);
		assert.strictEqual(market.likelyTid, 1);
		assert.closeTo(market.probSignedNextDay, 1 - 0.75 * 0.9, 1e-9);
		assert.strictEqual(combineMarket([], 1000).likelyTid, undefined);
	});

	test("getFreeAgentMarket lists interested AI teams but not the user's team", async () => {
		g.setWithoutSavingToDB("salaryCapType", "none");
		const freeAgents = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.FREE_AGENT,
		);
		const market = await getFreeAgentMarket(freeAgents);
		assert.strictEqual(Object.keys(market).length, freeAgents.length);
		const teamsSeen = new Set(
			Object.values(market).flatMap((row) => row.teams.map((t) => t.tid)),
		);
		assert.isFalse(teamsSeen.has(0));
		assert.isAbove(teamsSeen.size, 0);

		// Nobody can sign during the playoffs
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		const market2 = await getFreeAgentMarket(freeAgents);
		assert.isTrue(
			Object.values(market2).every((row) => row.numInterested === 0),
		);
	});
});

describe("trade requests and holdouts", () => {
	beforeEach(setup);
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("rules", () => {
		assert.isTrue(
			shouldRequestTrade({
				moodSum: -6,
				isStar: true,
				signedThisSeason: false,
			}),
		);
		assert.isFalse(
			shouldRequestTrade({ moodSum: -6, isStar: true, signedThisSeason: true }),
		);
		assert.isFalse(
			shouldRequestTrade({
				moodSum: -1,
				isStar: true,
				signedThisSeason: false,
			}),
		);
		assert.isTrue(
			shouldHoldOut({
				moodSum: -4,
				marketValue: 6000,
				amount: 2000,
				seasonsLeft: 2,
				minContract: 750,
			}),
		);
		assert.isFalse(
			shouldHoldOut({
				moodSum: -4,
				marketValue: 6000,
				amount: 2000,
				seasonsLeft: 1,
				minContract: 750,
			}),
		);
	});

	test("re-signing settles a trade request and a holdout", async () => {
		const p = await getTeamPlayer(1);
		const season = g.get("season");
		p.tradeRequest = { season, phase: PHASE.REGULAR_SEASON, tid: 1 };
		p.holdout = { season, tid: 1, gamesRemaining: 3, gamesMissed: 0 };
		player.addToFreeAgents(p, {});
		await player.sign(
			p,
			1,
			{ amount: g.get("minContract"), exp: season + 2 },
			PHASE.RESIGN_PLAYERS,
		);
		assert.isFalse(hasActiveTradeRequest(p));
		assert.isUndefined(p.tradeRequest);
		assert.isUndefined(p.holdout);
	});

	test("an unhappy star requests a trade, and withdraws it when happy", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		const p = await getTeamPlayer(1);
		p.value = 100;
		p.gamesUntilTradable = 0;
		p.transactions = [];
		p.customMoodItems = [{ amount: -20, text: "test" }];
		await idb.cache.players.put(p);

		await updateTradeRequests();
		assert.isTrue(hasActiveTradeRequest(p));
		const events = await idb.cache.events.getAll();
		assert.isTrue(events.some((event) => event.type === "tradeRequest"));

		p.customMoodItems = [{ amount: 20, text: "test" }];
		await updateTradeRequests();
		assert.isFalse(hasActiveTradeRequest(p));

		// Off with the setting
		g.setWithoutSavingToDB("tradeRequests", false);
		p.customMoodItems = [{ amount: -20, text: "test" }];
		await updateTradeRequests();
		assert.isFalse(hasActiveTradeRequest(p));
	});

	test("AI teams shop a player who asked to be traded", async () => {
		g.setWithoutSavingToDB("aiTradesNeedBased", true);
		g.setWithoutSavingToDB("userTids", [0]);
		const p = await getTeamPlayer(1);
		p.value = 70;
		p.gamesUntilTradable = 0;
		p.tradeRequest = {
			season: g.get("season"),
			phase: PHASE.REGULAR_SEASON,
			tid: 1,
		};
		await idb.cache.players.put(p);

		const aiTids = [1, 2];
		const { ctx, requesters } = await getNeedInfo(aiTids);
		assert.strictEqual(ctx.numTradeRequests, 1);
		assert.deepStrictEqual(
			requesters.map((p2) => p2.pid),
			[p.pid],
		);

		const failures: string[] = [];
		const result = await needAttempt(
			undefined,
			aiTids,
			"tradeRequest",
			failures,
		);
		// Whether a deal is found depends on the partner's roster, but it is never for lack of someone to shop
		assert.notInclude(failures, "noRequester");
		if (result && "teams" in result) {
			assert.strictEqual(result.kind, "tradeRequest");
			assert.deepStrictEqual(result.teams[0].pids, [p.pid]);
			assert.strictEqual(result.teams[1].tid, 2);
			assert.include(result.note, "asked out");
		}

		// Off with the setting: nobody is shopped
		g.setWithoutSavingToDB("tradeRequests", false);
		const off = await getNeedInfo(aiTids);
		assert.isUndefined(off.ctx.numTradeRequests);
		assert.strictEqual(off.requesters.length, 0);
	});

	test("holdouts start before the season, count down, and end", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		const p = await getTeamPlayer(2);
		await setContract(p, {
			start: 2015,
			exp: 2018,
			amount: g.get("minContract"),
		});
		p.value = 90;
		p.customMoodItems = [{ amount: -20, text: "test" }];
		p.draft.year = 2010;
		await idb.cache.players.put(p);

		await startHoldouts();
		assert.isTrue(isHoldingOut(p));
		const games = p.holdout!.gamesRemaining;

		await updateHoldouts();
		assert.strictEqual(p.holdout!.gamesRemaining, games - 1);
		assert.strictEqual(p.holdout!.gamesMissed, 1);

		await endHoldouts();
		assert.isFalse(isHoldingOut(p));

		// Off when frequency is 0
		g.setWithoutSavingToDB("holdoutFrequency", 0);
		await startHoldouts();
		assert.isFalse(isHoldingOut(p));

		// Off with the switch (League Extras)
		g.setWithoutSavingToDB("holdoutFrequency", 1);
		g.setWithoutSavingToDB("featureHoldouts", false);
		await startHoldouts();
		assert.isFalse(isHoldingOut(p));
	});
});

describe("getContractDemand fallback", () => {
	test("fills in a missing demand instead of throwing", async () => {
		const { getContractDemand } = await import("./index.ts");
		const { g } = await import("../../util/index.ts");
		const p: any = {
			pid: 1,
			firstName: "Tomislav",
			lastName: "Basljan",
			tid: -1,
			contracts: [],
		};
		const demand = getContractDemand(p);
		assert.strictEqual(demand.amount, g.get("minContract"));
		assert.ok(demand.exp >= g.get("season"));
		assert.strictEqual(p.contractDemand, demand);
	});
});
