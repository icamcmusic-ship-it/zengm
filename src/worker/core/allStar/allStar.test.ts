// All-Star selection and the pre-game checks: no free agents, tiny leagues, injury replacements, the three-point field, and
// capped contest tiebreakers
import { afterAll, assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import create, { getSeasonThrees } from "./create.ts";
import { getNextRoundType, MAX_TIEBREAKER_ROUNDS } from "./contest.ts";
import prepareGame, { replaceUnavailable } from "./prepareGame.ts";

const setup = async (numPlayersPerTeam: number, numTeams?: number) => {
	Math.random = makeSeededRandom(5);
	resetG();
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	const teamsUsed = numTeams === undefined ? teams : teams.slice(0, numTeams);
	await resetCache({ teams });
	for (const t of teamsUsed) {
		for (let i = 0; i < numPlayersPerTeam; i++) {
			const p = player.generate(
				t.tid,
				22 + i,
				g.get("season") - 22 - i,
				true,
				50,
			);
			p.injury = { type: "Healthy", gamesRemaining: 0 };
			await idb.cache.players.add(p);
		}
	}
};

const allPids = (allStars: Awaited<ReturnType<typeof create>>) =>
	[...allStars.teams[0], ...allStars.teams[1], ...allStars.remaining].map(
		(p) => p.pid,
	);

describe("All-Star selection", () => {
	const realRandom = Math.random;
	afterAll(() => {
		Math.random = realRandom;
	});
	beforeEach(() => {
		Math.random = realRandom;
	});

	test("free agents can't be All-Stars, in the default top path", async () => {
		await setup(10);
		g.setWithoutSavingToDB("allStarType", "top");

		// The best player in the league, but a free agent
		const fa = player.generate(PLAYER.FREE_AGENT, 27, 2000, true, 50);
		for (const key of Object.keys(fa.ratings[0]!)) {
			if (typeof (fa.ratings[0] as any)[key] === "number" && key !== "hgt") {
				(fa.ratings[0] as any)[key] = 100;
			}
		}
		fa.ratings[0]!.ovr = 100;
		fa.injury = { type: "Healthy", gamesRemaining: 0 };
		await idb.cache.players.add(fa);

		const allStars = await create({});
		assert.notInclude(allPids(allStars), fa.pid);
		for (const p of [...allStars.teams[0], ...allStars.teams[1]]) {
			assert.isAtLeast(p.tid, 0);
		}
		assert.strictEqual(allStars.teams[0].length, g.get("allStarNum"));
		assert.strictEqual(allStars.teams[1].length, g.get("allStarNum"));
	});

	test("tiny league: no crash, the sides within one player, and the game is called off", async () => {
		for (const type of ["draft", "top", "byConf"] as const) {
			await setup(1, 3);
			g.setWithoutSavingToDB("allStarType", type);
			const allStars = await create({});
			const sizes = allStars.teams.map((t) => t.length);
			assert.isAtMost(Math.abs(sizes[0]! - sizes[1]!), 1, type);
			await idb.cache.allStars.put(allStars);
			assert.isFalse(await prepareGame({}), type);
		}
	});

	test("a normal league can play the game", async () => {
		await setup(10);
		g.setWithoutSavingToDB("allStarType", "top");
		const allStars = await create({});
		await idb.cache.allStars.put(allStars);
		assert.isTrue(await prepareGame({}));
	});

	test("injured, released and traded All-Stars before the game", async () => {
		await setup(10);
		g.setWithoutSavingToDB("allStarType", "top");
		const allStars = await create({});
		await idb.cache.allStars.put(allStars);

		const before = allPids(allStars);
		const injured = allStars.teams[0][0]!;
		const released = allStars.teams[1][0]!;
		const traded = allStars.teams[1][1]!;

		const pInjured = (await idb.cache.players.get(injured.pid))!;
		pInjured.injury = { type: "Sprained Ankle", gamesRemaining: 5 };
		await idb.cache.players.put(pInjured);
		const pReleased = (await idb.cache.players.get(released.pid))!;
		pReleased.tid = PLAYER.FREE_AGENT;
		await idb.cache.players.put(pReleased);
		const pTraded = (await idb.cache.players.get(traded.pid))!;
		const newTid = traded.tid === 0 ? 1 : 0;
		pTraded.tid = newTid;
		await idb.cache.players.put(pTraded);

		const replacements = await replaceUnavailable({});
		assert.strictEqual(replacements.length, 2);
		for (const pid of replacements) {
			assert.notInclude(before, pid);
		}

		const after = (await idb.cache.allStars.get(g.get("season")))!;
		const onTeams = [...after.teams[0], ...after.teams[1]].map((p) => p.pid);
		assert.notInclude(onTeams, injured.pid);
		assert.notInclude(onTeams, released.pid);
		assert.include(onTeams, traded.pid);
		assert.strictEqual(after.teams[0].length, g.get("allStarNum"));
		assert.strictEqual(after.teams[1].length, g.get("allStarNum"));
		assert.strictEqual(
			after.teams[1].find((p) => p.pid === traded.pid)!.tid,
			newTid,
		);
		assert.isTrue(
			after.remaining.some((p) => p.pid === injured.pid && p.injured),
		);

		// Running it again changes nothing
		assert.deepEqual(await replaceUnavailable({}), []);
	});

	test("three-point field uses this regular season, summed over teams", () => {
		const stats = [
			{ season: 2024, playoffs: false, gp: 70, tp: 250, tpa: 600 },
			{ season: 2025, playoffs: false, gp: 20, tp: 40, tpa: 100 },
			{ season: 2025, playoffs: false, gp: 15, tp: 35, tpa: 80 },
			{ season: 2025, playoffs: true, gp: 4, tp: 10, tpa: 20 },
		];
		const threes = getSeasonThrees(stats, 2025);
		assert.strictEqual(threes.tp, 75);
		assert.strictEqual(threes.tpa, 180);
		assert.strictEqual(threes.gp, 35);
		assert.closeTo(threes.tpp, 75 / 180, 1e-9);
	});
});

describe("contest tiebreakers", () => {
	// Three-point contest where every round (base and tiebreakers) has everyone tied at 0
	const makeContest = (numTiebreakers: number, numPlayers: number) => {
		const players = Array.from({ length: numPlayers }, (_, i) => ({
			pid: i,
			tid: 0,
			name: `P${i}`,
		}));
		const indexes = players.map((_, i) => i);
		const round = (tiebreaker: boolean) => ({
			indexes,
			results: indexes.map((index) => ({
				index,
				racks: [[false, false, false, false, false]],
			})),
			...(tiebreaker ? { tiebreaker: true as const } : {}),
		});
		return {
			players,
			rounds: [
				round(false),
				...Array.from({ length: numTiebreakers }, () => round(true)),
			],
		};
	};

	test("ties go to another tiebreaker round, up to the cap", () => {
		const result = getNextRoundType(makeContest(0, 2));
		assert.strictEqual(result.outcome, "tiebreakerRound");
		assert.deepEqual(result.indexesForNextTiebreaker, [0, 1]);

		const result2 = getNextRoundType(makeContest(MAX_TIEBREAKER_ROUNDS - 1, 2));
		assert.strictEqual(result2.outcome, "tiebreakerRound");
	});

	test("after the cap, the tie is settled deterministically", () => {
		const result = getNextRoundType(makeContest(MAX_TIEBREAKER_ROUNDS, 2));
		assert.strictEqual(result.outcome, "over");
		assert.deepEqual(result.indexesForNextRound, [0]);

		// First round of a 4 player contest: 2 advance
		const result2 = getNextRoundType(makeContest(MAX_TIEBREAKER_ROUNDS, 4));
		assert.strictEqual(result2.outcome, "normalRound");
		assert.deepEqual(result2.indexesForNextRound, [0, 1]);
	});
});
