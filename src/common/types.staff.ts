import type { FaceConfig } from "facesjs";

// Coaching staff (basketball only, gated by the coachingStaff setting)

export type CoachRole = "head" | "dev" | "off" | "def";

// All 0-100
export type CoachRatings = {
	// Player development
	dev: number;
	// Offensive scheme/teaching
	off: number;
	// Defensive scheme/teaching
	def: number;
	// Motivation and leadership
	mot: number;
};

// Each is -1 to 1. Exposed so team strategy / game sim code can read it later (see getTeamCoachStyle), not used in GameSim yet.
export type CoachStyle = {
	// -1 slow, 1 fast
	pace: number;
	// -1 inside-oriented, 1 three-point heavy
	threes: number;
	// -1 conservative, 1 aggressive/pressure defense
	defense: number;
	// -1 tight rotation, 1 deep bench
	rotation: number;
};

export type CoachSeason = {
	season: number;
	tid: number;
	role: CoachRole;
	won: number;
	lost: number;
	tied: number;
	otl: number;
	playoffRoundsWon: number;
};

export type CoachTransactionType =
	| "hired"
	| "fired"
	| "reSigned"
	| "left"
	| "retired";

export type CoachTransaction = {
	season: number;
	phase: number;
	tid: number;
	role: CoachRole;
	type: CoachTransactionType;
};

export type CoachWithoutKey = {
	cid?: number;
	firstName: string;
	lastName: string;
	born: {
		year: number;
		loc: string;
	};
	face?: FaceConfig;
	// Team tid, COACH_FREE_AGENT or COACH_RETIRED
	tid: number;
	role: CoachRole;
	ratings: CoachRatings;
	style: CoachStyle;
	// Thousands of dollars per season, counts against expenses (not the salary cap)
	contract: {
		amount: number;
		exp: number;
	};
	stats: CoachSeason[];
	awards: {
		season: number;
		type: string;
	}[];
	transactions: CoachTransaction[];
	retiredYear?: number;
};

export type Coach = CoachWithoutKey & {
	cid: number;
};
