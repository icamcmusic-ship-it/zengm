// Draft combine (Draft Lottery Night & Combine setting, basketball): measurements, athletic testing and shooting drills for the
// invited prospects of a draft class, held at the start of the draft lottery phase. Everything here is a pure function of the
// prospect (pid, draft year, his ratings in his draft year, listed height and weight), seeded with its own small RNG, so the
// results are the same every time they are computed and the game's random numbers are never touched. Nothing is stored.
//
// Scales follow real NBA combine results (2000s-2020s): see COMBINE_REAL_RANGES, checked by draftCombine.test.ts.
import { Rng } from "./collegeStats/rng.ts";

export type DraftCombineRatings = {
	hgt: number;
	stre: number;
	spd: number;
	jmp: number;
	endu: number;
	tp: number;
	ft: number;
	fg: number;
	// Expanded ratings, only when the setting is on (wingspan, catch-and-shoot, off the dribble)
	wng?: number;
	csh?: number;
	dsh?: number;
};

export type DraftCombineInput = {
	pid: number;
	// Draft year (the combine's season)
	season: number;
	// Listed height (with shoes) and weight
	heightInches: number;
	weight: number;
	ratings: DraftCombineRatings;
	// Rank in his class by projected draft stock, 1 = best. Top prospects skip the drills more often
	rank: number;
	injured: boolean;
};

export type CombineMeasurements = {
	heightNoShoes: number;
	heightShoes: number;
	wingspan: number;
	standingReach: number;
	weight: number;
	bodyFat: number;
	handLength: number;
	handWidth: number;
};

export type CombineDrills = {
	laneAgility: number;
	shuttle: number;
	sprint: number;
	standingVert: number;
	maxVert: number;
	bench: number;
	// Shooting drills: makes out of SHOOTING_ATTEMPTS
	spotUp: number;
	offDribble: number;
	freeThrows: number;
};

export type DraftCombineResult = {
	pid: number;
	season: number;
	measurements: CombineMeasurements;
	// Undefined when he skipped the drills
	drills?: CombineDrills;
	skipped?: "injured" | "topProspect" | "personal";
	// Over/under-performance in the drills against what his ratings predict, about N(0, 1). 0 when he skipped
	performance: number;
};

export type CombineKey = keyof CombineMeasurements | keyof CombineDrills;

export const SHOOTING_ATTEMPTS = {
	spotUp: 25,
	offDribble: 25,
	freeThrows: 20,
} as const;

const feetInches = (x: number) => {
	const ft = Math.floor(x / 12);
	const rest = x - 12 * ft;
	return `${ft}'${Number.isInteger(rest) ? rest : rest.toFixed(2).replace(/0$/, "")}"`;
};

export type CombineColumn = {
	key: CombineKey;
	name: string;
	short: string;
	group: "measurement" | "athletic" | "shooting";
	lowerBetter?: true;
	// No better or worse (body fat is lower = better, weight is neither)
	neutral?: true;
	format: (x: number) => string;
};

