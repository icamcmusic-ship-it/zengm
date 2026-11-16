// League salt: a per-league number mixed into every seeded (deterministic) derivation of the fork (sub-rating shapes, trait seeds, faces,
// award vote noise, newspaper/play-by-play/story wording, college stats, ratings builds, career aging...), so two leagues with the same
// players (real-player leagues, or new leagues where pids restart at 0) don't repeat the same "random" values. See docs/native-features.md,
// League salt.
//
// Salt 0 (leagues from before this existed, and files without one) changes nothing: every helper here is the identity at 0, so outputs are
// byte-for-byte what they were. Within a league the salt is fixed (a game attribute), so nothing flickers on reload.
//
// Read through a getter (the worker reads g, the UI its synced local state), so this file needs neither.

let getter: () => number = () => 0;

export const setLeagueSaltGetter = (f: () => number) => {
	getter = f;
};

export const getLeagueSalt = () => {
	const salt = getter();
	return typeof salt === "number" && Number.isFinite(salt) ? salt >>> 0 : 0;
};

// A salted string key: unchanged at salt 0
export const salted = (key: string) => {
	const salt = getLeagueSalt();
	return salt === 0 ? key : `${key}|ls${salt}`;
};

// A salted uint32 seed: unchanged at salt 0
export const saltedSeed = (seed: number) => {
	const salt = getLeagueSalt();
	if (salt === 0) {
		return seed;
	}
	let h = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return (h ^ (h >>> 16)) >>> 0;
};

// A new random salt (never 0). From crypto when there is one, not Math.random, so drawing it never moves the game's random stream (a
// league created from a seeded Math.random makes the same players as before)
// Tests: leagues made by tests get a fixed salt (0), so test outputs stay what they were (src/test/setup.ts)
let newSaltOverride: (() => number) | undefined;
export const setNewLeagueSaltOverride = (f: (() => number) | undefined) => {
	newSaltOverride = f;
};

export const newLeagueSalt = (): number => {
	if (newSaltOverride) {
		return newSaltOverride();
	}
	let x = 0;
	if (typeof crypto !== "undefined" && crypto.getRandomValues) {
		x = crypto.getRandomValues(new Uint32Array(1))[0]!;
	} else {
		x = Math.floor(Math.random() * 4294967296);
	}
	return x === 0 ? 1 : x;
};
