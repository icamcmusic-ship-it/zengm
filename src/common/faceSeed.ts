// Seeded random numbers for faces (face aging, face styles, style events): a string hash, never Math.random or the
// game's random stream, so faces never change a game or league result.

export const hashFaceKey = (s: string) => {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < s.length; i++) {
		const ch = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h1 ^ h2) >>> 0;
};

// One uniform number in [0, 1) for a key
export const seededUniform = (...key: (string | number)[]) =>
	hashFaceKey(key.join("|")) / 4294967296;

// A seeded generator for several numbers
export const seededRandom = (...key: (string | number)[]) => {
	let a = hashFaceKey(key.join("|"));
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};
