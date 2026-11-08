// Reads the league into the snapshot (HRaw) the game hype engine works on, and runs it for upcoming and finished games. Heavy parts (the records baseline over every player ever, the season's box scores) are cached and built lazily.
import { PHASE } from "../../common/constants.ts";
import {
	chaseBoard,
	hypeForGame,
	storedGame,
	targetOfGame,
	toLite,
	withActiveCareers,
	buildRecords,
	type ChaseRow,
	type HGame,
	type HPlayerRaw,
	type HRaw,
	type HRecords,
	type HRow,
	type HSeries,
	type HTeam,
	type HypeLite,
	type Target,
} from "../../common/hype/index.ts";
import { clutchText } from "../../common/hype/util.ts";
import type { Game, Player } from "../../common/types.ts";
import { player, season as seasonCore, team } from "../core/index.ts";
import { idb } from "../db/index.ts";
import { getMaxPlayoffSeed } from "../views/standings.ts";
import { g, helpers } from "./index.ts";

const finite = (x: unknown): number | undefined =>
	typeof x === "number" && Number.isFinite(x) ? x : undefined;

const toRow = (s: any): HRow => {
	const orb = finite(s.orb);
	const drb = finite(s.drb);
	return {
		season: s.season,
		tid: s.tid,
		gp: finite(s.gp) ?? 0,
		min: finite(s.min),
		pts: finite(s.pts),
		trb: orb !== undefined && drb !== undefined ? orb + drb : finite(s.trb),
		ast: finite(s.ast),
		stl: finite(s.stl),
		blk: finite(s.blk),
		tp: finite(s.tp),
	};
};

const toRaw = (
	p: Player,
	released: Map<number, { season: number; tid: number }[]>,
): HPlayerRaw => ({
	pid: p.pid,
	name: `${p.firstName} ${p.lastName}`.trim(),
	tid: p.tid,
	draft: { year: p.draft.year, round: p.draft.round, pick: p.draft.pick },
	rows: p.stats.filter((s) => !s.playoffs).map(toRow),
	ovrBySeason: Object.fromEntries(
		p.ratings.map((r) => [r.season, player.fuzzRating(r.ovr, r.fuzz)]),
	),
	allStar: p.awards.filter((a) => a.type === "All-Star").map((a) => a.season),
	moves: (p.transactions ?? []).map((t) => ({
		season: t.season,
		phase: t.phase,
		tid: t.tid,
		type: t.type,
		fromTid: "fromTid" in t ? t.fromTid : undefined,
	})),
	released: released.get(p.pid) ?? [],
});

const releases = async () => {
	const out = new Map<number, { season: number; tid: number }[]>();
	for (const e of await idb.cache.events.getAll()) {
		if (e.type !== "release" || !e.pids || !e.tids) {
			continue;
		}
		for (const pid of e.pids) {
			for (const tid of e.tids) {
				let arr = out.get(pid);
				if (!arr) {
					out.set(pid, (arr = []));
				}
				arr.push({ season: e.season, tid });
			}
		}
	}
	return out;
};

const toHGame = (gm: Game, playInGids: Set<number>): HGame => {
	const mapTeam = (t: Game["teams"][number]): HGame["teams"][number] => ({
		tid: t.tid,
		pts: t.pts ?? 0,
		ptsQtrs: Array.isArray(t.ptsQtrs) ? t.ptsQtrs : undefined,
		ovr: t.ovr,
		won: t.won,
		lost: t.lost,
		tied: t.tied,
		otl: t.otl,
		players: t.players.map((p: any) => ({
			pid: p.pid,
			name: p.name,
			inj: p.injury?.gamesRemaining > 0 && !p.injury?.newThisGame,
			min: finite(p.min) ?? 0,
			pts: finite(p.pts) ?? 0,
			trb: (finite(p.orb) ?? 0) + (finite(p.drb) ?? 0),
			ast: finite(p.ast) ?? 0,
			stl: finite(p.stl) ?? 0,
			blk: finite(p.blk) ?? 0,
			tp: finite(p.tp) ?? 0,
		})),
	});
	return {
		gid: gm.gid,
		season: gm.season,
		day: gm.day ?? 0,
		playoffs: !!gm.playoffs,
		playIn: playInGids.has(gm.gid),
		overtimes: gm.overtimes ?? 0,
		teams: [mapTeam(gm.teams[0]), mapTeam(gm.teams[1])],
		clutch: (gm.clutchPlays ?? []).map(clutchText),
	};
};

