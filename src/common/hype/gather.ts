// Builds the engine's input for one game from a season snapshot (HRaw): the state of the league just before the game, using only games played before it.
import type {
	HGame,
	HGameInput,
	HLine,
	HListed,
	HPlayerRaw,
	HRaw,
	HResult,
	HRow,
	HSeries,
	HSeriesState,
	HStanding,
	HTeamState,
} from "./types.ts";

export type Target = {
	gid: number;
	day: number;
	homeTid: number;
	awayTid: number;
	playoffs: boolean;
	playIn: boolean;
	// Finished and stored in raw.games
	completed: boolean;
};

const phaseRank = (g: { playoffs: boolean; playIn: boolean }) =>
	g.playIn ? 1 : g.playoffs ? 2 : 0;

// Did a stored game come before the target? Everything stored is before an upcoming game. Regular season games are ordered by day (games on the same day are not before each other), later games by gid, which follows the order they were played in.
const isBefore = (g: HGame, t: Target) => {
	if (!t.completed) {
		return true;
	}
	const a = phaseRank(g);
	const b = phaseRank(t);
	if (a !== b) {
		return a < b;
	}
	if (a === 0 && g.day > 0 && t.day > 0) {
		return g.day < t.day;
	}
	return g.gid < t.gid;
};

type Index = {
	byGid: Map<number, HGame>;
	// Finished games oldest first
	sorted: HGame[];
	lines: Map<number, HLine[]>;
	series: Map<number, HSeries[]>;
};

const cache = new WeakMap<HGame[], Index>();
const playerCache = new WeakMap<HPlayerRaw[], Map<number, HPlayerRaw>>();

const ord = (a: HGame, b: HGame) =>
	phaseRank(a) - phaseRank(b) ||
	(phaseRank(a) === 0 ? a.day - b.day : 0) ||
	a.gid - b.gid;

const indexOf = (raw: HRaw): Index => {
	const hit = cache.get(raw.games);
	if (hit) {
		return hit;
	}
	const sorted = [...raw.games].sort(ord);
	const lines = new Map<number, HLine[]>();
	for (const g of sorted) {
		for (const [ti, t] of g.teams.entries()) {
			const o = g.teams[1 - ti]!;
			for (const p of t.players) {
				if (!(p.min > 0)) {
					continue;
				}
				let arr = lines.get(p.pid);
				if (!arr) {
					lines.set(p.pid, (arr = []));
				}
				arr.push({
					gid: g.gid,
					season: g.season,
					day: g.day,
					tid: t.tid,
					oppTid: o.tid,
					won: t.pts > o.pts,
					min: p.min,
					pts: p.pts,
					trb: p.trb,
					ast: p.ast,
					stl: p.stl,
					blk: p.blk,
					tp: p.tp,
					po: g.playoffs,
				});
			}
		}
	}
	const series = new Map<number, HSeries[]>();
	for (const s of raw.series) {
		for (const tid of [s.home.tid, s.away?.tid]) {
			if (tid === undefined) {
				continue;
			}
			let arr = series.get(tid);
			if (!arr) {
				series.set(tid, (arr = []));
			}
			arr.push(s);
		}
	}
	const idx: Index = {
		byGid: new Map(raw.games.map((g) => [g.gid, g])),
		sorted,
		lines,
		series,
	};
	cache.set(raw.games, idx);
	return idx;
};

const playersOf = (raw: HRaw) => {
	let m = playerCache.get(raw.players);
	if (!m) {
		m = new Map(raw.players.map((p) => [p.pid, p]));
		playerCache.set(raw.players, m);
	}
	return m;
};

const teamInfo = (raw: HRaw, tid: number) =>
	raw.teams.find((t) => t.tid === tid);

