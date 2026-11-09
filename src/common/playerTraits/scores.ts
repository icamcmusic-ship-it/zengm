import { veteranExperienceCurve } from "./veteran.ts";
import { completeTraitSeeds, seedKey } from "./seeds.ts";
import {
	TRAIT_KEYS,
	type PlayerTraits,
	type TraitContext,
	type TraitKey,
	type TraitRatings,
	type TraitScores,
} from "./types.ts";

// Scores are 0-100 with 50 meaning "league average rotation player". score = 50 + (rating part) + (age/experience part) + SEED_SD * seed + calibration offset, rounded and clamped.

// Average ratings of the players who actually play (top 300 by ovr in a freshly generated 30 team league). The rating part of a score is relative to these, so an average rotation player has an average score.
export const REFERENCE_RATINGS: Required<TraitRatings> = {
	hgt: 47.2,
	stre: 53.7,
	spd: 55.6,
	jmp: 53.6,
	endu: 47.1,
	ins: 45.2,
	dnk: 52,
	ft: 49,
	fg: 49,
	tp: 49.8,
	oiq: 49,
	diq: 49.2,
	drb: 55.2,
	pss: 52,
	reb: 52.6,
};

// How much of the score comes from ratings (weights per trait sum to 1, times this)
export const RATING_SCALE = 0.9;
// Standard deviation, in score points, of the stored random component. Bigger than the rating part on purpose: two players with the same ratings can have very different traits.
export const SEED_SD = 12;

export const NEUTRAL_AGE = 27;
export const NEUTRAL_EXPERIENCE = 4;

const RATING_WEIGHTS: Record<TraitKey, TraitRatings> = {
	clutch: { oiq: 0.35, tp: 0.2, ft: 0.2, fg: 0.15, pss: 0.1 },
	consistency: { oiq: 0.3, diq: 0.2, ft: 0.2, endu: 0.15, drb: 0.15 },
	durability: { endu: 0.55, stre: 0.3, hgt: -0.15 },
	shotDiscipline: { oiq: 0.55, ft: 0.15, fg: 0.15, pss: 0.15 },
	offBall: { oiq: 0.35, spd: 0.2, tp: 0.2, jmp: 0.1, endu: 0.15 },
	screen: { stre: 0.3, hgt: 0.25, oiq: 0.2, ins: 0.15, reb: 0.1 },
	hustle: { endu: 0.3, spd: 0.2, diq: 0.15, stre: 0.15, jmp: 0.1, reb: 0.1 },
	foulDiscipline: { diq: 0.5, oiq: 0.2, stre: 0.15, endu: 0.15 },
	recovery: { endu: 0.75, stre: 0.25 },
	handle: { drb: 0.45, pss: 0.25, oiq: 0.2, spd: 0.1 },
	lateGameIq: { oiq: 0.5, diq: 0.3, pss: 0.2 },
	leadership: { oiq: 0.3, diq: 0.2, pss: 0.2, endu: 0.1, stre: 0.1, drb: 0.1 },
	veteranSavvy: { oiq: 0.4, diq: 0.4, pss: 0.2 },
};

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

// Age and experience part. All are 0 at the neutral age (27) and experience (4), small, and slow.
const contextPart = (
	key: TraitKey,
	age: number,
	experience: number,
	proSeasons: number = experience,
): number => {
	switch (key) {
		case "clutch":
			return 1.2 * (Math.min(experience, 12) - NEUTRAL_EXPERIENCE);
		case "consistency":
			return 0.5 * (clamp(age, 20, 36) - NEUTRAL_AGE);
		case "durability":
			return age > NEUTRAL_AGE
				? -1.2 * (Math.min(age, 40) - NEUTRAL_AGE)
				: 0.3 * (NEUTRAL_AGE - Math.max(age, 19));
		case "shotDiscipline":
		case "foulDiscipline":
			return 0.8 * (Math.min(experience, 10) - NEUTRAL_EXPERIENCE);
		case "hustle":
			return age > 31 ? -0.6 * (Math.min(age, 40) - 31) : 0;
		case "recovery":
			return age > NEUTRAL_AGE ? -0.8 * (Math.min(age, 40) - NEUTRAL_AGE) : 0;
		case "lateGameIq":
			return 1.0 * (Math.min(experience, 12) - NEUTRAL_EXPERIENCE);
		case "leadership":
			return (
				1.2 * (Math.min(experience, 12) - NEUTRAL_EXPERIENCE) +
				0.3 * (clamp(age, 20, 36) - NEUTRAL_AGE)
			);
		case "veteranSavvy":
			// Pro seasons played, plateau at 9 (see veteran.ts)
			return (
				veteranExperienceCurve(proSeasons) -
				veteranExperienceCurve(NEUTRAL_EXPERIENCE)
			);
		default:
			// offBall, screen and handle do not change with age or experience, only through the ratings
			return 0;
	}
};

