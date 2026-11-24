import { featureOffError } from "../util/nativeFeatures.ts";
import { defineView } from "../util/defineView.ts";
import archetypes from "../api/archetypes.ts";

export default defineView({
	id: "archetypes",
	load: async ({ updateEvents }) => {
		const featureOff = featureOffError("archetypes");
		if (featureOff) {
			return featureOff;
		}
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "Archetypes are only available for basketball.",
			};
		}
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("newPhase") ||
			updateEvents.has("playerMovement") ||
			// (God Mode on or off changes the scouting fuzz of every ovr shown; settings like Archetype Label Source,
			// player traits or the No Visible Ratings challenge change the labels and what is shown; team names and
			// abbrevs are edited there too)
			updateEvents.has("gameAttributes") ||
			updateEvents.has("team")
		) {
			return await archetypes.landscape();
		}
	},
});
