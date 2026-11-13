// Sub-ratings (basketball, the subRatings League Extra, see docs/native-features.md, Sub-ratings).
//
// Ten base ratings are each the weighted average of 2-4 sub-ratings. The sub-ratings of a ratings row are stored compactly as one
// int array, `r.sub`, in the fixed order of SUB_DEFS (version SUB_RATINGS_VERSION, stored per player in `p.subP.v`). The base ratings
// stay stored too and always equal baseFromSubs (the sync functions here keep them so), so everything that reads base ratings (game
// sim, ovr, value, skills, stock code) is untouched. Height, strength, endurance, free throws and offensive IQ have no sub-ratings.
//
// Shared by the worker and the UI: definitions, labels, the weights, and the fitting that keeps subs and bases in sync. Generation and
// development (worker only) are in subRatingsGen.ts. Nothing here draws a random number.

export const SUB_RATINGS_VERSION = 1;

// Ratings rows that keep their sub-ratings: the last SUB_HISTORY rows of a player (older rows keep their bases only)
export const SUB_HISTORY = 5;

// How a sub-rating ages: "fade" ones (athletic, legs, motor) take more of a decline and fade earlier, "hold" ones (positioning, range,
// IQ, touch) take less and keep growing longer, "mid" ones in between
export type SubAging = "fade" | "mid" | "hold";

export type SubBase =
	| "diq"
	| "tp"
	| "ins"
	| "dnk"
	| "fg"
	| "reb"
	| "drb"
	| "pss"
	| "spd"
	| "jmp";

export type SubDef = {
	key: string;
	base: SubBase;
	// Weight in the base rating, in percent (the weights of a base sum to 100)
	w: number;
	// Short label (tables), name (player page), description (tooltips)
	label: string;
	name: string;
	description: string;
	aging: SubAging;
};

