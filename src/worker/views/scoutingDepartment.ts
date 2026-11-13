import { defineView } from "../util/defineView.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import { validateTeam } from "../util/processInputs.ts";
import { getDepartmentPage } from "../core/scoutingReports/index.ts";
import { getScoutingDepth } from "../core/staffDepth/report.ts";
import type { RouteParams } from "../../ui/router/types.ts";

// A team's scouting department (Scouting Reports setting): scouts, specialties, biases, who came and went, and the track record
export default defineView({
	id: "scoutingDepartment",
	processInputs: (params: RouteParams<"scoutingDepartment">) => ({
		tid: validateTeam(params.team),
	}),
	load: async ({ inputs: { tid }, updateEvents, prevInputs }) => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "Scouting reports are only in Basketball GM." };
		}
		const off = featureOffError("scoutingReports");
		if (off) {
			return off;
		}
		if (
			!updateEvents.has("firstRun") &&
			tid === prevInputs?.tid &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameAttributes") &&
			!updateEvents.has("staff")
		) {
			return;
		}
		return {
			...(await getDepartmentPage(tid)),
			// Scouting Director & Regions: the Director, regions and scout careers (undefined when off)
			depth: await getScoutingDepth(tid),
		};
	},
});
