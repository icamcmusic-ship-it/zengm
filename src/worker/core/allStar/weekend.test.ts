// All-Star weekend: the vote and its position slots, Rising Stars, the skills challenge, the tournament format and the
// newspaper recap
import { afterAll, assert, beforeEach, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import create from "./create.ts";
import prepareGame, { simContests } from "./prepareGame.ts";
import { castVotes, selectFromVotes, slotsFor } from "./vote.ts";
import { rankRuns, runCourse } from "./skills.ts";
import { courtOf, traitsOf } from "./weekend.ts";
import {
	allStarFacts,
	allStarWeekendStory,
	dunkDescription,
} from "../../../common/newspaper/allStar.ts";
import { Ctx } from "../../../common/newspaper/ctx.ts";
import { makeFixture } from "../../../common/newspaper/fixture.ts";

const setup = async () => {
	Math.random = makeSeededRandom(7);
	resetG();
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
	const season = g.get("season");
	for (const t of teams) {
		for (let i = 0; i < 12; i++) {
			// Two rookies and two sophomores a team
			const draftYear =
				i < 2 ? season - 1 : i < 4 ? season - 2 : season - 22 - i;
			const p = player.generate(t.tid, 20 + i, draftYear, true, 50);
			p.draft.year = draftYear;
			p.injury = { type: "Healthy", gamesRemaining: 0 };
			await idb.cache.players.add(p);
		}
	}
};

describe("All-Star weekend", () => {
	const realRandom = Math.random;
	afterAll(() => {
		Math.random = realRandom;
	});
	beforeEach(() => {
		Math.random = realRandom;
	});

	test("vote slots: 2 backcourt + 3 frontcourt starters, reserve minimums", () => {
		assert.deepEqual(slotsFor(12, 5), {
			startersBack: 2,
			startersFront: 3,
			reservesBack: 2,
			reservesFront: 3,
			reservesWild: 2,
		});

		const candidates = Array.from({ length: 30 }, (_, i) => ({
			pid: i,
			tid: i % 5,
			name: `P${i}`,
			cid: 0,
			court: i % 3 === 0 ? ("backcourt" as const) : ("frontcourt" as const),
			value: 30 - i,
			ppg: 30 - i,
			teamWinp: 0.5,
			teamHype: 0.5,
			teamPop: 3,
			prevAllStars: i < 3 ? 4 : 0,
		}));
		const rows = castVotes(candidates, makeSeededRandom(1));
		// Deterministic
		assert.deepEqual(rows, castVotes(candidates, makeSeededRandom(1)));
		const picked = selectFromVotes(rows, 12, 5);
		assert.strictEqual(picked.length, 12);
		const starters = picked.filter((r) => r.selected === "starter");
		assert.strictEqual(starters.length, 5);
		assert.strictEqual(
			starters.filter((r) => r.court === "backcourt").length,
			2,
		);
		assert.isAtLeast(picked.filter((r) => r.court === "backcourt").length, 4);
		assert.isAtLeast(picked.filter((r) => r.court === "frontcourt").length, 6);
		for (const r of rows) {
			assert.isAtLeast(r.fanVotes, 0);
		}
	});

	test("vote selection: by conference with slots, injured picks replaced, same result every time", async () => {
		await setup();
		g.setWithoutSavingToDB("allStarType", "byConf");
		// The top candidate is hurt
		const all = await idb.cache.players.getAll();
		const hurt = all[0]!;
		hurt.injury = { type: "Torn ACL", gamesRemaining: 40 };
		await idb.cache.players.put(hurt);

		const allStars = await create({});
		assert.strictEqual(allStars.type, "byConf");
		assert.isDefined(allStars.votes);
		for (const t of allStars.teams) {
			assert.strictEqual(t.length, g.get("allStarNum"));
		}
		const positions = new Map(
			all.map((p) => [p.pid, courtOf(p.ratings.at(-1)!.pos)]),
		);
		for (const t of allStars.teams) {
			const starters = t.filter((p) => p.starter);
			// The injured starter's slot goes to a replacement, so 4 or 5 starters play
			assert.isAtLeast(starters.length, 4);
			assert.isAtMost(
				starters.filter((p) => positions.get(p.pid) === "backcourt").length,
				2,
			);
		}
		if (allStars.remaining.some((p) => p.pid === hurt.pid)) {
			assert.isTrue(
				[...allStars.teams[0], ...allStars.teams[1]].some((p) => p.replacement),
			);
		}

		// Deterministic: the vote has its own seeded stream
		Math.random = makeSeededRandom(99);
		const again = await create({});
		assert.deepEqual(again.votes, allStars.votes);
	});

	test("Rising Stars and skills challenge: played, with a box score, MVP and winner", async () => {
		await setup();
		g.setWithoutSavingToDB("allStarType", "top");
		const allStars = await create({});
		await idb.cache.allStars.put(allStars);
		const rs = allStars.risingStars!;
		assert.deepEqual(rs.teamNames, ["Rookies", "Sophomores"]);
		const season = g.get("season");
		for (const p of rs.teams[0]) {
			const raw = (await idb.cache.players.get(p.pid))!;
			assert.strictEqual(raw.draft.year, season - 1);
		}
		for (const p of rs.teams[1]) {
			const raw = (await idb.cache.players.get(p.pid))!;
			assert.strictEqual(raw.draft.year, season - 2);
		}

		await simContests({});
		const after = (await idb.cache.allStars.get(season))!;
		const game = after.risingStars!.game!;
		assert.isAbove(game.score[0] + game.score[1], 150);
		assert.notStrictEqual(game.score[0], game.score[1]);
		assert.isAtLeast(game.players[0].length, 5);
		const boxPts = game.players[0].reduce((a, p) => a + p.pts, 0);
		assert.strictEqual(boxPts, game.score[0]);
		assert.isDefined(game.mvp);

		const skills = after.skills!;
		assert.isDefined(skills.winner);
		assert.strictEqual(skills.rounds.length, 2);
		assert.strictEqual(skills.rounds[1]!.runs.length, 2);
		assert.strictEqual(
			skills.winner,
			rankRuns(skills, 1)[0]!.index,
			"fastest in the final wins",
		);

		// Nothing written to the players' season stats
		const raw = (await idb.cache.players.get(game.mvp!.pid))!;
		assert.isFalse(raw.stats.some((row) => row.season === season && row.gp));
	});

	test("skills course: better ball skills are faster on average", () => {
		const rand = makeSeededRandom(3);
		let good = 0;
		let bad = 0;
		for (let i = 0; i < 200; i++) {
			good += runCourse(
				{ handle: 90, pass: 90, shoot: 90, speed: 90 },
				rand,
				0,
			).time;
			bad += runCourse(
				{ handle: 30, pass: 30, shoot: 30, speed: 30 },
				rand,
				1,
			).time;
		}
		assert.isBelow(good, bad);
	});

	test("tournament: four teams, semifinals to the target, winners play the All-Star Game", async () => {
		await setup();
		g.setWithoutSavingToDB("allStarType", "tournament");
		const allStars = await create({});
		assert.strictEqual(allStars.type, "tournament");
		const tourney = allStars.tournament!;
		assert.strictEqual(tourney.teams.length, 4);
		for (const t of tourney.teams) {
			assert.strictEqual(t.length, g.get("allStarNum") / 2);
		}
		await idb.cache.allStars.put(allStars);

		assert.isTrue(await prepareGame({}));
		const after = (await idb.cache.allStars.get(g.get("season")))!;
		for (const semi of after.tournament!.semis) {
			const game = semi.game!;
			assert.isAtLeast(Math.max(...game.score), tourney.targetSemis);
			assert.isBelow(Math.min(...game.score), tourney.targetSemis);
		}
		const w0 = after.tournament!.semis[0]!.winner!;
		const w1 = after.tournament!.semis[1]!.winner!;
		assert.deepEqual(
			after.teams[0].map((p) => p.pid),
			tourney.teams[w0]!.map((p) => p.pid),
		);
		assert.deepEqual(
			after.teams[1].map((p) => p.pid),
			tourney.teams[w1]!.map((p) => p.pid),
		);
		assert.strictEqual(after.teamNames[0], tourney.teamNames[w0]);

		// Playing it again changes nothing
		assert.isTrue(await prepareGame({}));
		const again = (await idb.cache.allStars.get(g.get("season")))!;
		assert.deepEqual(again.tournament, after.tournament);
	});

	test("newspaper recap: MVP, contest winners, best dunk, Rising Stars", () => {
		assert.strictEqual(
			dunkDescription({
				toss: "side",
				distance: "twelve-feet",
				move1: "windmill",
				move2: "spin-360",
			}),
			"a windmill, 360° dunk from 12 feet, the toss off the side of the backboard",
		);
		const p = (pid: number, name: string) => ({ pid, tid: 0, name });
		const allStar = allStarFacts(
			{
				season: 2025,
				teamNames: ["East", "West"],
				teams: [[], []],
				remaining: [],
				finalized: true,
				type: "byConf",
				gid: 5,
				score: [181, 176],
				mvp: p(1, "Ann Star"),
				dunk: {
					players: [p(2, "Dee Dunk"), p(3, "Lee Leap")],
					rounds: [
						{
							dunkers: [0, 1],
							dunks: [
								{
									index: 0,
									made: true,
									score: 50,
									attempts: [
										{
											toss: "none",
											distance: "free-throw",
											move1: "windmill",
											move2: "none",
										},
									],
								},
							],
						},
					],
					controlling: [],
					winner: 0,
					pidsTall: [8, 9],
					pidsShort: [10, 11],
				},
				skills: {
					players: [p(4, "Sam Skill"), p(5, "Bo Ball")],
					rounds: [
						{
							indexes: [0, 1],
							runs: [
								{
									index: 0,
									time: 28.4,
									handle: 8,
									pass: 6,
									shoot: 7,
									sprint: 7.4,
									passMisses: 0,
									shotMisses: 1,
								},
								{
									index: 1,
									time: 30.1,
									handle: 9,
									pass: 6,
									shoot: 8,
									sprint: 7.1,
									passMisses: 1,
									shotMisses: 0,
								},
							],
						},
					],
					winner: 0,
				},
				risingStars: {
					teamNames: ["Rookies", "Sophomores"],
					teams: [[], []],
					game: {
						teamNames: ["Rookies", "Sophomores"],
						score: [150, 160],
						overtimes: 0,
						players: [
							[],
							[
								{
									...p(6, "Rip Rook"),
									min: 20,
									pts: 31,
									trb: 5,
									ast: 4,
									stl: 1,
									blk: 0,
									fg: 12,
									fga: 18,
									tp: 5,
									tpa: 9,
									ft: 2,
									fta: 2,
									rim: 4,
								},
							],
						],
						mvp: p(6, "Rip Rook"),
					},
				},
			},
			{ pts: 32, trb: 8, ast: 6, tp: 6 },
		)!;
		const facts = { ...makeFixture("midseason"), allStar };
		const story = allStarWeekendStory(new Ctx(facts))!;
		assert.isDefined(story);
		const text = JSON.stringify(story);
		assert.include(text, "Ann Star");
		assert.include(text, "32 points");
		assert.include(text, "Dee Dunk");
		assert.include(text, "perfect 50");
		assert.include(text, "Sam Skill");
		assert.include(text, "28.4 seconds");
		assert.include(text, "Rip Rook");
		assert.include(text, "Sophomores 160, Rookies 150");
		assert.notMatch(text, /\bovr\b|rating/i);
	});
	test("contest traits follow the Player Traits setting and fill in missing seeds", () => {
		resetG();
		const p = player.generate(0, 25, g.get("season") - 4, true, 50);
		p.pid = 12;
		const r = p.ratings.at(-1)!;

		// Setting off: no traits, even with stored seeds
		g.setWithoutSavingToDB("playerTraits", false);
		p.traits = { egoSeed: 2 };
		assert.isUndefined(traitsOf(p, r));

		// Setting on: scores even without stored seeds (derived from league seed + pid, like the rest of the game)
		g.setWithoutSavingToDB("playerTraits", true);
		delete p.traits;
		const scores = traitsOf(p, r);
		assert.isDefined(scores);
		assert.strictEqual(typeof scores!.ego, "number");
		assert.deepEqual(traitsOf(p, r), scores);
	});
});
