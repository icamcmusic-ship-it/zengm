// Archetype feedback and tuning (archfb): the user's own "Doesn't fit?" picks become the answer key. Each pick is saved with
// a snapshot of the reading (the terms of the build he was shown and the build the user picked, plus the raw reading
// inputs for an offline refit), and a small per-user adjustment is fitted on top of the shipped model:
// - a bias offset per build (capped at +-BIAS_CAP z, scaled down until a build has BIAS_FULL_AT picks)
// - multipliers on the sub-rating, play-type and trait terms (TERM_MULT_MIN..MAX) and an offset per family (+-FAM_CAP),
//   only from MIN_PICKS_GLOBAL picks on
// by a regularised pairwise ranking update (the picked build should outrank the shown one for that snapshot; strong L2
// toward zero, so a few picks cannot wreck the reading). Deterministic: fixed iterations, fixed order, rounded results.
// Everything else stays as it is: name promises (their terms are not tuned), blocked positions, the generic fallback and
// stickiness (classify.ts) still apply on top.
import { FAMILIES, FAMILY_NAMES, type Family } from "./families.ts";
import { familyTerms, scoreTerms, weighTerms } from "./classify.ts";
import {
	CLASS_FEATS,
	TERMS,
	TRAIT_TERMS,
	type FittedModel,
	type Term,
} from "./model.ts";
import type { ReadOptions } from "./score.ts";
import type { ArchetypeRatings, Norms, Pos } from "./types.ts";

export const BIAS_CAP = 0.5;
export const FAM_CAP = 0.5;
export const TERM_MULT_MIN = 0.7;
export const TERM_MULT_MAX = 1.3;
export const MIN_PICKS_GLOBAL = 10;
export const BIAS_FULL_AT = 3;
// L2 strengths (toward zero offsets / multipliers of 1)
export const L2_BIAS = 1;
export const L2_FAM = 4;
export const L2_MULT = 20;
const MARGIN = 0.1;
const ITERS = 200;
// A pick ticked "a better kind of player" counts this much
export const BETTER_W = 1.5;

export const TERM_GROUPS = {
	sub: ["sub"],
	playType: ["playType"],
	traits: TRAIT_TERMS,
} satisfies Record<string, readonly Term[]>;
export type TermGroup = keyof typeof TERM_GROUPS;
const GROUP_KEYS = Object.keys(TERM_GROUPS) as TermGroup[];
const GROUP_IDX: Record<TermGroup, number[]> = Object.fromEntries(
	GROUP_KEYS.map((k) => [
		k,
		(TERM_GROUPS[k] as readonly Term[]).map((t) => TERMS.indexOf(t)),
	]),
) as any;

// One build's terms in a snapshot. `base` holds what tuning never changes (the position prior, traits' tie-breaks and
// the family classifier's term); score = base + famBias + theta . f + cls weights . cls (classify.ts weighTerms)
export type SnapRow = {
	id: string;
	fam: Family;
	base: number;
	f: number[];
	cls: number[];
};

// The reading inputs at the time of the pick (for the offline refit)
export type PickInput = {
	ratings: ArchetypeRatings;
	pos: Pos;
	ovr?: number;
	age?: number;
	prospect?: boolean;
	stats?: ReadOptions["stats"];
	pt?: ReadOptions["pt"];
	traits?: Partial<Record<string, number>>;
};

export type FeedbackPick = {
	uid: string;
	at: number;
	pid: number;
	name?: string;
	season: number;
	pos: Pos;
	// The build he was shown, and the one the user picked (null: "None of these / I'm not sure")
	shown: string;
	picked: string | null;
	better?: boolean;
	expanded: boolean;
	// Reading version (helpers.ts ARCHETYPE_READING_VERSION)
	v: number;
	rows: SnapRow[];
	input: PickInput;
};

export type Tuning = {
	n: number;
	bias: Record<string, number>;
	mult: Record<TermGroup, number>;
	famOff: Partial<Record<Family, number>>;
	hash: string;
};

export const EMPTY_TUNING: Tuning = {
	n: 0,
	bias: {},
	mult: { sub: 1, playType: 1, traits: 1 },
	famOff: {},
	hash: "",
};

export const isEmptyTuning = (t: Tuning | undefined) => !t || t.hash === "";

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

