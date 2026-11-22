import { assert, beforeAll, describe, test } from "vitest";
import { generateCollegeClass } from "./index.ts";
import { makeClass } from "./career.testutil.ts";
import {
	GAP_NAMES,
	ROUTE_KINDS,
	getRouteText,
	isJuco,
	type RouteKind,
} from "./career.ts";
import {
	ACADEMIES,
	LEAGUE_HOME,
	NON_NCAA,
	OVERSEAS_EXTRA,
	PREP_SCHOOLS,
	SMALL_COLLEGES,
	getLeagueHome,
	getLowerLevel,
} from "./colleges.ts";
import {
	getCountry,
	getRegion,
	homeLeagueFactor,
	pickBlankDestination,
} from "./colleges.helpers.ts";
import { getYouthHonors } from "./honors.ts";
import {
	LEAGUE_ENV,
	PRO_SHORT,
	getLeagueTier,
	getPreDraftLabel,
	isOverseasLeague,
	isProLeague,
	isSchoolLabel,
} from "./overseas.ts";
import { Rng } from "./rng.ts";
import type { CollegeProspect, CollegeResult, CollegeSeason } from "./types.ts";
import { getStashLeague } from "../draftStash.ts";
import { COLLEGE_AWARD_PREFIX } from "../preDraft.ts";

// More pre-draft paths, routes: post-graduate years, academies, small colleges, years away, two-sport athletes, the NBL's Next Stars,
// Americans abroad, more leagues tied to where a prospect was born

const DRAFT_YEAR = 2030;
const NUM_CLASSES = 40;

// Birthplaces like the game's draft classes: mostly American, some Canadians, internationals from everywhere
const PLACES = [
	["Chicago, IL, USA", 70],
	["Toronto, ON, Canada", 5],
	["Belgrade, Serbia", 3],
	["Madrid, Spain", 3],
	["Paris, France", 3],
	["Lagos, Nigeria", 3],
	["Melbourne, Australia", 2],
	["Buenos Aires, Argentina", 2],
	["Tokyo, Japan", 1],
	["Istanbul, Turkey", 2],
	["Kaunas, Lithuania", 2],
	["Dakar, Senegal", 2],
	["Athens, Greece", 2],
] as const;

const makeMixedClass = (n: number, seed: string): CollegeProspect[] => {
	const rng = new Rng(`${seed}|places`);
	return makeClass(n, seed).map((p) => {
		const bornLoc = rng.weighted(
			PLACES.map((x) => x[0]),
			PLACES.map((x) => x[1]),
		);
		const na = bornLoc.endsWith("USA") || bornLoc.endsWith("Canada");
		return {
			...p,
			bornLoc,
			// Internationals mostly have no college (a club is picked for them), North Americans mostly one
			college: na ? p.college : rng.random() < 0.85 ? "" : p.college,
		};
	});
};

type Generated = { prospects: CollegeProspect[]; results: CollegeResult[] };
const classes: Generated[] = [];
const getClasses = () => {
	if (classes.length === 0) {
		for (let c = 0; c < NUM_CLASSES; c++) {
			const prospects = makeMixedClass(70, `routes${c}`);
			classes.push({
				prospects,
				results: generateCollegeClass(prospects, {
					seed: `r${c}`,
					draftYear: DRAFT_YEAR,
				}),
			});
		}
	}
	return classes;
};

const all = () =>
	getClasses().flatMap((c) =>
		c.results.map((result, i) => ({ p: c.prospects[i]!, result })),
	);

