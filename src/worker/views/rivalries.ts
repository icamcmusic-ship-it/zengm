import { featureOffError } from "../util/nativeFeatures.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { isBulkSimming } from "../util/wrappedData.ts";
import { loadRivalries, type RivalPair } from "../util/rivalries.ts";
import {
	isFinals,
	rivalryLines,
	rivalryTimeline,
} from "../../common/rivalries/index.ts";
import type { RouteParams } from "../../ui/router/types.ts";

export const summarizePair = (e: RivalPair) => ({
	key: e.key,
	a: e.a,
	b: e.b,
	score: e.score.score,
	tier: e.score.tier,
	parts: e.score.parts,
	seriesA: e.seriesA,
	seriesB: e.seriesB,
	finals: e.finals,
	rsA: e.rsA,
	rsB: e.rsB,
	lastMet: e.lastMet,
});

const teamName = (tid: number) => {
	const t = g.get("teamInfoCache")[tid];
	return t ? `${t.region} ${t.name}` : `Team ${tid}`;
};

const processInputs = (params: RouteParams<"rivalries">) => {
	const m = /^(\d+)-(\d+)$/.exec(params.pair ?? "");
	return {
		pair:
			m && m[1] !== m[2]
				? `${Math.min(+m[1]!, +m[2]!)}-${Math.max(+m[1]!, +m[2]!)}`
				: undefined,
	};
};

export default defineView({
	id: "rivalries",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("rivalries");
		if (featureOff) {
			return featureOff;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameSim") &&
			inputs.pair === prevInputs?.pair
		) {
			return;
		}
		if (!updateEvents.has("firstRun") && isBulkSimming()) {
			return;
		}

		const pairs = await loadRivalries();
		const top = pairs.filter((e) => e.score.score > 0).slice(0, 30);

		const finalsSeries = pairs
			.flatMap((e) => e.input.series.filter(isFinals))
			.sort((x, y) => y.season - x.season);
		const finalsPairs = pairs
			.filter((e) => e.finals > 0)
			.sort(
				(x, y) =>
					y.finals - x.finals ||
					(y.lastMet ?? 0) - (x.lastMet ?? 0) ||
					y.score.score - x.score.score,
			)
			.slice(0, 15);

		const selected =
			(inputs.pair ? pairs.find((e) => e.key === inputs.pair) : undefined) ??
			top[0];

		return {
			pair: inputs.pair,
			top: top.map(summarizePair),
			finalsSeries,
			finalsPairs: finalsPairs.map(summarizePair),
			selected: selected
				? {
						...summarizePair(selected),
						lines: rivalryLines(selected.input, teamName),
						timeline: rivalryTimeline(selected.input),
						series: [...selected.input.series].reverse(),
						closeGames: selected.input.closeGames?.length ?? 0,
						starDuels: selected.input.starDuels ?? [],
						sameDiv: !!selected.input.sameDiv,
					}
				: undefined,
			season: g.get("season"),
		};
	},
});
