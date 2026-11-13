// Records Book and Milestones (League extras, basketball): pure functions shared by the worker views, the background
// record/milestone check and the tests. The worker reads the league into these plain shapes (see
// worker/util/recordsBookData.ts); nothing here touches the database.

export const RB_STATS = ["pts", "trb", "ast", "stl", "blk", "tp"] as const;
export type RBStat = (typeof RB_STATS)[number];
export type RBCareerStat = RBStat | "gp";

export const RB_WORDS: Record<
	RBCareerStat,
	{ label: string; unit: string; one: string }
> = {
	pts: { label: "Points", unit: "points", one: "point" },
	trb: { label: "Rebounds", unit: "rebounds", one: "rebound" },
	ast: { label: "Assists", unit: "assists", one: "assist" },
	stl: { label: "Steals", unit: "steals", one: "steal" },
	blk: { label: "Blocks", unit: "blocks", one: "block" },
	tp: { label: "Three-pointers", unit: "three-pointers", one: "three-pointer" },
	gp: { label: "Games", unit: "games", one: "game" },
};

// A regular season or playoffs stats row of one player with one team (pre-draft rows are left out by the reader)
export type RBRow = {
	season: number;
	tid: number;
	playoffs: boolean;
	gp: number;
} & Record<RBStat, number>;

export type RBPlayer = {
	pid: number;
	name: string;
	// Current tid (negative for free agents, retired, ...)
	tid: number;
	rows: RBRow[];
};

export type RBTeamSeason = {
	tid: number;
	season: number;
	won: number;
	lost: number;
	tied: number;
	otl: number;
};

// One line of a records list. Player lines have a pid; team lines only a tid.
export type RBEntry = {
	pid?: number;
	name?: string;
	tid: number;
	season?: number;
	gid?: number;
	oppTid?: number;
	playoffs?: boolean;
	// For streaks: the streak is still going
	ongoing?: boolean;
	v: number;
	// Currently in the league (franchise scope: on that team)
	active?: boolean;
	// Set this season (season and game lists) or added to this season (career lists)
	thisSeason?: boolean;
};

export type RBList = {
	id: string;
	label: string;
	unit: string;
	// Decimals of the value
	d: number;
	pct?: boolean;
	rows: RBEntry[];
	// The record (first row) was broken this season: the holder before
	broken?: { prev: RBEntry | null };
	// Season lists: who held the record over time (oldest first)
	history?: RBEntry[];
};

export type RBSection = {
	id: string;
	title: string;
	lists: RBList[];
	note?: string;
};

// ---------------------------------------------------------------------------------------------------------------------
// Persistent state for single-game highs and streaks (they need box scores, which BBGM deletes after a while, so they
// are kept as they happen). Compact keys: it lives in a game attribute.

export type RBGameHigh = {
	p: number;
	t: number;
	o: number;
	s: number;
	g: number;
	v: number;
};

export type RBStreak = {
	t: number;
	s: number;
	// 1 = wins, -1 = losses
	w: 1 | -1;
	n: number;
	g0: number;
	g1: number;
};

export type RBState = {
	v: 1;
	// Highest gid processed
	lastGid: number;
	// Season the check last ran in (games of seasons from it on are read from the database, so a check delayed past
	// the rollover still processes last season's playoffs). Missing in states saved before it was tracked.
	lastSeason?: number;
	// "pts|0" (regular season) or "pts|1" (playoffs) -> league top list
	game: Record<string, RBGameHigh[]>;
	// tid -> "pts|0" -> franchise top list
	gameFr: Record<string, Record<string, RBGameHigh[]>>;
	// Current regular season run per tid
	runs: Record<string, RBStreak>;
	// Longest finished runs, wins and losses
	streaks: { w: RBStreak[]; l: RBStreak[] };
	// League records announced in the news: who holds them now
	rec: {
		career: Partial<Record<RBStat, { p: number; v: number }>>;
		season: Partial<Record<RBStat, { p: number; s: number; v: number }>>;
		wins?: { t: number; s: number; v: number };
		streak?: { t: number; s: number; g0: number; v: number };
	};
	// Milestones reached since the check started running, newest last
	ms: RBMilestoneHit[];
};

