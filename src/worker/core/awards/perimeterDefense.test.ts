import { describe, expect, test } from "vitest";
import { fillAllDefensive } from "./perimeterDefense.ts";

const players = (positions: string[]) =>
	positions.map((pos, i) => ({ pos, id: i }));

describe("fillAllDefensive", () => {
	const sorted = players([
		"C",
		"PF",
		"SF",
		"C",
		"F",
		"FC",
		"SF",
		"PF",
		"C",
		"F",
		"GF",
		"SF",
		"PG",
		"C",
		"SG",
		"F",
		"G",
		"PG",
		"SF",
		"C",
		"SG",
	]);

	test("none is the plain top 15", () => {
		const teams = fillAllDefensive(sorted, 3, "none");
		expect(teams.flat().map((p) => p.id)).toEqual([...Array(15).keys()]);
	});

	test("oneGuard puts a true guard on every team", () => {
		const teams = fillAllDefensive(sorted, 3, "oneGuard");
		for (const team of teams) {
			expect(team).toHaveLength(5);
			expect(team.some((p) => ["PG", "SG", "G"].includes(p.pos))).toBe(true);
		}
		// The first four slots stay the best scores
		expect(teams[0]!.slice(0, 4).map((p) => p.id)).toEqual([0, 1, 2, 3]);
		expect(teams[0]![4]!.pos).toBe("PG");
		expect(new Set(teams.flat()).size).toBe(15);
	});

	test("gfc is 2 guards, 2 forwards and a center", () => {
		const teams = fillAllDefensive(sorted, 3, "gfc");
		for (const team of teams) {
			expect(team).toHaveLength(5);
			const g = team.filter((p) => ["PG", "SG", "G", "GF"].includes(p.pos));
			const c = team.filter((p) => ["C"].includes(p.pos));
			expect(g.length).toBeGreaterThanOrEqual(2);
			expect(c.length).toBeLessThanOrEqual(1);
		}
		expect(new Set(teams.flat()).size).toBe(15);
	});

	test("fills with the best left when a position runs out", () => {
		const teams = fillAllDefensive(
			players(["C", "C", "C", "C", "C", "C"]),
			1,
			"gfc",
		);
		expect(teams[0]).toHaveLength(5);
	});
});
