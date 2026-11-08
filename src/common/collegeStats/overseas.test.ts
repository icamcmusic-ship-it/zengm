import { assert, describe, test } from "vitest";
import { generateCollegeClass } from "./index.ts";
import { getPreDraftLabel, isOverseasLeague } from "./overseas.ts";
import { Rng } from "./rng.ts";
import { RATING_KEYS, type CollegeProspect } from "./types.ts";

const makeProspects = (
	n: number,
	college: (i: number) => string,
): CollegeProspect[] => {
	const rng = new Rng("overseas");
	return Array.from({ length: n }, (_, i) => {
		const talent = rng.normal(0, 1);
		const ratings: any = {};
		for (const key of RATING_KEYS) {
			ratings[key] = Math.max(
				5,
				Math.min(95, 38 + 9 * talent + 8 * rng.normal(0, 1)),
			);
		}
		return {
			key: String(i),
			age: [19, 20, 21][i % 3]!,
			ovr: Math.round(44 + 8 * talent),
			pot: Math.round(56 + 8 * talent),
			pos: "SF",
			ratings,
			college: college(i),
			bornLoc: "Belgrade, Serbia",
		};
	});
};

const perGame = (
	seasons: ReturnType<typeof generateCollegeClass>,
	key: string,
) => {
	let min = 0;
	let gp = 0;
	let pts = 0;
	for (const r of seasons) {
		for (const s of r.seasons) {
			min += s.stats[key === "min" ? "min" : "min"]!;
			gp += s.stats.gp!;
			pts += s.stats.pts!;
		}
	}
	return { mpg: min / gp, ppg: pts / gp };
};

describe("overseas pre-draft stats", () => {
	test("labels", () => {
		assert.strictEqual(getPreDraftLabel("EuroLeague"), "Overseas");
		assert.strictEqual(getPreDraftLabel("Liga ACB"), "Overseas");
		assert.strictEqual(getPreDraftLabel("NBA G League"), "G League");
		assert.strictEqual(getPreDraftLabel("Duke"), "College");
		assert.strictEqual(getPreDraftLabel(undefined), "College");
		assert.isTrue(isOverseasLeague("EuroLeague"));
		assert.isFalse(isOverseasLeague("Overtime Elite"));
	});

	test("young EuroLeague players play fewer minutes and score less than in college", () => {
		const euro = generateCollegeClass(
			makeProspects(60, () => "EuroLeague"),
			{ seed: "s", draftYear: 2030 },
		);
		const college = generateCollegeClass(
			makeProspects(60, () => "Duke"),
			{ seed: "s", draftYear: 2030 },
		);
		const e = perGame(euro, "min");
		const c = perGame(college, "min");
		assert.isBelow(e.mpg, c.mpg - 5);
		assert.isBelow(e.ppg, c.ppg);
		assert.isAtMost(e.mpg, 32);
		// Teenagers are capped
		for (const r of euro) {
			for (const s of r.seasons) {
				if ((s.age ?? 99) <= 20) {
					assert.isAtMost(s.stats.min! / s.stats.gp!, 24);
				}
			}
		}
	});

	test("overseas prospects get league honors, never college ones", () => {
		const euro = generateCollegeClass(
			makeProspects(120, (i) => (i % 2 ? "EuroLeague" : "Adriatic League")),
			{ seed: "h", draftYear: 2030 },
		);
		const types = euro.flatMap((r) => r.honors.map((h) => h.type));
		assert.isAbove(types.length, 0);
		for (const type of types) {
			assert.match(type, /EuroLeague|ABA/);
			assert.notMatch(type, /All-American|Conference/);
		}
	});
});