export type RBMilestoneHit = {
	p: number;
	k: RBCareerStat;
	t: number;
	s: number;
	tm: number;
	day?: number;
	g?: number;
};

export const GAME_TOP = 10;
export const GAME_TOP_FR = 3;
export const STREAK_TOP = 10;
export const MS_LOG_MAX = 150;

export const emptyState = (): RBState => ({
	v: 1,
	lastGid: -1,
	game: {},
	gameFr: {},
	runs: {},
	streaks: { w: [], l: [] },
	rec: { career: {}, season: {} },
	ms: [],
});

const cmpHigh = (a: RBGameHigh, b: RBGameHigh) => b.v - a.v || a.g - b.g;

// Insert into a sorted top list. Returns the list (cut to n) and whether the entry is now first and beats the old first.
export const insertTop = <T>(
	list: T[],
	x: T,
	n: number,
	cmp: (a: T, b: T) => number,
) => {
	const prevFirst = list[0];
	let i = list.findIndex((y) => cmp(x, y) < 0);
	if (i < 0) {
		i = list.length;
	}
	if (i >= n) {
		return { list, first: false, prevFirst };
	}
	list.splice(i, 0, x);
	if (list.length > n) {
		list.length = n;
	}
	return { list, first: i === 0, prevFirst };
};

// A box score line, as needed here
export type RBGameLine = {
	pid: number;
	min: number;
} & Record<RBStat, number>;

export type RBGameIn = {
	gid: number;
	season: number;
	day: number;
	playoffs: boolean;
	// Both teams: tid, pts and the players' lines
	teams: { tid: number; pts: number; players: RBGameLine[] }[];
};

export const lineOf = (p: any): RBGameLine => ({
	pid: p.pid,
	min: p.min ?? 0,
	pts: p.pts ?? 0,
	trb: (p.orb ?? 0) + (p.drb ?? 0),
	ast: p.ast ?? 0,
	stl: p.stl ?? 0,
	blk: p.blk ?? 0,
	tp: p.tp ?? 0,
});

export type RBGameNews =
	| {
			kind: "game";
			stat: RBStat;
			playoffs: boolean;
			high: RBGameHigh;
			prev: RBGameHigh;
	  }
	| {
			kind: "streak";
			run: RBStreak;
			prev: { t: number; s: number; v: number };
	  };

const finishRun = (state: RBState, run: RBStreak) => {
	if (run.n < 2) {
		return;
	}
	const list = run.w === 1 ? state.streaks.w : state.streaks.l;
	insertTop(list, run, STREAK_TOP, (a, b) => b.n - a.n || a.g0 - b.g0);
};

// Every streak, the finished ones and the runs still going, longest first
export const allStreaks = (state: RBState, w: 1 | -1) => {
	const out = [...(w === 1 ? state.streaks.w : state.streaks.l)].map((x) => ({
		...x,
		ongoing: false,
	}));
	for (const run of Object.values(state.runs)) {
		if (run.w === w && run.n >= 2) {
			out.push({ ...run, ongoing: true });
		}
	}
	return out.sort((a, b) => b.n - a.n || a.g0 - b.g0);
};

