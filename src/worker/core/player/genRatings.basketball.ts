import genFuzz from "./genFuzz.ts";
import heightToRating from "./heightToRating.ts";
import limitRating from "./limitRating.ts";
import { helpers } from "../../util/index.ts";
import type {
	PlayerRatings,
	RatingKey,
} from "../../../common/types.basketball.ts";
import { heightDist, realGauss } from "../../../common/random.ts";
import { probit } from "../../../common/archetypes/norms.ts";
import { assertDefined } from "../../../common/utils.ts";
import {
	BALL_SECURITY_NOISE,
	ballSecurityBase,
	blendDiq,
	defenseSplitBase,
	DEFENSE_SPLIT_NOISE,
	REBOUND_SPLIT_NOISE,
	reboundSplitBase,
	SHOOTING_SPLIT_NOISE,
	shootingSplitBase,
} from "../../../common/expandedRatings.ts";
import {
	expandedRatingsOn,
	setDefenseSplit,
	setReboundSplit,
	setShootingSplit,
} from "./expandedRatings.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import {
	GROUP_FACTOR,
	PROSPECT_VARIETY_VERSION,
	REGION_TILTS,
	RATING_TO_GROUP,
	drawOutlier,
	drawSpikes,
	drawSubBuild,
	ratingZs,
	regionOf,
	ratingFactor,
	OUTLIER,
	type GenVariety,
	type RatingGroup,
} from "../../../common/prospectVariety.ts";
import { ovrRaw } from "./ovr.basketball.ts";
import { shiftToRawOvr, stockGenerationForTests } from "./prospectVariety.ts";

type PlayerType = "point" | "scorer" | "wing" | "big";

// Expanded ratings (second step): how much more offensive than defensive rebounding, and catch-and-shoot than off-the-dribble
// shooting, each player type has
const typeReboundSplit: Record<PlayerType, number> = {
	point: -1,
	scorer: -0.5,
	wing: 0,
	big: 1.5,
};
const typeShootingSplit: Record<PlayerType, number> = {
	point: -2,
	scorer: -1,
	wing: 0.5,
	big: 1,
};

// The split bases are centered on league averages; a prospect's raw ratings (low IQ, handle and speed) would lean him to the offensive
// glass and to catch-and-shoot, so a class is moved back to an even split on average
const PROSPECT_REBOUND_OFFSET = -2.1;
const PROSPECT_SHOOTING_OFFSET = -2.7;

// Expanded ratings: how much more perimeter than interior defense each player type has, on top of what his speed and size say
const typeDefenseSplit: Record<PlayerType, number> = {
	point: 2,
	scorer: 1.5,
	wing: 1,
	big: -1.5,
};

const typeFactors: Record<PlayerType, Partial<Record<RatingKey, number>>> = {
	point: {
		jmp: 1.65,
		spd: 1.65,
		drb: 1.5,
		pss: 1.5,
		ft: 1.4,
		fg: 1.4,
		tp: 1.4,
		oiq: 1.2,
		endu: 1.4,
	},
	// Scoring guard (only with Improved Positions, see SCORER_MIX): a shooting guard's game, a shooter and athlete first, a
	// moderate handle, and less of a passer than a wing
	scorer: {
		jmp: 1.45,
		spd: 1.45,
		dnk: 1.3,
		drb: 1.1,
		pss: 0.9,
		ft: 1.5,
		fg: 1.5,
		tp: 1.5,
		oiq: 1.15,
		endu: 1.3,
	},
	wing: {
		drb: 1.2,
		dnk: 1.5,
		jmp: 1.4,
		spd: 1.4,
		ft: 1.2,
		fg: 1.2,
		tp: 1.2,
	},
	big: {
		stre: 1.2,
		ins: 1.6,
		dnk: 1.5,
		reb: 1.4,
		ft: 0.8,
		fg: 0.8,
		tp: 0.8,
		diq: 1.2,
	},
};

