// The ovr solver. Every build's offset vector is applied to a base vector and then re-solved so that BBGM's own ovr
// formula (injected as `formulas.ovr`, i.e. the game's real player.ovr) returns the target overall exactly.
//
// Ported from the BBGM Draft Class Workshop's js/ratings.js (applyShift, solveToOvr, touchUp, neutralizeApplied,
// ovrRange, fitCaps). The one change of substance: nothing here re-implements ovr. The only copy of the ovr weights is
// OVR_RAW below, which is used for CENTERING the solve inside an integer overall's rounding plateau (it needs the
// unrounded value) and is checked against the game's ovr by the tests; every exactness decision is made with the
// game's own function.

import { clamp } from "./rng.ts";
import type { Rng } from "./rng.ts";
import type { Archetype, BuildRatings, RatingKey } from "./types.ts";

export const RATING_KEYS: RatingKey[] = [
	"hgt",
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

export type Formulas = {
	// The game's player.ovr for basketball
	ovr: (ratings: BuildRatings) => number;
	pos: (ratings: BuildRatings) => string;
	// Takes ratings including `fuzz`
	skills: (ratings: BuildRatings & { fuzz: number }) => string[];
	// Inches -> hgt rating
	heightToRating: (inches: number) => number;
	// The game's pot estimate with no noise, so pot is deterministic
	potEstimate: (ovr: number, age: number) => number;
};

export type Pinned = Partial<Record<RatingKey, number>> | null | undefined;

export type Caps = {
	skill: number;
	phys: number;
	knee?: number;
	headroom?: number;
	preserve?: true;
	keys?: Partial<Record<RatingKey, number>>;
};

export type ScaleVector = Record<RatingKey, number>;

// How freely each rating may be shifted when solving for the target ovr
export const SHIFT_SCALE: ScaleVector = {
	hgt: 0,
	stre: 1,
	spd: 1,
	jmp: 1,
	endu: 0.5,
	ins: 1,
	dnk: 1,
	ft: 1,
	fg: 1,
	tp: 1,
	oiq: 1,
	diq: 1,
	drb: 1,
	pss: 1,
	reb: 1,
};

// Linear ovr weight of each rating
export const OVR_W: ScaleVector = {
	hgt: 0.159,
	stre: 0.0777,
	spd: 0.123,
	jmp: 0.051,
	endu: 0.0632,
	ins: 0.0126,
	dnk: 0.0286,
	ft: 0.0202,
	fg: 0.01,
	tp: 0.0726,
	oiq: 0.133,
	diq: 0.159,
	drb: 0.059,
	pss: 0.062,
	reb: 0.01,
};

// How far the solver's search runs. Saturates every rating at both ends.
export const SHIFT_RANGE = 500;

// How far above the 1 floor the downward shift starts easing
const FLOOR_KNEE = 10;

const CAP_KNEE = 10;
const CAP_HEADROOM = 4;
const PHYSICAL = new Set<RatingKey>(["stre", "spd", "jmp", "endu"]);

// Tolerance of the neutralization pass loop, and the share of an authored offset that always survives
const NEUTRAL_TOL = 0.02;
const SIGN_FLOOR_FRAC = 0.25;

const SIGNATURE_UP = 0.9;
const SIGNATURE_DOWN = 0.4;
const SIGNATURE_STEPS = 6;
const SIGNATURE_STEP = 2;

export const SIGNATURE_SKILLS: Record<
	string,
	{ label: string; keys: Partial<Record<RatingKey, number>> }
> = {
	shooting: { label: "3", keys: { tp: 1, oiq: 0.25 } },
	athletic: { label: "A", keys: { stre: 1, spd: 1, jmp: 1 } },
	rebounding: { label: "R", keys: { reb: 1, jmp: 0.25, stre: 0.25 } },
};

export type Lean = Partial<Record<RatingKey, number>> | null;

// e^-x for x >= 0 from + - * / only, so the ease is bit-identical in every context
const expNeg = (x: number) => {
	let n = 0;
	while (x > 0.5 && n < 60) {
		x /= 2;
		n++;
	}
	let term = 1;
	let sum = 1;
	for (let i = 1; i <= 18; i++) {
		term *= -x / i;
		sum += term;
	}
	for (let i = 0; i < n; i++) {
		sum *= sum;
	}
	return sum;
};

export const softCap = (
	v: number,
	cap: number,
	knee?: number,
	headroom?: number,
) => {
	if (!(cap > 0)) {
		return v;
	}
	const kn = knee === undefined ? CAP_KNEE : knee;
	const K = cap - kn;
	if (v <= K) {
		return v;
	}
	const span = kn + (headroom === undefined ? CAP_HEADROOM : headroom);
	return K + span * (1 - expNeg((v - K) / span));
};

// The caps a build runs under, or null for none. Soft-cap softness is fixed at the Workshop's default of 1.25.
export const rookieCaps = (skill: number, phys: number): Caps | null => {
	if (!(skill > 0 || phys > 0)) {
		return null;
	}
	return {
		skill,
		phys,
		knee: 11,
		headroom: 5,
		preserve: true,
	};
};

const capFor = (caps: Caps | null | undefined, key: RatingKey) => {
	if (!caps || key === "hgt") {
		return 0;
	}
	const k = caps.keys?.[key];
	if (k !== undefined && k > 0) {
		return k;
	}
	return PHYSICAL.has(key) ? caps.phys : caps.skill;
};

// The caps lifted just far enough that a rating the player already has comes through untouched
const liftCapsToRatings = (caps: Caps | null, orig: BuildRatings) => {
	if (!caps || !caps.preserve) {
		return caps;
	}
	let keys: Partial<Record<RatingKey, number>> | null = null;
	for (const key of RATING_KEYS) {
		if (key === "hgt") {
			continue;
		}
		const c = capFor(caps, key);
		if (!(c > 0)) {
			continue;
		}
		const need = Math.ceil(Number(orig[key]) + CAP_KNEE);
		if (need > c) {
			keys = keys ?? {};
			keys[key] = need;
		}
	}
	return keys ? { ...caps, keys: { ...caps.keys, ...keys } } : caps;
};

const raiseCaps = (caps: Caps, d: number): Caps => {
	const out: Caps = {
		skill: caps.skill > 0 ? caps.skill + d : 0,
		phys: caps.phys > 0 ? caps.phys + d : 0,
		knee: caps.knee,
		headroom: caps.headroom,
	};
	if (caps.preserve) {
		out.preserve = true;
	}
	if (caps.keys) {
		out.keys = {};
		for (const k of Object.keys(caps.keys) as RatingKey[]) {
			out.keys[k] = caps.keys[k]! + d;
		}
	}
	return out;
};

type Bound = { lo: number; hi: number };

const signBound = (authored: number): Bound => {
	if (authored > 0) {
		return { lo: SIGN_FLOOR_FRAC * authored, hi: Infinity };
	}
	if (authored < 0) {
		return { lo: -Infinity, hi: SIGN_FLOOR_FRAC * authored };
	}
	return { lo: -Infinity, hi: Infinity };
};

// Spend `push` ovr points out of the vector `v`, taking them from the ratings that can still absorb them
const spendPush = (
	v: Record<string, number>,
	push: number,
	scale: ScaleVector,
	bound: (k: RatingKey) => Bound,
	measure: (v: Record<string, number>) => number,
) => {
	let rest = push;
	for (let pass = 0; pass < 24 && Math.abs(rest) > NEUTRAL_TOL; pass++) {
		const free = (Object.keys(v) as RatingKey[]).filter(
			(k) =>
				scale[k] > 0 &&
				(rest > 0 ? v[k]! > bound(k).lo + 1e-9 : v[k]! < bound(k).hi - 1e-9),
		);
		let fw = 0;
		for (const k of free) {
			fw += OVR_W[k] * scale[k];
		}
		if (!(fw > 0)) {
			break;
		}
		const u = rest / fw;
		for (const k of free) {
			const b = bound(k);
			v[k] = clamp(v[k]! - u * scale[k], b.lo, b.hi);
		}
		rest = measure(v);
	}
	return rest;
};

// BBGM's ovr BEFORE rounding and clamping. Used only to aim at the middle of an integer overall's rounding plateau.
const ovrExact = (r: BuildRatings) => {
	const x =
		0.159 * (r.hgt - 47.5) +
		0.0777 * (r.stre - 50.2) +
		0.123 * (r.spd - 50.8) +
		0.051 * (r.jmp - 48.7) +
		0.0632 * (r.endu - 39.9) +
		0.0126 * (r.ins - 42.4) +
		0.0286 * (r.dnk - 49.5) +
		0.0202 * (r.ft - 47.0) +
		0.0726 * (r.tp - 47.1) +
		0.133 * (r.oiq - 46.8) +
		0.159 * (r.diq - 46.7) +
		0.059 * (r.drb - 54.8) +
		0.062 * (r.pss - 51.3) +
		0.01 * (r.fg - 47.0) +
		0.01 * (r.reb - 51.4) +
		48.5;
	let f;
	if (x >= 68) {
		f = 8;
	} else if (x >= 50) {
		f = 4 + (x - 50) * (4 / 18);
	} else if (x >= 42) {
		f = -5 + (x - 42) * (9 / 8);
	} else if (x >= 31) {
		f = -5 - (42 - x) * (5 / 11);
	} else {
		f = -10;
	}
	return x + f;
};
export { ovrExact };

export const signatureLean = (
	arch: Archetype | undefined,
	enabled: boolean,
): Lean => {
	if (!arch || !enabled) {
		return null;
	}
	let lean: Lean = null;
	for (const t of arch.tags) {
		const sig = SIGNATURE_SKILLS[t];
		if (!sig) {
			continue;
		}
		lean = lean ?? {};
		for (const k of Object.keys(sig.keys) as RatingKey[]) {
			lean[k] = Math.max(lean[k] ?? 0, sig.keys[k]!);
		}
	}
	return lean;
};

// Per-rating shift scales for one build: lean into signature ratings going up, protect them going down
export const shiftScales = (
	arch: Archetype,
	up: boolean,
	pinned: Pinned,
	lean: Lean,
): ScaleVector => {
	const out = {} as ScaleVector;
	let maxOff = 0;
	for (const k of Object.keys(arch.o) as RatingKey[]) {
		maxOff = Math.max(maxOff, Math.abs(arch.o[k]!));
	}
	for (const key of RATING_KEYS) {
		if (pinned && Number.isFinite(pinned[key])) {
			out[key] = 0;
			continue;
		}
		const base = SHIFT_SCALE[key];
		const off = arch.o[key] ?? 0;
		const sig = maxOff > 0 ? clamp(off / maxOff, -1, 1) : 0;
		let f = up ? 1 + 0.75 * Math.max(0, sig) : 1 - 0.55 * Math.max(0, sig);
		const l = lean?.[key];
		if (l) {
			f *= up ? 1 + SIGNATURE_UP * l : 1 - SIGNATURE_DOWN * l;
		}
		out[key] = Math.max(0, base * f);
	}
	return out;
};

const factorScaleSS: Partial<Record<RatingKey, number>> = {
	ft: 1,
	tp: 1,
	fg: 0.7225,
	spd: 1,
	jmp: 1,
	dnk: 0.81,
	stre: 0.49,
	oiq: 1,
	diq: 1,
	pss: 0.64,
};
const factorScale = (key: RatingKey) => factorScaleSS[key] ?? 1;

// Re-neutralize the offset vector against the game's ACTUAL ovr, not the linear estimate. Mutates `applied`.
const neutralizeApplied = (
	F: Formulas,
	orig: BuildRatings,
	applied: Record<string, number>,
	arch: Archetype,
	pinned: Pinned,
) => {
	const scale = {} as ScaleVector;
	let any = false;
	for (const key of RATING_KEYS) {
		const s =
			(pinned && Number.isFinite(pinned[key])) || key === "hgt"
				? 0
				: (arch.ns?.[key] ?? SHIFT_SCALE[key]);
		scale[key] = s;
		if (s > 0) {
			any = true;
		}
	}
	if (!any) {
		return 0;
	}
	const at = (v: Record<string, number>) => {
		const t = {} as BuildRatings;
		for (const key of RATING_KEYS) {
			const pin = pinned?.[key];
			if (pin !== undefined && Number.isFinite(pin)) {
				t[key] = clamp(Math.round(pin), 0, 100);
			} else if (key === "hgt") {
				t[key] = orig[key];
			} else {
				t[key] = clamp(orig[key] + (v[key] ?? 0), 1, 99);
			}
		}
		return F.ovr(t);
	};
	const zero: Record<string, number> = {};
	for (const key of RATING_KEYS) {
		zero[key] = 0;
	}
	const ovr0 = at(zero);
	const v: Record<string, number> = {};
	const bounds = {} as Record<RatingKey, Bound>;
	for (const key of RATING_KEYS) {
		if (key === "hgt") {
			continue;
		}
		v[key] = applied[key] ?? 0;
		bounds[key] = signBound(applied[key] ?? 0);
	}
	const rest = spendPush(
		v,
		at(v) - ovr0,
		scale,
		(k) => bounds[k],
		(cur) => at(cur) - ovr0,
	);
	for (const key of Object.keys(v)) {
		applied[key] = v[key]!;
	}
	return rest;
};

export const applyShift = (
	base: BuildRatings,
	k: number,
	scales: ScaleVector,
	pinned: Pinned,
	caps: Caps | null | undefined,
): BuildRatings => {
	const out = {} as BuildRatings;
	for (const key of RATING_KEYS) {
		const pin = pinned?.[key];
		if (pin !== undefined && Number.isFinite(pin)) {
			out[key] = clamp(Math.round(pin), 0, 100);
			continue;
		}
		let v = base[key] + k * scales[key];

		// A shift DOWN eases onto the floor instead of driving through it. The knee is anchored at the base so k = 0 is the
		// identity for every rating.
		if (key !== "hgt") {
			const K = Math.min(FLOOR_KNEE, base[key] - 1);
			const t = v - 1;
			if (K > 0 && t < K) {
				v = t <= -K ? 1 : 1 + ((t + K) * (t + K)) / (4 * K);
			}
			v = softCap(v, capFor(caps, key), caps?.knee, caps?.headroom);
		}

		out[key] =
			key === "hgt"
				? clamp(Math.round(base[key] + k * scales[key]), 0, 100)
				: clamp(Math.round(v), 1, 99);
	}
	return out;
};

// The last point. Close the gap one rating at a time, spending it on the rating that moves ovr least past the target.
export const touchUp = (
	F: Formulas,
	ratingsIn: BuildRatings,
	targetOvr: number,
	pinned: Pinned,
	caps: Caps | null | undefined,
) => {
	let ratings = ratingsIn;
	let cur = F.ovr(ratings);
	const keys = RATING_KEYS.filter((k) => k !== "hgt");
	for (let iter = 0; iter < 8 && cur !== targetOvr; iter++) {
		const dir = targetOvr > cur ? 1 : -1;
		let best: BuildRatings | null = null;
		let bestGap = Math.abs(cur - targetOvr);

		// Where the scan starts is a hash of the vector itself: deterministic, but spread across ratings
		let h = targetOvr * 7 + iter;
		for (const key of keys) {
			h = (h * 31 + ratings[key]) % 99991;
		}
		const start = h % keys.length;

		for (let step = 1; step <= 3 && !best; step++) {
			for (let j = 0; j < keys.length; j++) {
				const key = keys[(start + j) % keys.length]!;
				const pin = pinned?.[key];
				if (pin !== undefined && Number.isFinite(pin)) {
					continue;
				}
				const v = ratings[key] + dir * step;
				if (v < 1 || v > 99) {
					continue;
				}
				if (dir > 0 && capFor(caps, key) > 0 && v > capFor(caps, key)) {
					continue;
				}
				const trial = { ...ratings, [key]: v };
				const gap = Math.abs(F.ovr(trial) - targetOvr);
				if (gap < bestGap) {
					bestGap = gap;
					best = trial;
				}
			}
		}
		if (!best) {
			break;
		}
		ratings = best;
		cur = F.ovr(ratings);
	}
	return ratings;
};

// The ovr range a build can be solved to. hgt is never shifted, so a very tall or short base cannot reach every target.
export const ovrRange = (
	F: Formulas,
	base: BuildRatings,
	arch: Archetype | null,
	pinned: Pinned,
	lean: Lean,
	caps: Caps | null | undefined,
) => {
	const upScales = arch ? shiftScales(arch, true, pinned, lean) : SHIFT_SCALE;
	const downScales = arch
		? shiftScales(arch, false, pinned, lean)
		: SHIFT_SCALE;
	return {
		min: F.ovr(applyShift(base, -SHIFT_RANGE, downScales, pinned, caps)),
		max: F.ovr(applyShift(base, SHIFT_RANGE, upScales, pinned, caps)),
	};
};

// The caps raised by the smallest uniform amount that makes `targetOvr` reachable at this base
const fitCaps = (
	caps: Caps | null,
	cleanBase: BuildRatings,
	arch: Archetype | null,
	pinned: Pinned,
	lean: Lean,
	targetOvr: number,
) => {
	if (!caps || !caps.preserve) {
		return caps;
	}
	const up = arch ? shiftScales(arch, true, pinned, lean) : SHIFT_SCALE;
	const reach = (c: Caps) =>
		ovrExact(applyShift(cleanBase, SHIFT_RANGE, up, pinned, c));
	if (reach(caps) >= targetOvr) {
		return caps;
	}
	if (reach(raiseCaps(caps, 100)) < targetOvr) {
		return raiseCaps(caps, 100);
	}
	let lo = 0;
	let hi = 100;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (reach(raiseCaps(caps, mid)) >= targetOvr) {
			hi = mid;
		} else {
			lo = mid;
		}
	}
	return raiseCaps(caps, hi);
};

