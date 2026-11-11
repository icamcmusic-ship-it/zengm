import { NEUTRAL_SCORES } from "./scores.ts";
import type { TraitScores, TraitSituation } from "./types.ts";

// Every effect below is a function of z = (score - 50) / 40, clamped to [-1, 1], and is linear in z. A score of 50 gives exactly the neutral value (1 for multipliers, 0 for additive bonuses), so a league where traits average 50 (which is how they are calibrated, see playerTraits.calibration.test.ts) has the same league-wide averages as a league without traits. Positive z is always the "good" end of the trait.

// Maximum size of each effect at z = +-1 (and, for the situational ones, at full situation weight). Keep in sync with docs/player-traits.md.
export const EFFECT_AMPLITUDES = {
	// Additive to a shot's make probability, in the clutch
	clutchShot: 0.04,
	// Additive to a free throw's make probability, in the clutch
	clutchFt: 0.05,
	// Fractional change to turnover probability, in the clutch
	clutchTurnover: 0.15,
	// Fractional change to the standard deviation of game-to-game form (negative z = more variance)
	variance: 0.4,
	// Standard deviation (additive make probability) of a neutral player's game form
	gameFormSd: 0.03,
	// Fractional change to injury rate (negative z = more injuries)
	injury: 0.3,
	// Gunner/discipline: fractional change to shot attempt weight at usage 1, additive make probability at usage 1
	shotAttemptWeight: 0.4,
	shotQuality: 0.06,
	// Additive to team offensive synergy (synergy.off units) per player on the court
	spacing: 0.06,
	screenSynergy: 0.06,
	// Additive make probability on his own shots off a screen/roll/pop
	screenShot: 0.02,
	// Fractional change to the weight in loose ball, deflection, off-ball steal and charge events
	hustle: 0.2,
	// Fractional change to the foul rate (positive z = fewer fouls), and to the steal rate (positive z = fewer steals)
	foul: 0.25,
	gambleSteal: 0.12,
	// Fractional change to the energy regained per minute on the bench
	recovery: 0.15,
	// Fractional change to turnover probability against full pressure
	pressureTurnover: 0.2,
	// Additive to the probability of making the correct end-of-game decision
	lateGameDecision: 0.12,
	// Maximum team chemistry bonus (a fraction added to every team composite rating)
	chemistryTeam: 0.015,
	// Veteran savvy: small extra amounts added on top of the hooks above (same units)
	veteranLateGame: 0.04,
	veteranClutchShot: 0.012,
	veteranClutchFt: 0.015,
	veteranClutchTurnover: 0.05,
	veteranPressureTurnover: 0.05,
	veteranFoul: 0.06,
	veteranChemistry: 0.35,
	// Big-game: in every playoff game (the whole game, not just clutch time), additive make probability on his shots and free throws, and
	// fractional change to his turnover probability
	bigGameShot: 0.025,
	bigGameFt: 0.025,
	bigGameTurnover: 0.1,
	// Temper: fractional change to his share of technical fouls (and the rate of technicals while he is on the court), and of flagrant fouls
	// (negative z = hothead = more)
	temperTech: 0.6,
	temperFlagrant: 0.5,
	// Temper: late-game composure, added on top of the clutch hooks (same units)
	temperClutchShot: 0.015,
	temperClutchFt: 0.02,
	temperClutchTurnover: 0.06,
	// Ego: added to his chemistryContribution (team-first lifts the team's on-court chemistry, divas lower it)
	egoChemistry: 0.4,
	// Motor: fractional change to the energy he loses per minute on the court (positive z = tires slower), and to his endurance on the second
	// night of a back-to-back (only with the injury/rest setting that models back-to-backs)
	motorDrain: 0.1,
	motorBackToBack: 0.05,
	// Defensive versatility: fraction added to the team's defensive composite ratings, per unit of the on-court mean z, at a full size mismatch
	switchDefense: 0.012,
} as const;

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

export const traitZ = (score: number) => clamp((score - 50) / 40, -1, 1);

