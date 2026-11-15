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
import { loadPage, savePage } from "./pagePersist.ts";

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
			const decoded = decodePlayByPlay(pbp);
			const init = storedInitEvent(
				decoded.players,
				gm.teams,
				decoded.rivalry,
				decoded.game,
			);
			const { events } = decoded;
			return playsFromPbp(game, init, events);
		} catch {
			// Unreadable play-by-play: fall back to the clutch plays
		}
	}
	return playsFromClutch(game);
};

// Bump when what seasonBest returns for the same games changes (persisted results of past seasons, pagePersist.ts)
const PERSIST_VERSION = 1;

// What a season's result depends on besides its box scores: team names (in the plays) and the league's gender
const persistSig = () => {
	const info = g.get("teamInfoCache");
	return JSON.stringify([
		female(),
		info.map((t) => (t ? [t.abbrev, t.region, t.name] : null)),
	]);
};

// A game's plays, kept for the session: wording a game's play-by-play is most of what a season costs, and a stored box
// score doesn't change (the key has the team names, which the plays have in them)
const playsMemo = new Map<string, TopPlay[]>();
const playsOfGameMemo = (gm: Game, sig: string) => {
	const key = `${g.get("lid")}|${gm.gid}|${sig}`;
	let plays = playsMemo.get(key);
	if (!plays) {
		plays = playsOfGame(gm);
		if (playsMemo.size >= 2000) {
			playsMemo.clear();
		}
		playsMemo.set(key, plays);
	}
	return plays;
};

const computeSeasonBest = async (
	season: number,
	all: Game[],
	yieldEvery?: number,
): Promise<SeasonBest> => {
	const hype = await hypeForGids(
		all.map((gm) => gm.gid),
		all,
	);
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
	let last = performance.now();
	const sig = persistSig();
	for (const gm of pbpGames) {
		plays.push(...playsOfGameMemo(gm, sig));
		// In the background, let the worker answer other messages now and then
		if (yieldEvery !== undefined && performance.now() - last > yieldEvery) {
			await new Promise((resolve) => setTimeout(resolve, 0));
			last = performance.now();
		}
	}

	return {
		season,
		games: rated.slice(0, GAMES_PER_SEASON),
		plays: pickTopPlays(plays, { limit: PLAYS_PER_SEASON }),
		numGames: all.length,
		numWithPbp: all.filter((gm) => typeof (gm as any).pbp === "string").length,
	};
};

const remember = (key: string, out: SeasonBest) => {
	if (cache.size > 30) {
		cache.delete(cache.keys().next().value!);
	}
	cache.set(key, out);
};

// A past season (all its box scores in the database): kept for the session, and across sessions (pagePersist.ts), keyed
// by how many box scores it has. Its result only changes if they do (written to, which forgets the persisted copy, or
// deleted, which changes the count) or a team is renamed.
const pastSeasonBest = async (
	season: number,
	yieldEvery?: number,
): Promise<SeasonBest> => {
	const lid = g.get("lid");
	const count = await idb.league
		.transaction("games")
		.store.index("season")
		.count(season);
	const sig = persistSig();
	const key = `${lid}|${season}|past|${count}|${sig}`;
	const hit = cache.get(key);
	if (hit) {
		return hit;
	}
	// The background warm-up and the page can ask at the same time
	const pending = inflight.get(key);
	if (pending) {
		return pending;
	}
	const p = pastSeasonBestUncached(season, yieldEvery, lid, count, sig, key);
	inflight.set(key, p);
	try {
		return await p;
	} finally {
		inflight.delete(key);
	}
};

const inflight = new Map<string, Promise<SeasonBest>>();

const pastSeasonBestUncached = async (
	season: number,
	yieldEvery: number | undefined,
	lid: number,
	count: number,
	sig: string,
	key: string,
): Promise<SeasonBest> => {
	const meta = { v: PERSIST_VERSION, count, sig };
	const persisted = await loadPage<SeasonBest>(lid, "best", season, meta);
	if (persisted) {
		remember(key, persisted);
		return persisted;
	}
	const stored = await idb.league
		.transaction("games")
		.store.index("season")
		.getAll(season);
	const out = await computeSeasonBest(
		season,
		stored.filter(isRegularGame),
		yieldEvery,
	);
	if (stored.length === count && g.get("lid") === lid) {
		// What the page gets is what a later session reads back (JSON, not a structured clone, which would keep what JSON drops)
		// eslint-disable-next-line unicorn/prefer-structured-clone
		const json = JSON.parse(JSON.stringify(out)) as SeasonBest;
		void savePage(lid, "best", season, meta, json);
		remember(key, json);
		return json;
	}
	return out;
};

export const seasonBest = async (
	season: number,
	yieldEvery?: number,
): Promise<SeasonBest> => {
	if (season < g.get("season")) {
		return pastSeasonBest(season, yieldEvery);
	}
	const all = (await idb.merged.games.getAll({ season })).filter(isRegularGame);
	const key = `${g.get("lid")}|${season}|${all.length}`;
	const hit = cache.get(key);
	if (hit) {
		return hit;
	}
	const out = await computeSeasonBest(season, all, yieldEvery);
	remember(key, out);
	return out;
};

// Background warm-up (pageWarm.ts): a season's result (a past season's is kept across sessions; the current season's for
// the session, and its games' plays, so that after the next games only theirs are worded)
export const warmSeasonBest = async (season: number) => {
	await seasonBest(season, 30);
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
