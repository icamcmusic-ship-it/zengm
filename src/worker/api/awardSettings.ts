import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import type { GameAttributesLeague } from "../../common/types.ts";
import { getAwardCandidates as getAwardCandidatesRaw } from "../core/awards/getAwardCandidates.ts";
import {
	AWARD_STATS_ALL,
	PLAYOFF_SERIES_AWARD_STATS_ALL,
} from "../core/awards/getPlayers.ts";
import g from "../util/g.ts";
import {
	advStatsOn,
	isTrackingAwardVar,
	trackingVariableDocs,
} from "../core/awards/trackingAwards.ts";

export const getAwardCandidates = async (
	info:
		| {
				type: "season";
				season: number;
		  }
		| {
				type: "default";
				season: number;
		  }
		| {
				type: "custom";
				season: number;
				awards: GameAttributesLeague["awards"];
		  },
) => {
	const season = info.season;
	const awards =
		info.type === "season"
			? g.get("awards")
			: info.type === "default"
				? defaultGameAttributes.awards
				: info.awards;
	return await getAwardCandidatesRaw(season, awards);
};

export const getVariables = () => {
	// Advanced Tracking Stats variables are listed on their own, grouped
	const normalSet = new Set(
		AWARD_STATS_ALL.filter((key) => !isTrackingAwardVar(key)),
	);
	const playoffSeriesSet = new Set(
		PLAYOFF_SERIES_AWARD_STATS_ALL.filter((key) => !isTrackingAwardVar(key)),
	);

	const common = Array.from(normalSet.intersection(playoffSeriesSet));
	const normalOnly = Array.from(normalSet.difference(playoffSeriesSet));
	const playoffSeriesOnly = Array.from(playoffSeriesSet.difference(normalSet));

	const tracking =
		__SPORT === "basketball" ? trackingVariableDocs() : undefined;

	return {
		common,
		normalOnly,
		playoffSeriesOnly,
		tracking,
		advStatsOn: advStatsOn(),
	};
};