// 0 to 1: how "clutch" a moment is. Only the final period (or overtime), in the last five minutes, ramping to full weight at two minutes left, and only within one possession or so of the score (full at 3 points, gone at 10).
export const clutchSituationWeight = (situation: TraitSituation) => {
	const numPeriods = situation.numPeriods ?? 4;
	if (situation.period < numPeriods) {
		return 0;
	}
	const timeWeight = clamp((300 - situation.timeLeft) / 180, 0, 1);
	const diffWeight = clamp((10 - Math.abs(situation.scoreDiff)) / 7, 0, 1);
	return timeWeight * diffWeight;
};

// 0 to 1: how much end-of-game decisions matter. Final period or overtime, last four minutes ramping to full at three, and within fifteen points (full at 9).
export const lateGameSituationWeight = (situation: TraitSituation) => {
	const numPeriods = situation.numPeriods ?? 4;
	if (situation.period < numPeriods) {
		return 0;
	}
	const timeWeight = clamp(240 - situation.timeLeft, 0, 60) / 60;
	const diffWeight = clamp((15 - Math.abs(situation.scoreDiff)) / 6, 0, 1);
	return timeWeight * diffWeight;
};

export type ShotSelectionBias = {
	// Multiply the player's shot attempt weight (his share of team shots) by this. Neutral 1.
	attemptWeightMult: number;
	// Add to the make probability of his shots. Neutral 0.
	shotQualityDelta: number;
};

export type TraitEffects = {
	// True for the all-neutral object (traits off, or all scores exactly 50)
	neutral: boolean;
	scores: Readonly<TraitScores>;

	// --- Situational hooks (functions) ---
	/** Add to the make probability of a field goal attempt in this situation. 0 outside clutch time. Range +-0.04. */
	clutchShotModifier: (situation: TraitSituation) => number;
	/** Add to the make probability of a free throw. Range +-0.05. */
	clutchFtModifier: (situation: TraitSituation) => number;
	/** Multiply the probability of a turnover. Range 0.85-1.15. */
	clutchTurnoverMult: (situation: TraitSituation) => number;
	/** Add to the make probability of a shot, given a standard normal draw gameZ for this player this game. Range depends on varianceScale. Mean-zero. */
	gameFormShotDelta: (gameZ: number) => number;
	/** Shot selection vs usage. usage is the player's composite usage rating, 0 to 1. */
	shotSelectionBias: (usage: number) => ShotSelectionBias;
	/** Multiply the probability of a turnover against defensive pressure in [0, 1]. Range 0.8-1.2, 1 with no pressure. */
	pressureTurnoverMult: (pressure: number) => number;
	/** Add to the probability that his team makes the correct end-of-game decision. Range +-0.12, 0 outside late game. */
	lateGameDecisionQuality: (situation: TraitSituation) => number;

	// --- Scalar hooks ---
	/** Multiply the standard deviation of his game-to-game form. 0.6-1.4. Neutral 1. */
	varianceScale: number;
	/** Multiply his per-possession injury rate (see injuryRateMultiplier). 0.7-1.3. Neutral 1. */
	injuryRateMultiplier: number;
	/** Add to team offensive synergy (synergy.off units) while he is on the court. +-0.06. Neutral 0. */
	spacingContribution: number;
	/** Add to team offensive synergy for screening and roll/pop. +-0.06. Neutral 0. */
	screenContribution: number;
	/** Add to the make probability of his own shots off screens/rolls/pops. +-0.02. Neutral 0. */
	screenShotDelta: number;
	/** Multiply his weight in loose ball, deflection, off-ball steal and charge events. 0.8-1.2. Neutral 1. */
	looseBallBonus: number;
	/** Multiply his personal foul rate. 0.75-1.25 (high foul discipline is lower). Neutral 1. */
	foulProneness: number;
	/** Multiply his steal rate (gamblers steal more). 0.88-1.12. Neutral 1. */
	gambleStealMultiplier: number;
	/** Multiply the energy he regains per minute on the bench. 0.85-1.15. Neutral 1. */
	energyRecoveryRate: number;
	/** His leadership (plus savvy and ego), -1 to 1, for teamChemistryBonus. Neutral 0. */
	chemistryContribution: number;
	/** Big-game: add to the make probability of his shots in a playoff game. +-0.025. Neutral 0. Only applied in playoff games. */
	bigGameShotDelta: number;
	/** Big-game: add to his free throw probability in a playoff game. +-0.025. Neutral 0. */
	bigGameFtDelta: number;
	/** Big-game: multiply his turnover probability in a playoff game. 0.9-1.1. Neutral 1. */
	bigGameTurnoverMult: number;
	/** Temper: multiply the technical foul rate while he is on the court and his share of the technicals. 0.4-1.6 (hothead is higher). Neutral 1. */
	techProneness: number;
	/** Temper: multiply the flagrant foul rate while he defends and his share of them. 0.5-1.5. Neutral 1. */
	flagrantProneness: number;
	/** Motor: multiply the energy he loses per minute on the court. 0.9-1.1 (high motor is lower). Neutral 1. */
	energyDrainRate: number;
	/** Motor: multiply his endurance on the second night of a back-to-back. 0.95-1.05. Neutral 1. */
	backToBackEnduranceMult: number;
	/** Defensive versatility, -1 to 1, for teamSwitchDefenseBonus. Neutral 0. */
	switchDefenseContribution: number;
};

