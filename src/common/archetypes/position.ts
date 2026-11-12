import type {
	ArchetypeDef,
	ArchetypeGroup,
	ArchetypeRatings,
	Pos,
} from "./types.ts";

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
// Size band first, then the role within it. Three readings of a player:
// - LENGTH, in inches: his height plus part of his wingspan beyond it (expanded ratings), nudged by his build (strength,
//   defensive more than offensive rebounding, interior defense and inside scoring push him up; speed and perimeter defense
//   down). Strength and rebounding count far less than they used to, so a strong or rebounding guard stays a guard.
// - BALL SKILLS: passing, dribbling, three, speed, offensive IQ and perimeter defense, against his overall level.
// - PLAYMAKING ("who runs the offense"): with real minutes, his assist and usage rates (last and current season, by
//   minutes); without, passing, dribbling, offensive IQ and ball security, against his overall level.
// The band (guard / wing / big) comes from length, moved toward the guards for a playmaker (a 6'8" point forward is a wing,
// not a big), with hard limits: under 6'4" never a big, 7'0" or taller never a guard. Within the band he gets the nearest
// position centroid (length, playmaking, ball skills). Everything is on fixed scales (inches, percentiles against generated
// players and against real NBA seasons), so positions do not drift with the league. Fitted on the real players' listed
// positions (seasons 2000-2015, checked on 2016-2025) and on the 2025 stars, with biases for sensible shares in a random league.

type PosRatings = Pick<
	ArchetypeRatings,
	| "hgt"
	| "stre"
	| "spd"
	| "jmp"
	| "endu"
	| "ins"
	| "dnk"
	| "ft"
	| "fg"
	| "tp"
	| "oiq"
	| "diq"
	| "drb"
	| "pss"
	| "reb"
	| "wng"
	| "pdef"
	| "idef"
	| "oreb"
	| "dreb"
	| "bsc"
>;

// A season's (or two seasons') regular-season playmaking stats: minutes, assist and usage percentage
export type PositionStats = { min: number; astp: number; usgp: number };

// BBGM's hgt rating spans 5'6" (0) to 7'9" (100)
export const hgtToInches = (hgt: number) => 66 + 0.27 * hgt;

const level = (r: PosRatings) =>
	(r.stre +
		r.spd +
		r.jmp +
		r.endu +
		r.ins +
		r.dnk +
		r.ft +
		r.fg +
		r.tp +
		r.oiq +
		r.diq +
		r.drb +
		r.pss +
		r.reb) /
	14;

// Share of the wingspan-minus-height gap that counts as length, and of the build
const WINGSPAN_K = 0.264;
const BUILD_K = 0.834;
// Share of his overall level taken out of ball skills and playmaking (a star is good at everything)
const LEVEL_K = 0.464;

export const positionRaw = (r: PosRatings) => {
	const lvl = level(r);
	const wng = r.wng ?? r.hgt;
	// Without expanded ratings: rebounding and defensive IQ stand in for the split ratings
	const reb =
		r.dreb !== undefined && r.oreb !== undefined
			? 0.7 * r.dreb + 0.3 * r.oreb
			: r.reb;
	const idef = r.idef ?? r.diq;
	const pdef = r.pdef ?? r.diq;
	const build =
		0.1 * (r.stre - lvl) +
		0.15 * (reb - lvl) +
		0.1 * (idef - lvl) +
		0.05 * (r.ins - lvl) -
		0.05 * (r.spd - lvl) -
		0.05 * (pdef - lvl);
	return {
		inches: hgtToInches(r.hgt),
		length: hgtToInches(r.hgt + WINGSPAN_K * (wng - r.hgt) + BUILD_K * build),
		ballSkills:
			(1.2 * r.pss +
				1 * r.drb +
				0.6 * r.tp +
				0.5 * r.spd +
				0.4 * r.oiq +
				0.3 * pdef) /
				4 -
			LEVEL_K * lvl,
		playmaking:
			(1.4 * r.pss + 0.9 * r.drb + 0.4 * r.oiq + 0.3 * (r.bsc ?? r.drb)) / 3 -
			LEVEL_K * lvl,
	};
};

