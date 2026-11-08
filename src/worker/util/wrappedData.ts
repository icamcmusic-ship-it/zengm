import { idb } from "../db/index.ts";
import { changeLog } from "../db/changeLog.ts";
import { g, local, lock, toUI } from "./index.ts";
import { getSeasonState } from "./processInputs.ts";
import { isCurrentSeasonComplete } from "../../common/seasons.ts";
import { PLAYER } from "../../common/constants.ts";
import type {
	WAward,
	WBoxLine,
	WGame,
	WLeague,
	WLottery,
	WPick,
	WPlayer,
	WStat,
	WTeamSeason,
	WTrade,
	WTradeAsset,
} from "../../common/wrapped/types.ts";
import {
	LeagueIndex,
	newLinesCache,
	type LinesCache,
} from "../../common/wrapped/league.ts";
import type {
	DraftLotteryResult,
	DraftPick,
	EventBBGM,
	Game,
	Player,
	PlayerAward,
	TeamSeason,
	UpdateEvent,
} from "../../common/types.ts";
import { wperfMark, wperfTime } from "./wrappedPerf.ts";
import {
	forgetPlayers,
	loadPersisted,
	saveGames,
	savePlayers,
	saveTeams,
} from "./wrappedPersist.ts";
import { hashString } from "../../common/wrapped/util.ts";
import { getProAwards, getProStats } from "../../common/preDraft.ts";
import { NUM_PRIOR_SEASONS_EVENTS } from "../db/Cache.ts";

// Where the Wrapped and Storylines snapshot comes from. Reading and converting a whole league is slow, so the converted pieces are kept between page loads and only what changed (found through the change log, see db/changeLog.ts) is read again:
// - players: one converted player per pid; retired players are never read again unless they are written to
// - team seasons and team stats: converted per season
// - box scores: converted per season
// - the per-season player lines in the LeagueIndex, for seasons that are over
// The converters below (toStat, toBox, toWPlayer, toWTeamSeason, toWGame) are the one place a snapshot field is read from the database.

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

// A stat the database may not have recorded
const opt = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : undefined;

const toStat = (r: any): WStat => ({
	season: r.season,
	tid: r.tid,
	gp: n(r.gp),
	gs: n(r.gs),
	min: n(r.min),
	pts: n(r.pts),
	trb: n(r.orb) + n(r.drb),
	ast: n(r.ast),
	stl: n(r.stl),
	blk: n(r.blk),
	tov: n(r.tov),
	tp: n(r.tp),
	tpa: n(r.tpa),
	fg: n(r.fg),
	fga: n(r.fga),
	ft: n(r.ft),
	fta: n(r.fta),
	per: n(r.per),
	ws: n(r.ows) + n(r.dws),
	bpm: n(r.obpm) + n(r.dbpm),
	vorp: n(r.vorp),
	orb: opt(r.orb),
	drb: opt(r.drb),
	pf: opt(r.pf),
	pm: opt(r.pm),
	ortg: opt(r.ortg),
	drtg: opt(r.drtg),
	usgp: opt(r.usgp),
	ows: opt(r.ows),
	dws: opt(r.dws),
	dd: opt(r.dd),
	td: opt(r.td),
	ptsMax: opt(r.ptsMax),
	trbMax: opt(r.trbMax),
	astMax: opt(r.astMax),
	stlMax: opt(r.stlMax),
	blkMax: opt(r.blkMax),
	tpMax: opt(r.tpMax),
	obpm: opt(r.obpm),
	dbpm: opt(r.dbpm),
	jersey: r.jerseyNumber === undefined ? undefined : String(r.jerseyNumber),
});

const toBox = (p: any): WBoxLine => ({
	pid: p.pid,
	name: p.name,
	min: n(p.min),
	pts: n(p.pts),
	trb: n(p.orb) + n(p.drb),
	ast: n(p.ast),
	stl: n(p.stl),
	blk: n(p.blk),
	tp: n(p.tp),
	tpa: opt(p.tpa),
	fg: opt(p.fg),
	fga: opt(p.fga),
	ft: opt(p.ft),
	fta: opt(p.fta),
	tov: opt(p.tov),
	orb: opt(p.orb),
	drb: opt(p.drb),
	pf: opt(p.pf),
	pm: opt(p.pm),
	gs: opt(p.gs),
});

const TEAM_ORD = ["First", "Second", "Third", "Fourth", "Fifth"];

