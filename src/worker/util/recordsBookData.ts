// Records Book and Milestones (League extras, basketball): reads the league for the pure engine in
// common/recordsBook.ts, keeps the single-game highs and streaks as games are played, and announces league records
// broken and career milestones reached in the news.
//
// Players: everyone who ever played is read once per league, season and phase (retired players don't change within
// a phase) and the players in the cache, whose stats change with every game, are laid over that on every request.
//
// Single-game highs and streaks need box scores, which BBGM deletes after a while, so they are kept as games are
// played, in the "recordsBook" game attribute (like leagueAchievements: the league's own key-value store, carried by
// export/import). A league that never had it starts from the box scores it still has.
import { PHASE } from "../../common/constants.ts";
import {
	addGame,
	buildBook,
	crossed,
	emptyState,
	findChases,
	lineOf,
	MILESTONE_BIG,
	MILESTONE_STATS,
	MS_LOG_MAX,
	RB_STATS,
	RB_WORDS,
	reachedThisSeason,
	type RBCareerStat,
	type RBChase,
	type RBGameIn,
	type RBGameNews,
	type RBPlayer,
	type RBRow,
	type RBScope,
	type RBState,
	type RBStat,
	type RBTeamSeason,
} from "../../common/recordsBook.ts";
import type { Game, Player } from "../../common/types.ts";
import { idb } from "../db/index.ts";
import { g, helpers, local, lock, logEvent } from "./index.ts";
import { featureOn, featureOption } from "./nativeFeatures.ts";

const KEY = "recordsBook";

const num = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : 0;

const toRow = (s: any): RBRow => ({
	season: s.season,
	tid: s.tid,
	playoffs: !!s.playoffs,
	gp: num(s.gp),
	pts: num(s.pts),
	trb:
		s.orb !== undefined || s.drb !== undefined
			? num(s.orb) + num(s.drb)
			: num(s.trb),
	ast: num(s.ast),
	stl: num(s.stl),
	blk: num(s.blk),
	tp: num(s.tp),
});

export const toRBPlayer = (p: Player): RBPlayer => ({
	pid: p.pid,
	name: `${p.firstName} ${p.lastName}`.trim(),
	tid: p.tid,
	// Pre-draft (college) and other rows without a real team are left out
	rows: p.stats.filter((s) => s.tid >= 0 && num(s.gp) > 0).map(toRow),
});

// ---- players ----

const baseCache = new Map<string, Promise<Map<number, RBPlayer>>>();

const baseline = () => {
	const key = `${g.get("lid")}|${g.get("season")}|${g.get("phase")}`;
	let hit = baseCache.get(key);
	if (!hit) {
		hit = (async () => {
			const out = new Map<number, RBPlayer>();
			await idb.merged.players.getAll(
				{ activeAndRetired: true },
				{
					map: (p) => {
						if (p.stats.length > 0) {
							out.set(p.pid, toRBPlayer(p));
						}
						return undefined;
					},
				},
			);
			return out;
		})();
		baseCache.clear();
		baseCache.set(key, hit);
		hit.catch(() => baseCache.delete(key));
	}
	return hit;
};

// Every player who played, with the cache's players up to date
export const loadPlayers = async (): Promise<RBPlayer[]> => {
	const base = await baseline();
	const out = new Map(base);
	for (const p of await idb.cache.players.getAll()) {
		if (p.stats.length > 0) {
			out.set(p.pid, toRBPlayer(p));
		}
	}
	return [...out.values()];
};

const loadTeamSeasons = async (): Promise<RBTeamSeason[]> =>
	(await idb.merged.teamSeasons.getAll()).map((ts) => ({
		tid: ts.tid,
		season: ts.season,
		won: ts.won,
		lost: ts.lost,
		tied: ts.tied ?? 0,
		otl: ts.otl ?? 0,
	}));

// Team games played so far this regular season, by tid
const teamGamesByTid = async () => {
	const out = new Map<number, number>();
	for (const ts of await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[g.get("season")], [g.get("season"), "Z"]],
	)) {
		out.set(ts.tid, ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0));
	}
	return out;
};

// ---- state ----

const getState = (): RBState | undefined => {
	const s = Object.hasOwn(g, KEY) ? (g.get(KEY as any) as RBState) : undefined;
	return s && s.v === 1 ? s : undefined;
};

