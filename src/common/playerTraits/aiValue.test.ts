import { assert, describe, test } from "vitest";
import {
	AI_TRAIT_MAX_ADJ,
	AI_TRAIT_WEIGHTS,
	AI_TEAM_TRAIT_CONTEXT,
	aiTeamTraitContext,
	aiTraitContractFactor,
	aiTraitValueFactor,
	generateTraitSeeds,
	ratingPart,
	CALIBRATION_OFFSETS,
	traitScores,
	TRAIT_KEYS,
	type TraitKey,
	type TraitRatings,
	type TraitScores,
} from "./index.ts";
import { Rng } from "../ratingsBuilds/rng.ts";

const RATING_KEYS = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
] as const;

// Scores whose residual (score minus rating part) is exactly `residual` for every key, except overrides
const scoresWithResidual = (
	ratings: TraitRatings,
	residual: number,
	overrides: Partial<Record<TraitKey, number>> = {},
) => {
	const scores = {} as TraitScores;
	for (const key of TRAIT_KEYS) {
		scores[key] =
			(overrides[key] ?? residual) +
			ratingPart(key, ratings) +
			CALIBRATION_OFFSETS[key];
	}
	return scores;
};

describe("AI trait value", () => {
	test("weights sum to 1", () => {
		const sum = Object.values(AI_TRAIT_WEIGHTS).reduce((a, b) => a + b, 0);
		assert.closeTo(sum, 1, 1e-9);
	});

	test("bounded, neutral at average", () => {
		const ratings = {};
		const neutral = aiTraitValueFactor(
			scoresWithResidual(ratings, 50),
			ratings,
			{
				age: 27,
			},
		);
		assert.closeTo(neutral, 1, 1e-9);
		const best = aiTraitValueFactor(scoresWithResidual(ratings, 100), ratings, {
			age: 27,
			strategy: "contending",
			numYoung: 5,
		});
		const worst = aiTraitValueFactor(scoresWithResidual(ratings, 0), ratings, {
			age: 27,
		});
		assert.closeTo(best, 1 + AI_TRAIT_MAX_ADJ, 1e-9);
		assert.closeTo(worst, 1 - AI_TRAIT_MAX_ADJ, 1e-9);
		const contract = aiTraitContractFactor(
			scoresWithResidual(ratings, 100),
			ratings,
			{ age: 27 },
		);
		assert.isAbove(contract, 1);
		assert.isBelow(contract, best);
	});

	test("injury prone players are worth less, iron men more", () => {
		const ratings = {};
		const prone = aiTraitValueFactor(
			scoresWithResidual(ratings, 50, { durability: 15 }),
			ratings,
			{ age: 27 },
		);
		const iron = aiTraitValueFactor(
			scoresWithResidual(ratings, 50, { durability: 85 }),
			ratings,
			{ age: 27 },
		);
		assert.isBelow(prone, 0.97);
		assert.isAbove(iron, 1.03);
	});

	test("veteran savvy matters more to contenders and to young rosters", () => {
		const ratings = {};
		const scores = scoresWithResidual(ratings, 50, { veteranSavvy: 80 });
		const base = aiTraitValueFactor(scores, ratings, { age: 32 });
		const contender = aiTraitValueFactor(scores, ratings, {
			age: 32,
			strategy: "contending",
		});
		const mentor = aiTraitValueFactor(scores, ratings, {
			age: 32,
			numYoung: 4,
		});
		const young = aiTraitValueFactor(scores, ratings, { age: 21 });
		assert.isAbove(base, 1);
		assert.isAbove(contender, base);
		assert.isAbove(mentor, base);
		assert.isBelow(young, base);
	});

	test("prospects: hidden traits count half", () => {
		const ratings = {};
		const scores = scoresWithResidual(ratings, 50, { durability: 10 });
		const known = aiTraitValueFactor(scores, ratings, { age: 19 });
		const prospect = aiTraitValueFactor(scores, ratings, {
			age: 19,
			isProspect: true,
			hiddenKeys: new Set<TraitKey>(["durability"]),
		});
		assert.closeTo(1 - prospect, (1 - known) / 2, 1e-9);
	});

	test("averages ~1 over a random league, so values and contracts don't inflate", () => {
		const rng = new Rng("aiValueTest");
		let sum = 0;
		let sumContract = 0;
		let min = Infinity;
		let max = -Infinity;
		const N = 3000;
		for (let i = 0; i < N; i++) {
			const ratings: TraitRatings = {};
			for (const key of RATING_KEYS) {
				ratings[key] = Math.max(0, Math.min(100, rng.normal(47, 12)));
			}
			const age = 20 + Math.floor(rng.random() * 14);
			const experience = Math.max(0, age - 21);
			const scores = traitScores(ratings, generateTraitSeeds("lg", i), {
				age,
				experience,
			});
			const factor = aiTraitValueFactor(scores, ratings, { age });
			sum += factor;
			sumContract += aiTraitContractFactor(scores, ratings, { age });
			min = Math.min(min, factor);
			max = Math.max(max, factor);
		}
		assert.closeTo(sum / N, 1, 0.01);
		assert.closeTo(sumContract / N, 1, 0.005);
		assert.isAtLeast(min, 1 - AI_TRAIT_MAX_ADJ - 1e-9);
		assert.isAtMost(max, 1 + AI_TRAIT_MAX_ADJ + 1e-9);
		// Not a no-op
		assert.isAbove(max - min, 0.05);
	});

	describe("team context", () => {
		const ratings = {};
		const diva = scoresWithResidual(ratings, 50, { ego: 15 });
		const teamFirst = scoresWithResidual(ratings, 50, { ego: 85 });
		const hotHead = scoresWithResidual(ratings, 50, { temper: 15 });
		const f = (
			scores: TraitScores,
			context: Partial<Parameters<typeof aiTraitValueFactor>[2]> = {},
		) => aiTraitValueFactor(scores, ratings, { age: 27, ...context });

		test("the secret aging curve has no AI weight", () => {
			assert.notInclude(Object.keys(AI_TRAIT_WEIGHTS), "agingCurve");
			assert.sameMembers(Object.keys(AI_TRAIT_WEIGHTS), [...TRAIT_KEYS]);
		});

		test("AI teams are warier of a second and third big ego", () => {
			const none = f(diva);
			const one = f(diva, { numBigEgos: 1 });
			const two = f(diva, { numBigEgos: 2 });
			const many = f(diva, { numBigEgos: 9 });
			assert.isBelow(none, 1);
			assert.isBelow(one, none);
			assert.isBelow(two, one);
			// Capped
			assert.strictEqual(
				many,
				f(diva, { numBigEgos: AI_TEAM_TRAIT_CONTEXT.maxCounted }),
			);
			// ...and a team-first player is worth more to that same locker room, by the same amount (centered, no inflation)
			assert.closeTo(f(teamFirst, { numBigEgos: 2 }) - 1, 1 - two, 1e-9);
		});

		test("a contender with a fragile locker room values a big ego less", () => {
			const fragile = { numBigEgos: 1, lockerRoom: -1.5 };
			const contender = f(diva, { ...fragile, strategy: "contending" });
			assert.isBelow(contender, f(diva, fragile));
			assert.isBelow(
				contender,
				f(diva, { ...fragile, strategy: "rebuilding" }),
			);
			// A contender with a healthy locker room is not extra wary
			assert.strictEqual(
				f(diva, { numBigEgos: 1, lockerRoom: 1, strategy: "contending" }),
				f(diva, { numBigEgos: 1, lockerRoom: 1 }),
			);
		});

		test("temper: contenders and teams with hot heads care more", () => {
			const base = f(hotHead);
			assert.isBelow(base, 1);
			assert.isBelow(f(hotHead, { strategy: "contending" }), base);
			assert.isBelow(f(hotHead, { numHotHeads: 2 }), base);
			assert.strictEqual(f(hotHead, { strategy: "rebuilding" }), base);
		});

		test("rebuilding teams value work ethic in young players more, contenders big-game", () => {
			const worker = scoresWithResidual(ratings, 50, { workEthic: 85 });
			assert.isAbove(
				f(worker, { age: 21, strategy: "rebuilding" }),
				f(worker, { age: 21 }),
			);
			assert.strictEqual(
				f(worker, { age: 21, strategy: "contending" }),
				f(worker, { age: 21 }),
			);
			// Not for veterans
			assert.strictEqual(
				f(worker, { age: 31, strategy: "rebuilding" }),
				f(worker, { age: 31 }),
			);
			const bigGame = scoresWithResidual(ratings, 50, { bigGame: 85 });
			assert.isAbove(f(bigGame, { strategy: "contending" }), f(bigGame));
			assert.isBelow(f(bigGame, { strategy: "rebuilding" }), f(bigGame));
		});

		test("the worst case stays within the cap", () => {
			const worst = f(scoresWithResidual(ratings, 0), {
				strategy: "contending",
				numBigEgos: 5,
				numHotHeads: 5,
				lockerRoom: -5,
			});
			assert.closeTo(worst, 1 - AI_TRAIT_MAX_ADJ, 1e-9);
		});

		test("aiTeamTraitContext counts teammates, never the player himself", () => {
			const roster = [
				{ egoZ: -0.8, temperZ: 0 },
				{ egoZ: -0.6, temperZ: -0.9 },
				{ egoZ: 0.4, temperZ: 0.2 },
			];
			const all = aiTeamTraitContext(roster);
			assert.strictEqual(all.numBigEgos, 2);
			assert.strictEqual(all.numHotHeads, 1);
			assert.closeTo(all.lockerRoom, -1, 1e-9);
			const withoutFirst = aiTeamTraitContext(roster, 0);
			assert.strictEqual(withoutFirst.numBigEgos, 1);
			assert.closeTo(withoutFirst.lockerRoom, -0.2, 1e-9);
			assert.deepEqual(aiTeamTraitContext([]), {
				numBigEgos: 0,
				numHotHeads: 0,
				lockerRoom: 0,
			});
		});

		test("averages ~1 over random teams of every strategy (no value inflation from the team context)", () => {
			const rng = new Rng("aiValueTeamTest");
			let sum = 0;
			let n = 0;
			let numWithContext = 0;
			for (let tid = 0; tid < 300; tid++) {
				const strategy = (["contending", "rebuilding", undefined] as const)[
					tid % 3
				];
				const roster = [];
				for (let i = 0; i < 14; i++) {
					const playerRatings: TraitRatings = {};
					for (const key of RATING_KEYS) {
						playerRatings[key] = Math.max(0, Math.min(100, rng.normal(47, 12)));
					}
					const age = 20 + Math.floor(rng.random() * 14);
					const scores = traitScores(
						playerRatings,
						generateTraitSeeds("lg", tid * 100 + i),
						{ age, experience: Math.max(0, age - 21) },
					);
					roster.push({ ratings: playerRatings, age, scores });
				}
				const zs = roster.map((p) => ({
					egoZ: Math.max(-1, Math.min(1, (p.scores.ego - 50) / 40)),
					temperZ: Math.max(-1, Math.min(1, (p.scores.temper - 50) / 40)),
				}));
				for (const [i, p] of roster.entries()) {
					const context = aiTeamTraitContext(zs, i);
					if (context.numBigEgos > 0 || context.numHotHeads > 0) {
						numWithContext += 1;
					}
					sum += aiTraitValueFactor(p.scores, p.ratings, {
						age: p.age,
						strategy,
						numYoung: 3,
						...context,
					});
					n += 1;
				}
			}
			assert.closeTo(sum / n, 1, 0.01);
			// The context is actually in play
			assert.isAbove(numWithContext / n, 0.3);
		});
	});
});
