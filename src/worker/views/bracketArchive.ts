import { defineView } from "../util/defineView.ts";
import { getBracketArchive } from "../core/playoffExtras/index.ts";
import { g } from "../util/index.ts";

// Every season's playoff bracket, newest first (Playoffs → Bracket Archive)
export default defineView({
	id: "bracketArchive",
	load: async ({ updateEvents }) => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "The Bracket Archive is only in Basketball GM." };
		}
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("newPhase") ||
			updateEvents.has("playoffs") ||
			(updateEvents.has("gameSim") && g.get("phase") >= 3)
		) {
			return {
				seasons: await getBracketArchive(),
				userTids: g.get("userTids"),
			};
		}
	},
});
