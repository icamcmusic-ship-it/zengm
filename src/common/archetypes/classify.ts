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
	coverOf,
	genericPenalty,
	levelPenalty,
	needPenaltyOf,
	needShortfall,
	prepare,
	rawMatch,
	classValues,
	passingBigBonus,
	standoutBonus,
	standoutsOf,
	twoWayBonus,
	twoWaySides,
	weightsOf,
	type Standout,
} from "./score.ts";
import { ovrPercentile } from "./norms.ts";
import {
	archetypePrior,
	isPos,
	namesContradict,
	positionOf,
} from "./position.ts";
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

// One description for a combo archetype: "Hounds ball handlers and picks pockets, and also spaces the floor from the corners."
export const combineArchetypeDescs = (primary: string, secondary?: string) => {
	if (!secondary || secondary === primary) {
		return primary;
	}
	const a = primary.trim().replace(/[!.]+$/, "");
	const b = secondary.trim();
	const bLower = /^[A-Z][a-z]/.test(b) ? b[0]!.toLowerCase() + b.slice(1) : b;
	return `${a}, and also ${bLower.endsWith(".") ? bLower : `${bLower}.`}`;
};

// The built-in reference league: one generated with the Expanded Ratings setting on for players who have those ratings
// (their composites, the two defense ratings and length are distributed differently), else the stock one
export const defaultNorms = (expanded: boolean): Norms =>
	expanded ? DEFAULT_NORMS_EXPANDED : DEFAULT_NORMS;
export const defaultNormsFor = (ratings: ArchetypeRatings): Norms =>
	defaultNorms(hasExpanded(ratings));

export const ARCHETYPES: Archetype[] = ARCHETYPE_DEFS.map((d) => ({
	...d,
	prior: 1,
}));
const BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));
export const archetypeById = (id: string) => BY_ID.get(id);
export const archetypeByName = (name: string) =>
	ARCHETYPES.find((a) => a.name === name);

// Rare "unicorn" types need to be that much more exceptional a fit to be picked
export const RARE_PENALTY = 0.5;
// Star archetypes (gated on an overall level well above the league's and on elite usage) win over the generic scorer labels
// every star also fits, so the league's best players are told apart by what makes them elite
export const STAR_BONUS = 0.5;
// A runner-up this close (in standard deviations of fit) from a different family makes a hybrid
export const HYBRID_Z = 0.15;
// How much farther a runner-up may be when it names a standout skill of his the primary does not (per z of standout)
export const SECONDARY_K = 0.4;
const SECONDARY_REACH = 0.3;
const SECONDARY_MIN = 0.2;
const HYBRID_TIE_Z = 0.05;
// A hybrid partner from another positional group (a wing label next to a forward one) needs to be this much closer
export const CROSS_GROUP_Z = 0.05;
const crossGroupPenalty = (a: Archetype, b: Archetype) =>
	a.group === b.group ||
	a.tags.includes("universal") ||
	b.tags.includes("universal")
		? 0
		: CROSS_GROUP_Z;
// A two-way player (with expanded ratings, where his defense is a rating of its own) whose primary label names one side
// of his game: the partner that names the other side may be this much farther off, and is worth this much per unit of
// his weaker side ("Mid-Range Wing / Lockdown Wing")
export const TWO_WAY_PARTNER_REACH = 3;
export const TWO_WAY_PARTNER_MIN_Z = 0.5;
const TWO_WAY_PARTNER_FROM = 0.4;
// The archetype he had keeps the label unless another is better by more than this
export const STICKY_Z = 0.55;

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

export type Scored = { a: Archetype; raw: number; z: number };