const saveState = async (state: RBState) => {
	if (state.ms.length > MS_LOG_MAX) {
		state.ms = state.ms.slice(-MS_LOG_MAX);
	}
	const value = structuredClone(state);
	g.setWithoutSavingToDB(KEY as any, value);
	await idb.cache.gameAttributes.put({ key: KEY, value } as any);
};

const toGameIn = (gm: Game): RBGameIn | undefined => {
	if (gm.teams.length !== 2 || gm.teams.some((t) => t.tid < 0)) {
		return undefined;
	}
	return {
		gid: gm.gid,
		season: gm.season,
		day: gm.day ?? 0,
		playoffs: !!gm.playoffs,
		teams: gm.teams.map((t) => ({
			tid: t.tid,
			pts: t.pts,
			players: (t.players as any[]).map(lineOf),
		})),
	};
};

// Career and single-season record holders as of now (regular season), for a league that starts tracking them
const seedRecords = (
	state: RBState,
	players: RBPlayer[],
	ts: RBTeamSeason[],
) => {
	for (const p of players) {
		const bySeason = new Map<number, Record<RBStat, number>>();
		const career = Object.fromEntries(RB_STATS.map((k) => [k, 0])) as Record<
			RBStat,
			number
		>;
		for (const r of p.rows) {
			if (r.playoffs) {
				continue;
			}
			let s = bySeason.get(r.season);
			if (!s) {
				s = Object.fromEntries(RB_STATS.map((k) => [k, 0])) as Record<
					RBStat,
					number
				>;
				bySeason.set(r.season, s);
			}
			for (const k of RB_STATS) {
				s[k] += r[k];
				career[k] += r[k];
			}
		}
		for (const k of RB_STATS) {
			const c = state.rec.career[k];
			if (!c || career[k] > c.v) {
				state.rec.career[k] = { p: p.pid, v: career[k] };
			}
			for (const [season, s] of bySeason) {
				const r = state.rec.season[k];
				if (!r || s[k] > r.v) {
					state.rec.season[k] = { p: p.pid, s: season, v: s[k] };
				}
			}
		}
	}
	for (const t of ts) {
		if (!state.rec.wins || t.won > state.rec.wins.v) {
			state.rec.wins = { t: t.tid, s: t.season, v: t.won };
		}
	}
};

// First run in a league: the box scores still stored, oldest first, and the record holders, without any news
const bootstrap = async (): Promise<RBState> => {
	const state = emptyState();
	const seasons: number[] = [];
	for (let s = g.get("startingSeason"); s <= g.get("season"); s++) {
		seasons.push(s);
	}
	for (const season of seasons) {
		const games = await idb.merged.games.getAll({ season });
		games.sort((a, b) => a.gid - b.gid);
		for (const gm of games) {
			const x = toGameIn(gm);
			if (x) {
				addGame(state, x, false);
			} else {
				state.lastGid = Math.max(state.lastGid, gm.gid);
			}
		}
	}
	seedRecords(state, await loadPlayers(), await loadTeamSeasons());
	return state;
};

// Minimum career total for a broken career record to be news (a new league's leaders change all the time)
const CAREER_NEWS_MIN: Record<RBStat, number> = {
	pts: 10000,
	trb: 5000,
	ast: 3000,
	stl: 800,
	blk: 800,
	tp: 800,
};