// The snapshot rows for some builds (the best of each build's profiles under the model, as scoreAll reads it)
export const snapshotRows = (
	ratings: ArchetypeRatings,
	norms: Norms,
	model: FittedModel,
	ids: string[],
	pos: Pos | undefined,
	traits: Partial<Record<string, number>> | undefined,
	read: Omit<ReadOptions, "pos">,
): SnapRow[] => {
	const t = scoreTerms(ratings, norms, undefined, pos, traits, read);
	const fam = familyTerms(model, t.rows, t.famX);
	const out: SnapRow[] = [];
	for (const id of ids) {
		let best: { z: number; row: SnapRow } | undefined;
		for (const r of t.rows) {
			if (r.pub.id !== id || r.blocked) {
				continue;
			}
			const famTerm = r.fam === "allAround" ? 0 : (fam[r.fam] ?? 0);
			const z = weighTerms(model, r) + famTerm;
			if (!best || z > best.z) {
				best = {
					z,
					row: {
						id,
						fam: r.fam,
						base: round3(r.base + famTerm),
						f: r.f.map(round3),
						cls: r.cls.map(round3),
					},
				};
			}
		}
		if (best) {
			out.push(best.row);
		}
	}
	return out;
};

// A snapshot row's score under a model and a tuning
export const rowScore = (m: FittedModel, row: SnapRow, t: Tuning): number => {
	let z = row.base + m.famBias[row.fam] + (t.famOff[row.fam] ?? 0);
	for (const [i, term] of TERMS.entries()) {
		z += m.theta[term] * row.f[i]! * multOfTerm(t, i);
	}
	// (cls in CLASS_FEATS order, as stored)
	for (const [i, k] of CLASS_FEATS.entries()) {
		z += m.cls[k] * (row.cls[i] ?? 0);
	}
	return z + (t.bias[row.id] ?? 0);
};
const multOfTerm = (t: Tuning, i: number) => {
	for (const k of GROUP_KEYS) {
		if (GROUP_IDX[k].includes(i)) {
			return t.mult[k];
		}
	}
	return 1;
};
const groupContrib = (m: FittedModel, row: SnapRow, k: TermGroup) => {
	let s = 0;
	for (const i of GROUP_IDX[k]) {
		s += m.theta[TERMS[i]!] * row.f[i]!;
	}
	return s;
};

export const hashTuning = (t: Omit<Tuning, "hash">): string => {
	const s = JSON.stringify([
		Object.entries(t.bias).sort(),
		GROUP_KEYS.map((k) => t.mult[k]),
		Object.entries(t.famOff).sort(),
	]);
	if (
		Object.keys(t.bias).length === 0 &&
		Object.keys(t.famOff).length === 0 &&
		GROUP_KEYS.every((k) => t.mult[k] === 1)
	) {
		return "";
	}
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	}
	return (h >>> 0).toString(36);
};

// The usable pairs: a pick of another build with both rows in the snapshot (deduplicated by uid, the latest pick per
// player kept: a re-pick replaces the earlier one)
export const usablePicks = (picks: FeedbackPick[]): FeedbackPick[] => {
	const byUid = new Map<string, FeedbackPick>();
	for (const p of picks) {
		byUid.set(p.uid, p);
	}
	const latest = new Map<string, FeedbackPick>();
	for (const p of [...byUid.values()].sort(
		(a, b) => a.at - b.at || (a.uid < b.uid ? -1 : 1),
	)) {
		latest.set(`${p.pid}:${p.season}:${p.input?.ratings?.hgt}`, p);
	}
	return [...latest.values()]
		.filter(
			(p) =>
				p.picked !== null &&
				p.picked !== p.shown &&
				p.rows.some((r) => r.id === p.picked) &&
				p.rows.some((r) => r.id === p.shown),
		)
		.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
};

