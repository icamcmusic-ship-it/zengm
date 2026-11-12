// College mode: the state of the current season (game attribute collegeState) and the archive of a finished season
// (key "college" of the season's awards record). See docs/college-mode.md.
import type { NcaaPoll } from "../collegeStats/ncaaPolls.ts";

// Game types in the results log
export const COLLEGE_GAME = {
	NON_CONF: 0,
	CONF: 1,
	CONF_TOURNAMENT: 2,
	NATIONAL: 3,
} as const;

// Numbers per game in CollegeState.results: day, home tid, away tid, home points minus away points, site (1 = home court, 0 = neutral), type
export const RESULT_SIZE = 6;

export type CollegeConfMatchup = {
	// tids. -1 = not known yet
	home: number;
	away: number;
	// Seeds within the conference tournament (1 = best)
	seedHome?: number;
	seedAway?: number;
	// [home, away], once played
	pts?: [number, number];
};

export type CollegeConfTournament = {
	cid: number;
	// tids by seed (index 0 = the 1 seed)
	seeds: number[];
	// rounds[0] is the first round. A bracket slot that is a bye is stored as a matchup with away = -2 and no pts
	rounds: CollegeConfMatchup[][];
	champion?: number;
};

export type CollegeNetRow = {
	tid: number;
	rank: number;
	score: number;
	sosRank: number;
	quads: [number, number][];
	w: number;
	l: number;
	srs: number;
	// Committee score (higher is better)
	sel: number;
};

export type CollegeFieldTeam = {
	tid: number;
	// 1-16 within the region
	seed: number;
	region: number;
	bid: "auto" | "at-large";
	// 1 = the top overall seed
	overall: number;
};

export type CollegeSelection = {
	field: CollegeFieldTeam[];
	lastFourIn: number[];
	firstFourOut: number[];
	nextFourOut: number[];
	// Every team, best NET first
	net: CollegeNetRow[];
};

export type CollegeState = {
	season: number;
	// Flat results log, RESULT_SIZE numbers per game
	results: number[];
	// Number of game days in the regular season schedule (for the poll weeks)
	regDays: number;
	// Preseason reputation of every team (index = tid), in points per game around 0
	reputation: number[];
	polls: NcaaPoll[];
	// Last week a poll was made for
	pollWeek: number;
	confTournaments?: CollegeConfTournament[];
	selection?: CollegeSelection;
};

export type CollegeProDraftPick = {
	pick: number;
	pid: number;
	name: string;
	pos: string;
	tid: number;
	classYear: number;
	age: number;
	ovr: number;
	pot: number;
};

export type CollegeDeparture = {
	pid: number;
	name: string;
	pos: string;
	tid: number;
	classYear: number;
	ovr: number;
	// For transfers: the new school
	toTid?: number;
};

export type CollegeCommit = {
	pid: number;
	name: string;
	pos: string;
	tid: number;
	stars: number;
	rank: number;
	state: string;
	ovr: number;
	pot: number;
};

export type CollegeConfAward = {
	cid: number;
	pid: number;
	name: string;
	tid: number;
	pos: string;
	classYear: number;
	pts: number;
	trb: number;
	ast: number;
};

// awards[season].college
export type CollegeArchive = {
	polls?: NcaaPoll[];
	confTournaments?: CollegeConfTournament[];
	selection?: CollegeSelection;
	confPoy?: CollegeConfAward[];
	proDraft?: CollegeProDraftPick[];
	graduated?: number;
	transfers?: CollegeDeparture[];
	commits?: CollegeCommit[];
};

export type PlayerRecruit = {
	stars: number;
	// National rank in his class (1 = best)
	rank: number;
	posRank: number;
	// Home state (or country)
	state: string;
	// Priority the user gave him (1 = top target), if targeted
	userTarget?: number;
	// School he signed with, and the season
	committed?: number;
	season?: number;
	// Joined as a walk-on rather than through recruiting
	walkOn?: boolean;
};

export type PlayerCollegeExit = {
	season: number;
	type: "graduated" | "pro" | "left";
	// Off-screen pro draft pick, if drafted
	pick?: number;
	tid: number;
};