// Awards are either simple {season, type} or built-in {season, name, rank, numTeams}. Built-in individual awards only count for the winner (rank 1); team awards become "First Team All-League" and the like.
const awardOf = (a: PlayerAward): WAward[] => {
	if (a.type !== undefined) {
		return [{ season: a.season, type: a.type }];
	}
	if (a.numTeams === undefined) {
		if (a.rank !== 1) {
			return [];
		}
		const type = a.actAs === "mvp" ? "Most Valuable Player" : a.name;
		return [{ season: a.season, type }];
	}
	const ord = TEAM_ORD[a.rank - 1];
	return [
		{
			season: a.season,
			type: a.numTeams > 1 && ord ? `${ord} Team ${a.name}` : a.name,
		},
	];
};

// The skill ratings kept per season in WPlayer.rat
export const RATING_SKILLS = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
] as const;

const toWPlayer = (p: Player): WPlayer => ({
	pid: p.pid,
	name: `${p.firstName} ${p.lastName}`.trim(),
	firstName: p.firstName,
	lastName: p.lastName,
	bornYear: p.born.year,
	bornLoc: p.born.loc,
	college: p.college,
	draft: {
		year: p.draft.year,
		round: p.draft.round,
		pick: p.draft.pick,
		tid: p.draft.tid,
	},
	tid: p.tid,
	retiredYear: p.retiredYear,
	diedYear: p.diedYear,
	hof: !!p.hof,
	// Pre-draft (college) honors and stats rows are not part of a pro career
	awards: getProAwards(p).flatMap(awardOf),
	stats: getProStats(p)
		.filter((r) => !r.playoffs)
		.map(toStat),
	po: getProStats(p)
		.filter((r) => r.playoffs)
		.map(toStat),
	injuries: p.injuries.map((i) => ({
		season: i.season,
		games: i.games,
		type: i.type,
	})),
	ovr: Object.fromEntries(p.ratings.map((r) => [r.season, r.ovr])),
	moves: (p.transactions ?? []).map((t) => ({
		season: t.season,
		tid: t.tid,
		type: t.type,
		fromTid: "fromTid" in t ? t.fromTid : undefined,
		phase: t.phase,
		eid: "eid" in t ? t.eid : undefined,
	})),
	relatives: p.relatives.map((r) => ({ type: r.type, pid: r.pid })),
	pot: Object.fromEntries(p.ratings.map((r) => [r.season, r.pot])),
	pos: Object.fromEntries(p.ratings.map((r) => [r.season, r.pos])),
	hgt: p.ratings.at(-1)?.hgt,
	paid: (p.contracts ?? []).flatMap((c) =>
		(c.payments ?? []).map((x) => ({
			season: x.season,
			tid: x.tid,
			amount: x.amount,
		})),
	),
	draftOvr: p.draft.ovr,
	draftPot: p.draft.pot,
	jersey: p.stats.findLast((r) => r.jerseyNumber)?.jerseyNumber,
	hgtIn: opt(p.hgt),
	weight: opt(p.weight),
	rat: Object.fromEntries(
		p.ratings.map((r: any) => [r.season, RATING_SKILLS.map((k) => n(r[k]))]),
	),
	contracts: (p.contracts ?? []).map((c) => {
		// When and by whom it was signed: the signing transaction, or the draft for a rookie contract
		const tr =
			c.eid !== undefined
				? (p.transactions ?? []).find((t) => "eid" in t && t.eid === c.eid)
				: undefined;
		const payTid = c.payments?.find((x) => x.tid >= 0)?.tid;
		return {
			type: c.type,
			start: c.start,
			amounts: [...c.amounts],
			signed: tr ? tr.season : c.type === "rookie" ? p.draft.year : undefined,
			tid: tr
				? tr.tid
				: c.type === "rookie" && p.draft.tid >= 0
					? p.draft.tid
					: payTid,
			ended: c.endedEarly
				? {
						season: c.endedEarly.season,
						reason: c.endedEarly.reason,
						tid: c.endedEarly.tid,
					}
				: undefined,
		};
	}),
	draftOriginalTid: p.draft.originalTid,
	draftDpid: p.draft.dpid,
});

// A trade event, with what each side received. Legacy events without the assets are left out.
const toWTrade = (e: EventBBGM): WTrade | undefined => {
	if (e.type !== "trade" || !e.teams) {
		return undefined;
	}
	const assets = (i: 0 | 1): WTradeAsset[] =>
		e.teams![i].assets.map((a) =>
			"pid" in a
				? {
						pid: a.pid,
						name: a.name,
						amount: n(a.contract?.amount),
						exp: n(a.contract?.exp),
					}
				: {
						dpid: a.dpid,
						season: a.season,
						round: a.round,
						originalTid: a.originalTid,
					},
		);
	return {
		eid: e.eid,
		season: e.season,
		phase: e.phase ?? 0,
		tids: [e.tids[0], e.tids[1]],
		got: [assets(0), assets(1)],
	};
};