// Fit the tuning from the picks. `modelFor` gives the shipped model a pick was read with.
export const fitTuning = (
	picksIn: FeedbackPick[],
	modelFor: (expanded: boolean) => FittedModel,
): Tuning => {
	const picks = usablePicks(picksIn);
	const n = picks.length;
	if (n === 0) {
		return EMPTY_TUNING;
	}
	const global = n >= MIN_PICKS_GLOBAL;
	const pairs = picks.map((p) => {
		const m = modelFor(p.expanded);
		const a = p.rows.find((r) => r.id === p.picked)!;
		const b = p.rows.find((r) => r.id === p.shown)!;
		return {
			a,
			b,
			w: p.better ? BETTER_W : 1,
			d0: rowScore(m, a, EMPTY_TUNING) - rowScore(m, b, EMPTY_TUNING),
			dc: GROUP_KEYS.map((k) => groupContrib(m, a, k) - groupContrib(m, b, k)),
		};
	});
	const ids = [...new Set(pairs.flatMap((p) => [p.a.id, p.b.id]))].sort();
	const cnt: Record<string, number> = {};
	for (const p of pairs) {
		cnt[p.a.id] = (cnt[p.a.id] ?? 0) + 1;
		cnt[p.b.id] = (cnt[p.b.id] ?? 0) + 1;
	}
	const bias: Record<string, number> = Object.fromEntries(
		ids.map((id) => [id, 0]),
	);
	const u = GROUP_KEYS.map(() => 0);
	const fam: Record<string, number> = Object.fromEntries(
		FAMILIES.map((f) => [f, 0]),
	);
	const famCnt: Record<string, number> = {};
	for (const p of pairs) {
		if (p.a.fam !== p.b.fam) {
			famCnt[p.a.fam] = (famCnt[p.a.fam] ?? 0) + 1;
			famCnt[p.b.fam] = (famCnt[p.b.fam] ?? 0) + 1;
		}
	}
	const uCurv = GROUP_KEYS.map(
		(_, k) => 2 * L2_MULT + pairs.reduce((s, p) => s + 0.25 * p.dc[k]! ** 2, 0),
	);
	for (let it = 0; it < ITERS; it++) {
		const gb: Record<string, number> = {};
		const gu = GROUP_KEYS.map(() => 0);
		const gf: Record<string, number> = {};
		for (const p of pairs) {
			let d = p.d0 + (bias[p.a.id] ?? 0) - (bias[p.b.id] ?? 0);
			if (global) {
				for (let k = 0; k < u.length; k++) {
					d += u[k]! * p.dc[k]!;
				}
				if (p.a.fam !== p.b.fam) {
					d += fam[p.a.fam]! - fam[p.b.fam]!;
				}
			}
			// d/dd softplus(MARGIN - d) = -sigmoid(MARGIN - d)
			const gr = -p.w / (1 + Math.exp(-(MARGIN - d)));
			gb[p.a.id] = (gb[p.a.id] ?? 0) + gr;
			gb[p.b.id] = (gb[p.b.id] ?? 0) - gr;
			if (global) {
				for (let k = 0; k < u.length; k++) {
					gu[k]! += gr * p.dc[k]!;
				}
				if (p.a.fam !== p.b.fam) {
					gf[p.a.fam] = (gf[p.a.fam] ?? 0) + gr;
					gf[p.b.fam] = (gf[p.b.fam] ?? 0) - gr;
				}
			}
		}
		// Diagonal Newton-like steps (stable whatever the number of picks), projected onto the caps
		for (const id of ids) {
			const g = (gb[id] ?? 0) + 2 * L2_BIAS * bias[id]!;
			bias[id] = clamp(
				bias[id]! - (0.5 * g) / (2 * L2_BIAS + 0.25 * cnt[id]!),
				-BIAS_CAP,
				BIAS_CAP,
			);
		}
		if (global) {
			for (let k = 0; k < u.length; k++) {
				const g = gu[k]! + 2 * L2_MULT * u[k]!;
				u[k] = clamp(
					u[k]! - (0.5 * g) / uCurv[k]!,
					TERM_MULT_MIN - 1,
					TERM_MULT_MAX - 1,
				);
			}
			for (const f of FAMILIES) {
				if (!famCnt[f]) {
					continue;
				}
				const g = (gf[f] ?? 0) + 2 * L2_FAM * fam[f]!;
				fam[f] = clamp(
					fam[f]! - (0.5 * g) / (2 * L2_FAM + 0.25 * famCnt[f]),
					-FAM_CAP,
					FAM_CAP,
				);
			}
		}
	}
	const outBias: Record<string, number> = {};
	for (const id of ids) {
		// (a build's offset grows with its picks: one pick moves it a little)
		const b = round3(
			clamp(
				bias[id]! * Math.min(1, cnt[id]! / BIAS_FULL_AT),
				-BIAS_CAP,
				BIAS_CAP,
			),
		);
		if (Math.abs(b) >= 0.005) {
			outBias[id] = b;
		}
	}
	const mult = Object.fromEntries(
		GROUP_KEYS.map((k, i) => [k, global ? round3(1 + u[i]!) : 1]),
	) as Record<TermGroup, number>;
	const famOff: Partial<Record<Family, number>> = {};
	if (global) {
		for (const f of FAMILIES) {
			const v = round3(fam[f]!);
			if (Math.abs(v) >= 0.005) {
				famOff[f] = v;
			}
		}
	}
	const t = { n, bias: outBias, mult, famOff };
	return { ...t, hash: hashTuning(t) };
};

