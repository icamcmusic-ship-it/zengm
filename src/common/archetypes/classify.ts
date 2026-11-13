import { ARCHETYPE_DEFS, SCORING_DEFS } from "./defs.data.ts";
import {
	DIM_LABELS,
	DIM_RATINGS,
	DIMS,
	hasExpanded,
	STYLE_DIMS,
} from "./composites.ts";
import { DEFAULT_NORMS } from "./norms.data.ts";
import { DEFAULT_NORMS_EXPANDED } from "./normsExpanded.data.ts";
import { matchZ } from "./match.ts";
import { mergedId } from "./merges.data.ts";
import {
	ALL_AROUND_MISS,
	ALL_AROUND_Z,
	LEAD_MIN_K,
	PROMISE_K,
	PROMISE_STEP,
	REB_PERIM_K,
	CATCH_ALL_K,
	TRAIT_GROUPS,
	absoluteParts,
	catchAllShortfall,
	traitGroupValue,
	allAroundQuality,
	classValues,
	creatorTerm,
	genericPenalty,
	needPenaltyOf,
	needShortfall,
	passingBigBonus,
	prepare,
	promiseShortfall,
	promisesOf,
	rawMatch,
	roleParts,
	signatureTerm,
	standoutBonus,
	standoutsOf,
	starWeight,
	twoWayBonus,
	weightsOf,
	type Prepared,
	type ReadOptions,
	type Standout,
} from "./score.ts";
import { familyOf, FAMILIES, type Family } from "./families.ts";
import {
	CLASS_FEATS,
	TERMS,
	familyProbs,
	type FittedModel,
	type Term,
} from "./model.ts";
import { FITTED } from "./fitted.data.ts";
import { ptTerm, subTerm } from "./subStyle.ts";
import { nameAt } from "./posNames.ts";
import { FITTED_EXPANDED } from "./fittedExpanded.data.ts";
import { ovrPercentile } from "./norms.ts";
import { STAR_BIAS } from "./starBias.data.ts";
import { archetypePrior, isPos, positionOf } from "./position.ts";
import type {
	Archetype,
	ArchetypeRatings,
	ArchetypeTraitKey,
	ArchetypeTraits,
	Classification,
	DimKey,
	Norms,
	Pos,
	SkillLabel,
	Tier,
	Why,
} from "./types.ts";

// The built-in reference league: one generated with the Expanded Ratings setting on for players who have those ratings
// (their composites, the two defense ratings and length are distributed differently), else the stock one
export const defaultNorms = (expanded: boolean): Norms =>
	expanded ? DEFAULT_NORMS_EXPANDED : DEFAULT_NORMS;
export const defaultNormsFor = (ratings: ArchetypeRatings): Norms =>
	defaultNorms(hasExpanded(ratings));

export const ARCHETYPES: Archetype[] = ARCHETYPE_DEFS;
const BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));
// arch15: the profiles the reading scores (defs.data.ts SCORING_DEFS): a build merged in arch15 is one of the kept build's
// profiles, and the build is read as its best profile
export const SCORING_ARCHETYPES: Archetype[] = SCORING_DEFS;
// The profiles to score for a list of builds: the full builds' profiles for the build list itself
const scoringFor = (archetypes: Archetype[]) =>
	archetypes === ARCHETYPES ? SCORING_ARCHETYPES : archetypes;
// The build a scored profile stands for
const publicOf = (a: Archetype): Archetype => BY_ID.get(a.out ?? a.id) ?? a;
export const archetypeById = (id: string) => BY_ID.get(id);
export const archetypeByName = (name: string) =>
	ARCHETYPES.find((a) => a.name === name);

