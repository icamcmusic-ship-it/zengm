// Draft combine (Draft Lottery Night & Combine setting, basketball): measurements, athletic testing and shooting drills for the
// invited prospects of a draft class, held at the start of the draft lottery phase. Everything here is a pure function of the
// prospect (pid, draft year, his ratings in his draft year, listed height and weight), seeded with its own small RNG, so the
// results are the same every time they are computed and the game's random numbers are never touched. Nothing is stored here (the
// worker stores each prospect's results when the combine is held). The medicals (below) have an RNG of their own.
//
// Scales follow real NBA combine results (2000s-2020s): see COMBINE_REAL_RANGES, checked by draftCombine.test.ts.
import { Rng } from "./collegeStats/rng.ts";
import { RECONSTRUCTIONS, type CareerInjury } from "./collegeStats/injuries.ts";

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
	// Sub-ratings, only when that setting is on: the verticals read standing reach and max vertical, the lane agility and shuttle
	// lateral quickness, the sprint straight-line speed (each sub's average is its base, so the class's results keep their scale)
	stj?: number;
	mxv?: number;
	lat?: number;
	sls?: number;
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
	// Effort in the drills, when he went through the motions (under 1; missing = full effort). His drill results are worse for it
	effort?: number;
	// Pre-Draft Injuries & Combine Medicals: his medical grade. Missing for a combine held before it existed
	medical?: CombineMedical;
	// His place in the invite order (1 = first invited), stored when the combine is held so the order never changes afterwards.
	// Missing for a combine held before it was stored
	inviteRank?: number;
};

// ---- Medicals (Pre-Draft Injuries & Combine Medicals) ----
// Every invited prospect has a physical at the combine. His medical risk comes from his pre-draft injury history (recent and major
// injuries weigh most, a knee or Achilles reconstruction most of all), an injury he has now and, with Player Traits, his durability. The
// grade the user sees is his medical staff's read of that risk, with noise from a seeded RNG of its own (pid and draft year), narrowed
// by a better scouting and medical budget. AI teams draft on the risk itself.

export type MedicalGrade = "clean" | "minor" | "redFlag";

export type CombineMedical = {
	// As the user's medical staff reads it
	grade: MedicalGrade;
	// His actual risk (MEDICAL_THRESHOLDS), what AI teams draft on
	risk: number;
};

export const MEDICAL_GRADE_NAMES: Record<MedicalGrade, string> = {
	clean: "Clean",
	minor: "Minor concerns",
	redFlag: "Red flag",
};

export const MEDICAL_EXPLANATION =
	"Medical grade from the combine physicals: your medical staff's read of his injury history and how well his body holds up. A better scouting and medical budget makes the read more accurate.";

// Risk below minor: clean; below redFlag: minor concerns; above: red flag
export const MEDICAL_THRESHOLDS = { minor: 1, redFlag: 2.4 };

export const medicalGradeOf = (risk: number): MedicalGrade =>
	risk >= MEDICAL_THRESHOLDS.redFlag
		? "redFlag"
		: risk >= MEDICAL_THRESHOLDS.minor
			? "minor"
			: "clean";

export const medicalRisk = ({
	season,
	injuries,
	durability,
	injuredNow,
}: {
	// Draft year
	season: number;
	injuries: CareerInjury[];
	// Durability trait score (0-100), when Player Traits is on
	durability?: number;
	injuredNow?: boolean;
}) => {
	let risk = 0;
	for (const inj of injuries) {
		const yearsAgo = season - inj.season;
		const recency = yearsAgo <= 0 ? 1 : yearsAgo === 1 ? 0.8 : 0.6;
		const base = inj.ended
			? RECONSTRUCTIONS.has(inj.type)
				? 3
				: 2.4
			: inj.major
				? 1.4
				: 0.45;
		risk += recency * base;
	}
	if (injuredNow) {
		risk += 0.8;
	}
	if (durability !== undefined) {
		risk += Math.max(-0.7, Math.min(1.8, (50 - durability) / 15));
	}
	return Math.round(Math.max(0, risk) * 100) / 100;
};