// The shipped model with a tuning on top (the same object back for no tuning)
const tunedCache = new WeakMap<FittedModel, Map<string, FittedModel>>();
export const applyTuning = (m: FittedModel, t?: Tuning): FittedModel => {
	if (!t || isEmptyTuning(t)) {
		return m;
	}
	let byHash = tunedCache.get(m);
	if (!byHash) {
		byHash = new Map();
		tunedCache.set(m, byHash);
	}
	const hit = byHash.get(t.hash);
	if (hit) {
		return hit;
	}
	const theta = { ...m.theta };
	for (const [i, term] of TERMS.entries()) {
		theta[term] = m.theta[term] * multOfTerm(t, i);
	}
	const famBias = { ...m.famBias };
	for (const [f, v] of Object.entries(t.famOff) as [Family, number][]) {
		famBias[f] += v;
	}
	const out: FittedModel = { ...m, theta, famBias, buildBias: { ...t.bias } };
	if (byHash.size > 8) {
		byHash.clear();
	}
	byHash.set(t.hash, out);
	return out;
};

// What changed, in words (no numbers: the no-visible-ratings challenge)
export const describeTuning = (
	t: Tuning,
	nameOf: (id: string) => string | undefined,
	max = 6,
): string[] => {
	const out: { s: string; w: number }[] = [];
	for (const [id, b] of Object.entries(t.bias)) {
		const name = nameOf(id);
		if (name && Math.abs(b) >= 0.05) {
			out.push({
				s: `${b > 0 ? "More" : "Fewer"} players read as ${name}${Math.abs(b) >= 0.3 ? "" : " (a little)"}`,
				w: Math.abs(b),
			});
		}
	}
	for (const [f, v] of Object.entries(t.famOff) as [Family, number][]) {
		if (Math.abs(v) >= 0.05) {
			out.push({
				s: `${v > 0 ? "More" : "Fewer"} players read as ${FAMILY_NAMES[f].toLowerCase()} builds`,
				w: Math.abs(v),
			});
		}
	}
	const words: Record<TermGroup, string> = {
		sub: "Sub-ratings",
		playType: "Play types",
		traits: "Player traits",
	};
	for (const k of GROUP_KEYS) {
		const d = t.mult[k] - 1;
		if (Math.abs(d) >= 0.03) {
			out.push({
				s: `${words[k]} count ${d > 0 ? "more" : "less"} in the reading`,
				w: Math.abs(d),
			});
		}
	}
	out.sort((a, b) => b.w - a.w || (a.s < b.s ? -1 : 1));
	return out.slice(0, max).map((x) => x.s);
};

// The pick file the user exports for the developer (and imports back)
export type PickFile = {
	kind: "bbgm-archetype-picks";
	version: 1;
	exported: number;
	picks: FeedbackPick[];
};
export const toPickFile = (picks: FeedbackPick[], now: number): PickFile => ({
	kind: "bbgm-archetype-picks",
	version: 1,
	exported: now,
	picks,
});
export const fromPickFile = (x: unknown): FeedbackPick[] => {
	const f = x as Partial<PickFile> | undefined;
	if (!f || f.kind !== "bbgm-archetype-picks" || !Array.isArray(f.picks)) {
		throw new Error("Not an archetype pick file");
	}
	return f.picks.filter(
		(p) =>
			p &&
			typeof p.uid === "string" &&
			typeof p.shown === "string" &&
			Array.isArray(p.rows),
	);
};

// Merge pick lists (by uid; the later list wins)
export const mergePicks = (...lists: FeedbackPick[][]): FeedbackPick[] => {
	const m = new Map<string, FeedbackPick>();
	for (const l of lists) {
		for (const p of l) {
			m.set(p.uid, p);
		}
	}
	return [...m.values()].sort(
		(a, b) => a.at - b.at || (a.uid < b.uid ? -1 : 1),
	);
};

// The developer's full offline refit (fit.script.test.ts ARCH_PICKS): the user's picks as a judged set, the picked build
// as the answer; 30% of picks (by a hash of the pick) are the test split. "None of these" picks are left out.
export const picksToJudged = (picks: FeedbackPick[]) =>
	usablePicks(picks).map((p) => {
		let h = 2166136261;
		for (let i = 0; i < p.uid.length; i++) {
			h = Math.imul(h ^ p.uid.charCodeAt(i), 16777619);
		}
		return {
			key: `pick-${p.uid}`,
			src: "picks" as const,
			pos: p.pos,
			ratings: p.input.ratings,
			read: {
				age: p.input.age,
				prospect: p.input.prospect,
				stats: p.input.stats,
				pt: p.input.pt,
			},
			traits: p.input.traits,
			ids: [p.picked!],
			season: p.season,
			split: (h >>> 0) % 10 < 3 ? ("test" as const) : ("tune" as const),
		};
	});
