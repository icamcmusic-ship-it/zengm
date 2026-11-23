// Bracket Challenge scoring (pure): shared by the worker (worker/core/playoffExtras) and the achievement check
import type { PlayoffSeries } from "./types.ts";

export const BASE_POINTS = 10;
// A correct pick is worth 10 in the first round, doubling each round
export const roundPoints = (round: number) => BASE_POINTS * 2 ** round;

// Share of the possible points for the Bracketologist achievement
export const BRACKETOLOGIST_SHARE = 0.75;

type Series = PlayoffSeries["series"][number][number];

// The series' winner and loser once it's over (a bye: its team, no loser), else undefined
export const winnerOf = (s: Series, numToWin: number) => {
	if (!s.away) {
		return { winner: s.home, loser: undefined };
	}
	if (s.home.won >= numToWin) {
		return { winner: s.home, loser: s.away };
	}
	if (s.away.won >= numToWin) {
		return { winner: s.away, loser: s.home };
	}
	return undefined;
};

// Rounds completed so far
export const roundsDone = (
	ps: PlayoffSeries,
	numToWin: (round: number) => number,
) => {
	let done = 0;
	for (const [r, round] of ps.series.entries()) {
		if (round.length > 0 && round.every((s) => winnerOf(s, numToWin(r)))) {
			done = r + 1;
		} else {
			break;
		}
	}
	return done;
};

// Maximum possible points for a full bracket of numRounds rounds (byes don't count)
export const maxPoints = (ps: PlayoffSeries, numRounds: number) => {
	const first = ps.series[0] ?? [];
	let total = 0;
	for (let r = 0; r < numRounds; r++) {
		const numSeries =
			r === 0
				? first.filter((s) => s.away).length
				: Math.max(1, first.length / 2 ** r);
		total += numSeries * roundPoints(r);
	}
	return total;
};
