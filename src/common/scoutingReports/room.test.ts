// Scout Consensus & Flags: the scouts' room (who sees whom, grades, spread, outliers) and the red/green flags. Pure.
import { afterEach, assert, describe, test } from "vitest";
import { Rng } from "../ratingsBuilds/rng.ts";
import {
	buildRoom,
	scoutLean,
	SPREAD_SPLIT,
	whoSees,
	type RoomProspect,
	type RoomScout,
} from "./room.ts";
import {
	MAX_QUICK_FLAGS,
	quickFlags,
	type FlagTrait,
	type QuickFlagInput,
} from "./quickFlags.ts";

const realRandom = Math.random;
afterEach(() => {
	Math.random = realRandom;
});

const scouts: RoomScout[] = [
	{
		id: 11000,
		name: "Al Baker",
		title: "college scout",
		specialty: "college",
		bias: "none",
		quality: 0.6,
		region: "east",
	},
	{
		id: 12000,
		name: "Ben Crane",
		title: "pro scout",
		specialty: "pro",
		bias: "athletes",
		quality: 0.45,
		region: "prep",
	},
	{
		id: 13000,
		name: "Carl Dunn",
		title: "international scout",
		specialty: "international",
		bias: "shooters",
		quality: 0.5,
		region: "intl",
	},
	{
		id: 14000,
		name: "Dan Ellis",
		title: "scout (athletes)",
		specialty: "athletes",
		bias: "generous",
		quality: 0.4,
		region: "west",
	},
	{
		id: 19000,
		name: "Ed Fowler",
		title: "Director of Scouting",
		specialty: "college",
		bias: "harsh",
		quality: 0.7,
		director: true,
	},
];

const prospect = (over: Partial<RoomProspect> = {}): RoomProspect => ({
	pid: 7,
	value: 60,
	uncertainty: 2,
	region: "east",
	rank: 12,
	future: false,
	events: 1,
	age: 20,
	ratings: { spd: 60, jmp: 55, tp: 45, hgt: 50, ovr: 45, pot: 58 },
	pts: 14,
	...over,
});

const classValues = Array.from({ length: 69 }, (_, i) => 70 - i * 0.4);

const room = (p: RoomProspect, s = scouts, seed = "lg") =>
	buildRoom({
		scouts: s,
		prospect: p,
		classValues,
		numTeams: 30,
		numPicks: 60,
		seed,
		season: 2030,
	})!;

