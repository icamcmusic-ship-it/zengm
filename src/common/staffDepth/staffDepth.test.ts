import { assert, describe, test } from "vitest";
import {
	BLIND_SPOT,
	fuzzFactorForLooks,
	planRegions,
	prospectRegion,
	weeklyLooks,
} from "./regions.ts";
import { rankBoard, summarizeBoardChanges } from "./board.ts";
import {
	chooseFocus,
	OVR_COEFS,
	planRatingDeltas,
	tiltSubs,
} from "./devPlans.ts";
import { depthZ, shootingDeltas } from "./coaching.ts";
import {
	getDepartment,
	scoutFromId,
	scoutId,
} from "../scoutingReports/scouts.ts";
import { SUB_GROUPS, baseFromGroup, NUM_SUBS } from "../subRatings.ts";
import { coachOvr, depthRatingsFor } from "../staff.ts";

describe("regions", () => {
	test("prospects by school and birthplace", () => {
		assert.strictEqual(
			prospectRegion({ pid: 1, school: "Duke", bornLoc: "Durham, NC" }),
			"east",
		);
		assert.strictEqual(
			prospectRegion({ pid: 1, school: "Gonzaga", bornLoc: "Spokane, WA" }),
			"west",
		);
		assert.strictEqual(
			prospectRegion({ pid: 1, school: "Kentucky", bornLoc: "USA" }),
			"midSouth",
		);
		assert.strictEqual(
			prospectRegion({ pid: 1, school: "EuroLeague", bornLoc: "Spain" }),
			"intl",
		);
		assert.strictEqual(
			prospectRegion({ pid: 1, school: "NBA G League", bornLoc: "USA" }),
			"prep",
		);
		assert.strictEqual(
			prospectRegion({ pid: 1, school: undefined, bornLoc: "Lagos, Nigeria" }),
			"intl",
		);
	});

	test("the Director covers where the talent is, by specialty, and leaves blind spots with few scouts", () => {
		const seed = "test";
		const scouts = [0, 1, 2].map((slot) =>
			scoutFromId(seed, scoutId(0, slot, 0), 0.5, 2020, 2030),
		);
		const plan = planRegions({
			scouts,
			directorQuality: 0.6,
			classShare: {
				east: 0.3,
				west: 0.15,
				midSouth: 0.35,
				intl: 0.15,
				prep: 0.05,
			},
			priority: "bpa",
			season: 2025,
			seed,
		});
		assert.strictEqual(Object.keys(plan.assignments).length, 3);
		const covered = Object.values(plan.coverage).filter((c) => c >= BLIND_SPOT);
		assert.isAtMost(covered.length, 4);
		assert.isAtLeast(covered.length, 2);
		// Manual assignments are kept
		const manual = planRegions({
			scouts,
			directorQuality: 0.6,
			classShare: {
				east: 0.3,
				west: 0.15,
				midSouth: 0.35,
				intl: 0.15,
				prep: 0.05,
			},
			priority: "bpa",
			season: 2025,
			seed,
			manual: { [scouts[0]!.id]: "prep" },
		});
		assert.strictEqual(manual.assignments[scouts[0]!.id], "prep");
	});

	test("looks narrow the fuzz, never below the floor; covered regions get more looks", () => {
		assert.strictEqual(fuzzFactorForLooks(0), 1);
		assert.isBelow(fuzzFactorForLooks(10), fuzzFactorForLooks(5));
		assert.isAtLeast(fuzzFactorForLooks(1000), 0.35);
		const covered = weeklyLooks({
			coverage: 0.6,
			visibility: 1.5,
			priorityMatch: false,
			future: false,
		});
		const blind = weeklyLooks({
			coverage: 0.1,
			visibility: 1.5,
			priorityMatch: false,
			future: false,
		});
		assert.isAbove(covered, 4 * blind);
	});
});

describe("board", () => {
	test("locked prospects keep their rank, the rest by score", () => {
		const base = {
			ovr: 45,
			pot: 55,
			pos: "SF",
			age: 20,
			region: "east" as const,
			uncertainty: 0.5,
		};
		const prospects = [
			{ ...base, pid: 1, name: "A", value: 60 },
			{ ...base, pid: 2, name: "B", value: 70 },
			{ ...base, pid: 3, name: "C", value: 50, rank: 1, locked: true },
		];
		const ranks = rankBoard(prospects, "bpa", { G: 0, F: 0, C: 0 });
		assert.strictEqual(ranks.get(3), 1);
		assert.strictEqual(ranks.get(2), 2);
		assert.strictEqual(ranks.get(1), 3);
		const lines = summarizeBoardChanges(
			new Map([
				[1, 10],
				[2, 2],
				[3, 1],
			]),
			new Map([
				[1, 3],
				[2, 2],
				[3, 1],
			]),
			new Map([
				[1, "A"],
				[2, "B"],
				[3, "C"],
			]),
		);
		assert.include(lines.join(" "), "Up: A 10 → 3");
	});
});

