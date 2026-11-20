import { g } from "../../util/index.ts";
import type { Player, PlayerWithoutKey } from "../../../common/types.ts";
import type { PlayerRatings } from "../../../common/types.football.ts";
import { getProStats } from "../../../common/preDraft.ts";
import { hofSeasonValues, hofThresholdScale } from "./hofSeasons.ts";

const getMostCommonPos = (ratings: PlayerRatings[]) => {
	const counts = new Map<string, number>();

	for (const { pos } of ratings) {
		let count = counts.get(pos) ?? 0;
		count += 1;
		counts.set(pos, count);
	}

	let maxCount = -Infinity;
	let maxPos;

	for (const [pos, count] of counts.entries()) {
		if (count > maxCount) {
			maxCount = count;
			maxPos = pos;
		}
	}

	return maxPos;
};

/**
 * Goals
 * QB: 100 per 100 yrs
 * RB: 25 per 100 yrs
 * WR: 50 per 100 yrs
 * TE: 25 per 100 yrs
 * OL: 25 per 100 yrs
 * DL: 50 per 100 yrs
 * LB: 50 per 100 yrs
 * S: 25 per 100 yrs
 * CB: 25 per 100 yrs
 */
export const getThreshold = (pos?: string) => {
	let threshold = 100;

	if (pos === "QB") {
		threshold = 130;
	} else if (pos === "RB") {
		threshold = 95;
	} else if (pos === "WR") {
		threshold = 115;
	} else if (pos === "TE") {
		threshold = 60;
	} else if (pos === "OL") {
		threshold = 150;
	} else if (pos === "DL") {
		threshold = 140;
	} else if (pos === "LB") {
		threshold = 130;
	} else if (pos === "S") {
		threshold = 80;
	} else if (pos === "CB") {
		threshold = 95;
	}

	return threshold;
};

const madeHof = (
	p: Player<PlayerRatings> | PlayerWithoutKey<PlayerRatings>,
): boolean => {
	// AV per season (all of a season's teams together), scaled to that season's schedule. No playoff stats, because AV is scaled
	// strangely there
	const avs = hofSeasonValues(
		getProStats(p).filter((ps) => !ps.playoffs),
		(ps) => ps.av ?? 0,
	).map((season) => season.value);

	// Calculate career AV and "dominance factor" DF (top 5 years AV - 35)
	avs.sort((a, b) => b - a); // Descending order

	let total = 0;
	let df = -35;

	for (const [i, av] of avs.entries()) {
		total += av;

		if (i < 5) {
			df += av;
		}
	}

	// Fudge factor for players generated when the league started
	const fudgeSeasons = g.get("startingSeason") - p.draft.year - 7;

	if (fudgeSeasons > 0 && avs[0] !== undefined) {
		total += avs[0] * fudgeSeasons;
	}

	const pos = getMostCommonPos(p.ratings);
	const threshold = getThreshold(pos);

	// Final formula
	return total + df > threshold * hofThresholdScale();
};

export default madeHof;
