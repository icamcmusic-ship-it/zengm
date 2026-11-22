// Strengths & weaknesses (skills.ts): each kind of item fires on its evidence, tiers and wording scale, dedupe, trends, evidence depth,
// scout voices and dissent, hedging, and the no visible ratings rules. Pure, deterministic.
import { assert, describe, test } from "vitest";
import {
	buildPeerTable,
	buildReport,
	categoryScores,
	getDepartment,
	GRADE_KEYS,
	ordinal,
	skillCandidates,
	tierOf,
	withArticle,
	type GradeRow,
	type ScoutInput,
	type ScoutRatings,
	type SkillSeasonLine,
	type SkillSignals,
} from "./index.ts";

const ratings = (x: Partial<ScoutRatings> = {}): ScoutRatings => ({
	hgt: 50,
	stre: 50,
	spd: 50,
	jmp: 50,
	endu: 50,
	ins: 50,
	dnk: 50,
	ft: 50,
	fg: 50,
	tp: 50,
	oiq: 50,
	diq: 50,
	drb: 50,
	pss: 50,
	reb: 50,
	ovr: 46,
	pot: 58,
	...x,
});

const season = (x: Partial<SkillSeasonLine> = {}): SkillSeasonLine => ({
	season: 2030,
	age: 19,
	level: "college",
	strength: 75,
	gp: 32,
	min: 960,
	pts: 420,
	orb: 40,
	drb: 120,
	ast: 90,
	tov: 70,
	stl: 35,
	blk: 15,
	pf: 80,
	fg: 150,
	fga: 330,
	tp: 45,
	tpa: 130,
	ft: 75,
	fta: 100,
	rimA: 0,
	rim: 0,
	postA: 0,
	post: 0,
	midA: 0,
	mid: 0,
	ba: 10,
	...x,
});

const signals = (x: Partial<SkillSignals> = {}): SkillSignals => ({
	seasons: [season()],
	hand: "right",
	...x,
});

const SCALE = {
	franchise: 70,
	allStar: 62,
	qualityStarter: 57,
	starter: 52,
	rotation: 47,
	bench: 42,
};

const input = (x: Partial<ScoutInput> = {}): ScoutInput => ({
	pid: 11,
	name: "Test Prospect",
	kind: "prospect",
	pos: "SF",
	age: 19,
	heightInches: 79,
	weight: 210,
	season: 2030,
	ratings: ratings(),
	proSeasons: 0,
	injuries: [],
	uncertainty: 2,
	draft: { year: 2030, round: 0, pick: 0 },
	numPicks: 60,
	salaryCap: 140000,
	awards: { allStar: 0, allLeague: 0, mvp: 0, dpoy: 0, champ: 0, roy: 0 },
	expandedRatings: false,
	comps: [],
	roleScale: SCALE,
	onUserTeam: false,
	skills: signals(),
	...x,
});

const peers = () => {
	const rows = [];
	for (let i = 0; i < 60; i++) {
		const v = 30 + i;
		rows.push(
			categoryScores({
				ratings: ratings({
					tp: v,
					fg: v,
					ft: v,
					spd: 90 - v,
					jmp: v,
					ins: v,
					dnk: v,
					pss: v,
					drb: v,
					diq: 90 - v,
					oiq: v,
					hgt: v,
					reb: v,
					endu: v,
					stre: v,
				}),
				production: undefined,
				group: "wing",
			}),
		);
	}
	return buildPeerTable("test class", rows, "wing");
};

const dept = (level = 60, season = 2030) =>
	getDepartment({
		leagueSeed: "seed",
		tid: 0,
		season,
		level,
		startingSeason: 2025,
	});

const report = (x: Partial<ScoutInput> = {}, leadId?: number) =>
	buildReport({
		input: input(x),
		peers: peers(),
		dept: dept(),
		numTeams: 30,
		leadId,
	});

// Grades with every key at the same level (for candidate tests)
const flatTake = (grade = 6, over: Partial<Record<string, number>> = {}) => {
	const grades = GRADE_KEYS.map(
		(key) =>
			({
				key,
				label: key,
				grade: over[key] ?? grade,
				lo: over[key] ?? grade,
				hi: over[key] ?? grade,
				score: 50,
				line: "",
			}) as GradeRow,
	);
	const scores = Object.fromEntries(GRADE_KEYS.map((k) => [k, 50])) as any;
	return { grades, scores };
};

const cands = (
	x: Partial<ScoutInput> = {},
	over: Partial<Record<string, number>> = {},
) => skillCandidates(input(x), flatTake(6, over));

