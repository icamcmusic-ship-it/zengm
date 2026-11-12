import { assert, beforeAll, describe, test } from "vitest";
import { generateCollegeClass, getClassIndex } from "./index.ts";
import {
	JUCOS,
	STORY_KINDS,
	getStoryText,
	isJuco,
	type CareerYear,
} from "./career.ts";
import { COLLEGES } from "./colleges.ts";
import { makeClass } from "./career.testutil.ts";
import { getNcaaSchools } from "./generate.ts";
import { getProspectBoost, simulateNcaaSeason } from "./ncaa.ts";
import type { CollegeProspect, CollegeResult } from "./types.ts";

const DRAFT_YEAR = 2030;
const NUM_CLASSES = 50;

const classes: { prospects: CollegeProspect[]; results: CollegeResult[] }[] =
	[];
const getClasses = () => {
	if (classes.length === 0) {
		for (let c = 0; c < NUM_CLASSES; c++) {
			const prospects = makeClass(70, `class${c}`);
			classes.push({
				prospects,
				results: generateCollegeClass(prospects, {
					seed: `seed${c}`,
					draftYear: DRAFT_YEAR,
				}),
			});
		}
	}
	return classes;
};

const all = () =>
	getClasses().flatMap(({ prospects, results }) =>
		results.map((result, i) => ({ p: prospects[i]!, result })),
	);

const mpg = (season: { stats: Record<string, number> }) =>
	season.stats.min! / Math.max(1, season.stats.gp!);

