import { defineView, keepType } from "../util/defineView.ts";
import { loadFromSnapshot, teamNamer } from "../util/leagueHistoryData.ts";
import {
	MATURE,
	buildRedraft,
	classStealsBusts,
	type RedraftEntry,
} from "../../common/leagueHistory/redraft.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import type { WLeague } from "../../common/wrapped/types.ts";

const processInputs = (params: RouteParams<"redraft">) => {
	const season =
		params.season !== undefined && /^\d+$/.test(params.season)
			? Number.parseInt(params.season)
			: undefined;
	return { season };
};

const withNames = (L: WLeague, xs: RedraftEntry[]) => {
	const names = new Map(L.players.map((p) => [p.pid, p.name]));
	const team = teamNamer(L);
	return xs.map((x) => ({
		...x,
		name: names.get(x.pid) ?? "",
		abbrev: x.pick !== null ? team(x.tid, x.year).abbrev : undefined,
	}));
};

export default defineView({
	id: "redraft",
	processInputs,
	keepPrevOutput: { loading: keepType<boolean>() },
	load: async ({ inputs, updateEvents, prevInputs, prevOutput }) => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "Redraft is only available for basketball." };
		}
		const res = await loadFromSnapshot({
			key: "redraft",
			compute: buildRedraft,
			updateEvents,
			inputsChanged:
				prevInputs === undefined ||
				JSON.stringify(prevInputs) !== JSON.stringify(inputs),
			wasLoading: prevOutput.loading === true,
		});
		if (res === undefined || !("result" in res)) {
			return res;
		}
		const { result: R, L } = res;

		const usable = R.years.filter((y) => !R.classes.get(y)!.partial);
		const fallback =
			usable.filter((y) => !R.classes.get(y)!.developing).at(-1) ??
			R.years.at(-1);
		const requested = inputs.season;
		const year =
			requested !== undefined && R.classes.has(requested)
				? requested
				: fallback;
		const cls = year !== undefined ? R.classes.get(year) : undefined;
		const sb = cls ? classStealsBusts(cls, 3) : { steals: [], busts: [] };

		const names = new Map(L.players.map((p) => [p.pid, p.name]));
		const named = (x: RedraftEntry | null) =>
			x ? { ...x, name: names.get(x.pid) ?? "" } : null;

		return {
			loading: false as const,
			mature: MATURE,
			from: R.from,
			years: R.years,
			partialYears: R.years.filter((y) => R.classes.get(y)!.partial),
			requested,
			year,
			cls: cls
				? {
						year: cls.year,
						partial: cls.partial,
						developing: cls.developing,
						seasonsSince: cls.seasonsSince,
						perRound: cls.perRound,
						drafted: cls.drafted,
						undrafted: cls.undrafted,
						entries: withNames(L, cls.entries),
						steals: withNames(L, sb.steals),
						busts: withNames(L, sb.busts),
					}
				: undefined,
			steals: withNames(L, R.steals.slice(0, 15)),
			busts: withNames(L, R.busts.slice(0, 15)),
			ones: R.ones.map((o) => ({
				year: o.year,
				actual: named(o.actual),
				redraft: named(o.redraft),
			})),
		};
	},
});