// Rare types need to be that much more exceptional a fit to be picked (no 2K build is marked rare now)
export const RARE_PENALTY = 0.5;
// The archetype he had keeps the label unless another is better by more than this
export const STICKY_Z = 2.4;
// Poor fit: no build his position allows really has the shape of his ratings, and the nearest one is shown. Either the
// similarity itself is low (POOR_FIT_SCORE: set at the similarity 95% of the 2K builds have to their own archetype, see
// twoK/build2k.script.test.ts), or the build's name promises a skill that is not among his better ones (he misses the
// name's floors by more than POOR_FIT_SHORT z in all)
export const POOR_FIT_SCORE = 0.5;
export const POOR_FIT_SHORT = 0.25;
export const isPoorFit = (c: { score: number; shortfall: number }) =>
	c.score < POOR_FIT_SCORE || c.shortfall > POOR_FIT_SHORT;
// How many runners-up are listed as "also close to" (never part of the label)
export const ALTERNATES = 2;
// A runner-up is only listed when its fit is within this much (in z) of the label's
export const ALTERNATE_Z = 0.6;

// Score of an archetype his position rules out: below anything a real fit can reach, but finite
export const BLOCKED_Z = -99;

// Player traits (the playerTraits setting): only the visible ones, as the user sees them. A trait-flavored label (`trait`) needs
// its trait: without traits, or below its floor, it is never picked. Above the floor, and for the labels a trait only breaks ties for (`traitTie`), a strong trait is worth up to TRAIT_TIE_K per unit of
// weight, from a score of TRAIT_TIE_FROM up to TRAIT_TIE_FROM + TRAIT_TIE_SPAN: small, so traits never outweigh the ratings.
export const VISIBLE_TRAITS: ReadonlySet<string> = new Set<ArchetypeTraitKey>([
	"shotDiscipline",
	"offBall",
	"screen",
	"hustle",
	"foulDiscipline",
	"handle",
	"veteranSavvy",
	"motor",
	"defensiveVersatility",
]);
export const TRAIT_TIE_K = 0.15;
const TRAIT_TIE_FROM = 55;
const TRAIT_TIE_SPAN = 20;
// A trait label he qualifies for: up to this much (a stronger trait than the floor asks for counts more)
export const TRAIT_LABEL_K = 0.25;
const TRAIT_LABEL_SPAN = 15;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// Only the visible traits, whatever the caller passed (the trait-flavored labels and tie-breaks read these)
export const visibleTraits = (
	traits: Partial<Record<string, number>> | undefined,
): ArchetypeTraits | undefined => {
	if (!traits) {
		return undefined;
	}
	const out: ArchetypeTraits = {};
	for (const [k, v] of Object.entries(traits)) {
		if (VISIBLE_TRAITS.has(k) && typeof v === "number" && Number.isFinite(v)) {
			out[k as ArchetypeTraitKey] = v;
		}
	}
	return out;
};
// arch14 (user request): the fitted trait terms read every trait, hidden ones too (score.ts TRAIT_GROUPS)
export const allTraits = (
	traits: Partial<Record<string, number>> | undefined,
): Partial<Record<string, number>> | undefined => {
	if (!traits) {
		return undefined;
	}
	const out: Partial<Record<string, number>> = {};
	for (const [k, v] of Object.entries(traits)) {
		if (typeof v === "number" && Number.isFinite(v)) {
			out[k] = v;
		}
	}
	return out;
};

// What his traits add to (or take from) one label's fit; undefined: a trait label he cannot have (no traits)
export const traitTerm = (
	a: Archetype,
	traits: ArchetypeTraits | undefined,
): number | undefined => {
	let t = 0;
	if (a.trait) {
		const s = traits?.[a.trait.key];
		if (s === undefined) {
			return undefined;
		}
		// A hard gate: the label names the trait
		if (s < a.trait.min) {
			return undefined;
		}
		t +=
			TRAIT_LABEL_K *
			(0.5 + 0.5 * clamp01((s - a.trait.min) / TRAIT_LABEL_SPAN));
	}
	if (a.traitTie && traits) {
		for (const [k, w] of Object.entries(a.traitTie) as [
			ArchetypeTraitKey,
			number,
		][]) {
			const s = traits[k];
			if (s !== undefined) {
				t += TRAIT_TIE_K * w * clamp01((s - TRAIT_TIE_FROM) / TRAIT_TIE_SPAN);
			}
		}
	}
	return t;
};

