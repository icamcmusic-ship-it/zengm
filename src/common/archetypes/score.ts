import { DIMS, skillsOf } from "./composites.ts";
import { zVector } from "./norms.ts";
import type {
	Archetype,
	ArchetypeRatings,
	DimKey,
	Norms,
	SkillLabel,
} from "./types.ts";

// Profile weights are in units of 0.55 standard deviations
const TARGET_SCALE = 0.55;
// Dimensions an archetype does not mention are expected to be ordinary, with this much weight
const BASE_IMPORTANCE = 0.3;
const HGT_SOFT = 5;
const MISSING_REQ = 0.6;
const BONUS = 0.04;
const OVERSHOOT = 0.3;
// Size-driven skills are read partly in absolute terms: a seven-footer who blocks everything is a rim protector even if
// every seven-footer blocks shots
const ABS_MIX: Partial<Record<DimKey, number>> = {
	blk: 0.4,
	dint: 0.4,
	reb: 0.3,
	rim: 0.25,
	post: 0.25,
};

export const gateFactor = (
	hgt: number,
	[lo, hi]: [number, number],
	soft = HGT_SOFT,
) => {
	const d = hgt < lo ? lo - hgt : hgt > hi ? hgt - hi : 0;
	return Math.exp(-((d / soft) ** 2));
};

// Level gate (his overall level, the mean of his size-adjusted skills, in z): softer than the height gate
const LEVEL_SOFT = 0.3;
// Outside the level gate the fit z is cut too (a table can be mostly near zero, which would read a miss as ordinary)
// A level gate below the league's (raw prospects, journeymen), as opposed to a star's gate above it
export const isLowLevel = (a: Archetype) =>
	a.level !== undefined && a.level[1] <= 0;

export const levelPenalty = (a: Archetype, level: number) =>
	a.level ? 3 * (1 - gateFactor(level, a.level, LEVEL_SOFT)) : 0;

// A label's defining skills must actually be there, not just be his relative best. Every dimension an archetype weights at
// NEED_W or more is defining: he must be at least ordinary at it for his size (sz) and above his own norm (z), and the
// explicit `need` floors are on the league-wide (absolute) z. Each z of shortfall costs NEED_K in fit z, plus NEED_STEP once.
export const NEED_W = 2;
export const NEED_K = 4;
export const NEED_STEP = 0.1;
// Dimensions whose weight describes a style, not a skill, so they are never gates
const NOT_A_SKILL = new Set<DimKey>(["usg", "end", "hgt"]);

export type Prepared = {
	z: Record<DimKey, number>;
	sz: Record<DimKey, number>;
	abs: Record<DimKey, number>;
	level: number;
	skills: SkillLabel[];
	hgt: number;
	// His age, when known
	age?: number;
};

// A player well below the league's level (a prospect) is held to lower absolute floors: a promising shooter for a 19 year
// old is still a shooter
const LEVEL_SLACK = 0.5;
const LEVEL_SLACK_FROM = -0.6;
// ... but only a young one (or one read as a veteran): a 30 year old journeyman's 45 three-point rating is not a promising
// stroke. Full slack to 23, none from 27 (unknown age: full, as for draft prospects and regeneration targets)
const youthOf = (age: number | undefined) =>
	age === undefined ? 1 : Math.min(1, Math.max(0, (27 - age) / 4));

// The per-archetype part of needShortfall (hot: every archetype for every player), computed once per archetype object.
// Same terms in the same order, so the same results.
type NeedTerms = {
	low: boolean;
	defining: { dim: DimKey; w: number }[];
	need: [DimKey, number][];
	needFor: [DimKey, number][];
};
const needTermsCache = new WeakMap<Archetype, NeedTerms>();
const getNeedTerms = (a: Archetype) => {
	let cached = needTermsCache.get(a);
	if (!cached) {
		const defining: NeedTerms["defining"] = [];
		for (const dim of DIMS) {
			const w = a.w[dim];
			if (w === undefined || w < NEED_W || NOT_A_SKILL.has(dim)) {
				continue;
			}
			defining.push({ dim, w });
		}
		cached = {
			low: isLowLevel(a),
			defining,
			need: Object.entries(a.need ?? {}) as [DimKey, number][],
			needFor: Object.entries(a.needFor ?? {}) as [DimKey, number][],
		};
		needTermsCache.set(a, cached);
	}
	return cached;
};