describe("pre-draft routes", () => {
	beforeAll(() => {
		getClasses();
	}, 120000);

	test("deterministic", () => {
		const { prospects, results } = getClasses()[0]!;
		assert.deepStrictEqual(
			generateCollegeClass(prospects, { seed: "r0", draftYear: DRAFT_YEAR }),
			results,
		);
	});

	test("each route is a small share, and the unusual ones together a modest minority", () => {
		const counts = new Map<RouteKind, number>();
		let n = 0;
		for (const { result } of all()) {
			n += 1;
			const route = result.career?.route;
			if (route) {
				counts.set(route, (counts.get(route) ?? 0) + 1);
			}
		}
		const share = (kind: RouteKind) => (counts.get(kind) ?? 0) / n;
		const total = [...counts.values()].reduce((a, b) => a + b, 0) / n;
		assert.isAbove(total, 0.01);
		assert.isBelow(total, 0.08);
		for (const kind of ROUTE_KINDS) {
			assert.isBelow(share(kind), 0.025, kind);
		}
		for (const kind of [
			"postgrad",
			"academy",
			"smallCollege",
			"nextStars",
		] as const) {
			assert.isAbove(share(kind), 0, kind);
		}
		// Next Stars 0-2 a class, an American abroad 0-1
		for (const c of getClasses()) {
			const routes = c.results.map((r) => r.career?.route);
			assert.isAtMost(routes.filter((r) => r === "nextStars").length, 2);
			assert.isAtMost(routes.filter((r) => r === "abroad").length, 1);
		}
	});

	test("each route's career looks like it", () => {
		for (const { p, result } of all()) {
			const career = result.career;
			const route = career?.route;
			if (!career || !route) {
				continue;
			}
			const years = career.years;
			const region = getRegion(p.bornLoc);
			const text = getRouteText(route, years, {
				hsClass: career.hsClass,
				school: result.school,
				lastSeason: DRAFT_YEAR,
			});
			assert.isAbove(text.title.length, 0);
			assert.notInclude(text.text, "undefined");
			switch (route) {
				case "postgrad":
					assert.strictEqual(years[0]!.level, "prep");
					assert.include(PREP_SCHOOLS, years[0]!.school);
					assert.strictEqual(years[1]!.move, "prep");
					assert.strictEqual(getPreDraftLabel(years[0]!.school), "Prep");
					assert.isDefined(career.hsClass);
					break;
				case "academy": {
					assert.notInclude(["usa", "canada"], region);
					assert.strictEqual(years[0]!.level, "academy");
					assert(ACADEMIES[years[0]!.school]!.includes(region));
					assert.strictEqual(getPreDraftLabel(years[0]!.school), "Academy");
					assert.strictEqual(years.at(-1)!.level, "ncaa");
					break;
				}
				case "smallCollege": {
					const level = years[0]!.level;
					assert.oneOf(level, ["dii", "naia"]);
					assert.strictEqual(SMALL_COLLEGES[years[0]!.school], level);
					assert.strictEqual(
						getPreDraftLabel(years[0]!.school),
						"Small college",
					);
					assert(years.some((year) => year.move === "small"));
					assert.strictEqual(years.at(-1)!.level, "ncaa");
					// Honors under their own organization's name
					for (const honor of result.honors) {
						assert.notInclude(honor.type, "NJCAA");
					}
					break;
				}
				case "gap":
				case "military":
				case "mission":
					assert.strictEqual(years[0]!.status, "gap");
					assert.strictEqual(years[0]!.school, GAP_NAMES[route]);
					// No games, no stats row
					assert(!result.seasons.some((s) => s.season === years[0]!.season));
					assert.strictEqual(years.at(-1)!.level, "ncaa");
					break;
				case "twoSport":
					assert.strictEqual(region, "usa");
					assert(years.some((year) => year.football));
					assert(!years.at(-1)!.football);
					break;
				case "nextStars":
					assert.strictEqual(result.school, "NBL");
					assert.notStrictEqual(region, "oceania");
					assert.strictEqual(years.length, 1);
					assert.isUndefined(career.story);
					break;
				case "abroad":
					assert.strictEqual(region, "usa");
					assert(isOverseasLeague(result.school));
					assert.strictEqual(years.length, 1);
					assert.isDefined(career.hsClass);
					break;
			}
		}
	});

	test("a prospect picked for a class route never had a story to lose", () => {
		let checked = 0;
		for (const [c, { prospects, results }] of getClasses().entries()) {
			const routed = results.flatMap((result, i) =>
				result.career?.route === "nextStars" ||
				result.career?.route === "abroad"
					? [i]
					: [],
			);
			if (routed.length === 0) {
				continue;
			}
			// Without the paths he is where he was headed, with the story he would have had (stories also style sub-ratings)
			const off = generateCollegeClass(prospects, {
				seed: `r${c}`,
				draftYear: DRAFT_YEAR,
				paths: false,
			});
			for (const i of routed) {
				checked += 1;
				assert.isUndefined(off[i]!.career?.story);
			}
		}
		assert.isAbove(checked, 0);
	});

	test("juco, prep, academy and small college seasons are labeled", () => {
		assert.strictEqual(getPreDraftLabel("Chipola College"), "JUCO");
		assert.strictEqual(getPreDraftLabel("Vincennes University"), "JUCO");
		assert(isJuco("Vincennes University"));
		assert.strictEqual(getPreDraftLabel("JUCO"), "JUCO");
		assert.strictEqual(getPreDraftLabel("IMG Academy"), "Prep");
		assert.strictEqual(getPreDraftLabel("Prep / Postgrad"), "Prep");
		assert.strictEqual(getPreDraftLabel("NBA Academy"), "Academy");
		assert.strictEqual(getPreDraftLabel("Overtime Elite"), "Academy");
		assert.strictEqual(getPreDraftLabel("NAIA"), "Small college");
		assert.strictEqual(getPreDraftLabel("Ferris State"), "Small college");
		assert.strictEqual(getPreDraftLabel("Duke"), "College");
		assert.strictEqual(getPreDraftLabel("LEB Oro"), "Overseas");
		assert.strictEqual(getPreDraftLabel("NBA G League"), "G League");
		for (const label of ["JUCO", "Prep", "Academy", "College"] as const) {
			assert(isSchoolLabel(label));
		}
		assert(!isSchoolLabel("Overseas"));
		assert.strictEqual(getLowerLevel("Duke"), undefined);
	});

	test("youth national team honors only for a standout season at that age", () => {
		const season = (age: number, score: number): CollegeSeason =>
			({
				season: 2028,
				age,
				score,
				strength: 70,
				stats: { gp: 20 },
			}) as unknown as CollegeSeason;
		const rng = new Rng("youth");
		assert.deepStrictEqual(getYouthHonors([season(18, 5)], "europe", rng), []);
		assert.deepStrictEqual(getYouthHonors([season(23, 40)], "europe", rng), []);
		const honors = getYouthHonors([season(18, 40)], "europe", rng);
		assert.deepStrictEqual(
			honors.map((h) => h.type.replace(COLLEGE_AWARD_PREFIX, "")).sort(),
			["FIBA U18 EuroBasket All-Star Five", "FIBA U18 EuroBasket MVP"].sort(),
		);
	});
});