const loadSeries = async (): Promise<{
	series: HSeries[];
	playInGids: Set<number>;
}> => {
	const all = await idb.merged.playoffSeries.getAll();
	const series: HSeries[] = [];
	const playInGids = new Set<number>();
	for (const ps of all) {
		ps.series.forEach((round, r) => {
			for (const m of round) {
				if (!m.away) {
					continue;
				}
				series.push({
					season: ps.season,
					round: r,
					numRounds: ps.series.length,
					numToWin: helpers.numGamesToWinRound(r, ps.season),
					home: { tid: m.home.tid, seed: m.home.seed, won: m.home.won },
					away: { tid: m.away.tid, seed: m.away.seed, won: m.away.won },
					gids: m.gids ?? [],
				});
			}
		});
		for (const m of (ps.playIns ?? []).flat()) {
			for (const gid of m.gids ?? []) {
				playInGids.add(gid);
			}
			series.push({
				season: ps.season,
				round: -1,
				numRounds: ps.series.length,
				numToWin: 1,
				playIn: true,
				home: { tid: m.home.tid, seed: m.home.seed, won: m.home.won },
				away: { tid: m.away.tid, seed: m.away.seed, won: m.away.won },
				gids: m.gids ?? [],
			});
		}
	}
	return { series, playInGids };
};

type Base = Omit<HRaw, "players" | "records" | "out"> & {
	records: HRecords | null;
};

const baseCache = new Map<string, Promise<Base>>();
const recordsCache = new Map<string, Promise<HRecords>>();

const recordsBaseline = (season: number): Promise<HRecords> => {
	const key = `${g.get("lid")}|${season}`;
	let hit = recordsCache.get(key);
	if (!hit) {
		hit = (async () => {
			const rel = new Map<number, { season: number; tid: number }[]>();
			const players = await idb.merged.players.getAll(
				{ activeAndRetired: true },
				{ map: (p) => toRaw(p, rel) },
			);
			return buildRecords(players, season);
		})();
		recordsCache.set(key, hit);
		// keep a couple of leagues' worth
		if (recordsCache.size > 4) {
			recordsCache.delete(recordsCache.keys().next().value!);
		}
	}
	return hit;
};

// Ovr that makes a player a star this season, from the players on rosters now
const starCutNow = async (season: number) => {
	const players = await idb.cache.players.getAll();
	const played: number[] = [];
	const all: number[] = [];
	for (const p of players) {
		if (p.tid < 0) {
			continue;
		}
		const r =
			p.ratings.findLast((x) => x.season === season) ?? p.ratings.at(-1);
		if (!r) {
			continue;
		}
		const o = player.fuzzRating(r.ovr, r.fuzz);
		all.push(o);
		if (
			p.stats.some((s) => s.season === season && !s.playoffs && (s.gp ?? 0) > 0)
		) {
			played.push(o);
		}
	}
	const list = (played.length >= 100 ? played : all).sort((a, b) => b - a);
	return list.length
		? list[
				Math.min(list.length - 1, Math.max(4, Math.round(list.length * 0.03)))
			]!
		: Number.POSITIVE_INFINITY;
};