const toWLottery = (r: DraftLotteryResult): WLottery => ({
	season: r.season,
	type: r.draftType,
	rows: r.result.map((x) => ({
		tid: x.tid,
		originalTid: x.originalTid,
		chances: n(x.chances),
		pick: n(x.pick),
	})),
});

const toWPick = (dp: DraftPick): WPick => ({
	dpid: dp.dpid,
	tid: dp.tid,
	originalTid: dp.originalTid,
	round: dp.round,
	season: dp.season,
	pick: dp.pick,
});

// seed is filled in once the playoff series are known
const toWTeamSeason = (
	ts: TeamSeason,
	st: { gp: number; pts: number; oppPts: number } | undefined,
): WTeamSeason => ({
	tid: ts.tid,
	season: ts.season,
	abbrev: ts.abbrev,
	region: ts.region,
	name: ts.name,
	colors: ts.colors,
	imgURL: ts.imgURL,
	won: ts.won,
	lost: ts.lost,
	tied: ts.tied ?? 0,
	otl: ts.otl ?? 0,
	playoffRoundsWon: ts.playoffRoundsWon,
	seed: undefined,
	gp: st?.gp ?? 0,
	pts: st?.pts ?? 0,
	oppPts: st?.oppPts ?? 0,
	cid: ts.cid,
	did: ts.did,
	wonHome: ts.wonHome,
	lostHome: ts.lostHome,
	wonAway: ts.wonAway,
	lostAway: ts.lostAway,
	wonDiv: ts.wonDiv,
	lostDiv: ts.lostDiv,
	wonConf: ts.wonConf,
	lostConf: ts.lostConf,
	gpHome: ts.gpHome,
	att: ts.att,
	payroll: ts.payrollEndOfSeason,
	hype: ts.hype,
	pop: ts.pop,
	streak: ts.streak,
	numPlayersTradedAway: ts.numPlayersTradedAway,
	tiedHome: ts.tiedHome,
	tiedAway: ts.tiedAway,
	luxuryTax: opt(ts.expenses?.luxuryTax),
});

const toWGame = (gm: Game): WGame => ({
	gid: gm.gid,
	season: gm.season,
	day: gm.day ?? 0,
	playoffs: !!gm.playoffs,
	overtimes: gm.overtimes ?? 0,
	att: opt(gm.att),
	teams: [
		{
			tid: gm.teams[0].tid,
			pts: gm.teams[0].pts,
			players: gm.teams[0].players.map(toBox),
			ptsQtrs: gm.teams[0].ptsQtrs,
		},
		{
			tid: gm.teams[1].tid,
			pts: gm.teams[1].pts,
			players: gm.teams[1].players.map(toBox),
			ptsQtrs: gm.teams[1].ptsQtrs,
		},
	],
});

// Entries in the persisted cache are only good for the code that made them, so the version comes from the text of the converters: adding a field to one of them is enough to start over.
const persistVersion = () =>
	hashString(
		[
			opt,
			toStat,
			toBox,
			awardOf,
			toWPlayer,
			toWTeamSeason,
			toWGame,
			getProStats,
			getProAwards,
			RATING_SKILLS,
		]
			.map((f) => f.toString())
			.join("\n"),
	).toString(36);

// Let the worker handle other messages (and the UI stay responsive) between chunks of work
export const yieldToWorker = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, 0);
	});

const CHUNK = 400;

// What a page shows while the snapshot is being built. The page is told so it can update the text, not more than a few times a second.
const setProgress = (c: LeagueCache, text: string) => {
	c.progress = text;
	const now = performance.now();
	if (now - c.lastProgressEmit > 300) {
		c.lastProgressEmit = now;
		void toUI("realtimeUpdate", [["wrappedProgress"]]);
	}
};

// persisted: it is also in the persisted cache (see wrappedPersist.ts)
type PlayerEntry = { seq: number; wp: WPlayer; persisted?: boolean };
type TeamSeasonsEntry = {
	seq: number;
	rows: { tsid: number; w: WTeamSeason }[];
	persisted?: boolean;
};
type GamesEntry = {
	seq: number;
	count: number | undefined;
	list: WGame[];
	persisted?: boolean;
};

// Trades of one season. count is how many events the season has in IndexedDB, for seasons that are no longer in the cache
type TradesEntry = { seq: number; count: number | undefined; list: WTrade[] };

type LeagueCache = {
	lid: number;
	epoch: number;
	players: Map<number, PlayerEntry>;
	teams: Map<number, TeamSeasonsEntry>;
	games: Map<number, GamesEntry>;
	trades: Map<number, TradesEntry>;
	linesCache: LinesCache;
	persistLoaded: boolean;
	persisting: boolean;
	sig: string | undefined;
	built: Promise<Built> | undefined;
	// The finished snapshot for readySig, for callers that can't wait
	ready: Built | undefined;
	readySig: string | undefined;
	error: { sig: string; message: string } | undefined;
	notified: Promise<Built> | undefined;
	progress: string;
	lastProgressEmit: number;
	// Builds are one at a time, so each can use what the one before it kept
	queue: Promise<unknown>;
	version: number;
};