// Fixed order: the index in this list is the index in r.sub. Never reorder; a new version appends or migrates.
export const SUB_DEFS: readonly SubDef[] = [
	// Defense (diq)
	{
		key: "blk",
		base: "diq",
		w: 20,
		label: "Blk",
		name: "Shot Blocking",
		description:
			"Shot blocking: timing and reach at the rim and on the help side",
		aging: "fade",
	},
	{
		key: "stl",
		base: "diq",
		w: 20,
		label: "Stl",
		name: "Steals",
		description:
			"Hands and anticipation: steals, deflections, jumping passing lanes",
		aging: "fade",
	},
	{
		key: "idf",
		base: "diq",
		w: 30,
		label: "IntD",
		name: "Interior D",
		description:
			"Interior defense: post defense, positioning and verticality at the rim",
		aging: "hold",
	},
	{
		key: "pdf",
		base: "diq",
		w: 30,
		label: "PerD",
		name: "Perimeter D",
		description:
			"Perimeter defense: staying in front of ball handlers, contesting shooters",
		aging: "fade",
	},
	// Three-point (tp)
	{
		key: "rng",
		base: "tp",
		w: 40,
		label: "Rng",
		name: "Range",
		description: "Range: how far out his three holds up, and deep threes",
		aging: "hold",
	},
	{
		key: "tcs",
		base: "tp",
		w: 35,
		label: "C&S3",
		name: "Catch & Shoot 3",
		description: "Catch-and-shoot threes: spot-ups and threes off a pass",
		aging: "hold",
	},
	{
		key: "tod",
		base: "tp",
		w: 25,
		label: "OTD3",
		name: "Off-Dribble 3",
		description: "Off-the-dribble threes: pull-ups and step-backs",
		aging: "mid",
	},
	// Inside (ins)
	{
		key: "pst",
		base: "ins",
		w: 40,
		label: "Post",
		name: "Post Moves",
		description:
			"Post moves: back-to-the-basket scoring, footwork, hooks over defenders",
		aging: "hold",
	},
	{
		key: "cls",
		base: "ins",
		w: 35,
		label: "Cls",
		name: "Close Shots",
		description:
			"Close shots: short shots around the basket, putbacks, tip-ins",
		aging: "mid",
	},
	{
		key: "flt",
		base: "ins",
		w: 25,
		label: "Flt",
		name: "Touch / Floater",
		description: "Touch: floaters, runners and soft shots in the lane",
		aging: "hold",
	},
	// Dunks/layups (dnk)
	{
		key: "con",
		base: "dnk",
		w: 50,
		label: "Cnt",
		name: "Contact Finishing",
		description:
			"Finishing through contact: power dunks and and-ones in traffic",
		aging: "fade",
	},
	{
		key: "fns",
		base: "dnk",
		w: 50,
		label: "Fns",
		name: "Finesse",
		description:
			"Finesse finishing: reverses, euro steps, layups around defenders",
		aging: "hold",
	},
	// Mid-range (fg)
	{
		key: "pul",
		base: "fg",
		w: 50,
		label: "PU",
		name: "Pull-Up",
		description: "Mid-range pull-ups off the dribble",
		aging: "mid",
	},
	{
		key: "spu",
		base: "fg",
		w: 50,
		label: "SpU",
		name: "Spot-Up",
		description: "Mid-range spot-ups and shots off a pass",
		aging: "hold",
	},
	// Rebounding (reb)
	{
		key: "orb",
		base: "reb",
		w: 50,
		label: "OReb",
		name: "Offensive Reb",
		description: "Offensive rebounding: crashing the glass, second chances",
		aging: "fade",
	},
	{
		key: "drd",
		base: "reb",
		w: 50,
		label: "DReb",
		name: "Defensive Reb",
		description: "Defensive rebounding: boxing out, ending possessions",
		aging: "hold",
	},
	// Dribbling (drb)
	{
		key: "hnd",
		base: "drb",
		w: 50,
		label: "Hnd",
		name: "Handle",
		description:
			"Handle: dribbling moves, changing direction, beating pressure",
		aging: "mid",
	},
	{
		key: "sec",
		base: "drb",
		w: 25,
		label: "BSec",
		name: "Ball Security",
		description: "Ball security: protecting the ball, avoiding turnovers",
		aging: "hold",
	},
	{
		key: "crt",
		base: "drb",
		w: 25,
		label: "Crt",
		name: "Shot Creation",
		description:
			"Shot creation: getting to his spots and creating space off the bounce",
		aging: "mid",
	},
	// Passing (pss)
	{
		key: "vis",
		base: "pss",
		w: 50,
		label: "Vis",
		name: "Vision",
		description: "Court vision: seeing the play, reading the defense",
		aging: "hold",
	},
	{
		key: "acc",
		base: "pss",
		w: 50,
		label: "Acc",
		name: "Pass Accuracy",
		description: "Passing accuracy: delivering the ball on time and on target",
		aging: "hold",
	},
	// Speed (spd)
	{
		key: "sls",
		base: "spd",
		w: 50,
		label: "Sprt",
		name: "Straight-Line Speed",
		description: "Straight-line speed: end to end, in transition",
		aging: "fade",
	},
	{
		key: "lat",
		base: "spd",
		w: 50,
		label: "Lat",
		name: "Lateral Quickness",
		description: "Lateral quickness: sliding with ball handlers, closing out",
		aging: "fade",
	},
	// Jumping (jmp)
	{
		key: "stj",
		base: "jmp",
		w: 50,
		label: "StJ",
		name: "Standing Reach",
		description:
			"Standing vertical: quick off the floor in traffic, without a run-up",
		aging: "mid",
	},
	{
		key: "mxv",
		base: "jmp",
		w: 50,
		label: "Vert",
		name: "Max Vertical",
		description:
			"Max vertical: leaping with a run-up, lobs and highlight dunks",
		aging: "fade",
	},
];

export const NUM_SUBS = SUB_DEFS.length;

