import { assert, test } from "vitest";
import { featKindsBasketball, featLeaders } from "./featKinds.ts";

const line = (x: Partial<Record<string, number>>) => ({
	pts: 0,
	orb: 0,
	drb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tp: 0,
	...x,
});

test("feat kinds use the recorded cutoffs, scaled by the factor, and can overlap", () => {
	assert.deepStrictEqual(
		featKindsBasketball(line({ pts: 12, drb: 10, ast: 10 }), 1),
		["tripleDouble"],
	);
	assert.deepStrictEqual(
		featKindsBasketball(line({ pts: 52, drb: 11, ast: 10, tp: 10 }), 1),
		["tripleDouble", "pts50", "tp10"],
	);
	assert.deepStrictEqual(
		featKindsBasketball(
			line({ pts: 5, orb: 2, drb: 3, ast: 5, stl: 5, blk: 5 }),
			1,
		),
		["fiveByFive"],
	);
	assert.deepStrictEqual(featKindsBasketball(line({ pts: 49 }), 1), []);
	// A shorter game scales the cutoffs down
	assert.deepStrictEqual(featKindsBasketball(line({ pts: 40 }), 0.8), [
		"pts50",
	]);
	assert.deepStrictEqual(
		featKindsBasketball(line({ drb: 25, ast: 20, stl: 10, blk: 10 }), 1),
		["tripleDouble", "reb25", "ast20", "stl10", "blk10"],
	);
});

test("leaders: feats per player, most first, with counts by kind and the latest team", () => {
	const feat = (
		pid: number,
		season: number,
		gid: number,
		tid: number,
		kinds: string[],
	) => ({ pid, name: `P${pid}`, tid, season, gid, kinds });
	const leaders = featLeaders([
		feat(1, 2020, 5, 3, ["tripleDouble"]),
		feat(2, 2021, 9, 4, ["pts50"]),
		feat(1, 2022, 1, 6, ["tripleDouble", "pts50"]),
		feat(2, 2019, 2, 4, ["tp10"]),
		feat(3, 2018, 1, 1, ["stl10"]),
		feat(1, 2022, 7, 7, []),
	]);
	assert.deepStrictEqual(
		leaders.map((p) => [p.pid, p.count]),
		[
			[1, 3],
			[2, 2],
			[3, 1],
		],
	);
	assert.deepStrictEqual(leaders[0]!.byKind, { tripleDouble: 2, pts50: 1 });
	assert.strictEqual(leaders[0]!.tid, 7, "team of the latest feat");
	assert.strictEqual(leaders[0]!.first, 2020);
	assert.strictEqual(leaders[0]!.last, 2022);
	assert.strictEqual(leaders[1]!.first, 2019);
});
