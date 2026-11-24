import { assert, beforeEach, test } from "vitest";
import { Rng } from "./rng.ts";
import { ejectionText, flagrantFoul, technicalFoul } from "./plays.ts";
import { makeRatings, type FPlayer } from "./types.ts";
import { VarietyMemory, setVariety } from "./variety.ts";

// Technical and flagrant fouls, ejections: the wording (plays.ts), with its context lines

const pl = (pid: number, name: string, t: 0 | 1 = 0): FPlayer => ({
	pid,
	name,
	pos: "G",
	t,
	R: makeRatings(undefined),
});
const A = pl(1, "Abe Archer");
const B = pl(2, "Ben Baker", 1);
const base = { afterDunk: false, afterFoul: false, shooter: B };

beforeEach(() => {
	setVariety(new VarietyMemory(["Abe Archer", "Ben Baker", "Hawks", "Bulls"]));
});

const many = (f: (rng: Rng) => string, n = 300) => {
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		out.push(f(new Rng(i, 7)));
	}
	return out;
};

const clean = (s: string) => {
	assert.notMatch(s, /undefined|NaN|\?\?\?|\s\s|\.\./, s);
};

test("technical fouls: varied wording for players and the bench, the free throw follow-up", () => {
	const player = many((rng) => technicalFoul(rng, A, "the Hawks", 1, base));
	const bench = many((rng) =>
		technicalFoul(rng, undefined, "the Hawks", 1, base),
	);
	for (const s of [...player, ...bench]) {
		clean(s);
		assert.include(s, "Ben Baker");
	}
	assert.isAtLeast(new Set(player.map((s) => s.split(".")[0])).size, 12);
	assert.isAtLeast(new Set(bench.map((s) => s.split(".")[0])).size, 8);
	for (const s of bench) {
		assert.include(s, "Hawks");
	}
	// no shooter known (a stored game cut short): no free throw line
	for (const s of many((rng) =>
		technicalFoul(rng, A, "the Hawks", 1, { ...base, shooter: undefined }),
	)) {
		clean(s);
		assert.notMatch(s, /free throw|line for one|shoot the technical/, s);
	}
});

test("technical fouls: his count for the season, the suspension, a second technical", () => {
	for (const s of many((rng) =>
		technicalFoul(rng, A, "the Hawks", 1, { ...base, seasonNum: 16 }),
	)) {
		assert.match(s, /suspen/, s);
	}
	for (const s of many((rng) =>
		technicalFoul(rng, A, "the Hawks", 1, { ...base, seasonNum: 7 }),
	)) {
		assert.match(s, /\b7(th)? technical/, s);
	}
	for (const s of many((rng) =>
		technicalFoul(rng, A, "the Hawks", 2, { ...base, seasonNum: 7 }),
	)) {
		assert.match(s, /second|two/i, s);
		// the ejection line follows: no season count or context on the second one
		assert.notMatch(s, /season/, s);
	}
	// early in the season, nothing to say
	for (const s of many((rng) =>
		technicalFoul(rng, A, "the Hawks", 1, { ...base, seasonNum: 1 }),
	)) {
		assert.notMatch(s, /season/, s);
	}
});

test("technical fouls: context lines for a late close game and the crowd, none without context", () => {
	const late = many((rng) =>
		technicalFoul(rng, A, "the Hawks", 1, { ...base, late: true }),
	);
	assert.isTrue(late.some((s) => /costly|close game|worst time/.test(s)));
	const away = many((rng) =>
		technicalFoul(rng, A, "the Hawks", 1, { ...base, home: false }),
	);
	assert.isTrue(away.some((s) => /crowd|fans/.test(s)));
	const none = many((rng) => technicalFoul(rng, A, "the Hawks", 1, base));
	assert.isFalse(none.some((s) => /crowd|fans|rivalry|playoff/.test(s)));
});

test("flagrant fouls: flagrant 1 and flagrant 2 are worded differently", () => {
	const f1 = many((rng) =>
		flagrantFoul(rng, A, B, "P3, team foul 4", 1, "the Bulls"),
	);
	const f2 = many((rng) =>
		flagrantFoul(rng, A, B, "P3, team foul 4", 2, "the Bulls", {
			rivalry: true,
		}),
	);
	for (const s of f1) {
		clean(s);
		assert.match(s, /flagrant 1|penalty 1/, s);
		assert.notMatch(s, /excessive|flagrant 2/, s);
		assert.include(s, "Two free throws for Ben Baker");
	}
	for (const s of f2) {
		clean(s);
		assert.match(s, /flagrant 2|penalty 2/, s);
		assert.notMatch(s, /flagrant 1/, s);
	}
	assert.isAtLeast(new Set(f1.map((s) => s.split(".")[0])).size, 10);
	assert.isTrue(f2.some((s) => /rivalry/.test(s)));
});

test("ejections: by reason, the coach, the crowd", () => {
	for (const reason of ["techs", "flagrants", "flagrant2", "other"]) {
		for (const s of many((rng) =>
			ejectionText(rng, A, "the Hawks", reason, { home: true }),
		)) {
			clean(s);
			assert.include(s, "Abe Archer");
		}
	}
	for (const s of many((rng) =>
		ejectionText(rng, undefined, "the Hawks", "techs"),
	)) {
		clean(s);
		assert.include(s, "Hawks coach");
	}
	assert.isTrue(
		many((rng) => ejectionText(rng, A, "the Hawks", "flagrant2")).every((s) =>
			/flagrant 2/.test(s),
		),
	);
});

test("no call repeats within a game while there are others to choose", () => {
	const rng = new Rng(3, 7);
	const calls = [];
	for (let i = 0; i < 8; i++) {
		calls.push(technicalFoul(rng, A, "the Hawks", 1, base).split(".")[0]);
	}
	assert.strictEqual(new Set(calls).size, calls.length, calls.join("|"));
});
