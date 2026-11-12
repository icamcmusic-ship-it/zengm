// Input (facts gathered by the worker) and output (a laid-out paper) of the newspaper engine. Everything here is plain data, so it can be built in the worker, sent to the UI, and tested without a database.

export type EditionId = "preseason" | "midseason" | "playoffs" | "final";

export type NPRecord = {
	won: number;
	lost: number;
	tied?: number;
	otl?: number;
};

// One earlier season of a franchise
export type NPYear = NPRecord & { season: number; playoffRoundsWon: number };

export type NPTeam = NPRecord & {
	tid: number;
	abbrev: string;
	region: string;
	name: string;
	cid: number;
	did: number;
	gp: number;
	// Points scored/allowed per game, if any games were played
	pts?: number;
	oppPts?: number;
	streak: number;
	wonHome: number;
	lostHome: number;
	wonAway: number;
	lostAway: number;
	// -1 missed the playoffs, otherwise rounds won. undefined before the playoffs
	playoffRoundsWon: number;
	seed?: number;
	pop?: number;
	// The franchise's season before, if it exists
	prev?: NPRecord & { playoffRoundsWon: number };
	// Seasons the franchise won the title, before this one
	titles: number[];
	// First season of the franchise in the league
	firstSeason: number;
	// Earlier seasons of the franchise, oldest first
	hist?: NPYear[];
	// Games decided by five points or fewer, and overtime games, from the stored box scores
	close?: { w: number; l: number };
	ot?: { w: number; l: number };
	// Longest winning and losing streaks of the season so far, from the box scores
	bestStreak?: number;
	worstStreak?: number;
	// Total of the contracts on the roster, in thousands (current season only)
	payroll?: number;
};

export type NPLine = {
	gp: number;
	min: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	per: number;
	ws: number;
	fgp: number;
	tpp: number;
	tp: number;
};

export type NPPlayer = NPLine & {
	pid: number;
	name: string;
	tid: number;
	age: number;
	pos: string;
	ovr: number;
	pot: number;
	prevOvr?: number;
	// Per game unless noted. Playoff line, if any
	po?: NPLine;
	// Line the season before, for comparisons
	prevLine?: Pick<NPLine, "gp" | "pts" | "trb" | "ast" | "ws">;
	injury?: { type: string; gamesRemaining: number };
	draftYear: number;
	draftRound: number;
	draftPick: number;
	draftTid: number;
	rookie: boolean;
	contractAmount?: number; // thousands
	contractExp?: number;
	// First season of the current contract and what kind it is ("rookie", "reSign", "freeAgent", "unknown"), current season only
	contractStart?: number;
	contractType?: string;
	// Team he finished last season with, if he played
	prevTid?: number;
	// Per game extras. Left out when the file does not have them
	gs?: number; // games started
	ftp?: number;
	tov?: number;
	pf?: number;
	orb?: number;
	ows?: number;
	dws?: number;
	pm?: number; // plus-minus per game
	// Counts from the stored box scores (games with a box score only)
	dd?: number;
	td?: number;
	g30?: number;
	g40?: number;
	hi?: number;
	boxGp?: number;
	// Regular-season totals before this season
	career?: NPCareer;
	honors?: NPHonors;
	college?: string;
	country?: string;
	jersey?: string;
};

export type NPCareer = {
	gp: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tp: number;
	ws: number;
	seasons: number;
};

export type NPHonors = {
	mvp: number;
	dpoy: number;
	allStar: number;
	allLeague: number;
	titles: number;
};

export type NPAward = {
	key: string; // shortName, like MVP
	name: string; // full name
	pid: number;
	tid: number;
	// pids in vote order, winner first
	order: number[];
	group?: string; // conference name for conf awards
};

export type NPTeamAward = {
	key: string;
	name: string;
	teams: { title: string; pids: number[] }[];
};

export type NPSeriesTeam = {
	tid: number;
	seed: number;
	won: number;
};

export type NPSeries = {
	round: number;
	home: NPSeriesTeam;
	away?: NPSeriesTeam;
	gids: number[];
};

export type NPBoxLine = {
	pid: number;
	name: string;
	tid: number;
	pts: number;
	trb: number;
	ast: number;
	min: number;
};

export type NPGame = {
	gid: number;
	day?: number;
	playoffs: boolean;
	won: { tid: number; pts: number };
	lost: { tid: number; pts: number };
	overtimes: number;
	// Best player on each side, winner first
	stars: NPBoxLine[];
};

