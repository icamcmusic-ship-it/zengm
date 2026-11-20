import { idb } from "../db/index.ts";
import { g, helpers, updatePlayMenu, updateStatus } from "../util/index.ts";
import { defineView, keepType } from "../util/defineView.ts";
import type { OwnerMood } from "../../common/types.ts";
import getPlayoffsByConf from "../core/season/getPlayoffsByConf.ts";
import { getRoundsWonText } from "./frivolitiesTeamSeasons.ts";
import { seasonOwnerJudgedProfit } from "../../common/teamSeasonFinances.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { getExpectedProfit } from "../../common/ownerMood.ts";

const processInputs = (params: RouteParams<"message">) => {
	return {
		mid: params.mid ? Number.parseInt(params.mid) : undefined,
	};
};

// Compare to the mid of the message actually shown, not prevInputs.mid, because inputs.mid is undefined when showing the latest message
const keepPrevOutput = {
	message: keepType<{ mid: number }>(),
};

export default defineView({
	id: "message",
	processInputs,
	keepPrevOutput,
	load: async ({ inputs, updateEvents, prevOutput }) => {
		// Complexity of updating is to handle auto-read message, so inputs.mid is blank
		if (
			updateEvents.has("firstRun") ||
			!prevOutput.message ||
			prevOutput.message.mid !== inputs.mid
		) {
			let message;
			let readThisPageview = false;

			if (inputs.mid === undefined) {
				const messages = (
					await idb.merged.messages.getAll({ limit: 10 })
				).reverse(); // First look for an unread message

				for (const m of messages) {
					if (!m.read) {
						// https://stackoverflow.com/a/59923262/786644
						const returnValue = {
							redirectUrl: helpers.leagueUrl(["message", m.mid]),
						};
						return returnValue;
					}
				}

				// Then look for any message
				if (messages[0]) {
					// https://stackoverflow.com/a/59923262/786644
					const returnValue = {
						redirectUrl: helpers.leagueUrl(["message", messages[0].mid]),
					};
					return returnValue;
				}
			} else {
				message = await idb.merged.messages.get(inputs.mid);
			}

			if (message && !message.read) {
				message.read = true;
				readThisPageview = true;
				await idb.cache.messages.put(message);
			}

			if (readThisPageview) {
				if (g.get("gameOver")) {
					await updateStatus("You're fired!");
				}

				await updatePlayMenu();
			}

			let augmentedMessage;
			if (message) {
				let augmentedOwnerMoods;
				if (message.ownerMoods) {
					augmentedOwnerMoods = [];

					for (const [i, mood] of message.ownerMoods.entries()) {
						// Old messages don't store the seasons, and assume they are consecutive
						const season =
							message.ownerMoodSeasons?.[i] ??
							message.year - message.ownerMoods.length + 1 + i;

						const teamSeason = await idb.merged.teamSeasons.getByTidSeason(
							// Old messages don't include tid
							message.tid ?? g.get("userTid"),
							season,
						);

						let seasonInfo;
						if (teamSeason) {
							// What the evaluation applied that season, stored on the team season. Older seasons fall back to recomputing it
							// (with today's salary cap for the baseline)
							const evaluation = teamSeason.ownerEvaluation;
							// [millions of dollars], without Owner's Office project payments, like the owner judges it
							const profit =
								evaluation?.profit ??
								seasonOwnerJudgedProfit(teamSeason) / 1000;

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
									evaluation?.expectedProfit ??
									getExpectedProfit(g.get("salaryCap")),
								projectExpenses: (teamSeason.projectExpenses ?? 0) / 1000,
								profitTarget: teamSeason.ownerGoals?.result
									? teamSeason.ownerGoals.profitTarget
									: undefined,
								playoffRoundsWon: teamSeason.playoffRoundsWon,
								numPlayoffRounds: g.get(
									"numGamesPlayoffSeries",
									teamSeason.season,
								).length,
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
							const prevMood = i > 0 ? message.ownerMoods[i - 1] : undefined;
							const prevSeason =
								i > 0
									? (message.ownerMoodSeasons?.[i - 1] ?? season - 1)
									: undefined;
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
				}

				augmentedMessage = {
					...message,
					ownerMoods: augmentedOwnerMoods,
				};
			}

			return {
				message: augmentedMessage,
			};
		}
	},
});
