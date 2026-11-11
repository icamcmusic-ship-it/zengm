// Expanded ratings (basketball, the expandedRatings setting, see docs/native-features.md, Expanded ratings): three more player ratings,
//
// - wng: wingspan / length, on the same scale as hgt (a player with an average ape index has wng = hgt). Set at generation, then
//   essentially fixed (it can only grow a little before 21, with height).
// - pdef: perimeter defense (guarding ball handlers and shooters, steals, contesting jumpers).
// - idef: interior defense (post and rim defense, blocks, contesting shots at the rim).
//
// Second step (same setting): five more.
//
// - oreb / dreb: offensive and defensive rebounding. They replace reb in the game sim; reb is kept as their average (blendReb), like diq.
// - csh / dsh: catch-and-shoot and off-the-dribble jump shooting. fg (mid-range) and tp (three) stay the range ratings and are kept as
//   compat values: csh + dsh = fg + tp always (syncShootingToFgTp), so the average jump shooting of a player is unchanged and the split
//   only says how he gets his jumpers. In the sim an assisted jumper leans on csh, a self-created one on dsh (the stock fg/tp
//   composites, plus or minus half the gap).
// - bsc: ball security, turnover risk separate from dribbling skill. New, with no compat value (ovr gives it a fifth of drb's weight).
//
// With the setting on, pdef and idef replace diq in the game sim, and diq is kept as their average (blendDiq) so that every stock code
// path that reads diq (ovr, AI value, archetypes, ...) still works. With the setting off nothing here is used, the new fields (if any) are
// ignored and no random numbers are drawn.
//
// This file is shared by the worker and the UI: labels, the composite rating weights the sim and the skills use when the setting is on,
// and the deterministic derivation of the new ratings from the old ones (existing leagues, real players, imported files, custom players).
import { Rng } from "./ratingsBuilds/rng.ts";
import type { CompositeWeights } from "./types.ts";
import type { RatingKey } from "./types.basketball.ts";

// The second step of the setting (see below): offensive/defensive rebounding, catch-and-shoot/off-the-dribble shooting, ball security
export const EXPANDED_RATINGS2 = ["oreb", "dreb", "csh", "dsh", "bsc"] as const;
export const EXPANDED_RATINGS = [
	"wng",
	"pdef",
	"idef",
	...EXPANDED_RATINGS2,
] as const;
export type ExpandedRatingKey = (typeof EXPANDED_RATINGS)[number];
export type ExpandedRatingsValues = Record<ExpandedRatingKey, number>;

export const EXPANDED_RATING_INFO: Record<
	ExpandedRatingKey,
	{ label: string; name: string; description: string }
> = {
	wng: {
		label: "Wng",
		name: "Wingspan",
		description:
			"Wingspan (length): blocks, steals, rebounds, contesting shots and finishing over defenders. On the same scale as height, so a player with an average wingspan for his height has the same rating as his height.",
	},
	pdef: {
		label: "PDf",
		name: "Perimeter Defense",
		description:
			"Perimeter defense: guarding ball handlers and shooters, steals, contesting jump shots",
	},
	idef: {
		label: "IDf",
		name: "Interior Defense",
		description:
			"Interior defense: post defense, rim protection, blocks, contesting shots at the rim",
	},
	oreb: {
		label: "ORb",
		name: "Offensive Rebounding",
		description: "Offensive rebounding: crashing the glass, second chances",
	},
	dreb: {
		label: "DRb",
		name: "Defensive Rebounding",
		description:
			"Defensive rebounding: boxing out, ending the other team's possessions",
	},
	csh: {
		label: "C&S",
		name: "Catch-and-Shoot",
		description:
			"Catch-and-shoot: jump shots off a pass (spot-ups, assisted jumpers), mid-range and three",
	},
	dsh: {
		label: "OTD",
		name: "Off-the-Dribble",
		description:
			"Off-the-dribble shooting: self-created jump shots (pull-ups, step-backs), mid-range and three",
	},
	bsc: {
		label: "BSc",
		name: "Ball Security",
		description:
			"Ball security: protecting the ball, avoiding turnovers (separate from dribbling skill)",
	},
};

// diq with the setting on: the average of the two defense ratings
export const blendDiq = (pdef: number, idef: number) =>
	Math.round((pdef + idef) / 2);

type RatingsLike = Record<string, any>;

// reb with the setting on: the average of the two rebounding ratings
export const blendReb = (oreb: number, dreb: number) =>
	Math.round((oreb + dreb) / 2);

