import { Rng } from "../ratingsBuilds/rng.ts";
import { TRAIT_KEYS, type PlayerTraits, type TraitKey } from "./types.ts";

export const SEED_LIMIT = 8;

export const seedKey = (key: TraitKey) => `${key}Seed` as const;

const round2 = (x: number) => Math.round(x * 100) / 100;

export const clampSeed = (x: number) =>
	round2(Math.max(-SEED_LIMIT, Math.min(SEED_LIMIT, x)));

// Truncating at +-3 keeps the distribution mean-zero and symmetric
const drawSeed = (rng: Rng) =>
	clampSeed(Math.max(-3, Math.min(3, rng.normal(0, 1))));

// Deterministic: the same league seed and pid always give the same traits. Each trait has its own stream, so adding a trait later never moves the others.
export const generateTraitSeeds = (
	leagueSeed: number | string,
	pid: number,
): Required<PlayerTraits> => {
	const traits: Partial<Record<string, number>> = {};
	for (const key of TRAIT_KEYS) {
		traits[seedKey(key)] = drawSeed(
			new Rng(`traits|${leagueSeed}|${pid}|${key}`),
		);
	}
	return traits as Required<PlayerTraits>;
};

// Fill in anything missing (a trait added later, or an older partial object), without touching what is there. Returns a new object.
export const completeTraitSeeds = (
	traits: PlayerTraits | undefined,
	leagueSeed: number | string,
	pid: number,
): Required<PlayerTraits> => {
	const generated = generateTraitSeeds(leagueSeed, pid);
	if (!traits) {
		return generated;
	}
	const output = { ...generated };
	for (const key of TRAIT_KEYS) {
		const value = traits[seedKey(key)];
		if (typeof value === "number" && Number.isFinite(value)) {
			output[seedKey(key)] = clampSeed(value);
		}
	}
	return output;
};

// Traits drift slowly from year to year: a mean-reverting random walk that keeps the population standard normal (rho 0.95, so about 4 points of score a year). Deterministic for a given league seed, pid and season.
export const TRAIT_DRIFT_RHO = 0.95;

export const driftTraitSeeds = (
	traits: PlayerTraits,
	leagueSeed: number | string,
	pid: number,
	season: number,
): Required<PlayerTraits> => {
	const complete = completeTraitSeeds(traits, leagueSeed, pid);
	const innovation = Math.sqrt(1 - TRAIT_DRIFT_RHO ** 2);
	const output = { ...complete };
	for (const key of TRAIT_KEYS) {
		const rng = new Rng(`traitDrift|${leagueSeed}|${pid}|${key}|${season}`);
		output[seedKey(key)] = clampSeed(
			TRAIT_DRIFT_RHO * complete[seedKey(key)] + innovation * drawSeed(rng),
		);
	}
	return output;
};

export const normalizeTraitSeedsFromImport = (
	value: unknown,
): PlayerTraits | undefined => {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const output: PlayerTraits = {};
	for (const key of TRAIT_KEYS) {
		const v = (value as any)[seedKey(key)];
		if (typeof v === "number" && Number.isFinite(v)) {
			output[seedKey(key)] = clampSeed(v);
		}
	}
	return Object.keys(output).length > 0 ? output : undefined;
};
