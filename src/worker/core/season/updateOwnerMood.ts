import { idb } from "../../db/index.ts";
import { g, local } from "../../util/index.ts";
import type { OwnerMood } from "../../../common/types.ts";
import {
	baseMoodDeltas,
	capMoodDeltas,
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
import { getFiringRule, resolveOwnerSeason } from "../ownerOffice/owner.ts";
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

	const deltas = baseMoodDeltas({
		won: teamSeason.won,
		numGames: g.get("numGames"),
		playoffRoundsWon: teamSeason.playoffRoundsWon,
		numPlayoffRounds,
		profit,
		expectedProfit,
		salaryCapScale: salaryCapFactor,
		budget: !!g.get("budget"),
		overspendPenalty,
	});

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

	// Owner's Office: the owner's mid-season requests, ultimatums and mandates, and his reaction to losing the franchise player, each with
	// an explicit stake, bounded in total (common/ownerProfile.ts). Not in college
	const owner = isCollege ? undefined : await resolveOwnerSeason(teamSeason);
	if (owner) {
		deltas.wins += owner.sums.wins;
		deltas.playoffs += owner.sums.playoffs;
		deltas.money += owner.sums.money;
	}

	teamSeason.ownerMood ??= getLegacyOwnerMood(g) ?? {
		money: 0,
		playoffs: 0,
		wins: 0,
	};

	const ownerMood = teamSeason.ownerMood;

	// Bound only the top - can't win the game by doing only one thing, but you can lose it by neglecting one thing
	const cappedDeltas = capMoodDeltas(ownerMood, deltas);

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
		...(owner && owner.adjustments.length > 0
			? { adjustments: owner.adjustments }
			: {}),
		...(ownerOfficeEnabled() && !isCollege
			? { firingLine: (await getFiringRule()).line }
			: {}),
	};
	await idb.cache.teamSeasons.put(teamSeason);

	return {
		cappedDeltas,
		deltas,
	};
};

export default updateOwnerMood;