// raw: similarity of shape, 0..1; z: how exceptional the fit is; short: how far he is from what the name promises (z)
export type Scored = { a: Archetype; raw: number; z: number; short: number };

// arch14: one build's terms for one player, before the fitted weights (model.ts): `f` per TERMS, `cls` per CLASS_FEATS,
// `base` what is not fitted (the position prior and his traits)
export type BuildTerms = {
	a: Archetype;
	// arch15: the build this profile is read as (a itself, or the build it was merged into)
	pub: Archetype;
	raw: number;
	short: number;
	blocked: boolean;
	base: number;
	f: number[];
	cls: number[];
	fam: Family;
};
const TERM_INDEX = Object.fromEntries(TERMS.map((t, i) => [t, i])) as Record<
	Term,
	number
>;

// What the family classifier reads about him (model.ts FAM_FEATS)
export const familyFeatures = (
	p: Prepared,
	cv: Record<string, number>,
	prospect: boolean | undefined,
): number[] => {
	const z = p.stats?.z ?? {};
	return [
		1,
		cv.shoot!,
		cv.mid!,
		cv.finish!,
		cv.post!,
		cv.handle!,
		cv.pass!,
		cv.reb!,
		cv.rimD!,
		cv.perD!,
		cv.ath!,
		cv.stre!,
		(p.hgt - 50) / 10,
		p.pzLevel,
		prospect ? 1 : 0,
		z.usg ?? 0,
		z.pss ?? 0,
		z.three ?? 0,
		z.reb ?? 0,
		z.blk ?? 0,
		z.stl ?? 0,
		z.drb ?? 0,
		...styleFamilyFeatures(p),
	];
};
const styleFamilyFeatures = (p: Prepared): number[] => {
	const s = p.style.sub;
	const pt = p.style.pt;
	const f = (k: keyof NonNullable<typeof pt>["f"]) => (pt ? pt.w * pt.f[k] : 0);
	return [
		s?.blk ?? 0,
		s?.stl ?? 0,
		s?.pdf ?? 0,
		s?.cs ?? 0,
		s?.rng ?? 0,
		s?.pst ?? 0,
		s?.con ?? 0,
		s?.crt ?? 0,
		s?.vis ?? 0,
		s?.sls ?? 0,
		s?.mxv ?? 0,
		f("iso"),
		f("prb"),
		f("spot"),
		f("post"),
		f("prr"),
		f("cut"),
	];
};

