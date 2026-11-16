// Sub-ratings (worker side, pure): generation of a player's shape, the neutral derivation for existing players and real players, and
// development. See common/subRatings.ts for the data model and docs/native-features.md, Sub-ratings.
//
// Every random number here comes from a seeded stream (Rng) of the player's own (p.subP.s), never Math.random, so turning the setting on
// leaves the game's main random stream, and with it every base rating, exactly as with the setting off.

import { ARCHETYPES } from "./ratingsBuilds/archetypes.data.ts";
import { Rng } from "./ratingsBuilds/rng.ts";
import type { Archetype } from "./ratingsBuilds/types.ts";
import {
	anchorError,
	anchorToExpanded,
	subsMatchBases,
	fitSubsToBases,
	NUM_SUBS,
	refitSubs,
	SUB_BASES,
	SUB_DEFS,
	SUB_GROUPS,
	SUB_INDEX,
	SUB_RATINGS_VERSION,
} from "./subRatings.ts";

type RatingsLike = Record<string, any>;

// Hidden growth profiles: how a player's subs develop (never shown). 0 normal, 1 early peaker, 2 late bloomer, 3 one-skill grower,
// 4 athlete-learner, 5 finished product
export const GROWTH_PROFILES = [
	"normal",
	"earlyPeaker",
	"lateBloomer",
	"oneSkill",
	"athleteLearner",
	"finished",
] as const;
export type GrowthProfile = (typeof GROWTH_PROFILES)[number];

export type Background = "oneAndDone" | "senior" | "intl" | "pro" | "college";

// What a player stores about his sub-ratings (p.subP). Hidden from the UI.
export type StoredSubInfo = {
	// Version of the sub-ratings layout (SUB_RATINGS_VERSION)
	v: number;
	// Seed of his own random stream (uint32)
	s: number;
	// Growth profile, an index of GROWTH_PROFILES
	g: number;
	// One-skill grower: the sub that grows
	o?: number;
	// Generated (fictional) player: the build his shape leans toward (a name in ratingsBuilds), and flags: specialist, generational
	b?: string;
	sp?: 1;
	gen?: 1;
	// Wider Sub-Rating Shapes: a lopsided shape (one or two subs 15-25 off their base)
	lop?: 1;
	// Prospect whose shape has been given with his class (background, class caps)
	c?: 1;
	// Neutral derivation (existing league, real player, imported): no build
	n?: 1;
	// Real player: 1 if his shape came from his real stats (realSubShape), 0 if he has no stats to read (checked once)
	rs?: 0 | 1;
};

const z = () => new Array<number>(NUM_SUBS).fill(0);
const lean = (o: Record<string, number>) => {
	const out = z();
	for (const [k, v] of Object.entries(o)) {
		const i = SUB_INDEX[k];
		if (i === undefined) {
			throw new Error(`Unknown sub-rating ${k}`);
		}
		out[i] = v;
	}
	return out;
};
const addTo = (a: number[], b: readonly number[], k = 1) => {
	for (let i = 0; i < NUM_SUBS; i++) {
		a[i]! += k * b[i]!;
	}
};

const num = (r: RatingsLike, key: string, fallback: number) =>
	typeof r[key] === "number" && Number.isFinite(r[key]) ? r[key] : fallback;

// Shape from the body: length and leaping make shot blockers, quickness perimeter defenders and ball hawks, strength post scorers and
// contact finishers, small players floaters and finesse, ball handlers off-the-dribble shooters, wings and bigs spot-up shooters.
export const physicalLean = (r: RatingsLike) => {
	const hgt = num(r, "hgt", 47);
	const len = typeof r.wng === "number" ? (hgt + r.wng) / 2 : hgt;
	const stre = num(r, "stre", 45);
	const spd = num(r, "spd", 50);
	const jmp = num(r, "jmp", 50);
	const drb = num(r, "drb", 45);
	const oiq = num(r, "oiq", 38);
	const ft = num(r, "ft", 45);
	const endu = num(r, "endu", 35);
	const h = hgt - 47;
	return lean({
		blk: 0.22 * (len - 47) + 0.12 * (jmp - 50),
		stl: 0.1 * (spd - 50) - 0.08 * h,
		idf: 0.12 * h + 0.08 * (stre - 45),
		pdf: 0.12 * (spd - 50) - 0.12 * h,
		rng: 0.06 * (ft - 45),
		tcs: 0.04 * h - 0.08 * (drb - 45),
		tod: 0.1 * (drb - 45) + 0.05 * (spd - 50),
		pst: 0.15 * (stre - 45) + 0.1 * h,
		cls: 0.06 * h,
		flt: -0.1 * h + 0.05 * (oiq - 38),
		con: 0.15 * (stre - 45) + 0.08 * (jmp - 50),
		fns: -0.08 * (stre - 45) + 0.06 * (spd - 50),
		pul: 0.1 * (drb - 45),
		spu: -0.1 * (drb - 45),
		orb: 0.1 * (jmp - 50) + 0.08 * (stre - 45),
		drd: 0.08 * h,
		hnd: 0.05 * (spd - 50),
		sec: 0.12 * (oiq - 38) - 0.04 * (spd - 50),
		crt: 0.08 * (spd - 50) + 0.06 * (jmp - 50),
		vis: 0.12 * (oiq - 38),
		sls: 0.05 * (endu - 35),
		lat: -0.15 * h,
		stj: 0.1 * h + 0.05 * (stre - 45),
		mxv: -0.08 * h + 0.04 * (spd - 50),
	});
};