export type NPFeat = {
	pid: number;
	name: string;
	tid: number;
	oppTid: number;
	gid: number;
	playoffs: boolean;
	result: "W" | "L" | "T";
	score: string;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
};

export type NPTrade = {
	phase: number;
	tids: [number, number];
	// What each side received
	got: [NPTradeAsset[], NPTradeAsset[]];
	score: number;
};

export type NPTradeAsset =
	| {
			kind: "player";
			pid: number;
			name: string;
			amount?: number;
			exp?: number;
			// Win shares this season for the team that received him
			ws?: number;
	  }
	| {
			kind: "pick";
			season: number | "fantasy" | "expansion";
			round: number;
			originalTid: number;
	  };

export type NPSigning = {
	kind: "freeAgent" | "reSigned";
	phase: number;
	pid: number;
	name: string;
	tid: number;
	amount: number;
	exp: number;
	score: number;
};

export type NPRetiree = {
	pid: number;
	name: string;
	age: number;
	tid: number; // last team
	seasons: number;
	gp: number;
	pts: number; // career totals
	trb: number;
	ast: number;
	ws: number;
	titles: number;
	mvps: number;
	allStars: number;
	hof: boolean;
};

export type NPDraftee = {
	pid: number;
	name: string;
	tid: number;
	round: number;
	pick: number;
	age: number;
	pos: string;
	ovr: number;
	pot: number;
	college?: string;
};

export type NPInjury = {
	pid: number;
	name: string;
	tid: number;
	type: string;
	gamesRemaining: number;
};

export type NPChampion = {
	season: number;
	tid: number;
	runnerUp?: number;
	fmvp?: string;
};

export type NPMvp = {
	season: number;
	pid: number;
	name: string;
	tid: number;
	age?: number;
};

// Regular-season record of one team against another this season
export type NPHeadToHead = {
	a: number;
	b: number;
	aw: number;
	bw: number;
	// Points a scored minus points b scored over all the meetings
	margin: number;
};

export type NPRetroPick = {
	pid: number;
	name: string;
	pick: number;
	round: number;
	draftTid: number;
	tid: number; // current team, or -1 for retired / free agent
	retired: boolean;
	ovr?: number;
	pts: number;
	ws: number;
	seasons: number;
	allStar: number;
};

export type NPThen = {
	pid: number;
	name: string;
	ws: number; // that season
	pts: number; // per game that season
	tid: number; // team then
	// Now
	nowTid: number;
	retired: boolean;
	age?: number;
	ovr?: number;
	nowPpg?: number;
};

export type NPCareerRow = {
	pid: number;
	name: string;
	tid: number; // current team or -1
	active: boolean;
	pts: number; // through last season
	trb: number;
	ast: number;
	ws: number;
	seasons: number;
};

export type NewsFacts = {
	leagueName: string;
	// Stable per league, used to seed text choices
	seedKey: string;
	season: number;
	edition: EditionId;
	numGames: number;
	numRounds: number;
	// Number of games played by the team that has played the most
	gp: number;
	userTid: number;
	confs: { cid: number; name: string }[];
	divs?: { did: number; cid: number; name: string }[];
	teams: NPTeam[];
	players: NPPlayer[];
	awards: NPAward[];
	teamAwards: NPTeamAward[];
	series: NPSeries[][];
	// Index of the playoff round being played (numRounds once the playoffs are over)
	currentRound: number;
	champion?: number;
	runnerUp?: number;
	games: NPGame[];
	feats: NPFeat[];
	trades: NPTrade[];
	signings: NPSigning[];
	retirees: NPRetiree[];
	draft: NPDraftee[];
	injuries: NPInjury[];
	// Most wins by any team in any earlier season, if known
	recordWins?: {
		won: number;
		tid: number;
		season: number;
		region: string;
		name: string;
	};
	// Seasons that exist in the league, for the season picker / back issues
	firstSeason: number;
	// Rules of the playoffs
	playIn?: boolean;
	numPlayoffTeams?: number;
	byConf?: boolean;
	salaryCap?: number;
	luxuryPayroll?: number;
	minPayroll?: number;
	// History, for the back pages
	champions?: NPChampion[];
	mvps?: NPMvp[];
	h2h?: NPHeadToHead[];
	// Teams that met in last season's playoffs, for renewed rivalries
	prevPairs?: [number, number][];
	draftRetro?: { year: number; picks: NPRetroPick[] };
	then?: { year: number; list: NPThen[] };
	careerBoard?: NPCareerRow[];
	// Counts for the transaction wire
	wire?: {
		trades: number;
		freeAgents: number;
		reSigned: number;
		releases: number;
	};
	// This season's draft lottery, in the order before it (worst team first)
	lottery?: NPLotteryRow[];
	// Players released this season
	releases?: NPRelease[];
	// Coaching systems (the coachSystems setting): head coaches' systems and hot seats
	coaching?: NPCoaching;
	// Rumors (the Rumors setting): this season's rumors still in the league's rolling window, newest first
	rumors?: NPRumor[];
	// Scouting Reports setting: the upcoming class as the user's scouts see it
	draftPreview?: NPDraftPreview;
};

