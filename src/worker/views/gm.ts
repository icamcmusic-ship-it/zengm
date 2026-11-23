// GM profile page (AI GM personalities): career, tenures, Executive of the Year wins, notable trades
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { gmEnabled } from "../core/gm/index.ts";
import { getGmProfile } from "../core/gm/profile.ts";
import { gmHotSeatLabel, gmStyleLabels } from "../../common/gmPersonality.ts";
import { idb } from "../db/index.ts";
import { isCollege } from "../core/college/isCollege.ts";

export default defineView({
	id: "gm",
	processInputs: (params: RouteParams<"gm">) => ({
		gmid: Number.parseInt(params.gmid ?? ""),
	}),
	load: async ({ updateEvents, inputs, prevInputs }) => {
		if (!gmEnabled() || isCollege()) {
			return {
				errorMessage: isCollege()
					? "There are no general managers in college leagues."
					: "AI GM personalities are turned off in this league (League Extras).",
			};
		}
		if (
			updateEvents.has("firstRun") ||
			inputs.gmid !== prevInputs?.gmid ||
			updateEvents.has("newPhase") ||
			updateEvents.has("team")
		) {
			const profile = Number.isNaN(inputs.gmid)
				? undefined
				: await getGmProfile(inputs.gmid);
			if (!profile) {
				return { errorMessage: "General manager not found." };
			}
			const t =
				profile.currentTid !== undefined
					? await idb.cache.teams.get(profile.currentTid)
					: undefined;
			return {
				...profile,
				styleLabels: gmStyleLabels(profile.traits),
				hotSeatLabel:
					t?.gm?.gmid === profile.gmid
						? gmHotSeatLabel(t.gm.hotSeat)
						: undefined,
			};
		}
	},
});
