// Injury outlook (basketball, with Injury Depth): what a team's medical staff says about an injury. One duration convention: the games
// he'll miss. Between days that's gamesRemaining. For an injury from today's game (box score, live game, the injury news) it's one less,
// because the countdown also runs at the end of today.
//
// An injury that got hurt with this on carries `spread` (the medical staff's uncertainty, from the health budget). Then:
// - more than GAME_TIME_MAX_GAMES games out: an estimate range ("2-4 weeks") instead of the exact games left, narrower with a better budget
// - 1-GAME_TIME_MAX_GAMES games out: a game-time status (Questionable, Doubtful, Out), decided by a seeded roll before each game
// Injuries without `spread` (other sports, older injuries, God Mode edits) show the exact games, as before.

import { helpers } from "./helpers.ts";
import { levelToEffect } from "./budgetLevels.ts";
import { bySport } from "./sportFunctions.ts";

type InjuryLike = {
	gamesRemaining: number;
	newThisGame?: boolean;
	spread?: number;
};

export const injuryGamesOut = (injury: InjuryLike) =>
	injury.newThisGame
		? Math.max(0, injury.gamesRemaining - 1)
		: injury.gamesRemaining;

// --- Estimate range ---

// Uncertainty as a fraction of the games left: about +-30% at an average health budget, +-17% at the top, +-45% at the bottom
export const injurySpread = (healthLevel: number) =>
	helpers.bound(0.3 - 0.12 * levelToEffect(healthLevel), 0.15, 0.45);

export const injuryEstimateRange = (
	injury: InjuryLike,
): { lo: number; hi: number } | undefined => {
	if (injury.spread === undefined) {
		return;
	}
	const games = injuryGamesOut(injury);
	if (games <= GAME_TIME_MAX_GAMES) {
		return;
	}
	return {
		lo: Math.max(1, Math.floor(games * (1 - injury.spread))),
		hi: Math.max(2, Math.ceil(games * (1 + injury.spread))),
	};
};

const GAMES_PER_WEEK = bySport({
	baseball: 6,
	basketball: 3.5,
	football: 1,
	hockey: 3.5,
});

export const formatInjuryRange = (lo: number, hi: number) => {
	if (GAMES_PER_WEEK === 1 || hi <= 10) {
		const unit = GAMES_PER_WEEK === 1 ? "week" : "game";
		return lo === hi
			? `${lo} ${helpers.plural(unit, lo)}`
			: `${lo}-${hi} ${unit}s`;
	}
	let loW = Math.max(1, Math.floor(lo / GAMES_PER_WEEK));
	let hiW = Math.max(loW + 1, Math.ceil(hi / GAMES_PER_WEEK));
	if (hiW <= 8) {
		return `${loW}-${hiW} weeks`;
	}
	loW = Math.max(1, Math.floor(loW / 4.3));
	hiW = Math.max(loW + 1, Math.ceil(hiW / 4.3));
	return `${loW}-${hiW} months`;
};

// --- Game-time decisions ---

export const GAME_TIME_MAX_GAMES = 3;

export type GameTimeStatus = "Q" | "D" | "O";

// Chance he plays when the decision is made before the game
export const GAME_TIME_PLAY_PROB: Record<GameTimeStatus, number> = {
	Q: 0.5,
	D: 0.25,
	O: 0,
};

export const GAME_TIME_LABELS: Record<GameTimeStatus, string> = {
	Q: "Questionable",
	D: "Doubtful",
	O: "Out (day-to-day)",
};

export const gameTimeStatus = (
	injury: InjuryLike,
): GameTimeStatus | undefined => {
	if (injury.spread === undefined) {
		return;
	}
	const games = injuryGamesOut(injury);
	if (games <= 0 || games > GAME_TIME_MAX_GAMES) {
		return;
	}
	return games === 1 ? "Q" : games === 2 ? "D" : "O";
};

// The short text for an injury: "Questionable", "2-4 weeks", or the exact games ("5 games") when there's no estimate
export const injuryOutlookText = (injury: InjuryLike, exact?: boolean) => {
	const status = gameTimeStatus(injury);
	if (status && !exact) {
		return GAME_TIME_LABELS[status];
	}
	const range = injuryEstimateRange(injury);
	if (range && !exact) {
		return formatInjuryRange(range.lo, range.hi);
	}
	const games = injuryGamesOut(injury);
	return `${games} ${helpers.plural(bySport({ default: "game", football: "week" }), games)}`;
};
