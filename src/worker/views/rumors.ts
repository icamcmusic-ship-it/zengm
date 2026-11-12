import {
	accuracyByLevel,
	accuracyBySeason,
	accuracyByType,
} from "../../common/rumors/logic.ts";
import { RUMOR_TYPE_NAMES } from "../../common/rumors/types.ts";
import { getRumorState } from "../core/rumors/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { featureOffError } from "../util/nativeFeatures.ts";

// The rumor mill (League extras): rumors of the current and last season, newest first, and the track record
export default defineView({
	id: "rumors",
	load: ({ updateEvents }) => {
		const featureOff = featureOffError("rumors");
		if (featureOff) {
			return featureOff;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("gameSim") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameAttributes")
		) {
			return;
		}

		const state = getRumorState();
		const teams = g.get("teamInfoCache").map((t, tid) => ({
			tid,
			abbrev: t.abbrev,
			region: t.region,
			name: t.name,
			disabled: !!t.disabled,
		}));

		return {
			rumors: state.items.toReversed(),
			teams,
			userTid: g.get("userTid"),
			season: g.get("season"),
			accuracy: {
				bySeason: accuracyBySeason(state.stats),
				byType: accuracyByType(state.stats, RUMOR_TYPE_NAMES),
				byLevel: accuracyByLevel(state.items),
			},
		};
	},
});
