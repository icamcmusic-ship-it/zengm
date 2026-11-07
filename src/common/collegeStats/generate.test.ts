import { assert, describe, test } from "vitest";
import stats from "../../worker/core/player/stats.basketball.ts";
import { COLLEGE_AWARD_PREFIX } from "../preDraft.ts";
import { generateCollegeClass, getClassIndex } from "./index.ts";
import { Rng } from "./rng.ts";
import { RATING_KEYS, type CollegeProspect } from "./types.ts";

const makeProspects = (n: number, seed = "prospects"): CollegeProspect[] => {
	const rng = new Rng(seed);
	return Array.from({ length: n }, (_, i) => {
		const talent = rng.normal(0, 1);
		const hgt = Math.max(0, Math.min(100, 50 + 20 * rng.normal(0, 1)));
		const ratings: any = {};
		for (const key of RATING_KEYS) {
			ratings[key] = Math.max(
				5,
				Math.min(95, 35 + 9 * talent + 8 * rng.normal(0, 1)),
			);
		}
		ratings.hgt = hgt;
		const age = [19, 19, 20, 21, 22][i % 5]!;
		return {
			key: String(i),
			age,
			ovr: Math.round(42 + 8 * talent),
			pot: Math.round(55 + 8 * talent),
			pos: hgt > 65 ? "C" : hgt > 45 ? "SF" : "PG",
			ratings,
			college:
				i % 4 === 3 ? "" : ["Duke", "Kansas", "Gonzaga", "Albany"][i % 4]!,
			bornLoc: i % 8 === 7 ? "Belgrade, Serbia" : "Chicago, IL, USA",
		};
	});
};

