// Spacing & Shot Creation (the spacingCreation League extra, see docs/native-features.md). Off: nothing here is used, and the sim draws
// exactly the random numbers it did before.
//
// Spacing: the three-point threat of the four teammates around the shooter (or driver). It makes drives more likely and easier to finish
// (and post-ups a little easier), and two or more non-shooters on the floor cramp the paint. It also takes over part of the perimeter
// factor of the offensive synergy.
//
// Creation: every shot has a creator, the ball handler who sets it up, picked before the shooter by dribbling, passing and offensive IQ
// (and ball security with expanded ratings). When the shooter is his own creator the shot is mostly unassisted (a drive or a pull-up),
// otherwise the creator gets the assist when there is one. How often a shot is assisted depends on its type (threes mostly, at the rim
// about 60%, post-ups and mid-range jumpers about 40%), and the assisted bonus scales with the creator's passing.

// Creation composite (who runs the offense)
export const CREATION_WEIGHTS = {
	ratings: ["drb", "pss", "oiq"],
	weights: [1, 1, 0.6],
};
export const CREATION_WEIGHTS_EXPANDED = {
	ratings: ["drb", "pss", "oiq", "bsc"],
	weights: [1, 1, 0.6, 0.6],
};

// Power on the creation composite when picking the creator (times the coach's usage multiplier, like the shooter's usage power)
export const CREATION_POWER = 4;

// Three-point threat of a player: the three-point composite, half catch-and-shoot with expanded ratings (spot-up shooting is what spaces
// the floor)
export const spacingThreat = (r: {
	shootingThreePointer: number;
	catchShoot?: number;
}) =>
	r.catchShoot === undefined
		? r.shootingThreePointer
		: 0.5 * r.shootingThreePointer + 0.5 * r.catchShoot;

// Below this threat a player is a non-shooter: defenders sag off him
export const NON_SHOOTER_THREAT = 0.4;

export const SPACING = {
	// Average threat of four teammates on the floor (the league center of the spacing effects)
	ref: 0.447,
	// Each non-shooter beyond the first among the four teammates
	crampedStep: 0.04,
	// Average cramped penalty (so the effects are centered on the league)
	crampedMean: 0.02,
	// Make probability per unit of spacing: at the rim, in the post
	makeRim: 0.3,
	makePost: 0.12,
	// Drives go where there is room, so the shots at the rim have more spacing than the average shot: the make effects are centered there
	makeCenter: 0.017,
	// Selection of drives (the at-rim draw): multiplier per unit of spacing
	selectRim: 2.5,
	// Synergy: share of the stock perimeter factor replaced by the spacing factor, and how the spacing factor reads the five's threat
	synergyShare: 0.5,
	synergyRef: 0.447,
	synergySlope: 3,
	synergyMean: 0.58,
};

export const CREATION = {
	// Assisted probability by shot type, relative to the stock probAst (about 0.6): 85% of threes, 60% at the rim, 40% post-ups and
	// mid-range jumpers
	astThree: 1.5,
	astRim: 1.1,
	astPost: 0.79,
	astMid: 0.79,
	// Self-created shots (the shooter is the creator) are assisted this much less often (a handoff or a re-screen by another creator), the
	// others a little more often to keep league assists the same
	astSelf: 0.35,
	astOther: 1.12,
	// Self-created shots lean to drives and pull-ups, passes to catch-and-shoot threes
	selfRim: 1.2,
	selfThree: 0.85,
	otherThree: 1.05,
	// Assisted bonus: 0.025 for a passer of average creating passing, more for better passers
	bonus: 0.025,
	bonusPassingRef: 0.525,
	bonusSlope: 0.08,
};

export type LineupSpacing = {
	// Sum of the five threats, and the number of non-shooters among the five
	sum: number;
	nonShooters: number;
};

export const lineupSpacing = (
	lineup: { compositeRating: { spacingThreat?: number } }[],
): LineupSpacing => {
	let sum = 0;
	let nonShooters = 0;
	for (const p of lineup) {
		const threat = p.compositeRating.spacingThreat ?? 0;
		sum += threat;
		if (threat < NON_SHOOTER_THREAT) {
			nonShooters += 1;
		}
	}
	return { sum, nonShooters };
};

// The spacing around a shooter, centered on the league (0 for an average lineup): the average threat of his four teammates, less the
// cramped penalty for two or more non-shooters among them
export const spacingAround = (
	lineup: LineupSpacing,
	threat: number,
	numOthers: number,
) => {
	if (numOthers <= 0) {
		return 0;
	}
	const others = (lineup.sum - threat) / numOthers;
	const nonShooters =
		lineup.nonShooters - (threat < NON_SHOOTER_THREAT ? 1 : 0);
	const cramped = Math.max(0, nonShooters - 1) * SPACING.crampedStep;
	return others - SPACING.ref - cramped + SPACING.crampedMean;
};

// Synergy: the spacing factor of a five (0 to 1), replacing part of the stock perimeter factor
export const synergySpacingFactor = (lineup: LineupSpacing, n: number) => {
	if (n <= 0) {
		return SPACING.synergyMean;
	}
	const avg = lineup.sum / n;
	const cramped = Math.max(0, lineup.nonShooters - 1) * SPACING.crampedStep;
	const x =
		SPACING.synergyMean +
		SPACING.synergySlope * (avg - SPACING.synergyRef - cramped);
	return x < 0 ? 0 : x > 1 ? 1 : x;
};