// Adds one game (in gid order) to the single-game highs and the streaks. Returns what is news: a new league single-game
// high that beats one set in an earlier season, or a winning streak longer than any before it.
export const addGame = (
	state: RBState,
	game: RBGameIn,
	announce: boolean,
): RBGameNews[] => {
	const news: RBGameNews[] = [];
	if (game.gid <= state.lastGid) {
		return news;
	}
	state.lastGid = game.gid;
	const po = game.playoffs ? 1 : 0;
	for (let i = 0; i < game.teams.length; i++) {
		const t = game.teams[i]!;
		const opp = game.teams[1 - i]!;
		for (const line of t.players) {
			if (!(line.min > 0)) {
				continue;
			}
			for (const stat of RB_STATS) {
				const v = line[stat];
				if (!(v > 0)) {
					continue;
				}
				const key = `${stat}|${po}`;
				const high: RBGameHigh = {
					p: line.pid,
					t: t.tid,
					o: opp.tid,
					s: game.season,
					g: game.gid,
					v,
				};
				const list = (state.game[key] ??= []);
				const res = insertTop(list, high, GAME_TOP, cmpHigh);
				if (
					announce &&
					res.first &&
					res.prevFirst &&
					v > res.prevFirst.v &&
					res.prevFirst.s < game.season
				) {
					news.push({
						kind: "game",
						stat,
						playoffs: game.playoffs,
						high,
						prev: res.prevFirst,
					});
				}
				const fr = (state.gameFr[t.tid] ??= {});
				insertTop((fr[key] ??= []), high, GAME_TOP_FR, cmpHigh);
			}
		}
	}

	// Streaks: regular season only
	if (!game.playoffs && game.teams.length === 2) {
		const [a, b] = game.teams as [RBGameIn["teams"][0], RBGameIn["teams"][0]];
		for (const [t, o] of [
			[a, b],
			[b, a],
		] as const) {
			const w: 1 | -1 | 0 = t.pts > o.pts ? 1 : t.pts < o.pts ? -1 : 0;
			const cur = state.runs[t.tid];
			if (cur && cur.s === game.season && cur.w === w) {
				cur.n += 1;
				cur.g1 = game.gid;
			} else {
				if (cur) {
					finishRun(state, cur);
					delete state.runs[t.tid];
				}
				if (w !== 0) {
					state.runs[t.tid] = {
						t: t.tid,
						s: game.season,
						w,
						n: 1,
						g0: game.gid,
						g1: game.gid,
					};
				}
			}
			const run = state.runs[t.tid];
			if (run && run.w === 1) {
				const rec = state.rec.streak;
				const same =
					rec && rec.t === run.t && rec.s === run.s && rec.g0 === run.g0;
				if (!rec || run.n > rec.v) {
					if (announce && rec && !same && rec.s < game.season && rec.v >= 10) {
						news.push({
							kind: "streak",
							run: { ...run },
							prev: { t: rec.t, s: rec.s, v: rec.v },
						});
					}
					state.rec.streak = { t: run.t, s: run.s, g0: run.g0, v: run.n };
				}
			}
		}
	}
	return news;
};

// ---------------------------------------------------------------------------------------------------------------------
// Records book

export type RBContext = {
	season: number;
	// Regular season games of a team in that season
	numGames: (season: number) => number;
	// Most team games played so far this season (to judge per-game qualifiers mid-season)
	teamGamesNow: number;
	// Season is over (regular season)
	regularSeasonDone: boolean;
};

type Tot = { gp: number } & Record<RBStat, number>;
const zero = (): Tot => ({
	gp: 0,
	pts: 0,
	trb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tp: 0,
});
const addTo = (a: Tot, r: RBRow) => {
	a.gp += r.gp;
	for (const k of RB_STATS) {
		a[k] += r[k];
	}
};

const top = <T>(arr: T[], n: number, val: (x: T) => number, low = false) =>
	arr
		.filter((x) => Number.isFinite(val(x)))
		.sort((a, b) => (low ? val(a) - val(b) : val(b) - val(a)))
		.slice(0, n);

const N = 10;

export type RBScope = { tid?: number };

type Line = {
	pid: number;
	name: string;
	tid: number;
	season: number;
	active: boolean;
	t: Tot;
};

