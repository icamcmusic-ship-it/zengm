// Build selection: the class flavor, the class's build pool, and the per-player draw (height gate, rarity weights,
// draw memory, exact Balanced count). Ported from the BBGM Draft Class Workshop's js/ratings.js.

import { ARCHETYPES } from "./archetypes.data.ts";
import { CLASS_FLAVORS } from "./flavors.data.ts";
import type { Rng } from "./rng.ts";
import { clamp } from "./rng.ts";
import type { Archetype, ClassFlavor, DrawFlavor } from "./types.ts";

export { ARCHETYPES, CLASS_FLAVORS };

export const BALANCED = ARCHETYPES.find((a) => a.name === "Balanced")!;
const SPECIALISTS = ARCHETYPES.filter((a) => a.name !== "Balanced");

const BY_NAME = new Map(ARCHETYPES.map((a) => [a.name, a]));
export const archetypeByName = (name: string) => BY_NAME.get(name);

export const TABLE_SIZE = ARCHETYPES.length;

// A flavor's draw weight multiplier is compressed in log space (and so is the weight in pool membership)
const RARITY_COMPRESS = 0.42;

// A flavor named explicitly is guaranteed at least this strength
const ASKED_STRENGTH_FLOOR = 0.5;
const FLAVOR_BLEND_FLOOR = 0.25;

export type FlavorSettings = {
	// "" draws one from the seed
	flavor: string;
	// 0..3, 1 = the table as written
	flavorStrength: number;
	// Chance of a second flavor on top, 0..1
	flavorBlend: number;
};

export const flavorByName = (name: string): ClassFlavor | undefined =>
	CLASS_FLAVORS.find((f) => f.name === name);

const blendFlavor = (
	one: DrawFlavor,
	first: ClassFlavor,
	rng: Rng,
	chance: number,
	strength: number,
	asked: boolean,
): DrawFlavor => {
	if (!chance || asked || first.name === "balanced") {
		return one;
	}
	const brng = rng.child("blend");
	if (brng.random() >= chance) {
		return one;
	}
	const pool = CLASS_FLAVORS.filter(
		(x) => x.name !== first.name && x.name !== "balanced",
	);
	if (pool.length === 0) {
		return one;
	}
	const second = brng.weighted(pool, (x) => x.w);
	const s2 = Math.max(FLAVOR_BLEND_FLOOR, strength * 0.6);
	const mult = { ...one.mult };
	for (const tag of Object.keys(second.m)) {
		mult[tag] = (mult[tag] ?? 1) * second.m[tag]! ** s2;
	}
	return {
		name: `${one.name}+${second.name}`,
		label: `${one.label}, and ${second.label}`,
		mult,
		strength,
		asked: false,
	};
};

// Draw one flavor for a class (or the one that was asked for). Null when the flavor system is off.
export const pickFlavor = (rng: Rng, s: FlavorSettings): DrawFlavor | null => {
	const asked = s.flavor ? flavorByName(s.flavor) : undefined;
	let strength = clamp(s.flavorStrength, 0, 3);
	if (asked && strength < ASKED_STRENGTH_FLOOR) {
		strength = ASKED_STRENGTH_FLOOR;
	}
	if (strength <= 0) {
		return null;
	}
	const f = asked ?? rng.weighted(CLASS_FLAVORS, (x) => x.w);
	if (f.name === "balanced") {
		return {
			name: f.name,
			label: f.label,
			mult: {},
			strength,
			asked: !!asked,
		};
	}
	const mult: Record<string, number> = {};
	for (const tag of Object.keys(f.m)) {
		// strength 1 = the table as written; 0 = no effect; 2 = doubled in log space
		mult[tag] = f.m[tag]! ** strength;
	}
	const one: DrawFlavor = {
		name: f.name,
		label: f.label,
		mult,
		strength,
		asked: !!asked,
	};
	return blendFlavor(
		one,
		f,
		rng,
		clamp(s.flavorBlend, 0, 1),
		strength,
		!!asked,
	);
};

export const flavorMultiplier = (
	arch: Archetype,
	flavor: DrawFlavor | null,
) => {
	if (!flavor) {
		return 1;
	}
	let m = 1;
	for (const tag of arch.tags) {
		const x = flavor.mult[tag];
		if (x !== undefined) {
			m *= x;
		}
	}
	return m;
};

// What share of a class a bio-gated build can legally be drawn for (freshman share fixed at the Workshop's default 46)
const CLASS_YEAR_MIX = {
	Sophomore: 0.37,
	Junior: 0.28,
	Senior: 0.22,
	Graduate: 0.13,
};
const FRESHMAN_REALIZED = 0.92;
const PRO_OR_RETURNED_SHARE = 0.174;
const FRESHMAN_SHARE = 46;

