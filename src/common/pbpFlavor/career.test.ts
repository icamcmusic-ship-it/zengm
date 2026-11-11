import { assert, describe, test } from "vitest";
import {
	CAREER_LENGTH,
	CAREER_RULES,
	CareerNotes,
	careerFromStats,
	careerTemplatesForTests,
	makeCareer,
	parseCareer,
} from "./career.ts";
import type { FPlayer } from "./types.ts";

// Career-high and milestone calls (career.ts): what the sim sends for a player, and that a call is only made when it is true and known

const player = (pid: number): FPlayer => ({
	pid,
	name: `Player ${pid}`,
	pos: "G",
	t: 0,
	R: {} as any,
});
const box = (o: Partial<Record<string, number>> = {}) => ({
	pts: 0,
	trb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tp: 0,
	...o,
});
const row = (season: number, o: Record<string, any> = {}) => ({
	season,
	playoffs: false,
	gp: 70,
	pts: 1400,
	orb: 100,
	drb: 300,
	ast: 350,
	tp: 120,
	td: 0,
	ptsMax: [38, 1],
	trbMax: [12, 2],
	astMax: [11, 3],
	tpMax: [6, 4],
	blkMax: [3, 5],
	stlMax: [4, 6],
	...o,
});
const notes = (career: number[] | undefined, opts = {}) =>
	new CareerNotes(7, [{ pid: 1, career }], opts);

describe("careerFromStats", () => {
	test("a career that is all on record: highs, season highs, totals", () => {
		const c = parseCareer(
			careerFromStats(
				[
					row(2020, { ptsMax: [44, 9], td: 2 }),
					row(2021),
					row(2021, { playoffs: true, gp: 10, pts: 250, ptsMax: [41, 8] }),
				],
				{ season: 2021, draftYear: 2019, age: 25 },
			),
		)!;
		assert.isTrue(c.complete);
		assert.isFalse(c.rookie);
		assert.strictEqual(c.gp, 150);
		assert.strictEqual(c.gpSeason, 80);
		assert.strictEqual(c.td, 2);
		assert.strictEqual(c.age, 25);
		assert.strictEqual(c.high.pts, 44);
		// (the season's best includes its playoff games)
		assert.strictEqual(c.seasonHigh.pts, 41);
		// (totals are the regular season's)
		assert.strictEqual(c.total.pts, 2800);
		assert.strictEqual(c.total.trb, 800);
		assert.strictEqual(c.total.tp, 240);
	});

	test("a veteran whose past isn't on record has no career highs or totals, only this season's highs", () => {
		const raw = careerFromStats([row(2021)], {
			season: 2021,
			draftYear: 2012,
			age: 31,
		});
		assert.strictEqual(raw.length, CAREER_LENGTH);
		const c = parseCareer(raw)!;
		assert.isFalse(c.complete);
		assert.isUndefined(c.high.pts);
		assert.isUndefined(c.total.pts);
		assert.strictEqual(c.seasonHigh.pts, 38);
	});

	test("seasons from before single-game highs were kept: totals, but no career highs", () => {
		const c = parseCareer(
			careerFromStats(
				[
					row(2020, {
						ptsMax: undefined,
						trbMax: null,
						astMax: undefined,
						tpMax: undefined,
						blkMax: undefined,
						stlMax: undefined,
						td: undefined,
					}),
					row(2021),
				],
				{ season: 2021, draftYear: 2019 },
			),
		)!;
		assert.isTrue(c.complete);
		assert.isUndefined(c.high.pts);
		assert.isUndefined(c.high.trb);
		assert.isUndefined(c.td);
		assert.strictEqual(c.seasonHigh.pts, 38);
		assert.strictEqual(c.total.pts, 2800);
	});

	test("a rookie before his first game, and junk", () => {
		const c = parseCareer(
			careerFromStats([row(2021, { gp: 0, pts: 0, ptsMax: null })], {
				season: 2021,
				draftYear: 2020,
				age: 19,
			}),
		)!;
		assert.isTrue(c.complete);
		assert.isTrue(c.rookie);
		assert.strictEqual(c.gp, 0);
		assert.strictEqual(c.high.pts, 0);
		assert.isUndefined(parseCareer(undefined));
		assert.isUndefined(parseCareer([1, 2, 3]));
		assert.isUndefined(parseCareer("x"));
		assert.isFalse(
			parseCareer(careerFromStats([], { season: 2021, draftYear: undefined }))!
				.complete,
		);
	});
});