export type Built = {
	L: WLeague;
	X: LeagueIndex;
	// Changes whenever a different snapshot is built
	version: number;
	// For results derived from this snapshot only, gone when the snapshot is replaced
	memo: Map<string, unknown>;
};

let state: LeagueCache | undefined;

// The snapshot of a big league is a lot of memory, so it isn't kept for a league nobody has looked at in a while. What is saved (see wrappedPersist.ts) makes building it again quick.
const KEEP_MS = 10 * 60 * 1000;
let evictTimer: ReturnType<typeof setTimeout> | undefined;
const touch = () => {
	clearTimeout(evictTimer);
	evictTimer = setTimeout(() => {
		state = undefined;
	}, KEEP_MS);
	(evictTimer as { unref?: () => void }).unref?.();
};

const newCache = (lid: number): LeagueCache => ({
	lid,
	epoch: changeLog.epoch,
	players: new Map(),
	teams: new Map(),
	games: new Map(),
	trades: new Map(),
	linesCache: newLinesCache(),
	persistLoaded: false,
	persisting: false,
	sig: undefined,
	built: undefined,
	ready: undefined,
	readySig: undefined,
	error: undefined,
	notified: undefined,
	progress: "Starting",
	lastProgressEmit: 0,
	queue: Promise.resolve(),
	version: 0,
});

// Cheap summary of everything the snapshot is built from. If it hasn't changed, the snapshot hasn't either.
const signature = () =>
	[
		g.get("lid"),
		changeLog.epoch,
		g.get("season"),
		g.get("phase"),
		g.get("startingSeason"),
		g.get("userTid"),
		JSON.stringify(g.get("numGamesPlayoffSeries")),
		changeLog.store("players"),
		changeLog.store("teamSeasons"),
		changeLog.store("teamStats"),
		changeLog.store("playoffSeries"),
		changeLog.store("games"),
		changeLog.store("events"),
		changeLog.store("draftLotteryResults"),
		changeLog.store("draftPicks"),
		// Anything else the snapshot reads from the game attributes
		changeLog.store("gameAttributes"),
	].join("|");

// What the engine's per-season lines of a player depend on, by season. When a player's data changes, the seasons that differ are dropped from the lines cache.
const statSigs = (rows: WStat[]) => {
	const out = new Map<number, string>();
	for (const r of rows) {
		if (r.gp > 0) {
			out.set(r.season, `${out.get(r.season) ?? ""};${JSON.stringify(r)}`);
		}
	}
	return out;
};

const dropChangedSeasons = (
	cache: LinesCache,
	prev: WPlayer | undefined,
	next: WPlayer | undefined,
) => {
	if (cache.reg.size === 0 && cache.po.size === 0) {
		return;
	}
	const sameIdentity =
		prev && next && prev.name === next.name && prev.bornYear === next.bornYear;
	for (const [kind, map] of [
		["reg", cache.reg],
		["po", cache.po],
	] as const) {
		const a = prev
			? statSigs(kind === "reg" ? prev.stats : prev.po)
			: new Map<number, string>();
		const b = next
			? statSigs(kind === "reg" ? next.stats : next.po)
			: new Map<number, string>();
		for (const season of new Set([...a.keys(), ...b.keys()])) {
			if (!sameIdentity || a.get(season) !== b.get(season)) {
				map.delete(season);
			}
		}
	}
};

const isInLeague = (p: { tid: number }) =>
	p.tid === PLAYER.RETIRED || p.tid >= PLAYER.FREE_AGENT;

