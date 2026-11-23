// Feat rarity, team feats, streaks and the feat score (basketball, League Extras → Feat Rarity & Streaks, featureFeatRarity). Pure: the
// worker side (worker/core/player/featLedger.ts) keeps the state in the "featLedger" game attribute as games are played and labels feats
// as they are logged. See docs/native-features.md, "Feat rarity, team feats and streaks".

// Kinds counted over the league's history: tiers of single-game marks, and the rare multi-category lines
export type LedgerKind =
	| "pts50"
	| "pts60"
	| "pts70"
	| "pts80"
	| "reb25"
	| "reb30"
	| "ast20"
	| "ast25"
	| "stl10"
	| "blk10"
	| "tp10"
	| "tp12"
	| "td"
	| "qd"
	| "quint"
	| "fxf";

export const LEDGER_KIND_NAMES: Record<LedgerKind, string> = {
	pts50: "50-point game",
	pts60: "60-point game",
	pts70: "70-point game",
	pts80: "80-point game",
	reb25: "25-rebound game",
	reb30: "30-rebound game",
	ast20: "20-assist game",
	ast25: "25-assist game",
	stl10: "10-steal game",
	blk10: "10-block game",
	tp10: "10-three game",
	tp12: "12-three game",
	td: "triple-double",
	qd: "quadruple-double",
	quint: "quintuple-double",
	fxf: "5x5",
};

// Most notable first: only the first two kinds a game has get a rarity label
const KIND_ORDER: LedgerKind[] = [
	"quint",
	"pts80",
	"qd",
	"pts70",
	"reb30",
	"ast25",
	"pts60",
	"fxf",
	"tp12",
	"stl10",
	"blk10",
	"pts50",
	"reb25",
	"ast20",
	"tp10",
	"td",
];

export type TeamFeatKind = "pts150" | "tp25" | "comeback30";

export const TEAM_FEAT_NAMES: Record<TeamFeatKind, string> = {
	pts150: "150+ points",
	tp25: "25+ threes",
	comeback30: "30-point comeback",
};

export type StreakKind = "td" | "dd" | "p30";

export const STREAK_NAMES: Record<StreakKind, string> = {
	td: "triple-doubles",
	dd: "double-doubles",
	p30: "30-point games",
};

// A running streak is news from this many games (and every `every` after)
export const STREAK_NEWS: Record<StreakKind, { from: number; every: number }> =
	{
		td: { from: 3, every: 1 },
		dd: { from: 15, every: 5 },
		p30: { from: 5, every: 1 },
	};

type Seen = { n: number; last?: number };

export type TeamFeatRow = {
	season: number;
	gid: number;
	tid: number;
	oppTid: number;
	kind: TeamFeatKind;
	value: number;
	score: string;
	playoffs: boolean;
	// Rarity at the time (like a player feat's)
	rarity?: string;
};

export type StreakRow = {
	pid: number;
	name: string;
	tid: number;
	kind: StreakKind;
	n: number;
	// First and last season of the streak
	from: number;
	to: number;
};

export type LedgerState = {
	v: 1;
	// League history of each kind (regular season and playoffs, not All-Star games)
	kinds: Partial<Record<LedgerKind, Seen>>;
	team: Partial<Record<TeamFeatKind, Seen>>;
	// Team feats, newest last (at most TEAM_FEATS_MAX)
	teamFeats: TeamFeatRow[];
	// Running streaks of active players (regular season games he played), only the ones going
	running: Record<
		string,
		Partial<Record<StreakKind, { n: number; from: number }>>
	>;
	// The longest streaks ever, per kind (at most LONGEST_MAX each)
	longest: Partial<Record<StreakKind, StreakRow[]>>;
	// League per-team-game totals by season, for the feat score's era normalization
	era: Record<string, EraTotals>;
};

export type EraTotals = {
	g: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tp: number;
};

export const TEAM_FEATS_MAX = 300;
export const LONGEST_MAX = 10;

export const emptyLedger = (): LedgerState => ({
	v: 1,
	kinds: {},
	team: {},
	teamFeats: [],
	running: {},
	longest: {},
	era: {},
});

export type GameLine = {
	pts: number;
	orb: number;
	drb: number;
	ast: number;
	stl: number;
	blk: number;
	tp: number;
	fg?: number;
	fga?: number;
	ft?: number;
	fta?: number;
	tov?: number;
};

const trbOf = (s: GameLine) => s.orb + s.drb;

