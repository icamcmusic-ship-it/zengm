// Small text helpers and a seeded RNG for the newspaper engine. Pure functions only.

import type { NPRecord, Seg } from "./types.ts";

// FNV-1a string hash
export const hashString = (s: string) => {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
};

export class Rng {
	private state: number;

	constructor(seed: string) {
		this.state = hashString(seed) || 1;
	}

	// mulberry32
	random() {
		this.state = (this.state + 0x6d2b79f5) | 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	int(lo: number, hi: number) {
		return lo + Math.floor(this.random() * (hi - lo + 1));
	}

	pick<T>(xs: readonly T[]): T {
		if (xs.length === 0) {
			throw new Error("pick from empty array");
		}
		return xs[Math.floor(this.random() * xs.length)] as T;
	}

	shuffle<T>(xs: readonly T[]): T[] {
		const out = [...xs];
		for (let i = out.length - 1; i > 0; i--) {
			const j = Math.floor(this.random() * (i + 1));
			const tmp = out[i] as T;
			out[i] = out[j] as T;
			out[j] = tmp;
		}
		return out;
	}

	chance(p: number) {
		return this.random() < p;
	}
}

const WORDS = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
];
export const word = (n: number) => WORDS[n] ?? String(n);

export const ordinal = (n: number) => {
	const s = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export const plural = (n: number, singular: string, pl?: string) =>
	`${n} ${n === 1 ? singular : (pl ?? `${singular}s`)}`;

export const capFirst = (s: string) =>
	s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// "Hornets'" but "Heat's"
export const poss = (n: string) => (n.endsWith("s") ? `${n}'` : `${n}'s`);

export const fmt1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "0.0");

export const signed = (x: number, digits = 1) => {
	const v = Number(x.toFixed(digits));
	if (v === 0) {
		return (0).toFixed(digits);
	}
	return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
};

export const record = (r: NPRecord) => {
	let out = `${r.won}-${r.lost}`;
	if (r.otl) {
		out += `-${r.otl}`;
	}
	if (r.tied) {
		out += `-${r.tied}`;
	}
	return out;
};

export const winp = (r: NPRecord) => {
	const gp = r.won + r.lost + (r.tied ?? 0) + (r.otl ?? 0);
	return gp > 0 ? (r.won + 0.5 * (r.tied ?? 0)) / gp : 0;
};

// "a 50-32" vs "an 80-2", "an 11-71", "an 8-74"
export const aOrAn = (next: string) =>
	/^(8|11|18|8\d)(\D|$)/.test(next) || /^[aeiou]/i.test(next)
		? `an ${next}`
		: `a ${next}`;

export const money = (thousands: number) => {
	if (thousands >= 1000) {
		return `$${(thousands / 1000).toFixed(thousands >= 10000 ? 0 : 1)}M`;
	}
	return `$${Math.round(thousands)}k`;
};

// Join segments as "a, b and c"
export const andList = (items: Seg[][]): Seg[] => {
	const out: Seg[] = [];
	for (const [i, item] of items.entries()) {
		if (i > 0) {
			out.push(i === items.length - 1 ? " and " : ", ");
		}
		out.push(...item);
	}
	return out;
};

export const segText = (seg: Seg) => (typeof seg === "string" ? seg : seg.t);

export const segsText = (segs: Seg[]) => segs.map(segText).join("");

// Final clean-up of a string: double spaces, "1 games", " ." etc
export const polish = (s: string) =>
	s
		.replace(/\b1 (game|point|win|loss|season|round|title)s\b/g, "1 $1")
		.replace(/\b1 losses\b/g, "1 loss")
		.replace(/ {2,}/g, " ")
		.replace(/ ([,:;])/g, "$1")
		.replace(/ \.(?!\d)/g, ".")
		.replace(/\.\./g, ".")
		.replace(/\bundefined\b|\bNaN\b/g, "");

// Merge adjacent strings and polish them
export const tidySegs = (segs: Seg[]): Seg[] => {
	const out: Seg[] = [];
	for (const seg of segs) {
		const prev = out.at(-1);
		if (typeof seg === "string" && typeof prev === "string") {
			out[out.length - 1] = prev + seg;
		} else if (seg !== "") {
			out.push(seg);
		}
	}
	return out.map((seg) => (typeof seg === "string" ? polish(seg) : seg));
};