const TAG_LEANS: Record<string, number[]> = {
	guard: lean({
		stl: 2,
		pdf: 2,
		blk: -3,
		idf: -2,
		flt: 2,
		pst: -3,
		cls: -1,
		hnd: 1,
		lat: 2,
		stj: -1,
		mxv: 1,
	}),
	wing: lean({ tcs: 2, spu: 1, pdf: 1, lat: 1, fns: 1 }),
	big: lean({
		blk: 3,
		idf: 3,
		stl: -2,
		pdf: -3,
		pst: 3,
		flt: -2,
		cls: 2,
		con: 2,
		fns: -2,
		hnd: -1,
		crt: -2,
		sec: 1,
		lat: -3,
		stj: 2,
		mxv: -1,
		orb: 1,
		rng: -2,
	}),
	shooting: lean({ tcs: 3, rng: 3, spu: 2, tod: -1, pul: -1 }),
	scoring: lean({ tod: 3, pul: 3, crt: 4, cls: 1, hnd: 1, sec: -1, flt: 1 }),
	playmaking: lean({ vis: 4, acc: 2, sec: 2, hnd: 1, crt: -1 }),
	defense: lean({ pdf: 2, idf: 2, stl: 1, blk: 1 }),
	rebounding: lean({ orb: 3, drd: 1, blk: 1, cls: 1 }),
	athletic: lean({
		mxv: 4,
		stj: -1,
		con: 3,
		fns: -1,
		sls: 3,
		lat: 1,
		orb: 1,
		crt: 1,
	}),
	raw: lean({ sec: -3, acc: -2, flt: -2, rng: -2, vis: -1, idf: -1 }),
};

const NAME_LEANS: [RegExp, number[]][] = [
	[/Stretch|Pick-and-Pop|Face-Up/, lean({ rng: 4, tcs: 3, spu: 2, pst: -2 })],
	[/Post|Bruiser|Old-School/, lean({ pst: 5, cls: 2, flt: -2 })],
	[
		/Rim Protector|Swatter|Anchor|Eraser|Blocker|Weak-Side/,
		lean({ blk: 6, idf: 2, stl: -2 }),
	],
	[
		/Stopper|Lockdown|Pest|On-Ball|3&D|Two-Way|Switchable/,
		lean({ pdf: 4, lat: 4, stl: 1 }),
	],
	[/Hawk/, lean({ stl: 7, pdf: -1 })],
	[
		/Slasher|Downhill|Attacker|Cutter|Finisher|Rim Runner|Rim-Running/,
		lean({ con: 3, fns: 3, sls: 3, cls: 2 }),
	],
	[/Crafty|Change-of-Pace|Floater/, lean({ fns: 4, flt: 5, con: -2 })],
	[
		/Floor General|Pass-First|Point|Playmaker|Connector|Maestro|Pusher/,
		lean({ vis: 5, acc: 2 }),
	],
	[
		/Sharpshooter|Sniper|Shooter|Corner|Spot-Up/,
		lean({ tcs: 5, rng: 3, spu: 3, tod: -2 }),
	],
	[
		/Pull-Up|Shot-Creating|Creator|Scorer|Gunner|Tough-Shot|Heliocentric|Microwave|Bucket/,
		lean({ tod: 4, pul: 4, crt: 4 }),
	],
	[/Midrange|Mid-Range/, lean({ pul: 3, spu: 2 })],
	[
		/Lob|Vertical|High-Flying|Athletic Freak|Glide/,
		lean({ mxv: 6, con: 2, stj: -2 }),
	],
	[/Rebound|Glass|Motor|Energy|Hustle/, lean({ orb: 4 })],
	[/Turnover-Prone/, lean({ sec: -7 })],
	[/Steady|Iron|High-IQ|Glue|Fifth-Year/, lean({ sec: 3, acc: 2, idf: 1 })],
];

// Correlated noise: one draw moves a family of related subs together
const FACTORS: { sd: number; v: number[] }[] = [
	// Hands
	{ sd: 3, v: lean({ stl: 1, sec: 1, acc: 0.5, hnd: 0.4 }) },
	// Touch
	{
		sd: 3,
		v: lean({ flt: 1, fns: 0.8, tcs: 0.6, rng: 0.4, spu: 0.5, cls: 0.4 }),
	},
	// Motor
	{ sd: 3, v: lean({ orb: 1, blk: 0.6, con: 0.6, drd: 0.3 }) },
	// Basketball IQ
	{ sd: 2.5, v: lean({ vis: 1, sec: 0.6, idf: 0.6, drd: 0.5, spu: 0.3 }) },
	// Burst
	{ sd: 3, v: lean({ mxv: 1, sls: 0.8, crt: 0.6, lat: 0.4 }) },
];
const NOISE_SD = 2.5;

const BACKGROUND_LEANS: Record<Background, number[]> = {
	// Raw and athletic
	oneAndDone: lean({
		mxv: 2,
		sls: 2,
		con: 2,
		sec: -2,
		flt: -1,
		acc: -1,
		vis: -1,
		rng: -1,
		idf: -1,
		spu: -1,
	}),
	// Polished, high IQ
	senior: lean({
		sec: 2,
		acc: 2,
		vis: 1,
		spu: 1,
		idf: 1,
		flt: 1,
		drd: 1,
		mxv: -1,
		sls: -1,
		con: -1,
	}),
	// Passing and shooting
	intl: lean({ vis: 2, acc: 2, tcs: 2, rng: 1, spu: 1, con: -2, mxv: -1 }),
	// G League / Overtime Elite: pro-ready creators
	pro: lean({ sec: 1, crt: 2, tod: 1, pul: 1, hnd: 1, vis: -1 }),
	college: z(),
};

// Growth profile shares, by background
const PROFILE_SHARES: Record<Background, number[]> = {
	college: [0.45, 0.12, 0.13, 0.1, 0.1, 0.1],
	oneAndDone: [0.42, 0.17, 0.06, 0.1, 0.18, 0.07],
	senior: [0.43, 0.1, 0.08, 0.1, 0.05, 0.24],
	intl: [0.43, 0.1, 0.18, 0.1, 0.09, 0.1],
	pro: [0.42, 0.13, 0.12, 0.1, 0.1, 0.13],
};

// A typical draft prospect's ratings (measured: generated classes, new-league defaults), to read which build his ratings are closest to
const PROSPECT_MEAN: Record<string, number> = {
	stre: 40,
	spd: 51,
	jmp: 51,
	endu: 23,
	ins: 33,
	dnk: 37,
	ft: 38,
	fg: 38,
	tp: 38,
	oiq: 28,
	diq: 27,
	drb: 43,
	pss: 40,
	reb: 42,
};
const BUILD_KEYS = Object.keys(PROSPECT_MEAN);