// Reference quantiles (0%, 5%, ..., 100%): ball skills and playmaking of generated players (ovr >= 38), and assist% + usage%/10
// of real NBA players with 500+ minutes, 2000-2025
const SKILL_KNOTS = [
	12.29, 18.58, 20.18, 21.29, 22.15, 22.91, 23.64, 24.32, 25.03, 25.73, 26.45,
	27.25, 28.01, 28.93, 30.03, 31.21, 32.6, 34.17, 36.07, 38.82, 48,
];
const PLAY_KNOTS = [
	3.88, 15.56, 17.98, 19.82, 21.38, 22.58, 23.57, 24.55, 25.48, 26.33, 27.17,
	28.09, 29.02, 30.13, 31.25, 32.59, 34.25, 36.39, 39.17, 43.44, 55.04,
];
const PLAY_STAT_KNOTS = [
	1.55, 5.8, 6.88, 7.79, 8.55, 9.21, 9.93, 10.65, 11.43, 12.25, 13.18, 14.42,
	15.76, 17.27, 19.09, 21.25, 24.02, 26.79, 30.08, 35.07, 61.47,
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

// Share of playmaking read from stats at PLAY_STATS_FULL_MIN minutes or more (scaled down below, none without minutes)
const PLAY_STATS_W = 0.817;
const PLAY_STATS_FULL_MIN = 1500;

// inches: his height; length: inches of size (see above); skill, play: percentiles
export type PositionAxes = {
	inches: number;
	length: number;
	skill: number;
	play: number;
	// How much of playmaking comes from his stats, 0..1 (0: read from his ratings alone)
	fromStats?: number;
};

export const positionAxes = (
	r: PosRatings,
	stats?: PositionStats,
): PositionAxes => {
	const raw = positionRaw(r);
	let play = percentile(PLAY_KNOTS, raw.playmaking);
	let fromStats = 0;
	if (
		stats &&
		stats.min > 0 &&
		Number.isFinite(stats.astp) &&
		Number.isFinite(stats.usgp)
	) {
		const w = PLAY_STATS_W * Math.min(1, stats.min / PLAY_STATS_FULL_MIN);
		play =
			(1 - w) * play +
			w * percentile(PLAY_STAT_KNOTS, stats.astp + 0.1 * stats.usgp);
		fromStats = w / PLAY_STATS_W;
	}
	return {
		inches: raw.inches,
		length: raw.length,
		skill: percentile(SKILL_KNOTS, raw.ballSkills),
		play,
		fromStats,
	};
};

// His regular-season playmaking stats over `season` and the one before (a stats row per team stint), by minutes
export const positionStats = (
	rows: unknown,
	season: number,
): PositionStats | undefined => {
	if (!Array.isArray(rows)) {
		return undefined;
	}
	let min = 0;
	let astp = 0;
	let usgp = 0;
	for (const row of rows) {
		if (
			row &&
			!row.playoffs &&
			(row.season === season || row.season === season - 1) &&
			row.min > 0 &&
			Number.isFinite(row.astp) &&
			Number.isFinite(row.usgp)
		) {
			min += row.min;
			astp += row.astp * row.min;
			usgp += row.usgp * row.min;
		}
	}
	return min > 0 ? { min, astp: astp / min, usgp: usgp / min } : undefined;
};

export type SizeBand = "guard" | "wing" | "big";

export const BAND_POSITIONS: Record<SizeBand, Pos[]> = {
	guard: ["PG", "G", "SG"],
	wing: ["SG", "GF", "SF", "F"],
	big: ["F", "PF", "FC", "C"],
};

// Band cutoffs on length minus BAND_PLAY_K inches per unit of playmaking above the median
const GUARD_MAX = 76.726;
const WING_MAX = 82.311;
const BAND_PLAY_K = 5.17;
// Hard limits, in inches of height: never a big under 6'4", never a guard at 7'0"
const BIG_MIN_INCHES = 76;
const GUARD_MAX_INCHES = 84;

export const sizeBand = (a: PositionAxes): SizeBand => {
	const x = a.length - BAND_PLAY_K * (a.play - 0.5);
	const band = x < GUARD_MAX ? "guard" : x < WING_MAX ? "wing" : "big";
	if (band === "big" && a.inches < BIG_MIN_INCHES) {
		return "wing";
	}
	if (band === "guard" && a.inches >= GUARD_MAX_INCHES) {
		return "wing";
	}
	return band;
};

// [length in inches, playmaking, ball skills]
export const POSITION_CENTROIDS: Record<Pos, [number, number, number]> = {
	PG: [74.59, 0.89, 0.65],
	G: [75.39, 0.64, 0.68],
	SG: [76.28, 0.42, 0.61],
	GF: [77.99, 0.55, 0.51],
	SF: [79.3, 0.43, 0.46],
	F: [80.34, 0.37, 0.35],
	PF: [82.51, 0.3, 0.27],
	FC: [83.45, 0.43, 0.14],
	C: [84.96, 0.28, 0.2],
};

export const POSITION_BIAS: Record<Pos, number> = {
	PG: -0.36,
	G: -0.39,
	SG: -0.46,
	GF: 0.3,
	SF: 0.2,
	F: -0.03,
	PF: 0.24,
	FC: 0.33,
	C: -0.86,
};

// arch13: playmaking read from ratings alone (a generated player before his first minutes, a draft prospect) puts more
// players at point guard than their stats later do: a random league read from ratings had 18.1% PG against 14.3% with
// BBGM's formula (real NBA 2016-2025 listings: 12.1%), the extra ones combo guards (old formula G). Without stats, PG's
// bias is RATINGS_ONLY_PG lower, faded out as his stats take over (`fromStats`), so a player with a full season of minutes
// reads exactly as before.
export const RATINGS_ONLY_PG = 1.2;

// Distance scales: inches of length, and percentile points (per 0.25) of playmaking and ball skills, weighted
const LENGTH_SCALE = 1.472;
const PLAY_WEIGHT = 0.976;
const SKILL_WEIGHT = 0.299;

// A re-assigned player keeps his previous position unless the best one is closer by at least this much, both on this season's
// reading and on the average of this and last season's
export const POSITION_STICKINESS = 0.3;

const posDistance = (a: PositionAxes, pos: Pos) => {
	const [l, p, k] = POSITION_CENTROIDS[pos];
	return (
		((a.length - l) / LENGTH_SCALE) ** 2 +
		PLAY_WEIGHT * ((a.play - p) / 0.25) ** 2 +
		SKILL_WEIGHT * ((a.skill - k) / 0.25) ** 2 -
		POSITION_BIAS[pos] -
		(pos === "PG" ? -(1 - (a.fromStats ?? 0)) * RATINGS_ONLY_PG : 0)
	);
};

const nearestPosition = (a: PositionAxes): Pos => {
	let best: Pos = "F";
	let bestD = Infinity;
	for (const pos of BAND_POSITIONS[sizeBand(a)]) {
		const d = posDistance(a, pos);
		if (d < bestD) {
			bestD = d;
			best = pos;
		}
	}
	return best;
};

const averageAxes = (a: PositionAxes, b: PositionAxes): PositionAxes => ({
	inches: (a.inches + b.inches) / 2,
	length: (a.length + b.length) / 2,
	skill: (a.skill + b.skill) / 2,
	play: (a.play + b.play) / 2,
	fromStats: ((a.fromStats ?? 0) + (b.fromStats ?? 0)) / 2,
});

// `previous`: his current position, kept unless the new one is clearly better now and over two seasons (`previousAxes`: last
// season's reading)
export const improvedPosition = (
	axes: PositionAxes,
	previous?: unknown,
	previousAxes?: PositionAxes,
	margin = POSITION_STICKINESS,
): Pos => {
	const best = nearestPosition(axes);
	if (isPos(previous) && previous !== best) {
		for (const a of previousAxes
			? [axes, averageAxes(axes, previousAxes)]
			: [axes]) {
			if (
				nearestPosition(a) !== best ||
				posDistance(a, previous) - posDistance(a, best) < margin
			) {
				return previous;
			}
		}
	}
	return best;
};

export type PositionContext = {
	// His box-score stats (rows as stored on a player): assist and usage rates of this and last regular season
	stats?: unknown;
	// Last season's ratings, for the two-season comparison when re-assigning
	previousRatings?: PosRatings & { season?: number };
};

// Position for ratings: the improved model when on (sticky to `previous`), else BBGM's formula
export const positionFor = (
	ratings: Pick<ArchetypeRatings, keyof ArchetypeRatings> & {
		season?: number;
	},
	improved: boolean,
	previous?: unknown,
	context?: PositionContext,
): Pos => {
	if (!improved) {
		return positionOf(ratings);
	}
	const season = ratings.season;
	const axes = positionAxes(
		ratings,
		season === undefined ? undefined : positionStats(context?.stats, season),
	);
	const prev = context?.previousRatings;
	const prevAxes =
		prev && isPos(previous)
			? positionAxes(
					prev,
					prev.season === undefined
						? undefined
						: positionStats(context?.stats, prev.season),
				)
			: undefined;
	return improvedPosition(axes, previous, prevAxes);
};

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

// An archetype's position prior for a player at `pos`: null when its allowed positions (a hard gate) leave him out, else
// the group's soft nudge (with the archetype's overrides). Universal archetypes have no group nudge.
export const archetypePrior = (
	a: Pick<ArchetypeDef, "group" | "pos" | "positions" | "tags">,
	pos: Pos,
): number | null => {
	if (!a.positions.includes(pos)) {
		return null;
	}
	if (a.tags.includes("universal")) {
		return (a.pos?.[pos] as number | undefined) ?? 0;
	}
	return posPrior(a.group, a.pos, pos);
};

// ---- What a label's NAME says about position ----
// A label must not name a position the player does not play: "... Center" is for FC/C, "... Guard" for PG/G/SG, and so on.
// Every rule that matches narrows the set. The two named exceptions are taken out of the name once matched (so a "Point
// Forward" is not also read as a "Point" guard or a plain "Forward").
export type PosWord = "guard" | "wing" | "forward" | "big";

const NAME_RULES: [RegExp, Pos[], PosWord, true?][] = [
	// Explicit exceptions: a point forward is a forward who runs the offense, a point center a center who does
	[/\bPoint Forward\b/, ["GF", "SF", "F", "PF"], "forward", true],
	[/\bPoint Center\b/, ["FC", "C"], "big", true],
	// (2K: a power forward who runs the offense)
	[/\bPoint Four\b/, ["F", "PF", "FC"], "forward", true],
	// "Point of Attack" is a defensive role, not the position
	[/\bPoint\b(?! of\b)/, ["PG", "G"], "guard"],
	[/\bGuard\b/, ["PG", "G", "SG"], "guard"],
	[/\bWing\b/, ["SG", "GF", "SF", "F"], "wing"],
	[/\bFour\b/, ["F", "PF", "FC"], "forward"],
	[/\bForward\b/, ["SF", "F", "PF", "FC"], "forward"],
	[/\b(?:Center|Five)\b/, ["FC", "C"], "big"],
	// "Big" as the noun: a "Big Guard" or a "Big Wing" is a tall guard or wing (and the 2K nicknames Big Glide, Big Range
	// and Big Smooth name no position)
	[/\bBig\b(?! (?:Guard|Wing|Glide|Range|Smooth)\b)/, ["PF", "FC", "C"], "big"],
];

const nameInfoCache = new Map<
	string,
	{ positions: Pos[] | null; word: PosWord | null }
>();
const nameInfo = (name: string) => {
	let info = nameInfoCache.get(name);
	if (!info) {
		let rest = name;
		let positions: Pos[] | null = null;
		let word: PosWord | null = null;
		for (const [re, ps, w, takeOut] of NAME_RULES) {
			if (re.test(rest)) {
				if (takeOut) {
					rest = rest.replace(re, " ");
				}
				positions = positions ? positions.filter((p) => ps.includes(p)) : ps;
				word ??= w;
			}
		}
		info = { positions, word };
		nameInfoCache.set(name, info);
	}
	return info;
};

// The positions a label's name allows (null: the name names no position)
export const namePositions = (name: string): Pos[] | null =>
	nameInfo(name).positions;

// The position a label's name names, as a family: "Lockdown Guard" -> guard, "Stretch Four" -> forward, "Point Center" -> big
export const positionWordOf = (name: string): PosWord | null =>
	nameInfo(name).word;

// Does the name say he plays somewhere else?
export const nameContradictsPosition = (name: string, pos: Pos) => {
	const ps = namePositions(name);
	return ps !== null && !ps.includes(pos);
};

// Two labels that name different positions ("Switchable Forward / Switchable Center") cannot describe one player
export const namesContradict = (a: string, b: string) => {
	const x = positionWordOf(a);
	const y = positionWordOf(b);
	return x !== null && y !== null && x !== y;
};
