import { assert, describe, test } from "vitest";
import { generateCollegeClass } from "./index.ts";
import { makeClass } from "./career.testutil.ts";
import {
	careerInjuries,
	hasMajorPreDraftInjury,
	injuryRateMultiplier,
	injuryText,
} from "./injuries.ts";
import type { CollegeProspect, CollegeResult } from "./types.ts";

const DRAFT_YEAR = 2030;

const gen = (
	prospects: CollegeProspect[],
	seed: string,
	injuries?: boolean,
): CollegeResult[] =>
	generateCollegeClass(prospects, {
		seed,
		draftYear: DRAFT_YEAR,
		...(injuries === undefined ? {} : { injuries }),
	});

describe("pre-draft injuries", () => {
	test("believable rates: most prospects clean, a minority minor, a few major", () => {
		let n = 0;
		let clean = 0;
		let minorOnly = 0;
		let major = 0;
		for (let c = 0; c < 12; c++) {
			for (const result of gen(makeClass(70, `inj${c}`), `s${c}`)) {
				if (!result.career) {
					continue;
				}
				n += 1;
				const list = careerInjuries(result.career);
				if (list.length === 0) {
					clean += 1;
				} else if (list.some((inj) => inj.major)) {
					major += 1;
				} else {
					minorOnly += 1;
				}
			}
		}
		assert.isAbove(clean / n, 0.65);
		assert.isBelow(clean / n, 0.88);
		assert.isAbove(minorOnly / n, 0.08);
		assert.isBelow(minorOnly / n, 0.28);
		assert.isAbove(major / n, 0.02);
		assert.isBelow(major / n, 0.12);
	});

	test("games played reflect the games missed", () => {
		let checked = 0;
		for (let c = 0; c < 6; c++) {
			const prospects = makeClass(70, `gp${c}`);
			const on = gen(prospects, `g${c}`);
			const off = gen(prospects, `g${c}`, false);
			for (const [i, result] of on.entries()) {
				// His seasons share one stream, so only his first injury can be compared with the same season without injuries
				let first = true;
				for (const year of result.career?.years ?? []) {
					const inj = year.injury;
					if (!inj) {
						continue;
					}
					const isFirst = first;
					first = false;
					if (inj.ended) {
						continue;
					}
					const season = result.seasons.find((s) => s.season === year.season)!;
					assert.isAbove(inj.games, 0);
					assert.isAtMost(
						season.stats.gp! + inj.games,
						season.teamGames,
						"he can't play the games he missed",
					);
					// Fewer games than the same season without the injury, unless he missed them anyway
					const before = off[i]!.seasons.find((s) => s.season === year.season);
					if (isFirst && before) {
						assert.isAtMost(season.stats.gp!, before.stats.gp!);
					}
					checked += 1;
				}
			}
		}
		assert.isAbove(checked, 10);
	});

	test("season-ending injuries cut the season short", () => {
		let checked = 0;
		for (let c = 0; c < 12; c++) {
			for (const result of gen(makeClass(70, `end${c}`), `e${c}`)) {
				for (const year of result.career?.years ?? []) {
					if (!year.injury?.ended) {
						continue;
					}
					assert(year.status === "medical" || year.status === "injury");
					const season = result.seasons.find((s) => s.season === year.season)!;
					assert.isBelow(season.stats.gp!, season.teamGames);
					checked += 1;
				}
			}
		}
		assert.isAbove(checked, 5);
	});

	test("a prospect with a clean history gets exactly the seasons he had without injuries", () => {
		const prospects = makeClass(70, "same");
		const on = gen(prospects, "same");
		const off = gen(prospects, "same", false);
		let clean = 0;
		for (const [i, result] of on.entries()) {
			if (!result.career || careerInjuries(result.career).length > 0) {
				continue;
			}
			clean += 1;
			assert.deepStrictEqual(result.seasons, off[i]!.seasons);
			assert.deepStrictEqual(result.career, off[i]!.career);
		}
		assert.isAbove(clean, 40);
	});

	test("deterministic", () => {
		const prospects = makeClass(70, "det");
		assert.deepStrictEqual(gen(prospects, "d"), gen(prospects, "d"));
	});

	test("low durability means more injuries", () => {
		const count = (durability: number) => {
			let total = 0;
			for (let c = 0; c < 6; c++) {
				const prospects = makeClass(70, `dur${c}`).map((p) => ({
					...p,
					durability,
				}));
				for (const result of gen(prospects, `d${c}`)) {
					total += careerInjuries(result.career).length;
				}
			}
			return total;
		};
		assert.isAbove(count(20), 1.5 * count(80));
		assert.strictEqual(injuryRateMultiplier(undefined), 1);
		assert.isAbove(injuryRateMultiplier(30), 1.5);
		assert.isBelow(injuryRateMultiplier(70), 0.6);
	});

	test("older careers: a season cut short counts as a major injury without a type", () => {
		const career = {
			years: [
				{ season: 2028, status: "medical" },
				{ season: 2029 },
				{ season: 2030 },
			],
		};
		assert.deepStrictEqual(careerInjuries(career), [
			{
				season: 2028,
				type: "Undisclosed injury",
				games: 0,
				major: true,
				ended: true,
			},
		]);
		assert(hasMajorPreDraftInjury(career));
		assert(!hasMajorPreDraftInjury({ years: [{ season: 2030 }] }));
		assert(!hasMajorPreDraftInjury(undefined));
		assert.strictEqual(
			injuryText({ type: "Fractured Hand", games: 12, major: true }),
			"Fractured Hand, missed 12 games",
		);
		assert.strictEqual(
			injuryText({ type: "Torn ACL", games: 0, major: true, ended: true }, 9),
			"Torn ACL, season-ending after 9 games",
		);
	});
});