describe("leagues", () => {
	test("every pro league has an environment, a short name and a tier", () => {
		const names = [...Object.keys(NON_NCAA), ...Object.keys(OVERSEAS_EXTRA)];
		const shorts = new Set<string>();
		for (const name of names) {
			if (!isProLeague(name)) {
				continue;
			}
			assert.isDefined(LEAGUE_ENV[name], name);
			const short = PRO_SHORT[name];
			assert.isDefined(short, name);
			// Honors are named by it, so no two leagues share one
			assert(!shorts.has(short!), short);
			shorts.add(short!);
			if (isOverseasLeague(name)) {
				assert.isDefined(getLeagueTier(name), name);
			}
		}
		assert.isAtLeast(shorts.size, 60);
		// Home countries name real leagues
		for (const name of Object.keys(LEAGUE_HOME)) {
			assert.isDefined(NON_NCAA[name], name);
		}
	});

	test("a prospect leans to his own country's league", () => {
		assert.strictEqual(getCountry("Madrid, Spain"), "Spain");
		assert.strictEqual(getCountry("Chicago, IL"), "USA");
		assert.strictEqual(getCountry("Chicago, IL, USA"), "USA");
		assert.isAbove(homeLeagueFactor("Liga ACB", "Spain"), 1);
		assert.isBelow(homeLeagueFactor("Liga ACB", "France"), 1);
		assert.strictEqual(homeLeagueFactor("EuroLeague", "Spain"), 1);
		assert.include(getLeagueHome("LEB Oro"), "Spain");

		const count = (bornLoc: string) => {
			const out = new Map<string, number>();
			const rng = new Rng(bornLoc);
			for (let i = 0; i < 3000; i++) {
				const name = pickBlankDestination(bornLoc, rng, 0, true);
				out.set(name, (out.get(name) ?? 0) + 1);
			}
			return out;
		};
		const spain = count("Madrid, Spain");
		const france = count("Paris, France");
		const domestic = (m: Map<string, number>, country: string) =>
			[...m.entries()]
				.filter(([name]) => getLeagueHome(name).includes(country))
				.reduce((sum, [, x]) => sum + x, 0);
		assert.isAbove(domestic(spain, "Spain"), 2 * domestic(france, "Spain"));
		assert.isAbove(domestic(france, "France"), 2 * domestic(spain, "France"));
		// The paths off pick from the old list only
		const rng = new Rng("off");
		for (let i = 0; i < 500; i++) {
			const name = pickBlankDestination("Madrid, Spain", rng, 0);
			assert(!OVERSEAS_EXTRA[name], name);
		}
	});

	test("a stashed player who outgrew his league moves up a tier", () => {
		const base = {
			pid: 1,
			season: 2031,
			bornLoc: "Madrid, Spain",
		};
		assert.strictEqual(
			getStashLeague({ ...base, league: "LEB Oro", ovr: 40 }),
			"LEB Oro",
		);
		const moved = getStashLeague({ ...base, league: "LEB Oro", ovr: 46 });
		assert.strictEqual(getLeagueTier(moved), "mid");
		assert.strictEqual(
			getStashLeague({ ...base, league: "LEB Oro", ovr: 46 }),
			moved,
		);
		assert.strictEqual(
			getStashLeague({ ...base, league: "EuroLeague", ovr: 60 }),
			"EuroLeague",
		);
		assert.strictEqual(
			getLeagueTier(getStashLeague({ ...base, league: "Polish PLK", ovr: 55 })),
			"top",
		);
	});
});
