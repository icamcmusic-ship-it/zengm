import type { ArchetypeGroup, ArchetypeRatings, Pos } from "./types.ts";

const POS_VALUES: Record<Pos, number> = {
	PG: 0,
	SG: 1,
	SF: 2,
	PF: 3,
	C: 4,
	G: 0.5,
	F: 2.5,
	FC: 3.5,
	GF: 1.5,
};

export const POSITIONS: Pos[] = [
	"PG",
	"G",
	"SG",
	"GF",
	"SF",
	"F",
	"PF",
	"FC",
	"C",
];

// BBGM's basketball position from ratings (the game's own regression, see analysis/pos-basketball). The worker's
// pos.basketball.ts uses this too, so an archetype and the position shown next to it are read the same way.
export const positionOf = (
	ratings: Pick<ArchetypeRatings, keyof ArchetypeRatings>,
): Pos => {
	const value =
		-0.922949 +
		0.073339 * ratings.hgt +
		0.009744 * ratings.stre +
		-0.002215 * ratings.spd +
		-0.005438 * ratings.jmp +
		0.003006 * ratings.endu +
		-0.003516 * ratings.ins +
		-0.008239 * ratings.dnk +
		0.001647 * ratings.ft +
		-0.001404 * ratings.fg +
		-0.004599 * ratings.tp +
		0.001407 * ratings.diq +
		0.002433 * ratings.oiq +
		-0.000753 * ratings.drb +
		-0.021888 * ratings.pss +
		0.016867 * ratings.reb;

	let minDiff = Infinity;
	let minDiffPos: Pos = "F";
	for (const [pos, posValue] of Object.entries(POS_VALUES) as [Pos, number][]) {
		const diff = Math.abs(value - posValue);
		if (diff < minDiff) {
			minDiff = diff;
			minDiffPos = pos;
		}
	}
	return minDiffPos;
};

// ---- Improved positions (league setting "Improved positions") ----
// Two axes instead of one line: SIZE (height first, then strength, rebounding, inside scoring and rim protection) and
// BALL SKILLS (passing, dribbling, three point shooting, speed, offensive IQ). Each raw score is turned into a percentile
// against a fixed reference distribution (generated players, see positionFit.script.test.ts), so a position does not move
// with the league around him. The nine positions are centroids in that square; a player gets the nearest one (minus a
// per-position bias fitted so the overall shares stay close to the old formula's).

type PosRatings = Pick<
	ArchetypeRatings,
	| "hgt"
	| "stre"
	| "reb"
	| "ins"
	| "jmp"
	| "diq"
	| "pss"
	| "drb"
	| "tp"
	| "spd"
	| "oiq"
>;

export const sizeRaw = (r: PosRatings) =>
	(4 * r.hgt +
		0.8 * r.stre +
		0.8 * r.reb +
		0.4 * r.ins +
		0.2 * r.jmp +
		0.2 * r.diq) /
	6.4;

export const ballSkillsRaw = (r: PosRatings) =>
	(1.2 * r.pss + 1 * r.drb + 0.6 * r.tp + 0.5 * r.spd + 0.4 * r.oiq) / 3.7;

// Reference quantiles (0%, 5%, ..., 100%) of the raw scores
const SIZE_KNOTS = [
	15.94, 31.84, 34.72, 37.06, 39.5, 41.59, 43.47, 45.06, 46.44, 47.69, 48.72,
	49.66, 50.66, 51.75, 53.22, 55.06, 57.31, 59.28, 61.22, 64.09, 89.16,
];
const SKILL_KNOTS = [
	30.35, 38.05, 40.19, 41.62, 42.78, 43.86, 44.81, 45.76, 46.76, 47.7, 48.65,
	49.73, 50.92, 52.22, 53.73, 55.43, 57.49, 59.65, 61.97, 65.65, 83.14,
];

const percentile = (knots: number[], x: number) => {
	const k = knots.length - 1;
	if (x <= knots[0]!) {
		return 0;
	}
	if (x >= knots[k]!) {
		return 1;
	}
	for (let i = 1; i <= k; i++) {
		if (x <= knots[i]!) {
			const lo = knots[i - 1]!;
			const hi = knots[i]!;
			return (i - 1 + (hi > lo ? (x - lo) / (hi - lo) : 0.5)) / k;
		}
	}
	return 1;
};

export type PositionAxes = { size: number; skill: number };

