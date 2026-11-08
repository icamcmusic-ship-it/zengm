import { featureOffError } from "../util/nativeFeatures.ts";
import { defineView, keepType } from "../util/defineView.ts";
import { loadFromSnapshot } from "../util/leagueHistoryData.ts";
import { buildPickValue } from "../../common/leagueHistory/pickValue.ts";

export default defineView({
	id: "pickValue",
	keepPrevOutput: { loading: keepType<boolean>() },
	load: async ({ updateEvents, prevOutput }) => {
		const featureOff = featureOffError("frivolities");
		if (featureOff) {
			return featureOff;
		}
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "Draft Pick Value is only available for basketball.",
			};
		}
		const res = await loadFromSnapshot({
			key: "pickValue",
			compute: buildPickValue,
			updateEvents,
			inputsChanged: false,
			wasLoading: prevOutput.loading === true,
		});
		if (res === undefined || !("result" in res)) {
			return res;
		}
		const { result: V, L } = res;

		const names: Record<number, string> = {};
		if (V) {
			const want = new Set<number>();
			for (const x of [...V.slots, ...V.bands, V.undrafted]) {
				if (x.best !== null) {
					want.add(x.best);
				}
			}
			for (const p of L.players) {
				if (want.has(p.pid)) {
					names[p.pid] = p.name;
				}
			}
		}

		return {
			loading: false as const,
			hasDraftClasses: L.players.some((p) => p.draft.round > 0),
			startingSeason: L.startingSeason,
			value: V,
			names,
		};
	},
});
