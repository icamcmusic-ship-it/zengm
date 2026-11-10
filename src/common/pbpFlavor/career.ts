/* Career-high and milestone calls in the play-by-play: "that's a new career high", "ties his season high", "that basket gives him 10,000
   career points", a first career triple-double, a rookie's first points.

   What a player had done before the game comes with him in the sim's init event (pbpCareer: a short list of numbers made by loadTeams from
   his stats rows, see careerFromStats) and is stored with the game's play-by-play, so a stored game says what was true when it was played.
   A number that isn't known (a league started with veterans who have no recorded past, stats rows from before single-game highs were kept,
   an old stored game) is left out, and its call is never made: the layer says nothing rather than guess.

   Cosmetic only, like the rest of the flavor layer: it reads the live box score, picks its words from its own seeded generator (a stream no
   other part of the layer uses) and only adds a note, so the rest of the text is the same with or without it. */
import { Rng } from "./rng.ts";
import type { FPlayer } from "./types.ts";

export const CAREER_STATS = ["pts", "trb", "ast", "tp", "blk", "stl"] as const;
export type CareerStat = (typeof CAREER_STATS)[number];
const TOTAL_STATS = ["pts", "trb", "ast", "tp"] as const;

// The layout of pbpCareer. -1 = not known. Never reorder: stored games use it
const FLAGS = 0;
const GP = 1;
const GP_SEASON = 2;
const TD = 3;
const AGE = 4;
const HIGH = 5;
const SEASON_HIGH = HIGH + CAREER_STATS.length;
const TOTAL = SEASON_HIGH + CAREER_STATS.length;
export const CAREER_LENGTH = TOTAL + TOTAL_STATS.length;

const FLAG_COMPLETE = 1;
const FLAG_ROOKIE = 2;

export type PbpCareer = {
	// His stats rows cover his whole career (they start in his first season), so totals and "firsts" can be trusted
	complete: boolean;
	// In his first season
	rookie: boolean;
	// Games played before this one: career (regular season and playoffs), and this season
	gp: number;
	gpSeason: number;
	// Triple-doubles before this game (regular season and playoffs)
	td: number | undefined;
	age: number | undefined;
	// Single-game highs before this game, over the regular season and the playoffs together
	high: Partial<Record<CareerStat, number>>;
	seasonHigh: Partial<Record<CareerStat, number>>;
	// Regular season totals before this game
	total: Partial<Record<(typeof TOTAL_STATS)[number], number>>;
};

type StatsRow = Record<string, any>;

const num = (x: unknown): x is number =>
	typeof x === "number" && Number.isFinite(x);

// The numbers the sim sends for a player, from his stats rows as they are before the game
export const careerFromStats = (
	rows: readonly StatsRow[],
	info: { season: number; draftYear: number | undefined; age?: number },
): number[] => {
	const out: number[] = Array.from({ length: CAREER_LENGTH }, () => -1);
	const played = rows.filter((r) => r && num(r.gp) && r.gp > 0);
	const firstSeason = Math.min(
		...played.map((r) => (num(r.season) ? r.season : -Infinity)),
	);
	const newcomer = num(info.draftYear) && info.draftYear >= info.season - 1;
	// (a player's first season is the one after his draft)
	const complete =
		played.length === 0
			? newcomer
			: num(info.draftYear) && firstSeason <= info.draftYear + 1;
	const rookie =
		complete && newcomer && played.every((r) => r.season === info.season);
	out[FLAGS] = (complete ? FLAG_COMPLETE : 0) + (rookie ? FLAG_ROOKIE : 0);
	let gp = 0;
	let gpSeason = 0;
	let td: number | undefined = 0;
	for (const r of played) {
		gp += r.gp;
		if (r.season === info.season) {
			gpSeason += r.gp;
		}
		if (td !== undefined) {
			td = num(r.td) ? td + r.td : undefined;
		}
	}
	out[GP] = gp;
	out[GP_SEASON] = gpSeason;
	out[TD] = td ?? -1;
	out[AGE] = num(info.age) && info.age >= 0 ? Math.round(info.age) : -1;
	for (const [i, stat] of CAREER_STATS.entries()) {
		let high: number | undefined = 0;
		let seasonHigh: number | undefined = 0;
		for (const r of played) {
			const m = r[`${stat}Max`];
			const v = Array.isArray(m) && num(m[0]) ? m[0] : undefined;
			if (v === undefined) {
				high = undefined;
				if (r.season === info.season) {
					seasonHigh = undefined;
				}
				continue;
			}
			if (high !== undefined) {
				high = Math.max(high, v);
			}
			if (r.season === info.season && seasonHigh !== undefined) {
				seasonHigh = Math.max(seasonHigh, v);
			}
		}
		out[HIGH + i] = high ?? -1;
		out[SEASON_HIGH + i] = seasonHigh ?? -1;
	}
	for (const [i, stat] of TOTAL_STATS.entries()) {
		let total: number | undefined = 0;
		for (const r of played) {
			if (r.playoffs) {
				continue;
			}
			const v =
				stat === "trb"
					? (r.orb ?? Number.NaN) + (r.drb ?? Number.NaN)
					: r[stat];
			if (!num(v)) {
				total = undefined;
				break;
			}
			total += v;
		}
		out[TOTAL + i] = total ?? -1;
	}
	return out.map((x) => (num(x) && x >= 0 ? Math.round(x) : -1));
};

