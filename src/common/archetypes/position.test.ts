import { assert, describe, test } from "vitest";
import {
	POSITIONS,
	improvedPosition,
	positionAxes,
	positionFor,
	positionOf,
} from "./position.ts";
import type { ArchetypeRatings } from "./types.ts";

const R = (
	r: Omit<ArchetypeRatings, "endu" | "fg" | "ft" | "dnk"> &
		Partial<ArchetypeRatings>,
): ArchetypeRatings => ({ endu: 50, fg: 50, ft: 55, dnk: 50, ...r });

// Height rating = (inches - 66) / 0.27
export const FIXTURES: {
	name: string;
	ratings: ArchetypeRatings;
	expected: string[];
}[] = [
	{
		name: `classic PG (6'2")`,
		ratings: R({
			hgt: 30,
			stre: 40,
			spd: 75,
			jmp: 60,
			ins: 35,
			tp: 65,
			oiq: 65,
			diq: 45,
			drb: 75,
			pss: 75,
			reb: 30,
			ft: 75,
		}),
		expected: ["PG"],
	},
	{
		name: `6'8" playmaker`,
		ratings: R({
			hgt: 52,
			stre: 65,
			spd: 65,
			jmp: 65,
			ins: 55,
			dnk: 65,
			tp: 50,
			oiq: 70,
			diq: 55,
			drb: 65,
			pss: 70,
			reb: 50,
		}),
		expected: ["GF", "F"],
	},
	{
		name: `7' point center`,
		ratings: R({
			hgt: 67,
			stre: 65,
			spd: 40,
			jmp: 40,
			ins: 65,
			tp: 50,
			oiq: 75,
			diq: 50,
			drb: 55,
			pss: 75,
			reb: 70,
		}),
		expected: ["FC", "F"],
	},
	{
		name: `stretch 4 (6'10")`,
		ratings: R({
			hgt: 59,
			stre: 50,
			spd: 45,
			jmp: 45,
			ins: 45,
			tp: 65,
			ft: 70,
			fg: 60,
			oiq: 55,
			diq: 45,
			drb: 40,
			pss: 40,
			reb: 50,
		}),
		expected: ["PF", "F"],
	},
	{
		name: `small-ball 5 (6'7")`,
		ratings: R({
			hgt: 48,
			stre: 70,
			spd: 55,
			jmp: 65,
			ins: 60,
			dnk: 65,
			tp: 25,
			oiq: 50,
			diq: 60,
			drb: 35,
			pss: 40,
			reb: 65,
		}),
		expected: ["PF", "F"],
	},
	{
		name: `7' rim protector`,
		ratings: R({
			hgt: 67,
			stre: 65,
			spd: 35,
			jmp: 55,
			ins: 55,
			dnk: 60,
			tp: 10,
			ft: 40,
			oiq: 45,
			diq: 65,
			drb: 25,
			pss: 25,
			reb: 70,
		}),
		expected: ["C"],
	},
	{
		name: `3&D wing (6'7")`,
		ratings: R({
			hgt: 48,
			stre: 50,
			spd: 60,
			jmp: 55,
			ins: 35,
			tp: 65,
			ft: 70,
			oiq: 50,
			diq: 60,
			drb: 45,
			pss: 40,
			reb: 40,
		}),
		expected: ["SF", "GF"],
	},
	{
		name: `combo guard (6'4")`,
		ratings: R({
			hgt: 37,
			stre: 45,
			spd: 62,
			jmp: 60,
			ins: 40,
			tp: 60,
			oiq: 50,
			diq: 45,
			drb: 55,
			pss: 45,
			reb: 35,
		}),
		expected: ["G", "SG"],
	},
];

describe("improved positions", () => {
	test("fixtures", () => {
		for (const f of FIXTURES) {
			const pos = positionFor(f.ratings, true);
			assert.include(f.expected, pos, f.name);
		}
	});

	test("off: the original formula exactly", () => {
		let seed = 7;
		const rand = () => {
			seed = (seed * 16807) % 2147483647;
			return Math.floor((seed / 2147483647) * 101);
		};
		for (let i = 0; i < 2000; i++) {
			const r = R({
				hgt: rand(),
				stre: rand(),
				spd: rand(),
				jmp: rand(),
				ins: rand(),
				tp: rand(),
				oiq: rand(),
				diq: rand(),
				drb: rand(),
				pss: rand(),
				reb: rand(),
				endu: rand(),
				fg: rand(),
				ft: rand(),
				dnk: rand(),
			});
			assert.strictEqual(positionFor(r, false, "PG"), positionOf(r));
			assert.include(POSITIONS, positionFor(r, true));
		}
	});

	test("axes are percentiles in [0, 1], ordered by size and skill", () => {
		const pg = positionAxes(FIXTURES[0]!.ratings);
		const c = positionAxes(FIXTURES[5]!.ratings);
		assert.isBelow(pg.size, c.size);
		assert.isAbove(pg.skill, c.skill);
		for (const f of FIXTURES) {
			const a = positionAxes(f.ratings);
			for (const v of [a.size, a.skill]) {
				assert.isAtLeast(v, 0);
				assert.isAtMost(v, 1);
			}
		}
	});

	test("sticky: keeps a close previous position, drops a far one", () => {
		// Between F and SF centroids, a little closer to one of them
		const axes = { size: 0.565, skill: 0.46 };
		const best = improvedPosition(axes);
		const other = best === "F" ? "SF" : "F";
		assert.strictEqual(improvedPosition(axes, other), other);
		assert.strictEqual(improvedPosition(axes, "C"), best);
		assert.strictEqual(improvedPosition(axes, "not a position"), best);
		assert.strictEqual(improvedPosition(axes, "PG"), best);
	});

	test("tall playmakers are not centers, small bigs are not centers", () => {
		// Size of a 7-footer, skill of a playmaker
		assert.notStrictEqual(improvedPosition({ size: 0.95, skill: 0.8 }), "C");
		assert.include(["PF", "F"], improvedPosition({ size: 0.72, skill: 0.1 }));
		assert.strictEqual(improvedPosition({ size: 0.97, skill: 0.05 }), "C");
		assert.strictEqual(improvedPosition({ size: 0.03, skill: 0.97 }), "PG");
	});
});