// The noise on the user's read: budget effects (levelToEffect, about -1 to 1, 0 at the league average) of scouting and medical (health)
export const medicalNoiseSd = (scoutingEffect: number, healthEffect: number) =>
	0.6 *
	Math.max(
		0.35,
		Math.min(1.7, 1 - 0.25 * scoutingEffect - 0.35 * healthEffect),
	);

export const generateMedical = ({
	pid,
	season,
	risk,
	noiseSd,
}: {
	pid: number;
	season: number;
	risk: number;
	noiseSd: number;
}): CombineMedical => {
	const rng = new Rng(`draftCombineMedical|${pid}|${season}`);
	const read = risk + noiseSd * rng.normal(0, 1);
	return { grade: medicalGradeOf(read), risk };
};

// What AI teams take off a prospect's draft value (value points) for his medical risk: a little for a red flag
export const MEDICAL_DRAFT_PENALTY: Record<MedicalGrade, number> = {
	clean: 0,
	minor: 0.3,
	redFlag: 1.2,
};

const gamesText = (n: number) => `${n} ${n === 1 ? "game" : "games"}`;

// One plain line on why: his most serious injuries before the draft
export const medicalReason = (
	injuries: CareerInjury[],
	injuredNow?: boolean,
) => {
	const parts = [...injuries]
		.sort(
			(a, b) =>
				Number(!!b.ended) - Number(!!a.ended) ||
				Number(!!b.major) - Number(!!a.major) ||
				b.season - a.season,
		)
		.slice(0, 2)
		.map((inj) =>
			inj.ended
				? `${inj.type} (${inj.season}, season-ending)`
				: `${inj.type} (${inj.season}, missed ${gamesText(inj.games)})`,
		);
	if (injuredNow) {
		parts.unshift("injured now");
	}
	if (parts.length === 0) {
		return "No injuries before the draft";
	}
	const more = injuries.length - Math.min(2, injuries.length);
	const s = `${parts.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
	return s.charAt(0).toUpperCase() + s.slice(1);
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

	const zMxv = r.mxv !== undefined ? z(r.mxv, REF.jmp) : zJmp;
	const zStj = r.stj !== undefined ? z(r.stj, REF.jmp) : zJmp;
	const zLat = r.lat !== undefined ? z(r.lat, REF.spd) : zSpd;
	const zSls = r.sls !== undefined ? z(r.sls, REF.spd) : zSpd;
	const maxVertExp = 35.2 + 3 * zMxv + 0.6 * zSls - 0.025 * w;
	const maxVert = roundTo(clamp(maxVertExp + 2 * nVert, 24, 46), 0.5);
	const standingVert = roundTo(
		clamp(
			maxVert - 5 + 0.3 * zStre + 1.5 * (zStj - zMxv) + 1 * nStand,
			19,
			Math.min(40, maxVert - 1),
		),
		0.5,
	);
	const laneExp = 11.28 - 0.3 * zLat - 0.05 * zJmp + 0.004 * w;
	const laneAgility = round2(clamp(laneExp + 0.25 * nLane, 10.05, 13));
	const shuttleExp = 3.07 - 0.1 * zLat + 0.0012 * w;
	const shuttle = round2(clamp(shuttleExp + 0.09 * nShuttle, 2.6, 3.7));
	const sprintExp = 3.28 - 0.085 * zSls + 0.001 * w;
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

	// Effort: most prospects go all out, a few coast through the testing (a stream of its own, so the draws above never move)
	const effort = drillEffort(pid, season);
	const slack = 1 - effort;
	const maxVertE = roundTo(clamp(maxVert - 4.5 * slack, 22, 46), 0.5);
	const standingVertE = roundTo(
		clamp(standingVert - 3.5 * slack, 18, Math.min(40, maxVertE - 1)),
		0.5,
	);
	const laneAgilityE = round2(clamp(laneAgility + 0.7 * slack, 10.05, 13.3));
	const shuttleE = round2(clamp(shuttle + 0.22 * slack, 2.6, 3.8));
	const sprintE = round2(clamp(sprint + 0.14 * slack, 2.95, 3.9));
	const benchE = Math.max(0, Math.round(bench - 5 * slack));

	// Over/under-performance: each drill's result against what his ratings predict, in standard deviations, averaged so the
	// total is about N(0, 1). Teams see through a prospect coasting: it's read from what he'd have done going all out
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
			laneAgility: laneAgilityE,
			shuttle: shuttleE,
			sprint: sprintE,
			standingVert: standingVertE,
			maxVert: maxVertE,
			bench: benchE,
			spotUp,
			offDribble,
			freeThrows,
		},
		performance,
		...(effort < 1 ? { effort } : {}),
	};
};

// How hard he went in the drills: 1 for most, 0.55-0.85 for the one in nine or so who coasts through them
export const COAST_CHANCE = 0.11;
export const drillEffort = (pid: number, season: number) => {
	const rng = new Rng(`draftCombineEffort|${pid}|${season}`);
	if (rng.random() >= COAST_CHANCE) {
		return 1;
	}
	return Math.round((0.55 + 0.3 * rng.random()) * 100) / 100;
};

// ---- Listed vs measured ----
// Before the combine, the public numbers are his school's or club's listing: heights are often rounded up an inch or two (a few
// are listed short), weights are out of date. The combine measures him (his true height and weight plus a little noise), and a big
// difference makes a story. Derived from pid, draft year and his true height and weight with an RNG of its own: nothing stored.

export type ListedMeasurements = {
	// Height with shoes as listed, inches (whole inches)
	height: number;
	// Weight as listed, lbs (rounded to 5)
	weight: number;
};

export const listedMeasurements = ({
	pid,
	season,
	heightInches,
	weight,
}: {
	pid: number;
	season: number;
	heightInches: number;
	weight: number;
}): ListedMeasurements => {
	const rng = new Rng(`draftCombineListed|${pid}|${season}`);
	const u = rng.random();
	const inflation =
		u < 0.1 ? -1 : u < 0.3 ? 0 : u < 0.74 ? 1 : u < 0.93 ? 2 : 3;
	const listedWeight = Math.round((weight - 3 + rng.normal(0, 7)) / 5) * 5;
	return {
		height: Math.round(heightInches) + inflation,
		weight: listedWeight,
	};
};

// Big enough to be a story: 1.5" shorter or 1" taller in shoes than listed, 10 lbs either way
export const MISMEASURE_HEIGHT = 1.5;
export const MISMEASURE_WEIGHT = 10;

export type MeasurementStory = {
	kind: "shorter" | "taller" | "heavier" | "lighter";
	text: string;
};

export const measurementStories = (
	listed: ListedMeasurements,
	measured: Pick<
		CombineMeasurements,
		"heightShoes" | "heightNoShoes" | "weight"
	>,
): MeasurementStory[] => {
	const out: MeasurementStory[] = [];
	const dh = measured.heightShoes - listed.height;
	if (dh <= -MISMEASURE_HEIGHT) {
		out.push({
			kind: "shorter",
			text: `Shorter than billed: listed at ${feetInches(listed.height)}, measured ${feetInches(measured.heightShoes)} in shoes (${feetInches(measured.heightNoShoes)} without)`,
		});
	} else if (dh >= 1) {
		out.push({
			kind: "taller",
			text: `Taller than listed: ${feetInches(measured.heightShoes)} in shoes against a listed ${feetInches(listed.height)}`,
		});
	}
	const dw = measured.weight - listed.weight;
	if (dw >= MISMEASURE_WEIGHT) {
		out.push({
			kind: "heavier",
			text: `Weighed in at ${measured.weight} lbs, ${dw} more than his listed ${listed.weight}`,
		});
	} else if (dw <= -MISMEASURE_WEIGHT) {
		out.push({
			kind: "lighter",
			text: `Weighed in at ${measured.weight} lbs, ${-dw} under his listed ${listed.weight}`,
		});
	}
	return out;
};

// Scouting Director & Regions: the combine's looks (the fuzz narrowing it buys) are worth less when he only got measured (skipped
// the drills) or coasted through them
export const combineLooksMult = (
	res: Pick<DraftCombineResult, "drills" | "effort">,
) => (!res.drills ? 0.55 : res.effort !== undefined ? 0.8 : 1);

export const effortStory = (effort: number | undefined) =>
	effort === undefined
		? undefined
		: effort < 0.7
			? "Looked like he was going through the motions in the drills"
			: "Didn't look like he went all out in the drills";

// ---- Percentiles against combine history ----

// Every past result per test, sorted ascending (for historyPercentile)
export type CombineHistory = Partial<Record<CombineKey, number[]>>;

export const buildCombineHistory = (
	results: Iterable<Pick<DraftCombineResult, "measurements" | "drills">>,
): CombineHistory => {
	const out: CombineHistory = {};
	for (const res of results) {
		for (const col of COMBINE_COLUMNS) {
			const v = combineValue(res as DraftCombineResult, col.key);
			if (v !== undefined) {
				(out[col.key] ??= []).push(v);
			}
		}
	}
	for (const list of Object.values(out)) {
		list.sort((a, b) => a - b);
	}
	return out;
};

// Fewer past results than this for a test: compare with real NBA combines instead
export const MIN_HISTORY = 40;

const normalCdf = (x: number) => {
	// Abramowitz-Stegun approximation
	const t = 1 / (1 + 0.2316419 * Math.abs(x));
	const d = 0.3989423 * Math.exp((-x * x) / 2);
	const p =
		d *
		t *
		(0.3193815 +
			t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
	return x > 0 ? 1 - p : p;
};

export type HistoryPct = { pct: number; source: "league" | "real"; n: number };

/**
 * Percentile (0-100, higher is better; weight: heavier is higher) of a result against every earlier combine of this league, or against
 * real NBA combines (COMBINE_REAL_RANGES, a normal fit) while the league has fewer than MIN_HISTORY results for that test.
 */
export const historyPercentile = (
	key: CombineKey,
	v: number,
	history: CombineHistory,
): HistoryPct => {
	const col = COMBINE_COLUMN_BY_KEY[key];
	const list = history[key];
	let pct: number;
	let source: HistoryPct["source"];
	let n = 0;
	if (list && list.length >= MIN_HISTORY) {
		source = "league";
		n = list.length;
		let below = 0;
		let equal = 0;
		for (const x of list) {
			if (x < v) {
				below += 1;
			} else if (x === v) {
				equal += 1;
			}
		}
		pct = (100 * (below + 0.5 * equal)) / list.length;
	} else {
		source = "real";
		const ref = COMBINE_REAL_RANGES[key];
		// Shooting drills are make rates in the reference
		const x =
			key === "spotUp" || key === "offDribble" || key === "freeThrows"
				? v / SHOOTING_ATTEMPTS[key]
				: v;
		pct = 100 * normalCdf((x - ref.mean) / ref.sd);
	}
	if (col.lowerBetter) {
		pct = 100 - pct;
	}
	return { pct: Math.max(0, Math.min(100, Math.round(pct))), source, n };
};

export const historyPercentiles = (
	res: Pick<DraftCombineResult, "measurements" | "drills">,
	history: CombineHistory,
) => {
	const out: Partial<Record<CombineKey, HistoryPct>> = {};
	for (const col of COMBINE_COLUMNS) {
		const v = combineValue(res as DraftCombineResult, col.key);
		if (v !== undefined) {
			out[col.key] = historyPercentile(col.key, v, history);
		}
	}
	return out;
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
	// His school's listing, for the listed vs measured story
	listed?: ListedMeasurements,
) => {
	const notes: string[] = [];
	const m = res.measurements;
	const ape = m.wingspan - m.heightNoShoes;
	notes.push(
		`Measured ${feetInches(m.heightNoShoes)} without shoes, ${feetInches(m.wingspan)} wingspan (${ape >= 0 ? "+" : ""}${ape.toFixed(2).replace(/\.?0+$/, "")}" ape index)`,
	);
	if (listed) {
		for (const story of measurementStories(listed, m)) {
			notes.push(story.text);
		}
	}
	const effortNote = effortStory(res.effort);
	if (res.drills && effortNote) {
		notes.push(effortNote);
	}
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