// How strongly the build draw follows his ratings (the rest is the builds' real-draft weights)
const BUILD_FIT_K = 4;

type BuildInfo = {
	a: Archetype;
	// The build's offsets on BUILD_KEYS, as a unit vector
	u: Float64Array;
	lean: number[];
	weight: number;
};
let buildCache: BuildInfo[] | undefined;
const getBuilds = () => {
	if (!buildCache) {
		buildCache = ARCHETYPES.filter((a) => a.w > 0 && a.name !== "Balanced").map(
			(a) => {
				const u = new Float64Array(BUILD_KEYS.length);
				let norm = 0;
				BUILD_KEYS.forEach((k, i) => {
					const v = (a.o as any)[k] ?? 0;
					u[i] = v;
					norm += v * v;
				});
				norm = Math.sqrt(norm) || 1;
				for (let i = 0; i < u.length; i++) {
					u[i]! /= norm;
				}
				const l = z();
				for (const tag of a.tags) {
					const t = TAG_LEANS[tag];
					if (t) {
						addTo(l, t);
					}
				}
				for (const [re, v] of NAME_LEANS) {
					if (re.test(a.name)) {
						addTo(l, v);
					}
				}
				return { a, u, lean: l, weight: a.w * a.cal };
			},
		);
	}
	return buildCache;
};

// The builds whose height gate lets a player of this hgt in (cached per hgt)
const poolCache = new Map<number, BuildInfo[]>();
const poolFor = (hgt: number) => {
	const h = Math.round(hgt);
	let pool = poolCache.get(h);
	if (!pool) {
		const all = getBuilds();
		pool = all.filter((b) => h >= b.a.min && h <= b.a.max);
		if (pool.length === 0) {
			pool = all;
		}
		poolCache.set(h, pool);
	}
	return pool;
};

// Build-first: a target build drawn by its share of real draft classes (the ratings builds' weights and height gates), tilted toward the
// builds his ratings already look like
export const pickBuild = (r: RatingsLike, rng: Rng) => {
	const n = BUILD_KEYS.length;
	const d = new Float64Array(n);
	let mean = 0;
	for (let i = 0; i < n; i++) {
		const k = BUILD_KEYS[i]!;
		const v = num(r, k, PROSPECT_MEAN[k]!) - PROSPECT_MEAN[k]!;
		d[i] = v;
		mean += v;
	}
	mean /= n;
	let dNorm = 0;
	for (let i = 0; i < n; i++) {
		d[i]! -= mean;
		dNorm += d[i]! * d[i]!;
	}
	dNorm = Math.sqrt(dNorm) || 1;
	const pool = poolFor(num(r, "hgt", 47));
	const weights = new Float64Array(pool.length);
	let total = 0;
	for (let j = 0; j < pool.length; j++) {
		const b = pool[j]!;
		let dot = 0;
		for (let i = 0; i < n; i++) {
			dot += d[i]! * b.u[i]!;
		}
		const w = b.weight * Math.exp((BUILD_FIT_K * dot) / dNorm);
		weights[j] = w;
		total += w;
	}
	let x = rng.random() * total;
	for (let j = 0; j < pool.length; j++) {
		x -= weights[j]!;
		if (x < 0) {
			return pool[j]!;
		}
	}
	return pool.at(-1)!;
};

export const bandLean = (r: RatingsLike) => {
	const hgt = num(r, "hgt", 47);
	if (hgt <= 38) {
		return TAG_LEANS.guard!;
	}
	if (hgt >= 58) {
		return TAG_LEANS.big!;
	}
	return TAG_LEANS.wing!;
};

// Sanity limits on the wanted values: elite shot blocking needs height, length and leaping; elite lateral quickness isn't a 7'2"
// center; a post game needs some size or strength
export const applySanityCaps = (x: number[], r: RatingsLike) => {
	const hgt = num(r, "hgt", 47);
	const len = typeof r.wng === "number" ? (hgt + r.wng) / 2 : hgt;
	const jmp = num(r, "jmp", 50);
	const stre = num(r, "stre", 45);
	const cap = (key: string, max: number) => {
		const i = SUB_INDEX[key]!;
		if (x[i]! > max) {
			x[i] = max;
		}
	};
	cap("blk", 40 + 0.5 * len + 0.25 * jmp);
	cap("lat", 100 - 1.3 * Math.max(0, hgt - 58));
	cap("pst", 50 + 0.5 * hgt + 0.3 * stre);
};

// The fit to a base takes out the group's weighted mean, which shrinks a lean most in a 2-sub group (a +10 on one of two is +5/-5), so
// smaller groups' offsets are scaled up to give every base a similar spread of shapes
const GROUP_SCALE = SUB_DEFS.map((d) => {
	const n = SUB_DEFS.filter((d2) => d2.base === d.base).length;
	return n <= 2 ? 1.5 : n === 3 ? 1.15 : 1;
});

const bases = (r: RatingsLike) => SUB_DEFS.map((d) => num(r, d.base, 50));

// Wanted values (base plus offsets), capped, anchored to the expanded ratings, then fitted to the bases
const finish = (offsets: readonly number[], r: RatingsLike) => {
	const b = bases(r);
	const x = b.map((v, i) => v + GROUP_SCALE[i]! * offsets[i]!);
	applySanityCaps(x, r);
	const flex = new Array<number>(NUM_SUBS).fill(1);
	return anchorAndFit(x, r, flex);
};

// Anchor wanted values to the expanded ratings and fit them to the bases. A few rounds where a sub is clamped at 0 or 100 (one round
// of anchoring and fitting doesn't get all the way there), so a later sync finds nothing to do.
export const anchorAndFit = (
	x: number[],
	r: RatingsLike,
	flex: number[],
	// Wider Sub-Rating Shapes: the anchoring corrections, like the fit, move a standout or a hole less (flex as protect weights)
	wide?: boolean,
): number[] => {
	const protect = wide ? [...flex] : undefined;
	anchorToExpanded(x, r, flex, protect);
	let out = fitSubsToBases(x, r, flex);
	const hasExpanded =
		typeof r.oreb === "number" ||
		typeof r.pdef === "number" ||
		typeof r.bsc === "number";
	if (!hasExpanded) {
		return out;
	}
	for (let round = 0; round < 4; round++) {
		if (anchorError(out, r) <= ANCHOR_TOLERANCE) {
			break;
		}
		const x2 = [...out];
		const flex2 = new Array<number>(NUM_SUBS).fill(1);
		anchorToExpanded(x2, r, flex2, protect);
		const next = fitSubsToBases(x2, r, flex2);
		const same = next.every((v, i) => v === out[i]);
		out = next;
		if (same) {
			break;
		}
	}
	return out;
};

