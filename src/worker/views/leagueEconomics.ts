import { featureOffError } from "../util/nativeFeatures.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { getSeasonState } from "../util/processInputs.ts";
import { isCurrentSeasonComplete } from "../../common/seasons.ts";
import { buildEconomics } from "../../common/leagueHistory/economics.ts";

export default defineView({
	id: "leagueEconomics",
	load: async ({ updateEvents }) => {
		const featureOff = featureOffError("frivolities");
		if (featureOff) {
			return featureOff;
		}
		// Payrolls and luxury taxes are only written at the end of a season
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("teamFinances")
		) {
			return;
		}
		const currentSeason = g.get("season");
		const teamSeasons = await idb.merged.teamSeasons.getAll();

		const completeSeasons = new Set<number>();
		const numPlayoffRounds: Record<number, number> = {};
		for (const ts of teamSeasons) {
			if (numPlayoffRounds[ts.season] === undefined) {
				numPlayoffRounds[ts.season] = g.get(
					"numGamesPlayoffSeries",
					ts.season,
				).length;
			}
			if (ts.season < currentSeason) {
				completeSeasons.add(ts.season);
			}
		}
		if (isCurrentSeasonComplete(getSeasonState())) {
			completeSeasons.add(currentSeason);
		}

		const E = buildEconomics({
			teamSeasons: teamSeasons
				.filter((ts) => ts.season <= currentSeason)
				.map((ts) => ({
					tid: ts.tid,
					season: ts.season,
					payroll: ts.payrollEndOfSeason ?? -1,
					luxuryTax: ts.expenses?.luxuryTax ?? 0,
					playoffRoundsWon: ts.playoffRoundsWon,
				})),
			numPlayoffRounds,
			completeSeasons,
		});

		const teamInfos: Record<
			string,
			{ abbrev: string; region: string; name: string }
		> = {};
		const latest: Record<
			number,
			{ abbrev: string; region: string; name: string }
		> = {};
		const latestSeason: Record<number, number> = {};
		for (const ts of teamSeasons) {
			const info = { abbrev: ts.abbrev, region: ts.region, name: ts.name };
			teamInfos[`${ts.tid}|${ts.season}`] = info;
			if (
				latestSeason[ts.tid] === undefined ||
				ts.season > latestSeason[ts.tid]!
			) {
				latestSeason[ts.tid] = ts.season;
				latest[ts.tid] = info;
			}
		}

		return {
			// The full payroll list of each season isn't needed on the page
			seasons: E.seasons.map(({ payrolls, ...s }) => s),
			unknownSeasons: E.unknownSeasons,
			taxes: E.taxes.slice(0, 100),
			numTaxes: E.taxes.length,
			taxByTeam: E.taxByTeam,
			champions: E.champions,
			cheapestChampions: E.cheapestChampions.slice(0, 10),
			summary: E.summary,
			teamInfos,
			latestTeamInfos: latest,
			luxuryPayroll: g.get("luxuryPayroll"),
			luxuryTax: g.get("luxuryTax"),
			salaryCapType: g.get("salaryCapType"),
			budget: g.get("budget"),
		};
	},
});
