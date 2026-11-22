import { assert, beforeAll, describe, test } from "vitest";
import { generateCollegeClass } from "./index.ts";
import { makeClass } from "./career.testutil.ts";
import {
	classWord,
	getMoveNote,
	tierDropChance,
	type CareerYear,
} from "./career.ts";
import { COLLEGES, PATHWAY_TEAM } from "./colleges.ts";
import { getSchool } from "./colleges.helpers.ts";
import { getNcaaSchools, getPathwayKeys } from "./generate.ts";
import {
	LEAGUE_ENV,
	OVERSEAS_TIERS,
	PATHWAY_ENV,
	getLeagueEnv,
	getLeagueTier,
	getPreDraftLabel,
	isOverseasLeague,
	type LeagueEnv,
} from "./overseas.ts";
import { adjustRecruitRank, getHeadCoach } from "./profile.ts";
import { Rng, hashString } from "./rng.ts";
import { getPathNote } from "./scoutingReport.ts";
import { simulateSeason } from "./season.ts";
import {
	RATING_KEYS,
	type CollegeProspect,
	type CollegeResult,
	type Ratings,
} from "./types.ts";

// More pre-draft paths (preDraftPaths): the transfer portal, the pro pathway program and overseas tiers

const DRAFT_YEAR = 2030;
const NUM_CLASSES = 40;

type Generated = {
	prospects: CollegeProspect[];
	on: CollegeResult[];
	off: CollegeResult[];
};
const classes: Generated[] = [];
const getClasses = () => {
	if (classes.length === 0) {
		for (let c = 0; c < NUM_CLASSES; c++) {
			const prospects = makeClass(70, `class${c}`);
			const options = { seed: `seed${c}`, draftYear: DRAFT_YEAR };
			classes.push({
				prospects,
				on: generateCollegeClass(prospects, options),
				off: generateCollegeClass(prospects, { ...options, paths: false }),
			});
		}
	}
	return classes;
};

const lastLevel = (result: CollegeResult) => result.career?.years.at(-1)?.level;

// A transfer between Division I schools (not a move up from a junior college, small college, prep year or academy)
const isTransfer = (year: CareerYear) =>
	year.move === "up" || year.move === "down" || year.move === "lateral";

