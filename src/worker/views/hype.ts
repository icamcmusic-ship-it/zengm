import { defineView } from "../util/defineView.ts";
import hype from "../api/hype.ts";

export default defineView({
	id: "hype",
	load: async ({ updateEvents }) => {
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "Games to Watch is only available for basketball.",
			};
		}
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("gameSim") ||
			updateEvents.has("newPhase") ||
			updateEvents.has("playerMovement")
		) {
			const board = await hype.board({ days: 3, chases: 30, recent: true });
			return board;
		}
	},
});
