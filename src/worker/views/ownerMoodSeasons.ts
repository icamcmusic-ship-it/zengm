// The owner mood of several seasons with what drove each one: the shared data of the evaluation message's chart and breakdown
// (views/message.ts) and the Owner page (views/owner.ts)
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import type { OwnerMood } from "../../common/types.ts";
import getPlayoffsByConf from "../core/season/getPlayoffsByConf.ts";
import { getRoundsWonText } from "./frivolitiesTeamSeasons.ts";
import { seasonOwnerJudgedProfit } from "../../common/teamSeasonFinances.ts";
import { getExpectedProfit } from "../../common/ownerMood.ts";

export const augmentOwnerMoods = async ({
	tid,
	moods,
	seasons,
}: {
	tid: number;
	moods: OwnerMood[];
	seasons: number[];
}) => {
	const augmentedOwnerMoods = [];

	for (const [i, mood] of moods.entries()) {
		const season = seasons[i]!;

		const teamSeason = await idb.merged.teamSeasons.getByTidSeason(tid, season);

		let seasonInfo;
		if (teamSeason) {
			// What the evaluation applied that season, stored on the team season. Older seasons fall back to recomputing it
			// (with today's salary cap for the baseline)
			const evaluation = teamSeason.ownerEvaluation;
			// [millions of dollars], without Owner's Office project payments, like the owner judges it
			const profit =
				evaluation?.profit ?? seasonOwnerJudgedProfit(teamSeason) / 1000;

			const roundsWonText = getRoundsWonText(
				teamSeason,
				await getPlayoffsByConf(teamSeason.season),
			);

			seasonInfo = {
				won: teamSeason.won,
				lost: teamSeason.lost,
				tied: teamSeason.tied,
				otl: teamSeason.otl,
				champ:
					teamSeason.playoffRoundsWon ===
					g.get("numGamesPlayoffSeries", teamSeason.season).length,
				profit,
				expectedProfit:
					evaluation?.expectedProfit ?? getExpectedProfit(g.get("salaryCap")),
				projectExpenses: (teamSeason.projectExpenses ?? 0) / 1000,
				profitTarget: teamSeason.ownerGoals?.result
					? teamSeason.ownerGoals.profitTarget
					: undefined,
				// Owner's Office: the owner's requests, ultimatums and mandates (already in the deltas)
				adjustments: evaluation?.adjustments ?? [],
				firingLine: evaluation?.firingLine,
				playoffRoundsWon: teamSeason.playoffRoundsWon,
				numPlayoffRounds: g.get("numGamesPlayoffSeries", teamSeason.season)
					.length,
				numGames: g.get("numGames", teamSeason.season),
				roundsWonText,
			};
		}

		// This season's contribution: what the evaluation applied, if it was stored. Otherwise the change from last season
		// (ownerMood is cumulative), only if that entry really is last season
		let deltas: OwnerMood | undefined;
		const evaluation = teamSeason?.ownerEvaluation;
		if (evaluation) {
			deltas = evaluation.applied
				? { ...evaluation.cappedDeltas }
				: { wins: 0, playoffs: 0, money: 0 };
		} else {
			const prevMood = i > 0 ? moods[i - 1] : undefined;
			const prevSeason = i > 0 ? seasons[i - 1] : undefined;
			if (prevMood && prevSeason === season - 1) {
				deltas = {
					wins: mood.wins - prevMood.wins,
					playoffs: mood.playoffs - prevMood.playoffs,
					money: mood.money - prevMood.money,
				};
			}
		}

		augmentedOwnerMoods.push({
			...mood,
			deltas,
			total: mood.money + mood.playoffs + mood.wins,
			season,
			seasonInfo,
		});
	}

	return augmentedOwnerMoods;
};
