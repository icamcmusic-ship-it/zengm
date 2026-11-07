// Input (facts gathered by the worker) and output (a laid-out paper) of the newspaper engine. Everything here is plain data, so it can be built in the worker, sent to the UI, and tested without a database.

export type EditionId = "preseason" | "midseason" | "playoffs" | "final";

export type NPRecord = {
	won: number;
	lost: number;
	tied?: number;
	otl?: number;
};

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
	| { kind: "player"; pid: number; name: string; amount?: number; exp?: number }
	| { kind: "pick"; season: number | "fantasy" | "expansion"; round: number; originalTid: number };

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
	teams: NPTeam[];
	players: NPPlayer[];
	awards: NPAward[];
	teamAwards: NPTeamAward[];
	series: NPSeries[][];
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
	recordWins?: { won: number; tid: number; season: number; region: string; name: string };
	// Seasons that exist in the league, for the season picker / back issues
	firstSeason: number;
};

// Output

// A piece of running text. Strings are plain text, objects are links.
export type Seg =
	| string
	| { pid: number; t: string }
	| { tid: number; t: string; season: number }
	| { gid: number; tid: number; season: number; t: string };

export type Block =
	| { type: "p"; segs: Seg[] }
	| { type: "list"; items: Seg[][]; ordered?: boolean }
	| { type: "notebook"; items: { lead: string; segs: Seg[] }[] }
	| { type: "table"; head: string[]; rows: Seg[][][]; numCols?: number[]; hl?: number }
	| { type: "nums"; items: { value: string; label: string }[] }
	| { type: "quote"; text: string; cite?: string }
	| { type: "sub"; text: string };

export type Article = {
	id: string;
	size: "lead" | "feature" | "brief";
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
