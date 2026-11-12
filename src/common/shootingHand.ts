// Which hand a player shoots with. Pure flavor: derived from the player id, so it never changes, needs no
// storage and works in every existing league. About 1 in 12 players are lefties (NBA history is roughly 5-10%).
export const LEFTY_RATE = 0.08;

const hash = (n: number) => {
	// 32-bit integer mix (splitmix-style), deterministic across browsers
	let x = (n + 0x9e3779b9) | 0;
	x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
	x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
	x ^= x >>> 16;
	return (x >>> 0) / 4294967296;
};

export const getShootingHand = (pid: number): "left" | "right" =>
	hash(pid) < LEFTY_RATE ? "left" : "right";