export const parseCareer = (raw: unknown): PbpCareer | undefined => {
	if (!Array.isArray(raw) || raw.length < CAREER_LENGTH) {
		return undefined;
	}
	const at = (i: number): number | undefined => {
		const v = raw[i];
		return num(v) && v >= 0 ? v : undefined;
	};
	const flags = at(FLAGS);
	const gp = at(GP);
	const gpSeason = at(GP_SEASON);
	if (flags === undefined || gp === undefined || gpSeason === undefined) {
		return undefined;
	}
	const c: PbpCareer = {
		complete: (flags & FLAG_COMPLETE) !== 0,
		rookie: (flags & FLAG_ROOKIE) !== 0,
		gp,
		gpSeason,
		td: at(TD),
		age: at(AGE),
		high: {},
		seasonHigh: {},
		total: {},
	};
	for (const [i, stat] of CAREER_STATS.entries()) {
		const h = at(HIGH + i);
		// (a career high needs the whole career)
		if (h !== undefined && c.complete) {
			c.high[stat] = h;
		}
		const s = at(SEASON_HIGH + i);
		if (s !== undefined) {
			c.seasonHigh[stat] = s;
		}
	}
	for (const [i, stat] of TOTAL_STATS.entries()) {
		const v = at(TOTAL + i);
		if (v !== undefined && c.complete) {
			c.total[stat] = v;
		}
	}
	return c;
};

// For tests: the list for a player described in words
export const makeCareer = (c: {
	complete?: boolean;
	rookie?: boolean;
	gp?: number;
	gpSeason?: number;
	td?: number;
	age?: number;
	high?: Partial<Record<CareerStat, number>>;
	seasonHigh?: Partial<Record<CareerStat, number>>;
	total?: Partial<Record<(typeof TOTAL_STATS)[number], number>>;
}): number[] => {
	const out: number[] = Array.from({ length: CAREER_LENGTH }, () => -1);
	out[FLAGS] =
		(c.complete === false ? 0 : FLAG_COMPLETE) + (c.rookie ? FLAG_ROOKIE : 0);
	out[GP] = c.gp ?? 0;
	out[GP_SEASON] = c.gpSeason ?? 0;
	out[TD] = c.td ?? -1;
	out[AGE] = c.age ?? -1;
	for (const [i, stat] of CAREER_STATS.entries()) {
		out[HIGH + i] = c.high?.[stat] ?? -1;
		out[SEASON_HIGH + i] = c.seasonHigh?.[stat] ?? -1;
	}
	for (const [i, stat] of TOTAL_STATS.entries()) {
		out[TOTAL + i] = c.total?.[stat] ?? -1;
	}
	return out;
};

export const CAREER_RULES = {
	// Games played before a high means something: career, season
	minGp: 20,
	minGpSeason: 10,
	// The least a line has to be for a career high / a season high to be worth a call
	minCareer: { pts: 15, trb: 10, ast: 8, tp: 5, blk: 4, stl: 4 },
	minSeason: { pts: 20, trb: 12, ast: 10, tp: 5, blk: 4, stl: 4 },
	// "N away from his career high": in the final period, with at least this many points, at most this far away
	awayPts: 25,
	awayMax: 4,
};

