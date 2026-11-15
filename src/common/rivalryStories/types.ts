// Rivalry Stories (League extras, basketball): one compact summary per game, written after every game (and, once, from the
// box scores still stored when the setting is turned on). It is kept after the box score itself is deleted, so a pair's
// rivalry page can read its whole logged history with one indexed read (the rivalryGames store, by "pair").

export type RGPlayer = {
	pid: number;
	name: string;
	tid: number;
	min: number;
	pts: number;
	trb: number;
	ast: number;
	fg: number;
	fga: number;
	// Advanced Tracking Stats (only when that setting was on for the game): shots he was the closest defender on (attempts,
	// makes), and his team's points minus the opponent's while he was on the floor
	dfga?: number;
	dfgm?: number;
	onNet?: number;
};

export type RivalryGame = {
	gid: number;
	season: number;
	day?: number;
	// "a-b" with a < b
	pair: string;
	playoffs: boolean;
	// 0-based playoff round
	round?: number;
	// Box score order: teams[0] is the home team
	home: number;
	away: number;
	hPts: number;
	aPts: number;
	ot: number;
	// Records after the game (wins, losses), for upsets
	hRec?: [number, number];
	aRec?: [number, number];
	// Playoff series after the game: wins of home and away, and the wins it takes
	hSer?: number;
	aSer?: number;
	toWin?: number;
	marquee?: string;
	rivalry?: boolean;
	// Technical fouls and ejections, when the game's play-by-play was recorded
	techs?: number;
	ejections?: number;
	// Clutch plays of the game, plain text
	clutch?: string[];
	// Head coaches (Coaching Staff setting): home, away
	coaches?: [string | null, string | null];
	// Players who played (min > 0)
	players: RGPlayer[];
};

export const pairOf = (x: number, y: number) =>
	x < y ? `${x}-${y}` : `${y}-${x}`;
