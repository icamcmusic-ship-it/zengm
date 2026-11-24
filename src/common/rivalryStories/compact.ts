// Rivalry Stories: how a game is stored in the rivalryGames store. Player names are not stored (they are looked up when the
// log is read), each player line is a tuple, and seasons older than RIVALRY_LOG_FULL_SEASONS keep only the game itself and
// its top scorers (see pruneStoredRivalryGame). Records written before this (full player objects with names) are still read.
import type { RGPlayer, RivalryGame } from "./types.ts";

// [pid, tid, min, pts, trb, ast, fg, fga] and, with Advanced Tracking Stats, [dfga, dfgm, onNet] after them
export type RGLine = number[];

export type StoredRivalryGame = Omit<RivalryGame, "players"> & {
	// Compact player lines (records written since the log was slimmed)
	pl?: RGLine[];
	// Old records: full player rows, names included
	players?: RGPlayer[];
};

// Seasons whose games keep every player line. Older seasons keep the game and the top scorers of each side.
export const RIVALRY_LOG_FULL_SEASONS = 10;
export const RIVALRY_LOG_TOP_PLAYERS = 3;

const lineOf = (p: RGPlayer): RGLine => {
	const line = [p.pid, p.tid, p.min, p.pts, p.trb, p.ast, p.fg, p.fga];
	if (p.dfga !== undefined || p.dfgm !== undefined || p.onNet !== undefined) {
		line.push(p.dfga ?? 0, p.dfgm ?? 0, p.onNet ?? 0);
	}
	return line;
};

const playerOf = (
	line: RGLine,
	name: (pid: number) => string | undefined,
): RGPlayer => {
	const p: RGPlayer = {
		pid: line[0]!,
		name: name(line[0]!) ?? "Unknown player",
		tid: line[1]!,
		min: line[2]!,
		pts: line[3]!,
		trb: line[4]!,
		ast: line[5]!,
		fg: line[6]!,
		fga: line[7]!,
	};
	if (line.length > 8) {
		p.dfga = line[8]!;
		p.dfgm = line[9]!;
		p.onNet = line[10]!;
	}
	return p;
};

export const packRivalryGame = (gm: RivalryGame): StoredRivalryGame => {
	const { players, ...rest } = gm;
	return { ...rest, pl: players.map(lineOf) };
};

// The pids a stored record's players need names for (none for old records, which have them)
export const storedPids = (rec: StoredRivalryGame) =>
	rec.pl ? rec.pl.map((line) => line[0]!) : [];

export const unpackRivalryGame = (
	rec: StoredRivalryGame,
	name: (pid: number) => string | undefined,
): RivalryGame => {
	const { pl, players, ...rest } = rec;
	return {
		...rest,
		players: pl
			? pl.map((line) => playerOf(line, name))
			: (players ?? []).map((p) => ({ ...p })),
	};
};

// An old season's record: the game, and the top scorers of each side (enough for the notes, the season highs, star duels and
// the top duels). Returns undefined when there is nothing to cut (already cut). The season rows (rivalrySeasons) are not
// touched, so the rivalry score is the same.
export const pruneStoredRivalryGame = (
	rec: StoredRivalryGame,
): StoredRivalryGame | undefined => {
	if (rec.cut) {
		return undefined;
	}
	const lines = rec.pl ?? (rec.players ?? []).map(lineOf);
	const keep: RGLine[] = [];
	for (const tid of [rec.home, rec.away]) {
		keep.push(
			...lines
				.filter((line) => line[1] === tid)
				.sort((x, y) => y[3]! - x[3]! || y[2]! - x[2]!)
				.slice(0, RIVALRY_LOG_TOP_PLAYERS)
				// Tracking stats are per game sums (defense, on/off): partial lines would skew them
				.map((line) => line.slice(0, 8)),
		);
	}
	const { players: _players, pl: _pl, ...rest } = rec;
	return { ...rest, pl: keep, cut: 1 };
};
