import { getNumRounds, isDunkContest } from "../../../common/dunkContest.ts";
import { orderBy } from "../../../common/utils.ts";
import * as dunkContest from "./dunkContest.ts";
import * as threeContest from "./threeContest.ts";

// After this many tiebreaker rounds for the same spot, the tie is broken without another round (see below)
export const MAX_TIEBREAKER_ROUNDS = 5;

export const getNextRoundType = (contest: {
	players: {
		pid: number;
		tid: number;
		name: string;
	}[];
	rounds: {
		tiebreaker?: boolean;
	}[];
}) => {
	const baseRounds = contest.rounds.filter((round) => !round.tiebreaker);

	const numRoundsTotal = getNumRounds(contest);

	// 1 or 2, depending on if we're in the 1st round (or its tiebreakers) or 2nd round (or its tiebreakers)
	const currentRoundNum = baseRounds.length;

	// Index of the current baseRound
	const currentRoundIndex = contest.rounds.indexOf(baseRounds.at(-1)!);

	// Current round (1st or 2nd round) plus all its tiebreakers
	const currentRoundAndTiebreakers = contest.rounds.filter(
		(round, i) => i >= currentRoundIndex,
	);

	const getRoundResults = isDunkContest(contest as any)
		? dunkContest.getRoundResults
		: threeContest.getRoundResults;

	const resultsByRound = currentRoundAndTiebreakers.map((round) =>
		orderBy(getRoundResults(round as any), "score", "desc"),
	);

	let numWinnersLeftToFind = 2 ** (numRoundsTotal - currentRoundNum);
	const indexesForNextRound: number[] = [];
	let indexesForNextTiebreaker: number[] = [];

	let outcome: "normalRound" | "over" | "tiebreakerRound" | undefined;

	for (const round of resultsByRound) {
		// Do the top N separate from the rest, as we need?
		if (
			round[numWinnersLeftToFind - 1]!.score >
			round[numWinnersLeftToFind]!.score
		) {
			for (let i = 0; i < numWinnersLeftToFind; i++) {
				indexesForNextRound.push(round[i]!.index);
			}
			numWinnersLeftToFind = 0;
			outcome = currentRoundNum === numRoundsTotal ? "over" : "normalRound";
			break;
		} else {
			const tiedValue = round[numWinnersLeftToFind]!.score;

			// Find players ranked above the tied players - they go to next round automatically
			const playersToNextRound = round.filter((p) => p.score > tiedValue);
			for (const p of playersToNextRound) {
				numWinnersLeftToFind -= 1;
				indexesForNextRound.push(p.index);
			}

			const tied = round.filter((p) => p.score === tiedValue);
			indexesForNextTiebreaker = tied.map((p) => p.index);

			outcome = "tiebreakerRound";
		}

		// Keep running if it still needs a tiebreaker, in case there already is another one
	}

	if (!outcome) {
		throw new Error("outcome should never be undefined");
	}

	// Too many tiebreakers in a row (two dunkers who keep matching scores, or shooters who keep missing): settle it without
	// another round, by the scores in the earlier base rounds, then by contest order (deterministic)
	const numTiebreakers = currentRoundAndTiebreakers.length - 1;
	if (
		outcome === "tiebreakerRound" &&
		numTiebreakers >= MAX_TIEBREAKER_ROUNDS &&
		numWinnersLeftToFind > 0
	) {
		const earlierScores = new Map<number, number>();
		for (const round of contest.rounds.slice(0, currentRoundIndex)) {
			if (round.tiebreaker) {
				continue;
			}
			for (const { index, score } of getRoundResults(round as any)) {
				earlierScores.set(index, (earlierScores.get(index) ?? 0) + score);
			}
		}
		const ranked = orderBy(
			indexesForNextTiebreaker,
			[(index) => earlierScores.get(index) ?? 0, (index) => index],
			["desc", "asc"],
		);
		indexesForNextRound.push(...ranked.slice(0, numWinnersLeftToFind));
		indexesForNextTiebreaker = [];
		outcome = currentRoundNum === numRoundsTotal ? "over" : "normalRound";
	}

	return {
		indexesForNextRound,
		indexesForNextTiebreaker,
		outcome,
	};
};
