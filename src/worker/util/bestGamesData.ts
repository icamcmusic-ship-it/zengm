// Best games and top plays of a season or of all time (League extras: Best Games & Top Plays, basketball). Games are
// ranked by the hype engine's post-game rating (common/hype, the same rating as the box score's "lived up to it"
// panel); plays come from stored play-by-play when a game has it, else from its clutch plays.
import type { HypeLite } from "../../common/hype/index.ts";
import {
	pickTopPlays,
	playsFromClutch,
	playsFromPbp,
	type GameForPlays,
	type TopPlay,
} from "../../common/bestPlays/topPlays.ts";
import {
	decodePlayByPlay,
	storedInitEvent,
} from "../../common/pbpFlavor/store.ts";
import type { Game } from "../../common/types.ts";
import { idb } from "../db/index.ts";
import { hypeForGids } from "./hypeData.ts";
import { g } from "./index.ts";

export type BestGame = HypeLite & { rating: number };

export type SeasonBest = {
	season: number;
	games: BestGame[];
	plays: TopPlay[];
	numGames: number;
	numWithPbp: number;
};

const GAMES_PER_SEASON = 25;
const PLAYS_PER_SEASON = 15;
// Games whose play-by-play is read for plays: the best ones plus every game with a clutch play, at most this many
const MAX_PBP_GAMES = 120;

const cache = new Map<string, SeasonBest>();

const isRegularGame = (gm: Game) =>
	gm.teams[0].tid >= 0 && gm.teams[1].tid >= 0 && gm.won && gm.lost;

const female = () => {
	try {
		return g.get("gender") === "female";
	} catch {
		return false;
	}
};

const gameForPlays = (gm: Game): GameForPlays => {
	const info = g.get("teamInfoCache");
	const team = (i: 0 | 1) => {
		const t = gm.teams[i];
		const ti = info[t.tid];
		return {
			name: ti?.name ?? "Team",
			abbrev: ti?.abbrev ?? "",
			pts: t.pts,
			players: t.players.map((p: any) => ({
				pid: p.pid,
				name: p.name,
				pos: p.pos,
			})),
		};
	};
	return {
		gid: gm.gid,
		season: gm.season,
		numPeriods: (gm as any).numPeriods ?? g.get("numPeriods"),
		quarterLength: (gm as any).quarterLength ?? g.get("quarterLength"),
		female: female(),
		playoffs: !!gm.playoffs,
		teams: [team(0), team(1)],
		clutchPlays: gm.clutchPlays,
	};
};

export const playsOfGame = (gm: Game): TopPlay[] =>
	playsOfGameRaw(gm).map((p) => ({
		...p,
		tids: [gm.teams[0].tid, gm.teams[1].tid],
	}));

const playsOfGameRaw = (gm: Game): TopPlay[] => {
	const game = gameForPlays(gm);
	const pbp = (gm as any).pbp;
	if (typeof pbp === "string" && pbp.length > 0) {
		try {
			const { players, events, rivalry } = decodePlayByPlay(pbp);
			const init = storedInitEvent(players, gm.teams, rivalry);
			return playsFromPbp(game, init, events);
		} catch {
			// Unreadable play-by-play: fall back to the clutch plays
		}
	}
	return playsFromClutch(game);
};

export const seasonBest = async (season: number): Promise<SeasonBest> => {
	const all = (await idb.merged.games.getAll({ season })).filter(isRegularGame);
	const key = `${g.get("lid")}|${season}|${all.length}`;
	const hit = cache.get(key);
	if (hit) {
		return hit;
	}

	const hype = await hypeForGids(all.map((gm) => gm.gid));
	const rated = Object.values(hype)
		.filter((h) => h.post)
		.map((h) => ({ ...h, rating: h.post!.score }))
		.sort((a, b) => b.rating - a.rating || b.watch - a.watch || a.gid - b.gid);

	const top = new Set(rated.slice(0, 40).map((h) => h.gid));
	const pbpGames = all
		.filter((gm) => top.has(gm.gid) || (gm.clutchPlays?.length ?? 0) > 0)
		.sort(
			(a, b) =>
				(hype[b.gid]?.post?.score ?? 0) - (hype[a.gid]?.post?.score ?? 0),
		)
		.slice(0, MAX_PBP_GAMES);
	const plays: TopPlay[] = [];
	for (const gm of pbpGames) {
		plays.push(...playsOfGame(gm));
	}

	const out: SeasonBest = {
		season,
		games: rated.slice(0, GAMES_PER_SEASON),
		plays: pickTopPlays(plays, { limit: PLAYS_PER_SEASON }),
		numGames: all.length,
		numWithPbp: all.filter((gm) => typeof (gm as any).pbp === "string").length,
	};
	if (cache.size > 30) {
		cache.delete(cache.keys().next().value!);
	}
	cache.set(key, out);
	return out;
};

// All seasons with stored games, best of each merged
export const allTimeBest = async (): Promise<SeasonBest> => {
	const seasons: number[] = [];
	for (let s = g.get("startingSeason"); s <= g.get("season"); s++) {
		seasons.push(s);
	}
	const games: BestGame[] = [];
	const plays: TopPlay[] = [];
	let numGames = 0;
	let numWithPbp = 0;
	for (const s of seasons) {
		const b = await seasonBest(s);
		games.push(...b.games);
		plays.push(...b.plays);
		numGames += b.numGames;
		numWithPbp += b.numWithPbp;
	}
	games.sort((a, b) => b.rating - a.rating || b.watch - a.watch);
	return {
		season: -1,
		games: games.slice(0, GAMES_PER_SEASON),
		plays: pickTopPlays(plays, { limit: PLAYS_PER_SEASON }),
		numGames,
		numWithPbp,
	};
};
