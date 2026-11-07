// Small seeded random number generator, so the same seed always gives the same college seasons

export const hashString = (str: string) => {
	// cyrb128-ish, returns a 32 bit seed
	let h1 = 1779033703 ^ str.length;
	let h2 = 3144134277;
	for (let i = 0; i < str.length; i++) {
		const k = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ k, 597399067);
		h2 = Math.imul(h2 ^ k, 2869860233);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 18), 597399067);
	h2 = Math.imul(h2 ^ (h2 >>> 22), 2869860233);
	return (h1 ^ h2) >>> 0;
};

export class Rng {
	private state: number;
	private spare: number | undefined;

	constructor(seed: string) {
		this.state = hashString(seed) || 1;
	}

	// mulberry32
	random() {
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	// Standard normal
	normal(mean = 0, sd = 1) {
		if (this.spare !== undefined) {
			const value = this.spare;
			this.spare = undefined;
			return mean + sd * value;
		}
		let u = 0;
		while (u === 0) {
			u = this.random();
		}
		const v = this.random();
		const mag = Math.sqrt(-2 * Math.log(u));
		this.spare = mag * Math.sin(2 * Math.PI * v);
		return mean + sd * mag * Math.cos(2 * Math.PI * v);
	}

	poisson(lambda: number) {
		if (lambda <= 0) {
			return 0;
		}
		if (lambda > 30) {
			return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
		}
		const limit = Math.exp(-lambda);
		let k = 0;
		let p = 1;
		do {
			k += 1;
			p *= this.random();
		} while (p > limit);
		return k - 1;
	}

	binomial(n: number, p: number) {
		if (n <= 0 || p <= 0) {
			return 0;
		}
		if (p >= 1) {
			return n;
		}
		let successes = 0;
		for (let i = 0; i < n; i++) {
			if (this.random() < p) {
				successes += 1;
			}
		}
		return successes;
	}

	// Weighted choice
	weighted<T>(items: T[], weights: number[]): T {
		let total = 0;
		for (const w of weights) {
			total += w;
		}
		let x = this.random() * total;
		for (const [i, item] of items.entries()) {
			x -= weights[i]!;
			if (x <= 0) {
				return item;
			}
		}
		return items.at(-1)!;
	}
}

export const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));
