// Player page all-time and franchise rankings (League extras, basketball, an option of the Records Book): pure functions
// shared by the worker (worker/util/playerRankingsData.ts) and the tests. Nothing here touches the database.
//
// Retired players' career totals don't change, so their top lists are kept (the "playerRankings" game attribute) and
// only the players who retire in a season are added once it's over (a retiredYear watermark). Players still in the
// cache, and those who retired this season, are read live and laid over the kept lists when a board is built.

export const PR_STATS = [
	"pts",
	"trb",
	"ast",
	"stl",
	"blk",
	"tp",
	"ft",
	"gp",
	"min",
	"dd",
	"td",
	"ws",
	"vorp",
] as const;
export type PRStat = (typeof PR_STATS)[number];

// Single-season totals (regular season, all teams of the season) that are ranked too
export const PR_SEASON_STATS = [
	"pts",
	"trb",
	"ast",
	"stl",
	"blk",
	"tp",
] as const;
export type PRSeasonStat = (typeof PR_SEASON_STATS)[number];

export const PR_INFO: Record<
	PRStat,
	{ label: string; unit: string; d: number; weight: number }
> = {
	pts: { label: "Points", unit: "points", d: 0, weight: 1 },
	trb: { label: "Rebounds", unit: "rebounds", d: 0, weight: 0.9 },
	ast: { label: "Assists", unit: "assists", d: 0, weight: 0.9 },
	stl: { label: "Steals", unit: "steals", d: 0, weight: 0.8 },
	blk: { label: "Blocks", unit: "blocks", d: 0, weight: 0.8 },
	tp: { label: "Three-pointers", unit: "three-pointers", d: 0, weight: 0.8 },
	ft: { label: "Free throws", unit: "free throws made", d: 0, weight: 0.55 },
	gp: { label: "Games", unit: "games played", d: 0, weight: 0.65 },
	min: { label: "Minutes", unit: "minutes", d: 0, weight: 0.6 },
	dd: { label: "Double-doubles", unit: "double-doubles", d: 0, weight: 0.7 },
	td: { label: "Triple-doubles", unit: "triple-doubles", d: 0, weight: 0.75 },
	ws: { label: "Win shares", unit: "win shares", d: 1, weight: 0.85 },
	vorp: { label: "VORP", unit: "VORP", d: 1, weight: 0.8 },
};

// Kept list lengths: the largest thresholds below
export const PR_LEAGUE_K = 50;
export const PR_FRANCHISE_K = 10;
export const PR_SEASON_K = 10;

export type PRTotals = Record<PRStat, number>;

// A regular season or playoffs stats row of one player with one team
export type PRRow = PRTotals & {
	season: number;
	tid: number;
	playoffs: boolean;
};

const num = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : 0;

const round = (x: number, d: number) => {
	const f = 10 ** d;
	return Math.round(x * f) / f;
};

// A stored stats row, as ranked here. Rows without a real team (pre-draft, college) or games are left out.
export const prRowOf = (s: any): PRRow | undefined => {
	if (!s || !(s.tid >= 0) || !(num(s.gp) > 0)) {
		return undefined;
	}
	return {
		season: s.season,
		tid: s.tid,
		playoffs: !!s.playoffs,
		pts: num(s.pts),
		trb:
			s.orb !== undefined || s.drb !== undefined
				? num(s.orb) + num(s.drb)
				: num(s.trb),
		ast: num(s.ast),
		stl: num(s.stl),
		blk: num(s.blk),
		tp: num(s.tp),
		ft: num(s.ft),
		gp: num(s.gp),
		min: num(s.min),
		dd: num(s.dd),
		td: num(s.td),
		ws: num(s.ows) + num(s.dws),
		vorp: num(s.vorp),
	};
};

export const prRowsOf = (stats: readonly unknown[]) => {
	const out: PRRow[] = [];
	for (const s of stats) {
		const r = prRowOf(s);
		if (r) {
			out.push(r);
		}
	}
	return out;
};

const zero = (): PRTotals =>
	Object.fromEntries(PR_STATS.map((k) => [k, 0])) as PRTotals;

const add = (t: PRTotals, r: PRRow) => {
	for (const k of PR_STATS) {
		t[k] += r[k];
	}
};