// Regular season record and streak going into the target, from the stored games
const recordFrom = (raw: HRaw, idx: Index, tid: number, t: Target) => {
	let won = 0;
	let lost = 0;
	let streak = 0;
	for (const g of idx.sorted) {
		if (g.playoffs || g.playIn || !isBefore(g, t)) {
			continue;
		}
		const i =
			g.teams[0].tid === tid ? 0 : g.teams[1].tid === tid ? 1 : undefined;
		if (i === undefined) {
			continue;
		}
		const w = g.teams[i]!.pts > g.teams[1 - i]!.pts;
		if (w) {
			won++;
			streak = streak > 0 ? streak + 1 : 1;
		} else {
			lost++;
			streak = streak < 0 ? streak - 1 : -1;
		}
	}
	return { won, lost, streak };
};

const teamState = (
	raw: HRaw,
	idx: Index,
	tid: number,
	t: Target,
	game: HGame | undefined,
	seed: number | undefined,
): HTeamState => {
	const info = teamInfo(raw, tid);
	let won = 0;
	let lost = 0;
	let tied = 0;
	let otl = 0;
	let streak = 0;
	let ovr: number | null = null;
	if (game) {
		// the record stored with the box score is the one after the game: take this game off it
		const i = game.teams[0].tid === tid ? 0 : 1;
		const me = game.teams[i]!;
		const w = me.pts > game.teams[1 - i]!.pts;
		if (
			!game.playoffs &&
			!game.playIn &&
			me.won !== undefined &&
			me.lost !== undefined
		) {
			won = me.won - (w ? 1 : 0);
			lost = me.lost - (w ? 0 : 1);
			tied = me.tied ?? 0;
			otl = me.otl ?? 0;
		} else {
			// playoff games carry the regular season record
			const r = recordFrom(raw, idx, tid, {
				...t,
				playoffs: true,
				playIn: false,
			});
			won = r.won;
			lost = r.lost;
		}
		if (raw.linesComplete) {
			streak = recordFrom(raw, idx, tid, t).streak;
		}
		ovr = me.ovr ?? null;
	} else {
		const now = raw.teamNow?.[tid];
		if (now) {
			({ won, lost, tied, otl, streak } = now);
			ovr = now.ovr ?? null;
		}
	}
	return {
		tid,
		abbrev: info?.abbrev ?? "",
		name: info?.name ?? "",
		won,
		lost,
		tied,
		otl,
		streak,
		ovr,
		cid: info?.cid ?? -1,
		did: info?.did ?? -1,
		seed,
	};
};

const standingsFor = (raw: HRaw, idx: Index, t: Target): HStanding[] | null => {
	if (t.playoffs || t.playIn) {
		return null;
	}
	const group = (tid: number) =>
		raw.playoffsByConf ? (teamInfo(raw, tid)?.cid ?? 0) : 0;
	if (!t.completed && raw.teamNow) {
		return Object.entries(raw.teamNow).map(([tid, x]) => ({
			tid: Number(tid),
			won: x.won,
			lost: x.lost + x.otl,
			group: group(Number(tid)),
		}));
	}
	if (!raw.linesComplete) {
		return null;
	}
	const rec = new Map<number, { won: number; lost: number }>();
	for (const tm of raw.teams) {
		rec.set(tm.tid, { won: 0, lost: 0 });
	}
	for (const g of idx.sorted) {
		if (g.playoffs || g.playIn || !isBefore(g, t)) {
			continue;
		}
		const [a, b] = g.teams;
		const wa = a.pts > b.pts;
		const ra = rec.get(a.tid);
		const rb = rec.get(b.tid);
		if (ra) {
			ra[wa ? "won" : "lost"]++;
		}
		if (rb) {
			rb[wa ? "lost" : "won"]++;
		}
	}
	return [...rec.entries()].map(([tid, r]) => ({
		tid,
		won: r.won,
		lost: r.lost,
		group: group(tid),
	}));
};