// Every build's terms for one player (the fit reads these; scoreAll weighs them)
export const scoreTerms = (
	ratings: ArchetypeRatings,
	norms: Norms = defaultNormsFor(ratings),
	archetypes: Archetype[] = ARCHETYPES,
	position?: Pos,
	traitsIn?: Partial<Record<string, number>>,
	read: Omit<ReadOptions, "pos"> = {},
) => {
	const pos = position ?? positionOf(ratings);
	const p = prepare(ratings, norms, { ...read, pos });
	const cv = classValues(p);
	const standouts = standoutsOf(p, cv);
	const traits = visibleTraits(traitsIn);
	const every = allTraits(traitsIn);
	const groupVals = TRAIT_GROUPS.map((g) => traitGroupValue(g, every));
	const star = starWeight(p);
	const starBias = norms.starBias ?? STAR_BIAS;
	const calBias = norms.bias ?? defaultNorms(p.expanded).bias;
	const rows: BuildTerms[] = [];
	for (const a of scoringFor(archetypes)) {
		const pub = publicOf(a);
		const raw = rawMatch(a, p.z, p.hgt, p.skills, p.expanded);
		const prior = archetypePrior(a, pos);
		const trait = traitTerm(a, traits);
		const f = TERMS.map(() => 0);
		const cls = CLASS_FEATS.map(() => 0);
		const fam = familyOf(a);
		if (
			prior === null ||
			trait === undefined ||
			// A label about his length needs a wingspan
			(a.expanded && !p.expanded)
		) {
			rows.push({
				a,
				pub,
				raw,
				short: 0,
				blocked: true,
				base: 0,
				f,
				cls,
				fam,
			});
			continue;
		}
		const base = prior + trait - CATCH_ALL_K * catchAllShortfall(a, p, cv);
		for (const [gi, g] of TRAIT_GROUPS.entries()) {
			if (groupVals[gi] !== 0 && g.re.test(a.name)) {
				f[TERM_INDEX[g.term as Term]] = groupVals[gi]!;
			}
		}
		const bias = calBias?.[a.id] ?? 0;
		// (arch15: the trim is per build; a merged profile reads its build's)
		const starB =
			star *
			((starBias[pub.id] ?? 0) + (a.id !== pub.id ? (starBias[a.id] ?? 0) : 0));
		// arch13: the all-around star build has no profile (score.ts, allAroundQuality)
		if (a.tags.includes("allAround")) {
			const q = allAroundQuality(p, cv, read.prospect);
			if (q > 0) {
				f[TERM_INDEX.allAround] = ALL_AROUND_Z * q;
				f[TERM_INDEX.bias] = bias;
				f[TERM_INDEX.star] = starB;
			} else {
				f[TERM_INDEX.allAround] = -ALL_AROUND_MISS;
			}
			rows.push({
				a,
				pub,
				raw,
				short: q > 0 ? 0 : 1,
				blocked: false,
				base,
				f,
				cls,
				fam,
			});
			continue;
		}
		const table = norms.match[a.id];
		const need = needShortfall(a, p);
		const prom = promiseShortfall(a, cv, p);
		const short = need + prom.floor + prom.rel;
		// (a role bonus only for a build he lives up to: it fades out as he misses its floors)
		const role = roleParts(a, p, cv);
		const fade = Math.max(0, 1 - short / POOR_FIT_SHORT);
		const ab = absoluteParts(a, p);
		f[TERM_INDEX.match] = table ? matchZ(table, raw) : raw * 4 - 2;
		f[TERM_INDEX.rare] = a.rare ? -RARE_PENALTY : 0;
		f[TERM_INDEX.bias] = bias;
		f[TERM_INDEX.star] = starB;
		f[TERM_INDEX.standout] = standoutBonus(a, standouts, need);
		f[TERM_INDEX.twoWay] = twoWayBonus(a, cv, p.hgt, need, p.expanded);
		f[TERM_INDEX.passBig] = passingBigBonus(a, cv, p.hgt, need);
		f[TERM_INDEX.sig] = signatureTerm(a, standouts, cv);
		f[TERM_INDEX.creator] = creatorTerm(a, read.stats);
		f[TERM_INDEX.rolePass] = role.pass * fade;
		f[TERM_INDEX.roleRim] = role.rim * fade;
		f[TERM_INDEX.roleSniper] = role.sniper * fade;
		f[TERM_INDEX.roleShoot] = role.shoot * fade;
		f[TERM_INDEX.roleMid] = role.mid;
		f[TERM_INDEX.absFloor] = -ab.floor;
		f[TERM_INDEX.noShot] = -ab.noShot;
		f[TERM_INDEX.air] = -ab.air;
		f[TERM_INDEX.eliteShot] = -ab.eliteShot;
		f[TERM_INDEX.touch] = -ab.touch;
		f[TERM_INDEX.generic] = -genericPenalty(a, standouts);
		f[TERM_INDEX.need] = -needPenaltyOf(need);
		f[TERM_INDEX.promFloor] =
			prom.floor > 0 ? -(PROMISE_STEP + PROMISE_K * prom.floor) : 0;
		f[TERM_INDEX.promReb] = -REB_PERIM_K * (prom.reb ?? 0);
		f[TERM_INDEX.promLead] = -LEAD_MIN_K * prom.lead;
		f[TERM_INDEX.promRel] = -needPenaltyOf(prom.rel);
		f[TERM_INDEX.sub] = subTerm(a, p.style);
		f[TERM_INDEX.playType] = ptTerm(a, p.style);
		const all = promisesOf(a).all;
		for (const [i, k] of CLASS_FEATS.entries()) {
			if (all.includes(k)) {
				cls[i] = cv[k] ?? 0;
			}
		}
		rows.push({ a, pub, raw, short, blocked: false, base, f, cls, fam });
	}
	return {
		rows,
		p,
		pos,
		cv,
		standouts,
		famX: familyFeatures(p, cv, read.prospect),
	};
};