// The players, in the order that reading the whole players store gives (retired players from IndexedDB, then the rest of the cache), converted
const loadPlayers = async (c: LeagueCache, seq0: number) => {
	const cacheByKey = (await idb.cache.players.getAllByKey()) as Record<
		number,
		Player
	>;
	const dbRetired = await idb.league
		.transaction("players")
		.store.index("tid")
		.getAllKeys(PLAYER.RETIRED);

	const order: number[] = [];
	const seen = new Set<number>();
	for (const pid of dbRetired) {
		if (seen.has(pid)) {
			continue;
		}
		seen.add(pid);
		if (idb.cache.players.hasPendingDelete(pid)) {
			continue;
		}
		const cp = cacheByKey[pid];
		if (cp && !isInLeague(cp)) {
			continue;
		}
		order.push(pid);
	}
	for (const cp of Object.values(cacheByKey)) {
		if (!seen.has(cp.pid)) {
			seen.add(cp.pid);
			if (isInLeague(cp)) {
				order.push(cp.pid);
			}
		}
	}

	const current = new Map<number, PlayerEntry>();
	const store = (pid: number, wp: WPlayer) => {
		dropChangedSeasons(c.linesCache, c.players.get(pid)?.wp, wp);
		current.set(pid, { seq: seq0, wp });
	};

	// Players that have to be read from IndexedDB: not in the cache, and no still-valid converted copy
	const toRead: number[] = [];
	let sinceYield = 0;
	for (const pid of order) {
		const prev = c.players.get(pid);
		const cp = cacheByKey[pid];
		// A persisted copy is of a retired player as he was in the database, so it says nothing about a player who is in the cache now
		if (prev && changeLog.player(pid) <= prev.seq && !(cp && prev.persisted)) {
			current.set(pid, prev);
			continue;
		}
		if (cp) {
			store(pid, toWPlayer(cp));
			sinceYield += 1;
			if (sinceYield >= CHUNK) {
				sinceYield = 0;
				await yieldToWorker();
			}
		} else {
			toRead.push(pid);
		}
	}

	if (toRead.length > 0) {
		if (toRead.length > dbRetired.length * 0.2) {
			// Most of them: one pass over the retired players is much faster than looking each one up. Only what a player is converted to is kept, since each comes with all of his ratings and stats.
			const needed = new Set(toRead);
			let done = 0;
			for await (const { value } of idb.league
				.transaction("players")
				.store.index("tid")
				.iterate(PLAYER.RETIRED)) {
				if (
					needed.has(value.pid) &&
					!idb.cache.players.hasPendingDelete(value.pid)
				) {
					store(value.pid, toWPlayer(value));
					done += 1;
					if (done % 250 === 0) {
						setProgress(
							c,
							`Reading players: ${done.toLocaleString("en-US")} of ${needed.size.toLocaleString("en-US")}`,
						);
					}
				}
			}
		} else {
			// A few at a time
			const BATCH = 300;
			for (let i = 0; i < toRead.length; i += BATCH) {
				const wps = await idb.merged.players.getAll(
					{ pids: toRead.slice(i, i + BATCH) },
					{ map: toWPlayer },
				);
				for (const wp of wps) {
					store(wp.pid, wp);
				}
				setProgress(
					c,
					`Reading players: ${i + wps.length} of ${toRead.length}`,
				);
				await yieldToWorker();
			}
		}
	}

	// Players that are gone (or no longer count) can't leave anything behind in the lines cache
	const gone: number[] = [];
	for (const [pid, prev] of c.players) {
		if (!current.has(pid)) {
			dropChangedSeasons(c.linesCache, prev.wp, undefined);
			if (prev.persisted) {
				gone.push(pid);
			}
		}
	}
	if (gone.length > 0) {
		void forgetPlayers(c.lid, gone);
	}
	c.players = current;

	const out: WPlayer[] = [];
	for (const pid of order) {
		const e = current.get(pid);
		if (e) {
			out.push(e.wp);
		}
	}
	wperfMark("snapshot.playersRead", toRead.length);
	return out;
};

const loadTeamSeasons = async (
	c: LeagueCache,
	seq0: number,
	currentSeason: number,
) => {
	const seasons: number[] = [];
	for (let s = g.get("startingSeason"); s <= currentSeason; s++) {
		seasons.push(s);
	}
	const valid = (s: number) => {
		const e = c.teams.get(s);
		return (
			e !== undefined &&
			changeLog.season("teamSeasons", s) <= e.seq &&
			changeLog.season("teamStats", s) <= e.seq
		);
	};
	const need = seasons.filter((s) => !valid(s));

	if (need.length > 0) {
		const rowsBySeason = new Map<number, TeamSeason[]>();
		if (need.length > 3) {
			// Most of them: one pass over the store
			const needSet = new Set(need);
			for (const s of need) {
				rowsBySeason.set(s, []);
			}
			for (const ts of await idb.merged.teamSeasons.getAll(undefined, {
				filter: (row) => needSet.has(row.season),
			})) {
				rowsBySeason.get(ts.season)!.push(ts);
			}
		} else {
			for (const s of need) {
				rowsBySeason.set(s, await idb.merged.teamSeasons.getAll({ season: s }));
			}
		}

		type St = { gp: number; pts: number; oppPts: number };
		const statsByKey = new Map<string, St>();
		const toSt = (r: any) => ({
			season: r.season as number,
			playoffs: !!r.playoffs,
			st: { gp: n(r.gp), pts: n(r.pts), oppPts: n(r.oppPts) },
		});
		const add = (tid: number, r: ReturnType<typeof toSt>) => {
			if (!r.playoffs) {
				statsByKey.set(`${tid}|${r.season}`, r.st);
			}
		};
		if (need.length > 3) {
			const needSet = new Set(need);
			const tids = new Set<number>();
			for (const rows of rowsBySeason.values()) {
				for (const ts of rows) {
					tids.add(ts.tid);
				}
			}
			for (const tid of tids) {
				const rows = await idb.merged.teamStats.getAll(
					{ tid },
					{ filter: (r) => needSet.has(r.season), map: toSt },
				);
				for (const r of rows) {
					add(tid, r);
				}
			}
		} else {
			for (const [season, tsRows] of rowsBySeason) {
				for (const tid of new Set(tsRows.map((ts) => ts.tid))) {
					const rows = await idb.merged.teamStats.getAll(
						{ tid, season },
						{ map: toSt },
					);
					for (const r of rows) {
						add(tid, r);
					}
				}
			}
		}

		for (const [season, tsRows] of rowsBySeason) {
			c.teams.set(season, {
				seq: seq0,
				rows: tsRows.map((ts) => ({
					tsid: ts.rid,
					w: toWTeamSeason(ts, statsByKey.get(`${ts.tid}|${ts.season}`)),
				})),
			});
		}
	}

	// Same order as the whole store: by tsid
	const all: { tsid: number; w: WTeamSeason }[] = [];
	for (const s of seasons) {
		all.push(...(c.teams.get(s)?.rows ?? []));
	}
	all.sort((a, b) => a.tsid - b.tsid);
	return all.map((x) => x.w);
};