const MILESTONES: Record<(typeof TOTAL_STATS)[number], number[]> = {
	pts: [
		1000, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000,
	],
	trb: [1000, 2500, 5000, 7500, 10000, 12500, 15000, 20000],
	ast: [1000, 2500, 5000, 7500, 10000, 12500, 15000],
	tp: [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000],
};

const LABEL: Record<CareerStat, [string, string]> = {
	pts: ["point", "points"],
	trb: ["rebound", "rebounds"],
	ast: ["assist", "assists"],
	tp: ["three", "threes"],
	blk: ["block", "blocks"],
	stl: ["steal", "steals"],
};
const lab = (stat: CareerStat, n: number) => LABEL[stat][n === 1 ? 0 : 1];
const fmt = (n: number) => n.toLocaleString("en-US");

type T1 = (n: string, v: number, what: string) => string;

const NEW_HIGH: T1[] = [
	(n, v, what) => `That's a new career high for ${n}: ${v} ${what}.`,
	(n, v, what) => `${n} has a new career high with ${v} ${what}.`,
	(n, v, what) =>
		`A career night for ${n}: ${v} ${what}, the most he's ever had.`,
	(n, v, what) => `${v} ${what} for ${n}, and that's a new career high.`,
	(n, v, what) => `${n} has never had more than this in a game: ${v} ${what}.`,
	(n, v, what) => `Make it ${v} ${what} for ${n}, a new personal best.`,
];
const TIE_HIGH: T1[] = [
	(n, v, what) => `That ties ${n}'s career high: ${v} ${what}.`,
	(n, v, what) => `${n} matches his career high with ${v} ${what}.`,
	(n, v, what) => `${v} ${what} for ${n}, equaling his career best.`,
	(n, v, what) => `${n} is level with his career high of ${v} ${what}.`,
];
const NEW_SEASON: T1[] = [
	(n, v, what) => `That's a season high for ${n}: ${v} ${what}.`,
	(n, v, what) => `${n} has a new season high with ${v} ${what}.`,
	(n, v, what) => `${v} ${what} for ${n}, his most in a game this season.`,
	(n, v, what) => `${n} hasn't had this many all season: ${v} ${what}.`,
	(n, v, what) => `Make it ${v} ${what} for ${n}, his best of the season.`,
];
const TIE_SEASON: T1[] = [
	(n, v, what) => `That ties ${n}'s season high: ${v} ${what}.`,
	(n, v, what) => `${n} matches his season high with ${v} ${what}.`,
	(n, v, what) => `${v} ${what} for ${n}, equaling his best of the season.`,
];
const AWAY: ((n: string, d: number, high: number) => string)[] = [
	(n, d, high) => `${n} is ${d} away from his career high of ${high}.`,
	(n, d, high) => `${n} needs ${d} more to match his career high of ${high}.`,
	(n, d, high) =>
		`Keep an eye on ${n}: his career high is ${high}, and he's ${d} short of it.`,
	(n, d, high) => `${d} more and ${n} ties his career best of ${high}.`,
];
const MILESTONE: ((n: string, m: string, what: string) => string)[] = [
	(n, m, what) => `That gives ${n} ${m} career ${what}.`,
	(n, m, what) => `${n} reaches ${m} career ${what}.`,
	(n, m, what) => `A milestone for ${n}: ${m} career ${what}.`,
	(n, m, what) => `And with that, ${n} has ${m} ${what} for his career.`,
];
const MILESTONE_PTS: ((n: string, m: string, how: string) => string)[] = [
	(n, m, how) => `That ${how} gives ${n} ${m} career points.`,
	(n, m, how) => `With that ${how}, ${n} reaches ${m} points for his career.`,
	(n, m, how) => `That ${how} puts ${n} in the ${m}-point club.`,
];
const FIRST_TD: ((n: string) => string)[] = [
	(n) => `That's the first triple-double of ${n}'s career.`,
	(n) => `A first career triple-double for ${n}.`,
	(n) => `${n} has never had a triple-double before tonight.`,
];
const FIRST_POINTS_ROOKIE: ((n: string) => string)[] = [
	(n) =>
		`Those are the first points of ${n}'s career, and the rookie gets a hand from the bench.`,
	(n) => `The rookie is on the board: the first points of ${n}'s career.`,
	(n) => `${n} has his first career points. He'll want to keep that ball.`,
	(n) => `Welcome to the league: the first career points for ${n}.`,
];
const FIRST_POINTS: ((n: string) => string)[] = [
	(n) => `Those are the first points of ${n}'s career.`,
	(n) => `${n} has his first career points.`,
];