const make = (scores: TraitScores, neutral: boolean): TraitEffects => {
	const A = EFFECT_AMPLITUDES;
	const z = {
		clutch: traitZ(scores.clutch),
		consistency: traitZ(scores.consistency),
		durability: traitZ(scores.durability),
		shotDiscipline: traitZ(scores.shotDiscipline),
		offBall: traitZ(scores.offBall),
		screen: traitZ(scores.screen),
		hustle: traitZ(scores.hustle),
		foulDiscipline: traitZ(scores.foulDiscipline),
		recovery: traitZ(scores.recovery),
		handle: traitZ(scores.handle),
		lateGameIq: traitZ(scores.lateGameIq),
		leadership: traitZ(scores.leadership),
		veteranSavvy: traitZ(scores.veteranSavvy),
		bigGame: traitZ(scores.bigGame),
		ego: traitZ(scores.ego),
		temper: traitZ(scores.temper),
		motor: traitZ(scores.motor),
		defensiveVersatility: traitZ(scores.defensiveVersatility),
	};
	const vet = z.veteranSavvy;
	const temper = z.temper;

	const varianceScale = 1 - A.variance * z.consistency;

	return {
		neutral,
		scores,
		clutchShotModifier: (s) =>
			(A.clutchShot * z.clutch +
				A.veteranClutchShot * vet +
				A.temperClutchShot * temper) *
			clutchSituationWeight(s),
		clutchFtModifier: (s) =>
			(A.clutchFt * z.clutch +
				A.veteranClutchFt * vet +
				A.temperClutchFt * temper) *
			clutchSituationWeight(s),
		clutchTurnoverMult: (s) =>
			1 -
			(A.clutchTurnover * z.clutch +
				A.veteranClutchTurnover * vet +
				A.temperClutchTurnover * temper) *
				clutchSituationWeight(s),
		gameFormShotDelta: (gameZ) => A.gameFormSd * varianceScale * gameZ,
		shotSelectionBias: (usage) => {
			const u = clamp(usage, 0, 1);
			return {
				attemptWeightMult: 1 - A.shotAttemptWeight * z.shotDiscipline * u,
				shotQualityDelta: A.shotQuality * z.shotDiscipline * u,
			};
		},
		pressureTurnoverMult: (pressure) =>
			1 -
			(A.pressureTurnover * z.handle + A.veteranPressureTurnover * vet) *
				clamp(pressure, 0, 1),
		lateGameDecisionQuality: (s) =>
			(A.lateGameDecision * z.lateGameIq + A.veteranLateGame * vet) *
			lateGameSituationWeight(s),
		varianceScale,
		injuryRateMultiplier: 1 - A.injury * z.durability,
		spacingContribution: A.spacing * z.offBall,
		screenContribution: A.screenSynergy * z.screen,
		screenShotDelta: A.screenShot * z.screen,
		looseBallBonus: 1 + A.hustle * z.hustle,
		foulProneness: 1 - A.foul * z.foulDiscipline - A.veteranFoul * vet,
		gambleStealMultiplier: 1 - A.gambleSteal * z.foulDiscipline,
		energyRecoveryRate: 1 + A.recovery * z.recovery,
		chemistryContribution: clamp(
			z.leadership + A.veteranChemistry * vet + A.egoChemistry * z.ego,
			-1,
			1,
		),
		bigGameShotDelta: A.bigGameShot * z.bigGame,
		bigGameFtDelta: A.bigGameFt * z.bigGame,
		bigGameTurnoverMult: 1 - A.bigGameTurnover * z.bigGame,
		techProneness: 1 - A.temperTech * temper,
		flagrantProneness: 1 - A.temperFlagrant * temper,
		energyDrainRate: 1 - A.motorDrain * z.motor,
		backToBackEnduranceMult: 1 + A.motorBackToBack * z.motor,
		switchDefenseContribution: z.defensiveVersatility,
	};
};