// The fitted model for players with or without expanded ratings (model.ts)
export const modelFor = (expanded: boolean): FittedModel =>
	expanded ? FITTED_EXPANDED : FITTED;

// One build's score under a model, before the family terms
export const weighTerms = (m: FittedModel, r: BuildTerms): number => {
	let z = r.base + m.famBias[r.fam];
	for (let i = 0; i < TERMS.length; i++) {
		const v = r.f[i]!;
		if (v !== 0) {
			z += m.theta[TERMS[i]!] * v;
		}
	}
	for (let i = 0; i < CLASS_FEATS.length; i++) {
		const v = r.cls[i]!;
		if (v !== 0) {
			z += m.cls[CLASS_FEATS[i]!] * v;
		}
	}
	return z;
};

// Family first: the classifier's probabilities over the families he has a build in, the log probability of a build's
// family weighed in, and when one family is sure enough the others gated
export const familyTerms = (
	m: FittedModel,
	rows: BuildTerms[],
	famX: number[],
): Partial<Record<Family, number>> => {
	const probs = familyProbs(m, famX);
	const open = new Set(rows.filter((r) => !r.blocked).map((r) => r.fam));
	let sum = 0;
	for (const [i, f] of FAMILIES.entries()) {
		if (open.has(f)) {
			sum += probs[i]!;
		}
	}
	const out: Partial<Record<Family, number>> = {};
	let top: Family | undefined;
	let topP = 0;
	for (const [i, f] of FAMILIES.entries()) {
		if (!open.has(f)) {
			continue;
		}
		const pr = probs[i]! / sum;
		out[f] = m.gamma * Math.log(Math.max(1e-6, pr));
		if (pr > topP) {
			topP = pr;
			top = f;
		}
	}
	if (top && topP >= m.tau && m.gate > 0) {
		for (const f of Object.keys(out) as Family[]) {
			if (f !== top) {
				out[f]! -= m.gate;
			}
		}
	}
	return out;
};

// Score every archetype for one player, best first. An archetype's score is how exceptional the fit is among the league's
// players of his size (so every archetype gets its share), weighed by the fitted model, ties break on id so the order is
// deterministic.
export const scoreAll = (
	ratings: ArchetypeRatings,
	norms: Norms = defaultNormsFor(ratings),
	archetypes: Archetype[] = ARCHETYPES,
	position?: Pos,
	// His visible player traits (only with the playerTraits setting on): trait labels need them
	traitsIn?: Partial<Record<string, number>>,
	// His age, stats and whether he is a draft prospect (score.ts)
	read: Omit<ReadOptions, "pos"> = {},
	model?: FittedModel,
): {
	scored: Scored[];
	z: Record<DimKey, number>;
	skills: SkillLabel[];
	pos: Pos;
	standouts: Standout[];
	// His level at each skill class (score.ts), his height rating and whether he has expanded ratings
	cv: Record<string, number>;
	hgt: number;
	expanded: boolean;
	stats?: ReadOptions["stats"];
} => {
	const t = scoreTerms(ratings, norms, archetypes, position, traitsIn, read);
	const m = model ?? modelFor(t.p.expanded);
	const fam = familyTerms(m, t.rows, t.famX);
	// (arch15: a build is read as the best of its profiles)
	const best = new Map<string, Scored>();
	for (const r of t.rows) {
		// (the all-around star build is read apart: no family term, the classifier never learns that family)
		const z = r.blocked
			? BLOCKED_Z
			: weighTerms(m, r) + (r.fam === "allAround" ? 0 : (fam[r.fam] ?? 0));
		const prev = best.get(r.pub.id);
		if (!prev || z > prev.z) {
			best.set(r.pub.id, { a: r.pub, raw: r.raw, short: r.short, z });
		}
	}
	const scored: Scored[] = [...best.values()];
	scored.sort((x, y) => (y.z !== x.z ? y.z - x.z : x.a.id < y.a.id ? -1 : 1));
	return {
		scored,
		z: t.p.z,
		skills: t.p.skills,
		pos: t.pos,
		standouts: t.standouts,
		cv: t.cv,
		hgt: t.p.hgt,
		expanded: t.p.expanded,
		stats: read.stats,
	};
};