// Season lines: one per player and season, summed over teams for the league; the team's own rows for a franchise
const seasonLines = (
	players: RBPlayer[],
	playoffs: boolean,
	scope: RBScope,
	isActive: (p: RBPlayer) => boolean,
): Line[] => {
	const out: Line[] = [];
	for (const p of players) {
		const by = new Map<number, Line>();
		for (const r of p.rows) {
			if (r.playoffs !== playoffs) {
				continue;
			}
			if (scope.tid !== undefined && r.tid !== scope.tid) {
				continue;
			}
			let l = by.get(r.season);
			if (!l) {
				l = {
					pid: p.pid,
					name: p.name,
					tid: r.tid,
					season: r.season,
					active: isActive(p),
					t: zero(),
				};
				by.set(r.season, l);
			}
			// Team of the season: the last one he played for
			l.tid = r.tid;
			addTo(l.t, r);
		}
		out.push(...by.values());
	}
	return out;
};

const minGames = (ctx: RBContext, season: number) =>
	season < ctx.season || ctx.regularSeasonDone
		? Math.ceil(0.7 * ctx.numGames(season))
		: Math.max(10, Math.ceil(0.7 * ctx.teamGamesNow));

const seasonList = <L extends Line>(
	id: string,
	label: string,
	unit: string,
	lines: L[],
	val: (l: L) => number,
	ctx: RBContext,
	d = 0,
	withHistory = true,
): RBList => {
	const entry = (l: L): RBEntry => ({
		pid: l.pid,
		name: l.name,
		tid: l.tid,
		season: l.season,
		v: val(l),
		active: l.active,
		thisSeason: l.season === ctx.season,
	});
	const rows = top(lines, N, val).map(entry);
	const list: RBList = { id, label, unit, d, rows };
	const first = rows[0];
	if (first?.season === ctx.season) {
		const prevLine = top(
			lines.filter((l) => l.season < ctx.season),
			1,
			val,
		)[0];
		// Only when there was a record before (a league's first season breaks nothing)
		if (prevLine && val(prevLine) < first.v) {
			list.broken = { prev: entry(prevLine) };
		}
	}
	if (withHistory) {
		// The running best, season by season
		const bySeason = new Map<number, L>();
		for (const l of lines) {
			const v = val(l);
			if (!Number.isFinite(v)) {
				continue;
			}
			const b = bySeason.get(l.season);
			if (!b || v > val(b)) {
				bySeason.set(l.season, l);
			}
		}
		const history: RBEntry[] = [];
		let best = -Infinity;
		for (const s of [...bySeason.keys()].sort((a, b) => a - b)) {
			const l = bySeason.get(s)!;
			if (val(l) > best) {
				best = val(l);
				history.push(entry(l));
			}
		}
		list.history = history;
	}
	return list;
};

type CareerAgg = {
	pid: number;
	name: string;
	tid: number;
	active: boolean;
	now: Tot;
	before: Tot;
	seasons: Set<number>;
	seasonsBefore: number;
};

const careers = (
	players: RBPlayer[],
	playoffs: boolean,
	scope: RBScope,
	isActive: (p: RBPlayer) => boolean,
	season: number,
): CareerAgg[] => {
	const out: CareerAgg[] = [];
	for (const p of players) {
		let c: CareerAgg | undefined;
		for (const r of p.rows) {
			if (r.playoffs !== playoffs) {
				continue;
			}
			if (scope.tid !== undefined && r.tid !== scope.tid) {
				continue;
			}
			c ??= {
				pid: p.pid,
				name: p.name,
				tid: r.tid,
				active: isActive(p),
				now: zero(),
				before: zero(),
				seasons: new Set(),
				seasonsBefore: 0,
			};
			c.tid = r.tid;
			addTo(c.now, r);
			if (r.season < season) {
				addTo(c.before, r);
			}
			if (r.gp > 0) {
				c.seasons.add(r.season);
			}
		}
		if (c) {
			c.seasonsBefore = [...c.seasons].filter((s) => s < season).length;
			out.push(c);
		}
	}
	return out;
};

