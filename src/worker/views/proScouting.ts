import { defineView } from "../util/defineView.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import { getProScouting } from "../core/staffDepth/report.ts";

// Pro Scouting (Scouting Director & Regions): league-wide targets for the user's needs, systems and budget, with trade and free agent picks
export default defineView({
	id: "proScouting",
	processInputs: () => ({}),
	load: async ({ updateEvents }) => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "Pro scouting is only in Basketball GM." };
		}
		const off = featureOffError("scoutingDepth");
		if (off) {
			return off;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameAttributes")
		) {
			return;
		}
		return await getProScouting();
	},
});