export const COMBINE_COLUMNS: CombineColumn[] = [
	{
		key: "heightNoShoes",
		name: "Height without shoes",
		short: "Hgt",
		group: "measurement",
		format: feetInches,
	},
	{
		key: "heightShoes",
		name: "Height with shoes",
		short: "Hgt (S)",
		group: "measurement",
		format: feetInches,
	},
	{
		key: "wingspan",
		name: "Wingspan",
		short: "Wing",
		group: "measurement",
		format: feetInches,
	},
	{
		key: "standingReach",
		name: "Standing reach",
		short: "Reach",
		group: "measurement",
		format: feetInches,
	},
	{
		key: "weight",
		name: "Weight",
		short: "Wt",
		group: "measurement",
		neutral: true,
		format: (x) => `${x} lbs`,
	},
	{
		key: "bodyFat",
		name: "Body fat",
		short: "BF%",
		group: "measurement",
		lowerBetter: true,
		format: (x) => `${x.toFixed(1)}%`,
	},
	{
		key: "handLength",
		name: "Hand length",
		short: "HndL",
		group: "measurement",
		format: (x) => `${x.toFixed(2)}"`,
	},
	{
		key: "handWidth",
		name: "Hand width",
		short: "HndW",
		group: "measurement",
		format: (x) => `${x.toFixed(2)}"`,
	},
	{
		key: "laneAgility",
		name: "Lane agility",
		short: "Lane",
		group: "athletic",
		lowerBetter: true,
		format: (x) => `${x.toFixed(2)}s`,
	},
	{
		key: "shuttle",
		name: "Shuttle run",
		short: "Shut",
		group: "athletic",
		lowerBetter: true,
		format: (x) => `${x.toFixed(2)}s`,
	},
	{
		key: "sprint",
		name: "3/4 court sprint",
		short: "Sprint",
		group: "athletic",
		lowerBetter: true,
		format: (x) => `${x.toFixed(2)}s`,
	},
	{
		key: "standingVert",
		name: "Standing vertical",
		short: "SVert",
		group: "athletic",
		format: (x) => `${x}"`,
	},
	{
		key: "maxVert",
		name: "Max vertical",
		short: "MVert",
		group: "athletic",
		format: (x) => `${x}"`,
	},
	{
		key: "bench",
		name: "Bench press (185 lbs)",
		short: "Bench",
		group: "athletic",
		format: (x) => `${x}`,
	},
	{
		key: "spotUp",
		name: "Spot-up threes",
		short: "SpotUp",
		group: "shooting",
		format: (x) => `${x}/${SHOOTING_ATTEMPTS.spotUp}`,
	},
	{
		key: "offDribble",
		name: "Off-dribble jumpers",
		short: "OffDrb",
		group: "shooting",
		format: (x) => `${x}/${SHOOTING_ATTEMPTS.offDribble}`,
	},
	{
		key: "freeThrows",
		name: "Free throws",
		short: "FT",
		group: "shooting",
		format: (x) => `${x}/${SHOOTING_ATTEMPTS.freeThrows}`,
	},
];

export const COMBINE_COLUMN_BY_KEY = Object.fromEntries(
	COMBINE_COLUMNS.map((c) => [c.key, c]),
) as Record<CombineKey, CombineColumn>;

// Real NBA draft combine results (roughly 2000-2024): mean, standard deviation and the usual extremes. The shooting drills are
// not published consistently, so they are given as make rates
export const COMBINE_REAL_RANGES: Record<
	CombineKey,
	{ mean: number; sd: number; min: number; max: number }
> = {
	heightNoShoes: { mean: 77.6, sd: 3.3, min: 68, max: 88 },
	heightShoes: { mean: 78.9, sd: 3.3, min: 69, max: 89.5 },
	wingspan: { mean: 81.8, sd: 3.9, min: 70, max: 93 },
	standingReach: { mean: 103.5, sd: 5, min: 89, max: 117 },
	weight: { mean: 214, sd: 23, min: 155, max: 300 },
	bodyFat: { mean: 7.2, sd: 2.6, min: 2.5, max: 20 },
	handLength: { mean: 8.75, sd: 0.45, min: 7.5, max: 10 },
	handWidth: { mean: 9.5, sd: 0.75, min: 7.25, max: 12 },
	laneAgility: { mean: 11.3, sd: 0.45, min: 10, max: 12.9 },
	shuttle: { mean: 3.08, sd: 0.15, min: 2.6, max: 3.65 },
	sprint: { mean: 3.28, sd: 0.12, min: 2.95, max: 3.75 },
	standingVert: { mean: 29.3, sd: 3, min: 20, max: 38 },
	maxVert: { mean: 34.5, sd: 3.7, min: 24, max: 46 },
	bench: { mean: 9, sd: 5, min: 0, max: 27 },
	spotUp: { mean: 0.53, sd: 0.11, min: 0.2, max: 0.88 },
	offDribble: { mean: 0.44, sd: 0.1, min: 0.16, max: 0.8 },
	freeThrows: { mean: 0.75, sd: 0.1, min: 0.4, max: 1 },
};

// Typical draft-year prospect ratings (generated classes), to turn ratings into z-scores
const REF = {
	hgt: [47, 14],
	stre: [42, 9],
	spd: [52, 15],
	jmp: [52, 15],
	endu: [25, 9],
	shoot: [36, 11],
} as const;