// The ledger kinds of one game line, cutoffs scaled by the game's factor (as the feats are)
export const ledgerKinds = (s: GameLine, factor: number): LedgerKind[] => {
	const at = (x: number) => factor * x;
	const trb = trbOf(s);
	const five = [s.pts, trb, s.ast, s.stl, s.blk];
	const tens = five.filter((x) => x >= at(10)).length;
	const out: LedgerKind[] = [];
	if (tens >= 5) {
		out.push("quint");
	} else if (tens >= 4) {
		out.push("qd");
	} else if (tens >= 3) {
		out.push("td");
	}
	if (five.every((x) => x >= at(5))) {
		out.push("fxf");
	}
	for (const tier of [80, 70, 60, 50] as const) {
		if (s.pts >= at(tier)) {
			out.push(`pts${tier}`);
			break;
		}
	}
	if (trb >= at(30)) {
		out.push("reb30");
	} else if (trb >= at(25)) {
		out.push("reb25");
	}
	if (s.ast >= at(25)) {
		out.push("ast25");
	} else if (s.ast >= at(20)) {
		out.push("ast20");
	}
	if (s.stl >= at(10)) {
		out.push("stl10");
	}
	if (s.blk >= at(10)) {
		out.push("blk10");
	}
	if (s.tp >= at(12)) {
		out.push("tp12");
	} else if (s.tp >= at(10)) {
		out.push("tp10");
	}
	return KIND_ORDER.filter((k) => out.includes(k));
};

