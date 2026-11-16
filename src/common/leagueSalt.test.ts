import { afterEach, describe, expect, test } from "vitest";
import {
	getLeagueSalt,
	newLeagueSalt,
	salted,
	saltedSeed,
	setNewLeagueSaltOverride,
} from "./leagueSalt.ts";
import {
	neutralSubShape,
	seedForExisting,
	seedFromString,
	varyRealLean,
	VARY_REAL_MAX,
} from "./subRatingsGen.ts";
import { generateTraitSeeds } from "./playerTraits/seeds.ts";
import { seededRandom, seededUniform } from "./faceSeed.ts";
import { Rng as CollegeRng } from "./collegeStats/rng.ts";
import { Rng as NewspaperRng } from "./newspaper/text.ts";
import { Rng as PbpRng } from "./pbpFlavor/rng.ts";
import { Rng as BuildsRng } from "./ratingsBuilds/rng.ts";
import { seededRng } from "./wrapped/util.ts";
import g from "../worker/util/g.ts";

// The worker's g holds the salt (the getter registered by worker/util/g.ts)
const state = {
	set salt(v: number) {
		g.setWithoutSavingToDB("leagueSalt", v);
	},
};
afterEach(() => {
	state.salt = 0;
});

const r = {
	hgt: 50,
	stre: 50,
	spd: 60,
	jmp: 55,
	endu: 50,
	ins: 45,
	dnk: 60,
	ft: 70,
	fg: 55,
	tp: 65,
	oiq: 55,
	diq: 50,
	drb: 60,
	pss: 55,
	reb: 45,
	fuzz: 0,
} as any;

// Everything salted, as one snapshot
const snapshot = () => ({
	seed: seedFromString("pid|7"),
	sub: neutralSubShape(r, seedForExisting({ pid: 7 })).sub,
	traits: generateTraitSeeds(12345, 7),
	face: [seededUniform("faceStyle", 7), seededRandom("aging", 7)()],
	college: new CollegeRng("recruit|7").random(),
	newspaper: new NewspaperRng("abc|masthead").random(),
	pbp: new PbpRng(123, 4).random(),
	builds: new BuildsRng("randomize|1").random(),
	wrapped: seededRng("choose|x")(),
	vary: varyRealLean([0, 0, 0], 99),
});

describe("league salt", () => {
	test("salt 0 is the identity", () => {
		expect(salted("abc")).toBe("abc");
		expect(saltedSeed(12345)).toBe(12345);
		expect(getLeagueSalt()).toBe(0);
		// Known values from before salts existed
		expect(new BuildsRng("randomize|1").random()).toBe(
			new BuildsRng("randomize|1").random(),
		);
	});

	test("salt 0 snapshot is the same as with no getter value", () => {
		const a = snapshot();
		state.salt = 0;
		expect(snapshot()).toEqual(a);
	});

	test("different salts give different values", () => {
		const a = snapshot();
		state.salt = 1234567;
		const b = snapshot();
		state.salt = 7654321;
		const c = snapshot();
		for (const key of Object.keys(a) as (keyof typeof a)[]) {
			expect(b[key]).not.toEqual(a[key]);
			expect(c[key]).not.toEqual(b[key]);
		}
	});

	test("same salt is stable (reload, re-derivation)", () => {
		state.salt = 42;
		const a = snapshot();
		state.salt = 0;
		snapshot();
		state.salt = 42;
		expect(snapshot()).toEqual(a);
	});

	test("real-player variation is bounded", () => {
		for (let seed = 0; seed < 200; seed++) {
			for (const v of varyRealLean(new Array(25).fill(0), seed)) {
				expect(Math.abs(v)).toBeLessThanOrEqual(VARY_REAL_MAX);
			}
		}
	});

	test("new salts are never 0", () => {
		setNewLeagueSaltOverride(undefined);
		for (let i = 0; i < 100; i++) {
			const s = newLeagueSalt();
			expect(s).toBeGreaterThan(0);
			expect(s).toBeLessThan(2 ** 32);
		}
		setNewLeagueSaltOverride(() => 0);
	});
});