export const SUB_BASES: readonly SubBase[] = [
	"diq",
	"tp",
	"ins",
	"dnk",
	"fg",
	"reb",
	"drb",
	"pss",
	"spd",
	"jmp",
];

// The sub-ratings of each base: indexes into r.sub and their weights
export const SUB_GROUPS: readonly {
	base: SubBase;
	idx: readonly number[];
	w: readonly number[];
}[] = SUB_BASES.map((base) => {
	const idx: number[] = [];
	const w: number[] = [];
	SUB_DEFS.forEach((d, i) => {
		if (d.base === base) {
			idx.push(i);
			w.push(d.w);
		}
	});
	return { base, idx, w };
});

export const SUB_INDEX: Record<string, number> = Object.fromEntries(
	SUB_DEFS.map((d, i) => [d.key, i]),
);

const BASE_SET = new Set<string>(SUB_BASES);
export const hasSubs = (base: string): base is SubBase => BASE_SET.has(base);

export const subGroupOf = (base: SubBase) =>
	SUB_GROUPS[SUB_BASES.indexOf(base)]!;

const clamp100 = (x: number) => (x > 100 ? 100 : x < 0 ? 0 : x);

type RatingsLike = Record<string, any>;

// A base rating from its sub-ratings: the weighted average, rounded (integer arithmetic, so halves always round up)
export const baseFromGroup = (
	sub: readonly number[],
	group: (typeof SUB_GROUPS)[number],
) => {
	let sum = 0;
	for (let j = 0; j < group.idx.length; j++) {
		sum += group.w[j]! * sub[group.idx[j]!]!;
	}
	return Math.floor((sum + 50) / 100);
};

export const baseFromSubs = (sub: readonly number[], base: SubBase) =>
	baseFromGroup(sub, subGroupOf(base));

export const isValidSubArray = (sub: unknown): sub is number[] =>
	Array.isArray(sub) &&
	sub.length === NUM_SUBS &&
	sub.every((x) => typeof x === "number" && Number.isFinite(x));

// Whether every base of a ratings row equals the weighted average of its subs
export const subsMatchBases = (r: RatingsLike) => {
	if (!isValidSubArray(r.sub)) {
		return false;
	}
	for (const group of SUB_GROUPS) {
		if (baseFromGroup(r.sub, group) !== r[group.base]) {
			return false;
		}
	}
	return true;
};

// Integer sub-ratings for one base: x are the wanted (real) values, flex how much each one moves to make the weighted average hit the
// target (0-100, an integer). The result always reproduces the target exactly (round(sum w s / 100) = target), within 0..100.
export const fitGroup = (
	x: readonly number[],
	w: readonly number[],
	target: number,
	flex?: readonly number[],
): number[] => {
	const n = x.length;
	const t = clamp100(Math.round(target));
	const vals = x.map((v) => clamp100(Number.isFinite(v) ? v : t));
	const fl = flex ? flex.map((f) => (f > 0 ? f : 0.01)) : vals.map(() => 1);

	// Shift by flex until the weighted average is the target, redistributing what the 0/100 bounds cut off
	for (let iter = 0; iter < 6; iter++) {
		let sum = 0;
		for (let j = 0; j < n; j++) {
			sum += w[j]! * vals[j]!;
		}
		const delta = t - sum / 100;
		if (Math.abs(delta) < 1e-9) {
			break;
		}
		let denom = 0;
		for (let j = 0; j < n; j++) {
			const v = vals[j]!;
			if ((delta > 0 && v < 100) || (delta < 0 && v > 0)) {
				denom += (w[j]! * fl[j]!) / 100;
			}
		}
		if (denom <= 0) {
			break;
		}
		for (let j = 0; j < n; j++) {
			const v = vals[j]!;
			if ((delta > 0 && v < 100) || (delta < 0 && v > 0)) {
				vals[j] = clamp100(v + (delta * fl[j]!) / denom);
			}
		}
	}

	const out = vals.map((v) => Math.round(v));
	// Rounding: nudge the sub whose rounding moved it furthest the wrong way, until the rounded average is the target
	for (let iter = 0; iter < 400; iter++) {
		let sum = 0;
		for (let j = 0; j < n; j++) {
			sum += w[j]! * out[j]!;
		}
		const got = Math.floor((sum + 50) / 100);
		if (got === t) {
			break;
		}
		const dir = got < t ? 1 : -1;
		let best = -1;
		let bestScore = -Infinity;
		for (let j = 0; j < n; j++) {
			const o = out[j]!;
			if ((dir > 0 && o >= 100) || (dir < 0 && o <= 0)) {
				continue;
			}
			// Prefer the one rounded furthest from its wanted value in the other direction, then the most flexible
			const score = (vals[j]! - o) * dir + 0.001 * fl[j]!;
			if (score > bestScore) {
				bestScore = score;
				best = j;
			}
		}
		if (best < 0) {
			break;
		}
		out[best]! += dir;
	}
	return out;
};

