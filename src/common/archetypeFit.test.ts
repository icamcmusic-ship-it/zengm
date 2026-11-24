import { assert, describe, test } from "vitest";
import { archetypeById, type Rated } from "./archetypes/index.ts";
import {
	fillableWarnings,
	lineupHints,
	needsFilled,
	needsTitle,
	type LineupPlayer,
} from "./archetypeFit.ts";

// Builds of each kind (families from types.ts)
const SHOOTER = "catch-and-shoot-3pt-sniper"; // shooter, guard
const HANDLER = "dot-dispenser"; // playmaker, guard
const HANDLER2 = "defensive-playmaker"; // playmaker, guard
const RIM = "glass-guardian"; // defender, big
const LOB = "backline-lob-threat"; // athlete, big, no shooting
const ROLLER = "pick-and-roll-finisher"; // hustle, big, no shooting
const STRETCH = "break-starting-stretch-five"; // shooter, big
const SLASHER = "crafty-mid-range-slasher"; // slasher, guard
const SCORER = "ankle-taker"; // scorer, wing, no shooting
const LOCKDOWN = "lockdown-defender"; // defender, wing

test("the test builds exist", () => {
	for (const id of [
		SHOOTER,
		HANDLER,
		HANDLER2,
		RIM,
		LOB,
		ROLLER,
		STRETCH,
		SLASHER,
		SCORER,
		LOCKDOWN,
	]) {
		assert.isDefined(archetypeById(id), id);
	}
	assert.strictEqual(archetypeById(SHOOTER)!.family, "shooter");
	assert.strictEqual(archetypeById(HANDLER)!.family, "playmaker");
	assert.strictEqual(archetypeById(RIM)!.family, "defender");
	assert.strictEqual(archetypeById(RIM)!.group, "big");
	assert.isFalse(archetypeById(LOB)!.tags.includes("shooting"));
});

const rated = (list: [string, string][]): Rated[] =>
	list.map(([archetypeId, pos], i) => ({
		pid: i,
		ovr: 60 - i,
		archetypeId,
		pos,
	}));

describe("needsFilled", () => {
	// No shooter, no rim protector, no defensive specialist
	const team = rated([
		[HANDLER, "PG"],
		[SLASHER, "SG"],
		[SCORER, "SF"],
		[SCORER, "GF"],
		[LOB, "C"],
		[ROLLER, "C"],
		[SLASHER, "G"],
	]);

	test("names the warnings a candidate answers", () => {
		const kinds = fillableWarnings(team).map((w) => w.kind);
		assert.includeMembers(kinds, ["spacing", "rim", "defense"]);
		assert.notInclude(kinds, "playmaking");

		const shooter = needsFilled(team, {
			pid: 100,
			ovr: 40,
			archetypeId: SHOOTER,
			pos: "SG",
		});
		assert.deepEqual(
			shooter.map((n) => n.kind),
			["spacing"],
		);
		assert.strictEqual(shooter[0]!.label, "Shooter");

		const rim = needsFilled(team, {
			pid: 101,
			ovr: 40,
			archetypeId: RIM,
			pos: "C",
		}).map((n) => n.kind);
		assert.includeMembers(rim, ["rim", "defense"]);
		assert.notInclude(rim, "spacing");
	});

	test("nothing for a player who answers no warning, or no archetype", () => {
		assert.deepEqual(
			needsFilled(team, { pid: 102, ovr: 70, archetypeId: SLASHER, pos: "G" }),
			[],
		);
		assert.deepEqual(
			needsFilled(team, { pid: 103, ovr: 70, archetypeId: undefined }),
			[],
		);
	});

	test("nothing when the rotation has no warning", () => {
		const balanced = rated([
			[HANDLER, "PG"],
			[SHOOTER, "SG"],
			[LOCKDOWN, "SF"],
			[STRETCH, "PF"],
			[RIM, "C"],
		]);
		assert.deepEqual(fillableWarnings(balanced), []);
		assert.deepEqual(
			needsFilled(balanced, {
				pid: 100,
				ovr: 40,
				archetypeId: SHOOTER,
				pos: "SG",
			}),
			[],
		);
	});

	test("title", () => {
		assert.strictEqual(
			needsTitle([{ kind: "spacing", label: "Shooter", text: "No shooter." }]),
			"Fills a need: Shooter (No shooter.)",
		);
	});
});

