import { assert, describe, test } from "vitest";
import {
	POSITIONS,
	improvedPosition,
	positionAxes,
	positionFor,
	positionOf,
	positionStats,
	sizeBand,
} from "./position.ts";
import { realData, realPlayer } from "./real.testutil.ts";
import type { ArchetypeRatings } from "./types.ts";

const R = (
	r: Omit<ArchetypeRatings, "endu" | "fg" | "ft" | "dnk"> &
		Partial<ArchetypeRatings>,
): ArchetypeRatings => ({ endu: 50, fg: 50, ft: 55, dnk: 50, ...r });

// Height rating = (inches - 66) / 0.27
export const FIXTURES: {
	name: string;
	ratings: ArchetypeRatings;
	expected: string[];
}[] = [
	{
		name: `classic PG (6'2")`,
		ratings: R({
			hgt: 30,
			stre: 40,
			spd: 75,
			jmp: 60,
			ins: 35,
			tp: 65,
			oiq: 65,
			diq: 45,
			drb: 75,
			pss: 75,
			reb: 30,
			ft: 75,
		}),
		expected: ["PG"],
	},
	{
		name: `6'8" playmaker`,
		ratings: R({
			hgt: 52,
			stre: 65,
			spd: 65,
			jmp: 65,
			ins: 55,
			dnk: 65,
			tp: 50,
			oiq: 70,
			diq: 55,
			drb: 65,
			pss: 70,
			reb: 50,
		}),
		expected: ["GF", "F"],
	},
	{
		name: `7' point center`,
		ratings: R({
			hgt: 67,
			stre: 65,
			spd: 40,
			jmp: 40,
			ins: 65,
			tp: 50,
			oiq: 75,
			diq: 50,
			drb: 55,
			pss: 75,
			reb: 70,
		}),
		expected: ["FC", "F"],
	},
	{
		name: `stretch 4 (6'10")`,
		ratings: R({
			hgt: 59,
			stre: 50,
			spd: 45,
			jmp: 45,
			ins: 45,
			tp: 65,
			ft: 70,
			fg: 60,
			oiq: 55,
			diq: 45,
			drb: 40,
			pss: 40,
			reb: 50,
		}),
		expected: ["PF", "F"],
	},
	{
		name: `small-ball 5 (6'7")`,
		ratings: R({
			hgt: 48,
			stre: 70,
			spd: 55,
			jmp: 65,
			ins: 60,
			dnk: 65,
			tp: 25,
			oiq: 50,
			diq: 60,
			drb: 35,
			pss: 40,
			reb: 65,
		}),
		expected: ["PF", "F"],
	},
	{
		name: `7' rim protector`,
		ratings: R({
			hgt: 67,
			stre: 65,
			spd: 35,
			jmp: 55,
			ins: 55,
			dnk: 60,
			tp: 10,
			ft: 40,
			oiq: 45,
			diq: 65,
			drb: 25,
			pss: 25,
			reb: 70,
		}),
		expected: ["C"],
	},
	{
		name: `3&D wing (6'7")`,
		ratings: R({
			hgt: 48,
			stre: 50,
			spd: 60,
			jmp: 55,
			ins: 35,
			tp: 65,
			ft: 70,
			oiq: 50,
			diq: 60,
			drb: 45,
			pss: 40,
			reb: 40,
		}),
		expected: ["SF", "GF"],
	},
	{
		name: `combo guard (6'4")`,
		ratings: R({
			hgt: 37,
			stre: 45,
			spd: 62,
			jmp: 60,
			ins: 40,
			tp: 60,
			oiq: 50,
			diq: 45,
			drb: 55,
			pss: 45,
			reb: 35,
		}),
		expected: ["G", "SG"],
	},
];