const careerList = (
	id: string,
	label: string,
	unit: string,
	aggs: CareerAgg[],
	now: (c: CareerAgg) => number,
	before: (c: CareerAgg) => number,
): RBList => {
	const entry = (c: CareerAgg, v: number): RBEntry => ({
		pid: c.pid,
		name: c.name,
		tid: c.tid,
		v,
		active: c.active,
		thisSeason: now(c) > before(c),
	});
	const rows = top(aggs, N, now).map((c) => entry(c, now(c)));
	const list: RBList = { id, label, unit, d: 0, rows };
	const first = top(aggs, 1, now)[0];
	const prev = top(aggs, 1, before)[0];
	if (
		first &&
		prev &&
		first.pid !== prev.pid &&
		now(first) > before(prev) &&
		before(first) <= before(prev) &&
		before(prev) > 0
	) {
		list.broken = { prev: entry(prev, before(prev)) };
	}
	return list;
};

const winp = (t: RBTeamSeason) => {
	const gp = t.won + t.lost + t.tied + t.otl;
	return gp > 0 ? (t.won + 0.5 * t.tied) / gp : Number.NaN;
};

const gameHighList = (
	id: string,
	label: string,
	unit: string,
	highs: RBGameHigh[] | undefined,
	playoffs: boolean,
	names: Map<number, string>,
	isActivePid: (pid: number, tid: number) => boolean,
	season: number,
): RBList => {
	const rows: RBEntry[] = (highs ?? []).slice(0, N).map((h) => ({
		pid: h.p,
		name: names.get(h.p) ?? `Player ${h.p}`,
		tid: h.t,
		oppTid: h.o,
		season: h.s,
		gid: h.g,
		playoffs,
		v: h.v,
		active: isActivePid(h.p, h.t),
		thisSeason: h.s === season,
	}));
	const list: RBList = { id, label, unit, d: 0, rows };
	const first = rows[0];
	if (first?.season === season) {
		const prev = rows.find((r) => r.season! < season);
		if (prev && prev.v < first.v) {
			list.broken = { prev };
		}
	}
	return list;
};

