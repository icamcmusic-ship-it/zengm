import { assert, describe, test } from "vitest";
import {
	GRADE_FLOORS,
	GRADE_KEYS,
	addSnap,
	buildChangelog,
	buildPeerTable,
	buildReport,
	categoryScores,
	decodeGrades,
	encodeGrades,
	formatGradeRange,
	getDepartment,
	gmLensAdjustment,
	gradeFromPercentile,
	gradeLetter,
	makeSnap,
	outcomeTier,
	parseScoutId,
	percentileOf,
	scoutAccuracy,
	scoutId,
	scoutsSplit,
	type ScoutInput,
	type ScoutRatings,
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
	ovr: 50,
	pot: 55,
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
	pid: 7,
	name: "Test Player",
	kind: "prospect",
	pos: "SF",
	age: 19,
	heightInches: 79,
	weight: 210,
	season: 2030,
	ratings: ratings({ tp: 70, ovr: 46, pot: 60 }),
	proSeasons: 0,
	injuries: [],
	uncertainty: 4,
	draft: { year: 2030, round: 0, pick: 0 },
	numPicks: 60,
	salaryCap: 140000,
	awards: { allStar: 0, allLeague: 0, mvp: 0, dpoy: 0, champ: 0, roy: 0 },
	expandedRatings: false,
	comps: [],
	roleScale: SCALE,
	onUserTeam: false,
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

const dept = (level = 50) =>
	getDepartment({
		leagueSeed: "seed",
		tid: 0,
		season: 2030,
		level,
		startingSeason: 2025,
	});

describe("grades", () => {
	test("percentiles map to letters, monotonic, A+ to F", () => {
		assert.strictEqual(gradeLetter(gradeFromPercentile(99)), "A+");
		assert.strictEqual(gradeLetter(gradeFromPercentile(50)), "C+");
		assert.strictEqual(gradeLetter(gradeFromPercentile(1)), "F");
		let prev = -1;
		for (let p = 0; p <= 100; p++) {
			const g = gradeFromPercentile(p);
			assert.isAtLeast(g, prev);
			prev = g;
		}
		assert.strictEqual(GRADE_FLOORS.length, 13);
		assert.strictEqual(formatGradeRange(8, 8), "B");
		assert.strictEqual(formatGradeRange(8, 10), "B to A-");
	});

	test("percentileOf", () => {
		assert.strictEqual(percentileOf([1, 2, 3, 4], 0), 0);
		assert.strictEqual(percentileOf([1, 2, 3, 4], 10), 100);
		assert.strictEqual(percentileOf([1, 2, 3, 4], 2.5), 50);
		assert.strictEqual(percentileOf([], 3), 50);
	});

	test("encode/decode round trip", () => {
		const grades = [0, 3, 7, 12, 5];
		assert.deepEqual(decodeGrades(encodeGrades(grades)), grades);
	});
});

describe("departments", () => {
	test("size and quality grow with the budget; ids round trip", () => {
		const low = dept(1);
		const high = dept(100);
		assert.isAtLeast(low.scouts.length, 2);
		assert.isAtMost(high.scouts.length, 5);
		assert.isAbove(high.scouts.length, low.scouts.length);
		assert.isAbove(high.quality, low.quality);
		const id = scoutId(12, 3, 7);
		assert.deepEqual(parseScoutId(id), { tid: 12, slot: 3, index: 7 });
	});

	test("scouts come and go over the years", () => {
		const ids = new Set<number>();
		for (let season = 2025; season < 2060; season++) {
			for (const s of getDepartment({
				leagueSeed: "seed",
				tid: 3,
				season,
				level: 60,
				startingSeason: 2025,
			}).scouts) {
				ids.add(s.id);
			}
		}
		assert.isAbove(ids.size, 8);
	});
});

describe("report", () => {
	test("deterministic, with a range when unsure and a byline", () => {
		const a = buildReport({
			input: input(),
			peers: peers(),
			dept: dept(),
			numTeams: 30,
		});
		const b = buildReport({
			input: input(),
			peers: peers(),
			dept: dept(),
			numTeams: 30,
		});
		assert.deepEqual(a, b);
		assert.strictEqual(a.grades.length, GRADE_KEYS.length);
		for (const g of a.grades) {
			assert.isAtMost(g.lo, g.grade);
			assert.isAtLeast(g.hi, g.grade);
			assert.isString(g.line);
			assert.isAbove(g.line.length, 5);
		}
		assert.isTrue(
			a.grades.some((g) => g.lo < g.hi),
			"uncertain prospect has ranges",
		);
		assert.isString(a.byline.lead.name);
		assert.match(a.header.rangeLine, /^Floor: .* · Ceiling: /);
		assert.isAbove(a.bottomLine.length, 40);
	});

	test("more looks give tighter grades", () => {
		const width = (u: number) =>
			buildReport({
				input: input({ uncertainty: u }),
				peers: peers(),
				dept: dept(),
				numTeams: 30,
			}).grades.reduce((sum, g) => sum + g.hi - g.lo, 0);
		assert.isBelow(width(0.3), width(6));
	});

	test("hidden traits that are not known read Unknown, never a number", () => {
		const r = buildReport({
			input: input({
				traits: [
					{
						key: "workEthic",
						name: "Work ethic",
						hidden: true,
						estimate: 50,
						low: 0,
						high: 100,
						exact: false,
					},
					{
						key: "hustle",
						name: "Hustle",
						hidden: false,
						estimate: 80,
						low: 70,
						high: 90,
						exact: false,
					},
				],
			}),
			peers: peers(),
			dept: dept(),
			numTeams: 30,
		});
		const we = r.intangibles.find((x) => x.name === "Work ethic")!;
		assert.isFalse(we.known);
		assert.match(we.text, /^Unknown: needs more looks/);
		assert.notMatch(we.text, /\d/);
		assert.isTrue(
			r.development.some((x) => x.startsWith("Work ethic: unknown")),
		);
	});

	test("better shooter, better shooting grade", () => {
		const shooter = buildReport({
			input: input({ ratings: ratings({ tp: 85, fg: 80, ft: 85 }) }),
			peers: peers(),
			dept: dept(),
			numTeams: 30,
		});
		const brick = buildReport({
			input: input({ ratings: ratings({ tp: 25, fg: 25, ft: 30 }) }),
			peers: peers(),
			dept: dept(),
			numTeams: 30,
		});
		const g = (r: typeof shooter) =>
			r.grades.find((x) => x.key === "shoot")!.grade;
		assert.isAbove(g(shooter), g(brick));
	});

	test("pro report has role, trend and contract", () => {
		const r = buildReport({
			input: input({
				kind: "pro",
				age: 31,
				ratings: ratings({ ovr: 55 }),
				prevRatings: ratings({ ovr: 60 }),
				contract: { amount: 30000, exp: 2033 },
				marketValue: 9000,
				uncertainty: 0.5,
			}),
			peers: peers(),
			dept: dept(),
			numTeams: 30,
		});
		assert.isDefined(r.pro);
		assert.strictEqual(r.pro!.trend, "declining");
		assert.match(r.pro!.contract!, /^Overpaid/);
	});
});

describe("history", () => {
	test("snapshots replace same phase, keep the newest, and the changelog explains moves", () => {
		const take = (grade: number) => ({
			grades: GRADE_KEYS.map((key) => ({
				key,
				grade,
				lo: grade,
				hi: grade,
				score: 50,
				label: key,
				line: "",
			})),
			overall: { grade, lo: grade, hi: grade },
		});
		let snaps = addSnap(
			undefined,
			makeSnap(2030, 0, take(6), undefined, {
				tpPct: 33,
				ftPct: 70,
				tov36: 2,
				pts36: 15,
				min: 400,
			}),
		)!;
		assert.lengthOf(snaps, 1);
		assert.isUndefined(
			addSnap(snaps, makeSnap(2030, 0, take(6), undefined, undefined)),
		);
		snaps = addSnap(
			snaps,
			makeSnap(2030, 3, take(8), undefined, {
				tpPct: 41,
				ftPct: 80,
				tov36: 2,
				pts36: 20,
				min: 1500,
			}),
		)!;
		assert.lengthOf(snaps, 2);
		const log = buildChangelog(snaps, undefined, false);
		assert.lengthOf(log, 1);
		assert.isTrue(log[0]!.changes[0]!.up);
		assert.match(
			log[0]!.changes.find((c) => c.key === "cs")!.text,
			/^Raised: Catch-and-shoot C\+ → B after shooting 41\.0% from three/,
		);
		for (let i = 0; i < 20; i++) {
			snaps =
				addSnap(
					snaps,
					makeSnap(2031 + i, 0, take(i % 13), undefined, undefined),
				) ?? snaps;
		}
		assert.isAtMost(snaps.length, 8);
	});

	test("track record and accuracy", () => {
		assert.strictEqual(
			outcomeTier({
				peakOvr: 50,
				awards: { allStar: 2, allLeague: 0, mvp: 0 },
				proSeasons: 6,
				scale: SCALE,
			}),
			6,
		);
		const acc = scoutAccuracy([
			{ scoutId: 1, pid: 1, name: "A", season: 2030, said: 5, became: 6 },
			{ scoutId: 1, pid: 2, name: "B", season: 2030, said: 6, became: 2 },
		])!;
		assert.strictEqual(acc.hits, 1);
		assert.strictEqual(acc.worst!.name, "B");
	});
});

describe("lens and rumors", () => {
	test("GM lens is zero for a balanced player, bounded, and opposite for opposite GMs", () => {
		assert.strictEqual(gmLensAdjustment(1, {}), 0);
		const shooter = { shoot: 2, iq: 1, ath: -1, size: -1 };
		assert.isAbove(gmLensAdjustment(1, shooter), 0);
		assert.isBelow(gmLensAdjustment(-1, shooter), 0);
		assert.isAtMost(Math.abs(gmLensAdjustment(1, { shoot: 50 })), 0.8);
		// Same z on every key: weights sum to zero
		const flat = Object.fromEntries(GRADE_KEYS.map((k) => [k, 1.5]));
		assert.closeTo(gmLensAdjustment(1, flat), 0, 1e-9);
	});

	test("scouts split", () => {
		const t = (expected: number, grade: number) => ({
			ceiling: expected,
			expected,
			overall: { grade, lo: grade, hi: grade },
		});
		assert.isUndefined(
			scoutsSplit(
				"X",
				"PG",
				[
					{ scout: "a", take: t(4, 7) },
					{ scout: "b", take: t(4, 8) },
				],
				"s",
			),
		);
		const split = scoutsSplit(
			"X",
			"PG",
			[
				{ scout: "a", take: t(6, 10) },
				{ scout: "b", take: t(3, 5) },
			],
			"s",
		)!;
		assert.match(split.text, /X/);
		assert.strictEqual(split.spread, 3);
	});
});

describe("newspaper draft preview", () => {
	test("runs in the Draft section when there are facts, and not without", async () => {
		const { makeFixture } = await import("../newspaper/fixture.ts");
		const { buildPaper } = await import("../newspaper/index.ts");
		const facts = makeFixture("midseason");
		const ids = (f: typeof facts) =>
			buildPaper(f).sections.flatMap((s) => s.articles.map((a) => a.id));
		assert.notInclude(ids(facts), "draft-preview");
		const rows = [1, 2, 3, 4].map((rank) => ({
			pid: facts.players[rank]!.pid,
			rank,
			name: facts.players[rank]!.name,
			pos: "SF",
			age: 19,
			school: "Duke",
			overall: "A-",
			best: "Shooting A",
			floor: "Rotation wing",
			ceiling: "All-Star",
			line: "A real talent.",
			move: rank === 2 ? 1 : 0,
		}));
		const withPreview = {
			...facts,
			draftPreview: { draftYear: facts.season, scout: "Dale Porter", rows },
		};
		assert.include(ids(withPreview), "draft-preview");
	});
});