export const positionAxes = (r: PosRatings): PositionAxes => ({
	size: percentile(SIZE_KNOTS, sizeRaw(r)),
	skill: percentile(SKILL_KNOTS, ballSkillsRaw(r)),
});

// [size, ball skills] percentiles
export const POSITION_CENTROIDS: Record<Pos, [number, number]> = {
	PG: [0.08, 0.85],
	G: [0.15, 0.7],
	SG: [0.25, 0.58],
	GF: [0.38, 0.55],
	SF: [0.5, 0.42],
	F: [0.63, 0.5],
	PF: [0.76, 0.28],
	FC: [0.86, 0.45],
	C: [0.93, 0.18],
};

export const POSITION_BIAS: Record<Pos, number> = {
	PG: 0.018,
	G: 0.011,
	SG: 0.008,
	GF: 0.022,
	SF: 0.015,
	F: 0.028,
	PF: -0.03,
	FC: 0.015,
	C: -0.044,
};

// Ball skills count a bit less than size: the skill axis is noisier (a big can have a few good passing years)
const SKILL_WEIGHT = 0.8;

// A re-assigned player keeps his previous position unless the best one is closer by at least this much
export const POSITION_STICKINESS = 0.02;

const posDistance = (a: PositionAxes, pos: Pos, bias: Record<Pos, number>) => {
	const [s, k] = POSITION_CENTROIDS[pos];
	return (a.size - s) ** 2 + SKILL_WEIGHT * (a.skill - k) ** 2 - bias[pos];
};

export const improvedPosition = (
	axes: PositionAxes,
	previous?: unknown,
	bias: Record<Pos, number> = POSITION_BIAS,
	margin = POSITION_STICKINESS,
): Pos => {
	let best: Pos = "F";
	let bestD = Infinity;
	for (const pos of POSITIONS) {
		const d = posDistance(axes, pos, bias);
		if (d < bestD) {
			bestD = d;
			best = pos;
		}
	}
	if (isPos(previous) && previous !== best) {
		if (posDistance(axes, previous, bias) - bestD < margin) {
			return previous;
		}
	}
	return best;
};

// Position for ratings: the improved two-axis model when on (sticky to `previous`), else BBGM's formula
export const positionFor = (
	ratings: Pick<ArchetypeRatings, keyof ArchetypeRatings>,
	improved: boolean,
	previous?: unknown,
): Pos =>
	improved
		? improvedPosition(positionAxes(ratings), previous)
		: positionOf(ratings);

export const isPos = (x: unknown): x is Pos =>
	typeof x === "string" && (POSITIONS as string[]).includes(x);

// Position is a strong prior on an archetype: an additive nudge on the fit z, or null when the pairing is never allowed.
// Archetypes can override single positions (a Big Guard may be a GF), but HARD_BLOCK always wins.
export const GROUP_POS_PRIOR: Record<
	ArchetypeGroup,
	Record<Pos, number | null>
> = {
	guard: {
		PG: 0,
		G: 0,
		SG: 0,
		GF: -0.3,
		SF: -1,
		F: null,
		PF: null,
		FC: null,
		C: null,
	},
	wing: {
		PG: -0.8,
		G: -0.4,
		SG: 0,
		GF: 0,
		SF: 0,
		F: 0,
		PF: -0.6,
		FC: -1.2,
		C: -2,
	},
	forward: {
		PG: null,
		G: null,
		SG: -1.5,
		GF: -0.5,
		SF: -0.1,
		F: 0,
		PF: 0,
		FC: 0,
		// A "... Forward" label reads wrong on a center: only when no big archetype fits
		C: -0.8,
	},
	big: {
		PG: null,
		G: null,
		SG: null,
		GF: null,
		SF: -1.5,
		F: -0.4,
		PF: 0,
		FC: 0,
		C: 0,
	},
};

// Pairings that are wrong whatever an archetype says: a guard is never a big or a forward, a center or power forward is
// never a guard, a GF is never a big
export const HARD_BLOCK: Record<ArchetypeGroup, Pos[]> = {
	guard: ["F", "PF", "FC", "C"],
	wing: [],
	forward: ["PG", "G"],
	big: ["PG", "G", "SG", "GF"],
};

export const posPrior = (
	group: ArchetypeGroup,
	override: Partial<Record<Pos, number | null>> | undefined,
	pos: Pos,
): number | null => {
	if (HARD_BLOCK[group].includes(pos)) {
		return null;
	}
	if (override && pos in override) {
		return override[pos] as number | null;
	}
	return GROUP_POS_PRIOR[group][pos];
};