// Offsets that make the average player on the court average (score 50): the average of the rotation (top 300 by ovr in a generated league), then moved down by the amount
// the players who actually play minutes and take the shots sit above that average (about 1-2 points, see playerTraitsSim.test.ts: the minutes-weighted mean of every trait is
// 50 in the sim, so the league-wide averages of points, FG%, turnovers, fouls and injuries do not move when traits are on). Found by simulation.
export const CALIBRATION_OFFSETS: Record<TraitKey, number> = {
	clutch: -5.5,
	consistency: -1.2,
	durability: 0.3,
	shotDiscipline: -4,
	offBall: -1.5,
	screen: -1.8,
	hustle: -0.6,
	foulDiscipline: -3.8,
	recovery: 0.6,
	handle: -2,
	lateGameIq: -3.6,
	leadership: -5,
	veteranSavvy: -4.5,
};

// RATING_WEIGHTS as arrays, in the same order, so ratingPart (hot: every trait score) skips Object.entries. Same arithmetic, same results.
const RATING_WEIGHT_ENTRIES = Object.fromEntries(
	Object.entries(RATING_WEIGHTS).map(([key, weights]) => [
		key,
		Object.entries(weights).map(
			([rating, weight]) =>
				[
					rating as keyof TraitRatings,
					weight as number,
					REFERENCE_RATINGS[rating as keyof TraitRatings],
				] as const,
		),
	]),
) as unknown as Record<
	TraitKey,
	readonly (readonly [keyof TraitRatings, number, number])[]
>;

export const ratingPart = (key: TraitKey, ratings: TraitRatings) => {
	let total = 0;
	for (const [rating, weight, reference] of RATING_WEIGHT_ENTRIES[key]) {
		const r = ratings[rating] ?? reference;
		total += weight * (r - reference);
	}
	return RATING_SCALE * total;
};

export const scoreOne = (
	key: TraitKey,
	ratings: TraitRatings,
	seed: number,
	context: TraitContext = {},
) => {
	const age = context.age ?? NEUTRAL_AGE;
	const experience = context.experience ?? NEUTRAL_EXPERIENCE;
	const raw =
		50 +
		CALIBRATION_OFFSETS[key] +
		ratingPart(key, ratings) +
		contextPart(key, age, experience, context.proSeasons ?? experience) +
		SEED_SD * seed;
	return clamp(Math.round(raw), 0, 100);
};

// The normalised 0-100 scores. traitSeeds may be partial or missing (missing seeds count as 0, which is "average"); pass the result of completeTraitSeeds first to get a player's real ones.
export const traitScores = (
	ratings: TraitRatings,
	traitSeeds: PlayerTraits | undefined,
	context?: TraitContext,
): TraitScores => {
	const scores = {} as TraitScores;
	for (const key of TRAIT_KEYS) {
		scores[key] = scoreOne(
			key,
			ratings,
			traitSeeds?.[seedKey(key)] ?? 0,
			context,
		);
	}
	return scores;
};

// For a player on the way in/out of storage: scores from stored seeds, filling in missing ones deterministically from the league seed and pid.
export const traitScoresForPlayer = (
	ratings: TraitRatings,
	traitSeeds: PlayerTraits | undefined,
	leagueSeed: number | string,
	pid: number,
	context?: TraitContext,
): TraitScores =>
	traitScores(
		ratings,
		completeTraitSeeds(traitSeeds, leagueSeed, pid),
		context,
	);

// Inverse of scoreOne for the seed: the seed that gives a wanted score (used by the God Mode editor). Clamped by the seed limit, so very extreme scores may not be reachable for a given set of ratings.
export const seedForScore = (
	key: TraitKey,
	ratings: TraitRatings,
	wantedScore: number,
	context: TraitContext = {},
) => {
	const age = context.age ?? NEUTRAL_AGE;
	const experience = context.experience ?? NEUTRAL_EXPERIENCE;
	const rest =
		50 +
		CALIBRATION_OFFSETS[key] +
		ratingPart(key, ratings) +
		contextPart(key, age, experience, context.proSeasons ?? experience);
	return (wantedScore - rest) / SEED_SD;
};

export const NEUTRAL_SCORES: TraitScores = Object.fromEntries(
	TRAIT_KEYS.map((key) => [key, 50]),
) as TraitScores;