// All the expanded ratings (both steps). Rows filled before the second step was added have only wng/pdef/idef, and are filled in
// (fillExpandedRatings) like rows that have none.
export const hasExpandedRatings = (r: RatingsLike) =>
	typeof r.wng === "number" &&
	typeof r.pdef === "number" &&
	typeof r.idef === "number" &&
	typeof r.oreb === "number" &&
	typeof r.dreb === "number" &&
	typeof r.csh === "number" &&
	typeof r.dsh === "number" &&
	typeof r.bsc === "number";

// Split a sum into two ratings a + b = sum (0 <= sum <= 200) with a - b as close to split as the 0-100 bounds allow
// When sum and split have different parity the split can't be met exactly: a half is rounded to even, so the split doesn't drift one
// way over many re-splits (development re-splits every season).
export const splitPair = (sum: number, split: number): [number, number] => {
	const half = (sum + split) / 2;
	const floor = Math.floor(half);
	let a = limit(half === floor ? half : floor % 2 === 0 ? floor : floor + 1);
	let b = sum - a;
	if (b > 100) {
		b = 100;
		a = sum - b;
	} else if (b < 0) {
		b = 0;
		a = sum - b;
	}
	return [limit(a), limit(b)];
};

const limit = (x: number) => (x > 100 ? 100 : x < 0 ? 0 : Math.round(x));

const num = (r: RatingsLike, key: string, fallback: number) =>
	typeof r[key] === "number" && Number.isFinite(r[key]) ? r[key] : fallback;

// How much a player's defense leans to the perimeter (positive) or the interior (negative), from his other ratings: quick players guard
// the perimeter, tall and strong ones the paint. Average about 0 over a league.
export const defenseSplitBase = (r: RatingsLike) =>
	0.15 * (num(r, "spd", 50) - 50.8) -
	0.1 * (num(r, "hgt", 47.5) - 47.5) -
	0.05 * (num(r, "stre", 50) - 50.2) +
	0.03 * (num(r, "drb", 55) - 54.8);

export const DEFENSE_SPLIT_NOISE = 3;

// Offensive (positive) vs defensive rebounding lean: athletes and strong players crash the offensive glass, smart players box out.
// Average about 0 over a league.
export const reboundSplitBase = (r: RatingsLike) =>
	0.12 * (num(r, "jmp", 48.7) - 48.7) +
	0.08 * (num(r, "stre", 50.2) - 50.2) +
	0.04 * (num(r, "hgt", 47.5) - 47.5) -
	0.1 * (num(r, "oiq", 46.8) - 46.8);
export const REBOUND_SPLIT_NOISE = 3;

// Catch-and-shoot (positive) vs off-the-dribble lean: ball handlers create their own shot, bigs and non-dribblers spot up. Average
// about 0 over a league.
export const shootingSplitBase = (r: RatingsLike) =>
	-0.2 * (num(r, "drb", 54.8) - 54.8) -
	0.08 * (num(r, "spd", 50.8) - 50.8) +
	0.05 * (num(r, "hgt", 47.5) - 47.5);
export const SHOOTING_SPLIT_NOISE = 3.5;

// Ball security from dribbling, passing and basketball IQ (same league average as drb), before noise
export const ballSecurityBase = (r: RatingsLike) =>
	0.5 * num(r, "drb", 54.8) +
	0.3 * num(r, "oiq", 46.8) +
	0.2 * num(r, "pss", 51.3) +
	3.1;
export const BALL_SECURITY_NOISE = 5;
export const WINGSPAN_NOISE = 6.5;

// Wingspan from height plus the rebounding and leaping a player shows for his height (long players rebound and block above their
// height), plus noise. Averages hgt over a league.
export const wingspanBase = (r: RatingsLike) => {
	const hgt = num(r, "hgt", 47.5);
	const rebForHgt = num(r, "reb", 51.4) - (35 + 0.35 * hgt);
	const blkForHgt = num(r, "jmp", 48.7) - 48.7 + num(r, "diq", 46.7) - 46.7;
	return hgt + 0.18 * rebForHgt + 0.05 * blkForHgt;
};

// The seed of a player's derived ratings: his pid when he has one, else something stable about him
export const expandedRatingsSeed = (p: {
	pid?: number;
	firstName?: string;
	lastName?: string;
	born?: { year: number };
	srID?: string;
}) => {
	if (typeof p.pid === "number") {
		return `xr|${p.pid}`;
	}
	return `xr|${p.srID ?? ""}|${p.firstName ?? ""}|${p.lastName ?? ""}|${p.born?.year ?? ""}`;
};

