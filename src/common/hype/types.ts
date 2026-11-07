// Plain-data inputs and outputs of the game hype engine (basketball). The worker reads the database into an HRaw snapshot of the season (see worker/util/hypeData.ts); tests build one by hand. Everything here is serializable.

export const STAT_KEYS = ["pts", "trb", "ast", "stl", "blk", "tp"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

// Totals. A stat that is missing is unknown (never 0): totals that need it are skipped.
export type HTot = { gp: number } & Partial<Record<StatKey, number>>;

// A regular season stats row of a player (one per team stint per season)
export type HRow = HTot & { season: number; tid: number; min?: number };

// One game of a player's, from a stored box score
export type HLine = {
	gid: number;
	season: number;
	day: number;
	tid: number;
	oppTid: number;
	won: boolean;
	min: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tp: number;
	// Playoff game
	po: boolean;
};

export type HMove = {
	season: number;
	phase: number;
	tid: number;
	type: string;
	fromTid?: number;
};

export type HPlayerRaw = {
	pid: number;
	name: string;
	// Current team (-1 free agent, -3 retired, ...)
	tid: number;
	draft: { year: number; round: number; pick: number };
	// All regular season rows, oldest first, including the current season
	rows: HRow[];
	// Overall rating by season, as shown to the user
	ovrBySeason: Record<number, number>;
	allStar: number[];
	moves: HMove[];
	// Teams that released him (with the season)
	released: { season: number; tid: number }[];
};

export type HTeam = {
	tid: number;
	abbrev: string;
	// Full name, "Boston Celtics"
	name: string;
	cid: number;
	did: number;
};

export type HBoxLine = {
	pid: number;
	name: string;
	// Injured going into the game (known beforehand)
	inj?: boolean;
	min: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tp: number;
};

export type HGameTeam = {
	tid: number;
	pts: number;
	ptsQtrs?: number[];
	ovr?: number;
	// Record after the game
	won?: number;
	lost?: number;
	tied?: number;
	otl?: number;
	players: HBoxLine[];
};

// A stored (finished) game. teams[0] is the home team.
export type HGame = {
	gid: number;
	season: number;
	day: number;
	playoffs: boolean;
	playIn: boolean;
	overtimes: number;
	teams: [HGameTeam, HGameTeam];
	// Plain text of the clutch plays
	clutch: string[];
};

export type HSeriesTeam = { tid: number; seed: number; won: number };

export type HSeries = {
	season: number;
	round: number;
	numRounds: number;
	numToWin: number;
	playIn?: boolean;
	home: HSeriesTeam;
	away?: HSeriesTeam;
	// Played games
	gids: number[];
};

export type HRecordEntry = {
	v: number;
	pid: number;
	name: string;
	season?: number;
};

// Records standing going into the season, from every season before it
export type HRecords = {
	seasonLeague: Partial<Record<StatKey, HRecordEntry>>;
	// Per franchise: the number of seasons on file and the best single seasons
	seasonFranchise: Record<
		number,
		{ n: number; best: Partial<Record<StatKey, HRecordEntry>> }
	>;
	// Top two careers (so that the holder can chase the runner-up's mark)
	careerLeague: Partial<Record<StatKey, HRecordEntry[]>>;
	careerFranchise: Record<number, Partial<Record<StatKey, HRecordEntry[]>>>;
	// Ovr a player needs to count as a star, by season
	starCut: Record<number, number>;
	// First season on file
	firstSeason: number;
};

export type HRaw = {
	season: number;
	numGames: number;
	teams: HTeam[];
	// Stored games of the season (regular season, play-in, playoffs), finished
	games: HGame[];
	// Box scores cover (almost) every regular season game, so totals to date can be summed from them
	linesComplete: boolean;
	players: HPlayerRaw[];
	series: HSeries[];
	records: HRecords | null;
	// Current records of the teams, used for upcoming games
	teamNow?: Record<
		number,
		{ won: number; lost: number; tied: number; otl: number; streak: number; ovr?: number }
	>;
	playoffsByConf: boolean;
	// Teams per conference (or league) in the playoffs, play-in included
	maxPlayoffSeed: number;
	// Players that cannot play (tid -> pids), for upcoming games
	out?: Record<number, number[]>;
};

// What the engine needs about a game, as it stood before it was played
export type HTeamState = {
	tid: number;
	abbrev: string;
	name: string;
	won: number;
	lost: number;
	tied: number;
	otl: number;
	// Positive: wins in a row
	streak: number;
	ovr: number | null;
	cid: number;
	did: number;
	seed?: number;
};

export type HListed = {
	pid: number;
	name: string;
	tid: number;
	ovr: number | null;
	draft: { year: number; round: number; pick: number };
	// Rows of earlier seasons
	rows: HRow[];
	// This season to date, one per team; null when unknown
	cur: HRow[] | null;
	// This season's games before this one in which he played, oldest first
	lines: HLine[];
	// Earlier season's lines (only when stored in full)
	prevLines: HLine[];
	prevLinesSeason: number | null;
	ovrBySeason: Record<number, number>;
	allStar: number[];
	moves: HMove[];
	released: { season: number; tid: number }[];
};

export type HSeriesState = {
	info: HSeries;
	// Games of the series before this one
	before: {
		gid: number;
		winTid: number;
		loseTid: number;
		winPts: number;
		losePts: number;
		ot: number;
		homeTid: number;
	}[];
	index: number;
};

export type HStanding = { tid: number; won: number; lost: number; group: number };

export type HGameInput = {
	gid: number;
	season: number;
	day: number;
	playoffs: boolean;
	playIn: boolean;
	numGames: number;
	// [home, away]
	teams: [HTeamState, HTeamState];
	players: [HListed[], HListed[]];
	standings: HStanding[] | null;
	maxPlayoffSeed: number;
	series: HSeries[];
	seriesState: HSeriesState | null;
	records: HRecords | null;
	starCut: number | null;
	// Season scoring environment of the games stored before this one
	env: { n: number; mean: number; sd: number; hiTeam: number } | null;
	// The earliest season whose lines are stored in full (for "first meeting since")
	linesFrom: number;
	teamName: Record<number, string>;
};

export type Reason = { k: string; pts: number; text: string };

export type Chase = {
	pid: number;
	name: string;
	tid: number;
	k: StatKey;
	word: string;
	scope: "league" | "franchise";
	kind: "season" | "career";
	record: HRecordEntry;
	// Whether the record is the league's from the start of the league
	whole: boolean;
	cur: number;
	need: number;
	gp: number;
	rate: number;
	left: number;
	proj: number;
	status: "broken" | "on pace" | "just off the pace" | "off the pace" | "within reach";
	pts: number;
};

export type Milestone = {
	pid: number;
	name: string;
	k: StatKey;
	word: string;
	before: number;
	mark: number;
	text: string;
};

export type Heater = { pid: number; name: string; hot: number; base: number; text: string };

export type Revenge = {
	pid: number;
	name: string;
	tid: number;
	oppTid: number;
	how: "traded" | "released" | "free agency" | null;
	when: number | "this season" | null;
	whenPhase: number | null;
	first: boolean | null;
	star: boolean;
	allStar: number;
	seasons: number;
	ppg: number;
	lastWith: number;
	direct: boolean;
	pts: number;
};

export type RookieDuel = {
	a: { pid: number; name: string; tid: number; no: number | null; ppg: number | null; year: number };
	b: { pid: number; name: string; tid: number; no: number | null; ppg: number | null; year: number };
	text: string;
	pts: number;
};

export type SeriesSoFar = {
	game: number;
	hw: number;
	aw: number;
	need: number;
	decided: number;
	lines: string[];
	text: string;
};

export type Pre = {
	score: number;
	raw: number;
	label: string;
	reasons: Reason[];
	story: {
		milestones: Milestone[];
		chases: Chase[];
		heaters: Heater[];
		revenge: Revenge[];
		rookies: RookieDuel | null;
	};
	series: SeriesSoFar | null;
};

export type HResult = {
	winTid: number;
	loseTid: number;
	homeTid: number;
	winPts: number;
	losePts: number;
	overtimes: number;
	teams: HGame["teams"];
	clutch: string[];
	lastGameOfSeries: boolean;
	clinchedTitle: boolean;
};

export type Post = {
	score: number;
	raw: number;
	label: string;
	reasons: Reason[];
	note?: string;
};

export type Verdict = {
	kind: "lived" | "fizzled" | "exceeded" | "quiet";
	head: string;
	why: string[];
	pre: number;
	post: number;
	text: string;
};

export type HypeGame = {
	gid: number;
	season: number;
	day: number;
	kind: "rs" | "po" | "pi";
	completed: boolean;
	teams: {
		tid: number;
		abbrev: string;
		name: string;
		record: string;
		pts?: number;
	}[];
	pre: Pre;
	post: Post | null;
	verdict: Verdict | null;
	// Blend used for ranking: the pre-game hype for upcoming games, a mix of both for finished ones
	watch: number;
};
