import type { RatingKey } from "../types.basketball.ts";

export type { RatingKey };

export type BuildRatings = Record<RatingKey, number>;

export type Bio = {
	years?: string[];
	notYears?: string[];
	proOrReturned?: true;
};

export type Archetype = {
	name: string;

	// Gate on the hgt rating, both inclusive
	min: number;
	max: number;

	// Rarity weight, a target share of the class
	w: number;
	tags: string[];

	// Normalized (ovr-neutral) offset vector, in rating points
	o: Partial<Record<RatingKey, number>>;

	// Per-rating solver scales where they differ from the default
	ns?: Partial<Record<RatingKey, number>>;

	// Height-gate weight calibration
	cal: number;

	// Centered potential gap of the build
	pot: number;

	// Multiplier on game-to-game scoring variance (unused by the game, kept for fidelity)
	vol?: number;

	// Multiplier on injury rate (unused by the game, kept for fidelity)
	inj?: number;

	// A gate on the man rather than the player
	bio?: Bio;
};

export type ClassFlavor = {
	name: string;
	w: number;
	label: string;
	m: Record<string, number>;
};

export type DrawFlavor = {
	name: string;
	label: string;
	mult: Record<string, number>;
	strength: number;
	asked: boolean;
};

// What is saved on a player (p.ratingsBuild) after "Regenerate ratings"
export type StoredRatingsBuild = {
	name: string;
	tags: string[];
	seed: string;

	// The ratings (and fuzz, pot and listed height) from before the first regeneration. Another regeneration starts from
	// these, so rerolling never compounds specialization.
	base: BuildRatings;
	baseFuzz: number;
	basePot: number;
	baseHgtInches: number;

	// The ratings the regeneration wrote. If the player's ratings still equal these, `base` is still his base; if he has
	// developed or been edited since, his current ratings become the new base.
	applied: BuildRatings;
};