export const ageAtDraft = (p: {
	born: { year: number; loc: string };
	draft: { year: number };
}) => p.draft.year - p.born.year;

export type GenContext = {
	background?: Background;
	// Prospect story (college careers): a project is raw, an older international a polished passer and shooter
	story?: string;
	// Wider Sub-Rating Shapes (the subRatingsWide setting): generateWideShape instead of the stock shape
	wide?: boolean;
};

// The largest offset of a sub from its base, in a fitted row
// (The subs that follow an expanded rating are left out: their place is the expanded rating's, not the shape's)
export const maxOffset = (sub: readonly number[], r: RatingsLike) => {
	let m = 0;
	for (let i = 0; i < NUM_SUBS; i++) {
		if (
			(i === SUB_INDEX.sec && typeof r.bsc === "number") ||
			((i === SUB_INDEX.orb || i === SUB_INDEX.drd) &&
				typeof r.oreb === "number")
		) {
			continue;
		}
		const o = sub[i]! - num(r, SUB_DEFS[i]!.base, 50);
		if (o > m) {
			m = o;
		}
	}
	return m;
};
// A shape at least this extreme counts as generational (at most MAX_GENERATIONAL per class)
export const GENERATIONAL_OFFSET = 20;
export const MAX_GENERATIONAL = 2;
export const SPECIALIST_CHANCE = 0.035;

const SIGNATURE_CHANCE = 0.78;
const WEAKNESS_CHANCE = 0.72;

// A generated (fictional) player's shape. Deterministic given the seed, his ratings and context.
export const generateSubShape = (
	r: RatingsLike,
	seed: number,
	ctx: GenContext = {},
	// Class caps: scale an extreme shape down
	damp: number = 1,
): { sub: number[]; info: StoredSubInfo } => {
	if (ctx.wide) {
		return generateWideShape(r, seed, ctx, damp);
	}
	const rng = new Rng(`subr|${seed}`);
	const build = pickBuild(r, rng);
	const background = ctx.background ?? "college";
	const specialist = rng.chance(SPECIALIST_CHANCE);

	const leans = z();
	addTo(leans, build.lean, rng.uniform(0.6, 1.2) * (specialist ? 1.9 : 1));
	if (ctx.story === "project") {
		addTo(leans, TAG_LEANS.raw!);
	}

	const offsets = physicalLean(r);
	addTo(offsets, leans);
	addTo(offsets, BACKGROUND_LEANS[background]);
	if (ctx.story === "olderIntl" && background !== "intl") {
		addTo(offsets, BACKGROUND_LEANS.intl, 0.5);
	}
	for (const f of FACTORS) {
		addTo(offsets, f.v, rng.normal(0, f.sd));
	}
	for (let i = 0; i < NUM_SUBS; i++) {
		offsets[i]! += rng.normal(0, NOISE_SD);
	}

	// Signature skill and a clear weakness, among what his build leans to (and away from)
	const pos = SUB_DEFS.map((_, i) => i).filter((i) => leans[i]! > 0.5);
	const neg = SUB_DEFS.map((_, i) => i).filter((i) => leans[i]! < -0.5);
	let signature: number | undefined;
	if ((specialist || rng.chance(SIGNATURE_CHANCE)) && pos.length > 0) {
		signature = rng.weighted(pos, (i) => leans[i]! ** 1.5);
		offsets[signature]! += specialist
			? rng.uniform(14, 20)
			: rng.uniform(6, 11);
	}
	if ((specialist || rng.chance(WEAKNESS_CHANCE)) && neg.length > 0) {
		const weakness = rng.weighted(neg, (i) => (-leans[i]!) ** 1.5);
		offsets[weakness]! -= rng.uniform(6, 11);
	}

	if (damp !== 1) {
		for (let i = 0; i < NUM_SUBS; i++) {
			offsets[i]! *= damp;
		}
	}

	const g = profileIndex(rng, background, ctx.story);
	const info: StoredSubInfo = {
		v: SUB_RATINGS_VERSION,
		s: seed,
		g,
		b: build.a.name,
	};
	if (GROWTH_PROFILES[g] === "oneSkill") {
		info.o =
			signature ??
			rng.weighted(
				SUB_DEFS.map((_, i) => i),
				(i) => Math.max(0.1, leans[i]!),
			);
	}
	if (specialist) {
		info.sp = 1;
	}
	const sub = finish(offsets, r);
	if (maxOffset(sub, r) >= GENERATIONAL_OFFSET) {
		info.gen = 1;
	}
	return { sub, info };
};

const profileIndex = (rng: Rng, background: Background, story?: string) => {
	const shares = [...PROFILE_SHARES[background]];
	if (story === "lateBloomer") {
		shares[2]! += 0.5;
	}
	const idx = shares.map((_, i) => i);
	return rng.weighted(idx, (i) => shares[i]!);
};