// Solve for the shift that makes the game's ovr equal targetOvr
export const solveToOvr = (
	F: Formulas,
	base: BuildRatings,
	targetOvr: number,
	arch: Archetype | null,
	pinned: Pinned,
	lean: Lean,
	caps: Caps | null | undefined,
): BuildRatings & { solveShift?: number } => {
	const upScales = arch ? shiftScales(arch, true, pinned, lean) : SHIFT_SCALE;
	const downScales = arch
		? shiftScales(arch, false, pinned, lean)
		: SHIFT_SCALE;
	const shift = (k: number) =>
		applyShift(base, k, k >= 0 ? upScales : downScales, pinned, caps);
	let lo = -SHIFT_RANGE;
	let hi = SHIFT_RANGE;

	// An out-of-range target comes back as the nearest the search could reach (callers pre-clamp to ovrRange)
	if (F.ovr(shift(lo)) > targetOvr) {
		return shift(lo);
	}
	if (F.ovr(shift(hi)) < targetOvr) {
		return shift(hi);
	}

	// A build that already hits the target is left alone
	if (F.ovr(shift(0)) === targetOvr) {
		const same = shift(0) as BuildRatings & { solveShift?: number };
		same.solveShift = 0;
		return same;
	}

	// The left edge of the plateau of vectors that round to the target...
	for (let i = 0; i < 52; i++) {
		const mid = (lo + hi) / 2;
		if (F.ovr(shift(mid)) < targetOvr) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	const edge = hi;
	const goal = Math.min(targetOvr, ovrExact(shift(SHIFT_RANGE)));
	let lo2 = edge;
	let hi2 = SHIFT_RANGE;
	if (ovrExact(shift(edge)) >= goal) {
		hi2 = edge;
	} else {
		// ...then where the unrounded overall crosses the target, which is the middle of the plateau
		for (let i = 0; i < 52; i++) {
			const mid = (lo2 + hi2) / 2;
			if (ovrExact(shift(mid)) < goal) {
				lo2 = mid;
			} else {
				hi2 = mid;
			}
		}
	}
	const a = shift(lo2);
	const b = shift(hi2);
	const score = (r: BuildRatings) => [
		Math.abs(F.ovr(r) - targetOvr),
		Math.abs(ovrExact(r) - targetOvr),
	];
	const sa = score(a);
	const sb = score(b);
	const useLo = sa[0]! < sb[0]! || (sa[0] === sb[0] && sa[1]! <= sb[1]!);
	const near = useLo ? a : b;
	const shiftAt = useLo ? lo2 : hi2;
	const out = (
		F.ovr(near) === targetOvr ? near : touchUp(F, near, targetOvr, pinned, caps)
	) as BuildRatings & { solveShift?: number };
	out.solveShift = shiftAt;
	return out;
};

export type RebuildOptions = {
	specialization: number;
	buildNoise: number;
	skillCap: number;
	physCap: number;
	signatureSkills: boolean;

	// Scouting fuzz, only read by the signature-skills check
	fuzz: number;
};

export type RebuildResult = {
	archetype: Archetype;
	ratings: BuildRatings;
	ovr: number;
	range: { min: number; max: number };
	shortfall: number;
};

// Rebuild one player's ratings around `arch`. `orig` is the base (the ratings before any regeneration).
export const rebuildRatings = (
	F: Formulas,
	rng: Rng,
	orig: BuildRatings,
	targetOvr: number,
	arch: Archetype,
	pinned: Pinned,
	opts: RebuildOptions,
): RebuildResult => {
	const spec = clamp(opts.specialization, 0, 3);
	const noise = Math.max(0, opts.buildNoise);

	// The jitter is a player, not fourteen wobbles: three latent factors plus a smaller idiosyncratic term per rating
	const NOISE_FACTORS: {
		keys: Partial<Record<RatingKey, number>>;
		v: number;
	}[] = [
		{ keys: { ft: 1, tp: 1, fg: 0.85 }, v: 0 },
		{ keys: { spd: 1, jmp: 1, dnk: 0.9, stre: 0.7 }, v: 0 },
		{ keys: { oiq: 1, diq: 1, pss: 0.8 }, v: 0 },
	];
	const NOISE_SHARED = 0.6;
	for (const f of NOISE_FACTORS) {
		f.v = rng.normal(0, 1);
	}
	const noiseLoad: Partial<Record<RatingKey, number>> = {};
	for (const f of NOISE_FACTORS) {
		for (const k of Object.keys(f.keys) as RatingKey[]) {
			noiseLoad[k] = (noiseLoad[k] ?? 0) + f.v * f.keys[k]!;
		}
	}

	// The vector that is actually applied, re-neutralized against the game's real ovr
	const applied: Record<string, number> = {};
	for (const key of RATING_KEYS) {
		const pin = pinned?.[key];
		if (key === "hgt" || (pin !== undefined && Number.isFinite(pin))) {
			applied[key] = 0;
			continue;
		}
		let off = arch.o[key] ?? 0;
		if (off < 0) {
			// Scaled by the room it has so nothing is driven onto the floor
			const room = Math.max(0, orig[key] - 1);
			const denom = room + Math.abs(spec * off);
			off = denom > 0 ? off * (room / denom) : 0;
		}
		applied[key] = spec * off;
	}
	neutralizeApplied(F, orig, applied, arch, pinned);

	const base = {} as BuildRatings;
	const cleanBase = {} as BuildRatings;
	for (const key of RATING_KEYS) {
		const shared = noiseLoad[key] ?? 0;
		const idioShare = shared ? 1 - NOISE_SHARED : 1;
		const jitter =
			rng.normal(0, noise * Math.sqrt(idioShare)) +
			(shared * noise * Math.sqrt(NOISE_SHARED)) / Math.sqrt(factorScale(key));
		const pin = pinned?.[key];
		if (pin !== undefined && Number.isFinite(pin)) {
			base[key] = clamp(Math.round(pin), 0, 100);
			cleanBase[key] = base[key];
			continue;
		}
		const lo = key === "hgt" ? orig[key] : 1;
		const hi = key === "hgt" ? orig[key] : 99;
		base[key] = clamp(orig[key] + applied[key]! + jitter, lo, hi);
		cleanBase[key] = clamp(orig[key] + applied[key]!, lo, hi);
	}

	const lean = signatureLean(arch, opts.signatureSkills);
	const caps = fitCaps(
		liftCapsToRatings(rookieCaps(opts.skillCap, opts.physCap), orig),
		cleanBase,
		arch,
		pinned,
		lean,
		targetOvr,
	);
	const range = ovrRange(F, cleanBase, arch, pinned, lean, caps);

	// An unreachable target is solved to the nearest reachable one
	const reachable = clamp(targetOvr, range.min, range.max);
	const shortfall = reachable - targetOvr;
	let solved: BuildRatings = solveToOvr(
		F,
		base,
		reachable,
		arch,
		pinned,
		lean,
		caps,
	);
	let finalOvr = F.ovr(solved);

	// Jitter can push a rating onto its 1/99 clamp and cost a point of reach at the extremes: drop the jitter then
	if (
		finalOvr !== reachable &&
		reachable >= range.min &&
		reachable <= range.max
	) {
		const retry = solveToOvr(F, cleanBase, reachable, arch, pinned, lean, caps);
		if (Math.abs(F.ovr(retry) - reachable) < Math.abs(finalOvr - reachable)) {
			solved = retry;
			finalOvr = F.ovr(retry);
		}
	}

	// The signature guarantee: step the promised skill's ratings up and re-solve to the SAME overall
	if (lean && finalOvr === reachable) {
		const want: { label: string; keys: Partial<Record<RatingKey, number>> }[] =
			[];
		for (const t of arch.tags) {
			const sig = SIGNATURE_SKILLS[t];
			if (sig) {
				want.push(sig);
			}
		}
		for (let step = 1; step <= SIGNATURE_STEPS; step++) {
			const have = F.skills({ ...solved, fuzz: opts.fuzz });
			const missing = want.filter((w) => !have.includes(w.label));
			if (missing.length === 0) {
				break;
			}
			const nb = { ...base };
			const nc = { ...cleanBase };
			for (const w of missing) {
				for (const k of Object.keys(w.keys) as RatingKey[]) {
					const pin = pinned?.[k];
					if (k === "hgt" || (pin !== undefined && Number.isFinite(pin))) {
						continue;
					}
					const d = SIGNATURE_STEP * step * w.keys[k]!;
					nb[k] = clamp(base[k] + d, 1, 99);
					nc[k] = clamp(cleanBase[k] + d, 1, 99);
				}
			}
			const cand = solveToOvr(F, nb, finalOvr, arch, pinned, lean, caps);
			if (F.ovr(cand) !== finalOvr) {
				break;
			}
			const r2 = ovrRange(F, nc, arch, pinned, lean, caps);
			if (!(finalOvr >= r2.min && finalOvr <= r2.max)) {
				break;
			}
			solved = cand;
		}
	}

	// Strip the diagnostic
	const ratings = {} as BuildRatings;
	for (const key of RATING_KEYS) {
		ratings[key] = solved[key];
	}

	return {
		archetype: arch,
		ratings,
		ovr: finalOvr,
		range,
		shortfall: shortfall || 0,
	};
};