const z = (x: number, [mean, sd]: readonly [number, number]) => (x - mean) / sd;
const clamp = (x: number, lo: number, hi: number) =>
	x < lo ? lo : x > hi ? hi : x;
const roundTo = (x: number, step: number) => Math.round(x / step) * step;
const round2 = (x: number) => Math.round(x * 100) / 100;

// Chance he skips the drills (measurements are always taken)
export const skipDrillsChance = (rank: number, injured: boolean) => {
	if (injured) {
		return 0.85;
	}
	return rank <= 3
		? 0.5
		: rank <= 8
			? 0.3
			: rank <= 14
				? 0.15
				: rank <= 30
					? 0.07
					: 0.03;
};

// How many prospects are invited: about 1.25 per draft pick, like the NBA's 75 or so for 60 picks
export const numCombineInvites = (numPicks: number) =>
	Math.max(1, Math.round(1.25 * numPicks));

export const generateDraftCombine = (
	input: DraftCombineInput,
): DraftCombineResult => {
	const { pid, season, heightInches, weight, ratings: r } = input;
	const rng = new Rng(`draftCombine|${pid}|${season}`);

	const zStre = z(r.stre, REF.stre);
	const zSpd = z(r.spd, REF.spd);
	const zJmp = z(r.jmp, REF.jmp);
	const zEndu = z(r.endu, REF.endu);
	const w = weight - 215;

	// ---- measurements ----
	const heightShoes = roundTo(heightInches + rng.normal(0, 0.3), 0.25);
	const heightNoShoes = roundTo(heightShoes - 1.25 + rng.normal(0, 0.15), 0.25);
	// The hgt rating is his height plus or minus about an inch of length (genRatings): that is the wingspan without a wng rating
	const length = clamp((r.hgt * 27) / 100 + 66 - heightInches, -1.5, 1.5);
	const ape =
		r.wng !== undefined
			? 4 + ((r.wng - r.hgt) * 27) / 100 + rng.normal(0, 0.6)
			: 3.9 + 1.4 * length + rng.normal(0, 1.8);
	const wingspan = roundTo(heightNoShoes + ape, 0.25);
	const standingReach = roundTo(
		1.315 * heightNoShoes + 0.55 * ape + rng.normal(0, 0.8),
		0.5,
	);
	const measuredWeight = Math.round(weight + rng.normal(0, 2.5));
	// Heavy for his height and not strong or fast = more body fat
	const bulk = weight - (215 + 6.5 * (heightInches - 78.7));
	const bodyFat =
		Math.round(
			clamp(
				6.4 +
					0.07 * bulk -
					0.7 * zStre -
					0.5 * zSpd -
					0.3 * zEndu +
					rng.normal(0, 2.1),
				2.5,
				20,
			) * 10,
		) / 10;
	const handLength = roundTo(
		clamp(
			8.72 + 0.1 * (heightInches - 78.7) + rng.normal(0, 0.33),
			7.25,
			10.25,
		),
		0.25,
	);
	const handWidth = roundTo(
		clamp(9.45 + 0.13 * (heightInches - 78.7) + rng.normal(0, 0.55), 7, 12.25),
		0.25,
	);

	const measurements: CombineMeasurements = {
		heightNoShoes,
		heightShoes,
		wingspan,
		standingReach,
		weight: measuredWeight,
		bodyFat,
		handLength,
		handWidth,
	};

	// ---- drills ----
	// Each drill's noise is drawn whether or not he takes part, so skipping never changes the measurements' draws
	const nVert = rng.normal(0, 1);
	const nStand = rng.normal(0, 1);
	const nLane = rng.normal(0, 1);
	const nShuttle = rng.normal(0, 1);
	const nSprint = rng.normal(0, 1);
	const nBench = rng.normal(0, 1);
	const nShoot = rng.normal(0, 1);

	const maxVertExp = 35.2 + 3 * zJmp + 0.6 * zSpd - 0.025 * w;
	const maxVert = roundTo(clamp(maxVertExp + 2 * nVert, 24, 46), 0.5);
	const standingVert = roundTo(
		clamp(maxVert - 5 + 0.3 * zStre + 1 * nStand, 19, maxVert - 1),
		0.5,
	);
	const laneExp = 11.28 - 0.3 * zSpd - 0.05 * zJmp + 0.004 * w;
	const laneAgility = round2(clamp(laneExp + 0.25 * nLane, 10, 13));
	const shuttleExp = 3.07 - 0.1 * zSpd + 0.0012 * w;
	const shuttle = round2(clamp(shuttleExp + 0.09 * nShuttle, 2.6, 3.7));
	const sprintExp = 3.28 - 0.085 * zSpd + 0.001 * w;
	const sprint = round2(clamp(sprintExp + 0.06 * nSprint, 2.95, 3.8));
	const bench = Math.max(
		0,
		Math.round(10 + 3.6 * zStre + 0.05 * w + 2.5 * nBench),
	);

	// Shooting: a hot or cold day (nShoot) on top of each shot's own luck
	const cs = r.csh ?? r.tp;
	const od = r.dsh ?? 0.5 * (r.fg + r.tp);
	const day = 0.035 * nShoot;
	const pSpot = clamp(
		0.53 + 0.07 * z(cs, REF.shoot) + 0.02 * z(r.ft, REF.shoot) + day,
		0.12,
		0.92,
	);
	const pOd = clamp(
		0.44 + 0.06 * z(od, REF.shoot) + 0.02 * z(r.ft, REF.shoot) + day,
		0.1,
		0.85,
	);
	const pFt = clamp(0.75 + 0.065 * z(r.ft, REF.shoot) + day, 0.35, 0.97);
	const spotUp = rng.binomial(SHOOTING_ATTEMPTS.spotUp, pSpot);
	const offDribble = rng.binomial(SHOOTING_ATTEMPTS.offDribble, pOd);
	const freeThrows = rng.binomial(SHOOTING_ATTEMPTS.freeThrows, pFt);
	const shootExp = SHOOTING_ATTEMPTS.spotUp * (pSpot - day);
	const shootSd = Math.sqrt(
		SHOOTING_ATTEMPTS.spotUp * pSpot * (1 - pSpot) +
			(SHOOTING_ATTEMPTS.spotUp * 0.035) ** 2,
	);

	let skipped: DraftCombineResult["skipped"];
	if (rng.random() < skipDrillsChance(input.rank, input.injured)) {
		skipped = input.injured
			? "injured"
			: input.rank <= 14
				? "topProspect"
				: "personal";
	}

	if (skipped) {
		return { pid, season, measurements, skipped, performance: 0 };
	}

	// Over/under-performance: each drill's result against what his ratings predict, in standard deviations, averaged so the
	// total is about N(0, 1)
	const parts = [
		(maxVert - maxVertExp) / 2,
		(laneExp - laneAgility) / 0.25,
		(shuttleExp - shuttle) / 0.09,
		(sprintExp - sprint) / 0.06,
		(spotUp - shootExp) / shootSd,
	];
	const performance =
		Math.round(
			(parts.reduce((a, b) => a + b, 0) / Math.sqrt(parts.length)) * 100,
		) / 100;

	return {
		pid,
		season,
		measurements,
		drills: {
			laneAgility,
			shuttle,
			sprint,
			standingVert,
			maxVert,
			bench,
			spotUp,
			offDribble,
			freeThrows,
		},
		performance,
	};
};

