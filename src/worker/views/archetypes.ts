import { defineView } from "../util/defineView.ts";
import archetypes from "../api/archetypes.ts";

export default defineView({
	id: "archetypes",
	load: async ({ updateEvents }) => {
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "Archetypes are only available for basketball.",
			};
		}
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("newPhase") ||
			updateEvents.has("playerMovement")
		) {
			return await archetypes.landscape();
		}
	},
});