const esc = (s: string) =>
	s.replace(
		/["&<>]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
	);

const fmt = (n: number) => helpers.numberWithCommas(n);

type News = {
	text: string;
	pids: number[];
	tids: number[];
	score: number;
	notify: boolean;
};

// Lines of one player in the new games, in order
type Delta = {
	tid: number;
	lines: {
		gid: number;
		day: number;
		season: number;
		line: Record<RBCareerStat, number>;
	}[];
};

const runCheck = async () => {
	if (__SPORT !== "basketball" || !featureOn("recordsBook")) {
		return;
	}
	const lid = g.get("lid");
	let state = getState();
	if (!state && g.get("season") === g.get("startingSeason")) {
		// A new league: nothing to catch up on, so its first games are already news (milestones with their game)
		state = emptyState();
	}
	if (!state) {
		state = await bootstrap();
		if (g.get("lid") === lid) {
			await saveState(state);
		}
		return;
	}

	const games = (await idb.cache.games.getAll())
		.filter((gm) => gm.gid > state!.lastGid)
		.sort((a, b) => a.gid - b.gid);
	if (games.length === 0) {
		return;
	}

	const recordsNews =
		featureOption<boolean>("featureRecordsNews") && g.get("phase") >= 0;
	const userTids = new Set(g.get("userTids"));
	const newsList: News[] = [];
	const deltas = new Map<number, Delta>();
	const teamsPlayed = new Set<number>();
	const pName = new Map<number, string>();
	const nameOf = async (pid: number) => {
		if (!pName.has(pid)) {
			const p =
				(await idb.cache.players.get(pid)) ??
				(await idb.merged.players.get(pid));
			pName.set(pid, p ? `${p.firstName} ${p.lastName}`.trim() : "?");
		}
		return pName.get(pid)!;
	};
	const pLink = async (pid: number) =>
		`<a href="${helpers.leagueUrl(["player", pid])}">${esc(await nameOf(pid))}</a>`;
	const tName = (tid: number, season: number) =>
		`<a href="${helpers.leagueUrl(["roster", `${g.get("teamInfoCache")[tid]?.abbrev ?? tid}_${tid}`, season])}">${esc(
			g.get("teamInfoCache")[tid]?.region ?? "",
		)} ${esc(g.get("teamInfoCache")[tid]?.name ?? "")}</a>`;

	const gameNews: RBGameNews[] = [];
	for (const gm of games) {
		const x = toGameIn(gm);
		if (!x) {
			state.lastGid = Math.max(state.lastGid, gm.gid);
			continue;
		}
		gameNews.push(...addGame(state, x, recordsNews));
		if (x.playoffs) {
			continue;
		}
		for (const t of x.teams) {
			teamsPlayed.add(t.tid);
			for (const line of t.players) {
				if (!(line.min > 0)) {
					continue;
				}
				let d = deltas.get(line.pid);
				if (!d) {
					d = { tid: t.tid, lines: [] };
					deltas.set(line.pid, d);
				}
				d.tid = t.tid;
				d.lines.push({
					gid: x.gid,
					day: x.day,
					season: x.season,
					line: { ...line, gp: 1 },
				});
			}
		}
	}

	for (const n of gameNews) {
		if (n.kind === "game") {
			const w = RB_WORDS[n.stat];
			newsList.push({
				text: `${await pLink(n.high.p)} set the league record for ${w.unit} in a ${n.playoffs ? "playoff " : ""}game with ${n.high.v} (<a href="${helpers.leagueUrl(["game_log", `${g.get("teamInfoCache")[n.high.t]?.abbrev}_${n.high.t}`, n.high.s, n.high.g])}">box score</a>), breaking the ${n.prev.v} by ${await pLink(n.prev.p)} in ${n.prev.s}.`,
				pids: [n.high.p],
				tids: [n.high.t],
				score: 30,
				notify: true,
			});
		} else {
			newsList.push({
				text: `The ${tName(n.run.t, n.run.s)} have won ${n.run.n} straight games, the longest winning streak in league history (${n.prev.v} by the ${tName(n.prev.t, n.prev.s)} in ${n.prev.s}).`,
				pids: [],
				tids: [n.run.t],
				score: 30,
				notify: true,
			});
		}
	}

	const msNotify = featureOption<boolean>("featureMilestoneNotifications");
	for (const [pid, d] of deltas) {
		const p = await idb.cache.players.get(pid);
		if (!p) {
			continue;
		}
		const rb = toRBPlayer(p);
		const season = d.lines.at(-1)!.season;
		const now: Record<RBCareerStat, number> = {
			pts: 0,
			trb: 0,
			ast: 0,
			stl: 0,
			blk: 0,
			tp: 0,
			gp: 0,
		};
		const nowSeason = { ...now };
		for (const r of rb.rows) {
			if (r.playoffs) {
				continue;
			}
			for (const k of MILESTONE_STATS) {
				now[k] += r[k as keyof RBRow] as number;
				if (r.season === season) {
					nowSeason[k] += r[k as keyof RBRow] as number;
				}
			}
		}
		for (const k of MILESTONE_STATS) {
			const delta = d.lines.reduce((s, x) => s + x.line[k], 0);
			const before = now[k] - delta;

			// Career milestones, at the game they came in
			for (const t of crossed(k, before, now[k])) {
				let run = before;
				let at = d.lines.at(-1)!;
				for (const x of d.lines) {
					run += x.line[k];
					if (run >= t) {
						at = x;
						break;
					}
				}
				state.ms.push({
					p: pid,
					k,
					t,
					s: at.season,
					tm: d.tid,
					day: at.day,
					g: at.gid,
				});
				const mine = userTids.has(d.tid);
				if (mine || t >= MILESTONE_BIG[k]) {
					newsList.push({
						text: `${await pLink(pid)} reached ${fmt(t)} career ${RB_WORDS[k].unit}${k === "gp" ? " played" : ""} (<a href="${helpers.leagueUrl(["milestones"])}">milestones</a>).`,
						pids: [pid],
						tids: [d.tid],
						score: t >= MILESTONE_BIG[k] ? 20 : 10,
						notify: mine && msNotify,
					});
				}
			}

			if (k === "gp" || !recordsNews) {
				continue;
			}
			// League career record
			const c = state.rec.career[k];
			if (!c || now[k] > c.v) {
				if (c && c.p !== pid && before <= c.v && c.v >= CAREER_NEWS_MIN[k]) {
					newsList.push({
						text: `${await pLink(pid)} passed ${await pLink(c.p)} (${fmt(c.v)}) for the most career ${RB_WORDS[k].unit} in league history (<a href="${helpers.leagueUrl(["records_book"])}">records book</a>).`,
						pids: [pid, c.p],
						tids: [d.tid],
						score: 30,
						notify: true,
					});
				}
				state.rec.career[k] = { p: pid, v: now[k] };
			}
			// League single-season record (totals)
			const s = state.rec.season[k];
			if (!s || nowSeason[k] > s.v) {
				if (s && !(s.p === pid && s.s === season) && s.s < season) {
					newsList.push({
						text: `${await pLink(pid)} set the league record for ${RB_WORDS[k].unit} in a season (${fmt(nowSeason[k])} and counting), passing ${fmt(s.v)} by ${await pLink(s.p)} in ${s.s}.`,
						pids: [pid, s.p],
						tids: [d.tid],
						score: 30,
						notify: true,
					});
				}
				state.rec.season[k] = { p: pid, s: season, v: nowSeason[k] };
			}
		}
	}

	// Most wins in a season
	if (recordsNews && teamsPlayed.size > 0) {
		const season = g.get("season");
		for (const tid of teamsPlayed) {
			const ts = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsByTidSeason",
				[tid, season],
			);
			if (!ts) {
				continue;
			}
			const w = state.rec.wins;
			if (!w || ts.won > w.v) {
				if (w && !(w.t === tid && w.s === season) && w.s < season) {
					newsList.push({
						text: `The ${tName(tid, season)} won their ${ts.won}th game, the most in a season in league history (${w.v} by the ${tName(w.t, w.s)} in ${w.s}).`,
						pids: [],
						tids: [tid],
						score: 30,
						notify: true,
					});
				}
				state.rec.wins = { t: tid, s: season, v: ts.won };
			}
		}
	}

	if (g.get("lid") !== lid) {
		return;
	}
	await saveState(state);
	for (const n of newsList) {
		await logEvent({
			type: "playerFeat",
			text: n.text,
			pids: n.pids,
			tids: n.tids,
			score: n.score,
			showNotification: n.notify,
			saveToDb: true,
		});
	}
};

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;