// Sub-ratings for a whole row: x are wanted values (length NUM_SUBS), fitted to the row's bases
export const fitSubsToBases = (
	x: readonly number[],
	r: RatingsLike,
	flex?: readonly number[],
): number[] => {
	const out = new Array<number>(NUM_SUBS);
	for (const group of SUB_GROUPS) {
		const xs = group.idx.map((i) => x[i]!);
		const fs = flex ? group.idx.map((i) => flex[i]!) : undefined;
		const fitted = fitGroup(xs, group.w, r[group.base], fs);
		group.idx.forEach((i, j) => {
			out[i] = fitted[j]!;
		});
	}
	return out;
};

// Subs at their base (a flat shape), for a row with no sub-ratings
export const flatSubs = (r: RatingsLike) =>
	fitSubsToBases(
		SUB_DEFS.map((d) => r[d.base] ?? 50),
		r,
	);

// Offsets of the subs from their bases (the shape of a player's game)
export const subOffsets = (sub: readonly number[], r: RatingsLike) =>
	SUB_DEFS.map((d, i) => sub[i]! - (r[d.base] as number));

// After a base changed (development, an edit, a bonus, an injury), move its subs with it, keeping their shape. Returns a new array (never
// mutates: ratings rows are copied shallowly, so rows can share an array), or the same one when nothing needs to change.
export const refitSubs = (
	sub: readonly number[],
	r: RatingsLike,
	flex?: readonly number[],
): readonly number[] => {
	let out: number[] | undefined;
	for (const group of SUB_GROUPS) {
		const target = r[group.base];
		if (typeof target !== "number" || baseFromGroup(sub, group) === target) {
			continue;
		}
		out ??= [...sub];
		const xs = group.idx.map((i) => sub[i]!);
		const fs = flex ? group.idx.map((i) => flex[i]!) : undefined;
		const fitted = fitGroup(xs, group.w, target, fs);
		group.idx.forEach((i, j) => {
			out![i] = fitted[j]!;
		});
	}
	return out ?? sub;
};

// An edit of the subs (Customize Player): set the bases from the subs. Returns the bases that changed.
export const setBasesFromSubs = (r: RatingsLike) => {
	const changed: SubBase[] = [];
	if (!isValidSubArray(r.sub)) {
		return changed;
	}
	for (const group of SUB_GROUPS) {
		const b = baseFromGroup(r.sub, group);
		if (r[group.base] !== b) {
			r[group.base] = b;
			changed.push(group.base);
		}
	}
	return changed;
};

// Expanded ratings (when a row has them): the sub-ratings that correspond to an expanded rating follow it, so the two never disagree.
// oreb/dreb are the two rebounding subs; pdef/idef the perimeter (perimeter D 60%, steals 40%) and interior (interior D 60%, blocks 40%)
// sides of defense; csh - dsh the catch-and-shoot lean of the jump shooting subs; bsc the ball security sub. Returns wanted values (real),
// to be fitted to the bases, and flex (anchored subs move less in the fit).
export const PERIM_SIDE = [
	[SUB_INDEX.pdf!, 0.6],
	[SUB_INDEX.stl!, 0.4],
] as const;
export const INTERIOR_SIDE = [
	[SUB_INDEX.idf!, 0.6],
	[SUB_INDEX.blk!, 0.4],
] as const;
const sideLevel = (x: readonly number[], side: typeof PERIM_SIDE) =>
	side.reduce((s, [i, w]) => s + w * x[i]!, 0);

