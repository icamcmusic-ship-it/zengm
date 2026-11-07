import { assert, describe, test } from "vitest";
import { resetG } from "../../test/helpers.ts";
import genRatings from "../../worker/core/player/genRatings.basketball.ts";
import ovrGame from "../../worker/core/player/ovr.ts";
import { ratingsBuildFormulas as F } from "../../worker/core/player/ratingsBuildFormulas.ts";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import {
	ARCHETYPES,
	CLASS_FLAVORS,
	DEFAULT_SETTINGS,
	RATING_KEYS,
	Rng,
	TABLE_SIZE,
	archetypeByName,
	ovrExact,
	randomizeSettings,
	regenerateClass,
	regenerateOne,
	type BuildRatings,
	type PlayerInput,
} from "./index.ts";

const toBuildRatings = (r: Record<string, any>): BuildRatings => {
	const out = {} as BuildRatings;
	for (const key of RATING_KEYS) {
		out[key] = r[key];
	}
	return out;
};

// Real BBGM prospects, from the game's own rating generator
const makeClass = (seed: string, n: number): PlayerInput[] => {
	const rng = new Rng(seed);
	const players: PlayerInput[] = [];
	for (let i = 0; i < n; i++) {
		const { heightInInches, ratings } = genRatings(2025, DEFAULT_LEVEL);
		const r = toBuildRatings(ratings);
		const ovr = F.ovr(r);
		players.push({
			key: `${seed}-${i}`,
			ratings: r,
			fuzz: ratings.fuzz,
			ovr,
			pot: Math.min(100, ovr + rng.int(1, 25)),
			age: 19 + rng.int(0, 3),
			hgtInches: heightInInches,
			bio: { classYear: ["Freshman", "Sophomore", "Junior", "Senior"][i % 4]! },
		});
	}
	return players;
};

const settings = (extra: Record<string, any> = {}) => ({
	...DEFAULT_SETTINGS,
	seed: "test-seed",
	...extra,
});

describe("ratingsBuilds data", () => {
	test("the whole table was ported", () => {
		assert.strictEqual(ARCHETYPES.length, 447);
		assert.strictEqual(TABLE_SIZE, ARCHETYPES.length);
		assert.strictEqual(CLASS_FLAVORS.length, 70);
		assert.strictEqual(
			new Set(ARCHETYPES.map((a) => a.name)).size,
			ARCHETYPES.length,
		);
		assert.ok(archetypeByName("Stretch Big"));
		assert.ok(archetypeByName("Balanced"));
	});

	test("ovrExact rounds to the game's own ovr", () => {
		resetG();
		const rng = new Rng("exact");
		let n = 0;
		for (let i = 0; i < 4000; i++) {
			const r = {} as BuildRatings;
			for (const key of RATING_KEYS) {
				r[key] = Math.round(rng.uniform(0, 100));
			}
			const game = F.ovr(r);
			const exact = Math.round(ovrExact(r));
			assert.strictEqual(Math.min(100, Math.max(0, exact)), game);
			n++;
		}
		assert.strictEqual(n, 4000);
	});
});