describe("calls are made only when they are true", () => {
	const veteran = makeCareer({
		gp: 400,
		gpSeason: 50,
		td: 3,
		high: { pts: 40, trb: 14, ast: 12, tp: 7, blk: 4, stl: 5 },
		seasonHigh: { pts: 33, trb: 11, ast: 9, tp: 5, blk: 3, stl: 3 },
		total: { pts: 8000, trb: 2000, ast: 1500, tp: 700 },
	});

	// (his career highs all came this season, so there is no separate season high to call)
	const peak = makeCareer({
		gp: 400,
		gpSeason: 50,
		td: 3,
		high: { pts: 40, trb: 14, ast: 12, tp: 7, blk: 4, stl: 5 },
		seasonHigh: { pts: 40, trb: 14, ast: 12, tp: 7, blk: 4, stl: 5 },
	});

	test("a new career high: once, when he passes it, not before", () => {
		const n = notes(peak);
		const p = player(1);
		assert.isUndefined(n.check(1, p, box({ pts: 30 }), { late: false }));
		assert.isUndefined(n.check(2, p, box({ pts: 39 }), { late: false }));
		// (level with it, but not late in the game: he may well pass it)
		assert.isUndefined(n.check(3, p, box({ pts: 40 }), { late: false }));
		const line = n.check(4, p, box({ pts: 42 }), { late: false });
		assert.match(line ?? "", /career|personal best|never had more/);
		assert.include(line, "42 points");
		assert.isUndefined(n.check(5, p, box({ pts: 45 }), { late: true }));
		assert.deepStrictEqual(
			n.calls.map((c) => [c.kind, c.stat, c.value]),
			[["new", "pts", 42]],
		);
	});

	test("tying it late, then passing it", () => {
		const n = notes(peak);
		const p = player(1);
		n.check(1, p, box({ pts: 38 }), { late: true });
		const tie = n.check(2, p, box({ pts: 40 }), { late: true });
		assert.match(tie ?? "", /ties|matches|equaling|level with/);
		// (only as it happens: a rebound a minute later doesn't bring it up again)
		assert.isUndefined(n.check(3, p, box({ pts: 40, trb: 1 }), { late: true }));
		assert.match(
			n.check(4, p, box({ pts: 41, trb: 1 }), { late: true }) ?? "",
			/41 points/,
		);
	});

	test("N away from his career high, late in a big night", () => {
		const n = notes(peak);
		const p = player(1);
		assert.isUndefined(n.check(1, p, box({ pts: 37 }), { late: false }));
		const line = n.check(2, p, box({ pts: 38 }), { late: true });
		assert.match(line ?? "", /\b2\b/);
		assert.include(line, "40");
		// (a small night is not "N away")
		const m = notes(makeCareer({ gp: 400, gpSeason: 50, high: { pts: 22 } }));
		assert.isUndefined(m.check(1, p, box({ pts: 20 }), { late: true }));
	});

	test("a season high that is not a career high", () => {
		const n = notes(veteran);
		const p = player(1);
		assert.isUndefined(n.check(1, p, box({ pts: 33 }), { late: false }));
		const line = n.check(2, p, box({ pts: 35 }), { late: false });
		assert.match(line ?? "", /season/);
		assert.notMatch(line ?? "", /career/);
		assert.isUndefined(n.check(3, p, box({ pts: 37 }), { late: false }));
		// rebounds, assists, threes, blocks and steals too
		assert.match(
			n.check(4, p, box({ pts: 37, trb: 15 }), { late: false }) ?? "",
			/15 rebounds/,
		);
		assert.match(
			n.check(5, p, box({ pts: 37, trb: 15, tp: 8 }), { late: false }) ?? "",
			/8 threes/,
		);
	});

	test("a career milestone, in the regular season only", () => {
		const p = player(1);
		const close = makeCareer({
			gp: 400,
			gpSeason: 50,
			total: { pts: 9990, trb: 2000, ast: 1500, tp: 700 },
		});
		const n = notes(close);
		assert.isUndefined(n.check(1, p, box({ pts: 8 }), { late: false }));
		const line = n.check(2, p, box({ pts: 10 }), {
			late: false,
			how: "basket",
		});
		assert.include(line, "10,000");
		assert.isUndefined(n.check(3, p, box({ pts: 12 }), { late: false }));
		const playoffs = notes(close, { playoffs: true });
		assert.isUndefined(playoffs.check(1, p, box({ pts: 12 }), { late: false }));
	});

	test("a first career triple-double, and a rookie's first points", () => {
		const p = player(1);
		const first = notes(makeCareer({ gp: 100, gpSeason: 30, td: 0 }));
		assert.isUndefined(
			first.check(1, p, box({ pts: 12, trb: 10, ast: 9 }), { late: false }),
		);
		assert.match(
			first.check(2, p, box({ pts: 12, trb: 10, ast: 10 }), {
				late: false,
			}) ?? "",
			/triple-double/,
		);
		// he has had one before: nothing
		const again = notes(peak);
		assert.isUndefined(
			again.check(1, p, box({ pts: 12, trb: 10, ast: 10 }), { late: false }),
		);

		const rookie = notes(
			makeCareer({ rookie: true, gp: 0, gpSeason: 0, high: { pts: 0 } }),
		);
		assert.match(
			rookie.check(1, p, box({ pts: 2 }), { late: false }) ?? "",
			/first/,
		);
		assert.isUndefined(rookie.check(2, p, box({ pts: 4 }), { late: false }));
		// he has scored before
		const scored = notes(
			makeCareer({ rookie: true, gp: 3, gpSeason: 3, high: { pts: 6 } }),
		);
		assert.isUndefined(scored.check(1, p, box({ pts: 2 }), { late: false }));
	});

	test("too early to mean anything: no highs in a player's first games", () => {
		const p = player(1);
		const n = notes(
			makeCareer({
				gp: CAREER_RULES.minGp - 1,
				gpSeason: CAREER_RULES.minGpSeason - 1,
				high: { pts: 18 },
				seasonHigh: { pts: 18 },
			}),
		);
		assert.isUndefined(n.check(1, p, box({ pts: 30 }), { late: true }));
	});
});

