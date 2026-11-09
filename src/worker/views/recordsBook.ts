// Records Book (League extras, basketball): league or franchise records, see worker/util/recordsBookData.ts
import type { RouteParams } from "../../ui/router/types.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import { validateTeam } from "../util/processInputs.ts";
import { getRecordsBook } from "../util/recordsBookData.ts";

const processInputs = (params: RouteParams<"recordsBook">) => ({
	tid: validateTeam(params.team, ["all"]),
});

export default defineView({
	id: "recordsBook",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("recordsBook");
		if (featureOff) {
			return featureOff;
		}
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("gameSim") ||
			updateEvents.has("newPhase") ||
			inputs.tid !== prevInputs?.tid
		) {
			const tid = inputs.tid === "all" ? undefined : inputs.tid;
			const sections = await getRecordsBook({ tid });
			return {
				tid: inputs.tid,
				season: g.get("season"),
				userTid: g.get("userTid"),
				sections,
			};
		}
	},
});
