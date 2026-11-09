// League extras: the native feature switches and options (common/nativeFeatures.ts), the League Extras tab of League
// Settings.
import { defineView } from "../util/defineView.ts";
import { getInitialSettings } from "./settings.ts";

export default defineView({
	id: "leagueExtras",
	load: ({ updateEvents }) => {
		if (updateEvents.has("firstRun") || updateEvents.has("gameAttributes")) {
			return {
				initialSettings: getInitialSettings(),
			};
		}
	},
});