const has = (list: ReturnType<typeof cands>, key: string) =>
	list.some((c) => c.key === key && c.m > 0);

describe("helpers", () => {
	test("tiers, ordinals, articles", () => {
		assert.strictEqual(tierOf("strength", 2.5), "elite");
		assert.strictEqual(tierOf("strength", 1.6), "plus");
		assert.strictEqual(tierOf("strength", 1), "average");
		assert.strictEqual(tierOf("weakness", 2.5), "major");
		assert.strictEqual(tierOf("weakness", 1.6), "minus");
		assert.strictEqual(tierOf("weakness", 1), "average");
		assert.strictEqual(ordinal(21), "21st");
		assert.strictEqual(ordinal(12), "12th");
		assert.strictEqual(ordinal(3), "3rd");
		assert.strictEqual(withArticle("All-Star"), "an All-Star");
		assert.strictEqual(withArticle("starting wing"), "a starting wing");
		assert.strictEqual(withArticle("out of the league"), "out of the league");
	});
});

describe("items", () => {
	test("situational: transition, half court, big games and fades", () => {
		assert(
			has(
				cands({}, { ath: 12, fin: 10, pd: 10, od: 3, shoot: 3 }),
				"transition",
			),
		);
		assert(
			has(
				cands({}, { ath: 12, fin: 10, pd: 10, od: 3, shoot: 3 }),
				"halfCourt",
			),
		);
		const strongGames = [1, 2, 3].map(() => ({
			event: "ncaa" as const,
			strong: true,
			won: true,
			min: 34,
			pts: 26,
			fg: 10,
			fga: 17,
			tp: 3,
			tpa: 6,
			gmsc: 24,
		}));
		const big = cands({ skills: signals({ games: strongGames }) });
		assert(has(big, "bigGame"));
		const weakGames = strongGames.map((g) => ({ ...g, pts: 6, gmsc: 2 }));
		assert(has(cands({ skills: signals({ games: weakGames }) }), "fades"));
	});

	test("consistency: streaky splits, NBA range vs limited, the jumper is real vs a mirage", () => {
		const split = (tp: number, tpa: number) => ({
			gp: 14,
			min: 420,
			pts: 180,
			orb: 15,
			drb: 50,
			ast: 40,
			stl: 15,
			blk: 5,
			tov: 30,
			fg: 60,
			fga: 140,
			tp,
			tpa,
			ft: 40,
			fta: 50,
			pf: 35,
		});
		const streaky = cands({
			skills: signals({
				splits: { nonConf: split(30, 62), conf: split(14, 64) },
			}),
		});
		const s = streaky.find((c) => c.key === "streaky");
		assert.isDefined(s);
		assert(
			s!.evidence.some((e) => e.src === "splits" && e.text.includes("Nov-Dec")),
		);
		assert(!has(streaky, "steadyShooter"));

		assert(
			has(
				cands(
					{ skills: signals({ seasons: [season({ tpa: 260, tp: 102 })] }) },
					{ cs: 11 },
				),
				"nbaRange",
			),
		);
		assert(
			has(
				cands(
					{ skills: signals({ seasons: [season({ tpa: 30, tp: 8 })] }) },
					{ cs: 3 },
				),
				"limitedRange",
			),
		);

		const real = cands({
			skills: signals({
				seasons: [season({ ft: 88, fta: 100, tp: 38, tpa: 130 })],
			}),
		});
		assert(has(real, "jumperReal"));
		const mirage = cands({
			skills: signals({
				seasons: [season({ ft: 58, fta: 100, tp: 54, tpa: 130 })],
			}),
		});
		assert(has(mirage, "mirage"));
	});

	test("mechanics: release, handedness, contact", () => {
		assert(
			has(
				cands({ ratings: ratings({ ft: 80, tp: 40 }) }, { cs: 5 }),
				"slowRelease",
			),
		);
		const lefty = cands(
			{ skills: signals({ hand: "left" }), ratings: ratings({ drb: 35 }) },
			{ pm: 4 },
		);
		assert(has(lefty, "forcedRight"));
		assert(
			!has(
				cands({ skills: signals({ hand: "right" }) }, { pm: 4 }),
				"forcedRight",
			),
		);
		// Handedness alone never reaches a major concern
		assert.isBelow(lefty.find((c) => c.key === "forcedRight")!.m, 2.35);
		assert(
			has(
				cands({
					skills: signals({ seasons: [season({ fta: 220, ft: 160 })] }),
				}),
				"throughContact",
			),
		);
		assert(
			has(
				cands({ skills: signals({ seasons: [season({ fta: 30, ft: 20 })] }) }),
				"avoidsContact",
			),
		);
	});

	test("feel and defense", () => {
		assert(has(cands({}, { iq: 2, pm: 4 }), "lateReads"));
		assert(
			has(
				cands({
					skills: signals({ seasons: [season({ ast: 150, tov: 160 })] }),
				}),
				"forcesPasses",
			),
		);
		assert(
			has(
				cands({
					skills: signals({
						seasons: [season({ ast: 40, fga: 520, fg: 220, pts: 560 })],
					}),
				}),
				"huntsShot",
			),
		);
		assert(
			has(
				cands({
					skills: signals({ seasons: [season({ stl: 110, pf: 140 })] }),
				}),
				"gambles",
			),
		);
		const big = cands({
			pos: "C",
			skills: signals({ seasons: [season({ pf: 160, blk: 60 })] }),
		});
		assert(has(big, "foulProne"));
		assert.strictEqual(big.find((c) => c.key === "foulProne")!.fixable, true);
		assert(has(cands({ pos: "C" }, { pd: 2, ath: 2 }), "pnrTarget"));
		assert(
			has(cands({ pos: "PF" }, { pd: 10, ath: 10, id: 9, size: 9 }), "switch"),
		);
	});

	test("physical projection: frame, maxed out, growth spurt, length", () => {
		assert(has(cands({ age: 19, weight: 185, heightInches: 80 }), "frame"));
		assert(has(cands({ age: 23, weight: 260, heightInches: 78 }), "maxedOut"));
		assert(
			has(
				cands({ skills: signals({ combine: { heightVsListed: 2 } }) }),
				"growthSpurt",
			),
		);
		assert(
			has(cands({ skills: signals({ combine: { apeIndex: 7 } }) }), "length"),
		);
		assert(
			has(
				cands({ skills: signals({ combine: { apeIndex: -2 } }) }),
				"shortArms",
			),
		);
	});

	test("motor and character only from scouted ranges, against his class", () => {
		const t = (
			key: string,
			low: number,
			high: number,
			hidden = false,
			exact = false,
		) => ({
			key,
			name: key,
			hidden,
			estimate: hidden && !exact ? 50 : (low + high) / 2,
			low: hidden && !exact ? 0 : low,
			high: hidden && !exact ? 100 : high,
			exact,
		});
		assert(has(cands({ traits: [t("hustle", 66, 80)] }), "playsHard"));
		assert(has(cands({ traits: [t("hustle", 10, 25)] }), "coasts"));
		// Reads low next to the league, but high for his class
		assert(
			has(
				cands({
					traits: [t("hustle", 45, 55)],
					skills: signals({ traitCenters: { hustle: 32 } }),
				}),
				"playsHard",
			),
		);
		// A combine coaster
		assert(
			has(cands({ skills: signals({ combine: { effort: 0.7 } }) }), "coasts"),
		);
		// An unknown hidden trait says nothing; a known one counts
		assert(!has(cands({ traits: [t("leadership", 0, 100, true)] }), "leader"));
		assert(
			has(cands({ traits: [t("leadership", 75, 75, true, true)] }), "leader"),
		);
		assert(has(cands({ traits: [t("temper", 70, 84)] }), "bodyLanguage"));
	});

	test("role translation: post scorer without size, day-one skill, needs the ball", () => {
		assert(
			has(
				cands({
					pos: "PF",
					heightInches: 77,
					skills: signals({
						seasons: [season({ postA: 120, post: 60, fga: 330 })],
					}),
				}),
				"postNoSize",
			),
		);
		assert(has(cands({}, { cs: 12 }), "dayOne"));
		const ball = skillCandidates(
			input({
				skills: signals({
					seasons: [season({ fga: 560, fta: 200, tov: 120 })],
				}),
			}),
			flatTake(6, { cs: 3 }),
			70,
		);
		assert(has(ball, "needsBall"));
	});
});

