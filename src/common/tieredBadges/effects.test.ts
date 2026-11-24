// The badge popup's effect text (effects.ts) matches the game sim's numbers (tieredBadgesSim.ts)
import { assert, test } from "vitest";
import {
	BADGE_CAL as SIM_CAL,
	BADGE_SIM,
	TIER_SCALE as SIM_TIER_SCALE,
} from "../../worker/core/GameSim.basketball/tieredBadgesSim.ts";
import {
	BADGE_CAL,
	BADGE_EFFECTS,
	TIER_SCALE,
	badgeNetEffect,
	formatBadgeEffect,
} from "./effects.ts";
import { TIERED_BADGES_BY_KEY } from "./definitions.ts";

test("the sim uses the shared tier scale and calibration (one constant each)", () => {
	assert.strictEqual(SIM_TIER_SCALE, TIER_SCALE);
	assert.strictEqual(SIM_CAL, BADGE_CAL);
});

test("every effect's size comes from BADGE_SIM", () => {
	const sim = BADGE_SIM as Record<string, number>;
	// Effects whose number is a different BADGE_SIM key, or a share of one (turnovers and Challenger: the mean over the 5 on the floor)
	const expected: Record<string, number[]> = {
		putbackBoss: [sim.putbackBoss!, sim.putbackBossOrb!, sim.rebWeight!],
		rimProtector: [sim.rimProtector!, sim.rimProtectorBlk!],
		boxoutBeast: [sim.boxoutBeast!, sim.rebWeight!],
		reboundChaser: [sim.reboundChaser!, sim.rebWeight!],
		handles: [(0.5 * sim.ballSecurity!) / 5],
		ballSecurity: [sim.ballSecurity! / 5],
		unpluckable: [sim.unpluckable! / 5],
		challenger: [sim.challenger! / 5],
	};
	for (const [key, effects] of Object.entries(BADGE_EFFECTS)) {
		assert.isDefined(TIERED_BADGES_BY_KEY[key], key);
		const sizes = expected[key] ?? [sim[key]!];
		assert.strictEqual(effects.length, sizes.length, key);
		effects.forEach((e, i) => {
			assert.closeTo(e.size, sizes[i]!, 1e-9, `${key} ${i}`);
			if (e.cal !== undefined) {
				assert.isDefined(BADGE_CAL[e.cal], `${key} ${i}`);
			}
		});
	}
});

test("net of the league calibration", () => {
	// Points: the raw effect minus the event's calibration
	const cs = BADGE_EFFECTS.catchShoot![0]!;
	assert.closeTo(badgeNetEffect(cs, 4), 0.012 - BADGE_CAL.threePointer, 1e-12);
	assert.closeTo(
		badgeNetEffect(cs, 2),
		0.012 * TIER_SCALE[2] - BADGE_CAL.threePointer,
		1e-12,
	);
	// A defensive (minus) effect
	const clamps = BADGE_EFFECTS.clamps![0]!;
	assert.closeTo(
		badgeNetEffect(clamps, 4),
		-0.02 - BADGE_CAL.threePointer,
		1e-12,
	);
	// Relative: divided by the event's mean multiplier
	const glove = BADGE_EFFECTS.glove![0]!;
	assert.closeTo(badgeNetEffect(glove, 4), 1.06 / BADGE_CAL.stl - 1, 1e-12);
	// An offensive rebound effect: the sim calibrates the defensive rebound, its complement
	const pbOrb = BADGE_EFFECTS.putbackBoss![1]!;
	assert.closeTo(badgeNetEffect(pbOrb, 4), 0.012 + BADGE_CAL.drb, 1e-12);
	// A pick weight: not re-centered
	const ws = BADGE_EFFECTS.whistleProof![0]!;
	assert.closeTo(badgeNetEffect(ws, 4), -0.3, 1e-12);
});

test("formatting", () => {
	assert.strictEqual(
		formatBadgeEffect(BADGE_EFFECTS.catchShoot![0]!, 4),
		`+${(100 * (0.012 - BADGE_CAL.threePointer)).toFixed(1)} percentage points`,
	);
	assert.strictEqual(
		formatBadgeEffect(BADGE_EFFECTS.glove![0]!, 1),
		`+${Math.round(100 * ((1 + 0.06 * 0.3) / BADGE_CAL.stl - 1))}%`,
	);
	assert.strictEqual(
		formatBadgeEffect(BADGE_EFFECTS.whistleProof![0]!, 4),
		"−30%",
	);
});
