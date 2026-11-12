import { ARCHETYPE_DEFS } from "./defs.data.ts";
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
import {
	ALL_AROUND_MISS,
	ALL_AROUND_Z,
	allAroundQuality,
	genericPenalty,
	needPenaltyOf,
	needShortfall,
	prepare,
	rawMatch,
	classValues,
	passingBigBonus,
	promisePenalty,
	promiseShortfall,
	creatorTerm,
	signatureTerm,
	standoutBonus,
	absolutePenalty,
	roleTerm,
	starWeight,
	type ReadOptions,
	standoutsOf,
	twoWayBonus,
	weightsOf,
	type Standout,
} from "./score.ts";
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

// What a label earns for naming what stands out about him (score.ts): his top skills, both sides of a two-way game, a
// big's passing
const signatureBonus = (
	a: Archetype,
	standouts: Standout[],
	cv: Record<string, number>,
	hgt: number,
	strictShortfall: number,
	expanded: boolean,
) =>
	standoutBonus(a, standouts, strictShortfall) +
	twoWayBonus(a, cv, hgt, strictShortfall, expanded) +
	passingBigBonus(a, cv, hgt, strictShortfall);

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

// Only the visible traits, whatever the caller passed
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

// Score every archetype for one player, best first. An archetype's score is how exceptional the fit is among the league's
// players of his size (so every archetype gets its share), ties break on id so the order is deterministic.
export const scoreAll = (
	ratings: ArchetypeRatings,
	norms: Norms = defaultNormsFor(ratings),
	archetypes: Archetype[] = ARCHETYPES,
	position?: Pos,
	// His visible player traits (only with the playerTraits setting on): trait labels need them
	traitsIn?: Partial<Record<string, number>>,
	// His age, stats and whether he is a draft prospect (score.ts)
	read: Omit<ReadOptions, "pos"> = {},
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
} => {
	const pos = position ?? positionOf(ratings);
	const p = prepare(ratings, norms, { ...read, pos });
	const cv = classValues(p);
	const standouts = standoutsOf(p, cv);
	const traits = visibleTraits(traitsIn);
	const star = starWeight(p);
	const starBias = norms.starBias ?? STAR_BIAS;
	const scored: Scored[] = [];
	for (const a of archetypes) {
		const raw = rawMatch(a, p.z, p.hgt, p.skills, p.expanded);
		const prior = archetypePrior(a, pos);
		const trait = traitTerm(a, traits);
		if (
			prior === null ||
			trait === undefined ||
			// A label about his length needs a wingspan
			(a.expanded && !p.expanded)
		) {
			scored.push({ a, raw, z: BLOCKED_Z, short: 0 });
			continue;
		}
		const bias =
			((norms.bias ?? defaultNorms(p.expanded).bias)?.[a.id] ?? 0) +
			star * (starBias[a.id] ?? 0);
		// arch13: the all-around star build has no profile (score.ts, allAroundQuality)
		if (a.tags.includes("allAround")) {
			const q = allAroundQuality(p, cv, read.prospect);
			scored.push({
				a,
				raw,
				z:
					q > 0
						? ALL_AROUND_Z * q + prior + trait + bias
						: prior + trait - ALL_AROUND_MISS,
				short: q > 0 ? 0 : 1,
			});
			continue;
		}
		const table = norms.match[a.id];
		const need = needShortfall(a, p);
		const prom = promiseShortfall(a, cv, p);
		const short = need + prom.floor + prom.rel;
		// (a role bonus only for a build he lives up to: it fades out as he misses its floors)
		const role = roleTerm(a, p, cv);
		const roleZ =
			role > 0 ? role * Math.max(0, 1 - short / POOR_FIT_SHORT) : role;
		const z =
			(table ? matchZ(table, raw) : raw * 4 - 2) -
			(a.rare ? RARE_PENALTY : 0) +
			prior +
			trait +
			bias +
			signatureBonus(a, standouts, cv, p.hgt, need, p.expanded) +
			signatureTerm(a, standouts, cv) +
			creatorTerm(a, read.stats) +
			roleZ -
			absolutePenalty(a, p) -
			genericPenalty(a, standouts) -
			needPenaltyOf(need) -
			promisePenalty(prom);
		scored.push({ a, raw, z, short });
	}
	scored.sort((x, y) => (y.z !== x.z ? y.z - x.z : x.a.id < y.a.id ? -1 : 1));
	return {
		scored,
		z: p.z,
		skills: p.skills,
		pos,
		standouts,
		cv,
		hgt: p.hgt,
		expanded: p.expanded,
	};
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
};

// The ONE build he is most similar to. No hybrids: the runners-up are only listed as `alternates` ("also close to").
export const classify = (
	ratings: ArchetypeRatings,
	opts: ClassifyOptions = {},
): Classification => {
	const norms = opts.norms ?? defaultNormsFor(ratings);
	const { scored, z, expanded } = scoreAll(
		ratings,
		norms,
		ARCHETYPES,
		isPos(opts.pos) ? opts.pos : undefined,
		opts.traits,
		{ age: opts.age, stats: opts.stats, prospect: opts.prospect },
	);
	let first = scored[0]!;
	const sticky = opts.stickiness ?? STICKY_Z;
	if (opts.previousId && opts.previousId !== first.a.id) {
		const prev = scored.find((s) => s.a.id === opts.previousId);
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
		.map((s) => ({ id: s.a.id, name: s.a.name }));
	const confidence = second
		? Math.max(0, Math.min(1, (first.z - second.z) / 0.5))
		: 1;
	const tier =
		opts.ovr !== undefined
			? tierFromPercentile(ovrPercentile(norms, opts.ovr))
			: null;
	const a = first.a;
	return {
		id: a.id,
		name: a.name,
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
		label: a.name,
		...(a.custom ? { custom: true } : {}),
		...(opts.stats
			? { statsWeight: Math.round(opts.stats.w * 100) / 100 }
			: {}),
	};
};
