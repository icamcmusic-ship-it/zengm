import type { Game } from "../../common/types.ts";
import { idb } from "../db/index.ts";
import { changeLog } from "../db/changeLog.ts";
import g from "./g.ts";
import { loadPage, savePage } from "./pagePersist.ts";

// The stored box scores of past seasons reduced to what Home Court, Rivalries and Team History's rivals card read from
// them. Reading every box score of a season is slow (each one is a big object), so a past season's are read once and
// kept: for the session here, and across sessions in pagePersist.ts. The current season's box scores are all in the
// cache, so callers read those as they are.

export type GameSumTeam = { tid: number; pts: number; top: number };
export type GameSum = {
	gid: number;
	season: number;
	playoffs: boolean;
	neutralSite: boolean;
	overtimes: number;
	// how many teams the box score has (always 2, but the pages check)
	n: number;
	teams: GameSumTeam[];
};

const VERSION = 1;

// Top scorer of a team in a game
const topPts = (t: Game["teams"][number]) =>
	Math.max(0, ...((t.players ?? []) as { pts: number }[]).map((p) => p.pts));

export const gameSum = (gm: Game): GameSum => ({
	gid: gm.gid,
	season: gm.season,
	playoffs: !!gm.playoffs,
	neutralSite: !!gm.neutralSite,
	overtimes: gm.overtimes,
	n: gm.teams.length,
	teams: gm.teams.map((t) => ({ tid: t.tid, pts: t.pts, top: topPts(t) })),
});

let memo:
	| {
			lid: number;
			epoch: number;
			seasons: Map<number, { seq: number; count: number; sums: GameSum[] }>;
	  }
	| undefined;

// Seasons with box scores in the database, oldest first
export const storedGameSeasons = async () => {
	const index = idb.league.transaction("games").store.index("season");
	const seasons: number[] = [];
	let cursor = await index.openKeyCursor();
	while (cursor) {
		const season = cursor.key as number;
		seasons.push(season);
		cursor = await cursor.continue(season + 1);
	}
	return seasons;
};

// The reduced box scores of a season, as stored in the database (in the order the database has them: by gid)
export const seasonGameSums = async (season: number): Promise<GameSum[]> => {
	const lid = g.get("lid");
	if (!memo || memo.lid !== lid || memo.epoch !== changeLog.epoch) {
		memo = { lid, epoch: changeLog.epoch, seasons: new Map() };
	}
	const m = memo;
	const count = await idb.league
		.transaction("games")
		.store.index("season")
		.count(season);
	const seq = changeLog.season("games", season);
	const hit = m.seasons.get(season);
	if (hit && hit.count === count && hit.seq === seq) {
		return hit.sums;
	}
	// A season that is over can be kept across sessions (the change log forgets it when its box scores are written to)
	const past = season < g.get("season");
	const meta = { v: VERSION, count, sig: "" };
	let sums = past
		? await loadPage<GameSum[]>(lid, "sums", season, meta)
		: undefined;
	if (!sums) {
		const games = await idb.league
			.transaction("games")
			.store.index("season")
			.getAll(season);
		sums = games.map(gameSum);
		if (past && sums.length === count) {
			void savePage(lid, "sums", season, meta, sums);
		}
	}
	if (memo === m) {
		m.seasons.set(season, { seq, count, sums });
	}
	return sums;
};

// Background warm-up: a past season's reduced box scores, unless they're kept already
export const warmGameSums = async (season: number) => {
	await seasonGameSums(season);
};