export const combineValue = (
	res: DraftCombineResult,
	key: CombineKey,
): number | undefined =>
	key in res.measurements
		? res.measurements[key as keyof CombineMeasurements]
		: res.drills?.[key as keyof CombineDrills];

export type CombineRank = { rank: number; n: number; pct: number };

/**
 * Rank (1 = best) and percentile (0-100, higher is better) of each result among the class's results, for the prospects who took
 * part in each test. Weight is ranked heaviest first.
 */
export const combineRanks = (results: DraftCombineResult[]) => {
	const out = new Map<number, Partial<Record<CombineKey, CombineRank>>>();
	for (const res of results) {
		out.set(res.pid, {});
	}
	for (const col of COMBINE_COLUMNS) {
		const vals: { pid: number; v: number }[] = [];
		for (const res of results) {
			const v = combineValue(res, col.key);
			if (v !== undefined) {
				vals.push({ pid: res.pid, v });
			}
		}
		const n = vals.length;
		for (const { pid, v } of vals) {
			let better = 0;
			let worse = 0;
			for (const x of vals) {
				if (col.lowerBetter ? x.v < v : x.v > v) {
					better += 1;
				} else if (col.lowerBetter ? x.v > v : x.v < v) {
					worse += 1;
				}
			}
			const ties = n - better - worse - 1;
			out.get(pid)![col.key] = {
				rank: better + 1,
				n,
				pct: n <= 1 ? 50 : Math.round((100 * (worse + 0.5 * ties)) / (n - 1)),
			};
		}
	}
	return out;
};

