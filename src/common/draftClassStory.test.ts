import { assert, describe, test } from "vitest";
import {
	compareWithHistory,
	getClassProfile,
	rankProspects,
	writeClassHeadline,
	writeClassStorylines,
	type StoryProspect,
} from "./draftClassStory.ts";
import {
	DRAFT_CLASS_SHAPES,
	describeDraftClassShape,
	type DraftClassShape,
} from "./draftClassShape.ts";
import { Rng } from "./collegeStats/rng.ts";
import { COLLEGES, CONFERENCES } from "./collegeStats/colleges.ts";

const POS = ["PG", "SG", "G", "GF", "SF", "F", "PF", "FC", "C"];
const COUNTRIES = [
	"USA",
	"USA",
	"USA",
	"USA",
	"Canada",
	"France",
	"Serbia",
	"Spain",
];
const SCHOOLS = [
	"Duke",
	"Kentucky",
	"Kansas",
	"Gonzaga",
	"Albany",
	"Akron",
	"",
];

const randomClass = (seed: string): StoryProspect[] => {
	const rng = new Rng(seed);
	const skew = rng.random();
	return Array.from({ length: 70 }, (_, pid) => {
		const country = COUNTRIES[Math.floor(rng.random() * COUNTRIES.length)]!;
		const intl = country !== "USA" && country !== "Canada";
		return {
			pid,
			name: `Player ${pid}`,
			age: 19 + Math.floor(rng.random() * 4),
			pos: POS[Math.floor(rng.random() ** (0.5 + skew) * POS.length)]!,
			country,
			college: intl ? "" : SCHOOLS[Math.floor(rng.random() * SCHOOLS.length)]!,
			ovr: 40 + Math.round(10 * rng.random()),
			pot: 50 + Math.round(15 * rng.random()),
			value: 40 + 30 * rng.random() ** 2,
			...(rng.random() < 0.08 ? { injury: true } : {}),
		};
	});
};

const NUMBERS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	eleven: 11,
	twelve: 12,
};
const num = (word: string) => NUMBERS[word.toLowerCase()] ?? Number(word);