const I = SUB_INDEX as Record<string, number>;

// Catch-and-shoot minus off-the-dribble lean of the jump shooting subs
export const jumperLean = (x: readonly number[]) =>
	(x[I.tcs!]! + x[I.spu!]!) / 2 - (x[I.tod!]! + x[I.pul!]!) / 2;

export const anchorToExpanded = (
	x: number[],
	r: RatingsLike,
	flex: number[],
) => {
	if (typeof r.oreb === "number" && typeof r.dreb === "number") {
		x[I.orb!] = r.oreb;
		x[I.drd!] = r.dreb;
	}
	if (typeof r.pdef === "number" && typeof r.idef === "number") {
		const dp = r.pdef - sideLevel(x, PERIM_SIDE);
		const di = r.idef - sideLevel(x, INTERIOR_SIDE);
		for (const [i] of PERIM_SIDE) {
			x[i] = x[i]! + dp;
		}
		for (const [i] of INTERIOR_SIDE) {
			x[i] = x[i]! + di;
		}
	}
	if (typeof r.csh === "number" && typeof r.dsh === "number") {
		const d = (r.csh - r.dsh - jumperLean(x)) / 2;
		x[I.tcs!]! += d;
		x[I.spu!]! += d;
		x[I.tod!]! -= d;
		x[I.pul!]! -= d;
	}
	if (typeof r.bsc === "number") {
		x[I.sec!] = r.bsc;
		flex[I.sec!] = 0.25;
	}
};

// How far the subs are from the expanded ratings they correspond to (0 when the row has none)
export const anchorError = (x: readonly number[], r: RatingsLike) => {
	let e = 0;
	if (typeof r.oreb === "number" && typeof r.dreb === "number") {
		e = Math.max(
			e,
			Math.abs(x[I.orb!]! - r.oreb),
			Math.abs(x[I.drd!]! - r.dreb),
		);
	}
	if (typeof r.pdef === "number" && typeof r.idef === "number") {
		e = Math.max(
			e,
			Math.abs(sideLevel(x, PERIM_SIDE) - r.pdef),
			Math.abs(sideLevel(x, INTERIOR_SIDE) - r.idef),
		);
	}
	if (typeof r.csh === "number" && typeof r.dsh === "number") {
		e = Math.max(e, Math.abs(jumperLean(x) - (r.csh - r.dsh)));
	}
	if (typeof r.bsc === "number") {
		e = Math.max(e, Math.abs(x[I.sec!]! - r.bsc));
	}
	return e;
};

// The expanded ratings implied by the subs (an edit of the subs in Customize Player moves them): the wanted splits and ball security.
export const expandedFromSubs = (sub: readonly number[]) => ({
	defenseSplit: sideLevel(sub, PERIM_SIDE) - sideLevel(sub, INTERIOR_SIDE),
	reboundSplit: sub[I.orb!]! - sub[I.drd!]!,
	shootingSplit: jumperLean(sub),
	bsc: sub[I.sec!]!,
});

// The subs of each base in display order, for the UI
export const subsOfBase = (base: string) =>
	hasSubs(base)
		? subGroupOf(base).idx.map((i) => ({ i, def: SUB_DEFS[i]! }))
		: [];

// Column keys for tables: "sub:blk", ...
export const SUB_COL_KEYS = SUB_DEFS.map((d) => `sub:${d.key}`);

// The sub-ratings of a row in base order (for tables): diq's, tp's, ...
export const SUB_TABLE_ORDER: readonly number[] = SUB_GROUPS.flatMap(
	(g) => g.idx,
);

