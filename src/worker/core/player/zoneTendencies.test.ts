import { assert, test } from "vitest";
import {
	nextZoneTendency,
	updateZoneTendencies,
	ZONE_TEND,
} from "./zoneTendencies.ts";

// League FG% by zone: three, mid-range, rim, post
const LEAGUE = [0.36, 0.42, 0.64, 0.42];

const mix = (zt: number[] | undefined, fga: number[]) => {
	const total = fga.reduce((a, b) => a + b, 0);
	return (zt ?? [1, 1, 1, 1]).reduce((s, x, i) => s + (x * fga[i]!) / total, 0);
};

test("zone tendencies: toward the zones he makes, centered on his shot mix, bounded", () => {
	// a great three-point shooter, average elsewhere
	const fga = [500, 200, 250, 50];
	const fg = [500 * 0.42, 200 * 0.42, 250 * 0.64, 50 * 0.42];
	const zt = nextZoneTendency(undefined, { fga, fg }, LEAGUE)!;
	assert.isAbove(zt[0]!, 1);
	assert.isBelow(zt[1]!, 1);
	// only the mix moves: his attempt-weighted tendency is 1
	assert.closeTo(mix(zt, fga), 1, 0.002);

	// years of it: bounded
	let z: number[] | undefined;
	for (let i = 0; i < 20; i++) {
		z = nextZoneTendency(z, { fga, fg }, LEAGUE);
	}
	for (const x of z!) {
		assert.isAtLeast(x, ZONE_TEND.min);
		assert.isAtMost(x, ZONE_TEND.max);
	}
	assert.isAbove(z![0]!, zt[0]!);

	// a few attempts say little (shrunk toward the league)
	const small = nextZoneTendency(
		undefined,
		{ fga: [40, 30, 40, 0], fg: [40 * 0.5, 30 * 0.42, 40 * 0.64, 0] },
		LEAGUE,
	)!;
	assert.isBelow(small[0]! - 1, zt[0]! - 1);

	// at the league's rates everywhere: nothing (all 1, not stored)
	assert.isUndefined(
		nextZoneTendency(
			undefined,
			{ fga: [300, 200, 300, 100], fg: [108, 84, 192, 42] },
			LEAGUE,
		),
	);

	// too few shots to learn from: the old tendency fades
	const faded = nextZoneTendency(
		[1.15, 0.9, 1, 1],
		{ fga: [10, 5, 10, 0], fg: [2, 1, 6, 0] },
		LEAGUE,
	)!;
	assert.isBelow(faded[0]!, 1.15);
	assert.isAbove(faded[1]!, 0.9);
});

test("zone tendencies: written on the new season's ratings row from last season's stats", () => {
	const player = (pid: number, tp: number) =>
		({
			pid,
			ratings: [{ season: 2025 }, { season: 2026 }],
			stats: [
				{
					season: 2025,
					playoffs: false,
					tpa: 400,
					tp,
					fgaMidRange: 200,
					fgMidRange: 84,
					fgaAtRim: 300,
					fgAtRim: 192,
					fgaLowPost: 100,
					fgLowPost: 42,
				},
				// (playoffs don't count)
				{
					season: 2025,
					playoffs: true,
					tpa: 1000,
					tp: 0,
				},
			],
		}) as any;
	const good = player(1, 170);
	const bad = player(2, 120);
	updateZoneTendencies([good, bad], 2026);
	assert.isAbove(good.ratings[1].zt[0], 1);
	assert.isBelow(bad.ratings[1].zt[0], 1);
	assert.isUndefined(good.ratings[0].zt);

	// a new league (no season played): nothing
	const fresh = player(3, 150);
	fresh.stats = [];
	updateZoneTendencies([fresh], 2026);
	assert.isUndefined(fresh.ratings[1].zt);
});
