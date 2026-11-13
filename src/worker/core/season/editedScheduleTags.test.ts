import { assert, test } from "vitest";
import { fixEditedScheduleTags } from "./editedScheduleTags.ts";

const before = [
	{ gid: 1, day: 66, homeTid: 0, awayTid: 1, marquee: "christmas" as const },
	{ gid: 2, day: 66, homeTid: 2, awayTid: 3, marquee: "christmas" as const },
	{
		gid: 3,
		day: 66,
		homeTid: 4,
		awayTid: 5,
		marquee: "christmas" as const,
		rivalry: true,
	},
	{
		gid: 4,
		day: 70,
		homeTid: 6,
		awayTid: 7,
		marquee: "nationalTv" as const,
		rivalry: true,
	},
	{ gid: 5, day: 71, homeTid: 8, awayTid: 9 },
];

test("unedited games keep their tags, also when a day is added before them", () => {
	const shifted = before.map((game) => ({ ...game, day: game.day + 1 }));
	const out = fixEditedScheduleTags(shifted, before);
	assert.deepStrictEqual(
		out.map((game) => [game.marquee, game.rivalry]),
		[
			["christmas", undefined],
			["christmas", undefined],
			["christmas", true],
			["nationalTv", true],
			[undefined, undefined],
		],
	);
});

test("home and away swapped keeps the tags", () => {
	const games = before.map((game) =>
		game.gid === 4 ? { ...game, homeTid: 7, awayTid: 6 } : { ...game },
	);
	const out = fixEditedScheduleTags(games, before);
	assert.strictEqual(out[3]!.marquee, "nationalTv");
	assert.strictEqual(out[3]!.rivalry, true);
});

test("a game with a new team loses its tags", () => {
	const games = before.map((game) =>
		game.gid === 4 ? { ...game, awayTid: 9 } : { ...game },
	);
	const out = fixEditedScheduleTags(games, before);
	assert.isUndefined(out[3]!.marquee);
	assert.isUndefined(out[3]!.rivalry);
});

test("a holiday game moved off the holiday is no longer a holiday game", () => {
	const games = before.map((game) =>
		game.gid === 3 ? { ...game, day: 68 } : { ...game },
	);
	const out = fixEditedScheduleTags(games, before);
	assert.strictEqual(out[0]!.marquee, "christmas");
	assert.isUndefined(out[2]!.marquee);
	// Still a rivalry
	assert.strictEqual(out[2]!.rivalry, true);
});

test("new games have no tags", () => {
	const out = fixEditedScheduleTags(
		[{ day: 66, homeTid: 10, awayTid: 11, marquee: "christmas" as const }],
		before,
	);
	assert.isUndefined(out[0]!.marquee);
});