const toInt = (x: unknown) => {
	const v = Number.parseInt(String(x));
	return Number.isNaN(v) ? undefined : v > 100 ? 100 : v < 0 ? 0 : v;
};

// Customize Player: one sub-rating was edited (value as typed). Returns the new row: the sub set, its base recomputed from the subs, and
// the expanded ratings that correspond to the subs (when the row has them) moved to agree. A value that isn't a number yet is kept as
// typed and nothing is recomputed.
export const applySubEdit = (
	row: RatingsLike,
	i: number,
	value: unknown,
): RatingsLike => {
	const sub: unknown[] = [...(row.sub as unknown[])];
	sub[i] = value;
	const out: RatingsLike = { ...row, sub };
	const ints = sub.map(toInt);
	if (ints.some((x) => x === undefined)) {
		return out;
	}
	const s = ints as number[];
	const def = SUB_DEFS[i]!;
	const group = subGroupOf(def.base);
	out[def.base] = baseFromGroup(s, group);
	const ex = expandedFromSubs(s);
	if (def.base === "diq" && typeof out.pdef === "number") {
		const diq = out.diq as number;
		const pdef = clamp100(diq + Math.round(ex.defenseSplit / 2));
		out.pdef = pdef;
		out.idef = clamp100(2 * diq - pdef);
	} else if (def.base === "reb" && typeof out.oreb === "number") {
		out.oreb = s[I.orb!];
		out.dreb = s[I.drd!];
	} else if (
		(def.base === "tp" || def.base === "fg") &&
		typeof out.csh === "number"
	) {
		const sum = Number(out.fg) + Number(out.tp);
		const split = Math.round(ex.shootingSplit);
		let a = Math.round((sum + split) / 2);
		a = Math.min(100, Math.max(0, a, sum - 100));
		out.csh = a;
		out.dsh = sum - a;
	} else if (def.base === "drb" && typeof out.bsc === "number") {
		out.bsc = s[I.sec!];
	}
	return out;
};

// Customize Player: a base rating with sub-ratings was edited. Its subs move with it, keeping their shape.
export const applyBaseEditToSubs = (row: RatingsLike, base: string) => {
	if (!hasSubs(base) || !Array.isArray(row.sub)) {
		return row;
	}
	const target = toInt(row[base]);
	const ints = (row.sub as unknown[]).map(toInt);
	if (target === undefined || ints.some((x) => x === undefined)) {
		return row;
	}
	return {
		...row,
		sub: refitSubs(ints as number[], { ...row, [base]: target }),
	};
};

// Parse the subs of a form row: a valid int array, or undefined
export const parseSubs = (sub: unknown): number[] | undefined => {
	if (!Array.isArray(sub) || sub.length !== NUM_SUBS) {
		return undefined;
	}
	const ints = sub.map(toInt);
	return ints.some((x) => x === undefined) ? undefined : (ints as number[]);
};

// His standout and weakest sub-rating relative to its base (Draft Scouting): what his shape says about him
export const subHighlights = (sub: readonly number[], r: RatingsLike) => {
	let best = -1;
	let worst = -1;
	let bestOff = -Infinity;
	let worstOff = Infinity;
	for (let i = 0; i < NUM_SUBS; i++) {
		const base = r[SUB_DEFS[i]!.base];
		if (typeof base !== "number") {
			continue;
		}
		const off = sub[i]! - base;
		if (off > bestOff) {
			bestOff = off;
			best = i;
		}
		if (off < worstOff) {
			worstOff = off;
			worst = i;
		}
	}
	if (best < 0 || worst < 0) {
		return undefined;
	}
	const out = (i: number, off: number) => ({
		key: SUB_DEFS[i]!.key,
		name: SUB_DEFS[i]!.name,
		value: sub[i]!,
		off: Math.round(off),
	});
	return { best: out(best, bestOff), worst: out(worst, worstOff) };
};