const lineup = (list: [string | undefined, string][]): LineupPlayer[] =>
	list.map(([archetypeId, pos], i) => ({
		pid: i,
		name: `P${i}`,
		pos,
		archetypeId,
	}));

describe("lineupHints", () => {
	test("a balanced lineup has no hints", () => {
		const h = lineupHints(
			lineup([
				[HANDLER, "PG"],
				[SHOOTER, "SG"],
				[LOCKDOWN, "SF"],
				[STRETCH, "PF"],
				[RIM, "C"],
				[HANDLER2, "G"],
				[SHOOTER, "GF"],
				[ROLLER, "C"],
			]),
		);
		assert.deepEqual(h, { starters: [], bench: [] });
	});

	test("a non-shooting big with no shooter around him", () => {
		const h = lineupHints(
			lineup([
				[HANDLER, "PG"],
				[SLASHER, "SG"],
				[SCORER, "SF"],
				[RIM, "PF"],
				[LOB, "C"],
			]),
		);
		const spacing = h.starters.find((x) => x.kind === "spacing");
		assert.isDefined(spacing);
		assert.include(spacing!.text, "P4");
		assert.include(spacing!.text, "non-shooting big");
	});

	test("two non-shooting bigs start together", () => {
		const h = lineupHints(
			lineup([
				[HANDLER, "PG"],
				[SHOOTER, "SG"],
				[LOCKDOWN, "SF"],
				[LOB, "FC"],
				[RIM, "C"],
			]),
		);
		assert.deepEqual(
			h.starters.map((x) => x.kind),
			["twoBigs"],
		);
		assert.include(h.starters[0]!.text, "P3 and P4");
	});

	test("two primary handlers, no rim protector", () => {
		const h = lineupHints(
			lineup([
				[HANDLER, "PG"],
				[HANDLER2, "G"],
				[SHOOTER, "SF"],
				[STRETCH, "PF"],
				[STRETCH, "C"],
			]),
		);
		const kinds = h.starters.map((x) => x.kind);
		assert.includeMembers(kinds, ["handlers", "rim"]);
		assert.include(
			h.starters.find((x) => x.kind === "handlers")!.text,
			"P0 and P1 are both",
		);
	});

	test("all-small and all-big lineups", () => {
		const small = lineupHints(
			lineup([
				[HANDLER, "PG"],
				[SHOOTER, "SG"],
				[SLASHER, "G"],
				[LOCKDOWN, "SF"],
				[SHOOTER, "GF"],
			]),
		);
		assert.include(
			small.starters.map((x) => x.kind),
			"small",
		);
		const big = lineupHints(
			lineup([
				[LOCKDOWN, "SF"],
				[STRETCH, "F"],
				[STRETCH, "PF"],
				[RIM, "FC"],
				[RIM, "C"],
			]),
		);
		const kinds = big.starters.map((x) => x.kind);
		assert.include(kinds, "big");
		assert.include(kinds, "noHandler");
	});

	test("the bench unit", () => {
		const h = lineupHints(
			lineup([
				[HANDLER, "PG"],
				[SHOOTER, "SG"],
				[LOCKDOWN, "SF"],
				[STRETCH, "PF"],
				[RIM, "C"],
				[SLASHER, "G"],
				[SCORER, "SF"],
				[SLASHER, "SG"],
				[SCORER, "GF"],
				// (10th man: not in the rotation)
				[HANDLER2, "C"],
			]),
		);
		assert.deepEqual(h.starters, []);
		assert.deepEqual(
			h.bench.map((x) => x.kind),
			["noHandler", "spacing", "small"],
		);
	});

	test("too few players, or too few known archetypes", () => {
		assert.deepEqual(lineupHints(lineup([[HANDLER, "PG"]])), {
			starters: [],
			bench: [],
		});
		const h = lineupHints(
			lineup([
				[undefined, "PG"],
				[undefined, "SG"],
				[SCORER, "SF"],
				[undefined, "PF"],
				[undefined, "C"],
			]),
		);
		assert.deepEqual(h, { starters: [], bench: [] });
	});
});
