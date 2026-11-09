/**
 * Pro career projections for draft prospects (League extras "Mock Draft", basketball). Each simulated career runs BBGM's
 * own player development (developSeasonSync, the model behind player.develop) season by season from the prospect's
 * ratings as your scouts see them, with a simple roster rule for when he is out of the league. Many careers give the
 * spread: median/10th/90th percentile peak ovr and star / starter / bust odds.
 *
 * Ported from the Draft Workshop's projection (bbgmdraft js/pro.js): same verdict scale and out-of-the-league rule, but
 * with the real development model instead of a stand-in.
 */
import { developSeasonSync } from "../player/developSeason.ts";
import ovr from "../player/ovr.ts";
import { RATINGS } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import type { MinimalPlayerRatings } from "../../../common/types.ts";

export const NUM_CAREERS = 120;
export const STAR_OVR = 65;
export const STARTER_OVR = 58;
export const BUST_OVR = 50;
// An ovr a team will not carry for long
export const REPLACEMENT_OVR = 43;
const LAST_AGE = 37;

export const VERDICTS = [
	[STAR_OVR, "Star"],
	[STARTER_OVR, "Starter"],
	[BUST_OVR, "Rotation player"],
	[45, "Fringe player"],
	[-Infinity, "Bust risk"],
] as const;

export type ProProjection = {
	pid: number;
	age: number;
	ovr: number;
	peak: number;
	peakLow: number;
	peakHigh: number;
	peakAge: number;
	years: number;
	starPct: number;
	starterPct: number;
	bustPct: number;
	verdict: string;
};

const percentile = (sorted: number[], p: number) => {
	const i = (sorted.length - 1) * p;
	const lo = Math.floor(i);
	const hi = Math.ceil(i);
	return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
};

// One career: the ovr of every season he stays in the league
export const simCareer = (
	ratings: MinimalPlayerRatings,
	draftAge: number,
	coachingLevel = DEFAULT_LEVEL,
) => {
	const r = { ...ratings };
	const seasons: { age: number; ovr: number }[] = [];
	let under = 0;
	for (let age = draftAge + 1; age <= LAST_AGE; age++) {
		developSeasonSync(r, age, coachingLevel, undefined);
		const x = ovr(r);
		under = x < REPLACEMENT_OVR ? under + 1 : 0;
		if (
			(under >= 2 && age >= 22) ||
			(age >= 25 && x < REPLACEMENT_OVR - 2) ||
			(age >= 31 && x < 52)
		) {
			break;
		}
		seasons.push({ age, ovr: x });
	}
	return seasons;
};

export const summarizeCareers = (
	pid: number,
	startOvr: number,
	draftAge: number,
	careers: { age: number; ovr: number }[][],
): ProProjection => {
	const peakOf = (c: { age: number; ovr: number }[]) =>
		c.length > 0 ? Math.max(...c.map((s) => s.ovr)) : startOvr;
	const peaks = careers.map(peakOf).sort((a, b) => a - b);
	const years = careers.map((c) => c.length).sort((a, b) => a - b);
	const peakAges = careers
		.filter((c) => c.length > 0)
		.map((c) => c.reduce((best, s) => (s.ovr > best.ovr ? s : best)).age)
		.sort((a, b) => a - b);
	const n = careers.length;
	const peak = Math.round(percentile(peaks, 0.5));
	return {
		pid,
		age: draftAge,
		ovr: startOvr,
		peak,
		peakLow: Math.round(percentile(peaks, 0.1)),
		peakHigh: Math.round(percentile(peaks, 0.9)),
		peakAge:
			peakAges.length > 0 ? Math.round(percentile(peakAges, 0.5)) : draftAge,
		years: Math.round(percentile(years, 0.5)),
		starPct: careers.filter((c) => peakOf(c) >= STAR_OVR).length / n,
		starterPct: careers.filter((c) => peakOf(c) >= STARTER_OVR).length / n,
		bustPct:
			careers.filter((c) => c.length < 4 || peakOf(c) < BUST_OVR).length / n,
		verdict: VERDICTS.find(([min]) => peak >= min)![1],
	};
};

// Ratings as the user's scouts see them: every rating moved by the prospect's fuzz
export const fuzzedRatings = (
	ratings: MinimalPlayerRatings & { fuzz?: number },
	fuzz: number,
): MinimalPlayerRatings => {
	const out: any = { ...ratings };
	if (fuzz !== 0) {
		for (const key of RATINGS) {
			if (typeof out[key] === "number") {
				out[key] = Math.round(Math.min(100, Math.max(0, out[key] + fuzz)));
			}
		}
	}
	return out;
};

export const projectProspect = (
	pid: number,
	ratings: MinimalPlayerRatings,
	draftAge: number,
	numCareers = NUM_CAREERS,
) => {
	const careers = [];
	for (let i = 0; i < numCareers; i++) {
		careers.push(simCareer(ratings, draftAge));
	}
	return summarizeCareers(pid, ovr(ratings), draftAge, careers);
};