describe("nothing is said without the data", () => {
	const p = player(1);
	const big = box({ pts: 60, trb: 20, ast: 20, tp: 12, blk: 10, stl: 10 });

	test("no career numbers at all (an old stored game)", () => {
		const n = notes(undefined);
		assert.isFalse(n.active);
		assert.isUndefined(n.check(1, p, big, { late: true }));
	});

	test("a career that isn't all on record: no career calls, whatever he does", () => {
		const n = notes(
			makeCareer({
				complete: false,
				gp: 300,
				gpSeason: 3,
				td: 0,
				high: { pts: 20 },
				total: { pts: 9999 },
			}),
		);
		assert.isUndefined(n.check(1, p, big, { late: true, how: "basket" }));
	});

	test("unknown highs and totals", () => {
		const n = notes(makeCareer({ gp: 300, gpSeason: 40 }));
		assert.isUndefined(n.check(1, p, big, { late: true, how: "basket" }));
	});

	test("an exhibition game", () => {
		const n = notes(makeCareer({ gp: 300, gpSeason: 40, high: { pts: 20 } }), {
			exhibition: true,
		});
		assert.isFalse(n.active);
	});

	test("a host that doesn't keep threes says nothing about threes", () => {
		const n = notes(
			makeCareer({
				gp: 300,
				gpSeason: 40,
				high: { tp: 0 },
				total: { tp: 499 },
			}),
		);
		assert.isUndefined(
			n.check(1, p, { pts: 0, trb: 0, ast: 0, stl: 0, blk: 0 }, { late: true }),
		);
	});
});

test("every template fills in", () => {
	const all = careerTemplatesForTests();
	assert.isAbove(all.length, 30);
	assert.strictEqual(new Set(all).size, all.length);
	for (const t of all) {
		assert.notMatch(t, /undefined|NaN|\${|null/);
		assert.include(t, "\u0001");
	}
});
