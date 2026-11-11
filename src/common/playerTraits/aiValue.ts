import { CALIBRATION_OFFSETS, ratingPart } from "./scores.ts";
import { MENTEE_MAX_AGE, mentorStrength } from "./veteran.ts";
import type { TraitKey, TraitRatings, TraitScores } from "./types.ts";

// How AI teams fold player traits into how much they value a player (trades, free agency, contract demands, the draft). Pure, no worker/DB/`g` access.
//
// Only the part of each trait that is NOT already explained by the player's ratings counts (score minus the rating part), so the AI does not pay twice for
// what player value already sees. That part averages 50 across the league, so the factor averages ~1 and league-wide value/contract levels do not move.

// How much each trait matters to a GM. Durability (injury proneness / iron man) matters most. Sums to 1.
export const AI_TRAIT_WEIGHTS: Record<TraitKey, number> = {
	durability: 0.21,
	veteranSavvy: 0.08,
	leadership: 0.08,
	clutch: 0.065,
	shotDiscipline: 0.065,
	consistency: 0.05,
	offBall: 0.05,
	hustle: 0.05,
	lateGameIq: 0.04,
	screen: 0.035,
	foulDiscipline: 0.035,
	recovery: 0.035,
	handle: 0.035,
	// Work ethic is about future development: worth more for young players (see aiTraitSumFromZs)
	workEthic: 0.07,
	bigGame: 0.04,
	ego: 0.035,
	temper: 0.025,
	// The aging curve is not a trait key and is never valued by the AI (it is secret, see agingCurve.ts)
};

// Maximum fractional change to value, at the extremes
export const AI_TRAIT_MAX_ADJ = 0.07;
// Weighted trait sum at which the adjustment saturates. A typical player is around +-0.1, so the typical adjustment is about +-3%
const SATURATION = 0.25;
// Contract demands move less than value (only a share of the factor)
export const CONTRACT_TRAIT_SHARE = 0.5;

export type AiTraitContext = {
	age: number;
	// Team strategy, if a specific team is valuing him
	strategy?: "contending" | "rebuilding";
	// Teammates at or under MENTEE_MAX_AGE on that team (mentoring value of veteran savvy)
	numYoung?: number;
	// Draft prospect: hidden traits are uncertain, so they count half
	isProspect?: boolean;
	// Which keys are hidden (only used with isProspect)
	hiddenKeys?: ReadonlySet<TraitKey>;
	// The locker room he would join (or is in): his teammates on that team, never himself. See aiTeamTraitContext
	numBigEgos?: number;
	numHotHeads?: number;
	// Sum of his teammates' ego z (what drives the "Locker room" mood component). Negative = more divas than team-first players
	lockerRoom?: number;
};

// Team context: how much more ego and temper matter to a team, given who is already in its locker room. These scale the weight of the trait
// in BOTH directions (a team that already has divas is warier of another one, and gets more out of a team-first player), so the factor stays
// centered at 1, and they only depend on the player's teammates (never himself), so a team values him the same coming in and going out.
export const AI_TEAM_TRAIT_CONTEXT = {
	// A teammate at or below this z counts as a big ego / a hot head
	bigEgoZ: -0.5,
	hotHeadZ: -0.5,
	// Extra weight on ego per big ego already on the team, and on temper per hot head (first 3 count)
	perBigEgo: 0.4,
	perHotHead: 0.3,
	maxCounted: 3,
	// A locker room whose ego z sums to this or less is fragile: a contender with one weighs ego more
	fragileLockerRoom: -1,
	contenderFragileEgo: 1.5,
	// Contenders need composure (technicals and late-game mistakes cost playoff games)
	contenderTemper: 1.4,
	// Rebuilding teams are buying development, so a young player's work ethic is worth more to them
	rebuildingYoungWorkEthic: 1.3,
	// Rebuilding teams are not playing big games soon
	rebuildingBigGame: 0.6,
} as const;

// Ego and temper z of a team's players -> the locker room context for valuing `self` (a player on the team or not). Teammates only: pass the
// index of the player himself to leave him out.
export const aiTeamTraitContext = (
	teammates: { egoZ: number; temperZ: number }[],
	selfIndex = -1,
) => {
	let numBigEgos = 0;
	let numHotHeads = 0;
	let lockerRoom = 0;
	for (const [i, t] of teammates.entries()) {
		if (i === selfIndex) {
			continue;
		}
		if (t.egoZ <= AI_TEAM_TRAIT_CONTEXT.bigEgoZ) {
			numBigEgos += 1;
		}
		if (t.temperZ <= AI_TEAM_TRAIT_CONTEXT.hotHeadZ) {
			numHotHeads += 1;
		}
		lockerRoom += t.egoZ;
	}
	return { numBigEgos, numHotHeads, lockerRoom };
};

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

