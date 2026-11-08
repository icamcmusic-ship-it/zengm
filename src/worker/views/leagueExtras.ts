// League extras: the native feature switches and options (common/nativeFeatures.ts), on a page of their own. The same
// settings are also in League Settings, in the League extras category.
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
