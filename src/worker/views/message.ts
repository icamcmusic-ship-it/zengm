import { idb } from "../db/index.ts";
import { g, helpers, updatePlayMenu, updateStatus } from "../util/index.ts";
import { defineView, keepType } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { augmentOwnerMoods } from "./ownerMoodSeasons.ts";

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
					augmentedOwnerMoods = await augmentOwnerMoods({
						// Old messages don't include tid
						tid: message.tid ?? g.get("userTid"),
						moods: message.ownerMoods,
						// Old messages don't store the seasons, and assume they are consecutive
						seasons: message.ownerMoods.map(
							(_mood, i) =>
								message.ownerMoodSeasons?.[i] ??
								message.year - message.ownerMoods!.length + 1 + i,
						),
					});
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
