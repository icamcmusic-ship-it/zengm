// Gathers the inputs of the rivalry score (common/rivalries) from the league: every playoff series, the regular season
// head-to-head records, the stored box scores (close games, star duels) and the current divisions.
import {
	rivalryScore,
	type RivalInput,
	type RivalryScore,
	type RivalSeries,
} from "../../common/rivalries/index.ts";
import type { Game, PlayoffSeries } from "../../common/types.ts";
import { idb } from "../db/index.ts";
import g from "./g.ts";
import helpers from "./helpers.ts";

export type RivalPair = {
	key: string;
	a: number;
	b: number;
	input: RivalInput;
	score: RivalryScore;
	seriesA: number;
	seriesB: number;
	finals: number;
	rsA: number;
	rsB: number;
	lastMet: number | null;
};

export const pairKey = (x: number, y: number) =>
	x < y ? `${x}-${y}` : `${y}-${x}`;

// Every finished playoff series (not play-ins), oldest first
export const finishedSeries = (all: PlayoffSeries[]) => {
	const out: RivalSeries[] = [];
	for (const ps of [...all].sort((x, y) => x.season - y.season)) {
		const numRounds = g.get("numGamesPlayoffSeries", ps.season).length;
		ps.series.forEach((round, ri) => {
			const numToWin = helpers.numGamesToWinRound(ri, ps.season);
			for (const m of round) {
				if (!m.away) {
					continue;
				}
				const hw = m.home.won >= numToWin;
				const aw = m.away.won >= numToWin;
				if (!hw && !aw) {
					continue;
				}
				const w = hw ? m.home : m.away;
				const l = hw ? m.away : m.home;
				out.push({
					season: ps.season,
					round: ri,
					numRounds: Math.max(numRounds, ps.series.length),
					winner: w.tid,
					loser: l.tid,
					wWon: w.won,
					wLost: l.won,
					// Seeds from different conferences are not comparable (no upset)
					...(w.cid === l.cid ? { wSeed: w.seed, lSeed: l.seed } : undefined),
				});
			}
		});
	}
	return out;
};

const isClose = (game: Game) =>
	game.overtimes > 0 || Math.abs(game.teams[0].pts - game.teams[1].pts) <= 3;

// Top scorer per game of a team in a game
const topPts = (t: Game["teams"][number]) =>
	Math.max(0, ...((t.players ?? []) as { pts: number }[]).map((p) => p.pts));

export const loadRivalries = async (
	season: number = g.get("season"),
	// storedGames false: skip the stored box scores of past seasons (their close games and star duels), for callers that can't afford to
	// read them all (the play-by-play, see pbpRivalry.ts)
	opts: { storedGames?: boolean } = {},
): Promise<RivalPair[]> => {
	const [playoffSeries, headToHeads, teams] = await Promise.all([
		idb.merged.playoffSeries.getAll(),
		idb.merged.headToHeads.getAll(),
		idb.cache.teams.getAll(),
	]);
	const series = finishedSeries(playoffSeries).filter(
		(s) => s.season <= season,
	);

	const map = new Map<string, RivalPair>();
	const get = (x: number, y: number) => {
		const key = pairKey(x, y);
		let e = map.get(key);
		if (!e) {
			const a = Math.min(x, y);
			const b = Math.max(x, y);
			const ta = teams.find((t) => t.tid === a);
			const tb = teams.find((t) => t.tid === b);
			e = {
				key,
				a,
				b,
				input: {
					a,
					b,
					season,
					series: [],
					rs: [],
					closeGames: [],
					starDuels: [],
					sameDiv: !!ta && !!tb && ta.did === tb.did && ta.cid === tb.cid,
					sameConf: !!ta && !!tb && ta.cid === tb.cid,
				},
				score: { score: 0, parts: {} as any, tier: "None" },
				seriesA: 0,
				seriesB: 0,
				finals: 0,
				rsA: 0,
				rsB: 0,
				lastMet: null,
			};
			map.set(key, e);
		}
		return e;
	};

	for (const s of series) {
		if (s.winner === s.loser) {
			continue;
		}
		const e = get(s.winner, s.loser);
		e.input.series.push(s);
		if (s.winner === e.a) {
			e.seriesA += 1;
		} else {
			e.seriesB += 1;
		}
		if (s.round === s.numRounds - 1) {
			e.finals += 1;
		}
		e.lastMet = s.season;
	}

	for (const h of headToHeads) {
		if (h.season > season) {
			continue;
		}
		for (const [t0s, row] of Object.entries(h.regularSeason)) {
			for (const [t1s, r] of Object.entries(row)) {
				const t0 = Number(t0s);
				const t1 = Number(t1s);
				if (t0 === t1 || t0 < 0 || t1 < 0) {
					continue;
				}
				const e = get(t0, t1);
				const w0 = r.won + r.otw;
				const w1 = r.lost + r.otl;
				const aW = t0 === e.a ? w0 : w1;
				const bW = t0 === e.a ? w1 : w0;
				e.input.rs.push({ season: h.season, aW, bW, tied: r.tied });
				e.rsA += aW;
				e.rsB += bW;
			}
		}
	}

	// Stored box scores: close games, and playoff meetings where both sides had a 25+ point scorer in a game. Current
	// season games are in the cache and maybe not yet in the database, so each gid counts once.
	const duelSeasons = new Map<string, Set<number>>();
	const seen = new Set<number>();
	const addGame = (game: Game) => {
		if (seen.has(game.gid) || game.season > season) {
			return;
		}
		seen.add(game.gid);
		const t0 = game.teams[0].tid;
		const t1 = game.teams[1].tid;
		if (t0 < 0 || t1 < 0 || t0 === t1) {
			return;
		}
		const key = pairKey(t0, t1);
		if (isClose(game)) {
			get(t0, t1).input.closeGames!.push({ season: game.season });
		}
		if (
			game.playoffs &&
			topPts(game.teams[0]) >= 25 &&
			topPts(game.teams[1]) >= 25
		) {
			let set = duelSeasons.get(key);
			if (!set) {
				set = new Set();
				duelSeasons.set(key, set);
			}
			set.add(game.season);
		}
	};
	for (const game of await idb.cache.games.getAll()) {
		addGame(game);
	}
	if (opts.storedGames !== false) {
		for await (const cursor of idb.league
			.transaction("games")
			.store.iterate()) {
			addGame(cursor.value);
		}
	}
	for (const [key, set] of duelSeasons) {
		const e = map.get(key);
		if (e) {
			e.input.starDuels = [...set].sort((x, y) => x - y);
		}
	}

	const out = [...map.values()];
	for (const e of out) {
		e.score = rivalryScore(e.input);
	}
	out.sort(
		(x, y) => y.score.score - x.score.score || x.key.localeCompare(y.key),
	);
	return out;
};
