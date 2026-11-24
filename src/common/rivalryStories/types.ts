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
	// Players who played (min > 0). In stored records (compact.ts) these are tuples without names, looked up when read.
	players: RGPlayer[];
	// An old season's record, pruned to the top scorers of each side (compact.ts)
	cut?: 1;
};

export const pairOf = (x: number, y: number) =>
	x < y ? `${x}-${y}` : `${y}-${x}`;

// The rivalry score's box score inputs of one season (rivalrySeasons store), by pair: [close games (3 points or fewer, or
// overtime), 1 if a playoff game had a 25+ point scorer on both sides]
export type RivalrySeason = {
	season: number;
	pairs: Record<string, [number, 0 | 1]>;
	// Every pair's highest single-game points by a player that season (the newspaper's "new high for the pair" bar, so it
	// doesn't read every past game of every rival pair). Only on rows started after this was added: a row without it is
	// read from the games instead.
	highs?: Record<string, number>;
	// The season's games in the log were pruned to their top scorers (compact.ts), so they are not read again for that
	cut?: 1;
};

export const isCloseGame = (gm: Pick<RivalryGame, "hPts" | "aPts" | "ot">) =>
	gm.ot > 0 || Math.abs(gm.hPts - gm.aPts) <= 3;

export const isStarDuel = (
	gm: Pick<RivalryGame, "playoffs" | "players" | "home" | "away">,
) => {
	if (!gm.playoffs) {
		return false;
	}
	const top = (tid: number) =>
		Math.max(0, ...gm.players.filter((p) => p.tid === tid).map((p) => p.pts));
	return top(gm.home) >= 25 && top(gm.away) >= 25;
};

// Adds games to the season rows (mutates and returns the rows that changed)
export const addToRivalrySeasons = (
	rows: Map<number, RivalrySeason>,
	games: RivalryGame[],
) => {
	const changed = new Set<number>();
	for (const gm of games) {
		let row = rows.get(gm.season);
		if (!row) {
			row = { season: gm.season, pairs: {}, highs: {} };
			rows.set(gm.season, row);
		}
		if (row.highs) {
			const high = Math.max(0, ...gm.players.map((p) => p.pts));
			if (high > (row.highs[gm.pair] ?? -1)) {
				row.highs[gm.pair] = high;
				changed.add(gm.season);
			}
		}
		const close = isCloseGame(gm);
		const duel = isStarDuel(gm);
		if (!close && !duel) {
			continue;
		}
		const e = row.pairs[gm.pair] ?? [0, 0];
		row.pairs[gm.pair] = [e[0] + (close ? 1 : 0), duel ? 1 : e[1]];
		changed.add(gm.season);
	}
	return [...changed].map((season) => rows.get(season)!);
};