describe("scouts' room", () => {
	test("deterministic, never touches Math.random", () => {
		Math.random = () => {
			throw new Error("Math.random");
		};
		const a = room(prospect());
		const b = room(prospect());
		assert.deepEqual(a, b);
		// Another season: other draws
		const c = buildRoom({
			scouts,
			prospect: prospect(),
			classValues,
			numTeams: 30,
			numPicks: 60,
			seed: "lg",
			season: 2031,
		})!;
		assert.notDeepEqual(
			a.grades.map((x) => x.value),
			c.grades.map((x) => x.value),
		);
	});

	test("who sees whom: his region's scout always, the top of the class everyone, at least one scout", () => {
		for (let pid = 0; pid < 50; pid++) {
			const seen = whoSees(
				scouts,
				{ pid, region: "east", rank: 45, future: false, events: 0 },
				"lg",
				2030,
			);
			assert.isTrue(seen.some((x) => x.s.id === 11000 && x.familiar));
		}
		const top = whoSees(
			scouts,
			{ pid: 1, region: "west", rank: 3, future: false, events: 0 },
			"lg",
			2030,
		);
		assert.strictEqual(top.length, scouts.length);
		// No scout covers the region (no region plan): the best fit still has him
		const lone = whoSees(
			scouts
				.filter((s) => !s.director)
				.map((s) => ({ ...s, region: "west" as const })),
			{ pid: 2, region: "intl", rank: 200, future: true, events: 0 },
			"lg",
			2030,
		);
		assert.isAtLeast(lone.length, 1);
		// The Director sees the top 30 of this year's class
		const mid = whoSees(
			scouts,
			{ pid: 3, region: "east", rank: 25, future: false, events: 0 },
			"lg",
			2030,
		);
		assert.isTrue(mid.some((x) => x.s.director));
	});

	test("a scout's lean follows his bias and his favourite", () => {
		const athletic = prospect({
			ratings: { spd: 85, jmp: 85, tp: 30, hgt: 45, ovr: 45, pot: 60 },
		});
		assert.isAbove(scoutLean({ id: 1, bias: "athletes" }, athletic).lean, 2);
		assert.isBelow(scoutLean({ id: 1, bias: "shooters" }, athletic).lean, -1);
		assert.strictEqual(scoutLean({ id: 1, bias: "none" }, athletic).lean, 0);
		const guy = scoutLean({ id: 1, bias: "none" }, prospect({ ourGuyOf: [1] }));
		assert.isTrue(guy.ourGuy);
		assert.isAbove(guy.lean, 2);
	});

	test("an outlier is named", () => {
		const r = room(prospect({ uncertainty: 0, rank: 5, ourGuyOf: [14000] }));
		assert.isAtLeast(r.n, 3);
		const ellis = r.grades.find((x) => x.scoutId === 14000)!;
		assert.strictEqual(ellis.outlier, "high");
		assert.isTrue(
			r.outliers.some((x) => x.startsWith("Ellis: much higher than the room")),
		);
		assert.match(ellis.reason, /my guy/);
	});

	test("a wide spread honestly means more uncertainty", () => {
		// Simulated classes: true value t, the department's view t + error with sd = uncertainty (as the fuzz is). The room never sees t
		const rng = new Rng("roomSim");
		const byLabel: Record<string, number[]> = {};
		const spreadByU = new Map<number, number[]>();
		for (let pid = 0; pid < 1500; pid++) {
			const u = [0.6, 1.5, 3, 4.5][pid % 4]!;
			const t = 45 + 20 * rng.random();
			const seen = t + rng.normal(0, u);
			const r = room(
				prospect({ pid, value: seen, uncertainty: u, rank: 1 + (pid % 30) }),
			);
			(byLabel[r.label] ??= []).push(Math.abs(seen - t));
			spreadByU.set(u, [...(spreadByU.get(u) ?? []), r.spread]);
		}
		const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
		assert.isAbove(byLabel.Split!.length, 50);
		assert.isAbove(byLabel.Agree!.length, 50);
		assert.isAbove(mean(byLabel.Split!), 1.5 * mean(byLabel.Agree!));
		const spreads = [...spreadByU.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([, xs]) => mean(xs));
		for (let i = 1; i < spreads.length; i++) {
			assert.isAbove(spreads[i]!, spreads[i - 1]!);
		}
		// Well scouted: the room mostly agrees; barely seen: it is mostly split
		assert.isBelow(spreads[0]!, SPREAD_SPLIT);
		assert.isAbove(spreads.at(-1)!, SPREAD_SPLIT);
	});

	test("slots and the summary", () => {
		const r = room(prospect({ value: 80 }));
		assert.strictEqual(r.consensusSlot, 1);
		assert.isAtLeast(r.slotRange[1], r.slotRange[0]);
		const one = room(prospect({ value: 30, rank: 70 }), [scouts[0]!]);
		assert.strictEqual(one.n, 1);
		assert.strictEqual(one.label, "One look");
		assert.match(one.summary, /Only Al Baker has seen him/);
	});
});

const trait = (over: Partial<FlagTrait>): FlagTrait => ({
	key: "motor",
	estimate: 50,
	sd: 7,
	low: 40,
	high: 60,
	hidden: false,
	exact: false,
	...over,
});

const base: QuickFlagInput = { age: 20, pos: "SF", seenClosely: true };

