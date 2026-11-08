import { featureOffError } from "../util/nativeFeatures.ts";
import { defineView, keepType } from "../util/defineView.ts";
import { loadFromSnapshot } from "../util/leagueHistoryData.ts";
import {
	buildFamilies,
	familyOf,
	type FamilyPair,
} from "../../common/leagueHistory/families.ts";
import type { RouteParams } from "../../ui/router/types.ts";

const processInputs = (params: RouteParams<"familyTrees">) => {
	const pid =
		params.pid !== undefined && /^\d+$/.test(params.pid)
			? Number.parseInt(params.pid)
			: undefined;
	return { pid };
};

// Families in the list sent to the page. The selected family is always sent in full.
const CAP = 300;

export default defineView({
	id: "familyTrees",
	processInputs,
	keepPrevOutput: { loading: keepType<boolean>() },
	load: async ({ inputs, updateEvents, prevInputs, prevOutput }) => {
		const featureOff = featureOffError("frivolities");
		if (featureOff) {
			return featureOff;
		}
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "Family Trees are only available for basketball.",
			};
		}
		const res = await loadFromSnapshot({
			key: "familyTrees",
			compute: buildFamilies,
			updateEvents,
			inputsChanged:
				prevInputs === undefined ||
				JSON.stringify(prevInputs) !== JSON.stringify(inputs),
			wasLoading: prevOutput.loading === true,
		});
		if (res === undefined || !("result" in res)) {
			return res;
		}
		const { result: F, L } = res;

		const selected =
			inputs.pid !== undefined ? familyOf(F, inputs.pid) : F.families[0];

		const names = new Map(L.players.map((p) => [p.pid, p.name]));
		const pairs = (xs: FamilyPair[]) =>
			xs.map((x) => ({
				...x,
				aName: names.get(x.a) ?? "",
				bName: names.get(x.b) ?? "",
			}));

		// Family records over every family, not just the ones in the list
		const recordKeys = [
			"ws",
			"pts",
			"gp",
			"titles",
			"allStar",
			"mvp",
			"hof",
			"players",
			"gens",
		] as const;
		const records = recordKeys.map((key) => {
			let best: (typeof F.families)[number] | undefined;
			for (const f of F.families) {
				if (!best || f.totals[key] > best.totals[key]) {
					best = f;
				}
			}
			return {
				key,
				value: best ? best.totals[key] : 0,
				id: best?.id,
				name: best?.name,
			};
		});

		return {
			loading: false as const,
			records,
			requestedPid: inputs.pid,
			numFamilies: F.families.length,
			related: F.related,
			// The list only needs the totals and who is in it
			families: F.families.slice(0, CAP).map((f) => ({
				id: f.id,
				name: f.name,
				totals: f.totals,
				members: f.members.map((m) => ({ pid: m.pid, name: m.name })),
			})),
			selected,
			fatherSon: pairs(F.fatherSon),
			brothers: pairs(F.brothers),
			season: L.season,
		};
	},
});