// Wider Sub-Rating Shapes (the subRatingsWide setting) ------------------------------------------------------------------------------
//
// The stock shapes are narrow: small noise (sd 2.5) and factors (sd 3), and the fit to a base takes the group's weighted mean out of the
// wanted offsets, so a lean of +10 on one of two subs ends up +5/-5. The wide shapes (measured against real players, see
// docs/native-features.md, Sub-ratings, Wider shapes):
// - noise sized per base (shooting and finishing wide, the athletic ones narrow: WIDE.noise);
// - opposing factors (catch-and-shoot vs off the dribble, ball security vs shot creation, post vs touch, contact vs finesse, rim vs
//   perimeter defense, vision vs accuracy, straight-line vs lateral, standing reach vs max vertical, offensive vs defensive boards);
// - fat tails: about 13% are lopsided (one or two subs 15-25 off their base), specialists twice as common, larger signatures and
//   weaknesses, a looser generational cap (an offset of 28+, three a class);
// - standouts protected in the fit: a sub far from its base moves little and its siblings take up the rest, so a +20 stays about +18
//   (the base never moves: base ratings, ovr and the game's random numbers stay exactly what they are without the setting);
// - looser sanity caps where the body allows it (length and leaping for blocks, size and strength for the post), impossible combos
//   still capped (wideSanityCaps).
// Same seed string and the same build draw as the stock shape, so a player's build (and the archetype his shape points to) is the same.
export const WIDE = {
	specialist: 0.06,
	specialistLean: 1.7,
	signature: [6, 11] as const,
	specialistSignature: [14, 20] as const,
	weakness: [6, 11] as const,
	lopsided: 0.13,
	lopsidedTwo: 0.35,
	lopsidedSize: [15, 25] as const,
	// Share of lopsided subs that are a hole rather than a standout
	lopsidedHole: 0.3,
	generational: 28,
	maxGenerational: 3,
	// No sub further than this from its base (fitWide)
	maxOffset: 32,
	// Fit protection: a sub's flex in the fit is 1 / (1 + (|offset| / protect)^2)
	protect: 8,
	noise: {
		diq: 3,
		tp: 3.5,
		ins: 2.5,
		dnk: 2.5,
		fg: 3,
		reb: 1.5,
		drb: 2.5,
		pss: 1,
		spd: 1,
		jmp: 1.5,
	} as Record<string, number>,
	// Development: mean reversion a year (to 23, then from 24), and how hard a far-out sub is pulled back (beyond `far`)
	revertYoung: 0.02,
	revertOld: 0.005,
	far: 28,
	farRevert: 0.15,
	// Role growth (a season's role, from his box score) per season at full minutes
	role: 0.9,
};

// Keeps the league's mean offsets where the stock shapes have them (measured: subLeans.script.test.ts, Expanded Ratings on), so the
// game sim's calibration (Sub-Ratings in Sim) holds: the protected fit and the tails leave range about a point lower and catch-and-shoot
// a point higher than the stock shapes do, contact finishing half a point higher, ...
const WIDE_CENTER = lean({
	rng: 1,
	tcs: -1,
	con: -0.5,
	fns: 0.5,
	pul: -0.4,
	spu: 0.4,
	stj: 0.4,
	mxv: -0.4,
	sls: -0.3,
	lat: 0.3,
});

const OPPOSING: { sd: number; v: number[] }[] = [
	// Catch-and-shoot vs off the dribble
	{ sd: 3.5, v: lean({ tcs: 1, spu: 0.8, tod: -1, pul: -0.8 }) },
	// Ball security vs shot creation
	{ sd: 3, v: lean({ sec: 1, acc: 0.4, crt: -1, hnd: -0.3 }) },
	// Post vs face-up touch
	{ sd: 2, v: lean({ pst: 1, cls: 0.3, flt: -1, fns: -0.3 }) },
	// Contact vs finesse
	{ sd: 2.5, v: lean({ con: 1, fns: -1 }) },
	// Rim vs perimeter defense
	{ sd: 2.5, v: lean({ blk: 1, idf: 0.6, stl: -0.8, pdf: -0.6 }) },
	// Vision vs accuracy (the risky creative passer vs the safe one)
	{ sd: 0.5, v: lean({ vis: 1, acc: -1 }) },
	// Straight-line vs lateral
	{ sd: 0.5, v: lean({ sls: 1, lat: -1 }) },
	// Standing reach vs max vertical
	{ sd: 1, v: lean({ stj: 1, mxv: -1 }) },
	// Offensive vs defensive boards
	{ sd: 1, v: lean({ orb: 1, drd: -1 }) },
];

// The fit takes the group's weighted mean out, which halves noise in a group of two: scale the diffuse part of a wide shape back up
const WIDE_GROUP_SCALE = SUB_DEFS.map((d) => {
	const n = SUB_DEFS.filter((d2) => d2.base === d.base).length;
	return n <= 2 ? 1.4 : n === 3 ? 1.15 : 1.05;
});

// Sanity caps with the wide shapes: what the body allows. Elite shot blocking needs length and leaping (a little looser than the stock
// cap, more for leapers), a post game size or strength, power finishing some strength, size or leaping; elite lateral quickness isn't
// a 7'2" center, nor far above his speed; max vertical not far above his leaping. Holes are floored the same way (a 7-footer's
// standing reach, a strong big's contact finishing).
export const wideSanityCaps = (x: number[], r: RatingsLike) => {
	const hgt = num(r, "hgt", 47);
	const len = typeof r.wng === "number" ? (hgt + r.wng) / 2 : hgt;
	const jmp = num(r, "jmp", 50);
	const stre = num(r, "stre", 45);
	const spd = num(r, "spd", 50);
	const cap = (key: string, max: number) => {
		const i = SUB_INDEX[key]!;
		if (x[i]! > max) {
			x[i] = max;
		}
	};
	const floor = (key: string, min: number) => {
		const i = SUB_INDEX[key]!;
		if (x[i]! < min) {
			x[i] = min;
		}
	};
	cap("blk", 43 + 0.5 * len + 0.35 * jmp);
	cap("lat", Math.min(100 - 1.2 * Math.max(0, hgt - 58), spd + 32));
	cap("pst", 55 + 0.5 * hgt + 0.35 * stre);
	cap("con", 52 + 0.35 * stre + 0.3 * jmp + 0.2 * hgt);
	cap("mxv", jmp + 30);
	floor("stj", 0.5 * hgt - 5);
	floor("con", 0.3 * stre + 0.15 * hgt - 10);
};

// Flex in the fit: a sub far from its base (a standout or a hole) moves little, its siblings take up the rest
const protectFlex = (x: readonly number[], r: RatingsLike) =>
	SUB_DEFS.map((d, i) => {
		const o = (x[i]! - num(r, d.base, 50)) / WIDE.protect;
		return 1 / (1 + o * o);
	});