describe("improved positions", () => {
	test("fixtures", () => {
		for (const f of FIXTURES) {
			const pos = positionFor(f.ratings, true);
			assert.include(f.expected, pos, f.name);
		}
	});

	test("off: the original formula exactly", () => {
		let seed = 7;
		const rand = () => {
			seed = (seed * 16807) % 2147483647;
			return Math.floor((seed / 2147483647) * 101);
		};
		for (let i = 0; i < 2000; i++) {
			const r = R({
				hgt: rand(),
				stre: rand(),
				spd: rand(),
				jmp: rand(),
				ins: rand(),
				tp: rand(),
				oiq: rand(),
				diq: rand(),
				drb: rand(),
				pss: rand(),
				reb: rand(),
				endu: rand(),
				fg: rand(),
				ft: rand(),
				dnk: rand(),
			});
			assert.strictEqual(positionFor(r, false, "PG"), positionOf(r));
			assert.include(POSITIONS, positionFor(r, true));
		}
	});

	test("axes: length in inches, playmaking and ball skills as percentiles", () => {
		const pg = positionAxes(FIXTURES[0]!.ratings);
		const c = positionAxes(FIXTURES[5]!.ratings);
		assert.isBelow(pg.length, c.length);
		assert.isAbove(pg.skill, c.skill);
		assert.isAbove(pg.play, c.play);
		for (const f of FIXTURES) {
			const a = positionAxes(f.ratings);
			for (const v of [a.skill, a.play]) {
				assert.isAtLeast(v, 0);
				assert.isAtMost(v, 1);
			}
		}
	});

	test("expanded ratings: wingspan adds length, and missing ones fall back", () => {
		const r = FIXTURES[4]!.ratings;
		const base = positionAxes(r);
		const long = positionAxes({ ...r, wng: r.hgt + 15 });
		const short = positionAxes({ ...r, wng: r.hgt - 15 });
		assert.isAbove(long.length, base.length);
		assert.isBelow(short.length, base.length);
		assert.strictEqual(long.inches, base.inches);
		// (split ratings equal to the blended ones read like the blended ones)
		const split = positionAxes({
			...r,
			wng: r.hgt,
			pdef: r.diq,
			idef: r.diq,
			oreb: r.reb,
			dreb: r.reb,
			bsc: r.drb,
		});
		assert.closeTo(split.length, base.length, 1e-9);
		assert.closeTo(split.skill, base.skill, 1e-9);
		assert.closeTo(split.play, base.play, 1e-9);
	});

	test("playmaking reads assist and usage rates with minutes, scaled by minutes", () => {
		const r = { ...FIXTURES[1]!.ratings, season: 2025 };
		const row = (min: number, astp: number) => ({
			season: 2024,
			playoffs: false,
			min,
			astp,
			usgp: 25,
		});
		const none = positionAxes(r).play;
		const hi = positionAxes(r, positionStats([row(2000, 40)], 2025)).play;
		const lo = positionAxes(r, positionStats([row(2000, 5)], 2025)).play;
		const few = positionAxes(r, positionStats([row(200, 40)], 2025)).play;
		assert.isAbove(hi, few);
		assert.isAbove(few, none);
		assert.isBelow(lo, none);
		// Playoffs, other seasons and empty rows do not count
		assert.isUndefined(
			positionStats(
				[
					{ ...row(2000, 40), playoffs: true },
					row(0, 40),
					{ ...row(2000, 40), season: 2020 },
				],
				2025,
			),
		);
		// A primary ball handler at 6'8" is not a big
		assert.notInclude(
			["PF", "FC", "C"],
			positionFor(r, true, undefined, { stats: [row(2500, 40)] }),
		);
	});

	test("hard limits: under 6'4\" never a big, 7'0\" or taller never a guard", () => {
		const base = { inches: 75, length: 90, skill: 0.1, play: 0.1 };
		assert.notStrictEqual(sizeBand(base), "big");
		assert.notStrictEqual(
			sizeBand({ inches: 84, length: 84, skill: 1, play: 1 }),
			"guard",
		);
		assert.strictEqual(
			sizeBand({ inches: 74, length: 74, skill: 0.5, play: 0.5 }),
			"guard",
		);
		assert.strictEqual(
			sizeBand({ inches: 86, length: 86, skill: 0.2, play: 0.2 }),
			"big",
		);
	});

	test("sticky: keeps a close previous position, drops a far one", () => {
		// Between the SF and F centroids
		const axes = { inches: 79.8, length: 79.8, skill: 0.4, play: 0.4 };
		const best = improvedPosition(axes);
		assert.include(["SF", "F"], best);
		const other = best === "F" ? "SF" : "F";
		assert.strictEqual(improvedPosition(axes, other), other);
		assert.strictEqual(improvedPosition(axes, "C"), best);
		assert.strictEqual(improvedPosition(axes, "not a position"), best);
		assert.strictEqual(improvedPosition(axes, "PG"), best);
		// A one-season jump is not enough when last season's reading still says the old position
		// (playmaking read from his stats)
		const pgNow = {
			inches: 76,
			length: 75.5,
			skill: 0.6,
			play: 0.95,
			fromStats: 1,
		};
		const sgBefore = {
			inches: 76,
			length: 76.5,
			skill: 0.6,
			play: 0.3,
			fromStats: 1,
		};
		assert.strictEqual(improvedPosition(pgNow), "PG");
		assert.strictEqual(improvedPosition(sgBefore), "SG");
		assert.strictEqual(improvedPosition(pgNow, "SG"), "PG");
		assert.strictEqual(improvedPosition(pgNow, "SG", sgBefore), "SG");
		assert.strictEqual(improvedPosition(pgNow, "SG", pgNow), "PG");
	});

	test("arch13: read from ratings alone, a borderline point guard is a combo guard; his stats decide", () => {
		const axes = { inches: 75, length: 75, skill: 0.65, play: 0.8 };
		assert.strictEqual(improvedPosition({ ...axes, fromStats: 1 }), "PG");
		assert.strictEqual(improvedPosition({ ...axes, fromStats: 0 }), "G");
		// (a clear point guard is one either way)
		assert.strictEqual(
			improvedPosition({ ...axes, play: 0.97, length: 73.5, fromStats: 0 }),
			"PG",
		);
	});

	test("tall playmakers are not centers, small bigs are not centers", () => {
		assert.notStrictEqual(
			improvedPosition({ inches: 84, length: 84, skill: 0.8, play: 0.9 }),
			"C",
		);
		assert.strictEqual(
			improvedPosition({ inches: 85.5, length: 86, skill: 0.1, play: 0.2 }),
			"C",
		);
		assert.include(
			["PF", "F", "SF"],
			improvedPosition({ inches: 80.5, length: 81, skill: 0.2, play: 0.2 }),
		);
		assert.strictEqual(
			improvedPosition({ inches: 73, length: 73, skill: 0.9, play: 0.95 }),
			"PG",
		);
	});
});

