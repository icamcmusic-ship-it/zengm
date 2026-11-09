import { ARCHETYPE_DEFS } from "./defs.data.ts";
import { DIM_LABELS, DIM_RATINGS, DIMS } from "./composites.ts";
import { DEFAULT_NORMS } from "./norms.data.ts";
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
) =>
	standoutBonus(a, standouts, strictShortfall) +
	twoWayBonus(a, cv, hgt, strictShortfall) +
	passingBigBonus(a, cv, hgt, strictShortfall);

export type Scored = { a: Archetype; raw: number; z: number };

// Score every archetype for one player, best first. An archetype's score is how exceptional the fit is among the league's
// players of his size (so every archetype gets its share), ties break on id so the order is deterministic.
export const scoreAll = (
	ratings: ArchetypeRatings,
	norms: Norms = DEFAULT_NORMS,
	archetypes: Archetype[] = ARCHETYPES,
	position?: Pos,
	// His age, when known: age-gated archetypes (veterans) need it
	age?: number,
): {
	scored: Scored[];
	z: Record<DimKey, number>;
	skills: SkillLabel[];
	pos: Pos;
	standouts: Standout[];
} => {
	const p = { ...prepare(ratings, norms), age };
	const pos = position ?? positionOf(ratings);
	const cv = classValues(p);
	const standouts = standoutsOf(p, cv);
	const scored: Scored[] = [];
	for (const a of archetypes) {
		const raw = rawMatch(a, p.z, p.hgt, p.skills, p.level);
		const prior = archetypePrior(a, pos);
		if (
			prior === null ||
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
			((norms.bias ?? DEFAULT_NORMS.bias)?.[a.id] ?? 0) +
			signatureBonus(a, standouts, cv, p.hgt, needShortfall(a, p, true)) -
			genericPenalty(a, standouts) -
			needPenaltyOf(short) -
			levelPenalty(a, p.level) -
			(a.age && age !== undefined
				? 0.6 * Math.max(0, a.age[0] - age, age - a.age[1])
				: 0);
		scored.push({ a, raw, z });
	}
	scored.sort((x, y) => (y.z !== x.z ? y.z - x.z : x.a.id < y.a.id ? -1 : 1));
	return { scored, z: p.z, skills: p.skills, pos, standouts };
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

const whyOf = (a: Archetype, z: Record<DimKey, number>): Why[] => {
	const rows: Why[] = [];
	for (const dim of DIMS) {
		const w = a.w[dim];
		if (w === undefined || dim === "hgt") {
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
	norms: Norms = DEFAULT_NORMS,
): Why[] => {
	const a = archetypeById(id);
	return a ? whyOf(a, prepare(ratings, norms).z) : [];
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
};

export const classify = (
	ratings: ArchetypeRatings,
	opts: ClassifyOptions = {},
): Classification => {
	const norms = opts.norms ?? DEFAULT_NORMS;
	const { scored, z, standouts } = scoreAll(
		ratings,
		norms,
		ARCHETYPES,
		isPos(opts.pos) ? opts.pos : undefined,
		opts.age,
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
	let partner: Scored | undefined;
	let partnerZ = -Infinity;
	for (const s of rest) {
		if (s.z < first.z - HYBRID_Z - SECONDARY_REACH) {
			break;
		}
		// Never a label that names another position than the primary's ("Switchable Forward / Switchable Center"), and
		// one from the primary's own positional group (or a universal one) is preferred
		if (
			s.a.family === first.a.family ||
			namesContradict(first.a.name, s.a.name)
		) {
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
	const secondary =
		partner &&
		partnerZ >= first.z - HYBRID_Z &&
		(adds(partner) >= SECONDARY_MIN || partner.z >= first.z - HYBRID_TIE_Z)
			? { id: partner.a.id, name: partner.a.name, desc: partner.a.desc }
			: null;
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
		desc: combineArchetypeDescs(a.desc, secondary?.desc),
		tags: a.tags,
		secondary,
		score: Math.round(first.raw * 1000) / 1000,
		confidence: Math.round(confidence * 100) / 100,
		tier,
		why: whyOf(a, z),
		label: secondary ? `${a.name} / ${secondary.name}` : a.name,
	};
};
