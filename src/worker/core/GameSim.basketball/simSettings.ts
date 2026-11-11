// Game Simulation settings of the League extras that change how ratings work in the basketball sim (see docs/native-features.md,
// Game sim fixes). Everything here is only used with its setting on; with it off loadTeams and GameSim use the stock formulas and
// draw exactly the same random numbers.
import type { CompositeWeights } from "../../../common/types.ts";

// Game Sim Fixes (simFixes): composite weights that replace or add to the stock (or expanded) ones in loadTeams
export const SIM_FIX_COMPOSITE_WEIGHTS: CompositeWeights<string> = {
	// Inside scoring (ins) and mid-range shooting (fg) were the biggest usage weights, so a better post scorer or mid-range shooter
	// mostly just took more of the sim's least efficient shots. Usage leans less on them (and their makes lean more on them, below)
	usage: {
		ratings: ["ins", "dnk", "fg", "tp", "spd", "hgt", "drb", "oiq"],
		weights: [0.6, 1, 0.5, 1, 0.5, 0.5, 0.5, 0.5],
	},
	// How often he takes a mid-range jumper (stock: shootingMidRange, oiq -0.5, fg 1, stre 0.2). Offensive IQ still steers players
	// away from it; fg moves it much less, so a better shooter doesn't trade many more layups for jumpers (the constant keeps
	// the league's mid-range rate the same)
	shootingMidRangeSelect: {
		ratings: [51, "fg", "stre", "oiq"],
		weights: [0.6, 0.4, 0.2, -0.5],
	},
	// How often he posts up (stock: shootingLowPost): inside scoring counts less here and more in the make below
	shootingLowPostSelect: {
		ratings: [30, "hgt", "stre", "spd", "ins", "oiq"],
		weights: [0.2, 1, 0.6, 0.2, 0.5, 0.4],
	},
	// Make probability of a mid-range jumper. Offensive IQ only decides how often (above), not whether it goes in
	shootingMidRangeMake: {
		ratings: ["fg", "stre"],
		weights: [1, 0.2],
	},
	// Make probability of a post-up: inside scoring matters more than in the stock shootingLowPost
	shootingLowPostMake: {
		ratings: ["hgt", "stre", "spd", "ins", "oiq"],
		weights: [0.8, 0.5, 0.2, 2, 0.4],
	},
};

// With Expanded Ratings, who commits the fouls reads perimeter and interior defense instead of defensive IQ (their average)
export const SIM_FIX_EXPANDED_COMPOSITE_WEIGHTS: CompositeWeights<string> = {
	fouling: {
		ratings: [50, "hgt", "pdef", "idef", "spd"],
		weights: [3, 1, -0.5, -0.5, -1],
	},
};

// Make probability = intercept + slope * composite. Stock: mid-range 0.42 + 0.32 c, post 0.34 + 0.32 c. Steeper slopes so the skill
// matters more, intercepts so the league percentages stay the same
export const SIM_FIX_MID_RANGE = { intercept: 0.343, slope: 0.5 };
export const SIM_FIX_LOW_POST = { intercept: 0.253, slope: 0.5 };

// The trailing team's boost (perfFactor = 1 - X tanh(diff / 60)), stock 0.2
export const SIM_FIX_PERF_FACTOR = 0.1;

// Injury rate multiplier from strength and endurance: exp(-K (avg(stre, endu) - center) / 10), centered on the minutes-weighted
// league average so the league injury rate stays the same
export const SIM_FIX_INJURY_K = 0.08;
export const SIM_FIX_INJURY_CENTER = 51.4;
export const simFixInjuryFactor = (stre: number, endu: number) =>
	Math.exp(
		(-SIM_FIX_INJURY_K * ((stre + endu) / 2 - SIM_FIX_INJURY_CENTER)) / 10,
	);

// Synergy skill cutoffs with Expanded Ratings on (the expanded Di, Dp and R composites have their own skill cutoffs)
export const SIM_FIX_EXPANDED_SYNERGY_CUTOFFS = {
	Di: 0.595,
	Dp: 0.607,
	R: 0.62,
};

const merged = new WeakMap<object, CompositeWeights<string>>();
const mergedExpanded = new WeakMap<object, CompositeWeights<string>>();

// The composite weights the sim uses with Game Sim Fixes on, on top of the stock or expanded ones
export const simFixCompositeWeights = (
	base: CompositeWeights<string>,
	expanded: boolean,
) => {
	const cache = expanded ? mergedExpanded : merged;
	let out = cache.get(base);
	if (!out) {
		out = {
			...base,
			...SIM_FIX_COMPOSITE_WEIGHTS,
			...(expanded ? SIM_FIX_EXPANDED_COMPOSITE_WEIGHTS : {}),
		};
		cache.set(base, out);
	}
	return out;
};