const busy = () =>
	lock.get("gameSim") ||
	lock.get("newPhase") ||
	local.autoPlayUntil !== undefined;

// Called after each day of games: debounced, waits while games are simmed in bulk (the check works from the box
// scores not seen yet, so nothing is lost by waiting)
export const scheduleRecordsCheck = (delay = 1200) => {
	if (__SPORT !== "basketball" || !featureOn("recordsBook")) {
		return;
	}
	clearTimeout(timer);
	timer = setTimeout(async () => {
		timer = undefined;
		try {
			g.get("lid");
		} catch {
			return;
		}
		if (busy()) {
			scheduleRecordsCheck(3000);
			return;
		}
		if (running) {
			again = true;
			return;
		}
		running = true;
		try {
			await runCheck();
		} catch (error) {
			console.error("Records check failed", error);
		} finally {
			running = false;
			if (again) {
				again = false;
				scheduleRecordsCheck();
			}
		}
	}, delay);
	(timer as { unref?: () => void }).unref?.();
};

// For tests and the views: run the check now
export const recordsCheckNow = runCheck;

// ---- views ----

const ctxNow = async () => {
	const season = g.get("season");
	const games = await teamGamesByTid();
	return {
		season,
		numGames: (s: number) => g.get("numGames", s) as number,
		teamGamesNow: Math.max(0, ...games.values()),
		regularSeasonDone: g.get("phase") > PHASE.REGULAR_SEASON,
	};
};

