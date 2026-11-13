import type { RatingKey } from "../../../common/types.basketball.ts";
import { expandedRatingsApply } from "./expandedRatings.ts";
import { ovrV2On } from "./ratingsModelSwitch.ts";
import { OVR_V2_WEIGHTS } from "./ovrWeights.basketball.ts";

// Expanded ratings: a quarter of height's weight goes to wingspan (wng averages hgt, so the league's ovr distribution doesn't move).
// diq is the average of perimeter and interior defense then, so its term covers them.
// Second step: reb is the average of oreb/dreb and fg/tp are kept (csh + dsh = fg + tp), so their terms cover them; a fifth of
// dribbling's weight goes to ball security (bsc averages about drb over a league).
const WNG_SHARE = 0.25;
const BSC_SHARE = 0.2;

const applyFudge = (r: number) => {
	// Fudge factor to keep ovr ratings the same as they used to be (back before 2018 ratings rescaling)
	// +8 at 68
	// +4 at 50
	// -5 at 42
	// -10 at 31
	let fudgeFactor = 0;
	if (r >= 68) {
		fudgeFactor = 8;
	} else if (r >= 50) {
		fudgeFactor = 4 + (r - 50) * (4 / 18);
	} else if (r >= 42) {
		fudgeFactor = -5 + (r - 42) * (9 / 8);
	} else if (r >= 31) {
		fudgeFactor = -5 - (42 - r) * (5 / 11);
	} else {
		fudgeFactor = -10;
	}

	const val = Math.round(r + fudgeFactor);

	if (val > 100) {
		return 100;
	}
	if (val < 0) {
		return 0;
	}

	return val;
};

// Sim-Calibrated Ovr (ovrV2 setting): every rating weighted by its measured value in the game sim, a separate fit with Expanded Ratings
// on (all the new ratings weighted, the compat diq/reb they replace not). Data-driven, see ovrWeights.basketball.ts and
// src/test/ovrFit/fit.script.test.ts. Same fudge factor as the stock formula, the fit keeps the league's scale.
const rawV2 = (ratings: Record<string, number>, expanded: boolean) => {
	const { intercept, weights } = expanded
		? OVR_V2_WEIGHTS.expanded
		: OVR_V2_WEIGHTS.stock;
	let r = intercept;
	for (const key in weights) {
		r += (weights as Record<string, number>)[key]! * ratings[key]!;
	}
	return r;
};

// Ovr before the fudge factor and rounding (linear in the ratings), for Coaching Staff Depth's ovr-neutral development plans
export const ovrRaw = (
	ratings: Record<RatingKey, number> & { wng?: number; bsc?: number },
): number => {
	const expanded = expandedRatingsApply(ratings);
	if (ovrV2On()) {
		return rawV2(ratings, expanded);
	}
	return ovrRawStock(ratings, expanded);
};

const ovr = (
	ratings: Record<RatingKey, number> & { wng?: number; bsc?: number },
): number => {
	const expanded = expandedRatingsApply(ratings);
	if (ovrV2On()) {
		return applyFudge(rawV2(ratings, expanded));
	}
	return applyFudge(ovrRawStock(ratings, expanded));
};

const ovrRawStock = (
	ratings: Record<RatingKey, number> & { wng?: number; bsc?: number },
	expanded: boolean,
): number => {
	const hgt = expanded
		? (1 - WNG_SHARE) * ratings.hgt + WNG_SHARE * ratings.wng!
		: ratings.hgt;
	const drb = expanded
		? (1 - BSC_SHARE) * ratings.drb + BSC_SHARE * ratings.bsc!
		: ratings.drb;

	// See analysis/player-ovr-basketball
	const r =
		0.159 * (hgt - 47.5) +
		0.0777 * (ratings.stre - 50.2) +
		0.123 * (ratings.spd - 50.8) +
		0.051 * (ratings.jmp - 48.7) +
		0.0632 * (ratings.endu - 39.9) +
		0.0126 * (ratings.ins - 42.4) +
		0.0286 * (ratings.dnk - 49.5) +
		0.0202 * (ratings.ft - 47.0) +
		0.0726 * (ratings.tp - 47.1) +
		0.133 * (ratings.oiq - 46.8) +
		0.159 * (ratings.diq - 46.7) +
		0.059 * (drb - 54.8) +
		0.062 * (ratings.pss - 51.3) +
		0.01 * (ratings.fg - 47.0) +
		0.01 * (ratings.reb - 51.4) +
		48.5;

	return r;
};

export default ovr;
