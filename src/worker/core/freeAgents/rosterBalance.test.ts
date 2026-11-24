import { assert, beforeEach, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import type { PlayerWithoutKey } from "../../../common/types.ts";
import getBest from "./getBest.ts";
import {
	groupCounts,
	pickCuts,
	posGroup,
	signNeedBonus,
	sortByNeed,
} from "./rosterBalance.ts";
import {
	gamesMissed,
	hardshipDiag,
	nbaHardshipOut,
	nbaMissedGames,
	nbaRemainingGames,
} from "./hardship.ts";
import {
	getContractAmount,
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";

/*
 * AI Roster Balance (featureAiRosterBalance): positional need for AI signings and cuts, and hardship signings. League-wide position
 * counts before and after: rosterBalance.script.test.ts (docs/native-features.md, AI roster balance).
 */

beforeEach(() => {
	resetG();
	g.setWithoutSavingToDB("numTeams", 2);
	g.setWithoutSavingToDB("numActiveTeams", 2);
});

type P = { pos: string; value: number };
const pos = (p: P) => p.pos;
const value = (p: P) => p.value;

test("groups: bigs C/FC/PF, guards PG/SG/G, the rest wings", () => {
	assert.deepStrictEqual(
		["C", "FC", "PF", "PG", "SG", "G", "GF", "SF", "F"].map(posGroup),
		["big", "big", "big", "guard", "guard", "guard", "wing", "wing", "wing"],
	);
	const counts = groupCounts(["C", "PG", "G", "SF"]);
	assert.deepStrictEqual(counts, { big: 1, guard: 2, wing: 1 });
	assert.isAbove(signNeedBonus(counts, "C"), 0);
	assert.isAbove(signNeedBonus(counts, "SG"), 0);
	assert.strictEqual(signNeedBonus(counts, "SF"), 0);
	assert.isBelow(signNeedBonus(groupCounts(Array(7).fill("PG")), "G"), 0);
});

test("signings: a team with no big takes a slightly worse big, not a much worse one; the order is otherwise kept", () => {
	const roster = ["PG", "SG", "G", "SF", "GF", "F", "SF"];
	const guard = { pos: "PG", value: 60 };
	const big = { pos: "C", value: 57 };
	assert.strictEqual(sortByNeed(roster, [guard, big], pos, value)[0], big);
	const farBig = { pos: "C", value: 50 };
	assert.strictEqual(sortByNeed(roster, [guard, farBig], pos, value)[0], guard);
	// No need: same order (even one that isn't by value, like player traits' adjustments)
	const balanced = ["PG", "SG", "G", "SF", "C", "PF"];
	const list = [
		{ pos: "SF", value: 50 },
		{ pos: "PG", value: 55 },
		{ pos: "C", value: 52 },
	];
	assert.deepStrictEqual(sortByNeed(balanced, list, pos, value), list);
	// 7 guards already: a slightly better guard loses to a wing
	const guardHeavy = [...Array(7).fill("G"), "C", "PF"];
	assert.strictEqual(
		sortByNeed(
			guardHeavy,
			[
				{ pos: "SG", value: 55 },
				{ pos: "SF", value: 52 },
			],
			pos,
			value,
		)[0]!.pos,
		"SF",
	);
});

test("cuts: never below 2 bigs or 3 guards, a full group goes first", () => {
	const players: P[] = [
		{ pos: "C", value: 40 },
		{ pos: "PF", value: 41 },
		{ pos: "PG", value: 42 },
		{ pos: "SG", value: 43 },
		{ pos: "G", value: 44 },
		{ pos: "SF", value: 45 },
		{ pos: "SF", value: 46 },
	];
	// Lowest value first would cut both bigs
	const cuts = pickCuts(players, 2, pos, value);
	assert.deepStrictEqual(
		cuts.map((p) => p.pos),
		["SF", "SF"],
	);
	// 8 guards: one goes before a slightly worse wing
	const guardHeavy: P[] = [
		{ pos: "C", value: 50 },
		{ pos: "C", value: 50 },
		{ pos: "SF", value: 44 },
		...Array.from({ length: 8 }, (_, i) => ({ pos: "PG", value: 46 + i })),
	];
	assert.strictEqual(pickCuts(guardHeavy, 1, pos, value)[0]!.pos, "PG");
	// Nobody else to cut: the lowest value
	assert.strictEqual(
		pickCuts(players.slice(0, 2), 1, pos, value)[0]!.value,
		40,
	);
});

const genPlayer = (tid: number, position: string, value: number) => {
	const p = player.generate(tid, 27, 2015, true, DEFAULT_LEVEL);
	p.ratings.at(-1)!.pos = position;
	p.value = value;
	p.contractDemand = { amount: g.get("minContract"), exp: g.get("season") };
	return p;
};

test("getBest: with the setting on a guard-only roster signs the big; off, the best player", () => {
	g.setWithoutSavingToDB("salaryCapType", "none");
	const roster = ["PG", "SG", "G", "PG", "SG"].map((pos2) =>
		genPlayer(0, pos2, 50),
	) as any[];
	const available = [genPlayer(-1, "SG", 48), genPlayer(-1, "C", 46)] as any[];
	g.setWithoutSavingToDB("featureAiRosterBalance" as any, false);
	assert.strictEqual(getBest(roster, available), available[0]);
	g.setWithoutSavingToDB("featureAiRosterBalance" as any, true);
	assert.strictEqual(getBest(roster, available), available[1]);
});

test("hardship: a short-handed AI team signs a minimum free agent and releases him when healthy", async () => {
	g.setWithoutSavingToDB("featureAiRosterBalance" as any, true);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("userTids", [0]);
	g.setWithoutSavingToDB("maxRosterSize", 15);
	g.setWithoutSavingToDB("minRosterSize", 13);
	const positions = ["PG", "SG", "G", "SF", "GF", "F", "PF", "C", "FC"];
	const players: PlayerWithoutKey[] = [];
	for (const tid of [0, 1]) {
		for (let i = 0; i < 13; i++) {
			players.push(genPlayer(tid, positions[i % positions.length]!, 50));
		}
	}
	for (let i = 0; i < 4; i++) {
		players.push(genPlayer(PLAYER.FREE_AGENT, i < 2 ? "SF" : "C", 45 + i));
	}
	const teams = helpers.getTeamsDefault().slice(0, 2).map(team.generate);
	await resetCache({ players, teams });

	// 6 of team 1's players out for 10+ games: 7 available
	const roster = await idb.cache.players.indexGetAll("playersByTid", 1);
	for (const p of roster.slice(0, 6)) {
		p.injury = { type: "Sprained Ankle", gamesRemaining: 10 };
		await idb.cache.players.put(p);
	}
	hardshipDiag.signed = 0;
	await team.checkRosterSizes("other");
	let after = await idb.cache.players.indexGetAll("playersByTid", 1);
	assert.strictEqual(after.length, 14);
	assert.strictEqual(hardshipDiag.signed, 1);
	const signed = after.find((p) => p.hardship !== undefined)!;
	const contract = getCurrentContract(signed)!;
	assert.strictEqual(
		getContractAmount(contract, g.get("season")),
		g.get("minContract"),
	);
	assert.strictEqual(getContractExp(contract), g.get("season"));
	// Still short-handed the next day: no second signing (8 available now)
	await team.checkRosterSizes("other");
	assert.strictEqual(
		(await idb.cache.players.indexGetAll("playersByTid", 1)).length,
		14,
	);
	// Another injury while he's there: a second one
	const healthy = (await idb.cache.players.indexGetAll("playersByTid", 1)).find(
		(p) => p.injury.gamesRemaining === 0 && p.hardship === undefined,
	)!;
	healthy.injury = { type: "Sprained Ankle", gamesRemaining: 10 };
	await idb.cache.players.put(healthy);
	await team.checkRosterSizes("other");
	after = await idb.cache.players.indexGetAll("playersByTid", 1);
	assert.strictEqual(after.length, 15);
	assert.strictEqual(after.filter((p) => p.hardship !== undefined).length, 2);
	// The user's team is never touched
	assert.strictEqual(
		(await idb.cache.players.indexGetAll("playersByTid", 0)).length,
		13,
	);

	// Healthy again with a full roster (no room): released
	for (const p of after) {
		p.injury = { type: "Healthy", gamesRemaining: 0 };
		await idb.cache.players.put(p);
	}
	await team.checkRosterSizes("other");
	after = await idb.cache.players.indexGetAll("playersByTid", 1);
	assert.strictEqual(after.length, 13);
	assert.isUndefined(after.find((p) => p.hardship !== undefined));
	assert.isUndefined(after.find((p) => p.pid === signed.pid));

	// A full roster (15): the hardship signing goes over the maximum and isn't cut for it
	for (const p of (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.FREE_AGENT)
	).slice(0, 2)) {
		await player.sign(
			p,
			1,
			{ amount: g.get("minContract"), exp: g.get("season") },
			PHASE.REGULAR_SEASON,
		);
		await idb.cache.players.put(p);
	}
	// (the released ones asking for the minimum again)
	for (const p of await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.FREE_AGENT,
	)) {
		p.contractDemand = { amount: g.get("minContract"), exp: g.get("season") };
		await idb.cache.players.put(p);
	}
	after = await idb.cache.players.indexGetAll("playersByTid", 1);
	assert.strictEqual(after.length, 15);
	for (const p of after.slice(0, 8)) {
		p.injury = { type: "Sprained Ankle", gamesRemaining: 10 };
		await idb.cache.players.put(p);
	}
	await team.checkRosterSizes("other");
	await team.checkRosterSizes("other");
	after = await idb.cache.players.indexGetAll("playersByTid", 1);
	assert.strictEqual(after.length, 16);
	assert.strictEqual(after.filter((p) => p.hardship !== undefined).length, 1);

	// Off: no hardship signings, and the extra man counts against the maximum again (cut back to 15)
	g.setWithoutSavingToDB("featureAiRosterBalance" as any, false);
	hardshipDiag.signed = 0;
	await team.checkRosterSizes("other");
	assert.strictEqual(
		(await idb.cache.players.indexGetAll("playersByTid", 1)).length,
		15,
	);
	assert.strictEqual(hardshipDiag.signed, 0);
});

