// Sub-Ratings in Sim (the subRatingsSim League Extra, basketball, needs Sub-Ratings; see docs/native-features.md, Sub-ratings, step 3).
//
// The game sim reads the sub-ratings only through the player composites, folded in once at game load (loadTeams): where a composite
// reads a base rating and one of its sub-ratings is the more specific skill (shot blocking for the blocking composite, lateral
// quickness for perimeter defense, ...), the composite reads base + w (sub - base) instead of the base. So the per-possession code is
// unchanged and costs nothing, and when every sub equals its base every composite is exactly what it was (the effect is purely the
// shape). Each rating's change in one composite is bounded (SUB_SIM.bound).
//
// No double counting with Expanded Ratings: the subs that correspond to an expanded rating follow it (anchorToExpanded), so a composite
// that reads perimeter or interior defense (pdef/idef) only gets the sub's lean within its side (steals vs the perimeter side
// 0.6 perimeter D + 0.4 steals, ...), and the jumper style gaps only the part of catch-and-shoot vs off-the-dribble that csh/dsh don't
// already carry. Rebounding (oreb/dreb) and ball security (bsc) are already the subs there.
//
// A few new per-player numbers, read with a fallback to the old ones (so nothing changes with the setting off): shootingAtRimMake
// (finesse and max vertical, the make of a drive), shootingPutBack (close shots, putbacks and tip-ins), jumperGap3 / jumperGapMid (the
// catch-and-shoot minus off-the-dribble gap by shot type: threes from catch-and-shoot 3 vs off-dribble 3, mid-range jumpers from spot-up
// vs pull-up) and simLat (lateral quickness, the defender's side of a drive mismatch in Matchup Defense).

import {
	INTERIOR_SIDE,
	isValidSubArray,
	jumperLean,
	PERIM_SIDE,
	SUB_DEFS,
	SUB_INDEX,
} from "../../../common/subRatings.ts";
import type { CompositeWeights } from "../../../common/types.ts";

export const SUB_SIM = {
	// Most one rating can move in one composite, in rating points
	bound: 15,
	// Jumper style gaps: how much of the sub-ratings' catch-and-shoot minus off-the-dribble gap (by shot type) the gap takes, and its
	// bound (composite units)
	gapWeight: 1,
	gapBound: 0.25,
	// Post-ups of a big (post moves) vs short shots of a small player (floater/touch): height range of the blend
	bigLo: 35,
	bigHi: 60,
};

// Calibration with the setting on, so the league totals stay the same (new-league defaults, 8 leagues × 1 season): the generated
// shapes are not centered on their bases in the league (contact finishing averages 3 below dunks/layups, pull-up 1.4 above mid-range,
// post moves 1.6 above inside, ...), so folding them in moves the league a little. Make probability offsets by shot type (jumpers on top of
// the style gap), and multipliers on shooting fouls drawn, blocks and steals. Only used with the setting on
export const SUB_SIM_CAL = {
	three: -0.003,
	// (without Expanded Ratings the generated shapes lean to catch-and-shoot threes, which most threes are)
	threeNoExpanded: -0.008,
	mid: 0.003,
	rim: -0.0007,
	post: -0.0065,
	foul: 1.018,
	blk: 0.982,
	stl: 0.99,
};

// A replacement term: the rating reads base + w (sub - reference), reference being the sub's base, or its side of defense when the
// composite reads pdef/idef (Expanded Ratings)
type Term = readonly [sub: string, w: number];
type RatingMap = Readonly<Record<string, readonly Term[]>>;

