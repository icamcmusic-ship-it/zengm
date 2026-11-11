import { traitZ } from "./effects.ts";

// Loyalty, role acceptance and money vs winning: how a player's personality changes his mood, his contract demands and his trade requests.
// Pure, no worker/DB/`g` access. Everything is linear in z = traitZ(score), neutral (1 or 0) at score 50, and bounded. Keep in sync with
// docs/player-traits.md.

export const PERSONALITY_AMPLITUDES = {
	// Loyalty: fractional discount (premium for low loyalty) on what he asks to re-sign with his current team
	loyaltyResignDiscount: 0.08,
	// Loyalty: fractional change to the "Loyalty" mood component (which includes the bonus for staying with his team)
	loyaltyMood: 0.5,
	// Loyalty: fractional change to his chance of asking for a trade (disloyal = more)
	loyaltyTradeRequest: 0.3,
	// Role acceptance: fractional change to a negative "Playing time" mood component (low acceptance = bigger penalty)
	rolePlayingTime: 0.5,
	// Role acceptance: fractional change to his chance of asking for a trade while unhappy with his minutes
	roleTradeRequest: 0.4,
	// Money vs winning: fractional change to a positive "Team performance" mood component (ring chasers are drawn more by winning teams)
	winningTeamPerformance: 0.5,
	// Money vs winning: maximum fractional discount a ring chaser gives a contender (team performance component +2). Never below the minimum
	ringChaserDiscount: 0.15,
} as const;

const A = PERSONALITY_AMPLITUDES;

// Multiply what he asks to re-sign with his current team by this. 0.92-1.08
export const loyaltyContractMult = (loyalty: number) =>
	1 - A.loyaltyResignDiscount * traitZ(loyalty);

// Multiply the "Loyalty" mood component by this. 0.5-1.5 (stays >= 0)
export const loyaltyMoodMult = (loyalty: number) =>
	1 + A.loyaltyMood * traitZ(loyalty);

// The "Playing time" mood component after role acceptance. Only a penalty (negative) is scaled: 0.5x to 1.5x
export const roleAcceptancePlayingTime = (
	playingTime: number,
	roleAcceptance: number,
) =>
	playingTime < 0
		? playingTime * (1 - A.rolePlayingTime * traitZ(roleAcceptance))
		: playingTime;

// The "Team performance" mood component after money vs winning. Only the attraction of a winning team (positive) is scaled: 0.5x to 1.5x,
// so a bad team is never hated more than before (and minimum contract free agents still sign with anyone, see moodInfo)
export const winningTeamPerformance = (
	teamPerformance: number,
	moneyVsWinning: number,
) =>
	teamPerformance > 0
		? teamPerformance * (1 + A.winningTeamPerformance * traitZ(moneyVsWinning))
		: teamPerformance;

// Multiply what a ring chaser asks from a winning team by this (teamPerformance: the mood component, up to 2). 0.85-1, 1 for anyone else
export const ringChaserContractMult = (
	moneyVsWinning: number,
	teamPerformance: number,
) => {
	const z = traitZ(moneyVsWinning);
	if (z <= 0 || teamPerformance <= 0) {
		return 1;
	}
	return 1 - A.ringChaserDiscount * z * Math.min(teamPerformance / 2, 1);
};

// Multiply his chance of asking for a trade (once unhappy enough) by this. playingTimeUnhappy: his playing time mood component is negative
export const personalityTradeRequestProbMult = (
	loyalty: number,
	roleAcceptance: number,
	playingTimeUnhappy: boolean,
) =>
	(1 - A.loyaltyTradeRequest * traitZ(loyalty)) *
	(playingTimeUnhappy ? 1 - A.roleTradeRequest * traitZ(roleAcceptance) : 1);
