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
	// tid of each transaction (draft, sign, trade, release) with its season, oldest first
	moves: { season: number; tid: number; type: string; fromTid?: number }[];
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
};

export type WSeriesTeam = { tid: number; seed: number; won: number };

export type WSeries = {
	season: number;
	rounds: { home: WSeriesTeam; away?: WSeriesTeam }[][];
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