// Composite -> rating key -> terms. Keys a composite doesn't read are ignored, so one map covers the stock, Game Sim Fixes and expanded
// variants of a composite.
export const SUB_SIM_MAP: Readonly<Record<string, RatingMap>> = {
	// Who blocks shots, and the team's shot blocking: shot blocking, standing vertical (wingspan is already in it with Expanded Ratings)
	blocking: {
		diq: [["blk", 1]],
		idef: [["blk", 1]],
		jmp: [["stj", 1]],
	},
	// Who gets the steals (and Perimeter Defense's steal credit through defensePerimeter): steals, lateral quickness
	stealing: {
		diq: [["stl", 1]],
		pdef: [["stl", 1]],
		spd: [["lat", 1]],
	},
	// On-ball and perimeter defense (shot defense, Matchup Defense assignments, steal chances): perimeter D, lateral quickness
	defensePerimeter: {
		diq: [["pdf", 1]],
		pdef: [["pdf", 1]],
		spd: [["lat", 1]],
	},
	// Rim and post defense: interior D, standing vertical
	defenseInterior: {
		diq: [["idf", 1]],
		idef: [["idf", 1]],
		jmp: [["stj", 1]],
	},
	// Team defense: lateral quickness is the defensive half of speed
	defense: {
		spd: [["lat", 1]],
	},
	// Defenders who move their feet foul less
	fouling: {
		spd: [["lat", 1]],
	},
	// Rebounding: standing vertical (the offensive/defensive split is oreb/dreb, which the subs follow)
	rebounding: {
		jmp: [["stj", 1]],
	},
	offRebounding: {
		jmp: [["stj", 1]],
	},
	defRebounding: {
		jmp: [["stj", 1]],
	},
	jumpBall: {
		jmp: [["stj", 1]],
	},
	// Pace and transition: straight-line speed
	pace: {
		spd: [["sls", 1]],
	},
	// How often he shoots threes and how well (the base of the make; catch-and-shoot vs off-the-dribble is the gap below): range half
	shootingThreePointer: {
		tp: [["rng", 0.5]],
	},
	// Drawing fouls and and-ones: contact finishing
	drawingFouls: {
		dnk: [["con", 1]],
	},
	// Usage and shot creation (Spacing & Shot Creation's creator draw): shot creation, and vision for creating for others
	usage: {
		drb: [["crt", 1]],
	},
	creation: {
		drb: [["crt", 1]],
		pss: [["vis", 1]],
	},
	// Pressure: handle (team dribbling, the steal and turnover chances)
	dribbling: {
		drb: [["hnd", 1]],
	},
	// Assists (how often a shot is assisted, who passes): vision
	passing: {
		pss: [["vis", 1]],
	},
	// Team ball security (Expanded Ratings: bsc is already Ball Security): handle and pass accuracy
	ballSecurity: {
		drb: [["hnd", 1]],
		pss: [["acc", 1]],
	},
	// Who commits the turnovers: bad passes (pass accuracy; pss counts toward turnovers, so a better passer's accuracy takes it back),
	// and without Expanded Ratings ball security (on the offensive IQ term, the composite's carefulness)
	turnovers: {
		pss: [["acc", -1]],
		oiq: [["sec", 1]],
	},
	// The make of a drive (new: shootingAtRim stays the selection): finesse in traffic, max vertical above the rim
	shootingAtRimMake: {
		dnk: [
			["fns", 1],
			["mxv", 0.5],
		],
	},
	// Putbacks and tip-ins (new): close shots
	shootingPutBack: {
		dnk: [["cls", 1]],
	},
};

// Post moves for a big, touch/floater for a small player (and close shots for both): their weights in the inside composites
// (shootingLowPost* read ins)
const insideTerms = (hgt: number): readonly Term[] => {
	let b = (hgt - SUB_SIM.bigLo) / (SUB_SIM.bigHi - SUB_SIM.bigLo);
	b = b < 0 ? 0 : b > 1 ? 1 : b;
	return [
		["pst", 0.75 * b],
		["flt", 0.75 * (1 - b)],
		["cls", 0.25],
	];
};
// (not shootingLowPostSelect, Game Sim Fixes' how often he posts up: the subs are how well)
const INSIDE_COMPOSITES = ["shootingLowPost", "shootingLowPostMake"];

const I = SUB_INDEX as Record<string, number>;
const PERIM_IDX = new Set<number>(PERIM_SIDE.map(([i]) => i));
const INTERIOR_IDX = new Set<number>(INTERIOR_SIDE.map(([i]) => i));
const sideLevel = (s: readonly number[], side: typeof PERIM_SIDE) => {
	let x = 0;
	for (const [i, w] of side) {
		x += w * s[i]!;
	}
	return x;
};

type Ratings = Record<string, any>;

// One player's sub-ratings, ready to fold into his composites
export type SubSimPlayer = {
	r: Ratings;
	s: readonly number[];
	perim: number;
	interior: number;
	inside: readonly CTerm[];
};

export const subSimPlayer = (r: Ratings): SubSimPlayer | undefined => {
	const s = r.sub;
	if (!isValidSubArray(s)) {
		return undefined;
	}
	return {
		r,
		s,
		perim: sideLevel(s, PERIM_SIDE),
		interior: sideLevel(s, INTERIOR_SIDE),
		inside: compileTerms(
			"ins",
			insideTerms(typeof r.hgt === "number" ? r.hgt : 50),
		),
	};
};

