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
	// Coaching systems (coachSystems setting): the season's preseason expectation (win%, from the Season Odds rating model), the
	// development of the team's young players (average ovr change of players 24 and under, relative to the league's) and the systems used
	expectedPct?: number;
	dev?: number;
	off?: OffenseSystem;
	def?: DefenseSystem;
};

// Coaching systems (coachSystems setting, see common/coachSystems.ts)
export type OffenseSystem =
	| "motion"
	| "paceSpace"
	| "heliocentric"
	| "post"
	| "iso"
	| "princeton"
	| "sevenSeconds";

export type DefenseSystem =
	| "switch"
	| "drop"
	| "blitz"
	| "packPaint"
	| "zone"
	| "press";

export type CoachBackground = "guard" | "big" | "analytics" | "defense";

// A coach's identity beyond CoachStyle. Dials are -1 to 1, mgmt/adapt 0-100. Derived deterministically from the coach (style, ratings,
// name) when missing (getCoachProfile), so coaches from before the setting existed get one without any random draws
export type CoachProfile = {
	off: OffenseSystem;
	def: DefenseSystem;
	// -1 get back in transition ... 1 crash the offensive glass
	crash: number;
	// -1 disciplined, few fouls ... 1 physical, lots of fouls
	fouls: number;
	// -1 closes games with the system (ball movement) ... 1 gives it to the star
	closing: number;
	// -1 saves timeouts for the end ... 1 quick trigger
	timeouts: number;
	// -1 trusts veterans ... 1 trusts young players
	youth: number;
	// -1 rests nobody ... 1 load management on back-to-backs
	rest: number;
	// -1 win now ... 1 development
	philosophy: number;
	// -1 disciplinarian ... 1 players' coach
	personality: number;
	background: CoachBackground;
	// Late-game management (timeouts, fouling, closing) 0-100
	mgmt: number;
	// How readily he changes his system to fit the roster, 0-100 (stubborn below ~30)
	adapt: number;
	// The season the current system started with the current team (installation)
	since?: number;
	// Preseason expectation for his team (win%, the Season Odds rating model), for the hot seat
	expect?: { season: number; tid: number; pct: number };
	// Coaching tree: the head coach he worked under (assistants who become head coaches)
	mentor?: { cid: number; name: string };
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
	// Coaching systems (coachSystems setting). Missing for coaches from before it: see getCoachProfile
	profile?: CoachProfile;
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
	// The team's record when he was hired during a season, so his season row only counts the games he coached
	hiredRecord?: {
		season: number;
		tid: number;
		won: number;
		lost: number;
		tied: number;
		otl: number;
	};
};

export type Coach = CoachWithoutKey & {
	cid: number;
};
