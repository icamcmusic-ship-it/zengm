import { assert, beforeEach, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import {
	getExpectedProfit,
	getLegacyOwnerMood,
	honeymoonOwnerMood,
} from "../../../common/ownerMood.ts";
import {
	evaluateOwnerGoals,
	judgedGoalsPayroll,
	trackGoalsPayroll,
	type OwnerGoals,
} from "../../../common/ownerOffice.ts";
import {
	seasonOwnerJudgedProfit,
	seasonProfit,
} from "../../../common/teamSeasonFinances.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { ownerDistribution } from "../finances/ownerDistribution.ts";
import { team } from "../index.ts";
import updateOwnerMood from "../season/updateOwnerMood.ts";
import { ownerOfficeEnabled, payGame } from "./index.ts";

const setup = async () => {
	resetG();
	g.setWithoutSavingToDB("featureOwnerOffice", true);
	g.setWithoutSavingToDB("budget", true);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("numGames", 82);
	g.setWithoutSavingToDB("userTid", 0);
	g.setWithoutSavingToDB("userTids", [0]);
	g.setWithoutSavingToDB("gracePeriodEnd", g.get("season"));
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

const getTs = async (tid: number) =>
	(await idb.cache.teamSeasons.indexGet("teamSeasonsByTidSeason", [
		tid,
		g.get("season"),
	]))!;

const goals: OwnerGoals = {
	maxPayroll: 100000,
	taxWilling: false,
	profitTarget: 10,
	winTarget: 41,
};

describe("Owner's Office: owner judgement", () => {
	beforeEach(async () => {
		await setup();
	});

	test("project payments are an expense but not in the profit the owner judges", () => {
		const books = {
			revenues: { ticket: 50000 },
			expenses: { salary: 30000 },
			projectExpenses: 8000,
		};
		assert.strictEqual(seasonProfit(books), 12000);
		assert.strictEqual(seasonOwnerJudgedProfit(books), 20000);
	});

	test("payroll ceiling is judged on the season average, not just the end", () => {
		const g2 = { ...goals };
		for (let i = 0; i < 60; i++) {
			trackGoalsPayroll(g2, 130000);
		}
		for (let i = 0; i < 22; i++) {
			trackGoalsPayroll(g2, 95000);
		}
		const judged = judgedGoalsPayroll(g2, 95000);
		assert.isAbove(judged.payroll, g2.maxPayroll);
		assert.strictEqual(judged.payrollMax, 130000);
		const result = evaluateOwnerGoals(g2, {
			won: 41,
			profit: 10,
			numGames: 82,
			salaryCapScale: 1,
			luxuryPayroll: 100000,
			budget: true,
			...judged,
		});
		assert.isBelow(result.scores.payroll, 0);

		// Untracked: the payroll now
		assert.strictEqual(judgedGoalsPayroll(goals, 90000).payroll, 90000);
	});

	test("honeymoon and legacy mood", () => {
		assert.deepEqual(
			honeymoonOwnerMood({ money: -0.8, playoffs: 0.4, wins: -0.2 }),
			{ money: 0, playoffs: 0.2, wins: 0 },
		);
		assert.isUndefined(getLegacyOwnerMood({}));
		assert.isUndefined(getLegacyOwnerMood({ ownerMood: { money: 1 } }));
		assert.deepEqual(
			getLegacyOwnerMood({ ownerMood: { money: 1, playoffs: 0, wins: -1 } }),
			{ money: 1, playoffs: 0, wins: -1 },
		);
	});

	test("realistic economy: the owner leaves what a project still costs", () => {
		assert.strictEqual(ownerDistribution(200000, 100000), 75000);
		assert.strictEqual(ownerDistribution(200000, 100000, 60000), 30000);
		assert.strictEqual(ownerDistribution(200000, 100000, 150000), 0);
	});

	test("AI teams pause project payments with negative cash", async () => {
		assert.isTrue(ownerOfficeEnabled());
		const t = (await idb.cache.teams.get(1))!;
		t.ownerOffice = {
			completed: [],
			facilitiesBonus: 0,
			active: {
				type: "renovation",
				startSeason: g.get("season"),
				cost: 20000,
				paid: 0,
			},
		};
		const ts = await getTs(1);
		ts.cash = -1000;
		assert.strictEqual(payGame(t, ts), 0);
		ts.cash = 1000;
		assert.isAbove(payGame(t, ts), 0);
	});

	test("evaluation ignores project payments, stores what it applied, and runs once", async () => {
		const ts = await getTs(0);
		ts.won = 41;
		ts.lost = 41;
		ts.playoffRoundsWon = -1;
		const expected = getExpectedProfit(g.get("salaryCap"));
		ts.revenues.ticket = 100000;
		ts.expenses.salary = 100000 - expected * 1000;
		ts.projectExpenses = 30000;
		ts.ownerMood = { money: 0, playoffs: 0, wins: 0 };

		const result = (await updateOwnerMood())!;
		// Profit without the project is exactly the expected profit
		assert.closeTo(result.deltas.money, 0, 1e-9);
		assert.closeTo(result.deltas.playoffs, -0.2, 1e-9);
		const stored = (await getTs(0)).ownerEvaluation!;
		assert.isTrue(stored.applied);
		assert.closeTo(stored.expectedProfit, expected, 1e-9);
		assert.closeTo(stored.profit, expected, 1e-9);
		const mood = { ...(await getTs(0)).ownerMood! };

		// Running it again doesn't apply it twice
		const again = (await updateOwnerMood())!;
		assert.deepEqual(again.deltas, result.deltas);
		assert.deepEqual((await getTs(0)).ownerMood, mood);
	});

	test("goal nudge is added after the owner type's weights", async () => {
		const ts = await getTs(0);
		ts.won = 41;
		ts.lost = 41;
		ts.playoffRoundsWon = -1;
		const expected = getExpectedProfit(g.get("salaryCap"));
		ts.revenues.ticket = 100000;
		ts.expenses.salary = 100000 - expected * 1000;
		ts.ownerGoals = { ...goals, winTarget: 82 - 8, profitTarget: expected };
		const result = (await updateOwnerMood())!;
		const r = (await getTs(0)).ownerGoals!.result!;
		// Base wins delta is 0 at .500, so the wins delta is the nudge alone, unscaled
		assert.closeTo(result.deltas.wins, r.moodDeltas.wins, 1e-9);
		assert.isBelow(r.moodDeltas.wins, 0);
	});
});
