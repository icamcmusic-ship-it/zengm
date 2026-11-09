// Milestones (League extras, basketball): career milestones and all-time rank passes within reach, see
// worker/util/recordsBookData.ts
import type { RouteParams } from "../../ui/router/types.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import { validateOption, validateTeam } from "../util/processInputs.ts";
import { getMilestones } from "../util/recordsBookData.ts";

const processInputs = (params: RouteParams<"milestones">) => ({
	tid: validateTeam(params.team, ["all"]),
	horizon: validateOption(params.horizon, ["season", "two"], "season"),
});

export default defineView({
	id: "milestones",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("milestones");
		if (featureOff) {
			return featureOff;
		}
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("gameSim") ||
			updateEvents.has("newPhase") ||
			updateEvents.has("playerMovement") ||
			JSON.stringify(inputs) !== JSON.stringify(prevInputs)
		) {
			const { rows, reached, inSeason } = await getMilestones({
				tid: inputs.tid === "all" ? undefined : inputs.tid,
				horizon: inputs.horizon,
			});
			return {
				tid: inputs.tid,
				horizon: inputs.horizon,
				season: g.get("season"),
				userTid: g.get("userTid"),
				inSeason,
				rows,
				reached,
			};
		}
	},
});