// Score every archetype for one player, best first. An archetype's score is how exceptional the fit is among the league's
// players of his size (so every archetype gets its share), ties break on id so the order is deterministic.
export const scoreAll = (
	ratings: ArchetypeRatings,
	norms: Norms = defaultNormsFor(ratings),
	archetypes: Archetype[] = ARCHETYPES,
	position?: Pos,
	// His age, when known: age-gated archetypes (veterans) need it
	age?: number,
	// His visible player traits (only with the playerTraits setting on): trait labels need them
	traitsIn?: Partial<Record<string, number>>,
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
	const p = { ...prepare(ratings, norms), age };
	const pos = position ?? positionOf(ratings);
	const cv = classValues(p);
	const standouts = standoutsOf(p, cv);
	const traits = visibleTraits(traitsIn);
	const scored: Scored[] = [];
	for (const a of archetypes) {
		const raw = rawMatch(a, p.z, p.hgt, p.skills, p.level, p.expanded);
		const prior = archetypePrior(a, pos);
		const trait = traitTerm(a, traits);
		if (
			prior === null ||
			trait === undefined ||
			// A label about his length needs a wingspan
			(a.expanded && !p.expanded) ||
			(a.age &&
				(age === undefined
					? a.age[0] >= 30
					: age < a.age[0] - 1 || age > a.age[1] + 1))
		) {
			scored.push({ a, raw, z: BLOCKED_Z });
			continue;
		}
		const table = norms.match[a.id];
		const short = needShortfall(a, p);
		const z =
			(table ? matchZ(table, raw) : raw * 4 - 2) -
			(a.rare ? RARE_PENALTY : 0) +
			(a.tags.includes("star") ? STAR_BONUS : 0) +
			prior +
			trait +
			((norms.bias ?? defaultNorms(p.expanded).bias)?.[a.id] ?? 0) +
			signatureBonus(
				a,
				standouts,
				cv,
				p.hgt,
				needShortfall(a, p, true),
				p.expanded,
			) -
			genericPenalty(a, standouts) -
			needPenaltyOf(short) -
			levelPenalty(a, p.level) -
			(a.age && age !== undefined
				? 0.6 * Math.max(0, a.age[0] - age, age - a.age[1])
				: 0);
		scored.push({ a, raw, z });
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
	const weights = weightsOf(a, expanded);
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
): Why[] => {
	const a = archetypeById(id);
	return a ? whyOf(a, prepare(ratings, norms).z, hasExpanded(ratings)) : [];
};

export type ClassifyOptions = {
	norms?: Norms;
	ovr?: number;
	// The archetype he had before: kept unless a new one beats it by more than the stickiness margin
	previousId?: string;
	stickiness?: number;
	// His position (as the game shows it); read from the ratings when not given
	pos?: string;
	// His age, when known (veteran archetypes need it)
	age?: number;
	// His player traits as the user sees them (only with the playerTraits setting on; hidden ones are ignored)
	traits?: Partial<Record<string, number>>;
};

export const classify = (
	ratings: ArchetypeRatings,
	opts: ClassifyOptions = {},
): Classification => {
	const norms = opts.norms ?? defaultNormsFor(ratings);
	const { scored, z, standouts, cv, hgt, expanded } = scoreAll(
		ratings,
		norms,
		ARCHETYPES,
		isPos(opts.pos) ? opts.pos : undefined,
		opts.age,
		opts.traits,
	);
	let first = scored[0]!;
	const sticky = opts.stickiness ?? STICKY_Z;
	if (opts.previousId && opts.previousId !== first.a.id) {
		const prev = scored.find((s) => s.a.id === opts.previousId);
		// Never one his position (or age) now rules out, however sticky
		if (prev && prev.z > BLOCKED_Z && prev.z >= first.z - sticky) {
			first = prev;
		}
	}
	const rest = scored.filter((s) => s.a.id !== first.a.id);
	const second = rest[0]!;
	// A hybrid names the best runner-up from a different family, preferring one that names a standout skill of his the
	// primary leaves out (a shooter who also defends is a "... / Lockdown Wing")
	const primaryCover = coverOf(first.a);
	const adds = (s: Scored) => {
		const c = coverOf(s.a);
		let t = 0;
		for (const { k, s: v } of standouts) {
			t += v * Math.max(0, (c[k] ?? 0) - (primaryCover[k] ?? 0));
		}
		return SECONDARY_K * t;
	};
	// The side of a two-way player's game the primary leaves out, and how strong his weaker side is
	let missing: "off" | "def" | undefined;
	let twoWay = 0;
	if (expanded) {
		const all = twoWaySides(cv, hgt);
		const named = twoWaySides(cv, hgt, first.a);
		twoWay = Math.min(all.off, all.def);
		if (twoWay >= TWO_WAY_PARTNER_FROM) {
			missing =
				named.def < 0.5 * all.def
					? named.off < 0.5 * all.off
						? undefined
						: "def"
					: named.off < 0.5 * all.off
						? "off"
						: undefined;
		}
	}
	const completes = (s: Scored) =>
		missing ? Math.min(twoWay, twoWaySides(cv, hgt, s.a)[missing]) : 0;
	const allowed = (s: Scored) =>
		// Never a label that names another position than the primary's ("Switchable Forward / Switchable Center"), and
		// one from the primary's own positional group (or a universal one) is preferred
		s.a.family !== first.a.family && !namesContradict(first.a.name, s.a.name);
	let partner: Scored | undefined;
	let partnerZ = -Infinity;
	for (const s of rest) {
		if (s.z < first.z - HYBRID_Z - SECONDARY_REACH) {
			break;
		}
		if (!allowed(s)) {
			continue;
		}
		const v = s.z + adds(s) - crossGroupPenalty(first.a, s.a);
		if (v > partnerZ) {
			partner = s;
			partnerZ = v;
		}
	}
	// A single strong label reads best: a partner only when it names a standout the primary does not, or it is all but
	// tied with the primary
	let secondary =
		partner &&
		partnerZ >= first.z - HYBRID_Z &&
		(adds(partner) >= SECONDARY_MIN || partner.z >= first.z - HYBRID_TIE_Z)
			? partner
			: undefined;
	// ... or when he is a two-way player and it names the side of his game the primary leaves out: then the partner only
	// has to be a good fit in its own right, not a near tie
	if (missing) {
		let best: Scored | undefined;
		let bestV = -Infinity;
		for (const s of rest) {
			if (
				s.z < first.z - TWO_WAY_PARTNER_REACH ||
				s.z < TWO_WAY_PARTNER_MIN_Z
			) {
				break;
			}
			const c = completes(s);
			if (c < TWO_WAY_PARTNER_FROM || !allowed(s)) {
				continue;
			}
			const v = s.z + c + adds(s) - crossGroupPenalty(first.a, s.a);
			if (v > bestV) {
				best = s;
				bestV = v;
			}
		}
		// (a regular partner that already names that side stays)
		if (best && !(secondary && completes(secondary) >= TWO_WAY_PARTNER_FROM)) {
			secondary = best;
		}
	}
	const confidence = Math.max(0, Math.min(1, (first.z - second.z) / 0.5));
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
		desc: combineArchetypeDescs(a.desc, secondary?.a.desc),
		tags: a.tags,
		secondary: secondary
			? {
					id: secondary.a.id,
					name: secondary.a.name,
					desc: secondary.a.desc,
				}
			: null,
		score: Math.round(first.raw * 1000) / 1000,
		confidence: Math.round(confidence * 100) / 100,
		tier,
		why: whyOf(a, z, expanded),
		label: secondary ? `${a.name} / ${secondary.a.name}` : a.name,
	};
};