const bioShare = (a: Archetype) => {
	if (!a.bio) {
		return 1;
	}
	const b = a.bio;
	const f = clamp(FRESHMAN_SHARE / 100, 0, 1) * FRESHMAN_REALIZED;
	const rest = 1 - f;
	const p: Record<string, number> = { Freshman: f };
	for (const y of Object.keys(
		CLASS_YEAR_MIX,
	) as (keyof typeof CLASS_YEAR_MIX)[]) {
		p[y] = rest * CLASS_YEAR_MIX[y];
	}
	let share = 1;
	if (b.years) {
		share = 0;
		for (const y of b.years) {
			share += p[y] ?? 0;
		}
	} else if (b.notYears) {
		for (const y of b.notYears) {
			share -= p[y] ?? 0;
		}
	}
	if (b.proOrReturned) {
		share *= PRO_OR_RETURNED_SHARE;
	}
	return clamp(share, 0.05, 1);
};

// The per-player draw weight: authored weight, height-gate calibration, flavor, divided by what a bio gate allows
export const archetypeWeight = (a: Archetype, flavor: DrawFlavor | null) => {
	if (!(a.w > 0)) {
		return 0;
	}
	return (
		(a.w * a.cal * flavorMultiplier(a, flavor) ** RARITY_COMPRESS) / bioShare(a)
	);
};

// Pool membership weight: the authored weight without the calibration
const poolWeight = (a: Archetype, flavor: DrawFlavor | null) => {
	const raw = Math.max(0, a.w) * flavorMultiplier(a, flavor);
	return raw > 0 ? raw ** RARITY_COMPRESS : 0;
};

const POOL_PROBES = [8, 16, 26, 40, 50, 58, 68, 82, 93];
const MIN_PER_BAND = 2;
const SMALL_BAND_MAX = 30;
const MIN_PER_SMALL_BAND = 3;
const minPerBand = (h: number) =>
	h <= SMALL_BAND_MAX ? MIN_PER_SMALL_BAND : MIN_PER_BAND;
export const CENTER_MIN = 72;
const CENTER_POOL_SHARE = 0.06;
const centersInPool = (size: number) =>
	Math.max(1, Math.round(size * CENTER_POOL_SHARE));

const eligibleAt = (list: Archetype[], hgt: number) =>
	list.filter((a) => hgt >= a.min && hgt <= a.max && a.name !== "Balanced");

// Draw the class's build pool. `size` is how many specialist builds the class may contain before height coverage tops it
// up; 0 or a size at or above the table turns the pool off (null).
export const pickClassPool = (
	rng: Rng,
	size: number,
	flavor: DrawFlavor | null,
): Archetype[] | null => {
	size = Math.round(clamp(size, 0, TABLE_SIZE));
	if (!size || size >= SPECIALISTS.length) {
		return null;
	}
	const wOf = (a: Archetype) => poolWeight(a, flavor);
	const remaining = SPECIALISTS.slice();
	const pool: Archetype[] = [];
	const forced = new Set<Archetype>();
	const take = (a: Archetype, isForced: boolean) => {
		pool.push(a);
		if (isForced) {
			forced.add(a);
		}
		remaining.splice(remaining.indexOf(a), 1);
	};

	while (pool.length < size && remaining.length > 0) {
		take(rng.weighted(remaining, wOf), false);
	}

	// One slot for a build the weights never reach, about every other class
	if (size >= 8 && remaining.length > 0 && rng.random() < 0.5) {
		const rare = remaining.filter((a) => a.w < 1 && poolWeight(a, flavor) > 0);
		if (rare.length > 0) {
			take(rare[Math.floor(rng.random() * rare.length)]!, true);
		}
	}

	// The seven-footers' own builds
	{
		const isCenter = (a: Archetype) => a.min >= CENTER_MIN;
		let have = pool.filter(isCenter).length;
		while (have < centersInPool(size)) {
			const options = remaining.filter(isCenter);
			if (options.length === 0) {
				break;
			}
			take(rng.weighted(options, wOf), true);
			have++;
		}
	}

	// Height coverage: a pool that leaves a band empty makes every player in it Balanced
	for (const h of POOL_PROBES) {
		let have = eligibleAt(pool, h).length;
		while (have < minPerBand(h)) {
			const options = eligibleAt(remaining, h);
			if (options.length === 0) {
				break;
			}
			take(rng.weighted(options, wOf), true);
			have++;
		}
	}

	// Trim back to the size that was asked for. The guarantees come out of the budget.
	const covered = (list: Archetype[]) => {
		if (
			list.filter((a) => a.min >= CENTER_MIN).length <
			Math.min(centersInPool(size), size)
		) {
			return false;
		}
		for (const h of POOL_PROBES) {
			const n = eligibleAt(list, h).length;
			if (n < minPerBand(h) && n < eligibleAt(SPECIALISTS, h).length) {
				return false;
			}
		}
		return true;
	};
	while (pool.length > size) {
		const cands = pool.filter(
			(a) => !forced.has(a) && covered(pool.filter((x) => x !== a)),
		);
		if (cands.length === 0) {
			break;
		}
		const drop = cands[Math.floor(rng.random() * cands.length)]!;
		pool.splice(pool.indexOf(drop), 1);
		remaining.push(drop);
	}
	return pool;
};