export const needShortfall = (a: Archetype, p: Prepared, strict = false) => {
	const { low, defining, need, needFor } = getNeedTerms(a);
	let short = 0;
	const slack =
		low || strict
			? 0
			: LEVEL_SLACK *
				Math.max(0, LEVEL_SLACK_FROM - p.level) *
				// A veteran label is read against his decline: the slack holds whatever his age
				(a.age && a.age[0] >= 30 ? 1 : youthOf(p.age));
	for (const { dim, w } of defining) {
		short += Math.max(0, 0.1 * w - 0.1 - p.z[dim]);
		// A raw prospect is read against himself only: his skills are not there yet in league terms
		if (!low) {
			short += Math.max(0, 0.1 * (w - 2) - 0.05 - slack - p.sz[dim]);
		}
	}
	for (const [dim, floor] of need) {
		short += Math.max(0, floor - slack - p.abs[dim]);
	}
	for (const [dim, floor] of needFor) {
		short += Math.max(0, floor - slack - p.sz[dim]);
	}
	return short;
};

export const needPenaltyOf = (s: number) =>
	s > 0.02 ? NEED_STEP + NEED_K * s : NEED_K * s;

export const needPenalty = (a: Archetype, p: Prepared) =>
	needPenaltyOf(needShortfall(a, p));

// The per-archetype part of rawMatch (hot: every archetype for every player), computed once per archetype object. Same
// terms in the same order, so the same results.
type MatchTerm = {
	dim: DimKey;
	imp: number;
	target: number;
	w: number | undefined;
};
const matchTermsCache = new WeakMap<
	Archetype,
	{ terms: MatchTerm[]; den: number }
>();
const getMatchTerms = (a: Archetype) => {
	let cached = matchTermsCache.get(a);
	if (!cached) {
		const terms: MatchTerm[] = [];
		let den = 0;
		for (const dim of DIMS) {
			const w = a.w[dim];
			// Height is a gate, it only counts when the archetype names it
			if (dim === "hgt" && w === undefined) {
				continue;
			}
			const imp = BASE_IMPORTANCE + Math.abs(w ?? 0);
			terms.push({ dim, imp, target: (w ?? 0) * TARGET_SCALE, w });
			den += imp;
		}
		cached = { terms, den };
		matchTermsCache.set(a, cached);
	}
	return cached;
};

// How well one player's ratings fit one archetype's profile, 0..1. Absolute: not yet read against the league.
export const rawMatch = (
	a: Archetype,
	z: Record<DimKey, number>,
	hgt: number,
	skills: SkillLabel[],
	level = 0,
) => {
	const { terms, den } = getMatchTerms(a);
	let num = 0;
	for (const { dim, imp, target, w } of terms) {
		// Being even better than the profile asks at a skill it wants (or even lower where it wants low) costs little: an
		// elite shooter is still a shooter
		const over = w !== undefined && w !== 0 && (z[dim] - target) * w > 0;
		num += imp * (over ? OVERSHOOT : 1) * (z[dim] - target) ** 2;
	}
	let score = (1 / (1 + num / den)) * gateFactor(hgt, a.hgt);
	if (a.level) {
		score *= gateFactor(level, a.level, LEVEL_SOFT);
	}
	for (const s of a.req ?? []) {
		if (!skills.includes(s)) {
			score *= MISSING_REQ;
		}
	}
	for (const s of a.bonus ?? []) {
		if (skills.includes(s)) {
			score *= 1 + BONUS;
		}
	}
	return score;
};

