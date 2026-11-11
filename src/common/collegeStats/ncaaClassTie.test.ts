import { assert, describe, test } from "vitest";
import { simulateNcaaSeason } from "./ncaa.ts";
import {
	CLASS_SHAPE_TIES,
	NCAA_SHAPES,
	NCAA_TIE_RATE,
	ncaaClassTie,
} from "./ncaaStoryline.ts";

const contributions = [
	{ key: "1", school: "Duke", boost: 8, age: 19, pos: "PG" },
	{ key: "2", school: "Duke", boost: 5, age: 20, pos: "C" },
	{ key: "3", school: "Albany", boost: 4, age: 22, pos: "SF" },
	{ key: "4", school: "Kansas", boost: 6, age: 19, pos: "SG" },
];

const strip = (season: ReturnType<typeof simulateNcaaSeason>) => ({
	...season,
	version: 0,
	storyline: { ...season.storyline, summary: [] },
});

describe("college seasons that match their draft class (version 4)", () => {
	test("version 4 plays exactly like version 3 when the season does not match its class", () => {
		for (let i = 0; i < 6; i++) {
			const seed = `v4-${i}`;
			const v3 = simulateNcaaSeason({
				seed,
				season: 2027,
				contributions,
				version: 3,
			});
			const v4 = simulateNcaaSeason({
				seed,
				season: 2027,
				contributions,
				version: 4,
			});
			assert.deepStrictEqual(strip(v4), strip(v3));
			// Not a matching shape: the same season too
			const typical = simulateNcaaSeason({
				seed,
				season: 2027,
				contributions,
				version: 4,
				classShape: "typical",
			});
			assert.deepStrictEqual(strip(typical), strip(v3));
		}
	}, 120_000);

	test("a version 3 season ignores the class shape, so stored seasons replay the same", () => {
		const a = simulateNcaaSeason({
			seed: "s",
			season: 2027,
			contributions,
			version: 3,
		});
		const b = simulateNcaaSeason({
			seed: "s",
			season: 2027,
			contributions,
			version: 3,
			classShape: "oneAndDone",
		});
		assert.deepStrictEqual(a, b);
	}, 120_000);

	test("a one-and-done class's college year is usually the year of the freshman, as often as the tie rate says", () => {
		let freshmen = 0;
		let tied = 0;
		const N = 60;
		for (let i = 0; i < N; i++) {
			const seed = `tie-${i}`;
			const season = simulateNcaaSeason({
				seed,
				season: 2027,
				contributions,
				classShape: "oneAndDone",
			});
			const tie = ncaaClassTie(seed, 2027, "oneAndDone");
			if (tie) {
				tied += 1;
				assert.strictEqual(season.storyline.shape, "freshmen");
				assert.strictEqual(season.storyline.classTie, "oneAndDone");
				assert.isTrue(
					season.storyline.summary.some((line) => line.includes("draft class")),
				);
			}
			if (season.storyline.shape === "freshmen") {
				freshmen += 1;
			}
		}
		assert.approximately(tied / N, NCAA_TIE_RATE, 0.2);
		assert.isAbove(freshmen / N, 0.4);
	}, 120_000);

	test("every tie points at a real college shape", () => {
		for (const tie of Object.values(CLASS_SHAPE_TIES)) {
			if (tie.shape) {
				assert.isTrue(Object.hasOwn(NCAA_SHAPES, tie.shape));
			}
		}
	}, 120_000);

	test("version 4 summaries draw from more wordings, version 3 keep theirs", () => {
		const original =
			/for the national title\. .* also reached the Final Four\./;
		let otherWording = 0;
		for (let i = 0; i < 40; i++) {
			const seed = `w-${i}`;
			const v3 = simulateNcaaSeason({
				seed,
				season: 2027,
				contributions,
				version: 3,
			});
			const v4 = simulateNcaaSeason({
				seed,
				season: 2027,
				contributions,
				version: 4,
			});
			assert.isTrue(v3.storyline.summary.some((line) => original.test(line)));
			if (!v4.storyline.summary.some((line) => original.test(line))) {
				otherWording += 1;
			}
		}
		assert.isAbove(otherWording, 10);
	}, 120_000);
});
