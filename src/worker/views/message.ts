import { idb } from "../db/index.ts";
import { g, helpers, updatePlayMenu, updateStatus } from "../util/index.ts";
import { defineView, keepType } from "../util/defineView.ts";
import getPlayoffsByConf from "../core/season/getPlayoffsByConf.ts";
import { getRoundsWonText } from "./frivolitiesTeamSeasons.ts";
import { seasonProfit } from "../../common/teamSeasonFinances.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { bySport } from "../../common/sportFunctions.ts";

// Same as the baseline in core/season/updateOwnerMood, for showing the owner's expectations next to the results
const getExpectedProfit = () =>
	(15 * g.get("salaryCap")) /
	bySport({
		baseball: 175000,
		basketball: 90000,
		football: 200000,
		hockey: 80000,
	});

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
						const season = message.year - message.ownerMoods.length + 1 + i;

						const teamSeason = await idb.merged.teamSeasons.getByTidSeason(
							// Old messages don't include tid
							message.tid ?? g.get("userTid"),
							season,
						);

						let seasonInfo;
						if (teamSeason) {
							const profit = seasonProfit(teamSeason) / 1000; // [millions of dollars]

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
								expectedProfit: getExpectedProfit(),
								playoffRoundsWon: teamSeason.playoffRoundsWon,
								numPlayoffRounds: g.get(
									"numGamesPlayoffSeries",
									teamSeason.season,
								).length,
								numGames: g.get("numGames", teamSeason.season),
								roundsWonText,
							};
						}

						// ownerMood is cumulative, so this season's contribution is the change from last season
						const prevMood = i > 0 ? message.ownerMoods[i - 1] : undefined;
						const deltas = prevMood
							? {
									wins: mood.wins - prevMood.wins,
									playoffs: mood.playoffs - prevMood.playoffs,
									money: mood.money - prevMood.money,
								}
							: undefined;

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
