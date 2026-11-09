// Test-only: a league's worth of BBGM-generated players (random draft classes developed forward), for calibrating and
// validating the archetype engine
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import { resetG } from "../../test/helpers.ts";
import develop from "../../worker/core/player/develop.ts";
import generate from "../../worker/core/player/generate.ts";
import ovr from "../../worker/core/player/ovr.ts";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import type { ArchetypeRatings } from "./types.ts";

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
): Promise<SamplePlayer[]> => {
	resetG();
	const rng = new Rng(seed);
	const out: SamplePlayer[] = [];
	while (out.length < n) {
		const k = rng.int(0, maxYears);
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
		out.push({ ratings, ovr: o, age: 19 + k, hgtInches: p.hgt });
	}
	return out;
};
