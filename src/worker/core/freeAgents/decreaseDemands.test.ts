// Free agent demands during the season. Set FA_METRICS=1 to print a day-by-day table of how many free agents ask for more than the minimum (by value tier) and how many minimum-contract signings an over-the-cap user team could make.
import { assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { getCurrentContract } from "../../../common/contracts.ts";
import type { Player } from "../../../common/types.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import { getContractDemand } from "../contract/index.ts";
import autoSign from "./autoSign.ts";
import decreaseDemands, { getDemandMarket } from "./decreaseDemands.ts";
import normalizeContractDemands from "./normalizeContractDemands.ts";
import moodInfo from "../player/moodInfo.ts";

const NUM_TEAMS = 30;

const mulberry32 = (seed: number) => () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// A league in the regular season: AI teams around the cap, the user's team (tid 0) over it, and the free agents left over after free agency (mostly fringe players, a few decent ones)
const setupLeague = async (seed = 1) => {
	resetG();
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	const rand = mulberry32(seed);
	const teams = helpers
		.getTeamsDefault()
		.slice(0, NUM_TEAMS)
		.map((t) => team.generate(t));
	g.setWithoutSavingToDB("numTeams", NUM_TEAMS);
	g.setWithoutSavingToDB("numActiveTeams", NUM_TEAMS);

	// develop needs a cache
	await resetCache({ teams });

	const players: Player[] = [];
	for (let tid = 0; tid < NUM_TEAMS; tid++) {
		const roster = [];
		const rosterSize = tid === 0 ? 13 : 13 + Math.floor(rand() * 3);
		for (let i = 0; i < rosterSize; i++) {
			roster.push(
				player.generate(
					tid,
					22 + Math.floor(rand() * 11),
					2015,
					true,
					DEFAULT_LEVEL,
				) as Player,
			);
		}
		players.push(...roster);
	}
	for (let i = 0; i < 80; i++) {
		const p = player.generate(
			PLAYER.FREE_AGENT,
			21 + Math.floor(rand() * 14),
			2015,
			true,
			DEFAULT_LEVEL,
		) as Player;
		players.push(p);
	}
	for (const [i, p] of players.entries()) {
		p.pid = i;
		await player.develop(p, 0);
		await player.updateValues(p);
		p.contractDemand = player.genContract(p);
	}
	await resetCache({ players: players as any, teams });

	// Payrolls: AI teams 90-115% of the cap (most over it, like during the season), the user's team 115%
	const salaryCap = g.get("salaryCap");
	for (let tid = 0; tid < NUM_TEAMS; tid++) {
		const roster = await idb.cache.players.indexGetAll("playersByTid", tid);
		const target = (tid === 0 ? 1.15 : 0.9 + 0.25 * rand()) * salaryCap;
		const payroll = roster.reduce(
			(sum, p) => sum + getCurrentContract(p)!.amounts[0]!,
			0,
		);
		for (const p of roster) {
			const contract = getCurrentContract(p)!;
			contract.amounts = contract.amounts.map((amount) =>
				helpers.roundContract(
					helpers.bound(
						(amount * target) / payroll,
						g.get("minContract"),
						g.get("maxContract"),
					),
				),
			);
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

	// Like at the start of the regular season
	await normalizeContractDemands({ type: "dummyExpiringContracts" });
};

// Value tiers relative to a replacement-level player
const TIERS = [
	{ name: "< repl", max: 0 },
	{ name: "repl+0-3", max: 3 },
	{ name: "repl+3-8", max: 8 },
	{ name: "repl+8+", max: Infinity },
];

const measure = async () => {
	const minContract = g.get("minContract");
	const freeAgents = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.FREE_AGENT,
	);
	const { unwanted, replacementValue } = await getDemandMarket(freeAgents);
	const tiers = TIERS.map(() => ({ n: 0, aboveMin: 0 }));
	let numUnwanted = 0;
	let numUnwantedAboveMin = 0;
	let userMinSignings = 0;
	for (const p of freeAgents) {
		const tierIndex = TIERS.findIndex(
			(tier) => p.value - replacementValue < tier.max,
		);
		const aboveMin = getContractDemand(p).amount > minContract;
		tiers[tierIndex]!.n += 1;
		if (aboveMin) {
			tiers[tierIndex]!.aboveMin += 1;
		}
		if (unwanted(p)) {
			numUnwanted += 1;
			if (aboveMin) {
				numUnwantedAboveMin += 1;
			}
		}

		const mood = await moodInfo(p, g.get("userTid"));
		if (mood.willing && mood.contractAmount <= minContract) {
			userMinSignings += 1;
		}
	}
	return {
		numFreeAgents: freeAgents.length,
		tiers,
		numUnwanted,
		numUnwantedAboveMin,
		userMinSignings,
	};
};

const simDays = async (numDays: number, log: boolean) => {
	const rows = [];
	for (let day = 0; day <= numDays; day++) {
		if (day > 0) {
			await decreaseDemands();
			await autoSign();
		}
		if (log && [0, 1, 3, 5, 7, 14, 30].includes(day)) {
			const m = await measure();
			rows.push({
				day,
				FAs: m.numFreeAgents,
				...Object.fromEntries(
					m.tiers.map((t, i) => [TIERS[i]!.name, `${t.aboveMin}/${t.n}`]),
				),
				"unwanted > min": `${m.numUnwantedAboveMin}/${m.numUnwanted}`,
				"user min signings": m.userMinSignings,
			});
		}
	}
	if (log) {
		console.table(rows);
	}
};

describe("decreaseDemands", () => {
	beforeEach(async () => {
		await setupLeague();
	}, 60_000);

	test("unwanted free agents drop to the minimum within days in the regular season", async () => {
		// Nobody has cap space, like late in the season
		g.setWithoutSavingToDB("salaryCap", 1000);
		const before = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.FREE_AGENT,
		);
		const { unwanted, replacementValue } = await getDemandMarket(before);
		const minContract = g.get("minContract");
		const belowReplacement = before.filter((p) => p.value < replacementValue);
		const pricedOut = before.filter(
			(p) =>
				p.value >= replacementValue &&
				getContractDemand(p).amount > 3 * minContract,
		);
		assert.isTrue(before.every(unwanted));
		assert.isAbove(pricedOut.length, 3);
		for (const p of belowReplacement) {
			p.contractDemand!.amount = 5 * minContract;
		}

		for (let day = 0; day < 5; day++) {
			await decreaseDemands();
		}

		// Below replacement: at the minimum within 5 days
		for (const p of belowReplacement) {
			assert.strictEqual(getContractDemand(p).amount, minContract);
		}

		// Better players hold out a bit longer, but get there in a few weeks
		assert.isTrue(
			pricedOut.some((p) => getContractDemand(p).amount > minContract),
		);
		for (let day = 0; day < 25; day++) {
			await decreaseDemands();
		}
		for (const p of pricedOut) {
			assert.strictEqual(getContractDemand(p).amount, minContract);
		}
	});

	test("a good player priced out of the market comes down to what an AI team could pay", async () => {
		const freeAgents = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.FREE_AGENT,
		);
		const { getMarket } = await getDemandMarket(freeAgents);
		// The best free agent gets the most cap space any team has
		const p = freeAgents.reduce((a, b) => (b.value > a.value ? b : a));
		const capSpace = getMarket(p);
		assert.isAbove(capSpace, 2 * g.get("minContract"));
		p.contractDemand!.amount = Math.min(capSpace * 3, g.get("maxContract"));
		for (let day = 0; day < 20; day++) {
			await decreaseDemands();
		}
		const amount = getContractDemand(p).amount;
		assert.isAtMost(amount, capSpace);
		assert.isAbove(amount, 0.85 * capSpace);
	});

	test("players some team could still pay keep a sensible demand", async () => {
		const freeAgents = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.FREE_AGENT,
		);
		const { getMarket, unwanted } = await getDemandMarket(freeAgents);
		const good = freeAgents.reduce((a, b) => (b.value > a.value ? b : a));
		good.contractDemand!.amount = helpers.roundContract(
			0.6 * Math.min(getMarket(good), g.get("maxContract")),
		);
		assert.isFalse(unwanted(good));
		const amountBefore = getContractDemand(good).amount;
		for (let day = 0; day < 5; day++) {
			await decreaseDemands();
		}
		const amountAfter = getContractDemand(good).amount;
		assert.isAbove(amountAfter, 0.9 * amountBefore);
	});

	test("no salary cap: only below-replacement players drop fast", async () => {
		g.setWithoutSavingToDB("salaryCapType", "none");
		const freeAgents = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.FREE_AGENT,
		);
		const { unwanted, replacementValue } = await getDemandMarket(freeAgents);
		for (const p of freeAgents) {
			assert.strictEqual(unwanted(p), p.value < replacementValue);
		}
	});

	test("free agency phase is slower than the regular season", async () => {
		g.setWithoutSavingToDB("phase", PHASE.FREE_AGENCY);
		const freeAgents = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.FREE_AGENT,
		);
		const { unwanted } = await getDemandMarket(freeAgents);
		const p = freeAgents.find(
			(p) =>
				unwanted(p) && getContractDemand(p).amount > 3 * g.get("minContract"),
		);
		if (!p) {
			return;
		}
		await decreaseDemands();
		const after = getContractDemand((await idb.cache.players.get(p.pid))!);
		assert.isAbove(after.amount, g.get("minContract"));
	});

	test("respects a custom minimum contract", async () => {
		g.setWithoutSavingToDB("minContract", 2000);
		for (let day = 0; day < 10; day++) {
			await decreaseDemands();
		}
		const freeAgents = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.FREE_AGENT,
		);
		for (const p of freeAgents) {
			assert.isAtLeast(getContractDemand(p).amount, 2000);
		}
	});

	test("an over-the-cap user team can sign free agents at the minimum", async () => {
		await simDays(7, false);
		const m = await measure();
		assert.isAbove(m.userMinSignings, m.numFreeAgents / 2);
		assert.strictEqual(m.tiers[0]!.aboveMin, 0);
	});

	test.runIf(!!(globalThis as any).process?.env?.FA_METRICS)(
		"metrics",
		async () => {
			await simDays(30, true);
		},
	);
});

describe("moodInfo at the minimum", () => {
	beforeEach(async () => {
		await setupLeague();
	}, 60_000);

	test("a free agent who hates the team can refuse even at the minimum", async () => {
		const p = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.FREE_AGENT)
		)[0]!;
		p.contractDemand!.amount = g.get("minContract");
		p.value = 80;
		p.numDaysFreeAgent = 0;
		const hates = await moodInfo(p, g.get("userTid"), {
			adjustComponents: (components) => {
				components.facilities = -20;
			},
		});
		assert.isFalse(hates.willing);

		// Normal mood, at the minimum: always willing
		const normal = await moodInfo(p, g.get("userTid"));
		assert.isTrue(normal.willing);

		// After a long time unsigned, he gives in
		p.numDaysFreeAgent = 30;
		p.value = 30;
		const later = await moodInfo(p, g.get("userTid"), {
			adjustComponents: (components) => {
				components.facilities = -8;
			},
		});
		assert.isTrue(later.probWilling > 0.5);
	});
});