export type PRCareer = {
	// 0 = regular season, 1 = playoffs
	all: [PRTotals | undefined, PRTotals | undefined];
	// By tid (franchise = tid, so a relocated team stays one franchise)
	fr: [Map<number, PRTotals>, Map<number, PRTotals>];
	// Regular season totals by season (all teams)
	seasons: Map<number, PRTotals>;
	minSeason: number;
	// Earliest season with each franchise
	frMin: Map<number, number>;
};

export const prCareer = (rows: readonly PRRow[]): PRCareer => {
	const out: PRCareer = {
		all: [undefined, undefined],
		fr: [new Map(), new Map()],
		seasons: new Map(),
		minSeason: Infinity,
		frMin: new Map(),
	};
	for (const r of rows) {
		const i = r.playoffs ? 1 : 0;
		const all = (out.all[i] ??= zero());
		add(all, r);
		let fr = out.fr[i].get(r.tid);
		if (!fr) {
			fr = zero();
			out.fr[i].set(r.tid, fr);
		}
		add(fr, r);
		if (!r.playoffs) {
			let s = out.seasons.get(r.season);
			if (!s) {
				s = zero();
				out.seasons.set(r.season, s);
			}
			add(s, r);
		}
		out.minSeason = Math.min(out.minSeason, r.season);
		out.frMin.set(r.tid, Math.min(out.frMin.get(r.tid) ?? Infinity, r.season));
	}
	return out;
};

// [pid, value] or, in season lists, [pid, value, season]
export type PREntry = [number, number] | [number, number, number];

export const keyLeague = (k: PRStat, po: 0 | 1) => `L|${k}|${po}`;
export const keyFranchise = (tid: number, k: PRStat, po: 0 | 1) =>
	`F|${tid}|${k}|${po}`;
export const keySeason = (k: PRSeasonStat) => `S|${k}`;

const kOfKey = (key: string) =>
	key.startsWith("L|")
		? PR_LEAGUE_K
		: key.startsWith("F|")
			? PR_FRANCHISE_K
			: PR_SEASON_K;

const cmpEntry = (a: PREntry, b: PREntry) =>
	b[1] - a[1] || a[0] - b[0] || (a[2] ?? 0) - (b[2] ?? 0);

export type PRState = {
	v: 1;
	// Players who retired in this season or earlier are in the lists
	through: number;
	// Players in the lists (with any pro stats), by franchise too: they scale the thresholds
	n: number;
	nFr: Record<string, number>;
	// Earliest season with stats, in the league and per franchise
	minSeason: number | null;
	frMin: Record<string, number>;
	lists: Record<string, PREntry[]>;
};

export const prEmpty = (through: number): PRState => ({
	v: 1,
	through,
	n: 0,
	nFr: {},
	minSeason: null,
	frMin: {},
	lists: {},
});

// Each (key, entry) a player's career gives
const entriesOf = (pid: number, c: PRCareer) => {
	const out: [string, PREntry][] = [];
	for (const po of [0, 1] as const) {
		const all = c.all[po];
		if (all) {
			for (const k of PR_STATS) {
				const v = round(all[k], PR_INFO[k].d);
				if (v > 0) {
					out.push([keyLeague(k, po), [pid, v]]);
				}
			}
		}
		for (const [tid, t] of c.fr[po]) {
			for (const k of PR_STATS) {
				const v = round(t[k], PR_INFO[k].d);
				if (v > 0) {
					out.push([keyFranchise(tid, k, po), [pid, v]]);
				}
			}
		}
	}
	for (const [season, t] of c.seasons) {
		for (const k of PR_SEASON_STATS) {
			if (t[k] > 0) {
				out.push([keySeason(k), [pid, t[k], season]]);
			}
		}
	}
	return out;
};

const insertSorted = (list: PREntry[], e: PREntry, n: number) => {
	let i = list.findIndex((x) => cmpEntry(e, x) < 0);
	if (i < 0) {
		i = list.length;
	}
	if (i >= n) {
		return;
	}
	list.splice(i, 0, e);
	if (list.length > n) {
		list.length = n;
	}
};