// Terms compiled to sub indexes, with what each one is measured from: its base (0), the perimeter side (1) or the interior side (2)
type CTerm = { i: number; w: number; base: string; ref: 0 | 1 | 2 };
const compileTerms = (key: string, terms: readonly Term[]): CTerm[] =>
	terms.map(([sub, w]) => {
		const i = I[sub]!;
		return {
			i,
			w,
			base: SUB_DEFS[i]!.base,
			ref:
				key === "pdef" && PERIM_IDX.has(i)
					? 1
					: key === "idef" && INTERIOR_IDX.has(i)
						? 2
						: 0,
		};
	});

// How much a rating moves in a composite from these terms (bounded)
const deltaFor = (sp: SubSimPlayer, terms: readonly CTerm[]) => {
	let d = 0;
	for (const t of terms) {
		const ref =
			t.ref === 1
				? sp.perim
				: t.ref === 2
					? sp.interior
					: (sp.r[t.base] as number);
		d += t.w * (sp.s[t.i]! - ref);
	}
	const b = SUB_SIM.bound;
	return d > b ? b : d < -b ? -b : d;
};

// Does the sub-ratings fold change this composite at all
export const subSimTouches = (composite: string) =>
	Object.hasOwn(SUB_SIM_MAP, composite) ||
	INSIDE_COMPOSITES.includes(composite);

// For each component of a composite: its compiled terms, "inside" (the player's own post/floater blend) or undefined. Cached per
// composite and components array (the weights objects are module constants)
type Plan = (readonly CTerm[] | "inside" | undefined)[];
const plans = new Map<string, WeakMap<object, Plan>>();
const planFor = (
	composite: string,
	components: readonly (string | number)[],
): Plan => {
	let byArray = plans.get(composite);
	if (!byArray) {
		byArray = new WeakMap();
		plans.set(composite, byArray);
	}
	let plan = byArray.get(components);
	if (!plan) {
		// A turnovers composite with ball security (bsc, Expanded Ratings) already counts the Ball Security sub
		const hasBsc = composite === "turnovers" && components.includes("bsc");
		const inside = INSIDE_COMPOSITES.includes(composite);
		plan = components.map((c) => {
			if (typeof c === "number" || (hasBsc && c === "oiq")) {
				return undefined;
			}
			if (c === "ins" && inside) {
				return "inside";
			}
			const terms = SUB_SIM_MAP[composite]?.[c];
			return terms ? compileTerms(c, terms) : undefined;
		});
		byArray.set(components, plan);
	}
	return plan;
};

// A composite rating with the sub-ratings folded in. The same arithmetic as player.compositeRating (no fuzz), so a rating with no
// terms, or subs at their bases, gives exactly the same number
export const subSimComposite = (
	sp: SubSimPlayer,
	composite: string,
	components: readonly (string | number)[],
	weights: readonly number[] | undefined,
) => {
	const plan = planFor(composite, components);
	let numerator = 0;
	let denominator = 0;
	for (let i = 0; i < components.length; i++) {
		const component = components[i]!;
		let factor: number;
		if (typeof component === "number") {
			factor = component;
		} else {
			const rating: number | undefined = sp.r[component];
			if (rating === undefined) {
				throw new Error(`Undefined value for rating "${component}"`);
			}
			const terms = plan[i];
			factor =
				terms === undefined
					? rating
					: rating + deltaFor(sp, terms === "inside" ? sp.inside : terms);
		}
		const weight = weights?.[i] ?? 1;
		numerator += factor * weight;
		denominator += 100 * weight;
	}
	const x = numerator / denominator;
	return x < 0 ? 0 : x > 1 ? 1 : x;
};

// The jumper style gaps by shot type (composite units, like catchShoot - offDribble): the stored gap (Expanded Ratings, 0 without)
// plus what the subs say beyond it
export const jumperGaps = (sp: SubSimPlayer, baseGap: number) => {
	const s = sp.s;
	const lean =
		typeof sp.r.csh === "number" && typeof sp.r.dsh === "number"
			? jumperLean(s)
			: 0;
	const b = SUB_SIM.gapBound;
	const bound = (x: number) => (x > b ? b : x < -b ? -b : x);
	const k = SUB_SIM.gapWeight / 100;
	return {
		three: baseGap + bound(k * (s[I.tcs!]! - s[I.tod!]! - lean)),
		mid: baseGap + bound(k * (s[I.spu!]! - s[I.pul!]! - lean)),
	};
};

// The at-rim composite's weights, for the two new finishing composites
export const atRimWeights = (weights: CompositeWeights<string>) =>
	weights.shootingAtRim!;

// Lateral quickness (Matchup Defense: a defender's side of a drive mismatch)
export const subSimLat = (sp: SubSimPlayer) => sp.s[I.lat!]!;
