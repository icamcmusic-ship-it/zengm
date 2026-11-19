import { assert, test } from "vitest";
import {
	becameText,
	buildRealCompIndex,
	COMP_RATINGS,
	findRealComps,
	positionsCompatible,
	ratingsDistance,
	realOutcome,
	realSeasonText,
	similarityLabel,
	type RealCompSource,
} from "./realComps.ts";

type Key = (typeof COMP_RATINGS)[number];
const flat = (value: number, over: Partial<Record<Key, number>> = {}) =>
	({
		...Object.fromEntries(COMP_RATINGS.map((key) => [key, value])),
		...over,
	}) as Record<Key, number>;

// Real seasons are 2001-2009 here; 2010 is the data's last (unfinished) season
const source = (): RealCompSource => {
	const bios: RealCompSource["bios"] = {
		guard01: { name: "Real Guard", bornYear: 1981, pos: "PG" },
		guard02: { name: "Other Guard", bornYear: 1981, pos: "SG" },
		wing01: { name: "Real Wing", bornYear: 1981, pos: "SF" },
		center01: { name: "Real Center", bornYear: 1981, pos: "C" },
		late01: { name: "Late Starter", bornYear: 1975, pos: "PG" },
		old01: { name: "Old Timer", bornYear: 1955, pos: "PG" },
	};
	const ratings: RealCompSource["ratings"] = [];
	const teams: RealCompSource["teams"] = {};
	const add = (slug: string, season: number, r: Record<Key, number>) => {
		ratings.push({ slug, season, ...r });
		(teams[slug] ??= []).push({ season, abbrev: "BOS" });
	};
	for (let season = 2001; season <= 2010; season++) {
		add("guard01", season, flat(50, { hgt: 30, pss: 70, drb: 70 }));
		add("guard02", season, flat(48, { hgt: 32, pss: 62, drb: 64 }));
		add("wing01", season, flat(50, { hgt: 45 }));
		add("center01", season, flat(50, { hgt: 70, reb: 75, ins: 70 }));
	}
	// First season at 28
	add("late01", 2003, flat(50, { hgt: 30, pss: 70, drb: 70, oiq: 58 }));
	// Before the three-point line only
	add("old01", 1976, flat(50, { hgt: 30, pss: 70, drb: 70 }));
	// A season he was not on an NBA team: not real NBA data
	ratings.push({ slug: "wing01", season: 2000, ...flat(90) });
	// A player with no bio
	add("nobio01", 2005, flat(50, { hgt: 30, pss: 70, drb: 70 }));
	return {
		ratings,
		bios,
		teams,
		awards: {
			guard01: [
				{ season: 2005, type: "All-Star" },
				{ season: 2006, shortName: "ALL", rank: 2 },
			],
			center01: [
				{ season: 2007, shortName: "MVP", rank: 3 },
				{ season: 2008, shortName: "MVP" },
			],
		},
	};
};

test("index: only real NBA seasons from 1980 on, young or first, before the last season", () => {
	const index = buildRealCompIndex(source());
	assert.strictEqual(index.lastSeason, 2010);
	assert.deepStrictEqual(index.slugs, [
		"center01",
		"guard01",
		"guard02",
		"late01",
		"wing01",
	]);
	const seasons = (slug: string) =>
		[...index.rowSeason].filter(
			(_, row) => index.slugs[index.rowPlayer[row]!] === slug,
		);
	// Ages 20-23 (2001-2004), not the 2000 season off a team, not 2010
	assert.deepStrictEqual(seasons("wing01"), [2001, 2002, 2003, 2004]);
	// His first season, at 28
	assert.deepStrictEqual(seasons("late01"), [2003]);
	// Career for his peak: every real season before the last one
	assert.strictEqual(
		index.allSeasons[index.slugs.indexOf("wing01")]!.length,
		9,
	);
});

test("comps: closest first, position-compatible, never himself, deterministic", () => {
	const index = buildRealCompIndex(source());
	const prospect = {
		ratings: flat(50, { hgt: 30, pss: 70, drb: 70 }),
		age: 20,
		pos: "PG",
	};
	const comps = findRealComps(index, prospect);
	assert.deepStrictEqual(
		comps.map((c) => [c.name, c.season, c.age]),
		[
			["Real Guard", 2001, 20],
			["Other Guard", 2001, 20],
			// Almost the same ratings, but 8 years older then
			["Late Starter", 2003, 28],
		],
	);
	assert.strictEqual(comps[0]!.distance, 0);
	assert.deepStrictEqual(findRealComps(index, prospect), comps);
	// A point guard never gets the center or a wing at SF... the wing is 2 positions away
	assert.isFalse(comps.some((c) => c.name === "Real Center"));

	const self = findRealComps(index, { ...prospect, srID: "guard01" });
	assert.strictEqual(self[0]!.name, "Other Guard");

	// The age closest to his
	const older = findRealComps(index, { ...prospect, age: 22 });
	assert.deepStrictEqual([older[0]!.name, older[0]!.age], ["Real Guard", 22]);
});

test("distance: shape, level and height", () => {
	const a = COMP_RATINGS.map(() => 50);
	// Every rating but height 4 higher: level 4, no shape
	const b = COMP_RATINGS.map((key) => (key === "hgt" ? 50 : 54));
	assert.closeTo(ratingsDistance(a, b), 4, 1e-9);
	// Height counts more than one other rating
	const tall = COMP_RATINGS.map((key) => (key === "hgt" ? 58 : 50));
	const strong = COMP_RATINGS.map((key) => (key === "stre" ? 58 : 50));
	assert.isAbove(ratingsDistance(a, tall), ratingsDistance(a, strong));
});

test("positions, words, seasons, outcomes", () => {
	assert.isTrue(positionsCompatible("PG", "SG"));
	assert.isTrue(positionsCompatible("PG", "GF"));
	assert.isFalse(positionsCompatible("PG", "SF"));
	assert.isFalse(positionsCompatible("G", "C"));
	assert.isTrue(positionsCompatible("C", "PF"));
	assert.isTrue(positionsCompatible("X", "C"));

	assert.strictEqual(similarityLabel(3), "very close");
	assert.strictEqual(similarityLabel(6.5), "close");
	assert.strictEqual(similarityLabel(9), "fair");
	assert.strictEqual(similarityLabel(12), "loose");
	assert.strictEqual(realSeasonText(2004), "2003-04");
	assert.strictEqual(realSeasonText(2000), "1999-00");

	const index = buildRealCompIndex(source());
	const ovr = (r: Record<Key, number>) => r.oiq;
	const outcome = (slug: string) =>
		realOutcome(index, index.slugs.indexOf(slug), ovr);
	assert.strictEqual(outcome("center01").label, "MVP");
	assert.deepStrictEqual(
		[outcome("guard01").label, outcome("guard01").allStar],
		["All-Star", 2],
	);
	assert.strictEqual(outcome("guard02").label, "role player");
	assert.isTrue(outcome("guard02").active);
	assert.strictEqual(outcome("late01").label, "starter");
	assert.isFalse(outcome("late01").active);
	assert.strictEqual(
		becameText({
			name: "X",
			season: "2003-04",
			age: 20,
			similarity: "close",
			distance: 6,
			became: "All-Star",
			allStar: 6,
			seasons: 10,
			active: false,
		}),
		"All-Star (6 seasons)",
	);
});
