// All-Star selection robustness: every team format, with and without the vote, 1-3 conferences, tiny and odd-sized leagues,
// injuries and redshirts, then the pre-game replacements; plus the quality of the stats pick. The invariants are in
// testHelpers.ts (also used by the league-level stress test, selection.script.test.ts)
import { afterAll, assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import create from "./create.ts";
import prepareGame from "./prepareGame.ts";
import { checkInvariants, playingEntries } from "./testHelpers.ts";
import { slotsFor } from "./vote.ts";
import { courtOf } from "./weekend.ts";
import type { Conf, Div, Player } from "../../../common/types.ts";

type Options = {
	numTeams?: number;
	numConfs?: number;
	playersPerTeam?: number;
	teamGp?: number;
	injuredFrac?: number;
	seed?: number;
};

// A league of numTeams teams in numConfs conferences, teamGp games into the season, each player with a stats row: value (EWA,
// win shares) from his rating with noise, and most of his team's games
const setup = async ({
	numTeams = 30,
	numConfs = 2,
	playersPerTeam = 12,
	teamGp = 40,
	injuredFrac = 0,
	seed = 5,
}: Options = {}) => {
	Math.random = makeSeededRandom(seed);
	resetG();
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	const confs = Array.from({ length: numConfs }, (_, cid) => ({
		cid,
		name: `Conference ${cid + 1}`,
	})) as [Conf, ...Conf[]];
	g.setWithoutSavingToDB("confs", confs);
	g.setWithoutSavingToDB(
		"divs",
		confs.map((c) => ({
			did: c.cid,
			cid: c.cid,
			name: `Division ${c.cid}`,
		})) as [Div, ...Div[]],
	);
	g.setWithoutSavingToDB("numActiveTeams", numTeams);
	idb.league = mockIDBLeague();
	const teamsBasic = helpers
		.getTeamsDefault()
		.slice(0, numTeams)
		.map((t, tid) => ({ ...t, tid, cid: tid % numConfs, did: tid % numConfs }));
	const teams = teamsBasic.map(team.generate);
	const teamSeasons = teamsBasic.map((t) => {
		const ts = team.genSeasonRow(t);
		ts.won = Math.round(teamGp / 2);
		ts.lost = teamGp - ts.won;
		return ts;
	});
	await resetCache({ teams, teamSeasons });
	const season = g.get("season");
	for (const t of teams) {
		for (let i = 0; i < playersPerTeam; i++) {
			const p = player.generate(t.tid, 22 + i, season - 22 - i, true, 50);
			p.injury =
				Math.random() < injuredFrac
					? { type: "Sprained Ankle", gamesRemaining: 10 }
					: { type: "Healthy", gamesRemaining: 0 };
			player.addStatsRow(p, season, false);
			const row = p.stats.at(-1)!;
			const ovr = p.ratings.at(-1)!.ovr;
			const gp = Math.round(teamGp * (0.6 + 0.4 * Math.random()));
			const perGame = Math.max(0.01, (ovr - 30) / 100 + 0.05 * Math.random());
			row.gp = gp;
			row.min = gp * 30;
			row.pts = gp * (ovr - 30) * 0.5;
			row.ewa = (perGame * gp) / 4;
			row.ows = (perGame * gp) / 3;
			row.dws = (perGame * gp) / 6;
			await idb.cache.players.add(p);
		}
	}
};

const valueOf = (row: { ewa?: number; ows?: number; dws?: number }) =>
	2.5 * (row.ewa ?? 0) + (row.ows ?? 0) + (row.dws ?? 0);

const run = async (label: string) => {
	const allStars = await create({});
	await idb.cache.allStars.put(allStars);
	const problems = await checkInvariants(allStars, "selection");
	const ready = await prepareGame({});
	const after = (await idb.cache.allStars.get(g.get("season")))!;
	problems.push(...(await checkInvariants(after, "game")));
	assert.deepEqual(problems, [], label);
	return { allStars: after, ready };
};

describe("All-Star selection robustness", () => {
	const realRandom = Math.random;
	afterAll(() => {
		Math.random = realRandom;
	});
	beforeEach(() => {
		Math.random = realRandom;
	});

	test(
		"every format, vote on and off, 1-3 conferences, small and odd leagues, injuries",
		{ timeout: 120_000 },
		async () => {
			const leagues: Options[] = [
				{ numConfs: 2, injuredFrac: 0.1 },
				{ numConfs: 1 },
				{ numConfs: 3, injuredFrac: 0.1 },
				{ numTeams: 4, numConfs: 2, playersPerTeam: 8 },
				{ numTeams: 5, numConfs: 2, playersPerTeam: 3 },
				{ numTeams: 8, numConfs: 3, injuredFrac: 0.3 },
				{ numConfs: 2, teamGp: 3 },
				{ numConfs: 2, teamGp: 0 },
			];
			for (const [i, options] of leagues.entries()) {
				for (const type of ["byConf", "top", "draft", "tournament"] as const) {
					for (const vote of [true, false]) {
						for (const allStarNum of [12, 7]) {
							await setup(options);
							g.setWithoutSavingToDB("allStarType", type);
							g.setWithoutSavingToDB("allStarVote", vote);
							g.setWithoutSavingToDB("allStarNum", allStarNum);
							const label = `league ${i} ${type} vote ${vote} num ${allStarNum}`;
							const { allStars, ready } = await run(label);
							if (options.numTeams === undefined) {
								assert.isTrue(ready, label);
							}
							if (type === "byConf" && options.numConfs !== 2) {
								assert.notStrictEqual(allStars.type, "byConf", label);
							}
						}
					}
				}
			}
		},
	);

	test("deterministic for a seed", async () => {
		for (const vote of [true, false]) {
			const picks = [];
			for (let k = 0; k < 2; k++) {
				await setup({ injuredFrac: 0.1 });
				g.setWithoutSavingToDB("allStarVote", vote);
				g.setWithoutSavingToDB("allStarType", "top");
				Math.random = makeSeededRandom(11);
				const allStars = await create({});
				picks.push(allStars.teams.map((t) => t.map((p) => p.pid)));
			}
			assert.deepEqual(picks[0], picks[1]);
		}
	});

	test("college mode: redshirts are never All-Stars or replacements", async () => {
		for (const vote of [true, false]) {
			await setup();
			g.setWithoutSavingToDB("leagueType", "college");
			g.setWithoutSavingToDB("allStarVote", vote);
			const season = g.get("season");
			// The best player on every team is redshirting
			for (const t of await idb.cache.teams.getAll()) {
				const players = await idb.cache.players.indexGetAll(
					"playersByTid",
					t.tid,
				);
				const best = players.reduce((a, b) =>
					valueOf(a.stats.at(-1)!) > valueOf(b.stats.at(-1)!) ? a : b,
				);
				(best as Player & { redshirt?: number }).redshirt = season;
				await idb.cache.players.put(best);
			}
			await run(`college vote ${vote}`);
		}
	});

	test("an All-Star hurt, traded, released or retired before the game", async () => {
		for (const type of ["byConf", "draft", "tournament", "top"] as const) {
			for (const vote of [true, false]) {
				await setup();
				g.setWithoutSavingToDB("allStarType", type);
				g.setWithoutSavingToDB("allStarVote", vote);
				const allStars = await create({});
				await idb.cache.allStars.put(allStars);
				const playing = playingEntries(allStars);
				const get = async (i: number) =>
					(await idb.cache.players.get(playing[i]!.pid))!;
				const hurt = await get(0);
				hurt.injury = { type: "Sprained Ankle", gamesRemaining: 5 };
				await idb.cache.players.put(hurt);
				const traded = await get(1);
				traded.tid = (traded.tid + 2) % g.get("numActiveTeams");
				await idb.cache.players.put(traded);
				const released = await get(2);
				released.tid = PLAYER.FREE_AGENT;
				await idb.cache.players.put(released);
				const retired = await get(3);
				retired.tid = PLAYER.RETIRED;
				await idb.cache.players.put(retired);

				const label = `${type} vote ${vote}`;
				assert.isTrue(await prepareGame({}), label);
				const after = (await idb.cache.allStars.get(g.get("season")))!;
				assert.deepEqual(await checkInvariants(after, "game"), [], label);
				// The game is still played at full strength
				const sides = after.tournament ? after.tournament.teams : after.teams;
				assert.strictEqual(sides.flat().length, 2 * g.get("allStarNum"), label);
			}
		}
	});

	test("stats pick: an elite player who missed games still makes it", async () => {
		await setup();
		g.setWithoutSavingToDB("allStarVote", false);
		g.setWithoutSavingToDB("allStarType", "top");
		const teamGp = 40;
		const players = await idb.cache.players.getAll();
		const star = players[0]!;
		const others = players.slice(1).map((p) => {
			const row = p.stats.at(-1)!;
			return { total: valueOf(row), rate: valueOf(row) / (row.gp ?? 1) };
		});
		// The best player per game in the league by a wide margin, at 45% of his team's games: his total only ranks 40th
		const total = others.map((x) => x.total).sort((a, b) => b - a)[39]!;
		const row = star.stats.at(-1)!;
		row.gp = Math.ceil(0.45 * teamGp);
		row.ewa = total / 5;
		row.ows = total / 2;
		row.dws = 0;
		assert.isAbove(
			valueOf(row) / (row.gp ?? 1),
			1.3 * Math.max(...others.map((x) => x.rate)),
		);
		await idb.cache.players.put(star);
		const allStars = await create({});
		assert.include(
			playingEntries(allStars).map((p) => p.pid),
			star.pid,
		);
	});

	test("stats pick: below the games minimum, not an All-Star even with big numbers", async () => {
		await setup();
		g.setWithoutSavingToDB("allStarVote", false);
		g.setWithoutSavingToDB("allStarType", "top");
		const players = await idb.cache.players.getAll();
		const p = players[0]!;
		const row = p.stats.at(-1)!;
		row.gp = 8;
		row.ewa = 30;
		row.ows = 30;
		await idb.cache.players.put(p);
		const allStars = await create({});
		assert.notInclude(
			playingEntries(allStars).map((x) => x.pid),
			p.pid,
		);
	});

	test("stats pick: both courts, the vote's slot minimums", async () => {
		await setup();
		g.setWithoutSavingToDB("allStarVote", false);
		// Every backcourt player is mediocre: the best 24 by value would all be bigs
		for (const p of await idb.cache.players.getAll()) {
			if (courtOf(p.ratings.at(-1)!.pos) === "backcourt") {
				const row = p.stats.at(-1)!;
				row.ewa = (row.ewa ?? 0) / 10;
				row.ows = (row.ows ?? 0) / 10;
				row.dws = (row.dws ?? 0) / 10;
				await idb.cache.players.put(p);
			}
		}
		for (const type of ["byConf", "top"] as const) {
			g.setWithoutSavingToDB("allStarType", type);
			const allStars = await create({});
			const slots = slotsFor(g.get("allStarNum"), g.get("numPlayersOnCourt"));
			const minBack = slots.startersBack + slots.reservesBack;
			const numBack = [];
			for (const t of allStars.teams) {
				let n = 0;
				for (const entry of t) {
					const p = (await idb.cache.players.get(entry.pid))!;
					if (courtOf(p.ratings.at(-1)!.pos) === "backcourt") {
						n += 1;
					}
				}
				numBack.push(n);
			}
			if (type === "byConf") {
				// Each conference picks its own team
				assert.isAtLeast(Math.min(...numBack), minBack, type);
			} else {
				assert.isAtLeast(numBack[0]! + numBack[1]!, 2 * minBack, type);
			}
		}
	});
});