export type PlayerBio = {
	classYear?: string;
	nonNcaa?: boolean;
};

// A build with a biography has to fit the man's
export const bioFits = (a: Archetype, bio: PlayerBio | undefined) => {
	if (!a.bio || !bio) {
		return true;
	}
	const b = a.bio;
	const cy = String(bio.classYear ?? "").replace(/^Redshirt /, "");
	if (b.years && !b.years.includes(cy)) {
		return false;
	}
	if (b.notYears?.includes(cy)) {
		return false;
	}
	if (b.proOrReturned && !bio.nonNcaa) {
		return false;
	}
	return true;
};

// Per-class draw memory, so one build cannot be half of a class or the top of the board twice
const DRAW_SOFT_CAP = 6;
export const TOP_OF_BOARD = 10;

export type DrawCounts = {
	n: Record<string, number>;
	top: Record<string, number>;
	balanced?: Set<number>;
};

export const newDrawCounts = (): DrawCounts => ({ n: {}, top: {} });

const drawPenalty = (
	name: string,
	counts: DrawCounts | undefined,
	rank: number,
) => {
	if (!counts) {
		return 1;
	}
	let f = 1;
	const c = counts.n[name] ?? 0;
	if (c > DRAW_SOFT_CAP) {
		f *= 0.6 ** (c - DRAW_SOFT_CAP);
	}
	if (Number.isFinite(rank) && rank < TOP_OF_BOARD) {
		f *= 0.25 ** (counts.top[name] ?? 0);
	}
	return f;
};

// Which ranks stay Balanced, decided once per class: the COUNT is the promise, the draw only decides who
export const planBalanced = (rng: Rng, n: number, diversityPct: number) => {
	const d = clamp(Number.isFinite(diversityPct) ? diversityPct : 85, 0, 100);
	const want = Math.round((n * (100 - d)) / 100);
	const plan = new Set<number>();
	if (want <= 0 || n <= 0) {
		return plan;
	}
	const keyed: { i: number; k: number }[] = [];
	for (let i = 0; i < n; i++) {
		const w = i < 10 ? 0.25 + 0.075 * i : 1;
		// Efraimidis-Spirakis: the largest u^(1/w) is a weighted draw without replacement
		keyed.push({ i, k: Math.max(1e-12, rng.random()) ** (1 / w) });
	}
	keyed.sort((a, b) => b.k - a.k || a.i - b.i);
	for (let j = 0; j < Math.min(want, n); j++) {
		plan.add(keyed[j]!.i);
	}
	return plan;
};

export const pickArchetype = (
	rng: Rng,
	hgtRating: number,
	diversityPct: number,
	flavor: DrawFlavor | null,
	pool: Archetype[] | null,
	rank: number,
	bio: PlayerBio | undefined,
	counts: DrawCounts | undefined,
): Archetype => {
	const source = pool && pool.length > 0 ? [...pool, BALANCED] : ARCHETYPES;
	const eligible = source.filter(
		(a) => hgtRating >= a.min && hgtRating <= a.max && bioFits(a, bio),
	);
	if (eligible.length === 0) {
		return BALANCED;
	}
	let diversity =
		clamp(Number.isFinite(diversityPct) ? diversityPct : 85, 0, 100) / 100;
	// The top of the board is the part of the class everyone looks at: the Balanced mass shrinks for the top ten
	if (Number.isFinite(rank) && rank >= 0 && rank < 10) {
		diversity = 1 - (1 - diversity) * (0.25 + 0.075 * rank);
	}
	const wOf = (a: Archetype) =>
		archetypeWeight(a, flavor) * drawPenalty(a.name, counts, rank);

	if (counts?.balanced && Number.isFinite(rank) && rank >= 0) {
		const bal = eligible.find((a) => a.name === "Balanced") ?? BALANCED;
		const spec = eligible.filter((a) => a.name !== "Balanced");
		if (counts.balanced.has(rank) || spec.length === 0) {
			// Draw consumed, so a plan never shifts the stream behind it
			rng.random();
			return bal;
		}
		const total = spec.reduce((s, a) => s + wOf(a), 0) || 1;
		return rng.weighted(spec, (a) => wOf(a) / total);
	}

	const specialists = eligible.filter((a) => a.name !== "Balanced");
	const wSum = specialists.reduce((s, a) => s + wOf(a), 0) || 1;
	return rng.weighted(eligible, (a) =>
		a.name === "Balanced" ? 1 - diversity : (diversity * wOf(a)) / wSum,
	);
};
