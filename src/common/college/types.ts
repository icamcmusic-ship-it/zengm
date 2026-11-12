// College mode: the state of the current season (game attribute collegeState) and the archive of a finished season
// (key "college" of the season's awards record). See docs/college-mode.md.
import type { NcaaPoll } from "../collegeStats/ncaaPolls.ts";

// Game types in the results log
export const COLLEGE_GAME = {
	NON_CONF: 0,
	CONF: 1,
	CONF_TOURNAMENT: 2,
	NATIONAL: 3,
	// The national tournament's play-in games (68-team field), before the bracket
	FIRST_FOUR: 4,
	NIT: 5,
} as const;

// Game types that are not part of the regular season and conference tournaments (no NET, polls or records)
export const isPostseasonGameType = (type: number) =>
	type >= COLLEGE_GAME.NATIONAL;

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
	// In a First Four game (index into CollegeState.firstFour): two teams share this seed line until it is played
	firstFour?: number;
};

export type CollegeFirstFourGame = {
	home: number;
	away: number;
	seed: number;
	region: number;
	bid: "auto" | "at-large";
	// [home, away], once played
	pts?: [number, number];
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
	// 68-team field: the four play-in games, made with the selection when the conference tournaments are over
	firstFour?: CollegeFirstFourGame[];
	// The NIT (setting collegeNit): a bracket like a conference tournament's (cid -1)
	nit?: CollegeNit;
};

export type CollegeNit = CollegeConfTournament & {
	// Regular season conference champions who lost their tournament (automatic bids)
	autoBids: number[];
};

export type CollegeClassRanking = {
	tid: number;
	rank: number;
	points: number;
	count: number;
	// Number of 5, 4, 3 star recruits
	stars: [number, number, number];
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
	firstFour?: CollegeFirstFourGame[];
	nit?: CollegeNit;
	classRankings?: CollegeClassRanking[];
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
} & RecruitingBox;

// Recruiting v2 (common/college/interest.ts), on a recruit (p.recruit) and on a player in the transfer portal (p.portal)
export type RecruitingBox = {
	// What he values (weights adding up to 1)
	prefs?: import("./interest.ts").Prefs;
	// The schools recruiting him, and how interested he is in each
	schools?: import("./interest.ts").SchoolInterest[];
	// Verbal commitment (before signing day)
	commit?: number;
	// How far the user's staff has scouted him: 0 nothing, 1 his top wants, 2 everything (exact ratings)
	scout?: number;
};

// A player in the transfer portal (p.tid is PLAYER.FREE_AGENT while he is in it)
export type PlayerPortal = RecruitingBox & {
	from: number;
	season: number;
};

// The user's recruiting this season (game attribute collegeRecruiting)
export type CollegeRecruitingState = {
	season: number;
	// Recruiting weeks played this season
	week: number;
	budget: number;
	points: number;
	nilBudget: number;
	nil: number;
	officialVisits: number;
	// Weeks advanced by hand in the current offseason phase (portal, late recruiting)
	offseasonWeeks: number;
	offseasonPhase?: number;
};

export type PlayerCollegeExit = {
	season: number;
	type: "graduated" | "pro" | "left";
	// Off-screen pro draft pick, if drafted
	pick?: number;
	tid: number;
};
