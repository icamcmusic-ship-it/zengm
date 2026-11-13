import fuzzRating from "./fuzzRating.ts";
import { g } from "../../util/index.ts";
import type { PlayerWithoutKey } from "../../../common/types.ts";
import valueCombineOvrPot from "./valueCombineOvrPot.ts";
import { bySport } from "../../../common/sportFunctions.ts";
import { last } from "../../../common/utils.ts";
import { getProStats } from "../../../common/preDraft.ts";
import { ovrV2On, realisticAgingOn } from "./ratingsModelSwitch.ts";

/**
 * Returns a numeric value for a given player, representing is general worth to a typical team
 * (i.e. ignoring how well he fits in with his teammates and the team's strategy/finances). It
 * is similar in scale to the overall and potential ratings of players (0-100), but it is based
 * on stats in addition to ratings. The main components are:
 *
 * 1. Recent stats: Avg of last 2 seasons' PER if min > 2000. Otherwise, scale by min / 2000 and
 *     use ratings to estimate the rest.
 * 2. Potential for improvement (or risk for decline): Based on age and potential rating.
 *
 * @memberOf core.player
 * @param {Object} p Player object.
 * @param {Object=} options Object containing several optional options:
 *     noPot: When true, don't include potential in the value calcuation (useful for roster
 *         ordering and game simulation). Default false.
 *     fuzz: When true, used fuzzed ratings (useful for roster ordering, draft prospect
 *         ordering). Default false.
 * @return {number} Value of the player, usually between 50 and 100 like overall and potential
 *     ratings.
 */
// Realistic Aging: ages with no age discount in value (see below)
const VETERAN_VALUE_AGES = [32, 39];

const value = (
	p: PlayerWithoutKey,
	options: {
		fuzz?: boolean;
		noPot?: boolean;
		ovrMean: number;
		ovrStd: number;
	},
): number => {
	options.noPot = !!options.noPot;
	options.fuzz = !!options.fuzz;

	// Latest season
	const ratings = last(p.ratings);
	const pos = ratings.pos;

	// Current values, adjusted for fuzz
	let ovr;
	let pot;

	// Fuzz?
	if (options.fuzz) {
		ovr = fuzzRating(ratings.ovr, ratings.fuzz);
		pot = fuzzRating(ratings.pot, ratings.fuzz);
	} else {
		ovr = ratings.ovr;
		pot = ratings.pot;
	}

	// Normalize ovr/pot, these are values for a typical random players league
	const defaultOvrMean = bySport({
		baseball: 47,
		basketball: 47,
		football: 48,
		hockey: 50,
	});
	const defaultOvrStd = bySport({
		baseball: 11,
		basketball: 10,
		football: 11,
		hockey: 11,
	});
	if (options.ovrStd > 0) {
		ovr =
			((ovr - options.ovrMean) / options.ovrStd) * defaultOvrStd +
			defaultOvrMean;
		pot =
			((pot - options.ovrMean) / options.ovrStd) * defaultOvrStd +
			defaultOvrMean;
	} else {
		ovr = ovr - options.ovrMean + defaultOvrMean;
		pot = pot - options.ovrMean + defaultOvrMean;
	}

	// From linear regression OVR ~ PER
	const slope = 1.531;
	const intercept = 31.693;

	// 1. Account for stats (and current ratings if not enough stats)
	// Pre-draft (college) rows must not change a player's value, see common/preDraft.ts
	const ps = getProStats(p).filter((playerStats) => !playerStats.playoffs);
	let current = ovr;

	// No stats at all? Just look at ratings more, then.
	const ps1 = ps.at(-1); // Most recent stats
	if (__SPORT === "basketball" && ps1) {
		// PER may be undefined for exhibition game players from old historical seasons. See ps2 check below too. Missing min is treated as no minutes played
		const per1 = ps1.per;
		const min1 = ps1.min ?? 0;
		if (per1 !== undefined) {
			if (ps.length === 1 || min1 >= 2000) {
				// Only one year of stats
				current = intercept + slope * per1;

				if (min1 < 2000) {
					current = (current * min1) / 2000 + ovr * (1 - min1 / 2000);
				}
			} else {
				// Two most recent seasons
				const ps2 = ps.at(-2)!;
				const per2 = ps2.per;
				const min2 = ps2.min ?? 0;

				if (per2 !== undefined) {
					if (min1 + min2 > 0) {
						current =
							intercept + (slope * (per1 * min1 + per2 * min2)) / (min1 + min2);

						if (min1 + min2 < 2000) {
							current =
								(current * (min1 + min2)) / 2000 +
								ovr * (1 - (min1 + min2) / 2000);
						}
					}
				}
			}

			// Include some part of the ratings. Sim-Calibrated Ovr: ovr already measures sim impact, and PER flatters box-score bigs (rebounds,
			// blocks, at-rim efficiency) over what they add to winning, so it gets half the weight
			current = ovrV2On()
				? 0.9 * ovr + 0.1 * current
				: 0.8 * ovr + 0.2 * current;
		}
	}

	// 2. Potential
	let potential = pot;

	if (__SPORT === "football") {
		if (pos === "QB") {
			current *= 1.1;
			potential *= 1.1;
		} else if (pos === "K" || pos === "P") {
			current *= 0.7;
			potential *= 0.7;
		}
	}

	// Short circuit if we don't care about potential
	if (options.noPot) {
		return current;
	}

	// If performance is already exceeding predicted potential, just use that
	if (current >= potential) {
		potential = current;
	}

	let age;

	if (p.draft.year > g.get("season")) {
		// Draft prospect
		age = p.draft.year - p.born.year;
	} else {
		age = g.get("season") - p.born.year;
	}

	// Otherwise, combine based on age
	let combined = valueCombineOvrPot(current, potential, age);
	if (
		__SPORT === "basketball" &&
		age >= VETERAN_VALUE_AGES[0] &&
		age <= VETERAN_VALUE_AGES[1] &&
		realisticAgingOn()
	) {
		// Realistic Aging: a veteran's value is his current level with no age discount (stock: 8-10% off at 32-39), so AI teams keep and
		// sign useful veterans like NBA teams do instead of cutting them for younger players of the same level
		combined = current;
	}

	return combined < 0 ? Number.MIN_VALUE : combined;
};

export default value;