// Add a retired player to the kept lists (again after a comeback: his old entries are replaced)
export const prAddRetired = (
	state: PRState,
	pid: number,
	rows: readonly PRRow[],
) => {
	if (rows.length === 0) {
		return;
	}
	for (const list of Object.values(state.lists)) {
		for (let i = list.length - 1; i >= 0; i--) {
			if (list[i]![0] === pid) {
				list.splice(i, 1);
			}
		}
	}
	const c = prCareer(rows);
	for (const [key, e] of entriesOf(pid, c)) {
		const list = (state.lists[key] ??= []);
		insertSorted(list, e, kOfKey(key));
	}
	state.n += 1;
	for (const [tid, s] of c.frMin) {
		state.nFr[tid] = (state.nFr[tid] ?? 0) + 1;
		state.frMin[tid] = Math.min(state.frMin[tid] ?? Infinity, s);
	}
	state.minSeason = Math.min(state.minSeason ?? Infinity, c.minSeason);
};

export type PRLivePlayer = { pid: number; rows: readonly PRRow[] };

// The kept lists with the live players laid over them (their kept entries, from before a comeback, are dropped)
export type PRBoard = {
	lists: Map<string, PREntry[]>;
	n: number;
	nFr: Map<number, number>;
	minSeason: number;
	frMin: Map<number, number>;
};

export const prBuildBoard = (
	state: PRState,
	live: readonly PRLivePlayer[],
): PRBoard => {
	const livePids = new Set(live.map((p) => p.pid));
	const add = new Map<string, PREntry[]>();
	const nFr = new Map<number, number>(
		Object.entries(state.nFr).map(([t, n]) => [Number(t), n]),
	);
	const frMin = new Map<number, number>(
		Object.entries(state.frMin).map(([t, s]) => [Number(t), s]),
	);
	let n = state.n;
	let minSeason = state.minSeason ?? Infinity;
	for (const p of live) {
		if (p.rows.length === 0) {
			continue;
		}
		const c = prCareer(p.rows);
		for (const [key, e] of entriesOf(p.pid, c)) {
			let arr = add.get(key);
			if (!arr) {
				arr = [];
				add.set(key, arr);
			}
			arr.push(e);
		}
		n += 1;
		for (const [tid, s] of c.frMin) {
			nFr.set(tid, (nFr.get(tid) ?? 0) + 1);
			frMin.set(tid, Math.min(frMin.get(tid) ?? Infinity, s));
		}
		minSeason = Math.min(minSeason, c.minSeason);
	}
	const lists = new Map<string, PREntry[]>();
	for (const key of new Set([...Object.keys(state.lists), ...add.keys()])) {
		const kept = (state.lists[key] ?? []).filter((e) => !livePids.has(e[0]));
		const merged = [...kept, ...(add.get(key) ?? [])].sort(cmpEntry);
		merged.length = Math.min(merged.length, kOfKey(key));
		lists.set(key, merged);
	}
	return { lists, n, nFr, minSeason, frMin };
};

// How deep a ranking still means something: deeper in a league with a long history and many players. 0 = none yet.
export const prThresholds = (
	board: Pick<PRBoard, "n" | "nFr" | "minSeason" | "frMin">,
	season: number,
	tid?: number,
) => {
	const seasons = Number.isFinite(board.minSeason)
		? season - board.minSeason + 1
		: 0;
	const league =
		seasons < 2
			? 0
			: Math.max(
					5,
					Math.min(PR_LEAGUE_K, Math.round(board.n / 25), 5 * seasons),
				);
	let franchise = 0;
	if (tid !== undefined) {
		const min = board.frMin.get(tid);
		const frSeasons = min === undefined ? 0 : season - min + 1;
		const nFr = board.nFr.get(tid) ?? 0;
		franchise =
			frSeasons < 2
				? 0
				: Math.max(
						3,
						Math.min(PR_FRANCHISE_K, Math.round(nFr / 10), 2 * frSeasons),
					);
	}
	return {
		league,
		franchise,
		season: Math.min(PR_SEASON_K, league),
	};
};

export type PRRank = {
	rank: number;
	// Someone else has the same total
	tied: boolean;
	// The next total above his (the lowest one above), for active players' chases
	above?: { pid: number; v: number; rank: number };
};