describe("more pre-draft paths", () => {
	beforeAll(() => {
		getClasses();
	}, 120000);

	test("off: exactly what the model generated before", () => {
		// Hashes of whole classes made before preDraftPaths existed
		const expected = [
			"2888518018",
			"589293571",
			"1085206878",
			"3956000019",
			"2531247753",
			"4132320079",
		];
		for (let c = 0; c < expected.length; c++) {
			const results = generateCollegeClass(makeClass(70, `base${c}`), {
				seed: `bseed${c}`,
				draftYear: 2031,
				paths: false,
				// (the hashes predate pre-draft injuries, which have their own switch)
				injuries: false,
				// (and the context model: strength of schedule, class-aware teams, role changes)
				context: false,
			});
			assert.strictEqual(
				String(hashString(JSON.stringify(results))),
				expected[c],
			);
		}
	});

	test("deterministic, and most careers are unchanged", () => {
		const { prospects, on } = getClasses()[0]!;
		const again = generateCollegeClass(prospects, {
			seed: "seed0",
			draftYear: DRAFT_YEAR,
		});
		assert.deepStrictEqual(again, on);

		let same = 0;
		let total = 0;
		for (const c of getClasses()) {
			for (const [i, result] of c.on.entries()) {
				total += 1;
				if (
					JSON.stringify(result.seasons) === JSON.stringify(c.off[i]!.seasons)
				) {
					same += 1;
				}
			}
		}
		assert.isAbove(same / total, 0.82);
	});

	test("shares of college, overseas and other paths stay the same", () => {
		const count = (key: "on" | "off") => {
			const out = { ncaa: 0, pathway: 0, overseas: 0, other: 0, none: 0 };
			for (const c of getClasses()) {
				for (const result of c[key]) {
					const last = result.career?.years.at(-1);
					if (!last) {
						// Did not play
						out.none += 1;
						continue;
					}
					if (last.level === "ncaa") {
						out.ncaa += 1;
					} else if (last.level === "pathway") {
						out.pathway += 1;
					} else if (isOverseasLeague(last.school)) {
						out.overseas += 1;
					} else {
						out.other += 1;
					}
				}
			}
			return out;
		};
		const on = count("on");
		const off = count("off");
		// College players who spent their draft year in the NBL's Next Stars program or with a club abroad instead (routes)
		let routedFromCollege = 0;
		for (const c of getClasses()) {
			for (const [i, result] of c.on.entries()) {
				const route = result.career?.route;
				if (
					(route === "nextStars" || route === "abroad") &&
					lastLevel(c.off[i]!) === "ncaa"
				) {
					routedFromCollege += 1;
				}
			}
		}
		assert.strictEqual(off.pathway, 0);
		assert.strictEqual(on.ncaa + on.pathway + routedFromCollege, off.ncaa);
		// Who goes to college is the same; the rest pick from more leagues (a few more abroad, fewer at prep and youth programs)
		assert.strictEqual(
			on.overseas + on.other + on.none,
			off.overseas + off.other + off.none + routedFromCollege,
		);
		assert.isAtLeast(on.overseas, off.overseas + routedFromCollege);
		assert.isAbove(routedFromCollege, 0);
		assert.isBelow(routedFromCollege, NUM_CLASSES);
	});

	describe("transfer portal", () => {
		test("a realistic share of multi-year college players transfer, for a reason", () => {
			let multi = 0;
			let moved = 0;
			const reasons = { coach: 0, minutes: 0, breakout: 0 };
			let withChange = { n: 0, moved: 0 };
			let withoutChange = { n: 0, moved: 0 };
			for (const c of getClasses()) {
				for (const result of c.on) {
					const years = result.career?.years ?? [];
					const d1 = years.filter(
						(year) => year.level === "ncaa" && year.status !== "redshirt",
					);
					// (not a junior college or small college start, nor its move up to Division I)
					if (
						d1.length < 2 ||
						years.some(
							(year) =>
								year.level === "juco" ||
								year.level === "dii" ||
								year.level === "naia",
						)
					) {
						continue;
					}
					multi += 1;
					const transfers = years.filter(isTransfer);
					if (transfers.length > 0) {
						moved += 1;
					}
					for (const year of transfers) {
						assert.isDefined(year.why);
						reasons[year.why!] += 1;
					}
					// A coaching change at his draft-year school while he could have arrived there
					const school = years.at(-1)!.school;
					const change = years
						.slice(1)
						.some(
							(year) => getHeadCoach(school, year.season).since === year.season,
						);
					const bucket = change ? withChange : withoutChange;
					bucket.n += 1;
					bucket.moved += transfers.length > 0 ? 1 : 0;
					withChange = change ? bucket : withChange;
					withoutChange = change ? withoutChange : bucket;
				}
			}
			assert.isAbove(moved / multi, 0.15);
			assert.isBelow(moved / multi, 0.25);
			assert.isAbove(reasons.coach, 0);
			assert.isAbove(reasons.minutes, 0);
			assert.isAbove(reasons.breakout, 0);
			// A coaching change makes a transfer much more likely
			assert.isAbove(
				withChange.moved / withChange.n,
				1.8 * (withoutChange.moved / withoutChange.n),
			);
		});

		test("a coach transfer is one where a school changed coaches that season", () => {
			for (const c of getClasses()) {
				for (const result of c.on) {
					const years = result.career?.years ?? [];
					for (const [i, year] of years.entries()) {
						if (year.why === "coach") {
							const prev = years[i - 1]!;
							assert(
								getHeadCoach(year.school, year.season).since === year.season ||
									getHeadCoach(prev.school, year.season).since === year.season,
							);
						}
					}
				}
			}
		});

		test("each season line has his school, and the record notes the transfer", () => {
			let checked = 0;
			for (const c of getClasses()) {
				for (const result of c.on) {
					const years = result.career?.years ?? [];
					for (const [i, year] of years.entries()) {
						const season = result.seasons.find((s) => s.season === year.season);
						if (season) {
							assert.strictEqual(season.school, year.school);
						}
						if (isTransfer(year) && year.level === "ncaa") {
							const note = getMoveNote(years[i - 1], year)!;
							assert(
								note.startsWith(
									`Transferred from ${years[i - 1]!.school} to ${year.school} after `,
								),
								note,
							);
							assert.match(note, / after (his [ a-z]+|the \d+) season/);
							checked += 1;
						}
					}
				}
			}
			assert.isAbove(checked, 50);
		});

		test("notes, also for careers stored before reasons and tiers", () => {
			const prev: CareerYear = {
				season: 2028,
				school: "Wofford",
				level: "ncaa",
				cls: "So.",
			};
			const year: CareerYear = {
				season: 2029,
				school: "Duke",
				level: "ncaa",
				cls: "Jr.",
				move: "up",
			};
			assert.strictEqual(
				getMoveNote(prev, year),
				"Transferred from Wofford to Duke after his sophomore season",
			);
			assert.strictEqual(
				getMoveNote(prev, { ...year, why: "breakout" }),
				"Transferred from Wofford to Duke after his sophomore season, after a breakout season",
			);
			assert.strictEqual(
				getMoveNote(
					{ ...prev, cls: "RS Fr." },
					{ ...year, move: "down", why: "minutes" },
				),
				"Transferred from Wofford to Duke after his redshirt freshman season, looking for more playing time",
			);
			assert.strictEqual(
				getMoveNote(prev, { ...year, move: undefined }),
				undefined,
			);
			assert.strictEqual(classWord("RS Jr."), "redshirt junior");
			// Abroad: a move up a tier, the tier read off the league when it was not stored
			assert.strictEqual(
				getMoveNote(
					{ season: 2028, school: "Polish PLK", level: "other" },
					{ season: 2029, school: "EuroLeague", level: "other", move: "up" },
				),
				"Moved up from Polish PLK (mid tier)",
			);
		});
	});

	describe("pro pathway program", () => {
		test("0-2 elite North American freshmen a class (about 0.8 on average), one season, no college", () => {
			const perClass: number[] = [];
			for (const c of getClasses()) {
				const keys = getPathwayKeys(c.prospects, {
					seed: `seed${classes.indexOf(c)}`,
					draftYear: DRAFT_YEAR,
				});
				const inPathway = c.on.filter((r) => lastLevel(r) === "pathway");
				assert.deepStrictEqual(
					inPathway.map((r) => r.key).sort(),
					[...keys].sort(),
				);
				perClass.push(inPathway.length);
				// About how draft stock is measured (pot weighted)
				const stock = (p: CollegeProspect) => 0.4 * p.ovr + 0.6 * p.pot;
				const byStock = [...c.prospects].sort((a, b) => stock(b) - stock(a));
				const top = new Set(
					byStock.slice(0, Math.ceil(0.6 * byStock.length)).map((p) => p.key),
				);
				for (const result of inPathway) {
					const p = c.prospects.find((x) => x.key === result.key)!;
					assert.isAtMost(p.age, 19);
					assert.match(p.bornLoc, /USA$/);
					assert(top.has(p.key), "a good prospect (top half of the class)");
					assert.strictEqual(result.school, PATHWAY_TEAM);
					assert.strictEqual(result.career!.years.length, 1);
					assert.strictEqual(result.seasons.length, 1);
					assert.strictEqual(result.seasons[0]!.school, PATHWAY_TEAM);
					assert.isUndefined(result.career!.story);
					assert.isUndefined(result.ncaa);
					assert.strictEqual(result.career!.hsClass, DRAFT_YEAR - 1);
					// No college or league honors (a youth national team honor is possible)
					assert.deepStrictEqual(
						result.honors.filter(
							(h) => !/youth|u1[6-9]|u2[0-3]|national/i.test(JSON.stringify(h)),
						),
						[],
					);
				}
			}
			assert.isAtMost(Math.max(...perClass), 2);
			const mean = perClass.reduce((a, b) => a + b, 0) / perClass.length;
			assert.isAbove(mean, 0.3, String(mean));
			assert.isBelow(mean, 1.4, String(mean));
			assert.isAtLeast(perClass.filter((x) => x >= 1).length, 1);
		});

		test("pathway players are not in the college season", () => {
			const c = getClasses()[1]!;
			const options = { seed: "seed1", draftYear: DRAFT_YEAR };
			const schools = getNcaaSchools(c.prospects, options);
			for (const result of c.on) {
				if (lastLevel(result) === "pathway") {
					assert.isFalse(schools.has(result.key));
				}
			}
			assert.strictEqual(getPreDraftLabel(PATHWAY_TEAM), "Pro pathway");
			assert.isFalse(isOverseasLeague(PATHWAY_TEAM));
			assert.strictEqual(getLeagueEnv(PATHWAY_TEAM), PATHWAY_ENV);
			assert.isTrue(getSchool(PATHWAY_TEAM)!.nonCollege);
			// None at all without the paths
			assert.strictEqual(
				getPathwayKeys(c.prospects, { ...options, paths: false }).size,
				0,
			);
		});

		test("recruiting: only the very best of a high school class", () => {
			for (let pid = 0; pid < 50; pid++) {
				const rank = adjustRecruitRank({
					pid,
					nationalRank: 80,
					story: undefined,
					jucoStart: false,
					pathway: true,
				})!;
				assert.isAtMost(rank, 25);
				assert.isAtLeast(rank, 1);
			}
		});
	});

	describe("overseas tiers", () => {
		const intlClass = (n: number, seed: string): CollegeProspect[] =>
			makeClass(n, seed).map((p, i) => ({
				...p,
				college: ["EuroLeague", "Adriatic League", "Polish PLK", "Liga ACB"][
					i % 4
				]!,
				bornLoc: "Belgrade, Serbia",
			}));

		test("every season abroad has a tier; he only ever moves up", () => {
			let lowerYoung = 0;
			let young = 0;
			let lowerOld = 0;
			let old = 0;
			for (let c = 0; c < 10; c++) {
				const prospects = intlClass(60, `intl${c}`);
				const results = generateCollegeClass(prospects, {
					seed: `i${c}`,
					draftYear: DRAFT_YEAR,
				});
				for (const [i, result] of results.entries()) {
					const p = prospects[i]!;
					const years = result.career!.years;
					const last = years.at(-1)!;
					if (result.career!.route === "nextStars") {
						// A season in the NBL's Next Stars program instead (routes)
						assert.strictEqual(last.school, "NBL");
						continue;
					}
					assert.strictEqual(last.school, p.college);
					assert.strictEqual(last.tier, getLeagueTier(p.college));
					for (const [j, year] of years.entries()) {
						if (year.level === "academy") {
							// A first season at a youth academy (preDraftPaths): no tier, then a move to a pro club
							assert.strictEqual(j, 0);
							assert.isUndefined(year.tier);
							assert.strictEqual(years[1]!.move, "academy");
							continue;
						}
						assert.include(OVERSEAS_TIERS, year.tier);
						assert.strictEqual(year.tier, getLeagueTier(year.school));
						const season = result.seasons.find(
							(s) => s.season === year.season,
						)!;
						assert.strictEqual(season.school, year.school);
						if (j > 0 && years[j - 1]!.level !== "academy") {
							const prev = years[j - 1]!;
							assert.isAtMost(
								OVERSEAS_TIERS.indexOf(prev.tier!),
								OVERSEAS_TIERS.indexOf(year.tier!),
							);
							if (prev.school !== year.school) {
								assert.strictEqual(year.move, "up");
							}
						}
						if (j < years.length - 1) {
							const age = season.age!;
							const lower = year.tier !== last.tier;
							if (age <= 19) {
								young += 1;
								lowerYoung += lower ? 1 : 0;
							} else if (age >= 21) {
								old += 1;
								lowerOld += lower ? 1 : 0;
							}
						}
					}
				}
			}
			assert.isAbove(young, 50);
			assert.isAbove(old, 50);
			// Younger seasons are much more often in a lower tier
			assert.isAbove(lowerYoung / young, 1.5 * (lowerOld / old));
			assert.isAbove(lowerYoung / young, 0.3);
			assert.isAbove(tierDropChance(18, 0), tierDropChance(22, 0));
			assert.isAbove(tierDropChance(19, -1), tierDropChance(19, 1.5));
		});

		test("a prospect who never moved has the seasons he had before", () => {
			let unchanged = 0;
			for (let c = 0; c < 6; c++) {
				const prospects = intlClass(60, `h${c}`);
				const options = { seed: `h${c}`, draftYear: DRAFT_YEAR };
				const on = generateCollegeClass(prospects, options);
				const off = generateCollegeClass(prospects, {
					...options,
					paths: false,
				});
				for (const [i, result] of on.entries()) {
					if (
						result.career!.years.some((year) => year.move) ||
						result.career!.route
					) {
						continue;
					}
					unchanged += 1;
					assert.deepStrictEqual(result.seasons, off[i]!.seasons);
				}
			}
			assert.isAbove(unchanged, 100);
		});
	});

	describe("stat environments", () => {
		// The same players, season after season, in different places
		const players = (() => {
			const rng = new Rng("env-players");
			return Array.from({ length: 400 }, () => {
				const talent = rng.normal(0, 1);
				const ratings = {} as Ratings;
				for (const key of RATING_KEYS) {
					ratings[key] = Math.max(
						5,
						Math.min(95, 45 + 8 * talent + 8 * rng.normal(0, 1)),
					);
				}
				ratings.hgt = Math.max(0, Math.min(100, 46 + 15 * rng.normal(0, 1)));
				return { ratings, z: 0.8 + 0.6 * talent };
			});
		})();

		const play = (where: {
			school: string;
			strength: number;
			gameMinutes: number;
			proEnv?: LeagueEnv;
			conference?: string;
		}) => {
			let min = 0;
			let gp = 0;
			let pts = 0;
			let fg = 0;
			let fga = 0;
			let fta = 0;
			for (const [i, p] of players.entries()) {
				const season = simulateSeason({
					season: DRAFT_YEAR,
					rng: new Rng(`env${i}`),
					ratings: p.ratings,
					zTalent: p.z,
					classIndex: 0,
					school: where.school,
					conference: where.conference,
					strength: where.strength,
					gameMinutes: where.gameMinutes,
					noise: 1,
					pos: "SF",
					proEnv: where.proEnv,
					age: 19,
				});
				min += season.stats.min!;
				gp += season.stats.gp!;
				pts += season.stats.pts!;
				fg += season.stats.fg!;
				fga += season.stats.fga!;
				fta += season.stats.fta!;
			}
			return {
				mpg: min / gp,
				ppg: pts / gp,
				pts40: (pts / min) * 40,
				fgPct: fg / fga,
				ts: pts / (2 * (fga + 0.44 * fta)),
			};
		};
		const atSchool = (name: string) => {
			const s = getSchool(name)!;
			return play({
				school: name,
				strength: s.strength,
				gameMinutes: s.gameMinutes,
				proEnv: getLeagueEnv(name),
				conference: s.conference,
			});
		};

		test("pro pathway: fewer minutes and lower efficiency than college for the same players", () => {
			const pathway = atSchool(PATHWAY_TEAM);
			// A power conference program and an average Division I one
			for (const college of [atSchool("Duke"), atSchool("Wofford")]) {
				assert.isBelow(pathway.mpg, college.mpg - 2.5);
				assert.isBelow(pathway.fgPct, college.fgPct - 0.015);
				assert.isBelow(pathway.ts, college.ts - 0.01);
				// Per 40 minutes he scores about as much (pros play faster), per game less
				assert.isBelow(pathway.ppg, college.ppg - 1.5);
			}
			// Still a real role: these are the best freshmen in the country
			assert.isAbove(pathway.mpg, 18);
			assert.isTrue(COLLEGES.Duke !== undefined);
		});

		test("overseas tiers: the higher the tier, the fewer minutes and the harder to score", () => {
			const top = atSchool("EuroLeague");
			const mid = atSchool("Adriatic League");
			const dev = atSchool("European Second Division");
			assert.isBelow(top.mpg, mid.mpg);
			assert.isBelow(mid.mpg, dev.mpg);
			assert.isBelow(top.fgPct, mid.fgPct);
			assert.isBelow(mid.fgPct, dev.fgPct);
			assert.isBelow(top.pts40, dev.pts40);
			// A teenager in a top league is a bench player; in a second division, nearly a college starter's minutes
			assert.isBelow(top.mpg, 18);
			assert.isAbove(dev.mpg, 20);
			assert.isDefined(LEAGUE_ENV["European Second Division"]);
		});
	});

	test("scouting report notes", () => {
		assert.match(
			getPathNote({ pathway: true }, PATHWAY_TEAM)!,
			/pro development team/,
		);
		assert.match(
			getPathNote({ transferredFrom: "Wofford" }, "Duke")!,
			/^Transferred in from Wofford, so Duke/,
		);
		assert.match(getPathNote({ tier: "top" }, "Madrid")!, /top tier/);
		assert.match(getPathNote({ tier: "dev" }, "Ourense")!, /development tier/);
		assert.isUndefined(getPathNote(undefined, "Duke"));
	});
});
