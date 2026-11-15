import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import {
	getOffEmphasisPage,
	offEmphasisOn,
} from "../core/offEmphasis/index.ts";

// Offense (Offensive Emphasis, a tab of Coaching Staff): the user's team's play-type dials, presets, who sets them, the roster's play-type
// strengths and this season's play-type mix
export default defineView({
	id: "offEmphasis",
	processInputs: () => ({}),
	load: async () => {
		const off = featureOffError("offEmphasis");
		if (off) {
			return off;
		}
		if (!offEmphasisOn()) {
			return {
				errorMessage:
					"Offensive Emphasis needs Realistic Play Types (and the Realistic Possession Model and Spacing & Shot Creation). You can turn them on in League Settings → League Extras.",
			};
		}
		const page = await getOffEmphasisPage(g.get("userTid"));
		if (!page) {
			return { errorMessage: "No team." };
		}
		return { ...page, season: g.get("season") };
	},
});
