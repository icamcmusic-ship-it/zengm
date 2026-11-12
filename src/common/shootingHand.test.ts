import { assert, test } from "vitest";
import { getShootingHand, LEFTY_RATE } from "./shootingHand.ts";

test("lefties are rare and stable per player", () => {
	let lefties = 0;
	const n = 20000;
	for (let pid = 0; pid < n; pid++) {
		if (getShootingHand(pid) === "left") {
			lefties += 1;
		}
		assert.strictEqual(getShootingHand(pid), getShootingHand(pid));
	}
	const rate = lefties / n;
	assert.isAbove(rate, LEFTY_RATE - 0.015);
	assert.isBelow(rate, LEFTY_RATE + 0.015);
});