// The whole book for one scope: league (no tid) or one franchise
export const buildBook = ({
	players,
	teamSeasons,
	state,
	ctx,
	scope,
}: {
	players: RBPlayer[];
	teamSeasons: RBTeamSeason[];
	state: RBState | undefined;
	ctx: RBContext;
	scope: RBScope;
}): RBSection[] => {
	const fr = scope.tid;
	const isActive = (p: RBPlayer) =>
		fr === undefined ? p.tid >= -1 : p.tid === fr;
	const tidNow = new Map<number, number>();
	const names = new Map<number, string>();
	for (const p of players) {
		tidNow.set(p.pid, p.tid);
		names.set(p.pid, p.name);
	}
	const isActivePid = (pid: number) => {
		const t = tidNow.get(pid);
		return t !== undefined && (fr === undefined ? t >= -1 : t === fr);
	};

	const sections: RBSection[] = [];

	// Career, regular season
	const reg = careers(players, false, scope, isActive, ctx.season);
	sections.push({
		id: "career",
		title: "Career",
		lists: [
			...RB_STATS.map((k) =>
				careerList(
					`career:${k}`,
					RB_WORDS[k].label,
					RB_WORDS[k].unit,
					reg,
					(c) => c.now[k],
					(c) => c.before[k],
				),
			),
			careerList(
				"career:gp",
				"Games played",
				"games",
				reg,
				(c) => c.now.gp,
				(c) => c.before.gp,
			),
			careerList(
				"career:seasons",
				"Seasons played",
				"seasons",
				reg,
				(c) => c.seasons.size,
				(c) => c.seasonsBefore,
			),
		],
	});

	// Single season
	const lines = seasonLines(players, false, scope, isActive);
	const qualified = lines.filter(
		(l) => l.t.gp > 0 && l.t.gp >= minGames(ctx, l.season),
	);
	sections.push({
		id: "season",
		title: "Single season",
		lists: [
			...RB_STATS.map((k) =>
				seasonList(
					`season:${k}`,
					RB_WORDS[k].label,
					RB_WORDS[k].unit,
					lines,
					(l) => l.t[k],
					ctx,
				),
			),
			...(["pts", "trb", "ast"] as const).map((k) =>
				seasonList(
					`season:${k}pg`,
					`${RB_WORDS[k].label} per game`,
					`${k === "pts" ? "PPG" : k === "trb" ? "RPG" : "APG"}`,
					qualified,
					(l) => l.t[k] / l.t.gp,
					ctx,
					1,
				),
			),
		],
		note: "Per game: at least 70% of the team's games.",
	});

	// Single game
	const games = (po: boolean) =>
		RB_STATS.map((k) =>
			gameHighList(
				`game${po ? "po" : ""}:${k}`,
				RB_WORDS[k].label,
				RB_WORDS[k].unit,
				fr === undefined
					? state?.game[`${k}|${po ? 1 : 0}`]
					: state?.gameFr[fr]?.[`${k}|${po ? 1 : 0}`],
				po,
				names,
				isActivePid,
				ctx.season,
			),
		);
	sections.push({
		id: "game",
		title: "Single game",
		lists: games(false),
		note:
			fr === undefined
				? undefined
				: `Top ${GAME_TOP_FR} per franchise are kept.`,
	});

	// Playoffs
	const po = careers(players, true, scope, isActive, ctx.season);
	const poLines = seasonLines(players, true, scope, isActive);
	sections.push({
		id: "playoffs",
		title: "Playoffs",
		lists: [
			...(["pts", "trb", "ast", "stl", "blk", "tp"] as const).map((k) =>
				careerList(
					`pocareer:${k}`,
					`Career ${RB_WORDS[k].unit}`,
					RB_WORDS[k].unit,
					po,
					(c) => c.now[k],
					(c) => c.before[k],
				),
			),
			careerList(
				"pocareer:gp",
				"Career games",
				"games",
				po,
				(c) => c.now.gp,
				(c) => c.before.gp,
			),
			...(["pts", "trb", "ast"] as const).map((k) =>
				seasonList(
					`poseason:${k}`,
					`${RB_WORDS[k].label} in one playoffs`,
					RB_WORDS[k].unit,
					poLines,
					(l) => l.t[k],
					ctx,
					0,
					false,
				),
			),
			...games(true).map((l) => ({
				...l,
				label: `${l.label} in a playoff game`,
			})),
		],
	});

	// Teams
	const ts = teamSeasons.filter((t) => fr === undefined || t.tid === fr);
	const qualifiedTs = ts.filter((t) => {
		const gp = t.won + t.lost + t.tied + t.otl;
		return gp > 0 && gp >= minGames(ctx, t.season);
	});
	const teamList = (
		id: string,
		label: string,
		unit: string,
		list: RBTeamSeason[],
		val: (t: RBTeamSeason) => number,
		low: boolean,
		d = 0,
		pct = false,
	): RBList => {
		const sign = low ? -1 : 1;
		const asLines = list.map((t) => ({
			pid: -1,
			name: "",
			tid: t.tid,
			season: t.season,
			active: false,
			t: zero(),
			x: t,
		}));
		const out = seasonList(
			id,
			label,
			unit,
			asLines,
			(l) => sign * val(l.x),
			ctx,
			d,
		);
		const conv = (e: RBEntry): RBEntry => ({
			tid: e.tid,
			season: e.season,
			v: sign * e.v,
			thisSeason: e.thisSeason,
		});
		out.rows = out.rows.map(conv);
		out.history = out.history?.map(conv);
		if (out.broken) {
			out.broken = { prev: out.broken.prev ? conv(out.broken.prev) : null };
		}
		out.pct = pct;
		return out;
	};
	const streakRows = (w: 1 | -1): RBEntry[] =>
		state
			? allStreaks(state, w)
					.filter((x) => fr === undefined || x.t === fr)
					.slice(0, N)
					.map((x) => ({
						tid: x.t,
						season: x.s,
						gid: x.g0,
						v: x.n,
						ongoing: x.ongoing,
						thisSeason: x.s === ctx.season,
					}))
			: [];
	sections.push({
		id: "team",
		title: "Team seasons",
		lists: [
			teamList("team:won", "Most wins", "wins", ts, (t) => t.won, false),
			teamList(
				"team:best",
				"Best record",
				"win%",
				qualifiedTs,
				winp,
				false,
				3,
				true,
			),
			teamList(
				"team:worst",
				"Worst record",
				"win%",
				qualifiedTs,
				winp,
				true,
				3,
				true,
			),
			teamList("team:lost", "Most losses", "losses", ts, (t) => t.lost, false),
			{
				id: "team:wstreak",
				label: "Longest winning streak",
				unit: "games",
				d: 0,
				rows: streakRows(1),
			},
			{
				id: "team:lstreak",
				label: "Longest losing streak",
				unit: "games",
				d: 0,
				rows: streakRows(-1),
			},
		],
		note: "Records need at least 70% of the season played. Streaks are counted from the games simmed since box scores were kept.",
	});

	return sections;
};

