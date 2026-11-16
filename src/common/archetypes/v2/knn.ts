// archv2: the labeled players a reading votes with. Each labeled player (the user's own NBA 2K list, user2k.data.ts,
// all-time entries at half weight; the judged answer key, judged.data.ts / judgedSim.data.ts; the user's own archetype
// picks, archfb) is a point in a feature space (what the family classifier reads: model.ts FAM_FEATS, his skill classes,
// size, level, box score, sub-ratings and play types), standardized per position bucket. A player's k nearest labeled
// players (distance-weighted) vote for a family, a role, descriptors, display words and a build. A labeled player never
// votes for himself (leave-one-out by his real-player id), and the evaluation holds 30% of the labeled players out
// (v2/v2.script.test.ts).
import { POS_BUCKETS } from "../norms.ts";
import type { Family } from "../families.ts";
import type { Pos, PosBucket } from "../types.ts";
import { KNN_KEYS, KNN_META, KNN_NAMES, KNN_SCALE, KNN_X } from "./knn.data.ts";
import { familyOfName, parseName, type WordPick } from "./grammar.ts";

// The features: FAM_FEATS without the constant and the prospect flag
export const FEAT_FROM_FAMX = (famX: readonly number[]): number[] =>
	famX.filter((_, i) => i !== 0 && i !== 14);
export const N_FEATS = 35;
// Feature weights in the distance: the skill classes and strength count fully, the rest (size, level, stats, subs, play
// types) half
export const FEAT_W: number[] = Array.from({ length: N_FEATS }, (_, i) =>
	i < 11 ? 1 : 0.5,
);

export const POS_LIST: Pos[] = [
	"PG",
	"G",
	"SG",
	"GF",
	"SF",
	"F",
	"PF",
	"FC",
	"C",
];
export const BUCKET_OF: Record<Pos, PosBucket> = {
	PG: "PG",
	G: "SG",
	SG: "SG",
	GF: "W",
	SF: "W",
	F: "F",
	PF: "F",
	FC: "C",
	C: "C",
};

// Where a label comes from (its weight in the vote)
export type RefSource = "2k" | "2kAllTime" | "judged" | "pick";
export const SOURCE_W: Record<RefSource, number> = {
	"2k": 1,
	"2kAllTime": 0.5,
	judged: 0.5,
	pick: 1.5,
};

export type RefRow = {
	// Who he is (real-player id or judged key): never a vote for himself
	key: string;
	name: string;
	pos: Pos;
	bucket: number;
	src: RefSource;
	split: "tune" | "test";
	// Standardized features
	x: number[];
	// What his name says (cached)
	family: Family;
	role?: string;
	descs: string[];
	words: WordPick;
};

// ---- the shipped table: features quantized to int8 (step 0.05) in base64 ----
export const QUANT = 20;
export const encodeX = (rows: number[][]): string => {
	const bytes: number[] = [];
	for (const r of rows) {
		for (const v of r) {
			const q = Math.max(-127, Math.min(127, Math.round(v * QUANT)));
			bytes.push(q < 0 ? q + 256 : q);
		}
	}
	let bin = "";
	for (const b of bytes) {
		bin += String.fromCharCode(b);
	}
	return btoa(bin);
};
const decodeX = (s: string, n: number): number[][] => {
	const bin = atob(s);
	const out: number[][] = [];
	for (let i = 0; i < n; i++) {
		const r: number[] = [];
		for (let j = 0; j < N_FEATS; j++) {
			const b = bin.charCodeAt(i * N_FEATS + j);
			r.push((b > 127 ? b - 256 : b) / QUANT);
		}
		out.push(r);
	}
	return out;
};

const SRC_CODES: RefSource[] = ["2k", "2kAllTime", "judged", "pick"];
export const metaOf = (r: {
	nameIdx: number;
	bucket: number;
	src: RefSource;
	split: "tune" | "test";
	pos: Pos;
}) =>
	`${r.nameIdx},${r.bucket},${SRC_CODES.indexOf(r.src)},${r.split === "test" ? 1 : 0},${POS_LIST.indexOf(r.pos)}`;

export const labelRow = (
	base: Omit<RefRow, "family" | "role" | "descs" | "words">,
): RefRow => {
	const parsed = parseName(base.name, base.pos);
	return {
		...base,
		family: familyOfName(base.name, base.pos),
		role: parsed.role,
		descs: parsed.descs,
		words: parsed.words,
	};
};

