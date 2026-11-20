// Coach Market & Succession (featureCoachMarket): pure helpers shared by worker and UI. Seeded by the coach's identity, no random draws.
import { Rng } from "../ratingsBuilds/rng.ts";

// Interviews per team per hiring season
export const MAX_INTERVIEWS = 3;

// A candidate who wants a job less than this turns the offer down
export const MIN_INTEREST = 30;

// Salary premiums the user can offer above the asking price
export const PREMIUMS = [0, 0.1, 0.2] as const;

// Associate head coach: each offseason he grows toward head coach ratings by up to this much per rating
export const HEIR_GROWTH_MAX = 2;

export type CoachPrefs = { success: number; market: number; salary: number };

const identity = (c: {
	firstName: string;
	lastName: string;
	born: { year: number };
}) => `${c.firstName}|${c.lastName}|${c.born.year}`;

// What a coach cares about in a job: weights summing to 1
export const coachPrefs = (c: {
	firstName: string;
	lastName: string;
	born: { year: number };
}): CoachPrefs => {
	const rng = new Rng(`coachPrefs|${identity(c)}`);
	const a = 0.3 + rng.random();
	const b = 0.3 + rng.random();
	const d = 0.3 + rng.random();
	const sum = a + b + d;
	return {
		success: Math.round((100 * a) / sum) / 100,
		market: Math.round((100 * b) / sum) / 100,
		salary: Math.round((100 * d) / sum) / 100,
	};
};

export const PREF_NAMES: Record<keyof CoachPrefs, string> = {
	success: "a winning team",
	market: "a big market",
	salary: "the money",
};

export const topPref = (prefs: CoachPrefs): keyof CoachPrefs =>
	(Object.keys(prefs) as (keyof CoachPrefs)[]).sort(
		(x, y) => prefs[y] - prefs[x],
	)[0]!;

/**
 * How much a coach wants a job, 0-100. success: the team's win% (last season, or this one), 0-1. market: 0 smallest ... 1 biggest.
 * salaryRatio: the offer over his asking price.
 */
export const candidateInterest = ({
	prefs,
	success,
	market,
	salaryRatio,
	courted,
}: {
	prefs: CoachPrefs;
	success: number;
	market: number;
	salaryRatio: number;
	// Interviewed by the team: a little more interested
	courted?: boolean;
}) => {
	const s = Math.max(0, Math.min(1, (success - 0.25) / 0.5));
	const m = Math.max(0, Math.min(1, market));
	const pay = Math.max(0, Math.min(1, 0.5 + 2.5 * (salaryRatio - 1)));
	const score =
		100 * (prefs.success * s + prefs.market * m + prefs.salary * pay) +
		(courted ? 6 : 0);
	// Most coaches want most jobs: a floor, so only clearly bad fits refuse
	return Math.round(Math.max(0, Math.min(100, 22 + 0.85 * score)));
};

export const interestLabel = (x: number) =>
	x >= 75
		? "Eager"
		: x >= 55
			? "Interested"
			: x >= MIN_INTEREST
				? "Lukewarm"
				: "Not interested";