// ---------------------------------------------------------------------------------------------------------------------
// Milestones

export const MILESTONE_LADDERS: Record<RBCareerStat, number[]> = {
	pts: [
		1000, 2500, 5000, 7500, 10000, 12500, 15000, 17500, 20000, 25000, 30000,
		35000, 40000, 45000, 50000,
	],
	trb: [1000, 2500, 5000, 7500, 10000, 12500, 15000, 17500, 20000, 25000],
	ast: [1000, 2500, 5000, 7500, 10000, 12500, 15000, 17500, 20000],
	stl: [250, 500, 1000, 1500, 2000, 2500, 3000, 3500],
	blk: [250, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000],
	tp: [250, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000],
	gp: [250, 500, 750, 1000, 1250, 1500, 1750, 2000],
};

// Big enough to be league news when anyone reaches it (smaller ones are news only for the user's players)
export const MILESTONE_BIG: Record<RBCareerStat, number> = {
	pts: 20000,
	trb: 10000,
	ast: 7500,
	stl: 2000,
	blk: 2000,
	tp: 2000,
	gp: 1250,
};

export const MILESTONE_STATS: RBCareerStat[] = [...RB_STATS, "gp"];

// Ladder marks crossed going from before to now
export const crossed = (k: RBCareerStat, before: number, now: number) =>
	MILESTONE_LADDERS[k].filter((t) => before < t && now >= t);

export const nextMark = (k: RBCareerStat, v: number) =>
	MILESTONE_LADDERS[k].find((t) => t > v);

export type RBPace = {
	// Stat per game played
	rate: number;
	// Games played per team game
	share: number;
};

// Pace from this season (10+ games), else last season, else career
export const paceOf = (
	rows: RBRow[],
	k: RBCareerStat,
	season: number,
	teamGamesNow: number,
): RBPace => {
	const reg = rows.filter((r) => !r.playoffs);
	const sum = (rs: RBRow[]) => {
		const t = zero();
		for (const r of rs) {
			addTo(t, r);
		}
		return t;
	};
	const cur = sum(reg.filter((r) => r.season === season));
	const last = sum(reg.filter((r) => r.season === season - 1));
	const all = sum(reg);
	const base = cur.gp >= 10 ? cur : last.gp >= 10 ? last : all;
	const rate = base.gp > 0 ? (k === "gp" ? 1 : base[k] / base.gp) : 0;
	let share = 0.9;
	if (cur.gp >= 10 && teamGamesNow >= 10) {
		share = Math.min(1, cur.gp / teamGamesNow);
	} else if (last.gp > 0) {
		share = Math.min(1, Math.max(0.3, last.gp / 82));
	}
	return { rate, share };
};

// Team games until a player gets `need` more of a stat at his pace (Infinity when he has no pace)
export const teamGamesToReach = (need: number, pace: RBPace) => {
	if (need <= 0) {
		return 0;
	}
	if (!(pace.rate > 0) || !(pace.share > 0)) {
		return Number.POSITIVE_INFINITY;
	}
	return Math.ceil(Math.ceil(need / pace.rate) / pace.share);
};

export type RBChaseTarget =
	| { kind: "milestone"; mark: number }
	| {
			kind: "rank";
			// Rank he moves up to
			rank: number;
			pid: number;
			name: string;
			active: boolean;
			v: number;
	  };

