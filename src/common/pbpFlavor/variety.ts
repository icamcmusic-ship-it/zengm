import type { Rng } from "./rng.ts";

/* Variety: a phrase used before in the same game is less likely to come up again (names are ignored when comparing), and one of the last
   few picked is almost never picked again right away. One memory per live game (see FlavorSession); the session makes its own memory the
   active one before it words anything. */

export class VarietyMemory {
	counts = new Map<string, number>();
	recent: string[] = [];
	private nameRegex: RegExp | undefined;

	constructor(names: string[] = []) {
		const escaped = names
			.filter((n) => n.length >= 2)
			.sort((a, b) => b.length - a.length)
			.map((n) => n.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`));
		this.nameRegex =
			escaped.length > 0 ? new RegExp(escaped.join("|"), "g") : undefined;
	}

	key(t: string) {
		let k = String(t);
		if (this.nameRegex) {
			k = k.replace(this.nameRegex, "N");
		}
		return k.replaceAll(/\d+/g, "#");
	}
}

let active = new VarietyMemory();

export const setVariety = (v: VarietyMemory) => {
	active = v;
};

export const weighted = <T>(
	rng: Rng,
	items: readonly T[],
	w: (x: T) => number,
): T | null => {
	let t = 0;
	for (const x of items) {
		t += Math.max(0, w(x));
	}
	if (t <= 0) {
		return null;
	}
	let r = rng.random() * t;
	for (const x of items) {
		r -= Math.max(0, w(x));
		if (r <= 0) {
			return x;
		}
	}
	return items.at(-1) ?? null;
};

export const varyW = (t: string) => {
	const k = active.key(t);
	return (
		(1 / (1 + 3 * (active.counts.get(k) ?? 0))) *
		(active.recent.includes(k) ? 0.05 : 1)
	);
};

export const varyUse = (t: string) => {
	const k = active.key(t);
	active.counts.set(k, (active.counts.get(k) ?? 0) + 1);
	active.recent.push(k);
	if (active.recent.length > 4) {
		active.recent.shift();
	}
};

// One of a list of phrases, remembering which one was used
export const pickV = (rng: Rng, arr: readonly string[]): string => {
	if (arr.length === 0) {
		return "";
	}
	const x = weighted(rng, arr, varyW) ?? arr[0]!;
	varyUse(x);
	return x;
};

// A weighted pick from [weight, text, ...] rows that also remembers the phrase
export const pickW = <R extends [number, string, ...any[]]>(
	rng: Rng,
	rows: (R | null | undefined | false)[],
): R | null => {
	const o = rows.filter((x): x is R => !!x && x[0] > 0);
	if (o.length === 0) {
		return null;
	}
	const x = weighted(rng, o, (y) => y[0] * varyW(y[1])) ?? o[0]!;
	varyUse(x[1]);
	return x;
};
