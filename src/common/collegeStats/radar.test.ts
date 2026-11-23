import { assert, describe, test, vi } from "vitest";
import { generateCollegeClass } from "./index.ts";
import { makeClass } from "./career.testutil.ts";
import { heightFromRating } from "./career.ts";
import {
	getHsRank,
	getRadarReason,
	hsRankMedian,
	isLowPedigree,
	isOffRadar,
	isWeakProduction,
	radarSeasons,
	tapeAthletic,
	type RadarInput,
	type RadarSeason,
} from "./radar.ts";

const season = (
	year: number,
	gp: number,
	mpg: number,
	ppg: number,
	extra: Partial<RadarSeason> = {},
): RadarSeason => ({
	season: year,
	school: "Wofford",
	level: "ncaa",
	gp,
	min: gp * mpg,
	pts: gp * ppg,
	...extra,
});

const input = (extra: Partial<RadarInput>): RadarInput => ({
	hsPath: true,
	recruitRank: undefined,
	seasons: [],
	ageAtDraft: 21,
	heightInches: 78,
	athletic: 50,
	...extra,
});

describe("under the radar", () => {
	test("weak production", () => {
		assert.isTrue(isWeakProduction([]));
		assert.isTrue(isWeakProduction([season(2030, 30, 10, 3)]));
		assert.isTrue(isWeakProduction([season(2030, 5, 30, 15)]));
		assert.isFalse(isWeakProduction([season(2030, 30, 25, 12)]));
		// A real season before an injury-shortened last one
		assert.isFalse(
			isWeakProduction([season(2029, 30, 28, 14), season(2030, 5, 30, 15)]),
		);
	});

	test("only lowly recruited (or unproductive non-recruits) get a reason", () => {
		const breakout = [season(2029, 30, 8, 3), season(2030, 32, 30, 16)];
		assert.isUndefined(
			getRadarReason(input({ recruitRank: 40, seasons: breakout })),
		);
		assert.strictEqual(
			getRadarReason(input({ recruitRank: 450, seasons: breakout }))?.kind,
			"lateBloomer",
		);
		assert.include(
			getRadarReason(input({ seasons: breakout }))!.text,
			"Unranked out of high school",
		);
		// Not a high school recruit and productive: nothing to explain
		assert.isUndefined(
			getRadarReason(
				input({ hsPath: false, seasons: [season(2030, 30, 28, 15)] }),
			),
		);
	});

	test("each reason", () => {
		const kind = (extra: Partial<RadarInput>) =>
			getRadarReason(input(extra))?.kind;
		assert.strictEqual(
			kind({
				seasons: [
					season(2029, 30, 26, 13),
					season(2030, 6, 28, 14, { status: "injury" }),
				],
			}),
			"injury",
		);
		assert.strictEqual(
			kind({
				seasons: [
					season(2028, 30, 30, 18, { level: "juco", school: "Iowa Western" }),
					season(2029, 30, 12, 4),
					season(2030, 30, 13, 5),
				],
			}),
			"juco",
		);
		assert.strictEqual(
			kind({
				seasons: [
					season(2029, 30, 14, 5, { school: "Wofford" }),
					season(2030, 30, 27, 11, { school: "Duke", move: "up" }),
				],
			}),
			"transfer",
		);
		assert.strictEqual(
			kind({
				hsPath: false,
				ageAtDraft: 19,
				seasons: [season(2030, 30, 12, 4, { school: "EuroLeague" })],
			}),
			"youngPro",
		);
		assert.strictEqual(kind({ hsPath: false, seasons: [] }), "workouts");
		assert.strictEqual(
			kind({ seasons: [season(2030, 30, 10, 3)], heightInches: 85 }),
			"tools",
		);
		assert.strictEqual(
			kind({ seasons: [season(2030, 30, 10, 3)], athletic: 90, tested: true }),
			"combine",
		);
		// Nothing explains him: off the radar
		const nothing = input({ seasons: [season(2030, 30, 10, 3)] });
		assert.isUndefined(getRadarReason(nothing));
		assert.isTrue(isOffRadar(nothing));
		assert.isFalse(isOffRadar(input({ recruitRank: 50, seasons: [] })));
	});

	test("seasons merge stats rows with the stored career", () => {
		const seasons = radarSeasons(
			[
				{ season: 2029, school: "A", level: "juco" },
				{ season: 2030, school: "B", level: "ncaa", move: "juco", cls: "Jr." },
			],
			[
				{ season: 2029, teamName: "A", gp: 30, min: 900, pts: 500 },
				{ season: 2030, teamName: "B", gp: 30, min: 600, pts: 200 },
				{
					season: 2030,
					teamName: "B",
					gp: 3,
					min: 90,
					pts: 30,
					playoffs: true,
				},
			],
		);
		assert.strictEqual(seasons.length, 2);
		assert.strictEqual(seasons[0]!.level, "juco");
		assert.strictEqual(seasons[1]!.gp, 30);
		assert.strictEqual(seasons[1]!.cls, "Jr.");
	});

	test("recruiting rank follows draft stock, later for late bloomers, from its own stream", () => {
		let prev = 0;
		for (const z of [2.5, 1.5, 0.5, 0, -0.5, -1.5]) {
			const median = hsRankMedian(z, 0, 0);
			assert.isAbove(median, prev);
			prev = median;
		}
		assert.isBelow(hsRankMedian(2.4, 0, 0), 6);
		assert.isAbove(hsRankMedian(0, 3, 1), 2 * hsRankMedian(0, 3, 0));
		assert.isBelow(hsRankMedian(0, 3, -1), hsRankMedian(0, 3, 0));

		const args = {
			seedBase: "s|2030|1",
			zStock: 0.3,
			yearsBefore: 1,
			lateness: 0,
			story: undefined,
			jucoStart: false,
			smallStart: false,
			pathway: false,
		};
		assert.strictEqual(getHsRank(args), getHsRank(args));
		assert.isUndefined(getHsRank({ ...args, story: "unranked" }));
		assert.isAtMost(getHsRank({ ...args, story: "bust" })!, 22);
		assert.isAtMost(getHsRank({ ...args, pathway: true })!, 25);
	});

	test("generated classes: real draft stock has pedigree, production or a reason", () => {
		const spy = vi.spyOn(Math, "random");
		let candidates = 0;
		let unexplained = 0;
		let lowPedigreeTop = 0;
		let topRanked = 0;
		for (let c = 0; c < 8; c++) {
			const prospects = makeClass(70, `radar${c}`);
			const results = generateCollegeClass(prospects, {
				seed: `radar${c}`,
				draftYear: 2031,
			});
			// Class stock, like generation's (ovr and pot, pot weighted)
			const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
			const sd = (xs: number[]) => {
				const m = mean(xs);
				return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
			};
			const ovrs = prospects.map((p) => p.ovr);
			const pots = prospects.map((p) => p.pot);
			const stock = (i: number) =>
				0.4 * ((ovrs[i]! - mean(ovrs)) / sd(ovrs)) +
				0.6 * ((pots[i]! - mean(pots)) / sd(pots));
			for (const [i, result] of results.entries()) {
				const career = result.career;
				if (career?.hsClass === undefined) {
					continue;
				}
				const p = prospects[i]!;
				assert.isDefined(career.hsRank);
				const radar: RadarInput = {
					hsPath: true,
					recruitRank: career.hsRank,
					story: career.story,
					route: career.route,
					seasons: radarSeasons(
						career.years,
						result.seasons.map((s) => ({
							season: s.season,
							teamName: s.school,
							gp: s.stats.gp,
							min: s.stats.min,
							pts: s.stats.pts,
						})),
					),
					ageAtDraft: p.age,
					heightInches: heightFromRating(p.ratings.hgt),
					athletic: tapeAthletic(p.ratings.spd, p.ratings.jmp),
				};
				const z = stock(i);
				if (z >= 1) {
					topRanked += 1;
					lowPedigreeTop += isLowPedigree(career.hsRank) ? 1 : 0;
				}
				if (z >= -0.4) {
					candidates += 1;
					unexplained += isOffRadar(radar) ? 1 : 0;
				}
			}
		}
		assert.strictEqual(spy.mock.calls.length, 0);
		spy.mockRestore();
		assert.isAbove(candidates, 200);
		assert.isAtMost(unexplained / candidates, 0.01);
		assert.isAtMost(lowPedigreeTop / topRanked, 0.08);
	});
});