describe("generateCollegeClass", () => {
	test("deterministic: same seed, same output", () => {
		const prospects = makeProspects(40);
		const a = generateCollegeClass(prospects, { seed: "x", draftYear: 2027 });
		const b = generateCollegeClass(prospects, { seed: "x", draftYear: 2027 });
		assert.deepStrictEqual(a, b);
		const c = generateCollegeClass(prospects, { seed: "y", draftYear: 2027 });
		assert.notStrictEqual(JSON.stringify(a), JSON.stringify(c));
	});

	test("what a prospect gets does not depend on who else is in the class", () => {
		const prospects = makeProspects(40);
		const all = generateCollegeClass(prospects, { seed: "x", draftYear: 2027 });
		const some = generateCollegeClass(prospects.slice(5, 12), {
			seed: "x",
			draftYear: 2027,
		});
		// Stats depend only on a prospect and his own stream, apart from the class's ovr scale so only compare school choice, which has no class dependence besides talent z
		assert.strictEqual(all[6]!.seasons.length, some[1]!.seasons.length);
	});

	test("does not change the prospects it is given", () => {
		const prospects = makeProspects(30);
		const copy = structuredClone(prospects);
		generateCollegeClass(prospects, { seed: "x", draftYear: 2027 });
		assert.deepStrictEqual(prospects, copy);
	});

	test("class year sets how many seasons, ending in the draft year", () => {
		assert.strictEqual(getClassIndex(19), 0);
		assert.strictEqual(getClassIndex(20), 1);
		assert.strictEqual(getClassIndex(21), 2);
		assert.strictEqual(getClassIndex(22), 3);

		const prospects = makeProspects(60).filter((p) => p.college !== "");
		const results = generateCollegeClass(prospects, {
			seed: "x",
			draftYear: 2027,
		});
		for (const [i, result] of results.entries()) {
			const p = prospects[i]!;
			assert.strictEqual(result.seasons.length, getClassIndex(p.age) + 1);
			assert.strictEqual(result.seasons.at(-1)!.season, 2027);
			assert.deepStrictEqual(
				result.seasons.map((s) => s.season),
				result.seasons.map((_, j) => 2027 - (result.seasons.length - 1 - j)),
			);
		}
	});

	test("without prior seasons, only the draft year", () => {
		const prospects = makeProspects(20);
		const results = generateCollegeClass(prospects, {
			seed: "x",
			draftYear: 2027,
			priorSeasons: false,
		});
		for (const result of results) {
			assert(result.seasons.length <= 1);
		}
	});

	test("stat lines are complete and consistent with themselves", () => {
		const results = generateCollegeClass(makeProspects(50), {
			seed: "x",
			draftYear: 2027,
		});
		let numChecked = 0;
		for (const result of results) {
			for (const season of result.seasons) {
				const s = season.stats;
				for (const key of [...stats.raw, ...stats.derived]) {
					assert(
						Number.isFinite(s[key]),
						`${key} is not a finite number: ${s[key]}`,
					);
				}
				for (const key of stats.max) {
					assert(season.max[key], `missing max ${key}`);
					assert(season.max[key]![1] < 0, "game id must not be a real game");
				}
				assert(s.gp! > 0 && s.gp! <= season.teamGames);
				assert(s.gs! <= s.gp!);
				assert(s.min! > 0);
				assert(s.minAvailable! >= s.gp! * 3);
				assert.strictEqual(
					s.fg,
					s.fgAtRim! + s.fgLowPost! + s.fgMidRange! + s.tp!,
				);
				assert.strictEqual(
					s.fga,
					s.fgaAtRim! + s.fgaLowPost! + s.fgaMidRange! + s.tpa!,
				);
				assert.strictEqual(s.pts, 2 * s.fg! + s.tp! + s.ft!);
				assert(s.fg! <= s.fga! && s.tp! <= s.tpa! && s.ft! <= s.fta!);
				// A season high is at least the average and no more than the total
				assert(season.max.ptsMax![0] >= s.pts! / s.gp!);
				assert(season.max.ptsMax![0] <= s.pts!);
				assert(season.max.trbMax![0] <= s.orb! + s.drb!);
				assert(s.dd! <= s.gp!);
				assert(s.td! <= s.dd!);
				numChecked += 1;
			}
		}
		assert(numChecked > 50);
	});

	test("lines are realistic, on average", () => {
		const results = generateCollegeClass(makeProspects(200), {
			seed: "avg",
			draftYear: 2027,
		});
		const rows = results.flatMap((r) =>
			r.seasons.filter((s) => s.season === 2027),
		);
		const mean = (f: (s: (typeof rows)[number]) => number) =>
			rows.reduce((sum, s) => sum + f(s), 0) / rows.length;
		const ppg = mean((s) => s.stats.pts! / s.stats.gp!);
		const mpg = mean((s) => s.stats.min! / s.stats.gp!);
		const tov = mean((s) => s.stats.tov! / s.stats.gp!);
		const totalPts = rows.reduce((sum, s) => sum + s.stats.pts!, 0);
		const totalFga = rows.reduce((sum, s) => sum + s.stats.fga!, 0);
		const totalFta = rows.reduce((sum, s) => sum + s.stats.fta!, 0);
		const ts = totalPts / (2 * (totalFga + 0.44 * totalFta));
		assert(ppg > 9 && ppg < 18, `ppg ${ppg}`);
		assert(mpg > 24 && mpg < 33, `mpg ${mpg}`);
		assert(tov > 1.2 && tov < 3.2, `tov ${tov}`);
		assert(ts > 0.52 && ts < 0.62, `ts ${ts}`);
	});

	test("better prospects put up bigger numbers", () => {
		const prospects = makeProspects(300, "talent");
		const results = generateCollegeClass(prospects, {
			seed: "x",
			draftYear: 2027,
		});
		const rows = results
			.map((r, i) => ({
				ovr: prospects[i]!.ovr,
				season: r.seasons.find((s) => s.season === 2027),
			}))
			.filter((row) => row.season);
		const ppgOf = (row: (typeof rows)[number]) =>
			row.season!.stats.pts! / row.season!.stats.gp!;
		const sorted = [...rows].sort((a, b) => a.ovr - b.ovr);
		const bottom = sorted.slice(0, 60);
		const top = sorted.slice(-60);
		const avg = (arr: typeof rows) =>
			arr.reduce((sum, row) => sum + ppgOf(row), 0) / arr.length;
		assert(avg(top) > avg(bottom) + 3);
	});

	test("blank colleges get a school or club, and honors are for colleges only, prefixed and never at a later season", () => {
		const prospects = makeProspects(70);
		const results = generateCollegeClass(prospects, {
			seed: "x",
			draftYear: 2027,
		});
		for (const [i, result] of results.entries()) {
			if (prospects[i]!.college === "") {
				assert(result.school !== "");
			} else {
				assert.strictEqual(result.school, prospects[i]!.college);
			}
			for (const honor of result.honors) {
				assert(honor.type.startsWith(COLLEGE_AWARD_PREFIX));
				assert(honor.season <= 2027);
				assert(honor.season >= 2027 - 3);
			}
		}

		const withoutFill = generateCollegeClass(prospects, {
			seed: "x",
			draftYear: 2027,
			fillBlankColleges: false,
		});
		for (const [i, result] of withoutFill.entries()) {
			if (prospects[i]!.college === "") {
				assert.strictEqual(result.seasons.length, 0);
				assert.strictEqual(result.honors.length, 0);
			}
		}
	});

	test("a typical class gets a sensible handful of honors", () => {
		let consensusFirst = 0;
		let allConf = 0;
		const NUM_CLASSES = 10;
		for (let i = 0; i < NUM_CLASSES; i++) {
			const results = generateCollegeClass(makeProspects(70, `class${i}`), {
				seed: `s${i}`,
				draftYear: 2027,
			});
			for (const result of results) {
				for (const honor of result.honors) {
					if (honor.season !== 2027) {
						continue;
					}
					if (honor.type.includes("Consensus First Team All-American")) {
						consensusFirst += 1;
					}
					if (/All-.* First Team$/.test(honor.type)) {
						allConf += 1;
					}
				}
			}
		}
		assert(consensusFirst / NUM_CLASSES < 6, `consensus ${consensusFirst}`);
		assert(allConf / NUM_CLASSES > 2, `all conf ${allConf}`);
		assert(allConf / NUM_CLASSES < 30, `all conf ${allConf}`);
	});

	test("empty class and one prospect classes work", () => {
		assert.deepStrictEqual(
			generateCollegeClass([], { seed: "x", draftYear: 2027 }),
			[],
		);
		const one = generateCollegeClass(makeProspects(1), {
			seed: "x",
			draftYear: 2027,
		});
		assert.strictEqual(one.length, 1);
	});
});
