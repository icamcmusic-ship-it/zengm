import { assert, describe, test } from "vitest";
import {
	AI_TRAIT_MAX_ADJ,
	AI_TRAIT_WEIGHTS,
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
});