const loadBase = async (season: number): Promise<Base> => {
	const current = season === g.get("season");
	const { series, playInGids } = await loadSeries();
	const games = await idb.merged.games.getAll(
		{ season },
		{
			filter: (gm) =>
				gm.teams.length === 2 && gm.teams[0].tid >= 0 && gm.teams[1].tid >= 0,
			map: (gm) => toHGame(gm, playInGids),
		},
	);
	const tss = await idb.merged.teamSeasons.getAll({ season });
	const teams: HTeam[] = tss.map((ts) => ({
		tid: ts.tid,
		abbrev: ts.abbrev,
		name: `${ts.region} ${ts.name}`,
		cid: ts.cid,
		did: ts.did,
	}));
	let gpTotal = 0;
	const teamNow: NonNullable<HRaw["teamNow"]> = {};
	for (const ts of tss) {
		gpTotal += ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0);
		teamNow[ts.tid] = {
			won: ts.won,
			lost: ts.lost,
			tied: ts.tied ?? 0,
			otl: ts.otl ?? 0,
			streak: ts.streak ?? 0,
		};
	}
	const stored = games.filter((x) => !x.playoffs).length;
	const playoffsByConf = await seasonCore.getPlayoffsByConf(season);
	const { maxPlayoffSeed } = await getMaxPlayoffSeed(season, playoffsByConf);

	let records: HRecords | null = await recordsBaseline(season);
	if (current) {
		// active record holders keep adding to their careers; the stars are those on rosters now
		const adds = new Map<number, HRow[]>();
		const holders = new Set<number>();
		for (const list of Object.values(records.careerLeague)) {
			list?.forEach((e) => holders.add(e.pid));
		}
		for (const per of Object.values(records.careerFranchise)) {
			for (const list of Object.values(per)) {
				list?.forEach((e) => holders.add(e.pid));
			}
		}
		for (const pid of holders) {
			const p = await idb.cache.players.get(pid);
			if (p) {
				adds.set(
					pid,
					p.stats.filter((s) => !s.playoffs && s.season === season).map(toRow),
				);
			}
		}
		records = withActiveCareers(records, (pid) => adds.get(pid) ?? null);
		records = {
			...records,
			starCut: { ...records.starCut, [season]: await starCutNow(season) },
		};
	}

	return {
		season,
		numGames: g.get("numGames", season),
		teams,
		games,
		linesComplete: stored > 0 && stored * 2 >= 0.98 * gpTotal,
		series,
		records,
		teamNow: current ? teamNow : undefined,
		playoffsByConf: playoffsByConf !== false,
		maxPlayoffSeed,
	};
};

const getBase = async (season: number): Promise<Base> => {
	const current = season === g.get("season");
	// the current season changes with every game played
	const nGames = current ? (await idb.cache.games.getAll()).length : 0;
	const key = `${g.get("lid")}|${season}|${current ? `${nGames}|${g.get("phase")}` : "past"}`;
	let hit = baseCache.get(key);
	if (!hit) {
		hit = loadBase(season);
		baseCache.set(key, hit);
		if (baseCache.size > 4) {
			baseCache.delete(baseCache.keys().next().value!);
		}
		hit.catch(() => baseCache.delete(key));
	}
	return hit;
};

// The snapshot with the players of some teams (rosters now, for upcoming games) and some pids (finished games)
export const getHypeRaw = async (
	season: number,
	{ tids = [], pids = [] }: { tids?: number[]; pids?: number[] },
): Promise<HRaw> => {
	const base = await getBase(season);
	const rel = await releases();
	const playersRaw: Player[] = [];
	const out: Record<number, number[]> = {};
	const have = new Set<number>();
	for (const tid of tids) {
		const roster = await idb.cache.players.indexGetAll("playersByTid", tid);
		out[tid] = [];
		for (const p of roster) {
			playersRaw.push(p);
			have.add(p.pid);
			if (p.injury.gamesRemaining > 0) {
				out[tid]!.push(p.pid);
			}
		}
	}
	const wanted = pids.filter((pid) => !have.has(pid));
	if (wanted.length > 0) {
		playersRaw.push(...(await idb.merged.players.getAll({ pids: wanted })));
	}
	const players = playersRaw.map((p) => toRaw(p, rel));
	const teamNow = base.teamNow ? { ...base.teamNow } : undefined;
	if (teamNow) {
		for (const tid of tids) {
			const roster = playersRaw.filter((p) => p.tid === tid);
			const x = teamNow[tid];
			if (x && roster.length > 0) {
				x.ovr = team.ovr(
					roster.map((p) => {
						const r = p.ratings.at(-1)!;
						return {
							injury: p.injury,
							value: p.value,
							ratings: {
								ovr: player.fuzzRating(r.ovr, r.fuzz),
								pos: r.pos,
							},
						};
					}),
					{ playoffs: g.get("phase") === PHASE.PLAYOFFS },
				);
			}
		}
	}
	return { ...base, players, teamNow, out };
};