export const getRecordsBook = async (scope: RBScope) => {
	// The state is brought up to date first, so single-game highs include today's games
	if (!busy() && !running) {
		running = true;
		try {
			await runCheck();
		} finally {
			running = false;
		}
	}
	const [players, teamSeasons, ctx] = await Promise.all([
		loadPlayers(),
		loadTeamSeasons(),
		ctxNow(),
	]);
	return buildBook({
		players,
		teamSeasons,
		state: getState(),
		ctx,
		scope,
	});
};

export type MilestoneRow = RBChase & {
	// Projected game: this season's schedule when it falls in it
	when:
		| { type: "game"; day: number; oppTid: number; home: boolean; n: number }
		| { type: "nextSeason"; n: number }
		| { type: "later" };
};

export type ReachedRow = {
	pid: number;
	name: string;
	tid: number;
	k: RBCareerStat;
	t: number;
	season: number;
	day?: number;
	gid?: number;
};

export const getMilestones = async ({
	tid,
	horizon,
}: {
	tid?: number;
	horizon: "season" | "two";
}) => {
	const season = g.get("season");
	const phase = g.get("phase");
	const numGames = g.get("numGames") as number;
	const [players, gamesByTid, schedule] = await Promise.all([
		loadPlayers(),
		teamGamesByTid(),
		idb.cache.schedule.getAll(),
	]);
	const inSeason = phase <= PHASE.REGULAR_SEASON;
	const remaining = (t: number) =>
		inSeason ? Math.max(0, numGames - (gamesByTid.get(t) ?? 0)) : 0;
	const maxRemaining = Math.max(0, ...[...gamesByTid.keys()].map(remaining));
	const h =
		horizon === "season"
			? inSeason
				? maxRemaining
				: numGames
			: (inSeason ? maxRemaining : 0) + numGames;
	const sorted = schedule
		.filter((x) => x.homeTid >= 0 && x.awayTid >= 0)
		.sort((a, b) => a.day - b.day || a.gid - b.gid);

	const chases = findChases({
		players,
		season,
		teamGamesNow: (t) => gamesByTid.get(t) ?? 0,
		horizon: h,
	}).filter((c) => tid === undefined || c.tid === tid);

	const rows: MilestoneRow[] = chases.slice(0, 400).map((c) => {
		const left = remaining(c.tid);
		let when: MilestoneRow["when"];
		if (c.teamGames <= left) {
			const own = sorted.filter(
				(x) => x.homeTid === c.tid || x.awayTid === c.tid,
			);
			const gm = own[Math.max(0, c.teamGames - 1)];
			when = gm
				? {
						type: "game",
						day: gm.day,
						oppTid: gm.homeTid === c.tid ? gm.awayTid : gm.homeTid,
						home: gm.homeTid === c.tid,
						n: (gamesByTid.get(c.tid) ?? 0) + c.teamGames,
					}
				: { type: "later" };
		} else if (c.teamGames - left <= numGames) {
			when = { type: "nextSeason", n: c.teamGames - left };
		} else {
			when = { type: "later" };
		}
		return { ...c, when };
	});

	// Reached this season, with the game from the check's log when it has it
	const log = getState()?.ms ?? [];
	const reached: ReachedRow[] = reachedThisSeason(players, season)
		.filter((x) => tid === undefined || x.tid === tid)
		.map((x) => {
			const hit = log.findLast(
				(m) => m.p === x.pid && m.k === x.k && m.t === x.t,
			);
			return {
				...x,
				season,
				day: hit?.day,
				gid: hit?.g,
				tid: hit?.tm ?? x.tid,
			};
		})
		.sort(
			(a, b) => (b.gid ?? -1) - (a.gid ?? -1) || b.t - a.t || a.pid - b.pid,
		);
	// Earlier seasons from the log
	const older: ReachedRow[] = log
		.filter((m) => m.s < season && (tid === undefined || m.tm === tid))
		.slice(-30)
		.reverse()
		.map((m) => ({
			pid: m.p,
			name: players.find((p) => p.pid === m.p)?.name ?? "?",
			tid: m.tm,
			k: m.k,
			t: m.t,
			season: m.s,
			day: m.day,
			gid: m.g,
		}));

	return { rows, reached: [...reached, ...older].slice(0, 60), inSeason };
};

// Dashboard card: your players' next milestones and recent ones
export const getMilestoneCard = async () => {
	const tid = g.get("userTid");
	const { rows, reached } = await getMilestones({ tid, horizon: "season" });
	return {
		upcoming: rows.slice(0, 5),
		reached: reached.slice(0, 3),
	};
};
