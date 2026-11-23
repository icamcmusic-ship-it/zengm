// The badge popup's effect text (effects.ts) matches the game sim's numbers (tieredBadgesSim.ts)
import { assert, test } from "vitest";
import {
	BADGE_SIM,
	TIER_SCALE,
} from "../../worker/core/GameSim.basketball/tieredBadgesSim.ts";
import {
	BADGE_EFFECTS,
	TIER_EFFECT_SCALE,
	formatBadgeEffect,
} from "./effects.ts";
import { TIERED_BADGES_BY_KEY } from "./definitions.ts";

test("tier scales match the sim", () => {
	assert.deepStrictEqual([...TIER_EFFECT_SCALE], [...TIER_SCALE]);
});

test("every effect's size comes from BADGE_SIM", () => {
	const sim = BADGE_SIM as Record<string, number>;
	// Effects whose number is a different BADGE_SIM key, or a share of one (turnovers: the mean over the 5 on the floor)
	const expected: Record<string, number[]> = {
		putbackBoss: [sim.putbackBoss!, sim.putbackBossOrb!, sim.rebWeight!],
		rimProtector: [sim.rimProtector!, sim.rimProtectorBlk!],
		boxoutBeast: [sim.boxoutBeast!, sim.rebWeight!],
		reboundChaser: [sim.reboundChaser!, sim.rebWeight!],
		handles: [(0.5 * sim.ballSecurity!) / 5],
		ballSecurity: [sim.ballSecurity! / 5],
		unpluckable: [sim.unpluckable! / 5],
	};
	for (const [key, effects] of Object.entries(BADGE_EFFECTS)) {
		assert.isDefined(TIERED_BADGES_BY_KEY[key], key);
		const sizes = expected[key] ?? [sim[key]!];
		assert.strictEqual(effects.length, sizes.length, key);
		effects.forEach((e, i) => {
			assert.closeTo(e.size, sizes[i]!, 1e-9, `${key} ${i}`);
		});
	}
});

test("formatting", () => {
	assert.strictEqual(
		formatBadgeEffect(BADGE_EFFECTS.catchShoot![0]!, 4),
		"+1.2 percentage points",
	);
	assert.strictEqual(formatBadgeEffect(BADGE_EFFECTS.glove![0]!, 1), "+2%");
});