// Seasons that have box scores in IndexedDB, found without reading any of them
const seasonsWithGames = async () => {
	const out: number[] = [];
	let cursor = await idb.league
		.transaction("games")
		.store.index("season")
		.openKeyCursor();
	while (cursor) {
		const season = cursor.key as number;
		out.push(season);
		cursor = await cursor.continue(season + 1);
	}
	return out;
};

const loadGames = async (
	c: LeagueCache,
	seq0: number,
	currentSeason: number,
) => {
	const seasons = new Set(await seasonsWithGames());
	// The cache has the current season's games, which may not be flushed yet
	seasons.add(currentSeason);
	const sorted = [...seasons].sort((a, b) => a - b);

	const out: WGame[] = [];
	let read = 0;
	for (const season of sorted) {
		// A season that is over only changes if box scores are deleted, which changes how many there are
		const count =
			season === currentSeason
				? undefined
				: await idb.league
						.transaction("games")
						.store.index("season")
						.count(season);
		const e = c.games.get(season);
		let list: WGame[];
		if (e && e.count === count && changeLog.season("games", season) <= e.seq) {
			list = e.list;
		} else {
			read += 1;
			setProgress(c, `Reading box scores: ${season}`);
			list = await idb.merged.games.getAll(
				{ season },
				{ filter: (gm) => gm.teams.length === 2, map: toWGame },
			);
			c.games.set(season, { seq: seq0, count, list });
			await yieldToWorker();
		}
		for (const gm of list) {
			out.push(gm);
		}
	}
	wperfMark("snapshot.gamesRead", read);
	for (const season of c.games.keys()) {
		if (!seasons.has(season)) {
			c.games.delete(season);
		}
	}
	return out;
};

// Trades from the events store, read per season. A season that is no longer in the cache only changes if its events are deleted, which changes how many there are.
const loadTrades = async (
	c: LeagueCache,
	seq0: number,
	currentSeason: number,
) => {
	const out: WTrade[] = [];
	const inCache = (s: number) => s >= currentSeason - NUM_PRIOR_SEASONS_EVENTS;
	for (let s = g.get("startingSeason"); s <= currentSeason; s++) {
		const count = inCache(s)
			? undefined
			: await idb.league.transaction("events").store.index("season").count(s);
		const e = c.trades.get(s);
		let list: WTrade[];
		if (
			e &&
			e.count === count &&
			(count !== undefined || changeLog.store("events") <= e.seq)
		) {
			list = e.list;
		} else if (count === 0) {
			list = [];
			c.trades.set(s, { seq: seq0, count, list });
		} else {
			const rows = await idb.merged.events.getAll(
				{ season: s },
				{ filter: (ev) => ev.type === "trade" },
			);
			list = [];
			for (const ev of rows) {
				const t = toWTrade(ev);
				if (t) {
					list.push(t);
				}
			}
			list.sort((a, b) => a.eid - b.eid);
			c.trades.set(s, { seq: seq0, count, list });
		}
		out.push(...list);
	}
	return out;
};