// Deterministic, from the player's ratings and a seed. The split of diq into pdef/idef keeps their average equal to diq (so ovr and
// everything else built on diq is unchanged when an existing league turns the setting on).
export const deriveExpandedRatings = (
	r: RatingsLike,
	seed: string,
	wngOverride?: number,
): ExpandedRatingsValues => {
	const rng = new Rng(seed);
	const wngNoise = rng.normal(0, WINGSPAN_NOISE * 0.85);
	const splitNoise = rng.normal(0, DEFENSE_SPLIT_NOISE);
	// Second step (drawn after the first step's numbers, so those derive exactly as before)
	const rebNoise = rng.normal(0, REBOUND_SPLIT_NOISE);
	const shootNoise = rng.normal(0, SHOOTING_SPLIT_NOISE);
	const bscNoise = rng.normal(0, BALL_SECURITY_NOISE * 0.85);

	const wng = wngOverride ?? limit(wingspanBase(r) + wngNoise);

	const diq = num(r, "diq", 46.7);
	const half = Math.round(defenseSplitBase(r) + splitNoise);
	let pdef = limit(diq + half);
	let idef = limit(diq - half);

	// Keep the average at diq when clamping cut one side off
	const target = 2 * diq;
	if (pdef + idef !== target) {
		if (pdef === 100 || pdef === 0) {
			idef = limit(target - pdef);
		} else {
			pdef = limit(target - idef);
		}
	}

	// reb stays their average, fg + tp stays csh + dsh
	const reb = num(r, "reb", 51.4);
	const [oreb, dreb] = splitPair(
		2 * reb,
		2 * Math.round(reboundSplitBase(r) + rebNoise),
	);
	const fg = num(r, "fg", 47);
	const tp = num(r, "tp", 47.1);
	const [csh, dsh] = splitPair(
		Math.round(fg + tp),
		2 * Math.round(shootingSplitBase(r) + shootNoise),
	);
	const bsc = limit(ballSecurityBase(r) + bscNoise);

	return { wng, pdef, idef, oreb, dreb, csh, dsh, bsc };
};

// Fill in missing expanded ratings in every ratings row of a player (in place). Wingspan is a body measurement, so it is the same in
// every row (taken from a row that has one, else derived from the latest row); the defense split is derived per row from that row's diq.
// Returns true if anything changed.
export const fillExpandedRatings = (p: {
	pid?: number;
	firstName?: string;
	lastName?: string;
	born?: { year: number };
	srID?: string;
	ratings: RatingsLike[];
}): boolean => {
	const rows = p.ratings;
	if (rows.length === 0 || rows.every(hasExpandedRatings)) {
		return false;
	}

	const seed = expandedRatingsSeed(p);
	const latest = rows.at(-1)!;
	let wng: number | undefined;
	for (let i = rows.length - 1; i >= 0; i--) {
		if (typeof rows[i]!.wng === "number") {
			wng = rows[i]!.wng;
			break;
		}
	}
	if (wng === undefined) {
		wng = deriveExpandedRatings(latest, seed).wng;
	}

	for (const r of rows) {
		if (hasExpandedRatings(r)) {
			continue;
		}
		const derived = deriveExpandedRatings(r, seed, wng);
		if (typeof r.wng !== "number") {
			// Height can grow a little early in a career; wingspan with it
			r.wng = limit(wng - num(latest, "hgt", 47.5) + num(r, "hgt", 47.5));
		}
		if (typeof r.pdef !== "number" || typeof r.idef !== "number") {
			r.pdef = derived.pdef;
			r.idef = derived.idef;
		}
		if (typeof r.oreb !== "number" || typeof r.dreb !== "number") {
			r.oreb = derived.oreb;
			r.dreb = derived.dreb;
		}
		if (typeof r.csh !== "number" || typeof r.dsh !== "number") {
			r.csh = derived.csh;
			r.dsh = derived.dsh;
		}
		if (typeof r.bsc !== "number") {
			r.bsc = derived.bsc;
		}
	}

	return true;
};

// Inches of wingspan for display, from his height in inches and the wng - hgt rating gap (hgt 0-100 spans 27 inches, and an average
// player's wingspan is about 4 inches longer than his height)
export const wingspanInches = (
	heightInInches: number,
	hgt: number,
	wng: number,
) => Math.round(heightInInches + 4 + ((wng - hgt) * 27) / 100);

// Composite ratings with the setting on. Only the ones that change are listed; everything else uses COMPOSITE_WEIGHTS. Weights were
// chosen so each composite has about the same league average as the stock one (see docs/native-features.md, Expanded ratings for the calibration).
export const EXPANDED_COMPOSITE_WEIGHTS: CompositeWeights<
	RatingKey | ExpandedRatingKey