// Average percentile over the athletic drills (agility, speed, leaping), for standouts and disappointments
export const athleticScore = (
	ranks: Partial<Record<CombineKey, CombineRank>> | undefined,
) => {
	const keys: CombineKey[] = [
		"laneAgility",
		"shuttle",
		"sprint",
		"standingVert",
		"maxVert",
	];
	const pcts = keys
		.map((k) => ranks?.[k]?.pct)
		.filter((x): x is number => x !== undefined);
	if (pcts.length === 0) {
		return undefined;
	}
	return Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
};

// The AI draft's combine nudge, in player value points: only big over/under-performers (|performance| > 1) move, at most
// COMBINE_NUDGE_MAX, then centered so it averages exactly zero over the class (skippers and uninvited prospects included)
export const COMBINE_NUDGE_MAX = 0.75;
export const combineNudges = (
	pids: number[],
	results: Map<number, DraftCombineResult>,
) => {
	const raw = pids.map((pid) => {
		const perf = results.get(pid)?.performance ?? 0;
		const excess = Math.abs(perf) - 1;
		if (excess <= 0) {
			return 0;
		}
		return Math.sign(perf) * Math.min(COMBINE_NUDGE_MAX, 0.6 * excess);
	});
	const mean = raw.length > 0 ? raw.reduce((a, b) => a + b, 0) / raw.length : 0;
	return new Map(pids.map((pid, i) => [pid, raw[i]! - mean]));
};

const ordinalTop = (rank: number) => (rank === 1 ? "best" : `top-${rank}`);

/**
 * Short combine lines for the scouting report: the standout measurements and drills, in scout speak ("Measured 7'1" wingspan",
 * "Top-5 max vertical (40.5")").
 */
export const combineScoutNotes = (
	res: DraftCombineResult,
	ranks: Partial<Record<CombineKey, CombineRank>> | undefined,
) => {
	const notes: string[] = [];
	const m = res.measurements;
	const ape = m.wingspan - m.heightNoShoes;
	notes.push(
		`Measured ${feetInches(m.heightNoShoes)} without shoes, ${feetInches(m.wingspan)} wingspan (${ape >= 0 ? "+" : ""}${ape.toFixed(2).replace(/\.?0+$/, "")}" ape index)`,
	);
	if (!res.drills) {
		notes.push(
			res.skipped === "injured"
				? "Skipped the drills while injured"
				: "Skipped the athletic testing and shooting drills",
		);
		return notes;
	}
	const tops: string[] = [];
	const bottoms: string[] = [];
	for (const col of COMBINE_COLUMNS) {
		if (col.neutral || col.key === "heightShoes") {
			continue;
		}
		const r = ranks?.[col.key];
		const v = combineValue(res, col.key);
		if (!r || v === undefined || r.n < 10) {
			continue;
		}
		if (r.rank <= 5) {
			tops.push(
				`${ordinalTop(r.rank)} ${col.name.toLowerCase()} (${col.format(v)})`,
			);
		} else if (r.rank > r.n - 5) {
			bottoms.push(`${col.name.toLowerCase()} (${col.format(v)})`);
		}
	}
	if (tops.length > 0) {
		const s = tops.slice(0, 3).join(", ");
		notes.push(s.charAt(0).toUpperCase() + s.slice(1));
	}
	if (bottoms.length > 0) {
		notes.push(`Near the bottom in ${bottoms.slice(0, 2).join(" and ")}`);
	}
	return notes;
};
