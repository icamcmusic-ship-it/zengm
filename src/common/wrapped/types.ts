// Plain-data snapshot of a league that the Wrapped and Storylines engines read. The worker builds it from the database (see worker/views/wrappedData.ts), and tests build it by hand, so everything in here is serializable and sport-neutral in shape (basketball stats).

export type WStat = {
	season: number;
	tid: number;
	gp: number;
	gs: number;
	min: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tov: number;
	tp: number;
	tpa: number;
	fg: number;
	fga: number;
	ft: number;
	fta: number;
	per: number;
	ws: number;
	bpm: number;
	vorp: number;
	// Extra fields the snapshot keeps when the database has them. Missing means "not recorded", never zero.
	orb?: number;
	drb?: number;
	pf?: number;
	// Summed plus-minus over the games played
	pm?: number;
	ortg?: number;
	drtg?: number;
	usgp?: number;
	ows?: number;
	dws?: number;
	dd?: number;
	td?: number;
	// Single-game highs of the season
	ptsMax?: number;
	trbMax?: number;
	astMax?: number;
	stlMax?: number;
	blkMax?: number;
	tpMax?: number;
	// Box plus-minus split, and the jersey number worn (League achievements)
	obpm?: number;
	dbpm?: number;
	jersey?: string;
};

export type WAward = { season: number; type: string };

export type WPlayer = {
	pid: number;
	name: string;
	firstName: string;
	lastName: string;
	bornYear: number;
	bornLoc: string;
	college: string;
	draft: { year: number; round: number; pick: number; tid: number };
	tid: number;
	retiredYear: number;
	diedYear?: number;
	hof: boolean;
	awards: WAward[];
	// Regular season rows, one per team stint per season, oldest first
	stats: WStat[];
	// Playoff rows
	po: WStat[];
	injuries: { season: number; games: number; type: string }[];
	// Overall rating by season
	ovr: Record<number, number>;
	// tid of each transaction (draft, sign, trade, release) with its season, oldest first. phase and eid (the event) when the database has them
	moves: {
		season: number;
		tid: number;
		type: string;
		fromTid?: number;
		phase?: number;
		eid?: number;
	}[];
	relatives: { type: string; pid: number }[];
	// Potential by season, like ovr
	pot?: Record<number, number>;
	// Position by season
	pos?: Record<number, string>;
	// Height rating (0-100) at the end of the career so far
	hgt?: number;
	// What teams actually paid him, in thousands of dollars
	paid?: { season: number; tid: number; amount: number }[];
	// Draft rookie ovr and pot
	draftOvr?: number;
	draftPot?: number;
	jersey?: string;
	// Listed height in inches and weight in pounds (League achievements)
	hgtIn?: number;
	weight?: number;
	// Skill ratings by season, in the order of RATING_SKILLS in wrappedData.ts (League achievements)
	rat?: Record<number, number[]>;
	// Every contract he signed, oldest first (see WContract)
	contracts?: WContract[];
	// Team whose pick he was drafted with, and that pick's dpid (for following traded picks)
	draftOriginalTid?: number;
	draftDpid?: number;
};

// A signed contract. Amounts are per season in thousands of dollars, from `start`.
export type WContract = {
	// "rookie", "reSign", "freeAgent" or "unknown"
	type: string;
	start: number;
	amounts: number[];
	// Season it was signed in and the team that signed it, when known
	signed?: number;
	tid?: number;
	// Set when it ended before running out: released, retired, died
	ended?: { season: number; reason: string; tid?: number };
};

// What one side of a trade received: a player (with his contract then) or a draft pick
export type WTradeAsset =
	| { pid: number; name: string; amount: number; exp: number }
	| {
			dpid: number;
			season: number | string;
			round: number;
			originalTid: number;
	  };

export type WTrade = {
	eid: number;
	season: number;
	// Phase of the season it was made in (PHASE in common/constants)
	phase: number;
	tids: [number, number];
	// got[i]: what tids[i] received
	got: [WTradeAsset[], WTradeAsset[]];
};

// One draft lottery. rows are in the order before the lottery (worst team first), pick is where each one ended up.
export type WLottery = {
	season: number;
	type?: string;
	rows: { tid: number; originalTid: number; chances: number; pick: number }[];
};

// A draft pick that is not used yet, owned by tid
export type WPick = {
	dpid: number;
	tid: number;
	originalTid: number;
	round: number;
	season: number | string;
	pick: number;
};

