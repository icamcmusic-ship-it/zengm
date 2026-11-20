import { featureOffError } from "../util/nativeFeatures.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import {
	ERA_KEYS,
	eraLabel,
	type EraRecord,
	type EraValues,
	type RuleVote,
} from "../../common/leagueEras.ts";

type Row = {
	season: number;
	values: EraValues;
	label: string;
	tpShare: number | undefined;
	poss: number | undefined;
	scheduled: boolean;
	vote: RuleVote | undefined;
	current: boolean;
};

export default defineView({
	id: "leagueEras",
	load: async ({ updateEvents }) => {
		const featureOff = featureOffError("leagueEras");
		if (featureOff) {
			return featureOff;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameAttributes")
		) {
			return;
		}
		const season = g.get("season");
		const awards = await idb.merged.awards.getAll();
		const rows: Row[] = [];
		let latest: EraRecord | undefined;
		for (const a of awards as any[]) {
			const era: EraRecord | undefined = a.era;
			if (!era) {
				continue;
			}
			latest = era;
			rows.push({
				season: a.season,
				values: era.values,
				label: era.label,
				tpShare: era.tpShare,
				poss: era.poss,
				scheduled: !!era.scheduled,
				vote: era.vote,
				current: false,
			});
		}

		// The season being played (or about to be), before its record exists
		if (!rows.some((row) => row.season === season)) {
			const values = {} as EraValues;
			for (const key of ERA_KEYS) {
				values[key] = g.get(key);
			}
			const baseline = latest?.nextBaseline ?? latest?.baseline ?? values;
			rows.push({
				season,
				values,
				label: eraLabel(values, baseline),
				tpShare: undefined,
				poss: undefined,
				scheduled: false,
				vote: undefined,
				current: true,
			});
		}

		rows.sort((a, b) => b.season - a.season);
		return { rows };
	},
});
