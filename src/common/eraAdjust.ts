// Era-adjusted stats (Records Book and League Leaders, basketball): each season's numbers relative to that season's league average, put
// back on the scale of the league's all-time average season. A counting stat is times (all-time average per team game) / (that season's
// per team game), so a point scored in a slow, low-scoring season counts for more than one in a fast, high-scoring one (pace and
// scoring environment together); a percentage is times (all-time league rate) / (that season's), and TS+ is 100 × his TS% / the league's
// that season. Pure: the worker reads the league's team stats into totals by season (worker/util/eraBaselines.ts).

export type EraTotals = {
	gp: number;
	pts: number;
	orb: number;
	drb: number;
	ast: number;
	stl: number;
	blk: number;
	tov: number;
	pf: number;
	fg: number;
	fga: number;
	tp: number;
	tpa: number;
	ft: number;
	fta: number;
};

export const ERA_TOTAL_KEYS = [
	"pts",
	"orb",
	"drb",
	"ast",
	"stl",
	"blk",
	"tov",
	"pf",
	"fg",
	"fga",
	"tp",
	"tpa",
	"ft",
	"fta",
] as const;

// Counting stats adjusted by their own league rate (trb is orb + drb)
const COUNT_STATS = new Set([...ERA_TOTAL_KEYS, "trb"]);

const RATES: Record<string, (t: EraTotals) => number> = {
	fgp: (t) => t.fg / t.fga,
	tpp: (t) => t.tp / t.tpa,
	ftp: (t) => t.ft / t.fta,
	tsp: (t) => t.pts / (2 * (t.fga + 0.44 * t.fta)),
	efg: (t) => (t.fg + 0.5 * t.tp) / t.fga,
};

const perGame = (t: EraTotals, k: string) =>
	k === "trb" ? (t.orb + t.drb) / t.gp : (t as any)[k] / t.gp;

export type EraAdjuster = {
	// Multiplier for a stat of this season (1 for a stat that isn't adjusted, or a season without data)
	factor: (season: number, stat: string) => number;
	// The league's rate of a percentage stat that season (as a fraction), undefined without data
	leagueRate: (season: number, stat: string) => number | undefined;
	seasons: number[];
};

export const isEraAdjusted = (stat: string) =>
	COUNT_STATS.has(stat) || Object.hasOwn(RATES, stat);

export const makeEraAdjuster = (
	totalsBySeason: Map<number, EraTotals>,
): EraAdjuster => {
	const seasons = [...totalsBySeason.keys()]
		.filter((s) => totalsBySeason.get(s)!.gp > 0)
		.sort((a, b) => a - b);
	const refCache = new Map<string, number>();
	const valueOf = (t: EraTotals, stat: string) =>
		COUNT_STATS.has(stat) ? perGame(t, stat) : RATES[stat]!(t);
	// The all-time average: the mean over seasons (each season counts once, whatever its length or number of teams)
	const ref = (stat: string) => {
		let r = refCache.get(stat);
		if (r === undefined) {
			let sum = 0;
			let n = 0;
			for (const s of seasons) {
				const v = valueOf(totalsBySeason.get(s)!, stat);
				if (Number.isFinite(v) && v > 0) {
					sum += v;
					n += 1;
				}
			}
			r = n > 0 ? sum / n : Number.NaN;
			refCache.set(stat, r);
		}
		return r;
	};
	return {
		seasons,
		factor: (season, stat) => {
			if (!isEraAdjusted(stat)) {
				return 1;
			}
			const t = totalsBySeason.get(season);
			if (!t || t.gp <= 0) {
				return 1;
			}
			const v = valueOf(t, stat);
			const r = ref(stat);
			if (!(v > 0) || !Number.isFinite(r)) {
				return 1;
			}
			return r / v;
		},
		leagueRate: (season, stat) => {
			const t = totalsBySeason.get(season);
			const fn = RATES[stat];
			if (!t || t.gp <= 0 || !fn) {
				return undefined;
			}
			const v = fn(t);
			return v > 0 && Number.isFinite(v) ? v : undefined;
		},
	};
};

// A multi-season (career) factor: the seasons' factors weighted by his games in each
export const careerEraFactor = (
	adj: EraAdjuster,
	stat: string,
	rows: { season: number; gp: number }[],
) => {
	let w = 0;
	let sum = 0;
	for (const r of rows) {
		if (r.gp > 0) {
			w += r.gp;
			sum += r.gp * adj.factor(r.season, stat);
		}
	}
	return w > 0 ? sum / w : 1;
};