// arch14: how far his stats back what a build's name promises (the mean z of his stats on the classes it promises), for
// close calls between two builds
const STAT_OF_CLASS: Record<string, DimKey> = {
	shoot: "three",
	mid: "mid",
	finish: "fin",
	post: "post",
	handle: "drb",
	pass: "pss",
	reb: "reb",
	rimD: "blk",
	perD: "stl",
	score: "usg",
};
export const statAlignment = (
	a: Archetype,
	stats: ReadOptions["stats"],
): number => {
	if (!stats) {
		return 0;
	}
	let t = 0;
	let n = 0;
	for (const k of promisesOf(a).all) {
		const d = STAT_OF_CLASS[k];
		const v = d ? stats.z[d] : undefined;
		if (v !== undefined) {
			t += v;
			n++;
		}
	}
	return n > 0 ? t / n : 0;
};

// (the skills the all-around build's "why" picks his best three from)
const ALL_AROUND_WHY: DimKey[] = [
	"three",
	"mid",
	"fin",
	"post",
	"drb",
	"pss",
	"reb",
	"dint",
	"dper",
	"blk",
	"stl",
];

export const TIER_NAMES: Record<Tier, string> = {
	franchise: "Franchise",
	star: "Star",
	starter: "Starter",
	rotation: "Rotation",
	bench: "Bench",
	fringe: "Fringe",
};

export const tierFromPercentile = (pct: number): Tier =>
	pct >= 0.993
		? "franchise"
		: pct >= 0.96
			? "star"
			: pct >= 0.8
				? "starter"
				: pct >= 0.5
					? "rotation"
					: pct >= 0.2
						? "bench"
						: "fringe";

const whyOf = (
	a: Archetype,
	z: Record<DimKey, number>,
	expanded: boolean,
): Why[] => {
	const rows: Why[] = [];
	// (the all-around build has no profile: his three best skills)
	const weights: Archetype["w"] = a.tags.includes("allAround")
		? Object.fromEntries(ALL_AROUND_WHY.map((d) => [d, 1]))
		: weightsOf(a, expanded);
	for (const dim of DIMS) {
		const w = weights[dim];
		// (length reads exactly 0 for a player without a wingspan)
		if (
			w === undefined ||
			dim === "hgt" ||
			(STYLE_DIMS.has(dim) && z[dim] === 0)
		) {
			continue;
		}
		// Contribution: how much of the wanted direction he actually has
		rows.push({
			dim,
			label: DIM_LABELS[dim],
			z: Math.round(z[dim] * 100) / 100,
			want: w,
			ratings: DIM_RATINGS[dim],
		});
	}
	const hgt = a.w.hgt;
	rows.sort((x, y) => {
		const cx = x.want * x.z;
		const cy = y.want * y.z;
		return cy !== cx ? cy - cx : x.dim < y.dim ? -1 : 1;
	});
	void hgt;
	return rows.slice(0, 3);
};

// Why he fits one archetype right now: the three dimensions that contribute most, from his current ratings
export const explain = (
	id: string,
	ratings: ArchetypeRatings,
	norms: Norms = defaultNormsFor(ratings),
	read: ReadOptions = {},
): Why[] => {
	const a = archetypeById(id);
	return a
		? whyOf(a, prepare(ratings, norms, read).z, hasExpanded(ratings))
		: [];
};