// Real players' listed positions (data/real-player-data.basketball.json bios) against the position the game gives their
// ratings at the preseason (with the previous season's stats). Adjacent: one step on PG, G, SG, GF, SF, F, PF, FC, C.
describe("improved positions on real NBA players", () => {
	const ORDER = ["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"];
	const adjacent = (a: string, b: string) =>
		Math.abs(ORDER.indexOf(a) - ORDER.indexOf(b)) <= 1;

	test("listed positions, 2016-2025: exact or adjacent at least 80%", () => {
		const data = realData();
		let exact = 0;
		let adj = 0;
		let adjOld = 0;
		let n = 0;
		for (const row of data.d.ratings) {
			const listed = data.d.bios[row.slug]?.pos;
			if (row.season < 2016 || !ORDER.includes(listed)) {
				continue;
			}
			const p = realPlayer(data, row);
			n++;
			if (p.pos === listed) {
				exact++;
			}
			if (adjacent(p.pos, listed)) {
				adj++;
			}
			if (adjacent(positionOf(p.ratings), listed)) {
				adjOld++;
			}
		}
		// (pos2: 43.4% exact, 82.7% exact or adjacent; the two-axis model before it 37.0% / 74.3%, BBGM's formula 36.8% / 79.3%)
		assert.isAbove(n, 7000);
		assert.isAtLeast(adj / n, 0.8, `adjacent ${adj / n}`);
		assert.isAtLeast(exact / n, 0.4, `exact ${exact / n}`);
		assert.isAbove(adj, adjOld);
	});

	test("2025 stars", () => {
		const data = realData();
		const want: Record<string, string[]> = {
			gilgesh01: ["PG", "G"],
			doncilu01: ["PG", "G", "GF"],
			cunnica01: ["PG", "G", "GF"],
			jamesle01: ["SF", "F"],
			duranke01: ["SF", "F"],
			jokicni01: ["C", "FC"],
			curryst01: ["PG"],
			antetgi01: ["F", "PF", "FC"],
			greendr01: ["PF", "F"],
			halibty01: ["PG"],
		};
		for (const [slug, ok] of Object.entries(want)) {
			const row = data.d.ratings.find(
				(r) => r.slug === slug && r.season === 2025,
			);
			assert.include(ok, realPlayer(data, row).pos, slug);
		}
	});
});