// Standard competition ranking (1, 2, 2, 4): 1 + the number of strictly higher totals. undefined when the list was cut
// above his total (so the rank isn't known, but it's past the kept depth).
export const prRankIn = (
	list: readonly PREntry[],
	pid: number,
	v: number,
	k: number,
	season?: number,
): PRRank | undefined => {
	if (!(v > 0)) {
		return undefined;
	}
	let c = 0;
	while (c < list.length && list[c]![1] > v) {
		c++;
	}
	if (c === list.length && list.length >= k) {
		return undefined;
	}
	const tied = list.some(
		(e) =>
			e[1] === v && (e[0] !== pid || (season !== undefined && e[2] !== season)),
	);
	let above: PRRank["above"];
	if (c > 0) {
		const v2 = list[c - 1]![1];
		let first = c - 1;
		while (first > 0 && list[first - 1]![1] === v2) {
			first--;
		}
		above = { pid: list[first]![0], v: v2, rank: first + 1 };
	}
	return { rank: c + 1, tied, above };
};

export type PRRanking = {
	scope: "league" | "franchise" | "season";
	stat: PRStat;
	playoffs: boolean;
	// Franchise rankings
	tid?: number;
	// Season rankings
	season?: number;
	v: number;
	rank: number;
	tied: boolean;
	// Ranks shown in this scope (the threshold)
	of: number;
	above?: { pid: number; v: number; rank: number };
	score: number;
};

const SCOPE_W = { league: 1, franchise: 0.75, season: 0.7 };

export const prScore = (
	scope: PRRanking["scope"],
	stat: PRStat,
	playoffs: boolean,
	rank: number,
	of: number,
) =>
	PR_INFO[stat].weight *
		SCOPE_W[scope] *
		(playoffs ? 0.8 : 1) *
		(1 + (of - rank + 1) / of) +
	(rank === 1 ? 0.5 : 0);

// A player's meaningful rankings, most significant first
export const prPlayerRankings = (
	board: PRBoard,
	pid: number,
	rows: readonly PRRow[],
	season: number,
	// Games with a franchise for its rankings (a short stint isn't a franchise career), regular season and playoffs
	minFrGames: [number, number] = [0, 0],
): PRRanking[] => {
	const out: PRRanking[] = [];
	if (rows.length === 0) {
		return out;
	}
	const c = prCareer(rows);
	const th = prThresholds(board, season);
	const push = (
		r: PRRank | undefined,
		x: Omit<PRRanking, "rank" | "tied" | "above" | "score">,
	) => {
		if (r && r.rank <= x.of) {
			out.push({
				...x,
				rank: r.rank,
				tied: r.tied,
				above: r.above,
				score: prScore(x.scope, x.stat, x.playoffs, r.rank, x.of),
			});
		}
	};
	for (const po of [0, 1] as const) {
		const all = c.all[po];
		if (all && th.league > 0) {
			for (const k of PR_STATS) {
				const v = round(all[k], PR_INFO[k].d);
				push(
					prRankIn(
						board.lists.get(keyLeague(k, po)) ?? [],
						pid,
						v,
						PR_LEAGUE_K,
					),
					{ scope: "league", stat: k, playoffs: po === 1, v, of: th.league },
				);
			}
		}
		for (const [tid, t] of c.fr[po]) {
			const of = prThresholds(board, season, tid).franchise;
			if (of === 0 || t.gp < minFrGames[po]) {
				continue;
			}
			for (const k of PR_STATS) {
				const v = round(t[k], PR_INFO[k].d);
				push(
					prRankIn(
						board.lists.get(keyFranchise(tid, k, po)) ?? [],
						pid,
						v,
						PR_FRANCHISE_K,
					),
					{ scope: "franchise", stat: k, playoffs: po === 1, tid, v, of },
				);
			}
		}
	}
	if (th.season > 0) {
		for (const k of PR_SEASON_STATS) {
			for (const [s, t] of c.seasons) {
				push(
					prRankIn(
						board.lists.get(keySeason(k)) ?? [],
						pid,
						t[k],
						PR_SEASON_K,
						s,
					),
					{
						scope: "season",
						stat: k,
						playoffs: false,
						season: s,
						v: t[k],
						of: th.season,
					},
				);
			}
		}
	}
	out.sort(
		(a, b) =>
			b.score - a.score ||
			a.rank - b.rank ||
			PR_STATS.indexOf(a.stat) - PR_STATS.indexOf(b.stat),
	);
	return out;
};