describe("draft class storylines", () => {
	test("compared with earlier classes", () => {
		const h = (values: number[]) =>
			values.map((value, i) => ({ year: 2020 + i, value }));
		// Better than the last 4 (2026-2029), not 2025
		assert.strictEqual(
			compareWithHistory(10, h([1, 2, 3, 4, 5, 20, 1, 2, 3, 4])),
			"since 2025",
		);
		assert.isUndefined(compareWithHistory(10, h([1, 20, 1, 2, 3])));
		assert.strictEqual(
			compareWithHistory(10, h([1, 2, 3, 4, 5, 6])),
			"in at least 6 years",
		);
		assert.isUndefined(compareWithHistory(10, h([1, 2, 3])));
		assert.strictEqual(
			compareWithHistory(0, h([5, 5, 5, 5, 5]), "least"),
			"in at least 5 years",
		);
	});

	test("every storyline is true of the class, 2-4 of them, the same every time", () => {
		const shapes = Object.keys(DRAFT_CLASS_SHAPES) as DraftClassShape[];
		const seen = new Set<string>();
		for (let i = 0; i < 300; i++) {
			const prospects = randomClass(`c${i}`);
			const shape = shapes[i % shapes.length]!;
			const input = { draftYear: 2030, shape, prospects };
			const lines = writeClassStorylines(input);
			assert.deepStrictEqual(writeClassStorylines(input), lines);
			assert.isAtLeast(lines.length, 2);
			assert.isAtMost(lines.length, 4);
			const ranked = rankProspects(prospects);
			const top = (n: number) => ranked.slice(0, n);
			assert.include(lines[0], ranked[0]!.name);
			assert.include(lines[0], `${ranked[0]!.age}-year-old`);
			for (const line of lines) {
				seen.add(line.replace(/\d+|Player \d+|[A-Z][a-z]+ /g, "").slice(0, 20));
				let m = /^(\w+) centers in the top 10\./.exec(line);
				if (m) {
					assert.strictEqual(
						top(10).filter((p) => p.pos === "C" || p.pos === "FC").length,
						num(m[1]!),
						line,
					);
				}
				if (line === "Not one big man in the top 10.") {
					assert.strictEqual(
						top(10).filter((p) => ["C", "FC", "PF"].includes(p.pos)).length,
						0,
					);
				}
				m = /^(\w+) guards in the top 10\./.exec(line);
				if (m) {
					assert.strictEqual(
						top(10).filter((p) => ["PG", "SG", "G"].includes(p.pos)).length,
						num(m[1]!),
						line,
					);
				}
				m = /^(\w+) point guards in the top 30\./.exec(line);
				if (m) {
					assert.strictEqual(
						top(30).filter((p) => p.pos === "PG").length,
						num(m[1]!),
						line,
					);
				}
				m = /^(\w+) teenagers among the top 14/.exec(line);
				if (m) {
					assert.strictEqual(
						top(14).filter((p) => p.age <= 19).length,
						num(m[1]!),
						line,
					);
				}
				m = /^(\w+) of the top 14 prospects are 22 or older/.exec(line);
				if (m) {
					assert.strictEqual(
						top(14).filter((p) => p.age >= 22).length,
						num(m[1]!),
						line,
					);
				}
				m = /^(\w+) of the top 30 prospects are from (.+)\.$/.exec(line);
				if (m) {
					assert.strictEqual(
						top(30).filter((p) => p.country === m![2]).length,
						num(m[1]!),
						line,
					);
				}
				m = /^(\w+) prospects from outside North America in the top 30/.exec(
					line,
				);
				if (m) {
					assert.strictEqual(
						top(30).filter((p) => p.country !== "USA" && p.country !== "Canada")
							.length,
						num(m[1]!),
						line,
					);
				}
				m = /^(.+) has (\w+) of the top 10 prospects\./.exec(line);
				if (m) {
					assert.strictEqual(
						top(10).filter((p) => p.college === m![1]).length,
						num(m[2]!),
						line,
					);
				}
				m = /^(\w+) of the top 30 prospects come from schools outside/.exec(
					line,
				);
				if (m) {
					assert.strictEqual(
						top(30).filter((p) => {
							const info = COLLEGES[p.college];
							return p.country !== "USA" && p.country !== "Canada"
								? false
								: !!info && CONFERENCES[info[1]]?.tier !== "high";
						}).length,
						num(m[1]!),
						line,
					);
				}
				m = /^(\w+) of the top 30 prospects are coming back from injuries/.exec(
					line,
				);
				if (m) {
					assert.strictEqual(
						top(30).filter((p) => p.injury).length,
						num(m[1]!),
						line,
					);
				}
				if (line.startsWith("The top three are separated by a hair")) {
					assert.isAtMost(ranked[0]!.value - ranked[2]!.value, 1.5);
				}
			}
		}
		// Plenty of different storylines come up
		assert.isAbove(seen.size, 10);
	});

	test("a class with three centers on top and history to compare with", () => {
		const prospects = randomClass("x").map((p, i) => ({
			...p,
			pos: i < 3 ? "C" : i < 10 ? "SG" : p.pos,
			country: "USA",
			college: "",
			injury: undefined,
			value: 100 - i,
			ovr: 60,
			pot: 70,
		}));
		const history = Array.from({ length: 10 }, (_, i) => ({
			...getClassProfile(2020 + i, rankProspects(prospects)),
			strength: i === 3 ? 80 : 50,
		}));
		const input = {
			draftYear: 2030,
			shape: "bigs" as const,
			prospects,
			history,
		};
		const lines = writeClassStorylines(input);
		assert.include(lines, "Three centers in the top 10.");
		assert.include(
			lines,
			"The best class at the top since 2023, by the scouts' ratings.",
		);
		const headline = writeClassHeadline(input);
		assert.include(headline, "2030 draft class");
		assert.include(headline, "big man class (the best since 2023)");
	});

	test("version 1 classes keep their description, later ones pick a wording from the seed", () => {
		for (const shape of Object.keys(DRAFT_CLASS_SHAPES) as DraftClassShape[]) {
			const { descriptions } = DRAFT_CLASS_SHAPES[shape];
			assert.isAtLeast(descriptions.length, 3);
			assert.strictEqual(
				describeDraftClassShape(shape, 1, "a"),
				descriptions[0],
			);
			assert.strictEqual(
				describeDraftClassShape(shape, 2, "a"),
				describeDraftClassShape(shape, 2, "a"),
			);
			const picked = new Set(
				Array.from({ length: 30 }, (_, i) =>
					describeDraftClassShape(shape, 2, `s${i}`),
				),
			);
			assert.strictEqual(picked.size, descriptions.length);
		}
	});
});
