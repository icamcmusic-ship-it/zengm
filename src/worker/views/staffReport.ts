import { defineView } from "../util/defineView.ts";
import { featureOn } from "../util/nativeFeatures.ts";
import { getStaffReport } from "../core/staffDepth/report.ts";

// Staff Report (Scouting Director & Regions / Coaching Staff Depth): top targets and blind spots, development results and plans, system
// fit, injury/conditioning outlook, one recommended action per area, pending proposals and delegation
export default defineView({
	id: "staffReport",
	processInputs: () => ({}),
	load: async () => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "The Staff Report is only in Basketball GM." };
		}
		if (
			!featureOn("scoutingDepth") &&
			!(featureOn("coachingDepth") && featureOn("coachingStaff"))
		) {
			return {
				errorMessage:
					"The Staff Report needs Scouting Director & Regions or Coaching Staff Depth. You can turn them on in League Settings → League Extras.",
			};
		}
		const report = await getStaffReport();
		if (!report) {
			return { errorMessage: "No team." };
		}
		return report;
	},
});
