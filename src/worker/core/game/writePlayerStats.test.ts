import { assert, test } from "vitest";
import { setPotAfterInjury } from "./writePlayerStats.ts";

test("pot after an injury's ratings loss moves with ovr, never up, and stays when ovr didn't drop", () => {
	const prev = { ovr: 55, pot: 62 };

	// No ovr lost (the re-estimate came out lower): pot stays
	const same = { ovr: 55, pot: 58 };
	setPotAfterInjury(prev, same);
	assert.strictEqual(same.pot, 62);

	// 3 ovr lost: 3 pot lost, whatever the re-estimate
	const lower = { ovr: 52, pot: 64 };
	setPotAfterInjury(prev, lower);
	assert.strictEqual(lower.pot, 59);

	// Position ratings (other sports): each by its own ovr
	const prevPos = {
		ovr: 55,
		pot: 62,
		ovrs: { QB: 55, RB: 40 },
		pots: { QB: 62, RB: 45 },
	};
	const nextPos = {
		ovr: 53,
		pot: 50,
		ovrs: { QB: 53, RB: 40 },
		pots: { QB: 50, RB: 41 },
	};
	setPotAfterInjury(prevPos, nextPos);
	assert.strictEqual(nextPos.pot, 60);
	assert.deepStrictEqual(nextPos.pots, { QB: 60, RB: 45 });
});