// What an earlier session saved. seq 0 makes an entry good until the player (or season) is written to, which the change log has already seen if it happened before the cache was loaded.
const loadFromPersisted = async (c: LeagueCache) => {
	c.persistLoaded = true;
	const saved = await wperfTime("snapshot.persistedLoad", () =>
		loadPersisted(c.lid, persistVersion()),
	);
	for (const [pid, wp] of saved.players) {
		c.players.set(pid, { seq: 0, wp, persisted: true });
	}
	for (const [season, { count, list }] of saved.games) {
		c.games.set(season, { seq: 0, count, list, persisted: true });
	}
	for (const [season, rows] of saved.teams) {
		c.teams.set(season, { seq: 0, rows, persisted: true });
	}
	wperfMark("snapshot.persistedPlayers", saved.players.size);
	wperfMark("snapshot.persistedTeams", saved.teams.size);
};

// Save what a later session could use, once things are quiet. Only retired players and seasons that are over, which don't change.
const persistSoon = (c: LeagueCache) => {
	if (c.persisting) {
		return;
	}
	c.persisting = true;
	setTimeout(async () => {
		try {
			const currentSeason = g.get("season");
			const players = [...c.players].filter(
				([pid, e]) =>
					!e.persisted &&
					e.wp.tid === PLAYER.RETIRED &&
					// JSON can't hold Infinity
					Number.isFinite(e.wp.retiredYear) &&
					changeLog.player(pid) <= e.seq,
			);
			for (let i = 0; i < players.length; i += 300) {
				// Checked again here, since a player written to while earlier ones were being saved has had his saved copy dropped, and must not get it back
				const chunk = players
					.slice(i, i + 300)
					.filter(([pid, e]) => changeLog.player(pid) <= e.seq);
				await savePlayers(
					c.lid,
					chunk.map(([pid, e]) => [pid, e.wp]),
				);
				for (const [, e] of chunk) {
					e.persisted = true;
				}
				await yieldToWorker();
			}
			for (const [season, e] of c.teams) {
				if (
					!e.persisted &&
					season < currentSeason &&
					changeLog.season("teamSeasons", season) <= e.seq &&
					changeLog.season("teamStats", season) <= e.seq
				) {
					await saveTeams(c.lid, season, e.rows);
					e.persisted = true;
				}
			}
			for (const [season, e] of c.games) {
				if (
					!e.persisted &&
					e.count !== undefined &&
					season < currentSeason &&
					changeLog.season("games", season) <= e.seq
				) {
					await saveGames(c.lid, season, e.count, e.list);
					e.persisted = true;
					await yieldToWorker();
				}
			}
		} finally {
			c.persisting = false;
		}
	}, 500);
};

const build = async (c: LeagueCache): Promise<Built> => {
	if (!c.persistLoaded) {
		await loadFromPersisted(c);
	}
	const seq0 = changeLog.seq;
	const currentSeason = g.get("season");

	// Games are read at the same time as the players, since waiting on IndexedDB is a good part of it
	const gamesPromise = wperfTime("snapshot.games", () =>
		loadGames(c, seq0, currentSeason),
	);
	gamesPromise.catch(() => {});
	const teamsPromise = wperfTime("snapshot.teams", () =>
		loadTeamSeasons(c, seq0, currentSeason),
	);
	teamsPromise.catch(() => {});
	const players = await wperfTime("snapshot.players", () =>
		loadPlayers(c, seq0),
	);
	const teamSeasons = await teamsPromise;

	const series = await idb.merged.playoffSeries.getAll();
	const seedOf = new Map<string, number>();
	for (const ps of series) {
		for (const m of ps.series[0] ?? []) {
			seedOf.set(`${m.home.tid}|${ps.season}`, m.home.seed);
			if (m.away) {
				seedOf.set(`${m.away.tid}|${ps.season}`, m.away.seed);
			}
		}
	}
	for (const ts of teamSeasons) {
		ts.seed = seedOf.get(`${ts.tid}|${ts.season}`);
	}

	const numPlayoffRounds: Record<number, number> = {};
	for (const ts of teamSeasons) {
		if (numPlayoffRounds[ts.season] === undefined) {
			numPlayoffRounds[ts.season] = g.get(
				"numGamesPlayoffSeries",
				ts.season,
			).length;
		}
	}

	const games = await gamesPromise;

	const trades = await wperfTime("snapshot.trades", () =>
		loadTrades(c, seq0, currentSeason),
	);
	const lottery = (await idb.merged.draftLotteryResults.getAll())
		.filter((r) => r.draftType !== "dummy" && r.result.length > 0)
		.map(toWLottery)
		.sort((a, b) => a.season - b.season);
	const picks = (await idb.cache.draftPicks.getAll())
		.map(toWPick)
		.sort((a, b) => a.dpid - b.dpid);

	const L: WLeague = {
		startingSeason: g.get("startingSeason"),
		season: currentSeason,
		currentComplete: isCurrentSeasonComplete(getSeasonState()),
		userTid: g.get("userTid"),
		numPlayoffRounds,
		teamSeasons,
		players,
		series: series.map((ps) => ({
			season: ps.season,
			rounds: ps.series.map((round) =>
				round.map((m) => ({
					home: { tid: m.home.tid, seed: m.home.seed, won: m.home.won },
					away: m.away
						? { tid: m.away.tid, seed: m.away.seed, won: m.away.won }
						: undefined,
					gids: m.gids,
				})),
			),
		})),
		games,
		confs: g.get("confs").map((c) => ({ cid: c.cid, name: c.name })),
		divs: g.get("divs").map((d) => ({ did: d.did, cid: d.cid, name: d.name })),
		trades,
		lottery,
		picks,
	};

	const X = await wperfTime("index", () => {
		const x = new LeagueIndex(L, {
			linesCache: c.linesCache,
			// Seasons that are over don't change, and the cache forgets a season if one of its players' rows do
			reuseLines: (season) => season < L.season,
		});
		// For profiling scripts (see wrappedPerf.ts), which read the snapshot back
		if ((globalThis as { __wperfOn?: boolean }).__wperfOn) {
			(globalThis as any).__wrappedLast = x;
		}
		return x;
	});
	c.version += 1;
	persistSoon(c);
	return { L, X, version: c.version, memo: new Map() };
};