// Shooting guards (SG fix): BBGM's three player types leave out the scoring guard, so a random league had few shooting guards
// (5-7% at creation, 9% across careers, against about 13% of real NBA listings): its guards were small playmakers (point type:
// passing and handle 1.5x) or wings, and more than a quarter of the 6'3"-6'6" players were drawn as bigs. With Improved
// Positions on (the setting whose positions this is about), a scorer type (shooting, athleticism and offensive IQ up, a
// moderate handle, a wing's passing) takes most of those bigs and wings and part of the 6'1"-6'3" point guards. So that the
// league's talent stays where it was (mean ovr, the draft's share of small guards), wings of 6'6"-6'9" and point guards of
// 6'1" and shorter have their type factors a little closer to 1. Per band of the height rating (66 + 0.27 * hgt inches, with
// the wingspan draw): shares of point / scorer / big (the rest are wings), and type factor scales; taller: BBGM's mix. Tuned
// on new random leagues against real NBA listings (docs/native-features.md, Improved positions: SG generation).
export const SCORER_MIX: {
	maxHgt: number;
	point: number;
	scorer: number;
	big: number;
	// A type's factors, toward 1 (undefined: as they are)
	scale?: Partial<Record<PlayerType, number>>;
}[] = [
	// Up to 6'1" (BBGM: 90% point, 10% wing)
	{ maxHgt: 27, point: 0.9, scorer: 0.05, big: 0, scale: { point: 0.9 } },
	// 6'1"-6'3" (BBGM: the same)
	{ maxHgt: 33, point: 0.65, scorer: 0.3, big: 0 },
	// 6'3"-6'6" (BBGM: 3% point, 27% big, 70% wing)
	{ maxHgt: 44, point: 0.05, scorer: 0.75, big: 0.02 },
	// 6'6"-6'7" (BBGM: the same)
	{ maxHgt: 48, point: 0.03, scorer: 0.3, big: 0.15, scale: { wing: 0.75 } },
	// 6'7"-6'10" (BBGM's mix)
	{ maxHgt: 58, point: 0.03, scorer: 0, big: 0.27, scale: { wing: 0.75 } },
];
const scorerMix = (hgt: number) => SCORER_MIX.find((m) => hgt <= m.maxHgt);

// Ape index of a generated player (inches): normal, bounded. inHgt: the share of it in the hgt rating (the old -1/0/+1 inch of length
// had sd 0.82 inch; 0.37 x 2.2 = 0.81)
export const APE_INDEX = {
	mean: 4,
	sd: 2.2,
	min: -4,
	max: 11,
	inHgt: 0.37,
};