type UpcomingGame = Target & { season: number };

// The next days of the schedule as targets (never the all-star game or the trade deadline)
export const upcomingTargets = async (
	numDays: number,
): Promise<{ days: { day: number; games: UpcomingGame[] }[] }> => {
	const schedule = await seasonCore.getSchedule();
	const phase = g.get("phase");
	const playoffSeries =
		phase === PHASE.PLAYOFFS
			? await idb.cache.playoffSeries.get(g.get("season"))
			: undefined;
	const playIn = !!playoffSeries && playoffSeries.currentRound === -1;
	const days = new Map<number, UpcomingGame[]>();
	for (const game of schedule) {
		if (game.homeTid < 0 || game.awayTid < 0) {
			continue;
		}
		if (!days.has(game.day) && days.size >= numDays) {
			break;
		}
		let arr = days.get(game.day);
		if (!arr) {
			days.set(game.day, (arr = []));
		}
		arr.push({
			gid: game.gid,
			day: game.day,
			homeTid: game.homeTid,
			awayTid: game.awayTid,
			playoffs: phase === PHASE.PLAYOFFS,
			playIn,
			completed: false,
			season: g.get("season"),
		});
	}
	return { days: [...days.entries()].map(([day, games]) => ({ day, games })) };
};

// Hype of a set of upcoming games (one snapshot for all of them)
export const hypeForUpcoming = async (
	games: UpcomingGame[],
): Promise<HypeLite[]> => {
	if (games.length === 0) {
		return [];
	}
	const season = g.get("season");
	const tids = [...new Set(games.flatMap((x) => [x.homeTid, x.awayTid]))];
	const raw = await getHypeRaw(season, { tids });
	return games
		.map((t) => hypeForGame(raw, t))
		.filter((x) => x !== null)
		.map(toLite);
};

// Hype of games by gid, whether upcoming (in the schedule) or finished (stored)
export const hypeForGids = async (
	gids: number[],
): Promise<Record<number, HypeLite>> => {
	const out: Record<number, HypeLite> = {};
	const { days } = await upcomingTargets(Number.MAX_SAFE_INTEGER);
	const upcoming = new Map(days.flatMap((d) => d.games).map((x) => [x.gid, x]));
	const wantUp = gids
		.map((gid) => upcoming.get(gid))
		.filter((x) => x !== undefined);
	for (const h of await hypeForUpcoming(wantUp)) {
		out[h.gid] = h;
	}
	// finished games, one snapshot per season
	const rest = gids.filter((gid) => !upcoming.has(gid));
	const stored = await idb.merged.games.getAll({ gids: rest });
	const bySeason = Map.groupBy(stored, (gm) => gm.season);
	for (const [season, list] of bySeason) {
		const pids = list.flatMap((gm) =>
			gm.teams.flatMap((t) => t.players.map((p: any) => p.pid as number)),
		);
		const raw = await getHypeRaw(season, { pids });
		for (const gm of list) {
			const hg = storedGame(raw, gm.gid);
			if (!hg) {
				continue;
			}
			const h = hypeForGame(raw, targetOfGame(hg));
			if (h) {
				out[gm.gid] = toLite(h);
			}
		}
	}
	return out;
};

export const hypeChases = async (limit = 25): Promise<ChaseRow[]> => {
	const season = g.get("season");
	const raw = await getHypeRaw(season, {});
	// every player on a roster now
	const players: Player[] = (await idb.cache.players.getAll()).filter(
		(p) => p.tid >= 0,
	);
	const rel = new Map<number, { season: number; tid: number }[]>();
	return chaseBoard(
		{ ...raw, players: players.map((p) => toRaw(p, rel)) },
		limit,
	);
};
