import { DIMS, skillsOf, STYLE_DIMS } from "./composites.ts";
import { zVector } from "./norms.ts";
import { STATS_W, type StatReading } from "./stats.ts";
import { conceptsOf } from "./twoK/concepts.ts";
import type {
	Archetype,
	ArchetypeRatings,
	DimKey,
	Norms,
	Pos,
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

// A label's defining skills must actually be there, not just be his relative best. Every dimension an archetype weights at
// NEED_W or more is defining: he must be at least ordinary at it for his size (sz) and above his own norm (z), and the
// explicit `need` floors are on the league-wide (absolute) z. Each z of shortfall costs NEED_K in fit z, plus NEED_STEP once.
export const NEED_W = 2;
export const NEED_K = 6;
export const NEED_STEP = 0.1;
// Dimensions whose weight describes a style or his body, not a skill, so they are never gates
const NOT_A_SKILL = new Set<DimKey>([
	"usg",
	"end",
	"hgt",
	"len",
	"cs",
	"orl",
	"sec",
]);

export type Prepared = {
	z: Record<DimKey, number>;
	sz: Record<DimKey, number>;
	abs: Record<DimKey, number>;
	// The blended reading (BLEND_W absolute standing at his position, the rest the shape of his game, plus his stats): what
	// stands out about him and whether he has what a build's name promises
	b: Record<DimKey, number>;
	// The same before his stats are blended in, and his stats (score.ts classValues blends them per skill class)
	br: Record<DimKey, number>;
	stats?: StatReading;
	skills: SkillLabel[];
	hgt: number;
	// His absolute standing among players at his position (not relative to his level) and its mean over his core skills
	pz: Record<DimKey, number>;
	pzLevel: number;
	// He has expanded ratings: perimeter/interior defense are ratings of their own and his length is known
	expanded: boolean;
};

// The per-archetype part of needShortfall (hot: every archetype for every player), computed once per archetype object.
// Same terms in the same order, so the same results.
// The profile weights in force: `w`, or with expanded ratings `w` with `xw` on top (and without his defensive IQ when
// `xw` names a side of the floor)
const weightsCache = new WeakMap<Archetype, Archetype["w"]>();
export const weightsOf = (a: Archetype, expanded: boolean): Archetype["w"] => {
	if (!expanded || !a.xw) {
		return a.w;
	}
	let w = weightsCache.get(a);
	if (!w) {
		w = { ...a.w, ...a.xw };
		if (a.xw.pdef !== undefined || a.xw.idef !== undefined) {
			delete w.diq;
		}
		weightsCache.set(a, w);
	}
	return w;
};

type NeedTerms = {
	defining: { dim: DimKey; w: number }[];
	need: [DimKey, number][];
	cap: [DimKey, number][];
	needFor: [DimKey, number][];
};
const needTermsCache = new WeakMap<Archetype, NeedTerms>();
const needTermsCacheExpanded = new WeakMap<Archetype, NeedTerms>();
const getNeedTerms = (a: Archetype, expanded: boolean) => {
	const cache = expanded && a.xw ? needTermsCacheExpanded : needTermsCache;
	let cached = cache.get(a);
	if (!cached) {
		const weights = weightsOf(a, expanded);
		const defining: NeedTerms["defining"] = [];
		for (const dim of DIMS) {
			const w = weights[dim];
			if (w === undefined || w < NEED_W || NOT_A_SKILL.has(dim)) {
				continue;
			}
			defining.push({ dim, w });
		}
		cached = {
			defining,
			need: Object.entries(a.need ?? {}) as [DimKey, number][],
			cap: Object.entries(a.cap ?? {}) as [DimKey, number][],
			needFor: Object.entries(a.needFor ?? {}) as [DimKey, number][],
		};
		cache.set(a, cached);
	}
	return cached;
};

// The floors are on the blended reading (score.ts BLEND_W): mostly the shape of his game, partly his absolute standing at
// his position, so a build's requirements move with his overall (a star needs more of a skill than a scrub to be named
// for it, but far less than in absolute terms)
export const needShortfall = (a: Archetype, p: Prepared) => {
	const { defining, need, cap, needFor } = getNeedTerms(a, p.expanded);
	let short = 0;
	for (const { dim, w } of defining) {
		short += Math.max(0, 0.1 * w - 0.1 - p.b[dim]);
		short += Math.max(0, 0.1 * (w - 2) - 0.05 - p.b[dim]);
	}
	for (const [dim, floor] of need) {
		if (STYLE_DIMS.has(dim)) {
			// Length and the styles are only known with expanded ratings
			if (p.expanded) {
				short += Math.max(0, floor - p.abs[dim]);
			}
			continue;
		}
		short += Math.max(0, floor - p.b[dim]);
	}
	// (ceilings are on the blended reading too: what the name says he lacks must not stand out about him)
	for (const [dim, ceiling] of cap) {
		if (!STYLE_DIMS.has(dim) || p.expanded) {
			short += Math.max(0, p.b[dim] - ceiling);
		}
	}
	for (const [dim, floor] of needFor) {
		short += Math.max(0, floor - p.b[dim]);
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
type MatchTerms = { terms: MatchTerm[]; den: number };
const matchTermsCache = new WeakMap<Archetype, [MatchTerms, MatchTerms]>();
const buildMatchTerms = (a: Archetype, expanded: boolean): MatchTerms => {
	const terms: MatchTerm[] = [];
	let den = 0;
	// A label keyed on perimeter or interior defense reads that rating in place of his defensive IQ (which is the same
	// number without expanded ratings, and their average with them)
	const weights = weightsOf(a, expanded);
	const sided = weights.pdef !== undefined || weights.idef !== undefined;
	for (const dim of DIMS) {
		const w = weights[dim];
		if (w === undefined) {
			// Height is a gate, it only counts when the archetype names it. So do the two defense ratings and length
			if (
				dim === "hgt" ||
				dim === "pdef" ||
				dim === "idef" ||
				STYLE_DIMS.has(dim) ||
				(dim === "diq" && sided)
			) {
				continue;
			}
		} else if (STYLE_DIMS.has(dim) && !expanded) {
			// Length is only known with expanded ratings
			continue;
		}
		const imp = BASE_IMPORTANCE + Math.abs(w ?? 0);
		terms.push({ dim, imp, target: (w ?? 0) * TARGET_SCALE, w });
		den += imp;
	}
	return { terms, den };
};
const getMatchTerms = (a: Archetype, expanded: boolean) => {
	let cached = matchTermsCache.get(a);
	if (!cached) {
		cached = [buildMatchTerms(a, false), buildMatchTerms(a, true)];
		matchTermsCache.set(a, cached);
	}
	return cached[expanded ? 1 : 0];
};

// How well one player's ratings fit one archetype's profile, 0..1. Absolute: not yet read against the league.
export const rawMatch = (
	a: Archetype,
	z: Record<DimKey, number>,
	hgt: number,
	skills: SkillLabel[],
	// He has expanded ratings (see Prepared)
	expanded = false,
) => {
	const { terms, den } = getMatchTerms(a, expanded);
	let num = 0;
	for (const { dim, imp, target, w } of terms) {
		// Being even better than the profile asks at a skill it wants (or even lower where it wants low) costs little: an
		// elite shooter is still a shooter
		const over = w !== undefined && w !== 0 && (z[dim] - target) * w > 0;
		num += imp * (over ? OVERSHOOT : 1) * (z[dim] - target) ** 2;
	}
	let score = (1 / (1 + num / den)) * gateFactor(hgt, a.hgt);
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
	finish: ["fin", "rim", "draw"],
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
// How much each class stands out: how far he is above STANDOUT_FROM for his size (capped), faded out for classes well
// below his own best. Continuous in his ratings, so a small change does not swap his standouts outright.
const STANDOUT_FROM = 0.9;
const STANDOUT_CAP = 1.2;
const STANDOUT_FADE = 1.2;
const DEF_IQ_ROOM = 1;
const SCORE_FINISH_DISCOUNT = 0.3;
// How far each skill class stands out for him, on the blended reading (his shape, his absolute standing at his position
// and his stats): the best of its dimensions
export const classValues = (p: Prepared): Record<string, number> => {
	const vals: Record<string, number> = {};
	for (const [k, dims] of Object.entries(SKILL_CLASSES)) {
		let v = -Infinity;
		// What his stats say about the class (the best of its dimensions they speak to)
		let sv = -Infinity;
		for (const d of dims) {
			v = Math.max(v, p.br[d]);
		}
		// (his defensive box plus/minus, read as his defensive IQ, speaks to either side of the floor)
		for (const d of k === "perD" || k === "rimD"
			? [...dims, "diq" as const]
			: dims) {
			const x = p.stats?.z[d];
			if (x !== undefined) {
				sv = Math.max(sv, x);
			}
		}
		// Perimeter and interior defense need the instincts too: speed or size alone is not a standout defender. With
		// expanded ratings that is the rating for that side of the floor (without them both are his defensive IQ)
		if (k === "perD") {
			v = Math.min(v, p.b.pdef + DEF_IQ_ROOM);
			// ... and the rating is the skill itself: a slow-footed stopper is still a stopper
			if (p.expanded) {
				v = Math.max(v, p.b.pdef);
			}
		} else if (k === "rimD") {
			v = Math.min(v, p.b.idef + DEF_IQ_ROOM);
			// (for a big body: a guard's interior defense is not what a label names)
			if (p.expanded && p.hgt >= BIG_HGT) {
				v = Math.max(v, p.b.idef);
			}
		}
		// His stats after the ratings' checks: blocking shots or getting steals is the real thing, whatever his IQ rating
		const sw = p.stats
			? statWeightFor(
					k === "pass" ? "pss" : k === "rimD" ? "blk" : "usg",
					p.stats,
				)
			: 0;
		vals[k] = p.stats && sv > -Infinity ? (1 - sw) * v + sw * sv : v;
	}
	// Not skill classes a label is built on, but things a name can promise: his strength, and his defense on either side
	vals.stre = p.br.stre;
	vals.def = Math.max(vals.perD!, vals.rimD!, p.b.diq);
	// ... and scoring of any kind, for a name that promises a scorer ("Bucket Getter", "Versatile Scorer"): a shot, a post
	// game, or (less) finishing
	vals.score = Math.max(
		vals.shoot!,
		vals.mid!,
		vals.post!,
		vals.finish! - SCORE_FINISH_DISCOUNT,
	);
	return vals;
};

export const standoutsOf = (
	p: Prepared,
	cv: Record<string, number> = classValues(p),
): Standout[] => {
	const vals = Object.entries(cv).filter(([k]) => SKILL_CLASSES[k]);
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
// Only a label he fully qualifies for gets it (no defining-skill shortfall): it must not buy back a missing skill
export const standoutBonus = (a: Archetype, st: Standout[], shortfall = 0) => {
	if (st.length === 0 || shortfall >= SHORTFALL_FADE) {
		return 0;
	}
	const c = coverOf(a);
	let b = 0;
	for (const { k, s } of st) {
		b += s * (c[k] ?? 0);
	}
	return STANDOUT_K * b * (1 - shortfall / SHORTFALL_FADE);
};

// Fades a bonus out with any defining-skill shortfall
const qualifies = (shortfall: number) =>
	shortfall >= SHORTFALL_FADE ? 0 : 1 - shortfall / SHORTFALL_FADE;

// A big body (hgt rating): finishing is his size more than a skill, passing a rare one
const BIG_HGT = 55;

// A two-way player: his best skill on offense and his best on defense are both well above ordinary for his size. The
// standouts above are relative to his own best (a great scorer's good defense fades out), so the pair is read apart:
// a label that features both sides gets TWO_WAY_K per z of the weaker side.
const TWO_WAY_OFF = ["shoot", "mid", "post", "handle", "pass", "finish"];
const TWO_WAY_DEF = ["perD", "rimD"];
const TWO_WAY_OFF_FROM = 0.5;
const TWO_WAY_DEF_FROM = 0.3;
export const TWO_WAY_K = 0.6;
// With expanded ratings his defense is a rating of its own for each side of the floor, not something read off his speed
// or size: a defensive standout is the real thing, and the label that names both sides of his game wins by more
export const TWO_WAY_K_EXPANDED = 0.6;
export const twoWayBonus = (
	a: Archetype,
	cv: Record<string, number>,
	hgt: number,
	shortfall = 0,
	expanded = false,
) => {
	const q = qualifies(shortfall);
	if (q === 0) {
		return 0;
	}
	const s = twoWaySides(cv, hgt, a);
	return (
		(expanded ? TWO_WAY_K_EXPANDED : TWO_WAY_K) * q * Math.min(s.off, s.def)
	);
};

// How strong each side of his game is, 0..1 (his best class on that side), as far as a label features it (or outright)
export const twoWaySides = (
	cv: Record<string, number>,
	hgt: number,
	a?: Archetype,
) => {
	const c = a ? coverOf(a) : undefined;
	const side = (classes: string[], from: number) => {
		let best = 0;
		for (const k of classes) {
			// Finishing is a big man's size, not a skill on offense
			if (k === "finish" && hgt >= BIG_HGT) {
				continue;
			}
			best = Math.max(
				best,
				(c ? (c[k] ?? 0) : 1) * Math.min(1, Math.max(0, cv[k]! - from)),
			);
		}
		return best;
	};
	return {
		off: side(TWO_WAY_OFF, TWO_WAY_OFF_FROM),
		def: side(TWO_WAY_DEF, TWO_WAY_DEF_FROM),
	};
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
		qualifies(shortfall) *
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

// How a player is read beyond his ratings: his position (for the absolute reading), his age (lost athleticism), his stats
// and whether he is a draft prospect (prospect tables)
export type ReadOptions = {
	pos?: Pos;
	age?: number;
	stats?: StatReading;
	prospect?: boolean;
};

// Each skill is read BLEND_W on his absolute standing among players at his position and the rest on the shape of his own
// game (relative to his level): an elite absolute skill (a point guard's three, a center's rebounding) stands out even
// for an all-around star, while the build still mostly ignores how good he is overall
export const BLEND_W = 0.25;
// How much of that absolute standing (re-centred on his own level at his position: shape against his position's peers
// rather than against his size) the profile match itself reads
export const MATCH_ABS_W = 0.2;

// Aging: from AGE_FROM, speed, jumping and endurance lost to age are discounted (AGE_STEP a year, at most AGE_MAX), so
// a veteran keeps the build his skills still say he is
export const AGE_FROM = 30;
export const AGE_STEP = 2.5;
export const AGE_MAX = 12;
const AGE_KEYS = ["spd", "jmp", "endu"] as const;
// (never above this, or his own value if higher: it gives back what age took, it does not make him an athlete)
const AGE_CAP = 65;
export const ageAdjusted = (
	ratings: ArchetypeRatings,
	age: number | undefined,
): ArchetypeRatings => {
	if (age === undefined || age <= AGE_FROM) {
		return ratings;
	}
	const add = Math.min(AGE_MAX, AGE_STEP * (age - AGE_FROM));
	const out = { ...ratings };
	for (const k of AGE_KEYS) {
		out[k] = Math.max(ratings[k], Math.min(ratings[k] + add, AGE_CAP));
	}
	return out;
};

// Some stats say more about a skill than its rating does: his assist rate is what a playmaker is, his block rate what a rim
// protector is. Their weight is STAT_BOOST times the stats' share (at most STAT_BOOST_MAX).
export const STAT_BOOST: Partial<Record<DimKey, number>> = { pss: 2, blk: 1.6 };
const STAT_BOOST_MAX = 0.6;
export const statWeightFor = (dim: DimKey, st: StatReading) =>
	Math.min(STAT_BOOST_MAX, st.w * (STAT_BOOST[dim] ?? 1));

export const prepare = (
	ratingsIn: ArchetypeRatings,
	norms: Norms,
	opts: ReadOptions = {},
): Prepared => {
	const ratings = ageAdjusted(ratingsIn, opts.age);
	const reading = opts.prospect && norms.prospect ? norms.prospect : norms;
	const v = zVector(ratings, reading, opts.pos);
	const z = { ...v.z };
	for (const [dim, m] of Object.entries(ABS_MIX) as [DimKey, number][]) {
		z[dim] += m * (v.abs[dim] - v.sz[dim]);
	}
	const b = {} as Record<DimKey, number>;
	const st = opts.stats;
	let statMean = 0;
	if (st) {
		let n = 0;
		for (const [dim, x] of Object.entries(st.z) as [DimKey, number][]) {
			if (dim !== "drb" && dim !== "diq") {
				statMean += x;
				n++;
			}
		}
		statMean = n > 0 ? statMean / n : 0;
	}
	const br = {} as Record<DimKey, number>;
	for (const dim of DIMS) {
		if (dim === "hgt" || STYLE_DIMS.has(dim)) {
			b[dim] = z[dim];
			br[dim] = z[dim];
			continue;
		}
		const rel = z[dim];
		b[dim] = (1 - BLEND_W) * rel + BLEND_W * v.pz[dim];
		br[dim] = b[dim];
		z[dim] = rel + MATCH_ABS_W * (v.pz[dim] - v.pzLevel - rel);
		// (his defensive box plus/minus only speaks to the defensive skill classes: classValues)
		const sz = dim === "diq" ? undefined : st?.z[dim];
		if (st && sz !== undefined) {
			const w = statWeightFor(dim, st);
			b[dim] = (1 - w) * b[dim] + w * sz;
			z[dim] = (1 - w) * z[dim] + w * (sz - statMean);
		}
	}
	return {
		z,
		sz: v.sz,
		abs: v.abs,
		b,
		br,
		stats: st,
		skills: skillsOf(ratings),
		hgt: ratings.hgt,
		pz: v.pz,
		pzLevel: v.pzLevel,
		expanded: v.expanded,
	};
};

// ---- What a build's name promises, and naming what stands out about him ----

// The skill classes each concept of a 2K name (twoK/concepts.ts) promises ("def": either side of the floor, "stre": strength)
const CONCEPT_CLASSES: Record<string, string[]> = {
	twoWay: ["def"],
	lockdown: ["perD"],
	steal: ["perD"],
	rimD: ["rimD"],
	oreb: ["reb"],
	reb: ["reb"],
	outlet: ["pass"],
	threeLevel: ["shoot", "mid"],
	insideOut: ["shoot", "finish"],
	catchShoot: ["shoot"],
	shotHunt: ["shoot"],
	midPaint: ["mid"],
	midPost: ["mid", "post"],
	mid: ["mid"],
	post: ["post"],
	paint: ["finish"],
	slash: ["finish"],
	finish: ["finish"],
	dunk: ["finish"],
	air: ["ath"],
	lob: ["finish"],
	run: ["ath"],
	tempo: ["handle"],
	creator: ["handle"],
	pass: ["pass"],
	tripleDouble: ["reb"],
	strength: ["stre"],
	scorer: ["score"],
};
export type Promises = {
	// Every class the name promises
	all: string[];
	// What the build is first of all (its head noun, "Sharpshooter" in "Crafty Sharpshooter", and its heaviest
	// profile weights)
	lead: string[];
	// The name's concept keys (twoK/concepts.ts)
	keys: string[];
};
const promiseCache = new WeakMap<Archetype, Promises>();
export const promisesOf = (a: Archetype): Promises => {
	let p = promiseCache.get(a);
	if (!p) {
		const cs = conceptsOf(a.name).filter((c) => CONCEPT_CLASSES[c.key]);
		const all = [...new Set(cs.flatMap((c) => CONCEPT_CLASSES[c.key]!))];
		// (a "Scorer" is what the rest of the name says he scores with: "Mid-Paint Scorer" leads with the mid-range)
		const named = cs.filter((c) => c.key !== "scorer");
		const head = named.length > 0 ? named.at(-1) : cs.at(-1);
		const lead = new Set(head ? CONCEPT_CLASSES[head.key]! : []);
		const max = Math.max(
			...Object.entries(a.w)
				.filter(([d]) => CLASS_OF.has(d as DimKey))
				.map(([, w]) => w),
		);
		for (const [d, w] of Object.entries(a.w) as [DimKey, number][]) {
			const k = CLASS_OF.get(d);
			if (k && w >= 2 && w >= max - 0.01) {
				lead.add(k);
			}
		}
		p = { all, lead: [...lead], keys: conceptsOf(a.name).map((c) => c.key) };
		promiseCache.set(a, p);
	}
	return p;
};

// A name's promises: every skill it names must be at least ordinary for him on the blended reading (PROMISE_FLOOR: a
// build that promises what he is below average at pays heavily), and what the build is first of all must stand out
// (LEAD_MIN, about the 70th percentile at his position for an average player; the bar moves with his level, since the
// reading is part relative to it)
export const PROMISE_FLOOR = 0;
export const PROMISE_K = 2.5;
export const PROMISE_STEP = 0.25;
export const LEAD_MIN = 0.5;
export const LEAD_MIN_K = 1;
// ... and, so a label never names what is not there in his own game, each promised skill must also be at least ordinary
// relative to his own level (`abs` and, for rebounding and post play, `sz`: the level-relative readings), not only by his
// standing at his position or his stats
const relCheck = (k: string, p: Prepared): number => {
	const a = p.abs;
	switch (k) {
		case "shoot":
			return a.three - 0.1;
		case "mid":
			return a.mid - 0.1;
		case "rimD":
			return a.blk - 0.1;
		case "pass":
			return a.pss - 0.1;
		case "handle":
			return a.drb - 0.1;
		case "perD":
		case "def":
			return Math.max(a.diq, a.pdef, a.dper, a.stl);
		case "ath":
			return Math.max(a.jmp, a.ath - 0.1, a.fin - 0.3);
		case "reb":
			return p.sz.reb - 0.1;
		case "post":
			return p.sz.post - 0.1;
		case "finish":
			return Math.max(a.fin, a.draw - 0.1);
		case "stre":
			return a.stre;
		case "score":
			return Math.max(a.three, a.mid, p.sz.post, a.fin - 0.3) - 0.1;
		default:
			return 0;
	}
};
// arch12: a perimeter player's rebounding rating is high for his position almost whatever his game (BBGM's real ratings give
// most good guards one), so a name that promises rebounding ("Cleaner", "Glass", "Board") needs it to really stand out for
// a player below BIG_HGT: REB_PERIM_MIN on the blended reading with his stats, REB_PERIM_K per z short
export const REB_PERIM_MIN = 1.1;
export const REB_PERIM_K = 4;
// (without stats his ratings are all there is, and the game sim plays a rebounding guard as one: a lower bar)
export const REB_PERIM_MIN_RATINGS = 0.3;
// (the same for protecting the rim: a guard's or wing's blocks are rated off his size and leaping)
const PERIM_SIZE_CLASSES = ["reb", "rimD"];
export const promiseShortfall = (
	a: Archetype,
	cv: Record<string, number>,
	p?: Prepared,
): { floor: number; lead: number; rel: number; reb?: number } => {
	const pr = promisesOf(a);
	let floor = 0;
	let rel = 0;
	for (const k of pr.all) {
		// ("Scorer" is checked on the absolute scale only: absolutePenalty)
		if (k === "score") {
			continue;
		}
		floor += Math.max(0, PROMISE_FLOOR - (cv[k] ?? 0));
		if (p) {
			rel += Math.max(0, -relCheck(k, p));
		}
	}
	let lead = 0;
	if (pr.lead.length > 0) {
		// (one of the lead classes is enough: a "3-Level" scorer leads with his three or his mid-range)
		lead = Math.min(
			...pr.lead.map((k) => Math.max(0, LEAD_MIN - (cv[k] ?? 0))),
		);
	}
	let reb = 0;
	if (p && p.hgt < BIG_HGT) {
		for (const k of PERIM_SIZE_CLASSES) {
			if (pr.all.includes(k)) {
				reb += Math.max(
					0,
					(p.stats ? REB_PERIM_MIN : REB_PERIM_MIN_RATINGS) - (cv[k] ?? 0),
				);
			}
		}
	}
	return { floor, lead, rel, reb };
};
// (the level-relative check is a hard one, like the 2K builds' own floors: needPenaltyOf)
export const promisePenalty = (sh: {
	floor: number;
	lead: number;
	rel?: number;
	reb?: number;
}) =>
	(sh.floor > 0 ? PROMISE_STEP + PROMISE_K * sh.floor : 0) +
	REB_PERIM_K * (sh.reb ?? 0) +
	LEAD_MIN_K * sh.lead +
	needPenaltyOf(sh.rel ?? 0);

// Signature skills: his top one or two standouts must be named by the build, or fit its role (a handler's handle
// in a playmaker's build). A build that leads with his top standout earns SIG_LEAD_K; one that leaves it out pays SIG_K
// (half for the second one).
const CONSISTENT: Record<string, string[]> = {
	handle: ["pass", "mid"],
	pass: ["handle"],
	finish: ["ath", "post"],
	ath: ["finish"],
	post: ["finish"],
	rimD: ["reb"],
	reb: ["rimD"],
	mid: ["shoot"],
	shoot: ["mid"],
	perD: [],
};
export const SIG_K = 0.5;
export const SIG_LEAD_K = 0.5;
// ... and a build that leads with a skill well below his best pays LEAD_GAP_K per z of the gap (beyond LEAD_GAP_FREE)
export const LEAD_GAP_K = 1.5;
const LEAD_GAP_FREE = 0.1;
export const signatureTerm = (
	a: Archetype,
	st: Standout[],
	cv?: Record<string, number>,
) => {
	let gap = 0;
	let lead = promisesOf(a).lead;
	// A nickname ("Fluid Four") leads with what its profile features most
	if (lead.length === 0) {
		const c = coverOf(a);
		lead = Object.keys(c).filter((k) => c[k]! >= 1);
	}
	if (cv && lead.length === 0) {
		// (a build that features nothing pays for his best skill in full)
		let top = -Infinity;
		for (const k of Object.keys(SKILL_CLASSES)) {
			top = Math.max(top, cv[k]!);
		}
		gap = LEAD_GAP_K * Math.max(0, top - LEAD_GAP_FREE);
	} else if (cv) {
		let top = -Infinity;
		for (const k of Object.keys(SKILL_CLASSES)) {
			top = Math.max(top, cv[k]!);
		}
		const best = Math.max(...lead.map((k) => cv[k] ?? -Infinity));
		gap = LEAD_GAP_K * Math.max(0, top - best - LEAD_GAP_FREE);
	}
	if (st.length === 0) {
		return -gap;
	}
	const c = coverOf(a);
	const pr = promisesOf(a);
	const named = (k: string) =>
		(c[k] ?? 0) >= 0.5 ||
		pr.all.includes(k) ||
		(CONSISTENT[k] ?? []).some((x) => (c[x] ?? 0) >= 1 || pr.all.includes(x));
	let t = 0;
	for (const [i, { k, s }] of st.slice(0, 2).entries()) {
		if (!named(k)) {
			t -= SIG_K * s * (i === 0 ? 1 : 0.5);
		}
	}
	if (pr.lead.includes(st[0]!.k)) {
		t += SIG_LEAD_K * st[0]!.s;
	}
	return t - gap;
};

// Creator or off the ball (item of his stats): usage and assist rate together (StatReading's `drb`) say whether the ball is in
// his hands. A creator's builds (passing or handling ones) gain CREATOR_K, spot-up, 3-and-D and lockdown builds lose it, and
// the other way round for a low-usage, low-assist player. Ratings alone: the profiles' catch-and-shoot lean (`cs`) does it.
export const CREATOR_K = 0.6;
const OFF_BALL_KEYS = new Set(["catchShoot", "lockdown", "steal"]);
export const creatorTerm = (a: Archetype, st: StatReading | undefined) => {
	const c = st?.z.drb;
	if (c === undefined || !st) {
		return 0;
	}
	const pr = promisesOf(a);
	const creator = pr.all.includes("pass") || pr.all.includes("handle");
	const offBall = !creator && pr.keys.some((k) => OFF_BALL_KEYS.has(k));
	if (!creator && !offBall) {
		return 0;
	}
	const scale = st.w / STATS_W;
	const t =
		c > 0.5 ? Math.min(1, c - 0.5) : c < -0.5 ? -Math.min(1, -c - 0.5) : 0;
	return CREATOR_K * scale * t * (creator ? 1 : -1);
};

// ---- arch11: what a name promises, on the absolute scale ----
// The blended reading is mostly the shape of his game, so for a low-level player whose ratings are all low and flat any
// skill can look ordinary. A name must also be true of him in absolute terms: each skill it promises is read on his
// standing among players at his position (`pz`, not relative to his level; with his stats blended in), and a promised
// skill in the bottom ABS_FLOOR of his position costs ABS_K per z. A scorer's or shooter's name also needs a shot at all
// (NO_SHOT_*), "High-Flying" needs real jumping (AIR_*) and "Sniper"/"Sharpshooter" an elite three (ELITE_SHOT_*).
const ABS_DIMS: Record<string, DimKey[]> = {
	shoot: ["three"],
	mid: ["mid"],
	finish: ["fin", "rim", "draw"],
	post: ["post"],
	handle: ["drb"],
	pass: ["pss"],
	reb: ["reb"],
	rimD: ["blk", "dint", "idef"],
	perD: ["dper", "stl", "pdef"],
	ath: ["ath", "jmp", "spd"],
	stre: ["stre"],
	def: ["diq", "pdef", "idef", "dper", "blk"],
	score: ["three", "mid", "post", "ft"],
};
export const absValue = (k: string, p: Prepared): number => {
	const dims = ABS_DIMS[k];
	if (!dims) {
		return 0;
	}
	let v = -Infinity;
	let sv = -Infinity;
	for (const d of dims) {
		v = Math.max(v, p.pz[d]);
		const x = p.stats?.z[d];
		if (x !== undefined) {
			sv = Math.max(sv, x);
		}
	}
	// (arch12: with the stats' boost for the classes they say most about: his assist rate is what a playmaker is, his block
	// rate what a rim protector is, as in the blended reading)
	const w = p.stats ? statWeightFor(CLASS_STAT_DIM[k] ?? "usg", p.stats) : 0;
	return p.stats && sv > -Infinity ? (1 - w) * v + w * sv : v;
};
const CLASS_STAT_DIM: Record<string, DimKey> = { pass: "pss", rimD: "blk" };
export const ABS_FLOOR = -1;
export const ABS_K = 1.5;
export const NO_SHOT_FROM = -1.1;
export const NO_SHOT_K = 2;
export const AIR_MIN = 0.3;
export const AIR_K = 2;
export const ELITE_SHOT_MIN = 1.9;
export const ELITE_SHOT_K = 3;
export const TOUCH_FROM = -1.1;
export const TOUCH_K = 4;
const SHOT_CLASSES = new Set(["shoot", "mid", "score"]);
const SHOT_KEYS = new Set([
	"threeLevel",
	"insideOut",
	"catchShoot",
	"shotHunt",
]);
const SNIPER_RE = /Snip|Sharp|Laser|Automatic|Logo|Big Range|Silk/;
const AIR_RE = /High[ -]Fly|Aerial|Force of Nature|Explosive|Athletic|Glide/;
// arch14: each part on its own, so the fitted model (model.ts) can weigh them
export type AbsoluteParts = {
	floor: number;
	noShot: number;
	air: number;
	eliteShot: number;
	touch: number;
};
export const absoluteParts = (a: Archetype, p: Prepared): AbsoluteParts => {
	const pr = promisesOf(a);
	// (without stats, half of it is the blended reading, so a uniform shift of his ratings moves it less)
	const v = (k: string) => (p.stats ? absValue(k, p) : roleValue(k, p));
	const out: AbsoluteParts = {
		floor: 0,
		noShot: 0,
		air: 0,
		eliteShot: 0,
		touch: 0,
	};
	for (const k of pr.all) {
		out.floor += ABS_K * Math.max(0, ABS_FLOOR - v(k));
	}
	if (
		pr.all.some((k) => SHOT_CLASSES.has(k)) ||
		pr.keys.some((k) => SHOT_KEYS.has(k))
	) {
		const shot = Math.max(p.pz.three, p.pz.mid, p.pz.ft);
		out.noShot = NO_SHOT_K * Math.max(0, NO_SHOT_FROM - shot);
	}
	if (AIR_RE.test(a.name)) {
		const j = Math.min(0.5 * (p.pz.jmp + p.b.jmp), p.b.jmp + 0.3);
		out.air = AIR_K * Math.max(0, AIR_MIN - j);
	}
	if (SNIPER_RE.test(a.name)) {
		out.eliteShot = ELITE_SHOT_K * Math.max(0, ELITE_SHOT_MIN - v("shoot"));
	}
	// arch12: a mid-range name needs a shooter's touch. BBGM's real ratings give a player who scores efficiently at the rim
	// a high mid-range rating, so the mid-range alone does not make him a jumpshooter: his free throws or his three must be
	// at least near ordinary for him (TOUCH_FROM on the blended reading), TOUCH_K per z below
	if (pr.all.includes("mid")) {
		out.touch = TOUCH_K * Math.max(0, TOUCH_FROM - Math.max(p.b.ft, p.b.three));
	}
	return out;
};
export const absolutePenalty = (a: Archetype, p: Prepared): number => {
	const x = absoluteParts(a, p);
	return x.floor + x.noShot + x.air + x.eliteShot + x.touch;
};

// Roles his ratings and stats make plain: a ball handler or point forward who passes (passing at his position and his
// assist rate) gets a playmaking build (one that promises passing) by PLAY_K per z above PLAY_FROM, and a big who protects
// the rim (blocks, interior defense, his block rate and length) a rim protector's by RIM_K per z above RIM_FROM; an
// elite shooter (the three at his position and in his stats) a shooter's build by SHOT_K.
export const PLAY_FROM = 0.5;
export const PLAY_K = 1.2;
export const RIM_FROM = 0.5;
export const RIM_K = 1.0;
// (arch12: 1.2 -> 1.0 on ratings alone and 1.8 when his block rate backs it up, so a real rim protector is named for it:
// Davis, Gobert)
export const RIM_K_STATS = 1.8;
export const SHOT_FROM = 0.8;
export const SHOT_K = 0.6;
// (and a sniper's name, for an elite shooter, by SNIPER_K more)
// (arch12: 1.5 -> 2, so the stars' concentration trim does not take the elite shooter's name from Curry)
export const SNIPER_K = 2.3;
// A role's reading: half his absolute standing (absValue), half the blended reading of the same skill (mostly the shape of
// his game), so a uniform shift of his ratings moves it little
const roleValue = (k: string, p: Prepared) => {
	let v = -Infinity;
	for (const d of ABS_DIMS[k] ?? []) {
		v = Math.max(v, p.b[d]);
	}
	return 0.5 * v + 0.5 * absValue(k, p);
};
export const MID_LEVEL_K = 0.8;
export const MID_LEVEL_FROM = 0.8;
const MID_FREE = 0.6;
const MID_OTHERS = [
	"shoot",
	"finish",
	"post",
	"handle",
	"pass",
	"reb",
	"rimD",
	"perD",
	"ath",
];
export type RoleParts = {
	pass: number;
	rim: number;
	sniper: number;
	shoot: number;
	mid: number;
};
export const roleParts = (
	a: Archetype,
	p: Prepared,
	cv: Record<string, number> = classValues(p),
): RoleParts => {
	const pr = promisesOf(a);
	const out: RoleParts = { pass: 0, rim: 0, sniper: 0, shoot: 0, mid: 0 };
	if (pr.all.includes("pass")) {
		// (his assist rate, when he has one, is the real thing: read in full)
		const pass = p.stats ? absValue("pass", p) : roleValue("pass", p);
		// (without an assist rate, a third of it: the profile match already reads his passing)
		out.pass =
			(p.stats ? 1 : 1 / 3) *
			PLAY_K *
			Math.min(1, Math.max(0, pass - PLAY_FROM));
	}
	if (pr.all.includes("rimD") && p.hgt >= BIG_HGT) {
		const len = p.expanded ? 0.25 * p.abs.len : 0;
		const rim = 0.5 * roleValue("rimD", p) + 0.25 * (p.pz.blk + p.b.blk) + len;
		out.rim =
			(p.stats ? RIM_K_STATS : RIM_K) * Math.min(1, Math.max(0, rim - RIM_FROM));
	}
	if (SNIPER_RE.test(a.name)) {
		out.sniper =
			SNIPER_K *
			Math.min(
				1,
				Math.max(
					0,
					(p.stats ? absValue("shoot", p) : roleValue("shoot", p)) -
						ELITE_SHOT_MIN,
				),
			);
	}
	if (pr.all.includes("shoot")) {
		out.shoot =
			SHOT_K * Math.min(1, Math.max(0, roleValue("shoot", p) - SHOT_FROM));
	}
	// Concentration: a good player's mid-range rating is high almost whatever his game (BBGM's real ratings give nearly
	// every star a high one), so for a player above his position's average a mid-range build pays MID_LEVEL_K per z of his
	// level, unless the mid-range is what stands out about him by MID_FREE over his best other skill
	if (pr.all.includes("mid")) {
		let other = -Infinity;
		for (const k of MID_OTHERS) {
			other = Math.max(other, cv[k]!);
		}
		const lead = Math.min(1, Math.max(0, (cv.mid! - other) / MID_FREE));
		out.mid =
			-MID_LEVEL_K *
			Math.min(1, Math.max(0, p.pzLevel - MID_LEVEL_FROM)) *
			(1 - lead);
	}
	return out;
};
export const roleTerm = (
	a: Archetype,
	p: Prepared,
	cv: Record<string, number> = classValues(p),
): number => {
	const x = roleParts(a, p, cv);
	return x.pass + x.rim + x.sniper + x.shoot + x.mid;
};

// How much the stars' concentration trim (starBias.data.ts) applies to him: none at or below STAR_FROM (his mean standing
// at his position over his core skills), in full from STAR_FROM + STAR_SPAN
export const STAR_FROM = 0;
export const STAR_SPAN = 0.6;
export const starWeight = (p: Prepared) =>
	Math.min(1, Math.max(0, (p.pzLevel - STAR_FROM) / STAR_SPAN));

// arch13: the all-around star build (Do-It-All Superstar, tag "allAround"). Generated stars who are good at nearly
// everything have no single best 2K description: every profile names two or three of their skills and leaves the rest
// out. This build has no profile; it is read from three things only, each faded in over a range:
// - elite: his level at his position (pzLevel, over his core skills) from ALL_AROUND_LEVEL[0] to [1] (the top ~2% of a
//   random league; no real 2016-2025 player gets there, their ratings are less even);
// - broad: the number of skill classes (shooting, mid-range, finishing, post, handle, passing, both defenses, rebounding)
//   he is at least ALL_AROUND_GOOD at on the blended reading, from ALL_AROUND_BREADTH[0] to [1], with a defensive class and
//   three offensive ones among them;
// - no specialty: his best class at most ALL_AROUND_GAP[1] above his fourth best (none at ALL_AROUND_GAP[0]).
// Its score is ALL_AROUND_Z times that quality, so it only wins where no ordinary build fits him well: a specialist (an
// elite shooter, a rim protector, a playmaker...) keeps the build that names his specialty. Never for a draft prospect.
export const ALL_AROUND_LEVEL: [number, number] = [1.5, 1.9];
export const ALL_AROUND_GOOD = 0.5;
export const ALL_AROUND_BREADTH: [number, number] = [5, 7];
export const ALL_AROUND_GAP: [number, number] = [0.6, 0.35];
export const ALL_AROUND_Z = 2.4;
// (what the build scores when he does not qualify at all: never his label)
export const ALL_AROUND_MISS = 6;
const ALL_AROUND_OFF = ["shoot", "mid", "finish", "post", "handle", "pass"];
const ALL_AROUND_DEF = ["perD", "rimD"];
const ALL_AROUND_CLASSES = [...ALL_AROUND_OFF, ...ALL_AROUND_DEF, "reb"];
const fade = (x: number, from: number, to: number) =>
	Math.min(1, Math.max(0, (x - from) / (to - from)));
export const allAroundQuality = (
	p: Prepared,
	cv: Record<string, number>,
	prospect = false,
): number => {
	if (prospect) {
		return 0;
	}
	const good = (k: string) => cv[k]! >= ALL_AROUND_GOOD;
	if (!ALL_AROUND_DEF.some(good) || ALL_AROUND_OFF.filter(good).length < 3) {
		return 0;
	}
	const vals = ALL_AROUND_CLASSES.map((k) => cv[k]!).sort((x, y) => y - x);
	return (
		fade(p.pzLevel, ALL_AROUND_LEVEL[0], ALL_AROUND_LEVEL[1]) *
		fade(
			ALL_AROUND_CLASSES.filter(good).length,
			ALL_AROUND_BREADTH[0],
			ALL_AROUND_BREADTH[1],
		) *
		fade(vals[0]! - vals[3]!, ALL_AROUND_GAP[0], ALL_AROUND_GAP[1])
	);
};

// ---- arch14: does the name keep its promises? ----
// Each skill a build's name promises (promisesOf), read on the blended scale (classValues: his shape, his standing at his
// position and his stats): at least ordinary for him (PROMISE_MET), and an elite three for a sniper's name
// ("Sniper", "Sharpshooter", "Laser", ...: PROMISE_ELITE). The name-promise check (namePromise.script.test.ts,
// archetypes.test.ts) measures, per build, the share of its holders who meet each promise.
export const PROMISE_MET = 0;
export const PROMISE_ELITE = 0.8;
export const promiseChecks = (
	a: Archetype,
	cv: Record<string, number>,
): Record<string, boolean> => {
	const out: Record<string, boolean> = {};
	for (const k of promisesOf(a).all) {
		out[k] = (cv[k] ?? 0) >= PROMISE_MET;
	}
	if (SNIPER_RE.test(a.name)) {
		out.elite = (cv.shoot ?? 0) >= PROMISE_ELITE;
	}
	return out;
};
// How far he is from keeping them (z, 0 = all kept): the fitted model's `promise` weight acts on it
export const promiseMiss = (a: Archetype, cv: Record<string, number>) => {
	let t = 0;
	for (const k of promisesOf(a).all) {
		t += Math.max(0, PROMISE_MET - (cv[k] ?? 0));
	}
	if (SNIPER_RE.test(a.name)) {
		t += Math.max(0, PROMISE_ELITE - (cv.shoot ?? 0));
	}
	return t;
};
