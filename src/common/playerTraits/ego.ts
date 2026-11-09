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

// The "Locker room" mood component for one player, from the ego scores of his teammates (not his own). 0 with no teammates, and centered:
// average teammates give about 0.
export const lockerRoomMood = (teammateEgoScores: number[]) => {
	let total = 0;
	for (const score of teammateEgoScores) {
		total += EGO_AMPLITUDES.teammateMood * traitZ(score);
	}
	return Math.max(
		EGO_AMPLITUDES.lockerRoomMin,
		Math.min(EGO_AMPLITUDES.lockerRoomMax, total),
	);
};

// Multiply his chance of asking for a trade (once he's unhappy enough) by this. 0.4-1.6, 1 at score 50.
export const egoTradeRequestProbMult = (egoScore: number) =>
	1 - EGO_AMPLITUDES.tradeRequestProb * traitZ(egoScore);

// Add to the mood threshold at or below which he asks for a trade. A diva asks sooner (higher threshold). -1.5 to 1.5, 0 at score 50.
export const egoTradeRequestMoodShift = (egoScore: number) =>
	-EGO_AMPLITUDES.tradeRequestMood * traitZ(egoScore);