// Read the whole league into the plain snapshot the Wrapped and Storylines engines use, without keeping anything. Slower than getWrapped, which reuses what it has built before, but it can't be out of date.
export const loadWrappedLeague = async (): Promise<WLeague> => {
	const c = newCache(g.get("lid"));
	return (await build(c)).L;
};

// The snapshot and its index. Rebuilt only if something it reads changed since the last call, and then only the changed parts are read again.
export const getWrapped = (): Promise<Built> => {
	touch();
	const lid = g.get("lid");
	if (!state || state.lid !== lid || state.epoch !== changeLog.epoch) {
		state = newCache(lid);
	}
	const c = state;
	const sig = signature();
	if (c.built && c.sig === sig) {
		return c.built;
	}
	c.sig = sig;
	c.error = undefined;
	const prev = c.queue;
	const built = (async () => {
		await prev;
		return build(c);
	})();
	c.queue = built.catch(() => {});
	c.built = built;
	built.then(
		(b) => {
			if (c.built === built) {
				c.ready = b;
				c.readySig = sig;
			}
		},
		(error) => {
			if (c.built === built) {
				c.built = undefined;
				c.sig = undefined;
				c.error = {
					sig,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);
	return built;
};

export type WrappedStatus =
	| { status: "ready"; built: Built }
	| { status: "loading"; progress: string }
	| { status: "error"; message: string };

// Like getWrapped, but never waits: if the snapshot isn't ready it starts building it and says so, and the page asking is sent an update when it is ready (a "wrappedReady" event). Pages use it to show a placeholder at once instead of nothing.
export const getWrappedStatus = (retry: boolean): WrappedStatus => {
	touch();
	const lid = g.get("lid");
	if (!state || state.lid !== lid || state.epoch !== changeLog.epoch) {
		state = newCache(lid);
	}
	const c = state;
	const sig = signature();
	if (c.ready && c.readySig === sig) {
		return { status: "ready", built: c.ready };
	}
	if (retry) {
		c.error = undefined;
	}
	if (c.error) {
		return { status: "error", message: c.error.message };
	}
	if (!c.built || c.sig !== sig) {
		c.progress = "Starting";
	}
	// Tell the page once when what it is waiting for is done, however the build was started
	const built = getWrapped();
	if (c.notified !== built) {
		c.notified = built;
		const notify = () => {
			void toUI("realtimeUpdate", [["wrappedReady"]]);
		};
		built.then(notify, notify);
	}
	return { status: "loading", progress: c.progress };
};

// A result derived from one snapshot, computed once (and shared by callers that ask while it is being computed)
export const memoize = <T>(
	built: Built,
	key: string,
	f: () => Promise<T> | T,
): Promise<T> => {
	let p = built.memo.get(key) as Promise<T> | undefined;
	if (!p) {
		p = Promise.resolve().then(f);
		built.memo.set(key, p);
		// A failure shouldn't stick
		p.catch(() => {
			if (built.memo.get(key) === p) {
				built.memo.delete(key);
			}
		});
	}
	return p;
};

// True while games are being simmed in bulk, when a page showing the snapshot should wait instead of rebuilding after every day
export const isBulkSimming = () =>
	lock.get("gameSim") || local.autoPlayUntil !== undefined;

// Kept so views can pass their update events; what changed is known from the change log instead
export const getWrappedIndex = async (
	_updateEvents?: ReadonlySet<UpdateEvent>,
) => (await getWrapped()).X;

// Drop everything kept for the league, like when something that bypasses the cache wrote to the database
export const resetWrappedCache = () => {
	state = undefined;
};