describe("the report section", () => {
	test("3-4 strengths, 2-3 weaknesses, a swing skill, no overlap, stable", () => {
		for (const pid of [1, 2, 3, 4, 5, 6, 7, 8]) {
			const a = report({ pid });
			const b = report({ pid });
			assert.deepStrictEqual(a.skills, b.skills);
			const k = a.skills!;
			assert.isAtLeast(k.strengths.length, 3);
			assert.isAtMost(k.strengths.length, 4);
			assert.isAtLeast(k.weaknesses.length, 2);
			assert.isAtMost(k.weaknesses.length, 3);
			const keys = [...k.strengths, ...k.weaknesses].map((x) => x.key);
			assert.strictEqual(new Set(keys).size, keys.length);
			assert.match(k.swing.text, /swing|hinges/i);
			for (const x of k.weaknesses) {
				assert.match(x.fix!.text, /^(Fixable|Structural)/);
			}
		}
	});

	test("no skills section for pros or without signals", () => {
		assert.isUndefined(report({ skills: undefined }).skills);
		assert.isUndefined(report({ kind: "pro" }).skills);
	});

	test("evidence depth and certainty follow how well we know him", () => {
		const sure = report({ uncertainty: 0.5 }).skills!;
		const unsure = report({ uncertainty: 9 }).skills!;
		assert.strictEqual(sure.certainty, "confident");
		assert.strictEqual(unsure.certainty, "hedged");
		const maxEv = (k: typeof sure) =>
			Math.max(
				...[...k.strengths, ...k.weaknesses].map((x) => x.evidence.length),
			);
		assert.isAtMost(maxEv(unsure), 1);
		assert.isAtLeast(maxEv(sure), maxEv(unsure));
		assert(
			[...unsure.strengths, ...unsure.weaknesses].every((x) =>
				/^(Early read|From limited looks|Tentatively|Still unconfirmed)/.test(
					x.text,
				),
			),
		);
	});

	test("trend arrows against last season's report", () => {
		const prevLow = GRADE_KEYS.map(() => 0);
		const prevHigh = GRADE_KEYS.map(() => 12);
		const up = report({
			skills: signals({ prev: { season: 2029, grades: prevLow } }),
		}).skills!;
		const down = report({
			skills: signals({ prev: { season: 2029, grades: prevHigh } }),
		}).skills!;
		const dirs = (k: typeof up) =>
			[...k.strengths, ...k.weaknesses]
				.map((x) => x.trend?.dir)
				.filter(Boolean);
		assert.isAbove(dirs(up).filter((d) => d === "up").length, 0);
		assert.isAbove(dirs(down).filter((d) => d === "down").length, 0);
		assert.strictEqual(
			[...report().skills!.strengths].filter(
				(x) => x.trend?.dir === "up" && x.trend.text.includes("since"),
			).length,
			0,
		);
	});

	test("scout voices differ, and a second scout can dissent", () => {
		const d = dept(100);
		const texts = new Set<string>();
		let dissents = 0;
		for (const scout of d.scouts) {
			for (const pid of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
				const r = buildReport({
					input: input({ pid }),
					peers: peers(),
					dept: d,
					numTeams: 30,
					leadId: scout.id,
				});
				texts.add(r.skills!.voice);
				dissents += [...r.skills!.strengths, ...r.skills!.weaknesses].filter(
					(x) => x.dissent,
				).length;
			}
		}
		assert.isAbove(texts.size, 1);
		assert.isAbove(dissents, 0);
	});

	test("contradictions: great numbers, questionable mechanics", () => {
		const k = report({
			ratings: ratings({ tp: 25, fg: 30, ft: 40 }),
			preDraft: {
				season: 2030,
				team: "Duke",
				level: "college",
				gp: 32,
				min: 32,
				pts: 16,
				trb: 5,
				orb: 1,
				ast: 3,
				tov: 2,
				stl: 1,
				blk: 0.4,
				fga: 12,
				fgPct: 46,
				tpa: 6,
				tpPct: 43,
				fta: 4,
				ftPct: 75,
			},
		}).skills!;
		assert(
			k.contradictions.some((c) => /Great numbers|box score loves/.test(c)),
			k.contradictions.join(" | "),
		);
	});

	test("no visible ratings: no film evidence, no contradictions, hedged", () => {
		const k = report({ ratings: undefined, uncertainty: 8 }).skills!;
		assert.strictEqual(k.certainty, "hedged");
		assert.deepStrictEqual(k.contradictions, []);
		for (const x of [...k.strengths, ...k.weaknesses]) {
			for (const e of x.evidence) {
				assert.notStrictEqual(e.src, "film");
			}
		}
		// Rating-based items never fire without ratings
		const c = skillCandidates(input({ ratings: undefined }), flatTake(12));
		for (const key of [
			"transition",
			"zoneBuster",
			"slowRelease",
			"lateReads",
			"switch",
			"dayOne",
			"lostOffBall",
		]) {
			assert(!has(c as any, key), key);
		}
	});
});
