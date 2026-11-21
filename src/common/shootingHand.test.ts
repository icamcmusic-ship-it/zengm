import { assert, test } from "vitest";
import { getShootingHand, LEFTY_RATE, REAL_LEFTIES } from "./shootingHand.ts";

test("random players: about 10% lefties in leagues of every size, stable per player", () => {
	for (const n of [500, 1500, 5000, 50000]) {
		let lefties = 0;
		for (let pid = 0; pid < n; pid++) {
			const hand = getShootingHand({ pid });
			if (hand === "left") {
				lefties += 1;
			}
			assert.strictEqual(getShootingHand({ pid }), hand);
		}
		const rate = lefties / n;
		assert.isAbove(rate, LEFTY_RATE - 0.015, `pids 0-${n}`);
		assert.isBelow(rate, LEFTY_RATE + 0.015, `pids 0-${n}`);
	}
});

test("real players: the curated lefties are left, other real players right, draft prospects use the hash", () => {
	for (const srID of REAL_LEFTIES) {
		for (const pid of [0, 1, 2, 3, 12345]) {
			assert.strictEqual(getShootingHand({ pid, srID }), "left");
		}
	}
	for (let pid = 0; pid < 1000; pid++) {
		assert.strictEqual(getShootingHand({ pid, srID: "jamesle01" }), "right");
		assert.strictEqual(
			getShootingHand({ pid, srID: `dp_2025_${pid}` }),
			getShootingHand({ pid }),
		);
	}
	assert.strictEqual(getShootingHand({ pid: 7, srID: "hardeja01" }), "left");
});