let shipped: RefRow[] | undefined;
export const shippedRefs = (): RefRow[] => {
	if (!shipped) {
		const metas = KNN_META ? KNN_META.split(";") : [];
		const xs = decodeX(KNN_X, metas.length);
		shipped = metas.map((m, i) => {
			const [nameIdx, bucket, src, split, pos] = m.split(",").map(Number);
			return labelRow({
				key: KNN_KEYS[i]!,
				name: KNN_NAMES[nameIdx!]!,
				pos: POS_LIST[pos!]!,
				bucket: bucket!,
				src: SRC_CODES[src!]!,
				split: split === 1 ? "test" : "tune",
				x: xs[i]!,
			});
		});
	}
	return shipped;
};

// Standardize raw features by his position bucket (the labeled table's mean and sd)
export const standardize = (raw: readonly number[], bucket: PosBucket) => {
	const s = KNN_SCALE[bucket];
	return raw.map((v, i) =>
		s ? (v - s.mean[i]!) / Math.max(1e-6, s.sd[i]!) : v,
	);
};
export const bucketIndex = (b: PosBucket) => POS_BUCKETS.indexOf(b);

export type Votes = {
	// Shares (sum 1) over families, roles, build ids or names (canonical), and per descriptor the weighted share of
	// neighbours whose name has it
	family: Partial<Record<Family, number>>;
	role: Partial<Record<string, number>>;
	desc: Partial<Record<string, number>>;
	canon: Partial<Record<string, number>>;
	// Display words: per role/descriptor key, the variant the neighbours use most
	words: WordPick;
	// Neighbours used and their total weight
	n: number;
	// How close they are: mean distance
	dist: number;
};

export type KnnOptions = {
	k?: number;
	// Distance added per position bucket apart
	bucketGap?: number;
	// Leave out: his own key (leave-one-out) and, for the held-out evaluation, the test split
	exclude?: string;
	tuneOnly?: boolean;
	// The user's own picks, on top of the shipped table
	extra?: readonly RefRow[];
	srcW?: Partial<Record<RefSource, number>>;
	canonOf?: (name: string, pos: Pos) => string;
};

const canonCache = new WeakMap<RefRow, string>();

export const knnVotes = (
	x: readonly number[],
	bucket: PosBucket,
	opts: KnnOptions = {},
): Votes => {
	const k = opts.k ?? 15;
	const gap = opts.bucketGap ?? 2;
	const bi = bucketIndex(bucket);
	const refs = opts.extra ? [...shippedRefs(), ...opts.extra] : shippedRefs();
	const best: { r: RefRow; d: number }[] = [];
	for (const r of refs) {
		if (r.key === opts.exclude || (opts.tuneOnly && r.split === "test")) {
			continue;
		}
		let d = gap * Math.abs(r.bucket - bi);
		for (let i = 0; i < N_FEATS; i++) {
			const t = (x[i] ?? 0) - (r.x[i] ?? 0);
			d += FEAT_W[i]! * t * t;
		}
		d = Math.sqrt(d);
		if (best.length < k || d < best.at(-1)!.d) {
			best.push({ r, d });
			best.sort((a, b) => a.d - b.d);
			if (best.length > k) {
				best.pop();
			}
		}
	}
	const v: Votes = {
		family: {},
		role: {},
		desc: {},
		canon: {},
		words: {},
		n: 0,
		dist: 0,
	};
	const wordW: Record<string, Record<string, number>> = {};
	let total = 0;
	for (const { r, d } of best) {
		const w = (opts.srcW?.[r.src] ?? SOURCE_W[r.src]) / (0.5 + d);
		total += w;
		v.dist += d;
		v.family[r.family] = (v.family[r.family] ?? 0) + w;
		if (r.role) {
			v.role[r.role] = (v.role[r.role] ?? 0) + w;
		}
		for (const ds of r.descs) {
			v.desc[ds] = (v.desc[ds] ?? 0) + w;
		}
		if (opts.canonOf) {
			let c = canonCache.get(r);
			if (c === undefined) {
				c = opts.canonOf(r.name, r.pos);
				canonCache.set(r, c);
			}
			v.canon[c] = (v.canon[c] ?? 0) + w;
		}
		for (const [key, word] of Object.entries(r.words)) {
			(wordW[key] ??= {})[word!] = (wordW[key]![word!] ?? 0) + w;
		}
	}
	if (total > 0) {
		for (const m of [v.family, v.role, v.desc, v.canon] as Record<
			string,
			number
		>[]) {
			for (const key of Object.keys(m)) {
				m[key]! /= total;
			}
		}
	}
	for (const [key, ws] of Object.entries(wordW)) {
		v.words[key] = Object.entries(ws).sort(
			(a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
		)[0]![0];
	}
	v.n = best.length;
	v.dist = best.length > 0 ? v.dist / best.length : 0;
	return v;
};