// Every line this layer can write, with "\u0001" for the name and 7s for the numbers: for tests
export const careerTemplatesForTests = () => {
	const out: string[] = [];
	for (const f of [...NEW_HIGH, ...TIE_HIGH, ...NEW_SEASON, ...TIE_SEASON]) {
		out.push(f("\u0001", 7, "points"));
	}
	for (const f of AWAY) {
		out.push(f("\u0001", 7, 7));
	}
	for (const f of MILESTONE) {
		out.push(f("\u0001", "7", "points"));
	}
	for (const f of MILESTONE_PTS) {
		out.push(f("\u0001", "7", "basket"));
	}
	for (const f of [...FIRST_TD, ...FIRST_POINTS_ROOKIE, ...FIRST_POINTS]) {
		out.push(f("\u0001"));
	}
	return out;
};

// Stream id for this layer's generator (the trash talk uses 7,000,000)
const STREAM = 8_000_000;

type Box = {
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tp?: number;
};

export class CareerNotes {
	private gid: number;
	private careers = new Map<number, PbpCareer>();
	private said = new Set<string>();
	private used = new Set<string>();
	// the box score the last time each player was looked at
	private prev = new Map<number, Record<CareerStat, number>>();
	private regularSeason: boolean;
	readonly active: boolean;
	// The calls made, for tests: what kind, which stat, and the number that was said
	readonly calls: {
		idx: number;
		pid: number;
		kind:
			| "first"
			| "firstTd"
			| "milestone"
			| "new"
			| "tie"
			| "away"
			| "seasonNew"
			| "seasonTie";
		stat?: CareerStat;
		value?: number;
	}[] = [];

	constructor(
		gid: number,
		players: readonly { pid: number; career?: unknown }[],
		opts: { playoffs?: boolean; exhibition?: boolean },
	) {
		this.gid = gid;
		this.regularSeason = !opts.playoffs;
		if (!opts.exhibition) {
			for (const p of players) {
				const c = parseCareer(p.career);
				if (c) {
					this.careers.set(p.pid, c);
				}
			}
		}
		this.active = this.careers.size > 0;
	}

	careerOf(pid: number) {
		return this.careers.get(pid);
	}

	private pick<T>(rng: Rng, group: string, list: readonly T[]): T {
		const fresh = list.filter((_, i) => !this.used.has(`${group}|${i}`));
		const pool = fresh.length > 0 ? fresh : list;
		const x = rng.pick(pool);
		this.used.add(`${group}|${list.indexOf(x)}`);
		return x;
	}

