import { g } from "../util/index.ts";
import { getAwardCandidates } from "../core/awards/getAwardCandidates.ts";
import { groupByUnique } from "../../common/utils.ts";
import { defineView } from "../util/defineView.ts";
import { validateSeasonOnly } from "../util/processInputs.ts";
import { team } from "../core/index.ts";
import { PHASE } from "../../common/constants.ts";
import { awardWinProbs } from "../core/seasonOdds/awardOdds.ts";

export default defineView({
	id: "awardRaces",
	processInputs: validateSeasonOnly,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (
			updateEvents.has("firstRun") ||
			(inputs.season === g.get("season") &&
				(updateEvents.has("gameSim") || updateEvents.has("playerMovement"))) ||
			inputs.season !== prevInputs?.season
		) {
			const awardCandidates = (
				await getAwardCandidates(inputs.season)
			).awardCandidates.flat();

			const teams = await team.getFormattedAll({
				attrs: ["tid"],
				seasonAttrs: ["won", "lost", "tied", "otl"],
				season: inputs.season,
			});

			// Award race probabilities (basketball, current regular season), keyed like getAwardKey in the UI
			let awardOdds: Record<string, Record<number, number>> | undefined;
			const phase = g.get("phase");
			if (
				__SPORT === "basketball" &&
				inputs.season === g.get("season") &&
				(phase === PHASE.REGULAR_SEASON || phase === PHASE.AFTER_TRADE_DEADLINE)
			) {
				const gp = teams.map(
					(t) =>
						t.seasonAttrs.won +
						t.seasonAttrs.lost +
						(t.seasonAttrs.tied ?? 0) +
						(t.seasonAttrs.otl ?? 0),
				);
				const avgGp =
					gp.length > 0 ? gp.reduce((a, b) => a + b, 0) / gp.length : 0;
				const fracPlayed = Math.min(1, avgGp / g.get("numGames"));
				awardOdds = {};
				for (const award of awardCandidates) {
					if (award.numTeams !== undefined || award.statRange !== undefined) {
						continue;
					}
					const key = JSON.stringify([award.shortName, award.group, undefined]);
					awardOdds[key] = awardWinProbs({
						scores: award.players.map((p) => ({
							pid: p.pid,
							score: p.currentStats.score ?? Number.NaN,
						})),
						fracPlayed,
					});
				}
			}

			return {
				awardOdds,
				awardCandidates,
				confs: g.get("confs", inputs.season),
				divs: g.get("divs", inputs.season),
				season: inputs.season,
				teams: groupByUnique(teams, "tid"),
			};
		}
	},
});
