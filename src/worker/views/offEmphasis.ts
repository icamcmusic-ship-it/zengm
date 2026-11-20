import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { featureOffError, featureOn } from "../util/nativeFeatures.ts";
import { idb } from "../db/index.ts";
import { aiDefScheme, type DefScheme } from "../../common/shotProfiles.ts";

// Shot Profiles & Defensive Schemes: the user's scheme (undefined: the coach picks) and the coach's pick for the healthy roster
const defSchemeInfo = async (
	tid: number,
): Promise<{ value: DefScheme | undefined; auto: DefScheme } | undefined> => {
	if (!featureOn("shotProfiles")) {
		return undefined;
	}
	const t = await idb.cache.teams.get(tid);
	const players = (await idb.cache.players.indexGetAll("playersByTid", tid))
		.filter((p) => p.injury.gamesRemaining === 0)
		.toSorted((a, b) => b.valueNoPot - a.valueNoPot);
	return {
		value: t?.defScheme,
		auto: aiDefScheme(players.map((p) => p.ratings.at(-1) as any)),
	};
};
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
		return {
			...page,
			season: g.get("season"),
			defScheme: await defSchemeInfo(g.get("userTid")),
		};
	},
});