export type RBChase = {
	pid: number;
	name: string;
	tid: number;
	k: RBCareerStat;
	v: number;
	// Current all-time rank
	rank: number | null;
	target: RBChaseTarget;
	need: number;
	perGame: number;
	// Team games from now
	teamGames: number;
};

// Active players near a career mark or the next player above them on the all-time list (top `rankCut`)
export const findChases = ({
	players,
	season,
	teamGamesNow,
	horizon,
	rankCut = 100,
}: {
	players: RBPlayer[];
	season: number;
	teamGamesNow: (tid: number) => number;
	// Most team games ahead to look
	horizon: number;
	rankCut?: number;
}): RBChase[] => {
	const out: RBChase[] = [];
	for (const k of MILESTONE_STATS) {
		const totals = players
			.map((p) => {
				let v = 0;
				for (const r of p.rows) {
					if (!r.playoffs) {
						v += k === "gp" ? r.gp : r[k];
					}
				}
				return { p, v };
			})
			.filter((x) => x.v > 0)
			.sort((a, b) => b.v - a.v || a.p.pid - b.p.pid);
		const rankOf = new Map<number, number>();
		totals.forEach((x, i) => rankOf.set(x.p.pid, i + 1));
		for (let i = 0; i < totals.length; i++) {
			const { p, v } = totals[i]!;
			if (p.tid < 0) {
				continue;
			}
			const pace = paceOf(p.rows, k, season, teamGamesNow(p.tid));
			const add = (target: RBChaseTarget, need: number) => {
				const teamGames = teamGamesToReach(need, pace);
				if (teamGames <= horizon) {
					out.push({
						pid: p.pid,
						name: p.name,
						tid: p.tid,
						k,
						v,
						rank: i + 1 <= rankCut ? i + 1 : null,
						target,
						need,
						perGame: pace.rate,
						teamGames,
					});
				}
			};
			const mark = nextMark(k, v);
			if (mark !== undefined) {
				add({ kind: "milestone", mark }, mark - v);
			}
			// Next one above him within the top of the list (ties don't count as a pass)
			if (i > 0 && i < rankCut + 5) {
				let j = i - 1;
				while (j > 0 && totals[j]!.v === v) {
					j -= 1;
				}
				const above = totals[j]!;
				if (above.v > v && j + 1 <= rankCut) {
					add(
						{
							kind: "rank",
							rank: j + 1,
							pid: above.p.pid,
							name: above.p.name,
							active: above.p.tid >= -1,
							v: above.v,
						},
						above.v - v + 1,
					);
				}
			}
		}
	}
	return out.sort(
		(a, b) => a.teamGames - b.teamGames || b.v - a.v || a.pid - b.pid,
	);
};

// Milestones reached this season by active players, from their totals (the check's log adds the day when it has it)
export const reachedThisSeason = (players: RBPlayer[], season: number) => {
	const out: {
		pid: number;
		name: string;
		tid: number;
		k: RBCareerStat;
		t: number;
		retired?: boolean;
	}[] = [];
	for (const p of players) {
		// Retired (or otherwise gone) players count when they played this season, e.g. retiring right after it
		const retired = p.tid < -1;
		const lastRow = retired
			? p.rows.findLast((r) => r.season === season && !r.playoffs)
			: undefined;
		if (retired && !lastRow) {
			continue;
		}
		for (const k of MILESTONE_STATS) {
			let before = 0;
			let now = 0;
			for (const r of p.rows) {
				if (r.playoffs) {
					continue;
				}
				const v = k === "gp" ? r.gp : r[k];
				now += v;
				if (r.season < season) {
					before += v;
				}
			}
			for (const t of crossed(k, before, now)) {
				out.push(
					retired
						? { pid: p.pid, name: p.name, tid: lastRow!.tid, k, t, retired }
						: { pid: p.pid, name: p.name, tid: p.tid, k, t },
				);
			}
		}
	}
	return out;
};