describe("career model", () => {
	beforeAll(() => {
		getClasses();
	}, 120000);

	test("deterministic, and does not change the prospects", () => {
		const prospects = makeClass(70, "det");
		const copy = structuredClone(prospects);
		const a = generateCollegeClass(prospects, { seed: "x", draftYear: 2030 });
		const b = generateCollegeClass(prospects, { seed: "x", draftYear: 2030 });
		assert.deepStrictEqual(a, b);
		// Ratings, age and everything else the pro game reads are untouched
		assert.deepStrictEqual(prospects, copy);
		const c = generateCollegeClass(prospects, { seed: "y", draftYear: 2030 });
		assert.notDeepEqual(
			a.map((x) => x.career),
			c.map((x) => x.career),
		);
	});

	test("a prospect's career does not depend on who else is in the class beyond the class's talent scale", () => {
		const prospects = makeClass(70, "sub");
		const full = generateCollegeClass(prospects, {
			seed: "x",
			draftYear: 2030,
		});
		// Same class statistics (the same prospects), different order
		const reversed = generateCollegeClass([...prospects].reverse(), {
			seed: "x",
			draftYear: 2030,
		}).reverse();
		assert.deepStrictEqual(
			full.map((x) => x.career),
			reversed.map((x) => x.career),
		);
	});

	test("years are consecutive, one school a season, and match the stats seasons", () => {
		for (const { p, result } of all()) {
			const career = result.career;
			if (!career) {
				assert.strictEqual(result.seasons.length, 0);
				continue;
			}
			const years = career.years;
			assert.isAbove(years.length, 0);
			assert.strictEqual(years.at(-1)!.season, DRAFT_YEAR);
			// The pre-draft window is the draft year and five seasons before it
			assert.isAtLeast(years[0]!.season, DRAFT_YEAR - 5);
			for (const [i, year] of years.entries()) {
				// Consecutive: exactly one entry (so one school) for every season
				assert.strictEqual(year.season, years[0]!.season + i);
			}
			// The draft year school is his own school, never a redshirt year
			assert.strictEqual(years.at(-1)!.school, result.school);
			assert.notStrictEqual(years.at(-1)!.status, "redshirt");
			if (p.college !== "") {
				assert.strictEqual(result.school, p.college);
			}

			const played = years.filter((year) => year.status !== "redshirt");
			assert.deepStrictEqual(
				result.seasons.map((s) => [s.season, s.school]),
				played.map((year) => [year.season, year.school]),
			);
			for (const season of result.seasons) {
				const s = season.stats;
				// Ages follow from his age in the draft year
				assert.strictEqual(season.age, p.age - (DRAFT_YEAR - season.season));
				assert.isAtLeast(season.age!, 16);
				assert.isAbove(s.gp!, 0);
				assert.isAtMost(s.gp!, season.teamGames);
				assert.isAtMost(s.gs!, s.gp!);
				assert.isAtLeast(s.min!, 0);
				assert.isAtMost(s.fg!, s.fga!);
				assert.isAtMost(s.tp!, s.tpa!);
				assert.isAtMost(s.ft!, s.fta!);
				assert.strictEqual(
					s.pts,
					2 * (s.fg! - s.tp!) + 3 * s.tp! + s.ft!,
					"points add up",
				);
			}
			// College players are at least 17 in their first year
			if (years[0]!.level !== "other") {
				assert.isAtLeast(p.age - (DRAFT_YEAR - years[0]!.season), 17);
			}
		}
	});

	test("eligibility: class years, redshirts, medical redshirts and junior college", () => {
		const CLASS_ORDER = ["Fr.", "So.", "Jr.", "Sr.", "Gr."];
		let numRedshirt = 0;
		let numMedical = 0;
		let numJuco = 0;
		for (const { p, result } of all()) {
			const years = result.career?.years ?? [];
			if (!years.some((year) => year.level !== "other")) {
				for (const year of years) {
					assert.isUndefined(year.cls);
					assert(year.status === undefined || year.status === "injury");
				}
				continue;
			}
			let elig = 0;
			let redshirted = false;
			let jucoYears = 0;
			let seenD1 = false;
			for (const [i, year] of years.entries()) {
				assert.notStrictEqual(year.level, "other");
				// The label is his eligibility year, "RS" once a year did not count
				assert.strictEqual(
					year.cls,
					`${redshirted ? "RS " : ""}${CLASS_ORDER[Math.min(elig, 4)]}`,
				);
				const season = result.seasons.find((s) => s.season === year.season);
				if (year.level === "juco") {
					jucoYears += 1;
					assert(!seenD1, "junior college comes before Division I");
					assert(isJuco(year.school));
					assert.isUndefined(COLLEGES[year.school]);
					assert.isUndefined(season!.conference);
				} else {
					seenD1 = true;
					assert(COLLEGES[year.school], year.school);
				}
				if (year.status === "redshirt") {
					// No games, and the year does not count
					assert.isUndefined(season);
					assert.strictEqual(i, 0, "a redshirt year is his first year");
					redshirted = true;
				} else if (year.status === "medical") {
					// A few games at the start of the season (the rule is 30% of the season)
					assert.isAtMost(season!.stats.gp!, 9);
					assert.isBelow(i, years.length - 1);
					redshirted = true;
				} else {
					elig += 1;
				}
			}
			// Four seasons of eligibility; a fifth year only with a year that did not count
			assert.isAtMost(elig, 4);
			assert.isAtMost(years.length, redshirted ? 5 : 4);
			assert.isAtMost(jucoYears, 2);
			if (jucoYears > 0) {
				assert.isBelow(jucoYears, years.length, "ends at a Division I school");
				assert.strictEqual(years[jucoYears]!.move, "juco");
				numJuco += 1;
			}
			if (years.some((year) => year.status === "redshirt")) {
				numRedshirt += 1;
			}
			if (years.some((year) => year.status === "medical")) {
				numMedical += 1;
			}
			// A plain career has as many years as his class year says: the one his age says, or one fewer for a prospect with high draft stock (an older freshman, getClassIndexForStock)
			if (p.age <= 22) {
				assert.include(
					[getClassIndex(p.age) + 1, Math.max(1, getClassIndex(p.age))],
					years.length,
				);
			}
		}
		const n = all().length;
		// Shares of the whole class
		assert.isAbove(numRedshirt / n, 0.02);
		assert.isBelow(numRedshirt / n, 0.1);
		assert.isAbove(numMedical / n, 0.003);
		assert.isBelow(numMedical / n, 0.04);
		assert.isAbove(numJuco / n, 0.01);
		assert.isBelow(numJuco / n, 0.06);
	});

	test("transfers: between seasons, to a different school, more often for upperclassmen", () => {
		const byAge = new Map<number, { n: number; transfers: number }>();
		const kinds = { up: 0, down: 0, lateral: 0 };
		for (const { p, result } of all()) {
			const years = result.career?.years ?? [];
			if (!years.some((year) => year.level === "ncaa")) {
				continue;
			}
			let moved = false;
			for (let i = 1; i < years.length; i++) {
				const year = years[i]!;
				const prev = years[i - 1]!;
				if (year.move) {
					assert.notStrictEqual(year.school, prev.school);
					if (year.move !== "juco") {
						moved = true;
						kinds[year.move] += 1;
						assert.strictEqual(prev.level, "ncaa");
					}
				} else {
					assert.strictEqual(year.school, prev.school);
				}
			}
			assert.isUndefined(years[0]!.move);
			// No school twice with another in between
			const stints = years.filter(
				(year, i) => i === 0 || year.school !== years[i - 1]!.school,
			);
			assert.strictEqual(
				new Set(stints.map((year) => year.school)).size,
				stints.length,
			);
			const entry = byAge.get(p.age) ?? { n: 0, transfers: 0 };
			entry.n += 1;
			entry.transfers += moved ? 1 : 0;
			byAge.set(p.age, entry);
		}
		const share = (age: number) =>
			byAge.get(age)!.transfers / byAge.get(age)!.n;
		assert.strictEqual(share(19), 0);
		assert.isAbove(share(20), 0.07);
		assert.isBelow(share(20), 0.2);
		assert.isAbove(share(21), share(20));
		assert.isAbove(share(22), share(21));
		assert.isBelow(share(22), 0.45);
		assert.isAbove(kinds.up, 0);
		assert.isAbove(kinds.down, 0);
		assert.isAbove(kinds.lateral, 0);
	});

	test("transfers show in the stats: buried before a down-transfer, more minutes after", () => {
		let before = 0;
		let after = 0;
		let n = 0;
		for (const { result } of all()) {
			const years = result.career?.years ?? [];
			const i = years.findIndex((year) => year.move === "down");
			if (i < 1 || result.career?.story) {
				continue;
			}
			const a = result.seasons.find((s) => s.season === years[i - 1]!.season);
			const b = result.seasons.find((s) => s.season === years[i]!.season);
			if (a && b && years[i - 1]!.status === undefined) {
				before += mpg(a);
				after += mpg(b);
				n += 1;
			}
		}
		assert.isAbove(n, 20);
		assert.isAbove(after / n, before / n + 5);
	});

	test("a small, seeded share of each class is unusual, of every kind", () => {
		const counts = new Map<string, number>();
		let total = 0;
		let withStory = 0;
		let classesWithStory = 0;
		for (const { results } of getClasses()) {
			let inClass = 0;
			for (const result of results) {
				total += 1;
				const story = result.career?.story;
				if (story) {
					assert.include(STORY_KINDS, story);
					inClass += 1;
					counts.set(story, (counts.get(story) ?? 0) + 1);
				}
			}
			withStory += inClass;
			classesWithStory += inClass > 0 ? 1 : 0;
			// Never a class full of them
			assert.isAtMost(inClass, 0.25 * results.length);
		}
		assert.isAbove(withStory / total, 0.04);
		assert.isBelow(withStory / total, 0.13);
		assert.isAbove(classesWithStory / NUM_CLASSES, 0.9);
		// The makeClass heights rarely reach 7'3", see the next test for the project
		for (const kind of STORY_KINDS) {
			if (kind !== "project") {
				assert.isAbove(counts.get(kind) ?? 0, 0, kind);
			}
		}
	});

	test("a 7'3\" prospect can be the project, from his listed height", () => {
		let projects = 0;
		for (let c = 0; c < 20; c++) {
			const prospects = makeClass(40, `tall${c}`).map((p, i) =>
				i === 0
					? {
							...p,
							heightInches: 88,
							ratings: { ...p.ratings, hgt: 82, oiq: 30 },
						}
					: { ...p, heightInches: 78 },
			);
			const results = generateCollegeClass(prospects, {
				seed: `t${c}`,
				draftYear: DRAFT_YEAR,
			});
			projects += results[0]!.career?.story === "project" ? 1 : 0;
			for (const result of results.slice(1)) {
				assert.notStrictEqual(result.career?.story, "project");
			}
		}
		assert.isAbove(projects, 5);
		assert.isBelow(projects, 18);
	});

	test("an unusual prospect's career reflects his story", () => {
		const first = (result: CollegeResult) => result.seasons[0]!;
		const last = (result: CollegeResult) => result.seasons.at(-1)!;
		const stories = new Map<
			string,
			{ p: CollegeProspect; result: CollegeResult }[]
		>();
		for (const entry of all()) {
			const story = entry.result.career?.story;
			if (story) {
				stories.set(story, [...(stories.get(story) ?? []), entry]);
			}
		}
		const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

		// Late bloomer: a senior who barely played early
		const late = stories.get("lateBloomer")!;
		for (const { p, result } of late) {
			assert.isAtLeast(p.age, 22);
			assert.isAtLeast(result.seasons.length, 2);
		}
		assert.isAbove(
			mean(late.map(({ result }) => mpg(last(result)))),
			// +7: since the colstats round minutes are lower overall, so there is less room above the bench minutes he started with
			mean(late.map(({ result }) => mpg(first(result)))) + 7,
		);
		assert.isBelow(mean(late.map(({ result }) => mpg(first(result)))), 16);

		// Unranked riser: good now, little early
		const unranked = stories.get("unranked")!;
		assert.isAbove(
			mean(unranked.map(({ result }) => mpg(last(result)))),
			mean(unranked.map(({ result }) => mpg(first(result)))) + 4,
		);

		// Bust: more minutes as a freshman than his talent got him later
		const bust = stories.get("bust")!;
		for (const { result } of bust) {
			assert.isAtLeast(result.seasons.length, 2);
			assert.strictEqual(result.career!.years[0]!.level, "ncaa");
		}

		assert.isAbove(
			mean(bust.map(({ result }) => mpg(first(result)))),
			mean(bust.map(({ result }) => mpg(last(result)))) + 2,
		);

		// Injury: a short draft year season
		for (const { result } of stories.get("injury")!) {
			assert.isAtMost(last(result).stats.gp!, 15);
			assert.strictEqual(result.career!.years.at(-1)!.status, "injury");
		}

		// Older international: a pro abroad for years
		for (const { p, result } of stories.get("olderIntl")!) {
			assert.isAtLeast(p.age, 22);
			assert.isAtLeast(result.seasons.length, 5);
			assert.strictEqual(result.career!.years[0]!.level, "other");
			assert.isUndefined(result.career!.hsClass);
		}

		// Reclassified: a freshman
		for (const { p, result } of stories.get("reclass")!) {
			assert.isAtMost(p.age, 19);
			assert.strictEqual(result.seasons.length, 1);
		}

		// Small school scorer: carries the offense
		const small = stories.get("smallSchoolScorer")!;
		const usage = (s: CollegeResult["seasons"][number]) =>
			(s.stats.fga! + 0.44 * s.stats.fta! + s.stats.tov!) / s.stats.min!;
		const others = all().filter(
			({ result }) => !result.career?.story && result.seasons.length > 0,
		);
		assert.isAbove(
			mean(small.map(({ result }) => usage(last(result)))),
			mean(others.map(({ result }) => usage(last(result)))) * 1.15,
		);

		// Every story has a line
		for (const kind of STORY_KINDS) {
			const text = getStoryText(kind, {
				hsClass: 2026,
				recruitRank: 7,
				heightInches: 88,
				ageAtDraft: 22,
				school: "Albany",
				conference: "America East",
				firstSeason: 2025,
				firstAge: 17,
				lastGp: 9,
				lastSeason: 2030,
			});
			assert.isAbove(text.title.length, 5);
			assert.isAbove(text.text.length, 40);
			assert.notMatch(text.text, /undefined|NaN/);
		}
	});

	test("junior college seasons: a list of schools that are not NCAA programs, big numbers", () => {
		assert.isAbove(JUCOS.length, 30);
		for (const name of JUCOS) {
			assert.isUndefined(COLLEGES[name]);
		}
		let juco = 0;
		let n = 0;
		for (const { result } of all()) {
			for (const [i, year] of (result.career?.years ?? []).entries()) {
				if (year.level === "juco") {
					const season = result.seasons.find((s) => s.season === year.season)!;
					juco += mpg(season);
					n += 1;
					assert.isAtMost(season.teamGames, 34);
					assert.strictEqual(
						result.career!.years[i + 1]!.level === "juco" ||
							result.career!.years[i + 1]!.move === "juco",
						true,
					);
				}
			}
			for (const honor of result.honors) {
				if (honor.type.includes("NJCAA")) {
					const year = result.career!.years.find(
						(y: CareerYear) => y.season === honor.season,
					)!;
					assert.strictEqual(year.level, "juco");
				}
			}
		}
		assert.isAbove(n, 30);
		assert.isAbove(juco / n, 22);
	});

	test("with the college season: the draft year school is the simulated one, an injured prospect misses the postseason", () => {
		let checked = 0;
		let injured = 0;
		for (let c = 0; c < 12; c++) {
			const prospects = makeClass(70, `ncaa${c}`);
			const options = { seed: `n${c}`, draftYear: DRAFT_YEAR };
			const schools = getNcaaSchools(prospects, options);
			const ncaaSeason = simulateNcaaSeason({
				seed: options.seed,
				season: DRAFT_YEAR,
				contributions: [...schools].map(([key, school]) => ({
					key,
					school,
					boost: getProspectBoost(0),
				})),
			});
			const results = generateCollegeClass(prospects, {
				...options,
				ncaaSeason,
			});
			// Careers are the same with or without the college season
			const plain = generateCollegeClass(prospects, options);
			assert.deepStrictEqual(
				results.map((x) => x.career),
				plain.map((x) => x.career),
			);
			for (const result of results) {
				if (!result.ncaa) {
					continue;
				}
				checked += 1;
				const lastYear = result.career!.years.at(-1)!;
				assert.strictEqual(result.ncaa.school, lastYear.school);
				assert.strictEqual(schools.get(result.key), lastYear.school);
				const last = result.seasons.at(-1)!;
				const team = ncaaSeason.teams.find(
					(t) => t.school === result.ncaa!.school,
				)!;
				assert.strictEqual(last.teamGames, team.w + team.l);
				if (lastYear.status === "injury") {
					injured += 1;
					assert.strictEqual(result.ncaa.games.length, 0);
					assert.isAtMost(last.stats.gp!, 15);
					assert.strictEqual(
						result.ncaa.splits!.nonConf.gp + result.ncaa.splits!.conf.gp,
						last.stats.gp,
					);
					assert.strictEqual(
						result.honors.filter((h) => /Tournament|NCAA Champion/.test(h.type))
							.length,
						0,
					);
				}
			}
		}
		assert.isAbove(checked, 400);
		assert.isAbove(injured, 3);
	});

	test("without prior seasons there is only the draft year, and no story", () => {
		const results = generateCollegeClass(makeClass(70, "noprior"), {
			seed: "x",
			draftYear: DRAFT_YEAR,
			priorSeasons: false,
		});
		for (const result of results) {
			assert.isAtMost(result.seasons.length, 1);
			assert.isAtMost(result.career?.years.length ?? 0, 1);
			assert.isUndefined(result.career?.story);
		}
	});
});