export const NEUTRAL_EFFECTS: TraitEffects = Object.freeze(
	make(NEUTRAL_SCORES, true),
);

// The effects for a set of scores. undefined (traits off) gives the neutral effects, which change nothing.
export const traitEffects = (scores: TraitScores | undefined): TraitEffects => {
	if (!scores) {
		return NEUTRAL_EFFECTS;
	}
	return make({ ...scores }, false);
};

// Team chemistry from the chemistryContribution of the players on the court (or the rotation). A bounded fraction to add to every team composite rating: 0 when the group is neutral, never more than +-0.015, diminishing returns for more leaders.
export const teamChemistryBonus = (contributions: number[]) => {
	if (contributions.length === 0) {
		return 0;
	}
	let total = 0;
	for (const c of contributions) {
		total += c;
	}
	const mean = total / contributions.length;
	return EFFECT_AMPLITUDES.chemistryTeam * Math.tanh(1.5 * mean);
};

// For a team's on-court group: the average of an additive or multiplicative scalar hook, e.g. synergy sums. Convenience for tests and docs.
export const sumHook = (
	effects: TraitEffects[],
	hook: "spacingContribution" | "screenContribution",
) => {
	let total = 0;
	for (const e of effects) {
		total += e[hook];
	}
	return total;
};

// Late-game decision quality for a team: the player running the offense counts the most. Pass the effects of the on-court players with the ball handler first; weights 0.4 / 0.2 / 0.15 / 0.15 / 0.1.
export const teamLateGameDecisionQuality = (
	effects: TraitEffects[],
	situation: TraitSituation,
) => {
	const weights = [0.4, 0.2, 0.15, 0.15, 0.1];
	let total = 0;
	let weightSum = 0;
	for (const [i, e] of effects.entries()) {
		const w = weights[i] ?? 0.1;
		total += w * e.lateGameDecisionQuality(situation);
		weightSum += w;
	}
	return weightSum > 0 ? total / weightSum : 0;
};

// Size mismatch of a lineup the defense has to switch against, 0 to 1: the spread of its players' height ratings (a lineup of five similar
// sizes gives no mismatches, a guard-heavy lineup with a center a full one). heights: the hgt ratings of the 5 players on the court.
export const lineupSizeMismatch = (heights: number[]) => {
	if (heights.length < 2) {
		return 0;
	}
	let lo = Infinity;
	let hi = -Infinity;
	for (const h of heights) {
		lo = Math.min(lo, h);
		hi = Math.max(hi, h);
	}
	return clamp((hi - lo - 10) / 40, 0, 1);
};

// Defensive versatility of a team's on-court group against an opposing lineup with this mismatch: a fraction to add to the defensive
// composite ratings. 0 when the group is neutral, never more than +-switchDefense.
export const teamSwitchDefenseBonus = (
	contributions: number[],
	mismatch: number,
) => {
	if (contributions.length === 0) {
		return 0;
	}
	let total = 0;
	for (const c of contributions) {
		total += c;
	}
	return (
		EFFECT_AMPLITUDES.switchDefense *
		clamp(total / contributions.length, -1, 1) *
		clamp(mismatch, 0, 1)
	);
};