// The subs that follow an expanded rating outright (their place is the expanded rating's): never a lopsided pick
const anchoredOutright = (r: RatingsLike) => {
	const out = new Set<number>();
	if (typeof r.oreb === "number") {
		out.add(SUB_INDEX.orb!);
		out.add(SUB_INDEX.drd!);
	}
	if (typeof r.bsc === "number") {
		out.add(SUB_INDEX.sec!);
	}
	return out;
};

const finishWide = (
	diffuse: readonly number[],
	point: readonly number[],
	r: RatingsLike,
) => {
	const b = bases(r);
	const x = b.map((v, i) => v + WIDE_GROUP_SCALE[i]! * diffuse[i]! + point[i]!);
	return fitWide(x, r);
};

// The protected fit, and no sub further than WIDE.maxOffset from its base: where every sub of a group leans far (a real shooter's range
// and catch-and-shoot far up, his off-the-dribble far down), the protected fit can leave one 40+ away; that group's wanted offsets are
// scaled down until none is
const fitWide = (x: number[], r: RatingsLike) => {
	wideSanityCaps(x, r);
	let out = anchorAndFit([...x], r, protectFlex(x, r), true);
	for (let iter = 0; iter < 8; iter++) {
		let over = false;
		for (const group of SUB_GROUPS) {
			const b = num(r, group.base, 50);
			if (group.idx.some((i) => Math.abs(out[i]! - b) > WIDE.maxOffset)) {
				over = true;
				for (const i of group.idx) {
					x[i] = b + 0.85 * (x[i]! - b);
				}
			}
		}
		if (!over) {
			break;
		}
		out = anchorAndFit([...x], r, protectFlex(x, r), true);
	}
	return out;
};

export const generateWideShape = (
	r: RatingsLike,
	seed: number,
	ctx: GenContext = {},
	damp: number = 1,
): { sub: number[]; info: StoredSubInfo } => {
	const rng = new Rng(`subr|${seed}`);
	const build = pickBuild(r, rng);
	const background = ctx.background ?? "college";
	const specialist = rng.chance(WIDE.specialist);

	const leans = z();
	addTo(
		leans,
		build.lean,
		rng.uniform(0.6, 1.2) * (specialist ? WIDE.specialistLean : 1),
	);
	if (ctx.story === "project") {
		addTo(leans, TAG_LEANS.raw!);
	}

	const diffuse = physicalLean(r);
	addTo(diffuse, leans);
	addTo(diffuse, BACKGROUND_LEANS[background]);
	if (ctx.story === "olderIntl" && background !== "intl") {
		addTo(diffuse, BACKGROUND_LEANS.intl, 0.5);
	}
	for (const f of FACTORS) {
		addTo(diffuse, f.v, rng.normal(0, f.sd));
	}
	for (const f of OPPOSING) {
		addTo(diffuse, f.v, rng.normal(0, f.sd));
	}
	for (let i = 0; i < NUM_SUBS; i++) {
		diffuse[i]! += rng.normal(0, WIDE.noise[SUB_DEFS[i]!.base]!);
	}

	// Signature, weakness and the fat tails: point offsets, not scaled for the group size (the fit protects them)
	const point = z();
	addTo(point, WIDE_CENTER);
	const pos = SUB_DEFS.map((_, i) => i).filter((i) => leans[i]! > 0.5);
	const neg = SUB_DEFS.map((_, i) => i).filter((i) => leans[i]! < -0.5);
	let signature: number | undefined;
	if ((specialist || rng.chance(SIGNATURE_CHANCE)) && pos.length > 0) {
		signature = rng.weighted(pos, (i) => leans[i]! ** 1.5);
		point[signature]! += specialist
			? rng.uniform(...WIDE.specialistSignature)
			: rng.uniform(...WIDE.signature);
	}
	if ((specialist || rng.chance(WEAKNESS_CHANCE)) && neg.length > 0) {
		const weakness = rng.weighted(neg, (i) => (-leans[i]!) ** 1.5);
		point[weakness]! -= rng.uniform(...WIDE.weakness);
	}
	const lopsided = rng.chance(WIDE.lopsided);
	if (lopsided) {
		const skip = anchoredOutright(r);
		const n = rng.chance(WIDE.lopsidedTwo) ? 2 : 1;
		const used = new Set<number>(skip);
		for (let k = 0; k < n; k++) {
			const hole = rng.chance(WIDE.lopsidedHole);
			const cands = SUB_DEFS.map((_, i) => i).filter((i) => !used.has(i));
			// A standout where his build leans (a hole where it leans away), any sub a little
			const i = rng.weighted(cands, (j) =>
				Math.max(0.15, hole ? -leans[j]! : leans[j]!),
			);
			used.add(i);
			const size = rng.uniform(...WIDE.lopsidedSize);
			// What the sub already has counts toward it
			point[i] = (hole ? -size : size) - WIDE_GROUP_SCALE[i]! * diffuse[i]!;
		}
	}

	if (damp !== 1) {
		for (let i = 0; i < NUM_SUBS; i++) {
			diffuse[i]! *= damp;
			point[i]! *= damp;
		}
	}

	const g = profileIndex(rng, background, ctx.story);
	const info: StoredSubInfo = {
		v: SUB_RATINGS_VERSION,
		s: seed,
		g,
		b: build.a.name,
	};
	if (GROWTH_PROFILES[g] === "oneSkill") {
		info.o =
			signature ??
			rng.weighted(
				SUB_DEFS.map((_, i) => i),
				(i) => Math.max(0.1, leans[i]!),
			);
	}
	if (specialist) {
		info.sp = 1;
	}
	if (lopsided) {
		info.lop = 1;
	}
	const sub = finishWide(diffuse, point, r);
	if (maxOffset(sub, r) >= WIDE.generational) {
		info.gen = 1;
	}
	return { sub, info };
};

