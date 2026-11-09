import type { Rng } from "./rng.ts";

/* Variety: a phrase used before in the same game is less likely to come up again (names and numbers are ignored when comparing), and one
   of the last RECENT phrases picked is never picked again while the list it comes from has another phrase to offer (when every phrase of a
   short list was used recently, the least recent ones are merely unlikely). One memory per live game (see FlavorSession); the session makes its own memory the
   active one before it words anything. */

// How many of the last phrases picked (all kinds of lines together: about the last 8 to 12 lines) are kept out of the next picks
export const RECENT = 32;

export class VarietyMemory {
	counts = new Map<string, number>();
	recent: string[] = [];
	// how many phrases have been picked, and when each was last picked (for the rarer lines, kept out for longer: see usedWithin)
	seq = 0;
	lastUse = new Map<string, number>();
	private nameRegex: RegExp | undefined;

	constructor(names: string[] = []) {
		const escaped = names
			.filter((n) => n.length >= 2)
			.sort((a, b) => b.length - a.length)
			.map((n) => n.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`));
		this.nameRegex =
			escaped.length > 0 ? new RegExp(escaped.join("|"), "g") : undefined;
	}

	// The text with every player and team name taken out
	stripNames(t: string) {
		return this.nameRegex ? t.replace(this.nameRegex, "N") : t;
	}

	key(t: string) {
		let k = String(t);
		if (this.nameRegex) {
			// ("Harris' crossover" and "De La Cruz's crossover" are the same phrase)
			k = k.replace(this.nameRegex, "N");
			if (k.includes("N's")) {
				k = k.replaceAll(/\bN's\b/g, "N'");
			}
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

export const isRecent = (t: string) => active.recent.includes(active.key(t));

// Was this phrase picked within the last n picks? (a set play or a move is noticed if it comes back too soon)
export const usedWithin = (t: string, n: number) => {
	const last = active.lastUse.get(active.key(t));
	return last !== undefined && active.seq - last < n;
};

// A weighted pick that skips the recently used phrases whenever a phrase not used recently has any weight
export const weightedVaried = <T>(
	rng: Rng,
	items: readonly T[],
	w: (x: T) => number,
	text: (x: T) => string,
): T | null => {
	const fresh = items.filter((x) => w(x) > 0 && !isRecent(text(x)));
	if (fresh.length > 0) {
		return weighted(rng, fresh, (x) => w(x) * varyW(text(x)));
	}
	return weighted(rng, items, (x) => w(x) * varyW(text(x)));
};

export const varyUse = (t: string) => {
	const k = active.key(t);
	active.counts.set(k, (active.counts.get(k) ?? 0) + 1);
	active.seq += 1;
	active.lastUse.set(k, active.seq);
	active.recent.push(k);
	if (active.recent.length > RECENT) {
		active.recent.shift();
	}
};

// One of a list of phrases, remembering which one was used
export const pickV = (rng: Rng, arr: readonly string[]): string => {
	if (arr.length === 0) {
		return "";
	}
	const x =
		weightedVaried(
			rng,
			arr,
			() => 1,
			(y) => y,
		) ?? arr[0]!;
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
	const x =
		weightedVaried(
			rng,
			o,
			(y) => y[0],
			(y) => y[1],
		) ?? o[0]!;
	varyUse(x[1]);
	return x;
};
