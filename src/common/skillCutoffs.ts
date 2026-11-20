// Basketball skill cutoffs: ONE table for the skill labels (player.skills, shown next to names) and the game sim's team synergy
// (GameSim.basketball updateSynergy counts sigmoid(composite, 15, cutoff), so a player counts as half a skill exactly at the label's
// cutoff). Both read their cutoffs here, so a label always means what synergy counts.
//
// The composites are the ones from compositeWeightsFor(COMPOSITE_WEIGHTS, expanded) (the sim's Game Sim Fixes weights never touch
// these composites), and with Sub-Ratings in Sim the sim folds the sub-ratings into them (GameSim.basketball/subRatingsSim.ts), which
// player.skills does too. Which cutoffs:
// - stock: the cutoffs in COMPOSITE_WEIGHTS
// - Expanded Ratings with Game Sim Fixes: the expanded Di, Dp and R composites have their own cutoffs (EXPANDED_COMPOSITE_WEIGHTS)
// - Expanded Ratings without Game Sim Fixes: the stock cutoffs (that is what the sim has always counted; changing it would change
//   game results of existing leagues, so the labels follow the sim)
// - Sub-Ratings in Sim: no change (the composites move, not the cutoffs)
import { COMPOSITE_WEIGHTS } from "./constants.basketball.ts";
import { EXPANDED_COMPOSITE_WEIGHTS } from "./expandedRatings.ts";
import type { CompositeWeights } from "./types.ts";

export type SkillLabel =
	| "3"
	| "A"
	| "B"
	| "Di"
	| "Dp"
	| "Po"
	| "Ps"
	| "R"
	| "V";

export type SkillCutoffFlags = {
	expanded: boolean;
	simFixes: boolean;
	subRatingsSim?: boolean;
};

const cutoffsOf = (weights: CompositeWeights<string>) => {
	const out: Partial<Record<SkillLabel, number>> = {};
	for (const { skill } of Object.values(weights)) {
		if (skill) {
			out[skill.label as SkillLabel] = skill.cutoff ?? 0.61;
		}
	}
	return out;
};

const STOCK = Object.freeze(
	cutoffsOf(COMPOSITE_WEIGHTS as CompositeWeights<string>) as Record<
		SkillLabel,
		number
	>,
);
const EXPANDED_SIM_FIXES = Object.freeze({
	...STOCK,
	...cutoffsOf(EXPANDED_COMPOSITE_WEIGHTS as CompositeWeights<string>),
} as Record<SkillLabel, number>);

export const skillCutoffs = (
	flags: SkillCutoffFlags,
): Readonly<Record<SkillLabel, number>> =>
	flags.expanded && flags.simFixes ? EXPANDED_SIM_FIXES : STOCK;