export type WTeamSeason = {
	tid: number;
	season: number;
	abbrev: string;
	region: string;
	name: string;
	colors: [string, string, string];
	imgURL?: string;
	won: number;
	lost: number;
	tied: number;
	otl: number;
	// -1 missed playoffs, 0 lost first round, ..., numRounds won title
	playoffRoundsWon: number;
	seed?: number;
	gp: number;
	pts: number;
	oppPts: number;
	cid?: number;
	did?: number;
	wonHome?: number;
	lostHome?: number;
	wonAway?: number;
	lostAway?: number;
	wonDiv?: number;
	lostDiv?: number;
	wonConf?: number;
	lostConf?: number;
	// Home games played and total attendance (counts playoff games too)
	gpHome?: number;
	att?: number;
	payroll?: number;
	hype?: number;
	pop?: number;
	// Current winning (positive) or losing (negative) streak at the end of the season
	streak?: number;
	numPlayersTradedAway?: number;
	// League achievements
	tiedHome?: number;
	tiedAway?: number;
	luxuryTax?: number;
};

export type WSeriesTeam = { tid: number; seed: number; won: number };

export type WSeries = {
	season: number;
	rounds: { home: WSeriesTeam; away?: WSeriesTeam; gids?: number[] }[][];
};

export type WBoxLine = {
	pid: number;
	name: string;
	min: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tp: number;
	tpa?: number;
	fg?: number;
	fga?: number;
	ft?: number;
	fta?: number;
	tov?: number;
	orb?: number;
	drb?: number;
	pf?: number;
	pm?: number;
	// 1 if he started
	gs?: number;
};

export type WGame = {
	gid: number;
	season: number;
	day: number;
	playoffs: boolean;
	overtimes: number;
	att?: number;
	teams: [
		{ tid: number; pts: number; players: WBoxLine[]; ptsQtrs?: number[] },
		{ tid: number; pts: number; players: WBoxLine[]; ptsQtrs?: number[] },
	];
};

export type WLeague = {
	startingSeason: number;
	// Current season of the league
	season: number;
	// True if the current season's playoffs are over (awards and the champion are decided)
	currentComplete: boolean;
	userTid: number;
	numPlayoffRounds: Record<number, number>;
	teamSeasons: WTeamSeason[];
	players: WPlayer[];
	series: WSeries[];
	// Box scores, only for the seasons that still have them
	games: WGame[];
	// Conferences and divisions as they are now
	confs?: { cid: number; name: string }[];
	divs?: { did: number; cid: number; name: string }[];
	// Trades with what each side received, oldest first (only the ones whose events are still in the database)
	trades?: WTrade[];
	// Draft lotteries by season
	lottery?: WLottery[];
	// Draft picks not used yet, with who owns them now
	picks?: WPick[];
};

export type WrappedMode = "season" | "team" | "player" | "all";

export type SlideListRow = {
	name: string;
	value: string;
	sub?: string;
	pid?: number;
	tid?: number;
	season?: number;
};

// A multiple-choice question that becomes a quiz slide
export type Quiz = {
	kind: string;
	q: string;
	clue?: string;
	chips?: [string, string][];
	// Shuffled answer choices, exactly one is right
	opts: { name: string; ok: boolean }[];
	answer: { name: string; extra?: string };
};

export type Slide = {
	id: string;
	// Topic group, at most a couple of slides per group make the deck
	group: string;
	// Broad theme for variety (scoring, team, awards, history, games, people)
	theme: string;
	// Interestingness 0..1
	score: number;
	core?: boolean;
	kicker: string;
	// Headline variants, one is chosen with the deck's seed
	heads: string[];
	head?: string;
	hero?: { text: string; unit?: string };
	lines: string[];
	chips?: [string, string][];
	list?: SlideListRow[];
	pid?: number;
	tid?: number;
	season?: number;
	// Facts this slide states, so no two slides say the same thing
	facts?: string[];
	note?: string;
	// Who the slide is about, shown when the headline and lines don't name them
	who?: string;
	// Set on quiz slides: the question and its choices
	quiz?: Quiz;
	// True when the slide gives the champion away, so "no spoilers" holds it back
	spoiler?: boolean;
};

export type Deck = {
	mode: WrappedMode;
	season: number;
	title: string;
	subtitle: string;
	soFar: boolean;
	slides: Slide[];
};
