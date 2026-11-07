import { makeSeededRandom } from "../random.ts";

// A small seeded generator for the wording of the play-by-play. It is never connected to Math.random, so choosing words can neither change a
// game nor depend on how many random numbers the sim used.

const hash = (a: number, b: number) => {
	let h = 2166136261 ^ (a | 0);
	h = Math.imul(h ^ (b | 0), 16777619);
	h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
	return (h ^ (h >>> 15)) >>> 0;
};

export class Rng {
	random: () => number;

	constructor(gid: number, index: number) {
		this.random = makeSeededRandom(hash(Number.isFinite(gid) ? gid : 0, index));
		// Warm up: the first values of nearby seeds look alike
		this.random();
		this.random();
	}

	pick<T>(arr: readonly T[]): T {
		return arr[Math.floor(this.random() * arr.length)]!;
	}

	shuffle<T>(arr: readonly T[]): T[] {
		const a = arr.slice();
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(this.random() * (i + 1));
			[a[i], a[j]] = [a[j]!, a[i]!];
		}
		return a;
	}
}