// Standout skills: a label should name what stands out about him. His skills are grouped into the classes a label can
// promise (a shooter, a rim protector, ...), his top classes by skill for his size are his standouts, and an archetype
// whose profile features them (weight >= 2 in full, >= 1.5 half) is preferred over one that leaves them out.
export const SKILL_CLASSES: Record<string, DimKey[]> = {
	shoot: ["three"],
	mid: ["mid"],
	finish: ["rim", "draw"],
	post: ["post"],
	handle: ["drb"],
	pass: ["pss"],
	reb: ["reb"],
	rimD: ["blk", "dint"],
	perD: ["dper", "stl"],
	ath: ["ath", "spd", "jmp"],
};
const CLASS_OF = new Map<DimKey, string>();
for (const [k, dims] of Object.entries(SKILL_CLASSES)) {
	for (const d of dims) {
		CLASS_OF.set(d, k);
	}
}
// How fully an archetype's profile features each skill class
const coverCache = new WeakMap<Archetype, Record<string, number>>();
export const coverOf = (a: Archetype) => {
	let c = coverCache.get(a);
	if (!c) {
		c = {};
		for (const [dim, w] of Object.entries(a.w) as [DimKey, number][]) {
			const k = CLASS_OF.get(dim);
			if (k) {
				c[k] = Math.max(c[k] ?? 0, w >= 2 ? 1 : w >= 1.5 ? 0.5 : 0);
			}
		}
		coverCache.set(a, c);
	}
	return c;
};
export type Standout = { k: string; s: number };
const STANDOUT_ABS: Partial<Record<DimKey, number>> = { blk: 0.4, dint: 0.4 };
// How much each class stands out: how far he is above STANDOUT_FROM for his size (capped), faded out for classes well
// below his own best. Continuous in his ratings, so a small change does not swap his standouts outright.
const STANDOUT_FROM = 0.9;
const STANDOUT_CAP = 1.2;
const STANDOUT_FADE = 1.2;
const STANDOUT_LIFT = 0.7;
const DEF_IQ_ROOM = 1;
// His level at each skill class, for his size: the best of its dimensions, read partly against himself when he is well
// below the league's level (a raw prospect, a journeyman: his best skills stand out among players like him)
export const classValues = (p: Prepared): Record<string, number> => {
	const lift = STANDOUT_LIFT * Math.max(0, -p.level);
	const vals: Record<string, number> = {};
	for (const [k, dims] of Object.entries(SKILL_CLASSES)) {
		let v = -Infinity;
		for (const d of dims) {
			// Rim protection partly in absolute terms (as for the profile); rebounding, finishing and post play for his size
			v = Math.max(v, p.sz[d] + (STANDOUT_ABS[d] ?? 0) * (p.abs[d] - p.sz[d]));
		}
		// Perimeter and interior defense need the instincts too: speed or size alone is not a standout defender
		if (k === "perD" || k === "rimD") {
			v = Math.min(v, p.sz.diq + DEF_IQ_ROOM);
		}
		vals[k] = v + lift;
	}
	return vals;
};

export const standoutsOf = (
	p: Prepared,
	cv: Record<string, number> = classValues(p),
): Standout[] => {
	const vals = Object.entries(cv);
	const top = Math.max(...vals.map(([, v]) => v));
	const out: Standout[] = [];
	for (const [k, v] of vals) {
		const s =
			Math.min(STANDOUT_CAP, Math.max(0, v - STANDOUT_FROM)) *
			Math.min(1, Math.max(0, (v - (top - STANDOUT_FADE)) / 0.5));
		if (s > 0) {
			out.push({ k, s });
		}
	}
	out.sort((x, y) => (y.s !== x.s ? y.s - x.s : x.k < y.k ? -1 : 1));
	// Many standouts (an all-around star) share the bonus: about two full standouts' worth in all
	const total = out.reduce((t, x) => t + x.s, 0);
	const norm = Math.max(1, total / (2 * STANDOUT_CAP));
	return out.map((x) => ({ k: x.k, s: x.s / norm }));
};
export const STANDOUT_K = 0.35;
const SHORTFALL_FADE = 0.02;
// Only a label he fully qualifies for gets it (no defining-skill shortfall, without the slack a raw prospect gets): it
// must not buy back a missing skill. Raw prospect, journeyman and veteran labels are about his stage, not a skill.
export const standoutBonus = (a: Archetype, st: Standout[], shortfall = 0) => {
	if (
		st.length === 0 ||
		shortfall >= SHORTFALL_FADE ||
		isLowLevel(a) ||
		a.age
	) {
		return 0;
	}
	const c = coverOf(a);
	let b = 0;
	for (const { k, s } of st) {
		b += s * (c[k] ?? 0);
	}
	return STANDOUT_K * b * (1 - shortfall / SHORTFALL_FADE);
};