describe("regenerateClass", () => {
	test("keeps every overall exactly across thousands of random players", () => {
		resetG();
		let total = 0;
		let changedPlayers = 0;
		const configs = [
			{ specialization: 1, buildNoise: 5 },
			{ specialization: 0, buildNoise: 0 },
			{ specialization: 2.5, buildNoise: 14 },
			{ specialization: 1.5, buildNoise: 3, buildsPerClass: 0, diversity: 100 },
		];
		for (const [c, config] of configs.entries()) {
			for (let k = 0; k < 18; k++) {
				const inputs = makeClass(`ovr-${c}-${k}`, 70);
				const res = regenerateClass(
					F,
					inputs,
					settings({ ...config, seed: `s${k}` }),
				);
				for (const [i, r] of res.results.entries()) {
					const input = inputs[i]!;
					total++;
					assert.strictEqual(
						F.ovr(r.after.ratings),
						input.ovr,
						`${input.key} ovr ${input.ovr} -> ${F.ovr(r.after.ratings)} (${r.build.name}, shortfall ${r.ovrShortfall})`,
					);
					assert.strictEqual(r.after.ovr, input.ovr);
					assert.strictEqual(r.ovrShortfall, 0);

					// The game's own ovr of the stored ratings
					assert.strictEqual(ovrGame(r.after.ratings as any), r.after.ovr);

					// Height rating is never touched
					assert.strictEqual(r.after.ratings.hgt, input.ratings.hgt);
					assert.strictEqual(r.after.hgtInches, input.hgtInches);

					for (const key of RATING_KEYS) {
						const v = r.after.ratings[key];
						assert.ok(Number.isInteger(v), `${key} ${v}`);
						assert.ok(v >= 0 && v <= 100);
					}
					assert.ok(r.after.pot >= r.after.ovr && r.after.pot <= 100);
					assert.strictEqual(r.after.pot, input.pot);
					if (r.changed.length > 0) {
						changedPlayers++;
					}
				}
			}
		}
		assert.ok(total >= 5000, `only ${total} players`);
		assert.ok(changedPlayers > total * 0.5, "most players should change");
	});

	test("keeps every overall exactly for extreme random players of any height", () => {
		resetG();
		const rng = new Rng("extreme");
		let total = 0;
		for (let c = 0; c < 60; c++) {
			const inputs: PlayerInput[] = [];
			for (let i = 0; i < 70; i++) {
				const r = {} as BuildRatings;
				const mean = rng.uniform(10, 80);
				for (const key of RATING_KEYS) {
					const sd = key === "hgt" ? 25 : 18;
					r[key] = Math.round(
						Math.min(
							100,
							Math.max(0, rng.normal(key === "hgt" ? 50 : mean, sd)),
						),
					);
				}
				const ovr = F.ovr(r);
				inputs.push({
					key: `${c}-${i}`,
					ratings: r,
					fuzz: 0,
					ovr,
					pot: Math.min(100, ovr + 5),
					age: 19,
				});
			}
			const res = regenerateClass(
				F,
				inputs,
				settings({
					seed: `x${c}`,
					specialization: [0.5, 1, 2.5][c % 3],
					buildNoise: [0, 5, 14][c % 3],
					diversity: 100,
				}),
			);
			for (const [i, r] of res.results.entries()) {
				total++;
				assert.strictEqual(F.ovr(r.after.ratings), inputs[i]!.ovr);
				assert.strictEqual(r.ovrShortfall, 0);
			}
		}
		assert.strictEqual(total, 4200);
	});

	test("is deterministic, and the seed and variation matter", () => {
		resetG();
		const inputs = makeClass("det", 60);
		const a = regenerateClass(F, inputs, settings());
		const b = regenerateClass(F, inputs, settings());
		assert.deepStrictEqual(a, b);

		const c = regenerateClass(F, inputs, settings({ seed: "other" }));
		assert.notDeepEqual(
			a.results.map((r) => r.after.ratings),
			c.results.map((r) => r.after.ratings),
		);

		// Variation keeps the flavor and the pool but re-rolls the individual players
		const v = regenerateClass(F, inputs, settings({ variation: 3 }));
		assert.deepStrictEqual(v.flavor, a.flavor);
		assert.strictEqual(v.poolSize, a.poolSize);
		assert.notDeepEqual(
			a.results.map((r) => r.after.ratings),
			v.results.map((r) => r.after.ratings),
		);
		for (const [i, r] of v.results.entries()) {
			assert.strictEqual(r.after.ovr, inputs[i]!.ovr);
		}
	});

	test("builds respect their height gate", () => {
		resetG();
		const counts = new Set<string>();
		for (let k = 0; k < 12; k++) {
			const inputs = makeClass(`gate-${k}`, 70);
			const res = regenerateClass(
				F,
				inputs,
				settings({ seed: `g${k}`, buildsPerClass: 0, diversity: 100 }),
			);
			for (const [i, r] of res.results.entries()) {
				const arch = archetypeByName(r.build.name)!;
				const hgt = inputs[i]!.ratings.hgt;
				assert.ok(
					hgt >= arch.min && hgt <= arch.max,
					`${arch.name} gated ${arch.min}-${arch.max} drawn for hgt ${hgt}`,
				);
				assert.deepStrictEqual(r.build.tags, arch.tags);
				counts.add(r.build.name);
			}
		}
		// Plenty of variety in a pool of everything
		assert.ok(counts.size > 60, `only ${counts.size} distinct builds`);
	});

	test("builds per class limits the pool, diversity keeps an exact Balanced count", () => {
		resetG();
		const inputs = makeClass("pool", 70);
		const small = regenerateClass(F, inputs, settings({ buildsPerClass: 12 }));
		const names = new Set(
			small.results
				.map((r) => r.build.name)
				.filter((name) => name !== "Balanced"),
		);
		assert.ok(small.poolSize !== null && small.poolSize <= 14);
		assert.ok(names.size <= (small.poolSize ?? 0));

		for (const diversity of [0, 50, 85, 100]) {
			const res = regenerateClass(F, inputs, settings({ diversity }));
			const balanced = res.results.filter(
				(r) => r.build.name === "Balanced",
			).length;
			const want = Math.round((70 * (100 - diversity)) / 100);
			// A player no specialist fits is Balanced regardless, so only >= is promised
			assert.ok(balanced >= want, `${diversity}: ${balanced} < ${want}`);
			assert.ok(balanced <= want + 6, `${diversity}: ${balanced} > ${want}+6`);
		}
	});

	test("a named flavor tilts the class", () => {
		resetG();
		const inputs = makeClass("flavor", 70);
		const tally = (flavor: string) => {
			let big = 0;
			for (let k = 0; k < 6; k++) {
				const res = regenerateClass(
					F,
					inputs,
					settings({
						seed: `f${k}`,
						flavor,
						flavorStrength: 2,
						buildsPerClass: 30,
					}),
				);
				assert.strictEqual(res.flavor?.name, flavor);
				for (const r of res.results) {
					if (archetypeByName(r.build.name)!.tags.includes("shooting")) {
						big++;
					}
				}
			}
			return big;
		};
		assert.ok(tally("shooting-rich") > tally("defensive"));
	});

	test("locks: skip, build, pinned ratings, ovr, pot", () => {
		resetG();
		const inputs = makeClass("locks", 40);
		const base = regenerateClass(F, inputs, settings());

		const withLocks = inputs.map((p, i) => {
			if (i === 0) {
				return { ...p, lock: { skip: true } };
			}
			if (i === 1) {
				return { ...p, lock: { build: "Stretch Big" } };
			}
			if (i === 2) {
				return {
					...p,
					lock: { ratings: { tp: p.ratings.tp, ft: p.ratings.ft } },
				};
			}
			if (i === 3) {
				return { ...p, lock: { ovr: p.ovr - 3, pot: p.ovr + 4 } };
			}
			return p;
		});
		const res = regenerateClass(F, withLocks, settings());

		// Skipped: untouched
		assert.deepStrictEqual(res.results[0]!.after, res.results[0]!.before);
		assert.strictEqual(res.results[0]!.skipped, true);
		assert.deepStrictEqual(res.results[0]!.after.ratings, inputs[0]!.ratings);

		// Forced build
		assert.strictEqual(res.results[1]!.build.name, "Stretch Big");
		assert.strictEqual(res.results[1]!.after.ovr, inputs[1]!.ovr);

		// Pinned ratings stay exactly where they were
		assert.strictEqual(res.results[2]!.after.ratings.tp, inputs[2]!.ratings.tp);
		assert.strictEqual(res.results[2]!.after.ratings.ft, inputs[2]!.ratings.ft);
		assert.strictEqual(res.results[2]!.after.ovr, inputs[2]!.ovr);

		// ovr/pot locks
		assert.strictEqual(res.results[3]!.after.ovr, inputs[3]!.ovr - 3);
		assert.strictEqual(res.results[3]!.after.pot, inputs[3]!.ovr + 4);

		// Everyone else is exactly what they were without the locks: one man's lock never moves another
		for (let i = 4; i < 40; i++) {
			assert.deepStrictEqual(
				res.results[i]!.after,
				base.results[i]!.after,
				`player ${i} moved`,
			);
		}
	});

	test("reroll re-draws just one player", () => {
		resetG();
		const inputs = makeClass("reroll", 40);
		const a = regenerateClass(F, inputs, settings());
		const rerolled = inputs.map((p, i) =>
			i === 7 ? { ...p, lock: { reroll: 1 } } : p,
		);
		const b = regenerateClass(F, rerolled, settings());
		assert.notDeepEqual(
			a.results[7]!.after.ratings,
			b.results[7]!.after.ratings,
		);
		assert.strictEqual(b.results[7]!.after.ovr, inputs[7]!.ovr);
		let same = 0;
		for (let i = 0; i < 40; i++) {
			if (
				i !== 7 &&
				JSON.stringify(a.results[i]) === JSON.stringify(b.results[i])
			) {
				same++;
			}
		}
		// Rerolling one player can shift a draw penalty for a few others, but not the class
		assert.ok(same >= 33, `only ${same} unchanged`);
	});

	test("fuzz modes", () => {
		resetG();
		const inputs = makeClass("fuzz", 30).map((p) => ({ ...p, fuzz: 2.5 }));
		const keep = regenerateClass(F, inputs, settings({ fuzz: "keep" }));
		const zero = regenerateClass(F, inputs, settings({ fuzz: "zero" }));
		const regen = regenerateClass(F, inputs, settings({ fuzz: "regenerate" }));
		const regen2 = regenerateClass(F, inputs, settings({ fuzz: "regenerate" }));
		for (const r of keep.results) {
			assert.strictEqual(r.after.fuzz, 2.5);
		}
		for (const r of zero.results) {
			assert.strictEqual(r.after.fuzz, 0);
		}
		assert.deepStrictEqual(regen, regen2);
		assert.ok(regen.results.some((r) => r.after.fuzz !== 2.5));
		for (const r of regen.results) {
			assert.ok(Math.abs(r.after.fuzz) <= 8);
		}
		// Ratings do not depend on the fuzz mode
		assert.deepStrictEqual(
			keep.results.map((r) => r.after.ratings),
			regen.results.map((r) => r.after.ratings),
		);
	});

	test("pos and skills are the game's own, recomputed from the new ratings", () => {
		resetG();
		const inputs = makeClass("pos", 60).map((p) => ({ ...p, fuzz: 1 }));
		const res = regenerateClass(F, inputs, settings({ specialization: 2 }));
		let posChanged = 0;
		for (const r of res.results) {
			assert.strictEqual(r.after.pos, F.pos(r.after.ratings));
			assert.deepStrictEqual(
				r.after.skills,
				F.skills({ ...r.after.ratings, fuzz: r.after.fuzz }),
			);
			if (r.after.pos !== r.before.pos) {
				posChanged++;
			}
		}
		assert.ok(posChanged > 0, "specialists should change some positions");
	});

	test("pot modes", () => {
		resetG();
		const inputs = makeClass("pot", 40);
		const estimate = regenerateClass(F, inputs, settings({ pot: "estimate" }));
		for (const [i, r] of estimate.results.entries()) {
			const p = inputs[i]!;
			const want = Math.min(
				100,
				Math.max(p.ovr, Math.round(F.potEstimate(p.ovr, p.age))),
			);
			assert.strictEqual(r.after.pot, want);
		}
		const build = regenerateClass(F, inputs, settings({ pot: "build" }));
		let moved = 0;
		for (const [i, r] of build.results.entries()) {
			assert.ok(r.after.pot >= r.after.ovr && r.after.pot <= 100);
			if (r.after.pot !== inputs[i]!.pot) {
				moved++;
			}
		}
		assert.ok(moved > 0);
	});

	test("keep heights off lets height move, ovr still exact", () => {
		resetG();
		const inputs = makeClass("hgt", 70);
		const res = regenerateClass(F, inputs, settings({ keepHeights: false }));
		let moved = 0;
		for (const [i, r] of res.results.entries()) {
			const input = inputs[i]!;
			if (r.after.hgtInches !== input.hgtInches) {
				moved++;
				assert.strictEqual(
					r.after.ratings.hgt,
					F.heightToRating(r.after.hgtInches!),
				);
			}
			assert.strictEqual(r.after.ovr, input.ovr);
		}
		assert.ok(moved > 10);
	});

	test("regenerateOne works outside a class and keeps ovr", () => {
		resetG();
		const inputs = makeClass("one", 25);
		for (const p of inputs) {
			const r = regenerateOne(F, p, settings({ seed: p.key }));
			assert.strictEqual(r.after.ovr, p.ovr);
			assert.ok(r.after.ratings.hgt === p.ratings.hgt);
			assert.notStrictEqual(r.build.name, "Balanced");
		}
	});

	test("locking the overall past what the height allows reports a shortfall instead of lying", () => {
		resetG();
		const tall = makeClass("tall", 30).sort(
			(a, b) => b.ratings.hgt - a.ratings.hgt,
		)[0]!;
		const r = regenerateOne(F, { ...tall, lock: { ovr: 0 } }, settings());
		assert.strictEqual(r.after.ovr, F.ovr(r.after.ratings));
		if (r.after.ovr !== 0) {
			assert.ok(r.ovrShortfall !== 0);
		}
	});
});

describe("randomizeSettings", () => {
	test("is seeded, snaps to steps and never touches the seed", () => {
		const a = randomizeSettings(DEFAULT_SETTINGS, "wide", "abc");
		const b = randomizeSettings(DEFAULT_SETTINGS, "wide", "abc");
		assert.deepStrictEqual(a, b);
		assert.notDeepEqual(a, randomizeSettings(DEFAULT_SETTINGS, "wide", "abd"));
		assert.ok(!("seed" in a));
		assert.ok(!("variation" in a));
		for (let i = 0; i < 50; i++) {
			const p = randomizeSettings(DEFAULT_SETTINGS, "gentle", `s${i}`);
			if (p.buildsPerClass !== undefined) {
				assert.ok(Number.isInteger(p.buildsPerClass));
			}
			if (p.specialization !== undefined) {
				assert.ok(p.specialization >= 0 && p.specialization <= 2.5);
			}
		}
		const mix = randomizeSettings(DEFAULT_SETTINGS, "mix", "x", {
			diversity: true,
		});
		assert.ok(!("diversity" in mix));
		assert.ok(!("specialization" in mix));
	});
});
