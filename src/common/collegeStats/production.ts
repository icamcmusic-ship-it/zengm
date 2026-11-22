import { LOWER_LEVEL_INFO, getLowerLevel } from "./colleges.ts";
import { getSchool } from "./colleges.helpers.ts";
import { isJuco } from "./juco.ts";
import { clamp } from "./rng.ts";
import { PACE_40, SOS_REFERENCE } from "./teams.ts";

/**
 * Context-adjusted pre-draft stats: what a season's numbers are worth once the schedule, his team's pace and his age are taken into
 * account. Read off stored stats rows, so they work for every league, also ones whose stats were made before the context model (their
 * seasons all have the average pace).
 *
 * - Per 40 minutes: production independent of his minutes.
 * - Per 100 possessions: per 40, also independent of his team's pace.
 * - Schedule adjusted (SOS): the same production against better competition is worth more, about 0.5% a point of strength (conference
 *   scale) from a mid-major schedule. Adjusted BPM adds 0.15 a point.
 * - Age-adjusted production: schedule-adjusted game score per 40 of his last two seasons (the last one counting more), plus AGE_SLOPE for
 *   every year he was younger than AGE_REFERENCE. A 19-year-old's numbers count more than a 22-year-old's.
 */

// Production per point of strength above SOS_REFERENCE
const SOS_PROD = 0.005;
const SOS_BPM = 0.15;
// Age-adjusted production: game score per 40 minutes per year younger than AGE_REFERENCE. Measured: the slope that best predicts ovr
// three seasons into a pro career (classTeams.script.test.ts), about 1.8
export const AGE_REFERENCE = 20.5;
export const AGE_SLOPE = 1.8;
// Weight of his last season against the one before it
const LAST_SEASON_WEIGHT = 1.5;

// Level of competition of a team or league, on the conference scale
export const strengthOfTeam = (name: string | undefined) => {
	if (name === undefined) {
		return SOS_REFERENCE;
	}
	if (isJuco(name)) {
		return 40;
	}
	const lower = getLowerLevel(name);
	if (lower) {
		return LOWER_LEVEL_INFO[lower].strength;
	}
	return getSchool(name)?.strength ?? 60;
};

export const sosFactor = (strength: number) =>
	clamp(1 + SOS_PROD * (strength - SOS_REFERENCE), 0.75, 1.15);

type Row = {
	gp?: number;
	min?: number;
	pts?: number;
	fg?: number;
	fga?: number;
	fta?: number;
	ft?: number;
	orb?: number;
	drb?: number;
	stl?: number;
	ast?: number;
	blk?: number;
	pf?: number;
	tov?: number;
	bpm?: number;
	usgp?: number;
};

const n = (x: number | undefined) => x ?? 0;

export const gameScoreOf = (r: Row) =>
	n(r.pts) +
	0.4 * n(r.fg) -
	0.7 * n(r.fga) -
	0.4 * (n(r.fta) - n(r.ft)) +
	0.7 * n(r.orb) +
	0.3 * n(r.drb) +
	n(r.stl) +
	0.7 * n(r.ast) +
	0.7 * n(r.blk) -
	0.4 * n(r.pf) -
	n(r.tov);

const round1 = (x: number) => Math.round(10 * x) / 10;

export type SeasonContextLine = {
	strength: number;
	// Team possessions per 40 minutes (the average when unknown)
	pace: number;
	mpg: number;
	usgp: number | undefined;
	pts40: number;
	trb40: number;
	ast40: number;
	// Points per 100 possessions he was on the floor for
	pts100: number;
	// Schedule-adjusted
	adjPts40: number;
	gmsc40: number;
	adjGmsc40: number;
	bpm: number | undefined;
	adjBpm: number | undefined;
};

/**
 * A season's line in context. undefined for a season without minutes.
 */
export const getSeasonContext = (
	row: Row,
	{
		strength,
		pace = PACE_40,
	}: {
		strength: number;
		pace?: number;
	},
): SeasonContextLine | undefined => {
	const min = n(row.min);
	const gp = n(row.gp);
	if (min <= 0 || gp <= 0) {
		return undefined;
	}
	const per40 = (x: number) => (x / min) * 40;
	const f = sosFactor(strength);
	const gmsc40 = per40(gameScoreOf(row));
	return {
		strength: Math.round(strength),
		pace: round1(pace),
		mpg: round1(min / gp),
		usgp: row.usgp,
		pts40: round1(per40(n(row.pts))),
		trb40: round1(per40(n(row.orb) + n(row.drb))),
		ast40: round1(per40(n(row.ast))),
		pts100: round1((per40(n(row.pts)) * 100) / pace),
		adjPts40: round1(per40(n(row.pts)) * f),
		gmsc40: round1(gmsc40),
		adjGmsc40: round1(gmsc40 * f),
		bpm: row.bpm,
		adjBpm:
			row.bpm === undefined
				? undefined
				: round1(row.bpm + SOS_BPM * (strength - SOS_REFERENCE)),
	};
};

/**
 * Age-adjusted production from his seasons (oldest first): each with its stats row, level of competition and his age that season.
 * undefined without a season he played in. `minutes` is how many minutes it is based on, for how much to trust it.
 */
export const getAgeAdjustedProduction = (
	seasons: { row: Row; strength: number; age: number }[],
): { value: number; minutes: number } | undefined => {
	const played = seasons.filter((s) => n(s.row.min) > 0 && n(s.row.gp) > 0);
	const lastTwo = played.slice(-2);
	if (lastTwo.length === 0) {
		return undefined;
	}
	let num = 0;
	let den = 0;
	let age = 0;
	let minutes = 0;
	for (const [i, s] of lastTwo.entries()) {
		const min = n(s.row.min);
		const w = min * (i === lastTwo.length - 1 ? LAST_SEASON_WEIGHT : 1);
		num += w * ((gameScoreOf(s.row) / min) * 40 * sosFactor(s.strength));
		age += w * s.age;
		den += w;
		minutes += min;
	}
	return {
		value: round1(num / den + AGE_SLOPE * (AGE_REFERENCE - age / den)),
		minutes,
	};
};

// The AI draft model and the consensus board: a prospect's age-adjusted production against his class's, in value points. Bounded, and
// smaller the fewer minutes it is based on
export const PRODUCTION_NUDGE_MAX = 1.5;
const NUDGE_PER_SD = 0.8;
const NUDGE_MINUTES_HALF = 400;

/**
 * Value nudges for a class: age-adjusted production against the class's (only prospects who have it), by key.
 */
export const getProductionNudges = (
	entries: { key: number; value: number; minutes: number }[],
): Map<number, number> => {
	const out = new Map<number, number>();
	if (entries.length < 5) {
		return out;
	}
	const mean = entries.reduce((a, e) => a + e.value, 0) / entries.length;
	const sd = Math.sqrt(
		entries.reduce((a, e) => a + (e.value - mean) ** 2, 0) / entries.length,
	);
	if (!(sd > 0)) {
		return out;
	}
	for (const e of entries) {
		const trust = e.minutes / (e.minutes + NUDGE_MINUTES_HALF);
		out.set(
			e.key,
			clamp(
				NUDGE_PER_SD * ((e.value - mean) / sd) * trust,
				-PRODUCTION_NUDGE_MAX,
				PRODUCTION_NUDGE_MAX,
			),
		);
	}
	return out;
};
