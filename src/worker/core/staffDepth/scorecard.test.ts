// Staff Report scorecard, budget recommendations, history and digests
import { afterAll, assert, beforeEach, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import { ensureStaff } from "../staff/index.ts";
import {
	devBand,
	getBudgetRecs,
	getSeasonScorecard,
	getStaffHistory,
} from "./scorecard.ts";
import { staffDigestsAfterNewPhase } from "./digests.ts";
import type { Player } from "../../../common/types.ts";

const setup = async () => {
	Math.random = makeSeededRandom(5);
	resetG();
	g.setWithoutSavingToDB("coachingStaff", true);
	g.setWithoutSavingToDB("featureCoachingDepth" as any, true);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
	assert.isTrue(await ensureStaff());
};

// A young player on tid whose ovr went from `before` last season to `after` this season, with an injury of `games` games
const addPlayer = async (
	tid: number,
	before: number,
	after: number,
	games: number,
) => {
	const season = g.get("season");
	const p = player.generate(tid, 21, season - 2, true, 50) as Player;
	await player.develop(p, 0);
	const r = p.ratings.at(-1)!;
	p.ratings = [
		{ ...r, season: season - 1, ovr: before },
		{ ...r, season, ovr: after },
	];
	p.injuries = games > 0 ? [{ season, games, type: "Sprained Ankle" }] : [];
	await idb.cache.players.add(p);
};

describe("staff scorecard", () => {
	const realRandom = Math.random;
	afterAll(() => {
		Math.random = realRandom;
	});
	beforeEach(async () => {
		await setup();
	});

	test("development and injury games against the league", async () => {
		const tid = g.get("userTid");
		const other = tid === 0 ? 1 : 0;
		for (let i = 0; i < 3; i++) {
			await addPlayer(tid, 40, 46, 20);
			await addPlayer(other, 40, 42, 2);
		}
		const card = await getSeasonScorecard(tid, g.get("season"));
		assert.strictEqual(card.numDev, 3);
		assert.strictEqual(card.devYou, 6);
		assert.strictEqual(card.devLeague, 4);
		assert.strictEqual(card.injuryGames, 60);
		// Two teams with players: (60 + 6) / 2
		assert.strictEqual(card.injuryGamesExpected, 33);
		assert.strictEqual(devBand(card), "Well ahead of the league");
	});

	test("budget recommendations follow the scorecard and link the item", async () => {
		g.setWithoutSavingToDB("budget", true);
		const tid = g.get("userTid");
		for (const t of await idb.cache.teams.getAll()) {
			t.budget.health = t.tid === tid ? 1 : 50;
			await idb.cache.teams.put(t);
		}
		const recs = await getBudgetRecs(tid, {
			season: g.get("season"),
			tid,
			devYou: 1,
			devLeague: 1,
			numDev: 5,
			scoutHits: 1,
			scoutJudged: 4,
			injuryGames: 90,
			injuryGamesExpected: 50,
		});
		assert.deepEqual(
			recs.map((r) => r.item),
			["health"],
		);
		// No budget items: nothing to recommend
		g.setWithoutSavingToDB("budget", false);
		assert.deepEqual(await getBudgetRecs(tid, undefined), []);
	});

	test("after the playoffs the report is frozen for History and a pre-draft digest goes to the inbox, once", async () => {
		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
		await staffDigestsAfterNewPhase(PHASE.DRAFT_LOTTERY);
		await staffDigestsAfterNewPhase(PHASE.DRAFT_LOTTERY);
		const history = getStaffHistory();
		assert.strictEqual(history.length, 1);
		assert.strictEqual(history[0]!.season, g.get("season"));
		assert.deepEqual(history[0]!.digests, ["draft"]);
		assert.isDefined(history[0]!.scorecard);
		const messages = await idb.cache.messages.getAll();
		assert.strictEqual(messages.length, 1);
		assert.include(messages[0]!.subject, "Pre-draft digest");

		g.setWithoutSavingToDB("phase", PHASE.RESIGN_PLAYERS);
		await staffDigestsAfterNewPhase(PHASE.RESIGN_PLAYERS);
		const messages2 = await idb.cache.messages.getAll();
		assert.strictEqual(messages2.length, 2);
		assert.include(messages2[1]!.subject, "Pre-free agency digest");
		assert.deepEqual(getStaffHistory()[0]!.digests, ["draft", "freeAgency"]);
	});
});