// Existing leagues, real players, imported players: a neutral shape (subs near their base) with a lean from size and physicals, a
// seeded growth profile, no build, signature or weakness
export const neutralSubShape = (
	r: RatingsLike,
	seed: number,
): { sub: number[]; info: StoredSubInfo } => {
	const rng = new Rng(`subn|${seed}`);
	const offsets = physicalLean(r);
	addTo(offsets, bandLean(r), 0.6);
	for (const f of FACTORS) {
		addTo(offsets, f.v, 0.5 * rng.normal(0, f.sd));
	}
	for (let i = 0; i < NUM_SUBS; i++) {
		offsets[i]! += rng.normal(0, 1.5);
	}
	const g = profileIndex(rng, "college");
	const info: StoredSubInfo = { v: SUB_RATINGS_VERSION, s: seed, g, n: 1 };
	if (GROWTH_PROFILES[g] === "oneSkill") {
		info.o = rng.int(0, NUM_SUBS - 1);
	}
	return { sub: finish(offsets, r), info };
};

// Parse a stored real-player lean (tools/realSubRatings.ts: 25 comma-separated ints)
export const parseSubLean = (lean: unknown): number[] | undefined => {
	if (typeof lean !== "string") {
		return;
	}
	const out = lean.split(",").map(Number);
	if (out.length !== NUM_SUBS || out.some((v) => !Number.isFinite(v))) {
		return;
	}
	return out;
};

// A real player's shape from his real stats: the lean derived from his box scores (blocks from BLK%, range from 3PA rate, vision from
// AST%, ...; already scaled by how sure the stats are), fitted to his bases so every base is exact. Deterministic, no noise (the stats
// are the shape); the growth profile is seeded like a neutral shape's.
export const realSubShape = (
	r: RatingsLike,
	seed: number,
	lean: readonly number[],
	// Wider Sub-Rating Shapes: the wide lean (wideRealLean), its looser caps and the fit that protects standouts
	wide?: boolean,
): { sub: number[]; info: StoredSubInfo } => {
	const { info } = neutralSubShape(r, seed);
	info.rs = 1;
	const b = bases(r);
	const x = b.map((v, i) => v + lean[i]!);
	if (wide) {
		return { sub: fitWide(x, r), info };
	}
	applySanityCaps(x, r);
	const flex = new Array<number>(NUM_SUBS).fill(1);
	return { sub: anchorAndFit(x, r, flex), info };
};

// "Vary real players' sub-ratings": a real player's lean plus small bounded noise (sd 3, at most 6 points), seeded by his seed (and so by
// the league salt), so famous shapes stay recognizable but two leagues differ a little
export const VARY_REAL_SD = 3;
export const VARY_REAL_MAX = 6;
export const varyRealLean = (lean: readonly number[], seed: number) => {
	const rng = new Rng(`subvary|${seed}`);
	return lean.map(
		(v) =>
			v +
			Math.max(
				-VARY_REAL_MAX,
				Math.min(VARY_REAL_MAX, rng.normal(0, VARY_REAL_SD)),
			),
	);
};

// A uint32 seed from a string
export const seedFromString = (s: string) =>
	Math.floor(new Rng(`subseed|${s}`).random() * 4294967296);

// A generated player's seed: from things already drawn about him (name, birth, ratings), so no extra random number is drawn
export const seedForGenerated = (p: {
	firstName: string;
	lastName: string;
	born: { year: number; loc: string };
	ratings: RatingsLike[];
}) => {
	const r = p.ratings[0]!;
	return seedFromString(
		`${p.firstName}|${p.lastName}|${p.born.year}|${p.born.loc}|${SUB_BASES.map((b) => r[b]).join(",")},${r.hgt},${r.stre},${r.endu},${r.oiq},${r.ft},${r.fuzz}`,
	);
};

// An existing player's seed: his pid, else something stable about him
export const seedForExisting = (p: {
	pid?: number;
	srID?: string;
	firstName?: string;
	lastName?: string;
	born?: { year: number };
}) =>
	seedFromString(
		typeof p.pid === "number"
			? `pid|${p.pid}`
			: `${p.srID ?? ""}|${p.firstName ?? ""}|${p.lastName ?? ""}|${p.born?.year ?? ""}`,
	);

// Development ---------------------------------------------------------------------------------------------------------------------

// How much of a base's change each sub takes (relative), by how it ages, the player's age, and whether the base went up or down
const agingMult = (
	aging: (typeof SUB_DEFS)[number]["aging"],
	age: number,
	up: boolean,
	profile: GrowthProfile,
) => {
	let m: number;
	if (up) {
		if (age <= 22) {
			m = aging === "fade" ? 1.2 : aging === "hold" ? 0.9 : 1;
		} else if (age <= 26) {
			m = aging === "fade" ? 0.8 : aging === "hold" ? 1.2 : 1;
		} else {
			m = aging === "fade" ? 0.5 : aging === "hold" ? 1.4 : 1;
		}
		if (profile === "earlyPeaker" && age <= 23 && aging === "fade") {
			m *= 1.5;
		} else if (profile === "lateBloomer" && aging === "hold") {
			m *= age >= 25 ? 2 : 1.5;
		} else if (profile === "athleteLearner" && age <= 25) {
			m *= aging === "fade" ? 0.6 : aging === "hold" ? 1.6 : 1;
		}
	} else {
		const old = age >= (profile === "earlyPeaker" ? 26 : 28);
		if (aging === "fade") {
			m = old ? (age >= 31 ? 2 : 1.6) : 1.2;
			if (profile === "earlyPeaker" && old) {
				m *= 1.3;
			}
		} else if (aging === "hold") {
			m = old ? 0.5 : 0.7;
		} else {
			m = 1;
		}
	}
	if (profile === "finished") {
		m = 1 + 0.4 * (m - 1);
	}
	return m;
};

// Shape drift with age, even when a base holds: from 28 (26 for an early peaker) the fade subs lose ground to the hold ones
const agingDrift = (
	aging: (typeof SUB_DEFS)[number]["aging"],
	age: number,
	profile: GrowthProfile,
) => {
	const from = profile === "earlyPeaker" ? 26 : 28;
	if (age < from) {
		return 0;
	}
	const k = age >= 32 ? 1 : 0.6;
	return aging === "fade" ? -k : aging === "hold" ? 0.5 * k : 0;
};

const DEV_NOISE = 0.7;
const ANCHOR_TOLERANCE = 1.5;
const DEV_REVERT = 0.02;

