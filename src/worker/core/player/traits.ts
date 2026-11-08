import { g } from "../../util/index.ts";
import {
	completeTraitSeeds,
	driftTraitSeeds,
	generateTraitSeeds,
	scoutTrait,
	seedKey,
	seedForScore,
	traitEffects,
	traitScores,
	traitUncertainty,
	clampSeed,
	TRAIT_KEYS,
	type PlayerTraits,
	type ScoutedTrait,
	type TraitEffects,
	type TraitKey,
	type TraitRatings,
	type TraitScores,
} from "../../../common/playerTraits/index.ts";
import { PLAYER } from "../../../common/constants.ts";
import type { NonEmptyArray } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";

type TraitPlayer = {
	pid?: number;
	traits?: PlayerTraits;
	born: { year: number };
	draft: { year: number; tid?: number };
	tid?: number;
	ratings: NonEmptyArray<{ season: number } & TraitRatings>;
};

export const traitsEnabled = () =>
	__SPORT === "basketball" && !!g.get("playerTraits");

export const getLeagueTraitSeed = () =>
	(__SPORT === "basketball" ? g.get("playerTraitsSeed") : 0) ?? 0;

// Years since the draft. Works for random-player leagues too, where players have no stats rows before the league starts. Draft prospects have 0.
export const getTraitExperience = (p: TraitPlayer, season = g.get("season")) =>
	p.tid === PLAYER.UNDRAFTED
		? 0
		: Math.max(0, season - (p.draft.year ?? season));

const getAge = (p: TraitPlayer, season: number) => season - p.born.year;

// Seeds for a player, without writing anything. Missing seeds are derived from the league seed and pid, so the answer is the same every time.
export const getTraitSeeds = (p: TraitPlayer) =>
	completeTraitSeeds(p.traits, getLeagueTraitSeed(), p.pid ?? 0);

// Create p.traits if it is missing or partial. Safe to call as often as you like. Returns true if p changed.
export const ensureTraits = (p: TraitPlayer & { pid: number }) => {
	if (__SPORT !== "basketball") {
		return false;
	}
	// Also repairs junk from a hand-edited league file (non-numbers, out of range)
	const next = completeTraitSeeds(p.traits, getLeagueTraitSeed(), p.pid);
	const same = TRAIT_KEYS.every(
		(key) => p.traits?.[seedKey(key)] === next[seedKey(key)],
	);
	if (same) {
		return false;
	}
	p.traits = next;
	return true;
};

// New players (draft prospects, league creation): seeds from league seed + pid
export const initTraits = (p: TraitPlayer & { pid: number }) => {
	if (__SPORT !== "basketball") {
		return;
	}
	p.traits = generateTraitSeeds(getLeagueTraitSeed(), p.pid);
};

export const getPlayerTraitScores = (
	p: TraitPlayer,
	season = g.get("season"),
): TraitScores => {
	const ratings = last(p.ratings);
	return traitScores(ratings, getTraitSeeds(p), {
		age: getAge(p, season),
		experience: getTraitExperience(p, season),
	});
};

// For the game sim: the effects for a player, or undefined when the Player Traits setting is off (the sim must then behave exactly as it did before traits existed). The sim should call this once per player per game, not per possession.
export const getSimTraitEffects = (
	p: TraitPlayer,
	season = g.get("season"),
): TraitEffects | undefined => {
	if (!traitsEnabled()) {
		return undefined;
	}
	return traitEffects(getPlayerTraitScores(p, season));
};

// Preseason development: traits drift a little each year (mean-reverting random walk, deterministic). Age and experience effects are already part of the scores themselves.
export const developTraits = (
	p: TraitPlayer & { pid: number },
	season = g.get("season"),
) => {
	if (__SPORT !== "basketball") {
		return;
	}
	p.traits = driftTraitSeeds(
		p.traits ?? {},
		getLeagueTraitSeed(),
		p.pid,
		season,
	);
};

export type PlayerTraitsForUI = {
	enabled: true;
	// What to show (estimates for prospects)
	traits: ScoutedTrait[];
	scores: Record<TraitKey, number>;
	isProspect: boolean;
	// For the God Mode editor: exact current scores
	exactScores?: Record<TraitKey, number>;
};

// Everything the UI needs about a player's traits. scoutingLevel is the user team's scouting budget level. Without God Mode, prospects get estimates with uncertainty and young pros' hidden traits are partly hidden.
export const getPlayerTraitsForUI = (
	p: TraitPlayer & { pid: number },
	{
		scoutingLevel,
		season = g.get("season"),
		godMode = !!g.get("godMode"),
		includeExact = false,
	}: {
		scoutingLevel?: number;
		season?: number;
		godMode?: boolean;
		includeExact?: boolean;
	} = {},
): PlayerTraitsForUI | undefined => {
	if (!traitsEnabled()) {
		return undefined;
	}
	const exact = getPlayerTraitScores(p, season);
	const isProspect = p.tid === PLAYER.UNDRAFTED;
	const experience = getTraitExperience(p, season);
	const traits: ScoutedTrait[] = TRAIT_KEYS.map((key) =>
		scoutTrait({
			key,
			trueScore: exact[key],
			sd: traitUncertainty({
				key,
				isProspect,
				experience,
				scoutingLevel,
				godMode,
			}),
			leagueSeed: getLeagueTraitSeed(),
			pid: p.pid,
		}),
	);
	const scores = {} as Record<TraitKey, number>;
	for (const t of traits) {
		scores[t.key] = t.estimate;
	}
	return {
		enabled: true,
		traits,
		scores,
		isProspect,
		exactScores: includeExact ? exact : undefined,
	};
};

// God Mode edit: set traits from wanted 0-100 scores by moving the stored seeds. Scores not given are left alone.
export const setTraitScores = (
	p: TraitPlayer & { pid: number },
	wanted: Partial<Record<TraitKey, number>>,
	season = g.get("season"),
) => {
	const seeds = { ...getTraitSeeds(p) };
	const ratings = last(p.ratings);
	const context = {
		age: getAge(p, season),
		experience: getTraitExperience(p, season),
	};
	for (const key of TRAIT_KEYS) {
		const score = wanted[key];
		if (score === undefined || !Number.isFinite(score)) {
			continue;
		}
		seeds[seedKey(key)] = clampSeed(
			seedForScore(key, ratings, Math.max(0, Math.min(100, score)), context),
		);
	}
	p.traits = seeds;
};