// Fades a bonus out with any defining-skill shortfall (strict: without a prospect's slack); never for lifecycle labels
const qualifies = (a: Archetype, shortfall: number) =>
	shortfall >= SHORTFALL_FADE || isLowLevel(a) || a.age
		? 0
		: 1 - shortfall / SHORTFALL_FADE;

// A two-way player: his best skill on offense and his best on defense are both well above ordinary for his size. The
// standouts above are relative to his own best (a great scorer's good defense fades out), so the pair is read apart:
// a label that features both sides gets TWO_WAY_K per z of the weaker side.
// A big body (hgt rating): finishing is his size more than a skill, passing a rare one
const BIG_HGT = 55;
const TWO_WAY_OFF = ["shoot", "mid", "post", "handle", "pass", "finish"];
const TWO_WAY_DEF = ["perD", "rimD"];
const TWO_WAY_OFF_FROM = 0.5;
const TWO_WAY_DEF_FROM = 0.3;
export const TWO_WAY_K = 0.6;
export const twoWayBonus = (
	a: Archetype,
	cv: Record<string, number>,
	hgt: number,
	shortfall = 0,
) => {
	const q = qualifies(a, shortfall);
	if (q === 0) {
		return 0;
	}
	const c = coverOf(a);
	const side = (classes: string[], from: number) => {
		let best = 0;
		for (const k of classes) {
			// Finishing is a big man's size, not a skill on offense
			if (k === "finish" && hgt >= BIG_HGT) {
				continue;
			}
			best = Math.max(
				best,
				(c[k] ?? 0) * Math.min(1, Math.max(0, cv[k]! - from)),
			);
		}
		return best;
	};
	return (
		TWO_WAY_K *
		q *
		Math.min(
			side(TWO_WAY_OFF, TWO_WAY_OFF_FROM),
			side(TWO_WAY_DEF, TWO_WAY_DEF_FROM),
		)
	);
};

// Passing is rare for a big body: a big who passes well gets a label that says so (Point Center, Playmaking Big, ...)
const PASSING_BIG_FROM = 0.6;
export const PASSING_BIG_K = 0.4;
export const passingBigBonus = (
	a: Archetype,
	cv: Record<string, number>,
	hgt: number,
	shortfall = 0,
) => {
	if (hgt < BIG_HGT) {
		return 0;
	}
	return (
		PASSING_BIG_K *
		qualifies(a, shortfall) *
		(coverOf(a).pass ?? 0) *
		Math.min(1, Math.max(0, cv.pass! - PASSING_BIG_FROM))
	);
};

// A broad label pays for each standout skill of his it does not name
export const GENERIC_K = 0.35;
export const genericPenalty = (a: Archetype, st: Standout[]) => {
	if (st.length === 0 || !a.tags.includes("generic")) {
		return 0;
	}
	const c = coverOf(a);
	let t = 0;
	for (const { k, s } of st) {
		t += s * (1 - (c[k] ?? 0));
	}
	return GENERIC_K * t;
};

export const prepare = (ratings: ArchetypeRatings, norms: Norms): Prepared => {
	const v = zVector(ratings, norms);
	const z = { ...v.z };
	for (const [dim, m] of Object.entries(ABS_MIX) as [DimKey, number][]) {
		z[dim] += m * (v.abs[dim] - v.sz[dim]);
	}
	return {
		z,
		sz: v.sz,
		abs: v.abs,
		level: v.level,
		skills: skillsOf(ratings),
		hgt: ratings.hgt,
	};
};
