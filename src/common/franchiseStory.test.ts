import { assert, test } from "vitest";
import { franchiseChangeKind } from "./franchiseStory.ts";

const team = { region: "Seattle", name: "SuperSonics", colors: ["#1", "#2"] };

test("franchiseChangeKind reads a move, a rename and new colors", () => {
	assert.strictEqual(franchiseChangeKind(team, team), undefined);
	assert.strictEqual(
		franchiseChangeKind(team, { ...team, region: "Oklahoma City" }),
		"relocation",
	);
	assert.strictEqual(
		franchiseChangeKind(team, { ...team, name: "Storm" }),
		"rename",
	);
	assert.strictEqual(
		franchiseChangeKind(team, { ...team, colors: ["#1", "#3"] }),
		"rebrand",
	);
});

test("franchiseChangeKind never reads a missing field as a change (old league rows)", () => {
	assert.strictEqual(
		franchiseChangeKind({ colors: team.colors }, team),
		undefined,
	);
	assert.strictEqual(
		franchiseChangeKind({ region: "Seattle", name: "SuperSonics" }, team),
		undefined,
	);
	assert.strictEqual(
		franchiseChangeKind(team, { region: "Seattle", name: "SuperSonics" }),
		undefined,
	);
});
