import { traitZ } from "./effects.ts";

// Ego / locker room: how a player's ego affects his teammates' mood and his own trade requests. (His effect on on-court chemistry is in
// effects.ts, egoChemistry.) Pure, no worker/DB/`g` access.

export const EGO_AMPLITUDES = {
	// Mood points one teammate adds at z = 1 (team-first) or takes away at z = -1 (diva). The "Locker room" mood component is the sum over
	// his teammates, bounded below
	teammateMood: 0.6,
	lockerRoomMin: -2.5,
	lockerRoomMax: 1.5,
	// Fractional change to his own chance of asking for a trade when unhappy (diva = more)
	tradeRequestProb: 0.6,
	// How much happier (in mood sum) a team-first star must be before he asks for a trade, and how much sooner a diva asks
	tradeRequestMood: 1.5,
} as const;

// How much one teammate counts in the locker room: by his value share, not one head each, so the star's ego matters far more than the 15th
// man's. Value above a replacement level (40, about the last man on a roster), at least 2 so nobody counts for nothing.
export const LOCKER_ROOM_WEIGHT = {
	replacementValue: 40,
	min: 2,
} as const;

export const lockerRoomWeight = (value: number) =>
	Math.max(
		Number.isFinite(value) ? value - LOCKER_ROOM_WEIGHT.replacementValue : 0,
		LOCKER_ROOM_WEIGHT.min,
	);

// The "Locker room" mood component from sums over his teammates (not himself): n teammates, sumW = sum of their weights, sumWZ = sum of
// weight x ego z. The weights are rescaled to add up to n, so a roster of equals gives exactly the head-count sum (0.6 z each) and the
// league mean stays about 0 (ego has no ratings part, so it is independent of value); bounded as before.
export const lockerRoomMoodFromSums = (
	n: number,
	sumW: number,
	sumWZ: number,
) => {
	if (n <= 0 || !(sumW > 0)) {
		return 0;
	}
	const total = (EGO_AMPLITUDES.teammateMood * n * sumWZ) / sumW;
	return Math.max(
		EGO_AMPLITUDES.lockerRoomMin,
		Math.min(EGO_AMPLITUDES.lockerRoomMax, total),
	);
};

// The "Locker room" mood component for one player, from the ego scores of his teammates (not his own), weighted by their values (see
// lockerRoomWeight; without values every teammate counts the same). 0 with no teammates, and centered: average teammates give about 0.
export const lockerRoomMood = (
	teammateEgoScores: number[],
	teammateValues?: number[],
) => {
	let sumW = 0;
	let sumWZ = 0;
	for (const [i, score] of teammateEgoScores.entries()) {
		const value = teammateValues?.[i];
		const w = value === undefined ? 1 : lockerRoomWeight(value);
		sumW += w;
		sumWZ += w * traitZ(score);
	}
	return lockerRoomMoodFromSums(teammateEgoScores.length, sumW, sumWZ);
};

// Multiply his chance of asking for a trade (once he's unhappy enough) by this. 0.4-1.6, 1 at score 50.
export const egoTradeRequestProbMult = (egoScore: number) =>
	1 - EGO_AMPLITUDES.tradeRequestProb * traitZ(egoScore);

// Add to the mood threshold at or below which he asks for a trade. A diva asks sooner (higher threshold). -1.5 to 1.5, 0 at score 50.
export const egoTradeRequestMoodShift = (egoScore: number) =>
	-EGO_AMPLITUDES.tradeRequestMood * traitZ(egoScore);
