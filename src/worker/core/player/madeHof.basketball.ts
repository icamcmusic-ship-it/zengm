import { g } from "../../util/index.ts";
import type { PlayerWithoutKey } from "../../../common/types.ts";
import { getProStats } from "../../../common/preDraft.ts";
import {
	bestRegularSeason,
	hofSeasonValues,
	hofThresholdScale,
	type HofSeason,
} from "./hofSeasons.ts";

// Value of one stats row: WS and EWA averaged together
export const hofRowValue = (ps: {
	dws?: number;
	ows?: number;
	ewa?: number;
}) => {
	let sum = 0;
	if (typeof ps.dws === "number") {
		sum += ps.dws;
	}
	if (typeof ps.ows === "number") {
		sum += ps.ows;
	}
	if (typeof ps.ewa === "number") {
		sum += ps.ewa;
	}
	return sum / 2;
};

// The base threshold, before hofThresholdScale
export const HOF_BASE_THRESHOLD = 120;

/**
 * Career total plus "dominance factor" (top 5 seasons - 50) of these season values, plus the fudge factor of players generated
 * when the league started (fudgeSeasons seasons credited with his best full regular season).
 */
export const hofScoreFromSeasons = (
	seasons: readonly HofSeason[],
	fudgeSeasons: number,
) => {
	const values = seasons.map((season) => season.value);
	values.sort((a, b) => b - a); // Descending order

	let total = 0;
	let df = -50;
	for (const [i, value] of values.entries()) {
		total += value;
		if (i < 5) {
			df += value;
		}
	}

	const bestSeason = bestRegularSeason(seasons);
	if (fudgeSeasons > 0 && bestSeason !== undefined) {
		total += bestSeason * fudgeSeasons;
	}

	return total + df;
};

// Seasons before the league's records (players generated when the league started) are credited with his best full regular season
export const hofFudgeSeasons = (
	p: Pick<PlayerWithoutKey, "draft">,
	earliestSeason: number,
) => Math.min(earliestSeason, g.get("startingSeason")) - p.draft.year - 5;

/**
 * Hall of Fame score and threshold. He is worthy when score > threshold.
 *
 * This calculation is based on http://espn.go.com/nba/story/_/id/8736873/nba-experts-rebuild-springfield-hall-fame-espn-magazine except it includes each playoff run as a separate season.
 */
export const hofScoreBasketball = (p: PlayerWithoutKey) => {
	const stats = getProStats(p);

	let earliestSeason = Infinity;
	for (const ps of stats) {
		if (ps.season < earliestSeason) {
			earliestSeason = ps.season;
		}
	}

	// Average together WS and EWA, per season (all of a season's teams together, playoffs separately), scaled to that season's
	// schedule
	const seasons = hofSeasonValues(stats, hofRowValue);
	const fudgeSeasons = hofFudgeSeasons(p, earliestSeason);

	return {
		score: hofScoreFromSeasons(seasons, fudgeSeasons),
		threshold: HOF_BASE_THRESHOLD * hofThresholdScale(),
		seasons,
		fudgeSeasons,
	};
};

/**
 * Is a player worthy of the Hall of Fame?
 *
 * @memberOf core.player
 * @param {Object} p Player object.
 * @return {boolean} Hall of Fame worthy?
 */
const madeHof = (p: PlayerWithoutKey): boolean => {
	const { score, threshold } = hofScoreBasketball(p);
	return score > threshold;
};

export default madeHof;
