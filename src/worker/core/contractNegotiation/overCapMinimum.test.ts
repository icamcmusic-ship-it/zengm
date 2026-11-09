// Hotfix regressions: a team over the salary cap can always sign a free agent asking for the minimum, in the regular season and in free agency, and free agents asking for the minimum don't refuse just because of a few bad mood components.
import { assert, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { getCurrentContract } from "../../../common/contracts.ts";
import type { Phase, Player } from "../../../common/types.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { contractNegotiation, player, team } from "../index.ts";
import { getContractDemand } from "../contract/index.ts";
import decreaseDemands from "../freeAgents/decreaseDemands.ts";
import moodInfo, { MIN_CONTRACT_REFUSE_MOOD } from "../player/moodInfo.ts";
import { getAffordFilter } from "../../../common/freeAgentsAffordFilter.ts";
import createFilterFunction from "../../../ui/components/DataTable/createFilterFunction.ts";

const NUM_TEAMS = 3;
const USER_TID = 0;

// Every team has 13 players. The user's team is way over the cap, AI team 1 has cap space of capSpace1, AI team 2 is over the cap.
const setup = async ({
	phase,
	capSpace1,
}: {
	phase: Phase;
	capSpace1: number;
}) => {
	resetG();
	g.setWithoutSavingToDB("phase", phase);
	g.setWithoutSavingToDB("userTid", USER_TID);
	g.setWithoutSavingToDB("userTids", [USER_TID]);
	g.setWithoutSavingToDB("numTeams", NUM_TEAMS);
	g.setWithoutSavingToDB("numActiveTeams", NUM_TEAMS);
	const teams = helpers
		.getTeamsDefault()
		.slice(0, NUM_TEAMS)
		.map((t) => team.generate(t));
	await resetCache({ teams });

	const players: Player[] = [];
	for (let tid = 0; tid < NUM_TEAMS; tid++) {
		for (let i = 0; i < 13; i++) {
			players.push(
				player.generate(tid, 27, 2015, true, DEFAULT_LEVEL) as Player,
			);
		}
	}
	for (let i = 0; i < 3; i++) {
		players.push(
			player.generate(
				PLAYER.FREE_AGENT,
				27,
				2015,
				true,
				DEFAULT_LEVEL,
			) as Player,
		);
	}
	for (const [i, p] of players.entries()) {
		p.pid = i;
		await player.develop(p, 0);
		await player.updateValues(p);
	}
	await resetCache({ players: players as any, teams });

	const salaryCap = g.get("salaryCap");
	const targets = [1.3 * salaryCap, salaryCap - capSpace1, 1.1 * salaryCap];
	for (let tid = 0; tid < NUM_TEAMS; tid++) {
		const roster = await idb.cache.players.indexGetAll("playersByTid", tid);
		for (const [i, p] of roster.entries()) {
			const contract = getCurrentContract(p)!;
			// Spread evenly, with the remainder on the first player so the payroll is exact
			const each = Math.floor(targets[tid]! / roster.length);
			const amount =
				i === 0 ? targets[tid]! - each * (roster.length - 1) : each;
			contract.amounts = contract.amounts.map(() => amount);
			await idb.cache.players.put(p);
		}
	}

	const freeAgents = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.FREE_AGENT,
	);
	for (const p of freeAgents) {
		player.addToFreeAgents(p, {});
		await idb.cache.players.put(p);
	}

	assert.isAbove(await team.getPayroll(USER_TID), salaryCap);

	return freeAgents;
};

const signAtAskingPrice = async (p: Player) => {
	const negotiation = await contractNegotiation.create(p.pid, false);
	if (typeof negotiation === "string") {
		throw new Error(negotiation);
	}
	const mood = await moodInfo(p, USER_TID);
	const result = await contractNegotiation.accept({
		negotiation,
		amount: mood.contractAmount,
		exp: getContractDemand(p).exp,
		dryRun: false,
	});
	return { mood, result };
};

