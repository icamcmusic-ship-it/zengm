import { defineView, keepType } from "../util/defineView.ts";
import {
	getWrapped,
	getWrappedStatus,
	isBulkSimming,
	memoize,
	yieldToWorker,
	type Built,
} from "../util/wrappedData.ts";
import { wperfMark, wperfOutput, wperfTime } from "../util/wrappedPerf.ts";
import { findStoriesAsync, KIND_NAMES } from "../../common/storylines/index.ts";

export default defineView({
	id: "storylines",
	// Whether the page is showing its placeholder, which it replaces once the league history is ready
	keepPrevOutput: { loading: keepType<boolean>() },
	load: async ({ updateEvents, prevInputs, prevOutput }) => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "Storylines are only available for basketball." };
		}
		// While games are being simmed, leave the page as it is rather than rebuilding it every day. It updates when the sim stops.
		if (
			prevInputs !== undefined &&
			!updateEvents.has("firstRun") &&
			prevOutput.loading !== true &&
			isBulkSimming()
		) {
			return;
		}
		const tView = performance.now();
		let built: Built;
		if (prevInputs === undefined || prevOutput.loading === true) {
			// Don't make the page wait for the league history to be read. Show a placeholder, which gets replaced when it is ready.
			const st = getWrappedStatus(updateEvents.has("firstRun"));
			if (st.status === "loading") {
				return { loading: true as const, progress: st.progress };
			}
			if (st.status === "error") {
				return {
					errorMessage: `Could not read the league history: ${st.message}`,
				};
			}
			built = st.built;
		} else {
			built = await wperfTime("storylines.getIndex", () => getWrapped());
		}
		const { X } = built;
		const stories = await wperfTime("storylines.find", () =>
			memoize(built, "stories", () => findStoriesAsync(X, yieldToWorker)),
		);
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
		const out = {
			loading: false as const,
			stories,
			kinds: KIND_NAMES,
			teams,
			seasons: X.seasons,
		};
		wperfMark("storylines.view", performance.now() - tView);
		wperfOutput("storylines", out);
		return out;
	},
});
