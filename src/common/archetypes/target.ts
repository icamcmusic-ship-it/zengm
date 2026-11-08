import type { Archetype as Build } from "../ratingsBuilds/types.ts";
import { ARCHETYPES, archetypeById, scoreAll } from "./classify.ts";
import { SEEDS } from "./seeds.data.ts";
import type {
	Archetype,
	ArchetypeRatings,
	DimKey,
	Norms,
	RatingKey,
} from "./types.ts";
import { DIMS } from "./composites.ts";

// The ratings regenerator's solver works on "builds": an offset vector, a height gate and tags. An archetype's seed (see
// seeds.data.ts) is exactly that, so targeting an archetype means handing the solver this synthesized build. The overall
// is restored by the same solver, so ovr and pot stay exactly as they were.
const SIGNATURE_TAG: Record<string, string> = {
	"3": "shooting",
	A: "athletic",
	R: "rebounding",
};

const cache = new Map<string, Build>();

export const archetypeToBuild = (
	id: string,
	offsets?: Partial<Record<RatingKey, number>>,
): Build | undefined => {
	if (offsets) {
		const b = archetypeToBuild(id);
		return b ? { ...b, o: offsets } : undefined;
	}
	const hit = cache.get(id);
	if (hit) {
		return hit;
	}
	const a = archetypeById(id);
	const seed = SEEDS[id];
	if (!a || !seed) {
		return undefined;
	}
	const tags = [...a.tags];
	for (const s of a.req ?? []) {
		const t = SIGNATURE_TAG[s];
		if (t) {
			tags.push(t);
		}
	}
	const o: Partial<Record<RatingKey, number>> = { ...seed.o };
	const build: Build = {
		name: a.name,
		min: a.hgt[0],
		max: a.hgt[1],
		w: 1,
		tags,
		o,
		cal: 0.4,
		pot: 0,
	};
	cache.set(id, build);
	return build;
};

export const archetypeIds = () => ARCHETYPES.map((a) => a.id);

const KEYS: RatingKey[] = [
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
];

const profileDistance = (a: Archetype, b: Archetype) => {
	let d = 0;
	for (const dim of DIMS as DimKey[]) {
		d += ((a.w[dim] ?? 0) - (b.w[dim] ?? 0)) ** 2;
	}
	return d;
};

const rivalCache = new Map<string, Archetype[]>();
// The archetypes a target is most easily mistaken for: nearest profiles whose height gates overlap
const rivalsOf = (a: Archetype) => {
	let hit = rivalCache.get(a.id);
	if (!hit) {
		hit = ARCHETYPES.filter(
			(c) => c.id !== a.id && c.hgt[1] >= a.hgt[0] && c.hgt[0] <= a.hgt[1],
		)
			.sort(
				(x, y) =>
					profileDistance(a, x) - profileDistance(a, y) ||
					(x.id < y.id ? -1 : 1),
			)
			.slice(0, 200);
		rivalCache.set(a.id, hit);
	}
	return hit;
};

// Tailor the archetype's seed offsets to ONE player: a short coordinate ascent that starts at the seed and stops once he
// clearly derives to the target, judged after a uniform shift that keeps his overall (the solver restores it exactly
// afterwards). Pure and deterministic. Returns the offset vector to hand to the solver.
export const personalizeSeed = (
	targetId: string,
	base: ArchetypeRatings,
	ovr: (r: ArchetypeRatings) => number,
	norms?: Norms,
	maxEvals = 500,
	start?: Partial<Record<RatingKey, number>>,
): Partial<Record<RatingKey, number>> => {
	const a = archetypeById(targetId);
	const seed = SEEDS[targetId];
	if (!a || !seed) {
		return {};
	}
	const list = [a, ...rivalsOf(a)];
	const target = ovr(base);
	const o: Partial<Record<RatingKey, number>> = { ...(start ?? seed.o) };
	const neutral = (cand: Partial<Record<RatingKey, number>>) => {
		const at = (c: number) => {
			const r = { ...base };
			for (const k of KEYS) {
				r[k] = Math.min(99, Math.max(1, base[k] + (cand[k] ?? 0) + c));
			}
			return r;
		};
		let lo = -40;
		let hi = 40;
		for (let i = 0; i < 6; i++) {
			const mid = (lo + hi) / 2;
			if (ovr(at(mid)) > target) {
				hi = mid;
			} else {
				lo = mid;
			}
		}
		return at((lo + hi) / 2);
	};
	let evals = 0;
	const objective = (cand: Partial<Record<RatingKey, number>>) => {
		evals++;
		const sc = scoreAll(neutral(cand), norms, list).scored;
		const zt = sc.find((x) => x.a.id === a.id)!.z;
		// A soft maximum over the rivals, so there is a gradient before the target actually wins
		let lse = 0;
		for (const x of sc) {
			if (x.a.id !== a.id) {
				lse += Math.exp(x.z / TAU);
			}
		}
		const rival = TAU * Math.log(lse);
		let reg = 0;
		for (const k of KEYS) {
			reg += (cand[k] ?? 0) ** 2;
		}
		return (
			Math.min(MARGIN, zt - rival) + 0.05 * Math.min(2.6, zt) - 0.0004 * reg
		);
	};
	let best = objective(o);
	for (const step of [10, 5, 2.5, 1.2]) {
		for (let sweep = 0; sweep < 3; sweep++) {
			let moved = false;
			for (const k of KEYS) {
				if (best >= MARGIN + 0.05 * 2.6 - 0.01) {
					return o;
				}
				for (const dir of [1, -1]) {
					if (evals >= maxEvals) {
						return o;
					}
					const v0 = o[k] ?? 0;
					const nv = Math.max(-35, Math.min(35, v0 + dir * step));
					if (nv === v0) {
						continue;
					}
					const v = objective({ ...o, [k]: nv });
					if (v > best + 1e-6) {
						best = v;
						o[k] = nv;
						moved = true;
					}
				}
			}
			if (!moved) {
				break;
			}
		}
	}
	return o;
};

// How comfortably (in z) the target must beat its nearest rival before the personalization stops
const MARGIN = 0.7;
const TAU = 0.3;