test("hardship: games missed counts his team's games out, not the countdown on the day he got hurt", () => {
	const p: any = {
		injury: { type: "Sprained Ankle", gamesRemaining: 9 },
		injuries: [{ season: 2025, games: 10, type: "Sprained Ankle" }],
	};
	// Hurt today, counted down once at the end of the day: no games missed yet (the record without the counter)
	assert.strictEqual(gamesMissed(p), 0);
	p.injury.gamesRemaining = 6;
	assert.strictEqual(gamesMissed(p), 3);
	// The counter (team games he sat out, game/writePlayerStats.ts) wins over the countdown, which runs on days without games too
	p.injury.gamesMissed = 2;
	assert.strictEqual(gamesMissed(p), 2);
	assert.isFalse(nbaHardshipOut(p));
	p.injury.gamesMissed = 3;
	assert.isTrue(nbaHardshipOut(p));
});

test("hardship: the NBA rule's 3 games missed and 6 games out scale with the season length", () => {
	const p: any = {
		injury: { type: "Sprained Ankle", gamesRemaining: 6, gamesMissed: 3 },
		injuries: [],
	};
	g.setWithoutSavingToDB("numGames", 82);
	assert.strictEqual(nbaMissedGames(), 3);
	assert.strictEqual(nbaRemainingGames(), 6);
	assert.isTrue(nbaHardshipOut(p));

	// 164 games: 6 missed, 12 out
	g.setWithoutSavingToDB("numGames", 164);
	assert.strictEqual(nbaMissedGames(), 6);
	assert.strictEqual(nbaRemainingGames(), 12);
	assert.isFalse(nbaHardshipOut(p));

	// 20 games: 1 and 1 (at least 1)
	g.setWithoutSavingToDB("numGames", 20);
	assert.strictEqual(nbaMissedGames(), 1);
	assert.strictEqual(nbaRemainingGames(), 1);
	p.injury = { type: "Sprained Ankle", gamesRemaining: 1, gamesMissed: 1 };
	assert.isTrue(nbaHardshipOut(p));
	g.setWithoutSavingToDB("numGames", 5);
	assert.strictEqual(nbaMissedGames(), 1);
});