	// The calls for one player after an event that may have changed his line: at most one. `late` = final period or overtime; `how` = what
	// he just did, when it scored ("basket", "three", "free throw")
	check(
		idx: number,
		p: FPlayer,
		st: Box | undefined,
		o: { late: boolean; how?: string; name?: string },
	): string | undefined {
		const c = this.careers.get(p.pid);
		if (!c || !st) {
			return;
		}
		const now: Record<CareerStat, number> = {
			pts: st.pts,
			trb: st.trb,
			ast: st.ast,
			tp: st.tp ?? 0,
			blk: st.blk,
			stl: st.stl,
		};
		const before = this.prev.get(p.pid) ?? {
			pts: 0,
			trb: 0,
			ast: 0,
			tp: 0,
			blk: 0,
			stl: 0,
		};
		this.prev.set(p.pid, now);
		const n = o.name ?? p.name;
		const rng = new Rng(this.gid, STREAM + idx);
		const once = (key: string) => {
			const k = `${p.pid}|${key}`;
			if (this.said.has(k)) {
				return false;
			}
			this.said.add(k);
			return true;
		};
		const R = CAREER_RULES;

		// His first points
		if (
			c.complete &&
			before.pts === 0 &&
			now.pts > 0 &&
			(c.gp === 0 || c.high.pts === 0) &&
			once("first")
		) {
			this.calls.push({ idx, pid: p.pid, kind: "first" });
			return this.pick(
				rng,
				"first",
				c.rookie ? FIRST_POINTS_ROOKIE : FIRST_POINTS,
			)(n);
		}

		// His first triple-double
		const tens = (["pts", "trb", "ast", "stl", "blk"] as const).filter(
			(k) => now[k] >= 10,
		).length;
		if (tens >= 3 && c.complete && c.td === 0 && once("td")) {
			this.calls.push({ idx, pid: p.pid, kind: "firstTd" });
			return this.pick(rng, "td", FIRST_TD)(n);
		}

		// A round number of career points, rebounds, assists or threes (regular season totals, so only in the regular season)
		if (this.regularSeason) {
			for (const stat of TOTAL_STATS) {
				const total = c.total[stat];
				if (total === undefined || (stat === "tp" && st.tp === undefined)) {
					continue;
				}
				const m = MILESTONES[stat].find(
					(x) => total + before[stat] < x && total + now[stat] >= x,
				);
				if (m !== undefined && once(`m|${stat}|${m}`)) {
					this.calls.push({
						idx,
						pid: p.pid,
						kind: "milestone",
						stat,
						value: m,
					});
					if (stat === "pts" && o.how && rng.random() < 0.6) {
						return this.pick(rng, "mpts", MILESTONE_PTS)(n, fmt(m), o.how);
					}
					return this.pick(rng, "m", MILESTONE)(n, fmt(m), LABEL[stat][1]);
				}
			}
		}

		// Career highs, then season highs
		const careerOk = c.complete && c.gp >= R.minGp;
		const seasonOk = c.gpSeason >= R.minGpSeason;
		for (const stat of CAREER_STATS) {
			if (stat === "tp" && st.tp === undefined) {
				continue;
			}
			const v = now[stat];
			const high = careerOk ? c.high[stat] : undefined;
			const what = lab(stat, v);
			// (only when this play moved the number: a high is called as it happens)
			if (v === before[stat]) {
				continue;
			}
			if (high !== undefined && v >= R.minCareer[stat]) {
				if (v > high && once(`new|${stat}`)) {
					this.calls.push({ idx, pid: p.pid, kind: "new", stat, value: v });
					return this.pick(rng, "new", NEW_HIGH)(n, v, what);
				}
				if (
					v === high &&
					o.late &&
					!this.said.has(`${p.pid}|new|${stat}`) &&
					once(`tie|${stat}`)
				) {
					this.calls.push({ idx, pid: p.pid, kind: "tie", stat, value: v });
					return this.pick(rng, "tie", TIE_HIGH)(n, v, what);
				}
			}
			if (
				stat === "pts" &&
				high !== undefined &&
				o.late &&
				v >= R.awayPts &&
				high - v >= 1 &&
				high - v <= R.awayMax &&
				once("away")
			) {
				this.calls.push({
					idx,
					pid: p.pid,
					kind: "away",
					stat,
					value: high - v,
				});
				return this.pick(rng, "away", AWAY)(n, high - v, high);
			}
			const sHigh = seasonOk ? c.seasonHigh[stat] : undefined;
			// (a season high that is also the career high is called as a career high, or not at all)
			if (
				sHigh !== undefined &&
				v >= R.minSeason[stat] &&
				!(careerOk && high !== undefined && sHigh >= high) &&
				!(high !== undefined && v > high)
			) {
				if (v > sHigh && once(`snew|${stat}`)) {
					this.calls.push({
						idx,
						pid: p.pid,
						kind: "seasonNew",
						stat,
						value: v,
					});
					return this.pick(rng, "snew", NEW_SEASON)(n, v, what);
				}
				if (
					v === sHigh &&
					o.late &&
					stat === "pts" &&
					!this.said.has(`${p.pid}|snew|${stat}`) &&
					once(`stie|${stat}`)
				) {
					this.calls.push({
						idx,
						pid: p.pid,
						kind: "seasonTie",
						stat,
						value: v,
					});
					return this.pick(rng, "stie", TIE_SEASON)(n, v, what);
				}
			}
		}
		return;
	}
}