describe("over the cap minimum contracts", () => {
	for (const phase of [PHASE.REGULAR_SEASON, PHASE.FREE_AGENCY] as const) {
		test(`over the cap team signs a minimum free agent (${phase === PHASE.REGULAR_SEASON ? "regular season" : "free agency"})`, async () => {
			const [p] = await setup({ phase, capSpace1: 0 });
			p!.contractDemand!.amount = g.get("minContract");

			const { mood, result } = await signAtAskingPrice(p!);
			assert.strictEqual(mood.contractAmount, g.get("minContract"));
			assert.isTrue(mood.willing);
			assert.strictEqual(typeof result, "function");
			assert.strictEqual(p!.tid, USER_TID);
		});
	}

	test("over the cap team still can't sign above the minimum", async () => {
		const [p] = await setup({ phase: PHASE.REGULAR_SEASON, capSpace1: 0 });
		p!.contractDemand!.amount = g.get("minContract") + 500;
		const negotiation = await contractNegotiation.create(p!.pid, false);
		if (typeof negotiation === "string") {
			throw new Error(negotiation);
		}
		const result = await contractNegotiation.accept({
			negotiation,
			amount: g.get("minContract") + 500,
			exp: g.get("season"),
			dryRun: true,
		});
		assert.include(String(result), "cannot go over the salary cap");
	});

	for (const phase of [PHASE.REGULAR_SEASON, PHASE.FREE_AGENCY] as const) {
		test(`a priced out free agent whose only market is barely above the minimum comes down to exactly the minimum (${phase === PHASE.REGULAR_SEASON ? "regular season" : "free agency"})`, async () => {
			const minContract = g.get("minContract");

			// The only AI team with cap space has just a little more than the minimum
			const freeAgents = await setup({
				phase,
				capSpace1: Math.round(minContract * 1.004) + 0.5,
			});

			// Make the free agents good enough to be wanted, and asking for much more than anyone could pay
			for (const p of freeAgents) {
				p.value = 200;
				p.contractDemand!.amount = 5 * minContract;
			}

			// Never stuck a few thousand above the minimum, where an over the cap team can't sign him, on any day
			for (let i = 0; i < 40; i++) {
				await decreaseDemands();
				for (const p of freeAgents) {
					const amount = getContractDemand(p).amount;
					assert.isTrue(
						amount === minContract || amount >= minContract * 1.1,
						`day ${i}: ${amount}`,
					);
				}
			}

			for (const p of freeAgents) {
				assert.strictEqual(getContractDemand(p).amount, minContract);
			}

			const { mood, result } = await signAtAskingPrice(freeAgents[0]!);
			assert.strictEqual(mood.contractAmount, minContract);
			assert.strictEqual(typeof result, "function");
		});
	}

	test("a minimum free agent signs despite a lot of trades and no playing time, but not with a team he really hates", async () => {
		const [p] = await setup({ phase: PHASE.REGULAR_SEASON, capSpace1: 0 });
		p!.contractDemand!.amount = g.get("minContract");
		p!.numDaysFreeAgent = 0;
		p!.value = 200;

		// Bad but not hated: lots of trades and no playing time push the raw sum way below the threshold
		const lotsOfTrades = await moodInfo(p!, USER_TID, {
			adjustComponents: (components) => {
				components.marketSize = -0.5;
				components.facilities = -0.5;
				components.teamPerformance = -0.5;
				components.hype = -0.5;
				components.trades = -8;
				components.playingTime = -6;
			},
		});
		const rawSum = Object.entries(lotsOfTrades.components)
			.filter(([key]) => key !== "custom")
			.reduce((sum, [, value]) => sum + (value as number), 0);
		assert.isBelow(rawSum, MIN_CONTRACT_REFUSE_MOOD);
		assert.isTrue(lotsOfTrades.willing);

		// Everything about the team is as bad as it gets
		const hated = await moodInfo(p!, USER_TID, {
			adjustComponents: (components) => {
				components.marketSize = -2;
				components.facilities = -2;
				components.teamPerformance = -2;
				components.hype = -2;
				components.trades = -8;
			},
		});
		assert.strictEqual(hated.probWilling < 1, true);
	});
});

describe("afford filter", () => {
	const minContract = 1200;
	const matches = (filter: string, amount: number) =>
		createFilterFunction(filter, "number")({ value: "", sortValue: amount });

	test("over the cap: minimum contracts only, including exactly the minimum", () => {
		const filter = getAffordFilter({
			capSpace: -22.51,
			challengeNoFreeAgents: false,
			minContract,
		});
		assert.isTrue(matches(filter, 1.2));
		assert.isFalse(matches(filter, 1.21));
	});

	test("with cap space: up to the cap space", () => {
		const filter = getAffordFilter({
			capSpace: 5.34,
			challengeNoFreeAgents: false,
			minContract,
		});
		assert.isTrue(matches(filter, 1.2));
		assert.isTrue(matches(filter, 5.34));
		assert.isFalse(matches(filter, 5.35));
	});

	test("cap space less than the minimum, or challenge mode: minimum contracts", () => {
		for (const [capSpace, challengeNoFreeAgents] of [
			[0.5, false],
			[20, true],
		] as const) {
			const filter = getAffordFilter({
				capSpace,
				challengeNoFreeAgents,
				minContract,
			});
			assert.isTrue(matches(filter, 1.2));
			assert.isFalse(matches(filter, 1.3));
		}
	});
});