// One season of development of the subs, after the bases developed (stock development, unchanged): each base's change is spread over
// its subs by how they age and the growth profile, the shape drifts a little, then the subs are fitted to the new bases.
// before: the ten bases (SUB_BASES order) before the season's development.
export const developSubs = (
	sub: readonly number[],
	r: RatingsLike,
	before: readonly number[],
	age: number,
	info: StoredSubInfo,
	// Wider Sub-Rating Shapes: less mean reversion from 24, a pull back only for subs very far out, and growth from his role (roleLean)
	wide?: { role?: readonly number[] },
): number[] => {
	const profile = GROWTH_PROFILES[info.g] ?? "normal";
	const rng = new Rng(`subd|${info.s}|${r.season}|${age}`);
	const x = [...sub];
	const flex = new Array<number>(NUM_SUBS).fill(1);
	SUB_GROUPS.forEach((group, gi) => {
		const delta = r[group.base] - before[gi]!;
		const ms = group.idx.map((i) => {
			let m = agingMult(SUB_DEFS[i]!.aging, age, delta >= 0, profile);
			if (profile === "oneSkill" && info.o === i && delta > 0) {
				m *= 3;
			}
			return m;
		});
		let denom = 0;
		group.idx.forEach((_, j) => {
			denom += (group.w[j]! * ms[j]!) / 100;
		});
		const noiseSd = profile === "finished" ? 0.4 * DEV_NOISE : DEV_NOISE;
		const newBase = r[group.base] as number;
		group.idx.forEach((i, j) => {
			let v = x[i]! + (delta * ms[j]!) / denom;
			v += agingDrift(SUB_DEFS[i]!.aging, age, profile);
			v += rng.normal(0, noiseSd);
			if (wide) {
				// Less reversion once he's grown into his game; a sub very far out is still pulled back a little
				const off = v - newBase;
				v -= (age < 24 ? WIDE.revertYoung : WIDE.revertOld) * off;
				const excess = Math.abs(off) - WIDE.far;
				if (excess > 0) {
					v -= Math.sign(off) * WIDE.farRevert * excess;
				}
				v += wide.role?.[i] ?? 0;
			} else {
				// A little mean reversion, so the shape drifts without spreading out over a long career
				v -= DEV_REVERT * (v - newBase);
			}
			x[i] = v;
			flex[i] = ms[j]!;
		});
	});
	return anchorAndFit(x, r, flex);
};

// Wider Sub-Rating Shapes: what his role last season grows (a season's nudge to each sub, before the fit to the bases). A spot-up shooter
// (many threes, low usage) grows catch-and-shoot and spot-up, a primary handler (high usage and assists) off-the-dribble shooting, pull-ups,
// handle and shot creation, a playmaker vision, a post scorer post moves, a rim finisher contact finishing and close shots, a mid-range
// shooter his pull-up or spot-up, a rim protector blocks, a ball hawk steals. Scaled by his minutes (min / (min + 1000)) and his age
// (full to 27, then 0.6). Box-score totals of his regular season(s).
export type RoleStats = {
	min: number;
	fga: number;
	tpa: number;
	fta: number;
	fgaAtRim: number;
	fgaLowPost: number;
	fgaMidRange: number;
	// Rates, minutes-weighted
	usgp: number;
	astp: number;
	blkp: number;
	stlp: number;
};
export const roleLean = (st: RoleStats, age: number): number[] | undefined => {
	if (st.min < 200 || st.fga <= 0) {
		return;
	}
	const k = WIDE.role * (st.min / (st.min + 1000)) * (age <= 27 ? 1 : 0.6);
	const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
	const out = z();
	const add = (o: Record<string, number>, amount: number) => {
		if (amount <= 0) {
			return;
		}
		for (const [key, v] of Object.entries(o)) {
			out[SUB_INDEX[key]!]! += k * amount * v;
		}
	};
	const three = st.tpa / st.fga;
	const rim = st.fgaAtRim / st.fga;
	const post = st.fgaLowPost / st.fga;
	const mid = st.fgaMidRange / st.fga;
	const lowUsage = clamp01((22 - st.usgp) / 8);
	const highUsage = clamp01((st.usgp - 22) / 8);
	add(
		{ tcs: 1, spu: 0.6, tod: -0.4 },
		clamp01((three - 0.3) / 0.25) * lowUsage,
	);
	add(
		{ tod: 1, pul: 1, hnd: 0.6, crt: 0.8, tcs: -0.3 },
		highUsage * clamp01((st.astp - 12) / 15),
	);
	add({ vis: 1, acc: 0.3 }, clamp01((st.astp - 20) / 15));
	add({ pst: 1, flt: -0.3 }, clamp01((post - 0.12) / 0.15));
	add({ con: 0.8, cls: 0.6, fns: -0.2 }, clamp01((rim - 0.35) / 0.25));
	add(st.usgp >= 22 ? { pul: 1 } : { spu: 1 }, clamp01((mid - 0.2) / 0.2));
	add({ blk: 1, idf: 0.4, stl: -0.3 }, clamp01((st.blkp - 3) / 4));
	add({ stl: 1, pdf: 0.3 }, clamp01((st.stlp - 1.8) / 1.5));
	return out;
};

// Keep the subs of a row in sync with its bases (and its expanded ratings): a base that changed outside development moves its subs
// with it, keeping the shape
export const syncRowSubs = (r: RatingsLike) => {
	const sub = r.sub as number[];
	const hasExpanded =
		typeof r.oreb === "number" ||
		typeof r.pdef === "number" ||
		typeof r.bsc === "number";
	if (!hasExpanded) {
		const out = refitSubs(sub, r);
		if (out !== sub) {
			r.sub = out;
			return true;
		}
		return false;
	}
	// Already in sync (rounding leaves the anchored subs up to a point off): nothing to do, so syncing never wobbles
	if (subsMatchBases(r) && anchorError(sub, r) <= ANCHOR_TOLERANCE) {
		return false;
	}
	const out = anchorAndFit([...sub], r, new Array<number>(NUM_SUBS).fill(1));
	for (let i = 0; i < NUM_SUBS; i++) {
		if (out[i] !== sub[i]) {
			r.sub = out;
			return true;
		}
	}
	return false;
};
