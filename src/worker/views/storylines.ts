import { defineView } from "../util/defineView.ts";
import { getWrappedIndex } from "../util/wrappedData.ts";
import { findStories, KIND_NAMES } from "../../common/storylines/index.ts";

export default defineView({
	id: "storylines",
	load: async ({ updateEvents }) => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "Storylines are only available for basketball." };
		}
		const X = await getWrappedIndex(updateEvents);
		const stories = findStories(X);
		const teams: Record<
			number,
			{ abbrev: string; colors: [string, string, string]; imgURL?: string }
		> = {};
		for (const s of stories) {
			for (const tid of s.tids) {
				const t = X.teamAny(tid, s.season);
				if (t) {
					teams[tid] = { abbrev: t.abbrev, colors: t.colors, imgURL: t.imgURL };
				}
			}
		}
		return {
			stories,
			kinds: KIND_NAMES,
			teams,
			seasons: X.seasons,
		};
	},
});
