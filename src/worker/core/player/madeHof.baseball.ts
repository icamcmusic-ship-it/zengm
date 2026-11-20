import { g } from "../../util/index.ts";
import type { PlayerWithoutKey } from "../../../common/types.ts";
import { getProStats } from "../../../common/preDraft.ts";
import {
	bestRegularSeason,
	hofSeasonValues,
	hofThresholdScale,
} from "./hofSeasons.ts";

/**
 * Is a player worthy of the Hall of Fame?
 *
 * This calculation is based on http://espn.go.com/nba/story/_/id/8736873/nba-experts-rebuild-springfield-hall-fame-espn-magazine except it includes each playoff run as a separate season.
 *
 * @memberOf core.player
 * @param {Object} p Player object.
 * @return {boolean} Hall of Fame worthy?
 */
const madeHof = (p: PlayerWithoutKey): boolean => {
	const stats = getProStats(p);

	let earliestSeason = Infinity;
	for (const ps of stats) {
		if (ps.season < earliestSeason) {
			earliestSeason = ps.season;
		}
	}

	// WAR per season (all of a season's teams together, playoffs separately), scaled to that season's schedule
	const seasons = hofSeasonValues(stats, (ps) => ps.war ?? 0);
	const wars = seasons.map((season) => season.value);

	// Calculate career WAR and "dominance factor" DF (top 5 years WAR - 30)
	wars.sort((a, b) => b - a); // Descending order

	let total = 0;
	let df = -30;

	for (const [i, war] of wars.entries()) {
		total += war;

		if (i < 5) {
			df += war;
		}
	}

	// Fudge factor for players generated when the league started: his best full regular season
	const fudgeSeasons =
		Math.min(earliestSeason, g.get("startingSeason")) - p.draft.year - 5;
	const bestSeason = bestRegularSeason(seasons);

	if (fudgeSeasons > 0 && bestSeason !== undefined) {
		total += bestSeason * fudgeSeasons;
	}

	// Final formula
	return total + df > 55 * hofThresholdScale();
};

export default madeHof;
