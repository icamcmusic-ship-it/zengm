import { g } from "../../util/index.ts";
import type { PlayerWithoutKey } from "../../../common/types.ts";
import { getProStats } from "../../../common/preDraft.ts";
import { hofSeasonValues, hofThresholdScale } from "./hofSeasons.ts";

const madeHof = (p: PlayerWithoutKey): boolean => {
	const stats = getProStats(p);
	if (stats.length === 0) {
		return false;
	}

	let earliestSeason = Infinity;
	for (const ps of stats) {
		if (ps.season < earliestSeason) {
			earliestSeason = ps.season;
		}
	}

	// Same as MVP formula, per season (all of a season's teams together, playoffs separately), scaled to that season's schedule
	const seasons = hofSeasonValues(stats, (ps) => {
		const g = (ps.evG ?? 0) + (ps.ppG ?? 0) + (ps.shG ?? 0);
		const a = (ps.evA ?? 0) + (ps.ppA ?? 0) + (ps.shA ?? 0);
		return (g + a) / 25 + (ps.ops ?? 0) + (ps.dps ?? 0) + 0.775 * (ps.gps ?? 0);
	});
	let score = 0;
	for (const season of seasons) {
		score += season.value;
	}

	// Fudge factor for players generated when the league started: his first full regular season
	const fudgeSeasons =
		Math.min(earliestSeason, g.get("startingSeason")) - p.draft.year - 5;
	const firstSeason = seasons.find((season) => !season.playoffs);

	if (fudgeSeasons > 0 && firstSeason) {
		score += firstSeason.value * fudgeSeasons;
	}

	// Final formula
	return score > 100 * hofThresholdScale();
};

export default madeHof;
