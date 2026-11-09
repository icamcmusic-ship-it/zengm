import { featureOffError } from "../util/nativeFeatures.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { getMockDraftSeason } from "../core/draft/mockDraftData.ts";

/**
 * Mock Draft tab of Draft Scouting. The draft itself is run on demand through the API (runMockDraft, getProProjections),
 * so a rerun gives a new draw without reloading the page.
 */
export default defineView({
	id: "mockDraft",
	load: ({ updateEvents }) => {
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
		return {
			season: getMockDraftSeason() ?? g.get("season") + 1,
			phase: g.get("phase"),
			userTids: g.get("userTids"),
		};
	},
});
