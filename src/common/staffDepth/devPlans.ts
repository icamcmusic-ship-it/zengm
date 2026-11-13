// Coaching Staff Depth: development plans. Each offseason the staff picks one focus per player from his weaknesses, position group and role;
// development then spends a small, bounded budget on it, as a shift within the yearly per-base development roll (no extra roll, no random
// numbers): the focus bases gain, every other rating gives up a little so the player's ovr is unchanged (stock ovr weights), and inside the
// focus bases the sub-ratings it targets gain at the expense of their siblings. Pure.
import {
	SUB_DEFS,
	SUB_GROUPS,
	SUB_INDEX,
	isValidSubArray,
} from "../subRatings.ts";
import type { FocusKey } from "./types.ts";

export type FocusDef = {
	key: FocusKey;
	name: string;
	// short description of what it works on
	what: string;
	// bases that gain (share of the budget)
	bases: Partial<Record<string, number>>;
	// sub-ratings targeted inside those bases
	subs: string[];
};

export const FOCUSES: Record<FocusKey, FocusDef> = {
	three: {
		key: "three",
		name: "Add a three",
		what: "range + catch-and-shoot",
		bases: { tp: 1 },
		subs: ["rng", "tcs"],
	},
	pullup: {
		key: "pullup",
		name: "Pull-up game",
		what: "pull-up jumper + off-the-dribble three",
		bases: { fg: 0.6, tp: 0.4 },
		subs: ["pul", "tod"],
	},
	finish: {
		key: "finish",
		name: "Finishing",
		what: "touch at the rim: finesse, floater, close shots",
		bases: { dnk: 0.5, ins: 0.5 },
		subs: ["fns", "flt", "cls"],
	},
	post: {
		key: "post",
		name: "Post game",
		what: "post moves + close shots",
		bases: { ins: 1 },
		subs: ["pst", "cls"],
	},
	handle: {
		key: "handle",
		name: "Ball handling",
		what: "handle + ball security",
		bases: { drb: 1 },
		subs: ["hnd", "sec"],
	},
	playmaking: {
		key: "playmaking",
		name: "Playmaking",
		what: "vision + passing accuracy",
		bases: { pss: 0.8, oiq: 0.2 },
		subs: ["vis", "acc"],
	},
	perimD: {
		key: "perimD",
		name: "Perimeter defense",
		what: "on-ball defense, steals, lateral quickness",
		bases: { diq: 0.8, spd: 0.2 },
		subs: ["pdf", "stl", "lat"],
	},
	rimD: {
		key: "rimD",
		name: "Rim protection",
		what: "shot blocking + interior defense",
		bases: { diq: 1 },
		subs: ["blk", "idf"],
	},
	glass: {
		key: "glass",
		name: "Rebounding",
		what: "offensive and defensive rebounding",
		bases: { reb: 1 },
		subs: ["orb", "drd"],
	},
	ft: {
		key: "ft",
		name: "Free throws",
		what: "free throw mechanics",
		bases: { ft: 1 },
		subs: [],
	},
};

export const FOCUS_KEYS = Object.keys(FOCUSES) as FocusKey[];

// The stock ovr formula's weights (player/ovr.basketball.ts), the yardstick that keeps a plan ovr-neutral
export const OVR_COEFS: Record<string, number> = {
	stre: 0.0777,
	spd: 0.123,
	jmp: 0.051,
	endu: 0.0632,
	ins: 0.0126,
	dnk: 0.0286,
	ft: 0.0202,
	tp: 0.0726,
	oiq: 0.133,
	diq: 0.159,
	drb: 0.059,
	pss: 0.062,
	fg: 0.01,
	reb: 0.01,
};

// Rating points a season at the full budget (a player 22 or younger with an average development coach)
export const PLAN_BUDGET = 1.2;
// Sub-rating points moved toward the focus subs inside their bases
export const PLAN_TILT = 1.5;

export const planAgeFactor = (age: number) =>
	age <= 22 ? 1 : age <= 25 ? 0.85 : age <= 29 ? 0.6 : 0.4;

// The development coach (his dev rating, or the vacancy rating) scales the budget: 0.75x for a poor one ... 1.25x for a great one
export const devCoachFactor = (devRating: number) =>
	0.75 + 0.5 * Math.max(0, Math.min(1, (devRating - 30) / 50));

/**
 * The rating deltas of a plan for one season: the focus bases share +budget, every other developed rating gives up the same amount of ovr
 * (spread evenly in rating points), so the stock ovr is unchanged.
 */
export const planRatingDeltas = (
	focus: FocusKey,
	age: number,
	devRating: number,
	// The player's own ovr weights (worker: the gradient of the league's ovr formula at his ratings, expanded ratings followed), and the
	// ovr change of the sub-rating tilt; default the stock formula's weights
	coefs: Record<string, number> = OVR_COEFS,
	extraGain = 0,
): Record<string, number> => {
	const def = FOCUSES[focus];
	const budget = PLAN_BUDGET * planAgeFactor(age) * devCoachFactor(devRating);
	const out: Record<string, number> = {};
	let gain = extraGain;
	for (const [key, share] of Object.entries(def.bases)) {
		out[key] = budget * share!;
		gain += (coefs[key] ?? 0) * out[key]!;
	}
	const others = Object.keys(OVR_COEFS).filter(
		(key) => !(key in out) && (coefs[key] ?? 0) > 0,
	);
	let coefSum = 0;
	for (const key of others) {
		coefSum += coefs[key]!;
	}
	const each = coefSum > 0 ? gain / coefSum : 0;
	for (const key of others) {
		out[key] = -each;
	}
	return out;
};