const seriesStateFor = (
	raw: HRaw,
	idx: Index,
	t: Target,
): HSeriesState | null => {
	if (!t.playoffs && !t.playIn) {
		return null;
	}
	const cands = (idx.series.get(t.homeTid) ?? []).filter(
		(s) =>
			s.season === raw.season &&
			!!s.playIn === t.playIn &&
			(s.home.tid === t.awayTid || s.away?.tid === t.awayTid),
	);
	let info: HSeries | undefined;
	if (t.completed) {
		info = cands.find((s) => s.gids.includes(t.gid));
	} else {
		// the latest round the two teams meet in (a repeat of a round cannot happen)
		info = [...cands].sort((a, b) => b.round - a.round)[0];
	}
	if (!info) {
		return null;
	}
	const before = [];
	let idxGame = 0;
	for (const gid of info.gids) {
		if (gid === t.gid) {
			break;
		}
		const g = idx.byGid.get(gid);
		if (!g || (t.completed && !isBefore(g, t))) {
			continue;
		}
		const [a, b] = g.teams;
		const aw = a.pts > b.pts;
		before.push({
			gid,
			winTid: aw ? a.tid : b.tid,
			loseTid: aw ? b.tid : a.tid,
			winPts: Math.max(a.pts, b.pts),
			losePts: Math.min(a.pts, b.pts),
			ot: g.overtimes,
			homeTid: a.tid,
		});
		idxGame++;
	}
	// the series so far must be fully stored, or its state is unknown
	const played = t.completed
		? info.gids.indexOf(t.gid)
		: info.home.won + (info.away?.won ?? 0);
	if (played !== idxGame) {
		return null;
	}
	return { info, before, index: idxGame };
};

const sumRows = (lines: HLine[], season: number): HRow[] => {
	const by = new Map<number, HRow>();
	for (const l of lines) {
		if (l.po || l.season !== season) {
			continue;
		}
		let r = by.get(l.tid);
		if (!r) {
			by.set(
				l.tid,
				(r = {
					season,
					tid: l.tid,
					gp: 0,
					pts: 0,
					trb: 0,
					ast: 0,
					stl: 0,
					blk: 0,
					tp: 0,
					min: 0,
				}),
			);
		}
		r.gp += 1;
		r.pts! += l.pts;
		r.trb! += l.trb;
		r.ast! += l.ast;
		r.stl! += l.stl;
		r.blk! += l.blk;
		r.tp! += l.tp;
		r.min! += l.min;
	}
	return [...by.values()];
};

const listedFor = (
	raw: HRaw,
	idx: Index,
	p: HPlayerRaw,
	tid: number,
	t: Target,
): HListed => {
	const all = idx.lines.get(p.pid) ?? [];
	const before = all.filter((l) => {
		const g = idx.byGid.get(l.gid);
		return g ? isBefore(g, t) : false;
	});
	let cur: HRow[] | null = null;
	if (raw.linesComplete) {
		cur = sumRows(before, raw.season);
	} else if (!t.completed) {
		cur = p.rows.filter((r) => r.season === raw.season);
	}
	return {
		pid: p.pid,
		name: p.name,
		tid,
		ovr: p.ovrBySeason[raw.season] ?? null,
		draft: p.draft,
		rows: p.rows.filter((r) => r.season < raw.season),
		cur,
		lines: before.filter((l) => l.season === raw.season),
		prevLines: [],
		prevLinesSeason: null,
		ovrBySeason: p.ovrBySeason,
		allStar: p.allStar,
		moves: p.moves,
		released: p.released,
	};
};

const envFor = (idx: Index, t: Target) => {
	let n = 0;
	let sum = 0;
	let sq = 0;
	let hiTeam = 0;
	for (const g of idx.sorted) {
		if (g.playoffs || g.playIn || !isBefore(g, t)) {
			continue;
		}
		const tot = g.teams[0].pts + g.teams[1].pts;
		if (!tot) {
			continue;
		}
		n++;
		sum += tot;
		sq += tot * tot;
		hiTeam = Math.max(hiTeam, g.teams[0].pts, g.teams[1].pts);
	}
	const mean = n ? sum / n : 0;
	const sd = n > 1 ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0;
	return { n, mean, sd, hiTeam };
};