describe("red and green flags", () => {
	test("nothing to go on, no flags", () => {
		assert.deepEqual(quickFlags(base), []);
	});

	test("visible traits read on tape", () => {
		const f = quickFlags({
			...base,
			traits: [
				trait({ key: "motor", estimate: 82, low: 73, high: 91 }),
				trait({ key: "temper", estimate: 20, low: 11, high: 29 }),
				trait({ key: "hustle", estimate: 60 }),
			],
		});
		assert.sameDeepMembers(
			f.map((x) => [x.text, x.tone]),
			[
				["Volatile temper", "red"],
				["Relentless motor", "green"],
			],
		);
		assert.isTrue(f.every((x) => !x.hint));
	});

	test("hidden traits: only unconfirmed hints, as far as the scouts can read them, never a number", () => {
		const lazy = trait({ key: "workEthic", hidden: true, estimate: 8, sd: 10 });
		const read = quickFlags({ ...base, traits: [lazy] });
		assert.strictEqual(read.length, 1);
		assert.strictEqual(
			read[0]!.text,
			"Questions about his work habits (unconfirmed)",
		);
		assert.isTrue(read[0]!.hint);
		assert.notMatch(read[0]!.why, /\d/);
		// Nobody has seen him up close, or the department can't read him: no hint
		assert.deepEqual(
			quickFlags({
				...base,
				seenClosely: false,
				traits: [{ ...lazy, sd: 18 }],
			}),
			[],
		);
		assert.deepEqual(
			quickFlags({ ...base, traits: [{ ...lazy, sd: 22.4 }] }),
			[],
		);
		// Not extreme enough for the uncertainty
		assert.deepEqual(
			quickFlags({ ...base, traits: [{ ...lazy, estimate: 25 }] }),
			[],
		);
		const glue = quickFlags({
			...base,
			traits: [trait({ key: "ego", hidden: true, estimate: 92, sd: 10 })],
		});
		assert.strictEqual(glue[0]!.text, "High-character teammate (unconfirmed)");
		assert.strictEqual(glue[0]!.tone, "green");
	});

	test("the record and the ratings, only when the data supports it; at most four", () => {
		const pre = {
			season: 2030,
			team: "State",
			level: "college" as const,
			gp: 30,
			min: 30,
			pts: 18,
			trb: 6,
			orb: 1,
			ast: 3,
			tov: 2,
			stl: 1,
			blk: 0.5,
			fga: 14,
			fgPct: 45,
			tpa: 4,
			tpPct: 30,
			fta: 4,
			ftPct: 55,
		};
		const shot = quickFlags({ ...base, preDraft: pre });
		assert.isTrue(shot.some((x) => x.text === "Shot mechanics need work"));
		// Too few free throws to say
		const few = quickFlags({ ...base, preDraft: { ...pre, fta: 1 } });
		assert.isFalse(few.some((x) => x.text === "Shot mechanics need work"));
		const many = quickFlags({
			...base,
			age: 19,
			preDraft: { ...pre, level: "juco", tov: 4.5 },
			ratings: {
				hgt: 50,
				spd: 75,
				jmp: 72,
				endu: 50,
				ft: 30,
				fg: 40,
				tp: 25,
				oiq: 65,
				diq: 60,
				drb: 50,
				pss: 50,
				ovr: 45,
				pot: 60,
			},
			traits: [
				trait({ key: "motor", estimate: 85 }),
				trait({ key: "temper", estimate: 15 }),
				trait({ key: "hustle", estimate: 84 }),
			],
		});
		assert.strictEqual(many.length, MAX_QUICK_FLAGS);
		assert.isAtMost(many.filter((x) => x.tone === "red").length, 3);
		assert.strictEqual(
			many.filter((x) => x.text === "Shot mechanics need work").length,
			1,
		);
		// No ratings shown (no visible ratings challenge): no ratings flags
		const noRatings = quickFlags({ ...base, ratings: undefined });
		assert.deepEqual(noRatings, []);
	});
});
