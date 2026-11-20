import { idb } from "../../db/index.ts";
import { g, local } from "../../util/index.ts";
import type { OwnerMood } from "../../../common/types.ts";
import { bySport } from "../../../common/sportFunctions.ts";
import {
	getExpectedProfit,
	getLegacyOwnerMood,
	getSalaryCapScale,
} from "../../../common/ownerMood.ts";
import { seasonOwnerJudgedProfit } from "../../../common/teamSeasonFinances.ts";
import { team } from "../index.ts";
import { overspendMoodPenalty } from "../../../common/frontOffice.ts";
import {
	frontOfficeEnabled,
	getSeasonEnvelope,
	getSeasonSpend,
} from "../frontOffice/index.ts";
import * as college from "../college/index.ts";
import { ownerOfficeEnabled } from "../ownerOffice/index.ts";
import {
	evaluateOwnerGoals,
	judgedGoalsPayroll,
} from "../../../common/ownerOffice.ts";
import { commercialEnabled, getOwnerType } from "../commercial/index.ts";
import { OWNER_TYPES } from "../../../common/commercial.ts";

// The evaluation (and its message, genMessage) only exists for a single user team that the user is running
export const ownerEvaluationEnabled = () =>
	!local.autoPlayUntil && !g.get("spectator") && g.get("userTids").length === 1;

/**
 * Update teamSeason.ownerMood based on performance this season, only for user's team.
 *
 * This is based on three factors: regular season performance, playoff performance, and finances. Designed to be called after the playoffs end.
 *
 * @memberOf core.season
 * @return {Promise.Object} Resolves to an object containing the changes in teamSeason.ownerMood this season.
 */
const updateOwnerMood = async (): Promise<
	| {
			cappedDeltas: OwnerMood;
			deltas: OwnerMood;
	  }
	| undefined
> => {
	// If auto play seasons or multi team mode, no messages - keep in sync with genMessage
	if (!ownerEvaluationEnabled()) {
		return;
	}

	const userTid = g.get("userTid");

	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[userTid, g.get("season")],
	);

	if (!teamSeason) {
		return;
	}

	// Already evaluated this season (the phase ran again): report it again, but don't apply it twice
	if (teamSeason.ownerEvaluation) {
		return {
			cappedDeltas: { ...teamSeason.ownerEvaluation.cappedDeltas },
			deltas: { ...teamSeason.ownerEvaluation.deltas },
		};
	}

	const salaryCapFactor = getSalaryCapScale(g.get("salaryCap"));
	const expectedProfit = getExpectedProfit(g.get("salaryCap"));

	// Millions of dollars. Owner's Office project payments are left out: the owner approved them and pays for them himself
	const profit = seasonOwnerJudgedProfit(teamSeason) / 1000;

	// Front Office Budget: the owner docks money mood for spending over his envelope. The two new departments' spending counts in profit
	// like the other budget items, with no discount on the expected profit
	let overspendPenalty = 0;
	if (frontOfficeEnabled()) {
		overspendPenalty = overspendMoodPenalty(
			getSeasonSpend(teamSeason),
			await getSeasonEnvelope(teamSeason),
		);
	}

	const numPlayoffRounds = g.get("numGamesPlayoffSeries", "current").length;

	// Some sports are more random than others, so like a 60% winning percentage is more impressive then. I think it only matters a lot for baseball, so I picked that coeffiient by determining what factor is needed to make 110/162 wins as valuable as 70/82 wins, then adding a little more so like 95 win seasons are still pretty good.
	const winsFactor = bySport({
		baseball: 2.2,
		basketball: 1,
		football: 1,
		hockey: 1,
	});

	const deltas = {
		wins:
			(winsFactor * (0.25 * (teamSeason.won - g.get("numGames") / 2))) /
			(g.get("numGames") / 2),
		playoffs: 0,
		money: g.get("budget")
			? (profit - expectedProfit) / (100 * salaryCapFactor) - overspendPenalty
			: 0,
	};

	if (teamSeason.playoffRoundsWon < 0) {
		deltas.playoffs = -0.2;
	} else if (teamSeason.playoffRoundsWon < numPlayoffRounds) {
		deltas.playoffs = (0.16 / numPlayoffRounds) * teamSeason.playoffRoundsWon;
	} else {
		deltas.playoffs = 0.2;
	}

	const isCollege = college.isCollege();

	// College mode: the season is judged against what the program's prestige predicts. First, so the owner type's weights below still
	// apply to it
	if (isCollege) {
		Object.assign(
			deltas,
			await college.getExpectationDeltas({
				won: teamSeason.won,
				lost: teamSeason.lost,
				playoffRoundsWon: teamSeason.playoffRoundsWon,
			}),
		);
	}

	// Commercial Deals & Ownership: the owner's type weighs the three parts of his mood differently
	if (commercialEnabled()) {
		const tRaw = await idb.cache.teams.get(userTid);
		if (tRaw) {
			const weights = OWNER_TYPES[getOwnerType(tRaw)].moodWeights;
			deltas.wins *= weights.wins;
			deltas.playoffs *= weights.playoffs;
			deltas.money *= weights.money;
		}
	}

	// Owner's Office: results against the preseason budget meeting's goals, a small bounded nudge (common/ownerOffice.ts). Added after
	// the owner type's weights, which already scaled the same wins and profit in the main formula. Not in college, which has its own
	// expectations
	if (ownerOfficeEnabled() && teamSeason.ownerGoals && !isCollege) {
		const result = evaluateOwnerGoals(teamSeason.ownerGoals, {
			won: teamSeason.won,
			profit,
			...judgedGoalsPayroll(
				teamSeason.ownerGoals,
				await team.getPayroll(userTid),
			),
			numGames: g.get("numGames"),
			salaryCapScale: salaryCapFactor,
			luxuryPayroll: g.get("luxuryPayroll"),
			budget: !!g.get("budget"),
		});
		teamSeason.ownerGoals.result = result;
		deltas.wins += result.moodDeltas.wins;
		deltas.money += result.moodDeltas.money;
	}

	teamSeason.ownerMood ??= getLegacyOwnerMood(g) ?? {
		money: 0,
		playoffs: 0,
		wins: 0,
	};

	const ownerMood = teamSeason.ownerMood;

	// Bound only the top - can't win the game by doing only one thing, but you can lose it by neglecting one thing
	const cappedDeltas = { ...deltas };

	if (ownerMood.money + cappedDeltas.money > 1) {
		cappedDeltas.money = 1 - ownerMood.money;
	}

	if (ownerMood.playoffs + cappedDeltas.playoffs > 1) {
		cappedDeltas.playoffs = 1 - ownerMood.playoffs;
	}

	if (ownerMood.wins + cappedDeltas.wins > 1) {
		cappedDeltas.wins = 1 - ownerMood.wins;
	}

	// Only update owner mood if grace period is over
	const applied =
		g.get("season") >= g.get("gracePeriodEnd") && !g.get("godMode");
	if (applied) {
		ownerMood.money += cappedDeltas.money;
		ownerMood.playoffs += cappedDeltas.playoffs;
		ownerMood.wins += cappedDeltas.wins;
	}

	teamSeason.ownerEvaluation = {
		profit,
		expectedProfit,
		deltas: { ...deltas },
		cappedDeltas: { ...cappedDeltas },
		applied,
	};
	await idb.cache.teamSeasons.put(teamSeason);

	return {
		cappedDeltas,
		deltas,
	};
};

export default updateOwnerMood;
