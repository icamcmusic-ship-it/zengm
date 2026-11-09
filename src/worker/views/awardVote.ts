import { featureOffError, featureOption } from "../util/nativeFeatures.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { idb } from "../db/index.ts";
import { validateSeasonOnly } from "../util/processInputs.ts";
import { computeSimVotes } from "../core/awards/simVote.ts";
import { PHASE } from "../../common/constants.ts";
import type { SimVote } from "../../common/awardVote/index.ts";

// League extras: Award Vote (a tab of Award Races). The stored vote of a past season, a vote reconstructed from the
// stored winners when none was saved, or the projected vote of the season in progress.
export default defineView({
	id: "awardVote",
	processInputs: validateSeasonOnly,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("awardVote");
		if (featureOff) {
			return featureOff;
		}
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "Award Vote is only available for basketball.",
			};
		}
		const season = inputs.season;
		if (
			updateEvents.has("firstRun") ||
			season !== prevInputs?.season ||
			(season === g.get("season") &&
				(updateEvents.has("gameSim") ||
					updateEvents.has("playerMovement") ||
					updateEvents.has("newPhase")))
		) {
			const stored = await idb.merged.awards.get(season);
			let votes: SimVote[];
			let source: "stored" | "reconstructed" | "projected";
			if (stored?.simVote && stored.simVote.length > 0) {
				votes = stored.simVote;
				source = "stored";
			} else if (stored) {
				votes = await computeSimVotes(season, true);
				source = "reconstructed";
			} else {
				votes = await computeSimVotes(season, false);
				source = "projected";
			}
			const phase = g.get("phase");
			const inProgress =
				season === g.get("season") && phase < PHASE.PLAYOFFS && !stored;
			return {
				season,
				votes,
				source,
				inProgress,
				decides: featureOption<boolean>("featureAwardVoteDecides") === true,
				userTids: g.get("userTids"),
			};
		}
	},
});