export const targetOfGame = (g: HGame): Target => ({
	gid: g.gid,
	day: g.day,
	homeTid: g.teams[0].tid,
	awayTid: g.teams[1].tid,
	playoffs: g.playoffs,
	playIn: g.playIn,
	completed: true,
});

export const inputFor = (raw: HRaw, t: Target): HGameInput | null => {
	const idx = indexOf(raw);
	const game = t.completed ? idx.byGid.get(t.gid) : undefined;
	if (t.completed && !game) {
		return null;
	}
	const state = seriesStateFor(raw, idx, t);
	const seedOf = (tid: number) =>
		state?.info.home.tid === tid
			? state.info.home.seed
			: state?.info.away?.tid === tid
				? state.info.away.seed
				: undefined;
	const home = teamState(raw, idx, t.homeTid, t, game, seedOf(t.homeTid));
	const away = teamState(raw, idx, t.awayTid, t, game, seedOf(t.awayTid));
	const players = [t.homeTid, t.awayTid].map((tid, ti): HListed[] => {
		if (game) {
			const out: HListed[] = [];
			for (const bl of game.teams[ti]!.players) {
				const p = playersOf(raw).get(bl.pid);
				if (!p || (bl.inj && !(bl.min > 0))) {
					continue;
				}
				out.push(listedFor(raw, idx, p, tid, t));
			}
			return out;
		}
		const outPids = new Set(raw.out?.[tid] ?? []);
		return raw.players
			.filter((p) => p.tid === tid && !outPids.has(p.pid))
			.map((p) => listedFor(raw, idx, p, tid, t));
	}) as [HListed[], HListed[]];
	const teamName: Record<number, string> = {};
	for (const tm of raw.teams) {
		teamName[tm.tid] = tm.name;
	}
	return {
		gid: t.gid,
		season: raw.season,
		day: t.day,
		playoffs: t.playoffs && !t.playIn,
		playIn: t.playIn,
		numGames: raw.numGames,
		teams: [home, away],
		players,
		standings: standingsFor(raw, idx, t),
		maxPlayoffSeed: raw.maxPlayoffSeed,
		series: raw.series,
		seriesState: state,
		records: raw.records,
		starCut: raw.records?.starCut[raw.season] ?? null,
		env: t.completed ? envFor(idx, t) : null,
		linesFrom: raw.linesComplete ? raw.season : Number.POSITIVE_INFINITY,
		teamName,
	};
};

export const resultFor = (raw: HRaw, gid: number): HResult | null => {
	const idx = indexOf(raw);
	const g = idx.byGid.get(gid);
	if (!g) {
		return null;
	}
	const [a, b] = g.teams;
	const aw = a.pts > b.pts;
	const winTid = aw ? a.tid : b.tid;
	const t = targetOfGame(g);
	const state = seriesStateFor(raw, idx, t);
	const lastGameOfSeries =
		!!state && state.info.gids.at(-1) === gid && state.info.numToWin > 0;
	let clinchedTitle = false;
	if (
		state &&
		lastGameOfSeries &&
		state.info.round === state.info.numRounds - 1
	) {
		const winSide =
			state.info.home.tid === winTid ? state.info.home : state.info.away;
		clinchedTitle = !!winSide && winSide.won >= state.info.numToWin;
	}
	return {
		winTid,
		loseTid: aw ? b.tid : a.tid,
		homeTid: a.tid,
		winPts: Math.max(a.pts, b.pts),
		losePts: Math.min(a.pts, b.pts),
		overtimes: g.overtimes,
		teams: g.teams,
		clutch: g.clutch,
		lastGameOfSeries,
		clinchedTitle,
	};
};

export const hasStored = (raw: HRaw, gid: number) =>
	indexOf(raw).byGid.has(gid);
export const storedGame = (raw: HRaw, gid: number) =>
	indexOf(raw).byGid.get(gid);
export const storedGames = (raw: HRaw) => indexOf(raw).sorted;
