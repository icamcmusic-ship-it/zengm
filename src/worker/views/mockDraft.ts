import { featureOffError } from "../util/nativeFeatures.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { getMockDraftSeason } from "../core/draft/mockDraftData.ts";
import { getClassShape } from "../core/draft/classShape.ts";
import { idb } from "../db/index.ts";
import { PLAYER } from "../../common/constants.ts";

/**
 * Mock Draft tab of Draft Scouting. The draft itself is run on demand through the API (runMockDraft, getProProjections),
 * so a rerun gives a new draw without reloading the page.
 */
export default defineView({
	id: "mockDraft",
	load: async ({ updateEvents }) => {
		const featureOff = featureOffError("mockDraft");
		if (featureOff) {
			return featureOff;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameAttributes")
		) {
			return;
		}
		const season = getMockDraftSeason() ?? g.get("season") + 1;
		const prospects =
			__SPORT === "basketball"
				? (
						await idb.cache.players.indexGetAll(
							"playersByTid",
							PLAYER.UNDRAFTED,
						)
					).filter((p) => p.draft.year === season)
				: [];
		return {
			// Draft Class Shapes setting
			shape: getClassShape(prospects),
			season,
			phase: g.get("phase"),
			userTids: g.get("userTids"),
		};
	},
});