export const planTiltAmount = (age: number, devRating: number) =>
	PLAN_TILT * planAgeFactor(age) * devCoachFactor(devRating);

/**
 * Inside each base the focus touches, move `amount` sub points onto its focus subs, taken from the other subs of that base by weight, so
 * the base (their weighted average) doesn't move. Returns new wanted values (to be anchored and fitted to the bases by the caller).
 */
export const tiltSubs = (
	sub: readonly number[],
	focus: FocusKey,
	amount: number,
) => {
	const x = [...sub];
	if (!isValidSubArray(sub) || amount === 0) {
		return x;
	}
	const focusIdx = new Set(
		FOCUSES[focus].subs
			.map((key) => SUB_INDEX[key]!)
			.filter((i) => i !== undefined),
	);
	for (const group of SUB_GROUPS) {
		const inFocus = group.idx.filter((i) => focusIdx.has(i));
		const rest = group.idx.filter((i) => !focusIdx.has(i));
		if (inFocus.length === 0 || rest.length === 0) {
			continue;
		}
		let wFocus = 0;
		let wRest = 0;
		group.idx.forEach((i, j) => {
			if (focusIdx.has(i)) {
				wFocus += group.w[j]!;
			} else {
				wRest += group.w[j]!;
			}
		});
		for (const i of inFocus) {
			x[i] = x[i]! + amount;
		}
		const take = (amount * wFocus) / wRest;
		for (const i of rest) {
			x[i] = x[i]! - take;
		}
	}
	return x;
};

// The focus subs' average (for the report): the subs it targets, or the base itself when it has none (free throws)
export const focusLevel = (
	r: { sub?: number[] } & Record<string, any>,
	focus: FocusKey,
) => {
	const def = FOCUSES[focus];
	if (def.subs.length > 0 && isValidSubArray(r.sub)) {
		let sum = 0;
		for (const key of def.subs) {
			sum += r.sub[SUB_INDEX[key]!]!;
		}
		return sum / def.subs.length;
	}
	let sum = 0;
	let n = 0;
	for (const [key, share] of Object.entries(def.bases)) {
		sum += share! * (r[key] ?? 0);
		n += share!;
	}
	return n > 0 ? sum / n : 0;
};

export const focusSubNames = (focus: FocusKey) =>
	FOCUSES[focus].subs.map((key) => ({
		key,
		name: SUB_DEFS[SUB_INDEX[key]!]!.name,
	}));

type Group = "guard" | "wing" | "big";

export const groupOfPos = (pos: string): Group =>
	pos === "PG" || pos === "SG" || pos === "G"
		? "guard"
		: pos === "C" || pos === "FC" || pos === "PF"
			? "big"
			: "wing";

// What a role player at each position group should have, for the weakness gaps. Rotation players are held to these; stars to a bit more
const TARGETS: Record<Group, Partial<Record<FocusKey, number>>> = {
	guard: {
		three: 58,
		handle: 60,
		playmaking: 55,
		perimD: 50,
		pullup: 52,
		finish: 48,
		ft: 56,
	},
	wing: {
		three: 55,
		perimD: 52,
		finish: 55,
		handle: 48,
		glass: 50,
		ft: 50,
	},
	big: {
		rimD: 55,
		glass: 60,
		post: 52,
		finish: 50,
		three: 38,
		ft: 42,
	},
};

const ratingFor = (r: Record<string, number>, focus: FocusKey) => {
	const def = FOCUSES[focus];
	let sum = 0;
	let n = 0;
	for (const [key, share] of Object.entries(def.bases)) {
		sum += share! * (r[key] ?? 0);
		n += share!;
	}
	return n > 0 ? sum / n : 0;
};

/**
 * The staff's plan: the biggest gap between what his position group needs and what he has, in rating points. A slasher who can't shoot gets
 * "Add a three"; a big who can't rebound "Rebounding". The team-wide priority, when set and useful for him (any gap at all), counts 6 points
 * more; archetype-specific nudges: shooters keep building their strength (a small bonus for their best area). Ties broken by a seeded hash.
 */
export const chooseFocus = ({
	ratings,
	pos,
	age,
	teamPriority,
	hash,
}: {
	ratings: Record<string, number>;
	pos: string;
	age: number;
	teamPriority?: FocusKey;
	// 0-1, stable per player and season
	hash: number;
}): FocusKey => {
	const group = groupOfPos(pos);
	const targets = TARGETS[group];
	let best: FocusKey = group === "big" ? "glass" : "three";
	let bestScore = -Infinity;
	for (const key of FOCUS_KEYS) {
		const target = targets[key];
		if (target === undefined && key !== teamPriority) {
			continue;
		}
		const have = ratingFor(ratings, key);
		// Only bigs with some touch work on a three (a stretch big), not a center who never shoots it
		if (
			group === "big" &&
			key === "three" &&
			have < 30 &&
			key !== teamPriority
		) {
			continue;
		}
		let score = (target ?? have) - have;
		// Older players polish (free throws, shooting), younger ones build
		if (age >= 30 && (key === "ft" || key === "three")) {
			score += 3;
		}
		if (key === teamPriority) {
			score += 6;
		}
		score += 1.5 * ((hash * (FOCUS_KEYS.indexOf(key) + 3)) % 1);
		if (score > bestScore) {
			bestScore = score;
			best = key;
		}
	}
	return best;
};
