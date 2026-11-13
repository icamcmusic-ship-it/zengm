// Test-only: a league's worth of BBGM-generated players (random draft classes developed forward), for calibrating and
// validating the archetype engine
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import { resetG } from "../../test/helpers.ts";
import { g } from "../../worker/util/index.ts";
import develop from "../../worker/core/player/develop.ts";
import generate from "../../worker/core/player/generate.ts";
import ovr from "../../worker/core/player/ovr.ts";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import type { ArchetypeRatings, ArchetypeTraits } from "./types.ts";
import { generateTraitSeeds } from "../playerTraits/seeds.ts";
import { traitScores } from "../playerTraits/scores.ts";
import type { TraitKey } from "../playerTraits/types.ts";
import { VISIBLE_TRAITS } from "./classify.ts";
import { EXPANDED_RATINGS2 } from "../expandedRatings.ts";
import { SUBS_ON } from "./real.testutil.ts";

export type SamplePlayer = {
	ratings: ArchetypeRatings;
	ovr: number;
	age: number;
	hgtInches: number;
};

export const sampleLeague = async (
	n: number,
	seed: string,
	// Years of development: 0..maxYears (default: a whole league, 19 to 32 year olds)
	maxYears = 13,
	minOvr = 38,
	// With the Expanded Ratings setting on: players come with wingspan and perimeter/interior defense
	expanded = false,
	// arch15: at least this many years of development (veterans)
	minYears = 0,
): Promise<SamplePlayer[]> => {
	resetG();
	// As a new league generates players: with Improved Positions on, guards include the scorer type (genRatings.basketball.ts)
	g.setWithoutSavingToDB("improvedPositions", true);
	// arch15: with Sub-Ratings on (the new-league default) unless ARCH_NO_SUBS=1
	if (SUBS_ON) {
		g.setWithoutSavingToDB("subRatings", true);
	}
	if (expanded) {
		g.setWithoutSavingToDB("expandedRatings", true);
	}
	const rng = new Rng(seed);
	// BBGM's generator draws from Math.random: seed it too, so a sample (and norms built from it) is the same every run.
	// Not vi.spyOn: a spy records every call.
	const ratingsRng = new Rng(`${seed}-random`);
	const random = Math.random;
	Math.random = () => ratingsRng.random();
	try {
		return await sample(n, rng, maxYears, minOvr, minYears);
	} finally {
		Math.random = random;
		g.setWithoutSavingToDB("improvedPositions", false);
		g.setWithoutSavingToDB("subRatings", false);
		if (expanded) {
			g.setWithoutSavingToDB("expandedRatings", false);
		}
	}
};

const sample = async (
	n: number,
	rng: Rng,
	maxYears: number,
	minOvr: number,
	minYears = 0,
): Promise<SamplePlayer[]> => {
	const out: SamplePlayer[] = [];
	while (out.length < n) {
		const k = rng.int(minYears, maxYears);
		const p = generate(-1, 19, 2025 - k, false, DEFAULT_LEVEL);
		await develop(p as any, k, true);
		const row = p.ratings.at(-1) as any;
		const o = ovr(row);
		// Roughly who is on an NBA-style roster or a bench: drop the hopeless
		if (o < minOvr) {
			continue;
		}
		const ratings = {} as ArchetypeRatings;
		for (const key of RATING_KEYS) {
			ratings[key] = row[key];
		}
		if (typeof row.wng === "number") {
			ratings.wng = row.wng;
			ratings.pdef = row.pdef;
			ratings.idef = row.idef;
			for (const key of EXPANDED_RATINGS2) {
				if (typeof row[key] === "number") {
					ratings[key] = row[key];
				}
			}
		}
		if (SUBS_ON && Array.isArray(row.sub)) {
			ratings.sub = row.sub;
		}
		out.push({ ratings, ovr: o, age: 19 + k, hgtInches: p.hgt });
	}
	return out;
};

// Visible player traits for a sample player (the playerTraits setting), as a league would give him: seeds from the league seed
// and an index, scores from his ratings, age and years in the league. Only the visible ones, as the archetypes read them.
export const sampleTraits = (
	ratings: ArchetypeRatings,
	age: number | undefined,
	leagueSeed: string,
	i: number,
): ArchetypeTraits => {
	const a = age ?? 22;
	const scores = traitScores(ratings, generateTraitSeeds(leagueSeed, i), {
		age: a,
		experience: Math.max(0, a - 20),
	});
	const out: ArchetypeTraits = {};
	for (const k of Object.keys(scores) as TraitKey[]) {
		if (VISIBLE_TRAITS.has(k)) {
			out[k as keyof ArchetypeTraits] = scores[k];
		}
	}
	return out;
};
