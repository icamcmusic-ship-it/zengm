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
	// How often he takes a mid-range jumper (stock: shootingMidRange, oiq -0.5, fg 1, stre 0.2). Mid-range shooting (fg) leads, so a
	// better mid-range shooter takes more of them (with the old 0.4 fg / -0.5 oiq, and the better shooters also taking more threes, the
	// best mid-range shooters took the smallest share of their shots from mid-range); offensive IQ still steers players away from it a
	// little. The constant keeps the league's mid-range rate the same
	shootingMidRangeSelect: {
		ratings: [51, "fg", "stre", "oiq"],
		weights: [0.2, 1, 0.2, -0.25],
	},
	// How often he posts up (stock: shootingLowPost): inside scoring counts less here and more in the make below
	shootingLowPostSelect: {
		ratings: [30, "hgt", "stre", "spd", "ins", "oiq"],
		weights: [0.2, 1, 0.6, 0.2, 0.5, 0.4],
	},
	// How often he drives to the rim (stock: shootingAtRim, hgt 2, stre 0.3, dnk 0.3, oiq 0.2): height counts much less, quickness
	// and ball handling count, so quick guards with a handle get to the rim more. The constant keeps the league's at-rim share
	// about the same. The make still uses shootingAtRim
	shootingAtRimSelect: {
		ratings: [35, "hgt", "spd", "drb", "dnk", "oiq"],
		weights: [0.5, 0.8, 0.4, 0.4, 0.3, 0.2],
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
	// Offensive fouls (SIM_FIX_OFF_FOUL): a strong, aggressive driver runs into more charges, a smart one fewer
	offFoulRisk: {
		ratings: [50, "stre", "dnk", "spd", "oiq"],
		weights: [1, 1, 0.5, 0.5, -1],
	},
	// ...and a smart, quick defender draws more of them
	drawingCharges: {
		ratings: ["diq", "spd", "stre"],
		weights: [2, 0.5, 0.5],
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
// Three-pointers: the stock make squashed the composite above 0.55 to two thirds (and Matchup Defense's knee kept a quarter of what was
// left above 0.68 of that), so a 90 three-point shooter made barely more than a 65. The make reads the composite unsquashed, with the help
// defense's knee (ATTENTION.makeExcess above knee) only for the very best
export const SIM_FIX_THREE = { intercept: 0.36, slope: 0.3, knee: 0.85 };

// Transition possessions (realistic possession model) lean toward the rim and away from post-ups
export const SIM_FIX_TRANSITION = { rim: 1.6, post: 0.3 };

// Shot type choice among twos (getShotInfo): proportional selection, p_i = w_i / sum(w), from deterministic weights (one random draw).
// - mid/rim/post: the constant on each weight, calibrated so the league's mid-range / rim / post shares are about those of the old
//   winner-take-max race (with its three random numbers)
// - multMin/multMax: the product of a shot's situational multipliers (coach, play types, emphasis, spacing, matchups, transition, sag...)
//   is clamped to this range, so stacked multipliers can't push a shot type to (almost) never or always
// - baseFloor: the rating + synergy term of a weight can't go below this (a bad synergy made rim and post weights negative, and then
//   mid-range always won)
// - forceThree*: end-of-game forced threes (when trailing by 3-10 late) fade out for a shooter whose three-point composite is below
//   forceThreeFull, and are never forced below forceThreeNone, unless it's a heave (under 2 seconds)
// - trailBy2*: trailing by 1-2 late, the shot leans away from threes and toward the rim
// - threeVsMid*: the three-point draw × 1 + threeVsMid × (three-point composite - mid-range make composite), within ±threeVsMidMax: a
//   better mid-range than three-point shooter pulls up from inside the line more, a better three-point shooter steps out
// - threeKnee/threeExcess/threeScale: the three-point draw (the product of all its factors) keeps only threeExcess of the part above
//   threeKnee, times threeScale (so the league's 3PA rate stays put). Its factors stack (three-point composite, Hunt threes, spacing,
//   kick-outs, play types...), and the best shooters took up to 20 threes a game, three quarters of their shots
export const SIM_FIX_SHOT_CHOICE = {
	mid: 0.9,
	rim: 1.06,
	post: 0.34,
	multMin: 0.4,
	multMax: 2.5,
	baseFloor: 0.02,
	forceThreeNone: 0.25,
	forceThreeFull: 0.35,
	trailBy2Seconds: 10,
	trailBy2Three: 0.6,
	trailBy2Rim: 1.5,
	threeKnee: 0.4,
	threeExcess: 0.12,
	threeScale: 1.26,
	threeVsMid: 1.5,
	threeVsMidMax: 0.25,
};

// Rest at the breaks between periods (energy, 0-1, recovered by every player on the roster): quarter breaks and halftime. A bench
// minute recovers 0.094, so these are like about half a minute and a minute and a half on the bench
export const SIM_FIX_BREAK_REST = { quarter: 0.04, halftime: 0.12 };

// The trailing team's boost (perfFactor = 1 - X tanh(diff / 60)), stock 0.2
export const SIM_FIX_PERF_FACTOR = 0.1;

// Team strength gap: every shot's make probability - k × (the shooting team's predicted margin - its opponent's), the predicted
// margins from team ovr's formula (team/ovr.basketball.ts, before its 0-100 scale) over each team's healthy players at tip-off, from
// their true ovrs. The fork's sim features (traits, spacing, rotations, coaching systems, star calibration, these fixes ...) each
// added a little to how much a better roster wins by, together ~0.54 points of margin per team ovr point in single games (the
// formula assumes 0.3), so the league's win% SD was ~.17 (NBA ~.15). With k = 0.0023 it is ~0.32 per point in single games and
// win% SD ~.15 over a league's first five seasons (src/test/parity). Who scores within a team is unchanged (a star's shot share and
// his edge over his teammates), and the league averages too (the two teams' deltas cancel). Mutable only so the parity scripts can
// sweep it
export const SIM_FIX_STRENGTH_GAP = { k: 0.0023 };

// Injury rate multiplier from strength and endurance: exp(-K (avg(stre, endu) - center) / 10), centered on the minutes-weighted
// league average so the league injury rate stays the same
export const SIM_FIX_INJURY_K = 0.08;
export const SIM_FIX_INJURY_CENTER = 51.4;
export const simFixInjuryFactor = (stre: number, endu: number) =>
	Math.exp(
		(-SIM_FIX_INJURY_K * ((stre + endu) / 2 - SIM_FIX_INJURY_CENTER)) / 10,
	);

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

// Offensive fouls (charges): on a drive or post-up, chance = base * (1 + k (offFoulRisk - 0.5)) * (1 + k (drawingCharges - 0.5)),
// for the shooter's offFoulRisk and his defender's drawingCharges composites (SIM_FIX_COMPOSITE_WEIGHTS). About 1 per team game
export const SIM_FIX_OFF_FOUL = { base: 0.025, k: 1.5 };

// Offensive rebound chance after a missed last free throw, relative to after a missed shot (NBA: ~13% vs ~25%)
export const SIM_FIX_FT_ORB = 0.5;

// Left-handed shooters (common/shootingHand.ts, cached as p.lefty in loadTeams): defenders see fewer of them, so a lefty's at-rim and
// post makes get a small unfamiliarity bonus (make, added to the make probability), mostly gone against a left-handed defender (sameHand
// keeps that fraction), and he drives a little more (drive, on the at-rim weight). Both are offset over everyone in the game by the
// share of lefties in it, so the league's at-rim/post rates and percentages stay the same
export const SIM_FIX_LEFTY = { make: 0.012, sameHand: 0.3, drive: 1.04 };

// ---- Game flow (Game Sim Fixes, gameFlow.ts). Default engine mechanics of the core sim features; with simFixes off none of this runs ----

// Contest levels (Game Sim Fixes with Matchup Defense): every jump shot, drive and post-up is open, contested or heavily contested. One
// random number per shot picks the level from a score z (positive = tighter): the shooter's defender (his perimeter or interior defense,
// tired defenders give more room), the help behind him (helpZ, below), the floor spacing, the shot clock (late-clock shots are rushed),
// catch-and-shoot vs pull-up, transition and end-of-quarter heaves. Each level has its own make change (centered, so the league's
// percentages stay put at the base shares) and block multiplier.
// - base: [open, heavily contested] shares at z = 0, by shot type (three, mid-range, at the rim, post-up); the rest is contested
// - k: how far z moves the shares (log-odds per unit of z)
// - make: make probability change of [open, contested, heavy], by shot type; blk: block multiplier of each level (both centered on the
//   base shares in contestDeltas)
// - the z terms: defender (per unit of his defensive composite above defRef, by shot type), help (per unit of the defense's help z,
//   by shot type: a pack-the-paint or zone help defense leaves threes more open), spacing (per unit of spacingAround), late (shot clock
//   at 0, ramping in over the last lateSeconds), pullUp / catchShoot (jumpers), transition, rushed (end-of-period heave), rimProtector
//   (at the rim and in the post, per unit of the defense's rim protection z), center (by shot type, the league mean of the rest)
export const SIM_FIX_CONTEST = {
	base: [
		[0.4, 0.1],
		[0.27, 0.2],
		[0.26, 0.33],
		[0.14, 0.38],
	],
	k: 1,
	make: [
		[0.035, -0.008, -0.075],
		[0.04, -0.006, -0.065],
		[0.07, 0, -0.085],
		[0.05, 0, -0.06],
	],
	blk: [0.4, 1, 1.6],
	defender: [3, 3, 2.5, 3],
	defRef: [0.5, 0.5, 0.5, 0.5],
	help: [-0.2, 0.25, 0.5, 0.4],
	rimProtector: [0, 0, 0.6, 0.4],
	spacing: 8,
	late: 1.2,
	lateSeconds: 6,
	pullUp: 0.35,
	catchShoot: -0.2,
	transition: -0.8,
	rushed: 1,
	center: [-0.59, -0.42, -0.66, -0.44],
};
