import { featureOffError } from "../util/nativeFeatures.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { allTimeBest, seasonBest } from "../util/bestGamesData.ts";
import { validateSeason } from "../util/processInputs.ts";

// League extras: Best Games & Top Plays (a tab of the Daily Schedule)
export default defineView({
	id: "bestGames",
	processInputs: (params: { season?: string }) => ({
		season:
			params.season === "all"
				? ("all" as const)
				: validateSeason(params.season),
	}),
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("bestGames");
		if (featureOff) {
			return featureOff;
		}
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "Best Games is only available for basketball.",
			};
		}
		if (
			updateEvents.has("firstRun") ||
			inputs.season !== prevInputs?.season ||
			((inputs.season === "all" || inputs.season === g.get("season")) &&
				updateEvents.has("gameSim"))
		) {
			const best =
				inputs.season === "all"
					? await allTimeBest()
					: await seasonBest(inputs.season);
			return {
				season: inputs.season,
				games: best.games,
				plays: best.plays,
				numGames: best.numGames,
				numWithPbp: best.numWithPbp,
				userTids: g.get("userTids"),
			};
		}
	},
});
