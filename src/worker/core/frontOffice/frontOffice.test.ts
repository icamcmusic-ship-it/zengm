import { assert, beforeEach, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { deptAmount } from "../../../common/frontOffice.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { team } from "../index.ts";
import {
	allocateAi,
	defaultNewDeptLevel,
	frontOfficeEnabled,
	getFinancesInfo,
	getInjuryDurationFactor,
	getNewDeptLevelLastThree,
	getSimFrontOffice,
	payGame,
	recordFatigue,
	recordInjury,
} from "./index.ts";

const setup = async (on: boolean) => {
	resetG();
	g.setWithoutSavingToDB("featureFrontOffice", on);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("numGames", 82);
	const teamsDefault = helpers.getTeamsDefault().slice(0, 4);
	g.setWithoutSavingToDB("numTeams", 4);
	g.setWithoutSavingToDB("numActiveTeams", 4);
	const teams = teamsDefault.map((t, i) =>
		team.generate({ ...t, popRank: i + 1 }),
	);
	await resetCache({
		teams,
		teamSeasons: teams.map((t) => team.genSeasonRow(t)),
	});
};

describe("Front Office Budget (worker)", () => {
	beforeEach(async () => {
		await setup(true);
	});

	test("off: no effects, nothing for the game sim", async () => {
		await setup(false);
		assert.isFalse(frontOfficeEnabled());
		assert.isUndefined(await getSimFrontOffice(0));
		assert.strictEqual(getInjuryDurationFactor(100, 34), 1);
	});

	test("new departments start at the team's usual level and phase in over 3 seasons", async () => {
		const t = (await idb.cache.teams.get(0))!;
		const def = defaultNewDeptLevel(t);
		assert.strictEqual(
			await getNewDeptLevelLastThree("analytics", { tid: 0 }),
			def,
		);
		// A new level doesn't apply at once: no games at it yet
		t.frontOffice = { analytics: 90, travel: 5 };
		assert.strictEqual(
			await getNewDeptLevelLastThree("analytics", { tid: 0, t }),
			def,
		);
		// A full season at it: a third of the way there
		const ts = (await idb.cache.teamSeasons.indexGet("teamSeasonsByTidSeason", [
			0,
			g.get("season"),
		]))!;
		for (let i = 0; i < 82; i++) {
			payGame(t, ts);
		}
		ts.won = 41;
		ts.lost = 41;
		assert.strictEqual(
			await getNewDeptLevelLastThree("analytics", { tid: 0, t }),
			Math.round((90 + 2 * def) / 3),
		);
	});

	test("paying a game records spending and levels", async () => {
		const t = (await idb.cache.teams.get(1))!;
		t.frontOffice = { analytics: 60, travel: 20 };
		const ts = (await idb.cache.teamSeasons.indexGet("teamSeasonsByTidSeason", [
			1,
			g.get("season"),
		]))!;
		const paid = payGame(t, ts);
		const expected =
			(deptAmount("analytics", 60, g.get("salaryCap")) +
				deptAmount("travel", 20, g.get("salaryCap"))) /
			82;
		assert.closeTo(paid, expected, 1e-9);
		assert.strictEqual(ts.frontOffice!.expenseLevels.analytics, 60);
		assert.strictEqual(ts.frontOffice!.expenseLevels.travel, 20);
		assert.strictEqual(ts.frontOffice!.gpRecorded, 1);
	});

	test("game sim inputs: better travel and medical departments help", async () => {
		const t = (await idb.cache.teams.get(0))!;
		t.budget.health = 90;
		t.initialBudget.health = 90;
		t.frontOffice = { analytics: 34, travel: 90 };
		const sim = (await getSimFrontOffice(0))!;
		assert.isBelow(sim.injuryRateFactor, 1);
		assert.isBelow(sim.travelScale, 1);
		assert.isAbove(sim.enduranceFallback, 1);
	});

	test("season review: injuries and fatigue are measured", async () => {
		await recordInjury({
			tid: 2,
			games: 8,
			neutralGames: 10,
			healthLevel: 80,
		});
		const ts = (await idb.cache.teamSeasons.indexGet("teamSeasonsByTidSeason", [
			2,
			g.get("season"),
		]))!;
		recordFatigue(ts, { penalty: 6, saved: 2 });
		recordFatigue(ts, { penalty: 0, saved: 0 });
		const review = ts.frontOffice!.review!;
		assert.strictEqual(review.injuries, 1);
		assert.strictEqual(review.durationGamesSaved, 2);
		assert.isAbove(review.injuriesAvoided, 0);
		assert.strictEqual(review.fatigueGames, 1);
		assert.strictEqual(review.fatigueSaved, 2);
	});

	test("AI allocation keeps the team's spending level", async () => {
		g.setWithoutSavingToDB("coachingStaff", false);
		const t = (await idb.cache.teams.get(3))!;
		allocateAi(t, 40);
		const levels = [
			t.budget.scouting,
			t.budget.health,
			t.budget.facilities,
			t.budget.coaching,
			t.frontOffice!.analytics,
			t.frontOffice!.travel,
		];
		const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
		assert.closeTo(mean, 40, 1.5);
	});

	test("Team Finances info: ranks, envelope, review", async () => {
		const teams = await idb.cache.teams.getAll();
		const biggest = teams.reduce((a, b) => (b.pop > a.pop ? b : a));
		const info = (await getFinancesInfo(biggest.tid))!;
		assert.isAbove(info.envelope, 0);
		assert.isAtLeast(info.ranks.analytics, 1);
		assert.isAtMost(info.ranks.analytics, 4);
		assert.isDefined(info.review);
		// The biggest market's owner funds more than the average
		assert.isAbove(info.targetLevel, DEFAULT_LEVEL);
	});
});