> = {
	shootingAtRim: {
		ratings: ["hgt", "wng", "stre", "dnk", "oiq"],
		weights: [1.65, 0.4, 0.3, 0.3, 0.2],
	},
	rebounding: {
		ratings: ["hgt", "wng", "stre", "jmp", "reb", "oiq", "idef"],
		weights: [1.5, 0.6, 0.1, 0.1, 2, 0.5, 0.5],
		skill: {
			label: "R",
			cutoff: 0.62,
		},
	},
	stealing: {
		ratings: [50, "spd", "pdef", "wng"],
		weights: [1, 1, 1.75, 0.5],
	},
	blocking: {
		ratings: ["hgt", "wng", "jmp", "idef"],
		weights: [1.5, 1.25, 1.5, 0.75],
	},
	defense: {
		ratings: ["hgt", "wng", "stre", "spd", "jmp", "pdef", "idef"],
		weights: [0.75, 0.4, 0.9, 0.9, 0.5, 1, 1],
	},
	defenseInterior: {
		ratings: ["hgt", "wng", "stre", "spd", "jmp", "idef"],
		weights: [1.75, 1, 1, 0.25, 0.5, 2.25],
		skill: {
			label: "Di",
			cutoff: 0.595,
		},
	},
	defensePerimeter: {
		ratings: ["hgt", "wng", "stre", "spd", "jmp", "pdef"],
		weights: [0.25, 0.5, 0.25, 1.75, 0.5, 1.5],
		skill: {
			label: "Dp",
			cutoff: 0.607,
		},
	},
	jumpBall: {
		ratings: ["hgt", "wng", "jmp"],
		weights: [0.8, 0.25, 0.25],
	},
	// Only exists with the setting on: pure length, for finishing over shot blockers
	length: {
		ratings: ["hgt", "wng"],
		weights: [0.3, 1],
	},
	// Second step. The stock rebounding composite (reb is the average of oreb and dreb) is still the R skill; the sim uses these two.
	offRebounding: {
		ratings: ["hgt", "wng", "stre", "jmp", "oreb", "oiq", "idef"],
		weights: [1.5, 0.6, 0.1, 0.2, 2, 0.5, 0.4],
	},
	defRebounding: {
		ratings: ["hgt", "wng", "stre", "jmp", "dreb", "oiq", "idef"],
		weights: [1.5, 0.6, 0.2, 0.1, 2, 0.4, 0.6],
	},
	// Ball security with the setting on: mostly bsc, dribbling and passing still matter (less)
	ballSecurity: {
		ratings: ["bsc", "drb", "pss", "spd"],
		weights: [2, 0.5, 0.5, 0.5],
	},
	// Who commits the turnovers: careless (low bsc) high-usage players
	turnovers: {
		ratings: [50, "ins", "pss", "oiq", "bsc", 55],
		weights: [0.5, 1, 1, -0.5, -1, 0.5],
	},
	// Jump shooting off a pass and off the dribble (only their difference is used: see GameSim, jumpShotStyleDelta)
	catchShoot: {
		ratings: ["csh"],
	},
	offDribble: {
		ratings: ["dsh"],
	},
};

const merged = new WeakMap<object, CompositeWeights<string>>();

// The composite weights to use: stock, or stock with the expanded overrides
export const compositeWeightsFor = <T extends string>(
	base: CompositeWeights<T>,
	expanded: boolean,
): CompositeWeights<string> => {
	if (!expanded) {
		return base as CompositeWeights<string>;
	}
	let out = merged.get(base);
	if (!out) {
		out = {
			...(base as CompositeWeights<string>),
			...(EXPANDED_COMPOSITE_WEIGHTS as CompositeWeights<string>),
		};
		merged.set(base, out);
	}
	return out;
};

// A list of rating keys for a table, with the expanded ones added (wingspan after height, the two defense ratings after diq)
// (and catch-and-shoot/off-the-dribble after tp, ball security after drb, offensive/defensive rebounding after reb)
export const insertExpandedRatingKeys = <T extends string>(
	keys: readonly T[],
): (T | ExpandedRatingKey)[] => {
	const out: (T | ExpandedRatingKey)[] = [];
	for (const key of keys) {
		out.push(key);
		if (key === "hgt") {
			out.push("wng");
		} else if (key === "diq") {
			out.push("pdef", "idef");
		} else if (key === "tp") {
			out.push("csh", "dsh");
		} else if (key === "drb") {
			out.push("bsc");
		} else if (key === "reb") {
			out.push("oreb", "dreb");
		}
	}
	return out;
};

const EXPANDED_SET = new Set<string>(EXPANDED_RATINGS);
export const isExpandedRatingKey = (key: string): key is ExpandedRatingKey =>
	EXPANDED_SET.has(key);