const genRatings = (
	season: number,
	scoutingLevel: number,
	// For real players, who already have a height
	hgtOverride?: number,
	// Where he is from (born.loc or a country), for the regional tilts of prospect variety
	origin?: { country?: string },
): {
	heightInInches: number;
	ratings: PlayerRatings;
	// Wingspan minus height (inches), drawn here
	apeIndex: number;
	// The player type his ratings were drawn for (genWeight: bigs are heavier for their height, point guards lighter)
	build: PlayerType;
	// Prospect variety (common/prospectVariety.ts): his seed, stored on the player. Undefined for real players (hgtOverride)
	genVar?: GenVariety;
} => {
	// realHeight is drawn from a custom probability distribution and then offset by a fraction of an inch either way
	let heightInInches = heightDist() + Math.random() - 0.5; // Fraction of an inch

	// Prospect variety: every new random number below comes from this prospect's own stream, seeded by numbers already drawn (his exact
	// height and wingspan draws), so the game's random stream draws as many numbers as before. Not for real players (hgtOverride).
	const apeU = Math.random();
	const rng =
		hgtOverride === undefined && !stockGenerationForTests()
			? new Rng(`prospect|${heightInInches}|${apeU}`)
			: undefined;
	const genVar: GenVariety | undefined = rng
		? {
				v: PROSPECT_VARIETY_VERSION,
				s: Math.floor(rng.random() * 4294967296),
			}
		: undefined;
	// Regional tilt (a style, not talent: his ovr is put back below), drawn first so his wingspan can take it
	const region =
		rng && origin?.country !== undefined
			? regionOf(helpers.getCountry(origin.country))
			: undefined;
	const tiltScale = rng ? rng.uniform(0.5, 1.5) : 0;
	const tilt = region ? REGION_TILTS[region] : undefined;

	// Ape index (wingspan minus height, inches): its own draw, normal around +4 (NBA prospects: mean about +4, sd a little over 2). It
	// takes the one random number the old -1/0/+1 inch of "length" took, and the hgt rating keeps about the same share of it (sd 0.8
	// inch), so the hgt rating and everything built on it are distributed as before.
	const apeOf = (extra: number) =>
		helpers.bound(
			APE_INDEX.mean + APE_INDEX.sd * probit(apeU) + extra,
			APE_INDEX.min,
			APE_INDEX.max,
		);
	const lengthOf = (ape: number) =>
		helpers.bound(APE_INDEX.inHgt * (ape - APE_INDEX.mean), -1.5, 1.5);
	const apeIndex = apeOf(tilt ? tilt.ape * tiltScale : 0);
	const length = lengthOf(apeIndex);
	const wingspanAdjust = heightInInches + length; // hgt 0-100 corresponds to height 5'6" to 7'9" (Anything taller or shorter than the extremes will just get 100/0)

	const hgt = hgtOverride ?? heightToRating(wingspanAdjust);
	// His hgt rating without the regional wingspan tilt (the ovr he is put back to)
	const hgtBeforeTilt =
		hgtOverride ?? heightToRating(heightInInches + lengthOf(apeOf(0)));
	heightInInches = Math.round(heightInInches); // Pick type of player (point, wing, or big) based on height

	const randType = Math.random();
	let type: keyof typeof typeFactors;

	const scorers = featureOn("improvedPositions") ? scorerMix(hgt) : undefined;
	if (scorers) {
		// Same draw as below, so with the setting off nothing changes
		if (randType < scorers.point) {
			type = "point";
		} else if (randType < scorers.point + scorers.scorer) {
			type = "scorer";
		} else if (randType < scorers.point + scorers.scorer + scorers.big) {
			type = "big";
		} else {
			type = "wing";
		}
	} else if (hgt >= 59) {
		// 6'10" or taller
		if (randType < 0.01) {
			type = "point";
		} else if (randType < 0.05) {
			type = "wing";
		} else {
			type = "big";
		}
	} else if (hgt <= 33) {
		// 6'3" or shorter
		if (randType < 0.1) {
			type = "wing";
		} else {
			type = "point";
		}
	} else {
		// TEMP DISABLE WITH ESLINT 9 UPGRADE eslint-disable-next-line no-lonely-if
		if (randType < 0.03) {
			type = "point";
		} else if (randType < 0.3) {
			type = "big";
		} else {
			type = "wing";
		}
	}

	// Tall players are less talented, and all tend towards dumb and can't shoot because they are rookies
	const rawRatings = {
		stre: 37,
		spd: 40,
		jmp: 40,
		endu: 17,
		ins: 27,
		dnk: 27,
		ft: 32,
		fg: 32,
		tp: 32,
		oiq: 22,
		diq: 22,
		drb: 37,
		pss: 37,
		reb: 37,
	};

	// For correlation across ratings, to ensure some awesome players, but athleticism and skill are independent to
	// ensure there are some who are elite in one but not the other
	const groupX: Record<RatingGroup, number> = {
		ath: realGauss(1, GROUP_FACTOR.sd),
		shoot: realGauss(1, GROUP_FACTOR.sd),
		skill: realGauss(1, GROUP_FACTOR.sd),
		ins: realGauss(1, GROUP_FACTOR.sd),
	};

	// Prospect variety: each rating's factor mixes the group's draw with a subgroup's and its own (so ratings inside a group are related, not
	// in lockstep), with a soft cap at 1.45 instead of the hard one at 1.2 (scaled so the mean factor is unchanged); a sub-build within his
	// type, rarely an outlier (one group far up, another down), regional tilts and specialist spikes, all with his ovr put back
	const zs = rng
		? ratingZs(
				{
					ath: (groupX.ath - 1) / GROUP_FACTOR.sd,
					shoot: (groupX.shoot - 1) / GROUP_FACTOR.sd,
					skill: (groupX.skill - 1) / GROUP_FACTOR.sd,
					ins: (groupX.ins - 1) / GROUP_FACTOR.sd,
				},
				rng,
			)
		: undefined;
	const subBuild = rng ? drawSubBuild(type, rng) : undefined;
	const outlier = rng ? drawOutlier(type, rng) : undefined;
	const spikes = rng ? drawSpikes(rng) : undefined;

	// Without the shape changes (sub-build, outlier), for the ovr he is put back to
	const refRatings = { ...rawRatings };

	for (const key of helpers.keys(rawRatings)) {
		let typeFactor = typeFactors[type][key] ?? 1;
		const typeScale = scorers?.scale?.[type];
		if (typeScale !== undefined) {
			typeFactor = 1 + typeScale * (typeFactor - 1);
		}
		const group = RATING_TO_GROUP[key]!;

		// For TypeScript
		// https://github.com/microsoft/TypeScript/issues/21732
		assertDefined(typeFactor);

		const noise = realGauss(rawRatings[key], 3);
		if (zs) {
			const factor = ratingFactor(key, zs[key]!);
			let shape = subBuild?.mult[key] ?? 1;
			if (outlier?.up === group) {
				shape *= OUTLIER.up;
			} else if (outlier?.down === group) {
				shape *= OUTLIER.down;
			}
			refRatings[key] = limitRating(factor * typeFactor * noise);
			rawRatings[key] = limitRating(shape * factor * typeFactor * noise);
		} else {
			// Stock (real players' random ratings)
			const factor = helpers.bound(groupX[group], 0.2, 1.2);
			rawRatings[key] = limitRating(factor * typeFactor * noise);
		}
	}

	if (rng) {
		const changed = subBuild || outlier || tilt || spikes;
		if (changed) {
			if (tilt) {
				for (const [key, d] of Object.entries(tilt.ratings)) {
					const k = key as keyof typeof rawRatings;
					rawRatings[k] = limitRating(
						rawRatings[k] + Math.round(d * tiltScale),
					);
				}
			}
			if (spikes) {
				for (const [key, d] of Object.entries(spikes)) {
					const k = key as keyof typeof rawRatings;
					rawRatings[k] = limitRating(rawRatings[k] + d);
				}
			}
			const target = ovrRaw({ ...refRatings, hgt: hgtBeforeTilt } as any);
			const shaped = { ...rawRatings, hgt } as any;
			shiftToRawOvr(shaped, target, new Set(Object.keys(spikes ?? {})));
			for (const key of helpers.keys(rawRatings)) {
				rawRatings[key] = shaped[key];
			}
		}
	}

	const ratings: PlayerRatings = {
		stre: rawRatings.stre,
		spd: rawRatings.spd,
		jmp: rawRatings.jmp,
		endu: rawRatings.endu,
		ins: rawRatings.ins,
		dnk: rawRatings.dnk,
		ft: rawRatings.ft,
		fg: rawRatings.fg,
		tp: rawRatings.tp,
		oiq: rawRatings.oiq,
		diq: rawRatings.diq,
		drb: rawRatings.drb,
		pss: rawRatings.pss,
		reb: rawRatings.reb,
		hgt,
		fuzz: genFuzz(scoutingLevel),
		ovr: 0,
		pos: "F",
		pot: 0,
		season,
		skills: [],
	};

	// Expanded ratings: wingspan around height, and diq split into perimeter and interior defense. Only with the setting on, so with it
	// off no extra random numbers are drawn.
	if (expandedRatingsOn()) {
		// His drawn ape index, on the hgt scale (wingspanInches reads it back: height + ape index)
		ratings.wng = limitRating(
			Math.round(hgt + ((apeIndex - APE_INDEX.mean) * 100) / 27),
		);
		const split =
			2 *
			(defenseSplitBase(ratings) +
				typeDefenseSplit[type] +
				realGauss(0, DEFENSE_SPLIT_NOISE));
		setDefenseSplit(ratings, split);
		ratings.diq = blendDiq(ratings.pdef!, ratings.idef!);

		// Second step: reb stays the average of oreb and dreb, fg + tp stays csh + dsh
		setReboundSplit(
			ratings,
			2 *
				Math.round(
					reboundSplitBase(ratings) +
						typeReboundSplit[type] +
						PROSPECT_REBOUND_OFFSET +
						realGauss(0, REBOUND_SPLIT_NOISE),
				),
		);
		setShootingSplit(
			ratings,
			2 *
				Math.round(
					shootingSplitBase(ratings) +
						typeShootingSplit[type] +
						PROSPECT_SHOOTING_OFFSET +
						realGauss(0, SHOOTING_SPLIT_NOISE),
				),
		);
		ratings.bsc = limitRating(
			Math.round(realGauss(ballSecurityBase(ratings), BALL_SECURITY_NOISE)),
		);
	}

	return {
		heightInInches,
		ratings,
		apeIndex,
		build: type,
		genVar,
	};
};

export default genRatings;
