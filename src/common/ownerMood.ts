// Owner mood baselines shared by the end-of-season evaluation (worker/core/season/updateOwnerMood), the Owner's Office budget meeting
// and the evaluation breakdown (worker/views/message). One copy, so the numbers can't drift apart.

import { bySport } from "./sportFunctions.ts";
import type { OwnerMood } from "./types.ts";

// The sport's default salary cap, frozen in time because otherwise the owner mood coefficients would need to be updated when it changes
const FROZEN_SALARY_CAP = () =>
	bySport({
		baseball: 175000,
		basketball: 90000,
		football: 200000,
		hockey: 80000,
	});

// salaryCap / the sport's frozen default cap
export const getSalaryCapScale = (salaryCap: number) =>
	salaryCap / FROZEN_SALARY_CAP();

// The profit (millions of dollars) the owner expects every season. Owner mood money moves by (profit - expected) / (100 * scale)
export const getExpectedProfit = (salaryCap: number) =>
	15 * getSalaryCapScale(salaryCap);

const isOwnerMood = (x: unknown): x is OwnerMood =>
	typeof x === "object" &&
	x !== null &&
	typeof (x as OwnerMood).money === "number" &&
	typeof (x as OwnerMood).playoffs === "number" &&
	typeof (x as OwnerMood).wins === "number";

// Very old leagues stored owner mood as a game attribute (g.ownerMood) rather than on teamSeason. Returns a copy, or undefined
export const getLegacyOwnerMood = (
	gameAttributes: object,
): OwnerMood | undefined => {
	const mood: unknown = (gameAttributes as { ownerMood?: unknown }).ownerMood;
	return isOwnerMood(mood)
		? { money: mood.money, playoffs: mood.playoffs, wins: mood.wins }
		: undefined;
};

// A new owner (Commercial Deals & Ownership sale) doesn't hold his predecessor's grudges: negative parts of the mood are forgiven and
// the positive ones count half, so a brand-new owner can't fire the GM over the old owner's losses
export const honeymoonOwnerMood = (mood: OwnerMood): OwnerMood => ({
	money: mood.money < 0 ? 0 : mood.money / 2,
	playoffs: mood.playoffs < 0 ? 0 : mood.playoffs / 2,
	wins: mood.wins < 0 ? 0 : mood.wins / 2,
});

// The main formula of the end-of-season evaluation, before college expectations, owner type weights, budget meeting goals and the
// owner's requests: regular season (vs .500), playoffs (missing them -0.2, each round up to +0.16 in total, a title +0.2) and money
// (judged profit vs expected, per $100M scaled to the cap, minus any Front Office overspend penalty). Also used for the Owner page's
// projection
export const baseMoodDeltas = ({
	won,
	numGames,
	playoffRoundsWon,
	numPlayoffRounds,
	profit,
	expectedProfit,
	salaryCapScale,
	budget,
	overspendPenalty = 0,
}: {
	won: number;
	numGames: number;
	playoffRoundsWon: number;
	numPlayoffRounds: number;
	profit: number;
	expectedProfit: number;
	salaryCapScale: number;
	budget: boolean;
	overspendPenalty?: number;
}): OwnerMood => {
	// Some sports are more random than others, so like a 60% winning percentage is more impressive then. I think it only matters a lot for baseball, so I picked that coeffiient by determining what factor is needed to make 110/162 wins as valuable as 70/82 wins, then adding a little more so like 95 win seasons are still pretty good.
	const winsFactor = bySport({
		baseball: 2.2,
		basketball: 1,
		football: 1,
		hockey: 1,
	});

	const deltas = {
		wins: (winsFactor * (0.25 * (won - numGames / 2))) / (numGames / 2),
		playoffs: 0,
		money: budget
			? (profit - expectedProfit) / (100 * salaryCapScale) - overspendPenalty
			: 0,
	};

	if (playoffRoundsWon < 0) {
		deltas.playoffs = -0.2;
	} else if (playoffRoundsWon < numPlayoffRounds) {
		deltas.playoffs = (0.16 / numPlayoffRounds) * playoffRoundsWon;
	} else {
		deltas.playoffs = 0.2;
	}

	return deltas;
};

// Bound only the top - can't win the game by doing only one thing, but you can lose it by neglecting one thing
export const capMoodDeltas = (mood: OwnerMood, deltas: OwnerMood) => {
	const capped = { ...deltas };
	for (const key of ["money", "playoffs", "wins"] as const) {
		if (mood[key] + capped[key] > 1) {
			capped[key] = 1 - mood[key];
		}
	}
	return capped;
};