export type NPDraftPreview = {
	draftYear: number;
	scout: string;
	rows: {
		pid: number;
		rank: number;
		name: string;
		pos: string;
		age: number;
		school: string;
		overall: string;
		best: string;
		floor: string;
		ceiling: string;
		comp?: string;
		line: string;
		// Overall grade change since the first snapshot (stock up/down)
		move: number;
	}[];
};

export type NPRumor = {
	tids: number[];
	segs: Seg[];
	status: "open" | "confirmed" | "busted";
	outcome?: Seg[];
};

export type NPCoaching = {
	heads: {
		tid: number;
		cid: number;
		name: string;
		offense: string;
		defense: string;
		// 0 safe ... 1 about to be fired
		heat: number;
		// preseason expectation (win%), when known
		expectedPct?: number;
		fit: number;
	}[];
};

export type NPLotteryRow = {
	tid: number;
	// Team whose pick it was
	originalTid: number;
	// Place before the lottery and the pick it gave
	slot: number;
	pick: number;
	chances: number;
};

export type NPRelease = { pid: number; name: string; tid: number };

// Output

// A piece of running text. Strings are plain text, objects are links.
export type Seg =
	| string
	| { pid: number; t: string }
	| { tid: number; t: string; season: number }
	| { gid: number; tid: number; season: number; t: string }
	// A link to another edition of the paper: a team's local edition, or the league edition (team "all")
	| { paper: { team: number | "all"; season: number }; t: string };

export type Block =
	| { type: "p"; segs: Seg[] }
	| { type: "list"; items: Seg[][]; ordered?: boolean }
	| { type: "notebook"; items: { lead: string; segs: Seg[] }[] }
	| {
			type: "table";
			head: string[];
			rows: Seg[][][];
			numCols?: number[];
			hl?: number;
	  }
	| { type: "nums"; items: { value: string; label: string }[] }
	// Quotes are always newsroom colour, invented from the numbers, and the page says so
	| { type: "quote"; text: string; cite?: string; colour?: boolean }
	| { type: "sub"; text: string }
	| { type: "timeline"; items: { label: string; segs: Seg[] }[] }
	| {
			type: "tape";
			a: string;
			b: string;
			rows: { label: string; a: string; b: string }[];
	  }
	| { type: "aside"; segs: Seg[] }
	// Everything after this sits behind a "Continue reading" fold
	| { type: "fold" };

export type Article = {
	id: string;
	// Page type, for tests and rotation
	type?: string;
	size: "lead" | "feature" | "brief";
	// Writing that is the newsroom's own voice rather than reporting (letters, classifieds, rumours)
	colour?: boolean;
	// A "By the numbers" box inside the story
	box?: { title: string; items: { value: string; label: string }[] };
	kicker?: string;
	head: string;
	deck?: Seg[];
	byline?: { name: string; role: string; dateline?: string };
	// Player whose face goes with the story
	photoPid?: number;
	body: Block[];
};

export type Sidebar = {
	id: string;
	title: string;
	body: Block[];
};

export type Section = {
	id: string;
	label: string;
	articles: Article[];
	sidebars: Sidebar[];
};

export type Paper = {
	name: string;
	motto: string;
	season: number;
	edition: EditionId;
	editionLabel: string;
	dateline: string;
	volume: number;
	price: string;
	tid?: number;
	// Headline strip under the masthead
	ticker: Seg[][];
	sections: Section[];
};
