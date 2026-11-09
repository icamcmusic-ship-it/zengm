import type { ProspectNcaaSummary } from "./ncaa.ts";
import type { SplitLine } from "./season.ts";

export const RATING_KEYS = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
] as const;

export type RatingKey = (typeof RATING_KEYS)[number];
export type Ratings = Record<RatingKey, number> & {
	// Expanded ratings (the expandedRatings setting), only when it's on
	wng?: number;
	pdef?: number;
	idef?: number;
};

// What the engine needs to know about a prospect. Nothing here is changed by generation.
export type CollegeProspect = {
	// Anything unique and stable, used to seed this player's own random numbers
	key: string;
	// Age during the draft year season
	age: number;
	ovr: number;
	pot: number;
	pos: string;
	ratings: Ratings;
	// BBGM college field, "" if none
	college: string;
	// Birth place, like "Chicago, IL, USA", used to guess a destination for prospects with no college
	bornLoc: string;
};

export type GameBox = {
	min: number;
	fg: number;
	fga: number;
	fgAtRim: number;
	fgaAtRim: number;
	fgLowPost: number;
	fgaLowPost: number;
	fgMidRange: number;
	fgaMidRange: number;
	tp: number;
	tpa: number;
	ft: number;
	fta: number;
	orb: number;
	drb: number;
	ast: number;
	tov: number;
	stl: number;
	blk: number;
	ba: number;
	pf: number;
	pts: number;
	pm: number;
};

// A season as stats a stats row needs. Every key is a key of a BBGM basketball stats row (see player/stats.basketball.ts)
export type CollegeSeason = {
	season: number;
	// 0 = freshman ... 3 = senior
	classIndex: number;
	// Age that season, if known
	age?: number;
	school: string;
	conference: string | undefined;
	// Level of competition, 0-100
	strength: number;
	gameMinutes: number;
	teamGames: number;
	stats: Record<string, number>;
	// Season highs, as [value, game id]. Game ids are negative so they can never be a real game in the league
	max: Record<string, [number, number]>;
	// Used by the honors model
	score: number;
	defScore: number;
	// With the college season model: his box scores in his team's postseason games (the last games of the season), in order
	postseasonBoxes?: GameBox[];
	// With the college season model: his regular season, non-conference and conference games
	splits?: { nonConf: SplitLine; conf: SplitLine };
};

export type CollegeHonor = {
	season: number;
	type: string;
};

export type CollegeResult = {
	key: string;
	// The destination for a prospect who had no college
	school: string;
	seasons: CollegeSeason[];
	honors: CollegeHonor[];
	// With the college season model, for a prospect at an NCAA school: his team's season and his postseason games
	ncaa?: ProspectNcaaSummary;
};