export type ClassifyOptions = {
	norms?: Norms;
	ovr?: number;
	// The archetype he had before: kept unless a new one beats it by more than the stickiness margin
	previousId?: string;
	stickiness?: number;
	// His position (as the game shows it); read from the ratings when not given
	pos?: string;
	// His player traits as the user sees them (only with the playerTraits setting on; hidden ones are ignored)
	traits?: Partial<Record<string, number>>;
	// His age (31 and up: lost athleticism is discounted), box-score stats (StatReading, stats.ts: none for prospects or
	// players without minutes) and whether he is a draft prospect (read against prospect tables)
	age?: number;
	stats?: ReadOptions["stats"];
	prospect?: boolean;
	// arch15: his play types against his position's peers (with tracking stats)
	pt?: ReadOptions["pt"];
	// The fitted model to weigh the reading with (default: modelFor his ratings)
	model?: FittedModel;
};

// The ONE build he is most similar to. No hybrids: the runners-up are only listed as `alternates` ("also close to").
export const classify = (
	ratings: ArchetypeRatings,
	opts: ClassifyOptions = {},
): Classification => {
	const norms = opts.norms ?? defaultNormsFor(ratings);
	const { scored, z, expanded, pos } = scoreAll(
		ratings,
		norms,
		ARCHETYPES,
		isPos(opts.pos) ? opts.pos : undefined,
		opts.traits,
		{ age: opts.age, stats: opts.stats, prospect: opts.prospect, pt: opts.pt },
		opts.model,
	);
	const model = opts.model ?? modelFor(hasExpanded(ratings));
	let first = scored[0]!;
	// arch14: a close call (the top two within the model's tie margin) without a previous label is settled by his stats:
	// the build whose promises his box score backs more
	const runnerUp = scored[1];
	if (
		!opts.previousId &&
		opts.stats &&
		runnerUp &&
		runnerUp.z > BLOCKED_Z &&
		first.z - runnerUp.z < model.tieMargin &&
		model.tieStatsK *
			(statAlignment(runnerUp.a, opts.stats) -
				statAlignment(first.a, opts.stats)) >
			first.z - runnerUp.z
	) {
		first = runnerUp;
	}
	const sticky = opts.stickiness ?? STICKY_Z;
	const previousId = opts.previousId && mergedId(opts.previousId);
	if (previousId && previousId !== first.a.id) {
		const prev = scored.find((s) => s.a.id === previousId);
		// Never one his position now rules out, however sticky, nor one whose name he no longer lives up to
		if (
			prev &&
			prev.z > BLOCKED_Z &&
			prev.z >= first.z - sticky &&
			prev.short <= POOR_FIT_SHORT
		) {
			first = prev;
		}
	}
	const rest = scored.filter((s) => s.a.id !== first.a.id);
	const second = rest[0];
	const alternates = rest
		.filter((s) => s.z > BLOCKED_Z && s.z >= first.z - ALTERNATE_Z)
		.slice(0, ALTERNATES)
		.map((s) => ({ id: s.a.id, name: nameAt(s.a, pos) }));
	const confidence = second
		? Math.max(0, Math.min(1, (first.z - second.z) / 0.5))
		: 1;
	const tier =
		opts.ovr !== undefined
			? tierFromPercentile(ovrPercentile(norms, opts.ovr))
			: null;
	const a = first.a;
	// arch15: the name at his position (posNames.ts)
	const name = nameAt(a, pos);
	return {
		id: a.id,
		name,
		group: a.group,
		family: a.family,
		desc: a.desc,
		tags: a.tags,
		alternates,
		score: Math.round(first.raw * 1000) / 1000,
		fit: Math.round(first.z * 100) / 100,
		shortfall: Math.round(first.short * 100) / 100,
		confidence: Math.round(confidence * 100) / 100,
		tier,
		why: whyOf(a, z, expanded),
		label: name,
		...(a.custom ? { custom: true } : {}),
		...(opts.stats
			? { statsWeight: Math.round(opts.stats.w * 100) / 100 }
			: {}),
	};
};