export const ordinal = (n: number) => {
	const s = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// A rarity label from what the league has seen of a kind before this game (undefined when it isn't rare: seen this season or last, and
// more than 10 times). `name` is the kind's name ("60-point game").
export const rarityLabel = (
	name: string,
	seen: Seen | undefined,
	season: number,
	firstSeason: number,
) => {
	const n = seen?.n ?? 0;
	if (n === 0) {
		return season > firstSeason
			? `first ${name} in league history`
			: `first ${name} of the league`;
	}
	if (seen?.last !== undefined && seen.last < season - 1) {
		return `first ${name} since ${seen.last}`;
	}
	if (n + 1 <= 10) {
		return `${ordinal(n + 1)} ${name} ever`;
	}
	return undefined;
};

// The rarity labels of one game line (at most two, most notable first), counting it into the state
export const recordKinds = (
	state: LedgerState,
	kinds: LedgerKind[],
	season: number,
	firstSeason: number,
) => {
	const labels: string[] = [];
	for (const kind of kinds) {
		const seen = state.kinds[kind];
		const label = rarityLabel(
			LEDGER_KIND_NAMES[kind],
			seen,
			season,
			firstSeason,
		);
		if (label && labels.length < 2) {
			labels.push(label);
		}
		state.kinds[kind] = { n: (seen?.n ?? 0) + 1, last: season };
	}
	return labels;
};

// ---- team feats ----

// The winner's largest deficit at a period break (points), from the two teams' points by period
export const comebackDeficit = (
	ptsQtrs: [number[], number[]],
	winner: 0 | 1,
) => {
	const loser = winner === 0 ? 1 : 0;
	let a = 0;
	let b = 0;
	let deficit = 0;
	const n = Math.min(ptsQtrs[0].length, ptsQtrs[1].length);
	for (let i = 0; i < n - 1; i++) {
		a += ptsQtrs[winner][i] ?? 0;
		b += ptsQtrs[loser][i] ?? 0;
		deficit = Math.max(deficit, b - a);
	}
	return deficit;
};

export const teamFeatKinds = (
	t: { pts: number; tp: number },
	deficit: number,
	won: boolean,
	factor: number,
): { kind: TeamFeatKind; value: number }[] => {
	const out: { kind: TeamFeatKind; value: number }[] = [];
	// Points scale with the game's length (factor is the square root of it, and players on the court)
	const lin = factor * factor;
	if (t.pts >= 150 * lin) {
		out.push({ kind: "pts150", value: t.pts });
	}
	if (t.tp >= 25 * lin) {
		out.push({ kind: "tp25", value: t.tp });
	}
	if (won && deficit >= 30 * lin) {
		out.push({ kind: "comeback30", value: deficit });
	}
	return out;
};

// ---- streaks ----

export const streakHits = (s: GameLine, factor: number) => {
	const at = (x: number) => factor * x;
	const tens = [s.pts, trbOf(s), s.ast, s.stl, s.blk].filter(
		(x) => x >= at(10),
	).length;
	return {
		dd: tens >= 2,
		td: tens >= 3,
		p30: s.pts >= at(30),
	} satisfies Record<StreakKind, boolean>;
};

/**
 * One regular season game a player played: his running streaks go on or end. Returns the streaks that are news now (STREAK_NEWS) with
 * their length. Ended streaks are offered to the longest-streaks lists.
 */
export const updateStreaks = (
	state: LedgerState,
	p: { pid: number; name: string; tid: number },
	hits: Record<StreakKind, boolean>,
	season: number,
) => {
	const key = String(p.pid);
	const running = state.running[key] ?? {};
	const news: { kind: StreakKind; n: number }[] = [];
	for (const kind of ["td", "dd", "p30"] as StreakKind[]) {
		const cur = running[kind];
		if (hits[kind]) {
			const next = { n: (cur?.n ?? 0) + 1, from: cur?.from ?? season };
			running[kind] = next;
			const rule = STREAK_NEWS[kind];
			if (next.n >= rule.from && (next.n - rule.from) % rule.every === 0) {
				news.push({ kind, n: next.n });
			}
			offerLongest(state, {
				...p,
				kind,
				n: next.n,
				from: next.from,
				to: season,
			});
		} else if (cur) {
			delete running[kind];
		}
	}
	if (Object.keys(running).length > 0) {
		state.running[key] = running;
	} else {
		delete state.running[key];
	}
	return news;
};

// Keep the longest streaks of each kind (a running streak updates its own row)
export const offerLongest = (state: LedgerState, row: StreakRow) => {
	if (row.n < 2) {
		return;
	}
	const list = state.longest[row.kind] ?? [];
	const same = list.find((r) => r.pid === row.pid && r.from === row.from);
	if (same) {
		same.n = row.n;
		same.to = row.to;
		same.tid = row.tid;
	} else {
		list.push({ ...row });
	}
	list.sort((a, b) => b.n - a.n || a.from - b.from);
	state.longest[row.kind] = list.slice(0, LONGEST_MAX);
};

// ---- feat score ----

// Per team game in a modern NBA-like league with the default settings: the reference the feat score normalizes to
export const ERA_REFERENCE: Omit<EraTotals, "g"> = {
	pts: 112,
	trb: 44,
	ast: 25,
	stl: 7.5,
	blk: 5,
	tp: 12.5,
};

// Minimum team-games of a season before its own averages are used (else the previous season's, else the reference)
export const ERA_MIN_GAMES = 100;

export const eraMultipliers = (
	state: LedgerState | undefined,
	season: number,
): Omit<EraTotals, "g"> => {
	const pick =
		state?.era[season]?.g !== undefined && state.era[season].g >= ERA_MIN_GAMES
			? state.era[season]
			: state?.era[season - 1]?.g !== undefined &&
				  state.era[season - 1]!.g >= ERA_MIN_GAMES
				? state.era[season - 1]
				: undefined;
	const out = {} as Omit<EraTotals, "g">;
	for (const key of Object.keys(
		ERA_REFERENCE,
	) as (keyof typeof ERA_REFERENCE)[]) {
		const avg = pick ? pick[key] / pick.g : 0;
		// Bounded, so a strange league (a tiny sample, 3-on-3) can't blow it up
		out[key] =
			avg > 0 ? Math.min(2, Math.max(0.5, ERA_REFERENCE[key] / avg)) : 1;
	}
	return out;
};

/**
 * A feat's score, comparable across eras and settings: each counting stat is scaled to the reference era (the league's per-team-game
 * average of that stat this season against ERA_REFERENCE) and divided by the game's factor (length with overtime, players on the court),
 * then weighted like a game score (points, rebounds 1.1, assists 1.5, steals and blocks 2.5, threes 0.5, misses and turnovers taken off).
 */
export const featScore = (
	s: GameLine,
	factor: number,
	era: Omit<EraTotals, "g">,
) => {
	const f = factor > 0 ? factor : 1;
	const pts = (s.pts * era.pts) / f;
	const trb = (trbOf(s) * era.trb) / f;
	const ast = (s.ast * era.ast) / f;
	const stl = (s.stl * era.stl) / f;
	const blk = (s.blk * era.blk) / f;
	const tp = (s.tp * era.tp) / f;
	const misses =
		((s.fga ?? 0) - (s.fg ?? 0) + 0.5 * ((s.fta ?? 0) - (s.ft ?? 0))) / f;
	const tov = (s.tov ?? 0) / f;
	return (
		Math.round(
			10 *
				(pts +
					1.1 * trb +
					1.5 * ast +
					2.5 * (stl + blk) +
					0.5 * tp -
					0.4 * misses -
					tov),
		) / 10
	);
};

export const addEraGame = (
	state: LedgerState,
	season: number,
	t: Omit<EraTotals, "g">,
) => {
	const row = state.era[season] ?? {
		g: 0,
		pts: 0,
		trb: 0,
		ast: 0,
		stl: 0,
		blk: 0,
		tp: 0,
	};
	row.g += 1;
	for (const key of Object.keys(
		ERA_REFERENCE,
	) as (keyof typeof ERA_REFERENCE)[]) {
		row[key] += t[key];
	}
	state.era[season] = row;
	// Only the last few seasons are needed
	for (const key of Object.keys(state.era)) {
		if (Number(key) < season - 2) {
			delete state.era[key];
		}
	}
};
