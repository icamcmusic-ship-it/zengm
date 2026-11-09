import { CALIBRATION_OFFSETS, ratingPart } from "./scores.ts";
import { MENTEE_MAX_AGE, mentorStrength } from "./veteran.ts";
import type { TraitKey, TraitRatings, TraitScores } from "./types.ts";

// How AI teams fold player traits into how much they value a player (trades, free agency, contract demands, the draft). Pure, no worker/DB/`g` access.
//
// Only the part of each trait that is NOT already explained by the player's ratings counts (score minus the rating part), so the AI does not pay twice for
// what player value already sees. That part averages 50 across the league, so the factor averages ~1 and league-wide value/contract levels do not move.

// How much each trait matters to a GM. Durability (injury proneness / iron man) matters most. Sums to 1.
export const AI_TRAIT_WEIGHTS: Record<TraitKey, number> = {
	durability: 0.25,
	veteranSavvy: 0.1,
	leadership: 0.1,
	clutch: 0.08,
	shotDiscipline: 0.08,
	consistency: 0.06,
	offBall: 0.06,
	hustle: 0.06,
	lateGameIq: 0.05,
	screen: 0.04,
	foulDiscipline: 0.04,
	recovery: 0.04,
	handle: 0.04,
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