describe("development plans", () => {
	test("a slasher works on his three; a big who can't rebound on the glass", () => {
		const slasher = {
			tp: 25,
			dnk: 70,
			ins: 55,
			drb: 60,
			pss: 55,
			diq: 50,
			spd: 70,
			fg: 45,
			ft: 70,
			reb: 45,
			oiq: 50,
		};
		assert.strictEqual(
			chooseFocus({ ratings: slasher, pos: "SF", age: 21, hash: 0.3 }),
			"three",
		);
		const big = {
			tp: 10,
			dnk: 55,
			ins: 55,
			drb: 30,
			pss: 30,
			diq: 60,
			spd: 40,
			fg: 30,
			ft: 55,
			reb: 35,
			oiq: 40,
		};
		assert.strictEqual(
			chooseFocus({ ratings: big, pos: "C", age: 21, hash: 0.3 }),
			"glass",
		);
	});

	test("the plan's deltas are ovr-neutral (stock weights) and the focus gains", () => {
		const d = planRatingDeltas("three", 21, 60);
		assert.isAbove(d.tp!, 1);
		let sum = 0;
		for (const [key, v] of Object.entries(d)) {
			sum += (OVR_COEFS[key] ?? 0) * v;
		}
		assert.closeTo(sum, 0, 1e-9);
		// Younger players and better development coaches get more
		assert.isAbove(
			planRatingDeltas("three", 21, 70).tp!,
			planRatingDeltas("three", 31, 70).tp!,
		);
		assert.isAbove(
			planRatingDeltas("three", 21, 80).tp!,
			planRatingDeltas("three", 21, 30).tp!,
		);
	});

	test("the tilt moves points onto the focus subs and keeps each base", () => {
		const sub = new Array<number>(NUM_SUBS).fill(50);
		const x = tiltSubs(sub, "three", 1.5);
		for (const group of SUB_GROUPS) {
			assert.strictEqual(
				baseFromGroup(
					x.map((v) => Math.round(v * 100) / 100),
					group,
				),
				baseFromGroup(sub, group),
			);
		}
		assert.isAbove(x[group("tp")[0]!]!, 50);
	});
});

const group = (base: string) => SUB_GROUPS.find((g) => g.base === base)!.idx;

describe("staff roles and scout careers", () => {
	test("the extra jobs' ratings are stable and coach ovr reads them", () => {
		const c = {
			ratings: { dev: 50, off: 50, def: 50, mot: 50 },
			firstName: "A",
			lastName: "B",
			born: { year: 1970 },
		};
		const a = depthRatingsFor(c);
		assert.deepEqual(a, depthRatingsFor(c));
		assert.isAbove(
			coachOvr({ ...c.ratings, sht: 80 }, "shoot"),
			coachOvr({ ...c.ratings, sht: 40 }, "shoot"),
		);
	});

	test("z is centered and bounded; shooting deltas scale with z", () => {
		assert.strictEqual(depthZ(100, 50), 2);
		assert.strictEqual(depthZ(50, 50), 0);
		assert.closeTo(shootingDeltas(1, 22).tp, 0.4, 1e-9);
	});

	test("a cut ends a scout's tenure and the slot's next scout starts then", () => {
		const args = { leagueSeed: "s", tid: 2, level: 34, startingSeason: 2020 };
		const before = getDepartment({ ...args, season: 2021 });
		const s = before.scouts[0]!;
		const cutSeason = 2022;
		if (s.until > cutSeason) {
			const after = getDepartment({
				...args,
				season: cutSeason,
				cuts: { [s.id]: cutSeason },
			});
			assert.notInclude(
				after.scouts.map((x) => x.id),
				s.id,
			);
		}
		// Without cuts, nothing changes
		assert.deepEqual(
			getDepartment({ ...args, season: 2021, cuts: {} }),
			before,
		);
	});
});