// The part of a trait not explained by ratings, as z in [-1, 1]
export const residualTraitZ = (
	key: TraitKey,
	score: number,
	ratings: TraitRatings,
) =>
	clamp(
		(score - ratingPart(key, ratings) - CALIBRATION_OFFSETS[key] - 50) / 40,
		-1,
		1,
	);

// residualTraitZ of every trait. Only depends on the player, so it can be computed once and reused for every team context.
export const residualTraitZs = (
	scores: TraitScores,
	ratings: TraitRatings,
): Record<TraitKey, number> => {
	const zs = {} as Record<TraitKey, number>;
	for (const key of Object.keys(AI_TRAIT_WEIGHTS) as TraitKey[]) {
		zs[key] = residualTraitZ(key, scores[key], ratings);
	}
	return zs;
};

// aiTraitSum from precomputed residualTraitZs
export const aiTraitSumFromZs = (
	zs: Record<TraitKey, number>,
	scores: TraitScores,
	context: AiTraitContext,
) => {
	const C = AI_TEAM_TRAIT_CONTEXT;
	let sum = 0;
	for (const key of Object.keys(AI_TRAIT_WEIGHTS) as TraitKey[]) {
		let weight = AI_TRAIT_WEIGHTS[key];
		if (key === "veteranSavvy") {
			if (context.age <= MENTEE_MAX_AGE) {
				// Savvy matters little for a young player himself
				weight *= 0.5;
			} else {
				// Contenders want composure, young rosters want a mentor
				if (context.strategy === "contending") {
					weight *= 1.5;
				}
				const numYoung = context.numYoung ?? 0;
				if (numYoung > 0 && mentorStrength(scores.veteranSavvy) > 0) {
					weight *= 1 + 0.15 * Math.min(numYoung, 5);
				}
			}
		}
		if (key === "workEthic") {
			// Matters for how much a young player will still improve, little for a veteran
			if (context.age <= 24) {
				weight *= 1.5;
				if (context.strategy === "rebuilding") {
					weight *= C.rebuildingYoungWorkEthic;
				}
			} else if (context.age >= 30) {
				weight *= 0.4;
			}
		} else if (key === "bigGame") {
			// Contenders care about the playoffs
			if (context.strategy === "contending") {
				weight *= 1.5;
			} else if (context.strategy === "rebuilding") {
				weight *= C.rebuildingBigGame;
			}
		} else if (key === "ego") {
			// Warier of a second or third big ego
			weight *=
				1 + C.perBigEgo * Math.min(context.numBigEgos ?? 0, C.maxCounted);
			if (
				context.strategy === "contending" &&
				(context.lockerRoom ?? 0) <= C.fragileLockerRoom
			) {
				weight *= C.contenderFragileEgo;
			}
		} else if (key === "temper") {
			weight *=
				1 + C.perHotHead * Math.min(context.numHotHeads ?? 0, C.maxCounted);
			if (context.strategy === "contending") {
				weight *= C.contenderTemper;
			}
		}
		if (context.isProspect && context.hiddenKeys?.has(key)) {
			weight *= 0.5;
		}
		sum += weight * zs[key];
	}
	return sum;
};

// Weighted sum of residual trait z's, about -1 to 1
export const aiTraitSum = (
	scores: TraitScores,
	ratings: TraitRatings,
	context: AiTraitContext,
) => aiTraitSumFromZs(residualTraitZs(scores, ratings), scores, context);

export const aiTraitValueFactorFromSum = (sum: number) =>
	1 + AI_TRAIT_MAX_ADJ * clamp(sum / SATURATION, -1, 1);

export const aiTraitContractFactorFromSum = (sum: number) =>
	1 + CONTRACT_TRAIT_SHARE * (aiTraitValueFactorFromSum(sum) - 1);

// Multiply a positive player value by this. 1 +- AI_TRAIT_MAX_ADJ
export const aiTraitValueFactor = (
	scores: TraitScores,
	ratings: TraitRatings,
	context: AiTraitContext,
) => aiTraitValueFactorFromSum(aiTraitSum(scores, ratings, context));

// Same, for contract demands (league-wide, no team context), damped
export const aiTraitContractFactor = (
	scores: TraitScores,
	ratings: TraitRatings,
	context: AiTraitContext,
) => aiTraitContractFactorFromSum(aiTraitSum(scores, ratings, context));
