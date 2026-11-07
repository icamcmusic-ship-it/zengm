// Seeded RNG streams. Same seed string -> same sequence, always. Child streams are derived from the seed string
// itself, not from a draw off the parent, so creating one child never moves another.

// xmur3 string hash -> 32 bit seed generator
const hashSeed = (input: string) => {
	const str = String(input);
	let h = 1779033703 ^ str.length;
	for (let i = 0; i < str.length; i++) {
		h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return () => {
		h = Math.imul(h ^ (h >>> 16), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		h ^= h >>> 16;
		return h >>> 0;
	};
};

export class Rng {
	seedString: string;
	private a: number;

	constructor(seed: string | number) {
		this.seedString = String(seed);
		this.a = hashSeed(this.seedString)();
	}

	// mulberry32, [0, 1)
	random() {
		this.a |= 0;
		this.a = (this.a + 0x6d2b79f5) | 0;
		let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	uniform(lo: number, hi: number) {
		return lo + (hi - lo) * this.random();
	}

	// Uniform integer in [lo, hi], both inclusive
	int(lo: number, hi: number) {
		if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
			if (Number.isFinite(lo)) {
				return lo;
			}
			if (Number.isFinite(hi)) {
				return hi;
			}
			return 0;
		}
		if (hi < lo) {
			return lo;
		}
		const v = Math.floor(lo + (hi - lo + 1) * this.random());
		return v < lo ? lo : v > hi ? hi : v;
	}

	// Box-Muller
	normal(mean: number, sd: number) {
		let u = 0;
		let v = 0;
		while (u === 0) {
			u = this.random();
		}
		while (v === 0) {
			v = this.random();
		}
		return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	}

	chance(p: number) {
		return this.random() < p;
	}

	pick<T>(arr: readonly T[]): T {
		return arr[Math.floor(this.random() * arr.length)]!;
	}

	// Weighted draw. Non-finite / negative weights count as 0.
	weighted<T>(items: readonly T[], weightFn: (item: T) => number): T {
		const wf = (x: T) => {
			const w = weightFn(x);
			return Number.isFinite(w) && w > 0 ? w : 0;
		};
		let total = 0;
		for (const it of items) {
			total += wf(it);
		}
		if (!(total > 0) || !Number.isFinite(total)) {
			return this.pick(items);
		}
		let r = this.random() * total;
		let last: T | undefined;
		for (const it of items) {
			const w = wf(it);
			if (w <= 0) {
				continue;
			}
			last = it;
			r -= w;
			if (r < 0) {
				return it;
			}
		}
		return last!;
	}

	child(key: string | number) {
		return new Rng(`${this.seedString}|${key}`);
	}
}

export const clamp = (x: number, lo: number, hi: number) =>
	x < lo ? lo : x > hi ? hi : x;