test("hardship: the NBA rule, 4+ out who have missed 3+ games and are out for a while yet", async () => {
	g.setWithoutSavingToDB("featureAiRosterBalance" as any, true);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("userTids", [0]);
	g.setWithoutSavingToDB("maxRosterSize", 15);
	g.setWithoutSavingToDB("minRosterSize", 13);
	g.setWithoutSavingToDB("salaryCapType", "none");
	const positions = ["PG", "SG", "G", "SF", "GF", "F", "PF", "C", "FC"];
	const players: PlayerWithoutKey[] = [];
	for (const tid of [0, 1]) {
		for (let i = 0; i < 13; i++) {
			players.push(genPlayer(tid, positions[i % positions.length]!, 50));
		}
	}
	for (let i = 0; i < 4; i++) {
		players.push(genPlayer(PLAYER.FREE_AGENT, i < 2 ? "SF" : "C", 45 + i));
	}
	const teams = helpers.getTeamsDefault().slice(0, 2).map(team.generate);
	await resetCache({ players, teams });
	const season = g.get("season");
	// Out for `remaining` more games of an injury of `total`
	const hurt = async (p: any, total: number, remaining: number) => {
		p.injury = { type: "Sprained Ankle", gamesRemaining: remaining };
		p.injuries = [{ season, games: total, type: "Sprained Ankle" }];
		await idb.cache.players.put(p);
	};
	const roster = await idb.cache.players.indexGetAll("playersByTid", 1);
	const numHardship = async () =>
		(await idb.cache.players.indexGetAll("playersByTid", 1)).filter(
			(p) => p.hardship !== undefined,
		).length;

	// 4 out, but one has missed only 2 games: 9 available, nothing
	for (const p of roster.slice(0, 3)) {
		await hurt(p, 20, 15);
	}
	await hurt(roster[3], 20, 18);
	hardshipDiag.signed = 0;
	await team.checkRosterSizes("other");
	assert.strictEqual(await numHardship(), 0);
	// ... or one back in 5 games: still nothing
	await hurt(roster[3], 10, 5);
	await team.checkRosterSizes("other");
	assert.strictEqual(await numHardship(), 0);
	// 4 out with 3+ missed and 6+ to go: one signing
	await hurt(roster[3], 20, 15);
	await team.checkRosterSizes("other");
	assert.strictEqual(await numHardship(), 1);
	assert.strictEqual(hardshipDiag.signed, 1);
	// A 5th: a second one
	await hurt(roster[4], 20, 15);
	await team.checkRosterSizes("other");
	assert.strictEqual(await numHardship(), 2);
	// One back (4 still out): one is released
	roster[4]!.injury = { type: "Healthy", gamesRemaining: 0 };
	await idb.cache.players.put(roster[4]!);
	await team.checkRosterSizes("other");
	assert.strictEqual(await numHardship(), 1);
	// Another back, 3 out: the last one goes too (no room on the roster to keep him)
	roster[3]!.injury = { type: "Healthy", gamesRemaining: 0 };
	await idb.cache.players.put(roster[3]!);
	await team.checkRosterSizes("other");
	assert.strictEqual(await numHardship(), 0);
	// The user's team is never touched
	for (const p of (
		await idb.cache.players.indexGetAll("playersByTid", 0)
	).slice(0, 6)) {
		await hurt(p, 20, 15);
	}
	await team.checkRosterSizes("other");
	assert.strictEqual(
		(await idb.cache.players.indexGetAll("playersByTid", 0)).length,
		13,
	);
});
