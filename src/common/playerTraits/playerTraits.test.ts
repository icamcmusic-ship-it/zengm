import { assert, describe, test } from "vitest";
import {
	EFFECT_AMPLITUDES,
	NEUTRAL_EFFECTS,
	NEUTRAL_SCORES,
	TRAIT_DEFINITIONS,
	TRAIT_KEYS,
	clampSeed,
	clutchSituationWeight,
	completeTraitSeeds,
	driftTraitSeeds,
	generateTraitSeeds,
	isTraitKey,
	lateGameSituationWeight,
	matchesTraitFilters,
	normalizeTraitSeedsFromImport,
	scoutTrait,
	seedForScore,
	seedKey,
	teamChemistryBonus,
	teamLateGameDecisionQuality,
	traitBadges,
	traitEffects,
	traitLevel,
	traitScores,
	traitUncertainty,
	traitZ,
	type TraitScores,
	type TraitSituation,
} from "./index.ts";

const avgRatings = {
	hgt: 47,
	stre: 54,
	spd: 56,
	jmp: 54,
	endu: 47,
	ins: 45,
	dnk: 52,
	ft: 49,
	fg: 49,
	tp: 50,
	oiq: 49,
	diq: 49,
	drb: 55,
	pss: 52,
	reb: 53,
};

const allScores = (score: number): TraitScores =>
	Object.fromEntries(TRAIT_KEYS.map((k) => [k, score])) as TraitScores;

const closeLate: TraitSituation = {
	scoreDiff: 1,
	timeLeft: 60,
	period: 4,
};

describe("seeds", () => {
	test("deterministic for a league seed and pid", () => {
		assert.deepStrictEqual(
			generateTraitSeeds(123, 45),
			generateTraitSeeds(123, 45),
		);
		assert.notStrictEqual(
			JSON.stringify(generateTraitSeeds(123, 45)),
			JSON.stringify(generateTraitSeeds(123, 46)),
		);
		assert.notStrictEqual(
			JSON.stringify(generateTraitSeeds(124, 45)),
			JSON.stringify(generateTraitSeeds(123, 45)),
		);
	});

	test("every trait has a seed, in bounds, two decimals", () => {
		const seeds = generateTraitSeeds(1, 1);
		for (const key of TRAIT_KEYS) {
			const v = seeds[seedKey(key)];
			assert.isTrue(Number.isFinite(v));
			assert.isAtMost(Math.abs(v), 3);
			assert.strictEqual(v, Math.round(v * 100) / 100);
		}
	});

	test("roughly standard normal, mean zero, traits uncorrelated", () => {
		const n = 6000;
		const sums = Object.fromEntries(TRAIT_KEYS.map((k) => [k, [0, 0]]));
		let cross = 0;
		for (let pid = 0; pid < n; pid++) {
			const seeds = generateTraitSeeds(99, pid);
			for (const key of TRAIT_KEYS) {
				sums[key]![0]! += seeds[seedKey(key)];
				sums[key]![1]! += seeds[seedKey(key)] ** 2;
			}
			cross += seeds.clutchSeed * seeds.hustleSeed;
		}
		for (const key of TRAIT_KEYS) {
			const mean = sums[key]![0]! / n;
			const variance = sums[key]![1]! / n - mean ** 2;
			assert.isAtMost(Math.abs(mean), 0.05, `${key} mean`);
			assert.isAbove(variance, 0.85, `${key} var`);
			assert.isBelow(variance, 1.1, `${key} var`);
		}
		assert.isAtMost(Math.abs(cross / n), 0.05);
	});

	test("completeTraitSeeds keeps what is there and fills the rest", () => {
		const generated = generateTraitSeeds(5, 10);
		const out = completeTraitSeeds({ clutchSeed: 1.5 }, 5, 10);
		assert.strictEqual(out.clutchSeed, 1.5);
		assert.strictEqual(out.hustleSeed, generated.hustleSeed);
		assert.deepStrictEqual(completeTraitSeeds(undefined, 5, 10), generated);
		// Junk is replaced
		const junk = completeTraitSeeds({ clutchSeed: Number.NaN }, 5, 10);
		assert.strictEqual(junk.clutchSeed, generated.clutchSeed);
	});

	test("drift is deterministic, slow, and keeps the distribution", () => {
		const seeds = generateTraitSeeds(3, 1);
		assert.deepStrictEqual(
			driftTraitSeeds(seeds, 3, 1, 2030),
			driftTraitSeeds(seeds, 3, 1, 2030),
		);
		let sumSq = 0;
		let sumDelta = 0;
		let n = 0;
		for (let pid = 0; pid < 3000; pid++) {
			const s0 = generateTraitSeeds(3, pid);
			const s1 = driftTraitSeeds(s0, 3, pid, 2030);
			for (const key of TRAIT_KEYS) {
				sumSq += s1[seedKey(key)] ** 2;
				sumDelta += Math.abs(s1[seedKey(key)] - s0[seedKey(key)]);
				n++;
			}
		}
		assert.isAbove(sumSq / n, 0.85);
		assert.isBelow(sumSq / n, 1.1);
		// Average yearly move well under half a standard deviation (about 4 score points)
		assert.isBelow(sumDelta / n, 0.35);
	});

	test("import normalisation drops junk", () => {
		assert.isUndefined(normalizeTraitSeedsFromImport(null));
		assert.isUndefined(normalizeTraitSeedsFromImport({ foo: 1 }));
		assert.deepStrictEqual(
			normalizeTraitSeedsFromImport({
				clutchSeed: 9,
				hustleSeed: "x",
				leadershipSeed: -0.5,
			}),
			{ clutchSeed: clampSeed(9), leadershipSeed: -0.5 },
		);
	});
});

describe("scores", () => {
	test("deterministic and bounded 0-100", () => {
		const seeds = generateTraitSeeds(1, 2);
		assert.deepStrictEqual(
			traitScores(avgRatings, seeds),
			traitScores(avgRatings, seeds),
		);
		for (const ratings of [
			{},
			Object.fromEntries(Object.keys(avgRatings).map((k) => [k, 0])),
			Object.fromEntries(Object.keys(avgRatings).map((k) => [k, 100])),
		]) {
			for (const seedValue of [-4, 0, 4]) {
				const seeds2 = Object.fromEntries(
					TRAIT_KEYS.map((k) => [seedKey(k), seedValue]),
				);
				for (const age of [18, 27, 45]) {
					for (const experience of [0, 4, 25]) {
						const s = traitScores(ratings, seeds2, { age, experience });
						for (const key of TRAIT_KEYS) {
							assert.isTrue(Number.isInteger(s[key]));
							assert.isAtLeast(s[key], 0);
							assert.isAtMost(s[key], 100);
						}
					}
				}
			}
		}
	});

	test("missing seeds and ratings are average", () => {
		const s = traitScores({}, undefined);
		for (const key of TRAIT_KEYS) {
			// Calibration offsets are small
			assert.isAtMost(Math.abs(s[key] - 50), 6, key);
		}
	});

	test("ratings move the right scores in the right direction", () => {
		const base = traitScores(avgRatings, {});
		const smart = traitScores({ ...avgRatings, oiq: 80, diq: 80 }, {});
		assert.isAbove(smart.clutch, base.clutch);
		assert.isAbove(smart.lateGameIq, base.lateGameIq);
		assert.isAbove(smart.shotDiscipline, base.shotDiscipline);
		const tough = traitScores({ ...avgRatings, endu: 80, stre: 80 }, {});
		assert.isAbove(tough.durability, base.durability);
		assert.isAbove(tough.recovery, base.recovery);
	});

	test("age and experience change things slowly in the right direction", () => {
		const rookie = traitScores(avgRatings, {}, { age: 20, experience: 0 });
		const vet = traitScores(avgRatings, {}, { age: 30, experience: 10 });
		assert.isAbove(vet.clutch, rookie.clutch);
		assert.isAbove(vet.leadership, rookie.leadership);
		assert.isAbove(vet.lateGameIq, rookie.lateGameIq);
		const old = traitScores(avgRatings, {}, { age: 36, experience: 14 });
		const prime = traitScores(avgRatings, {}, { age: 27, experience: 14 });
		assert.isBelow(old.durability, prime.durability);
		assert.isBelow(old.recovery, prime.recovery);
		// One year changes nothing by more than a few points
		const a = traitScores(avgRatings, {}, { age: 30, experience: 8 });
		const b = traitScores(avgRatings, {}, { age: 31, experience: 9 });
		for (const key of TRAIT_KEYS) {
			assert.isAtMost(Math.abs(a[key] - b[key]), 3, key);
		}
	});

	test("seedForScore inverts the score", () => {
		const ctx = { age: 25, experience: 2 };
		for (const key of TRAIT_KEYS) {
			for (const wanted of [20, 50, 75]) {
				const seed = seedForScore(key, avgRatings, wanted, ctx);
				const out = traitScores(avgRatings, { [seedKey(key)]: seed }, ctx);
				assert.isAtMost(Math.abs(out[key] - wanted), 1, `${key} ${wanted}`);
			}
		}
	});
});

describe("effects: neutrality and bounds", () => {
	test("score 50 and traits-off are exactly neutral", () => {
		for (const e of [
			traitEffects(undefined),
			traitEffects(NEUTRAL_SCORES),
			traitEffects(allScores(50)),
		]) {
			assert.strictEqual(e.varianceScale, 1);
			assert.strictEqual(e.injuryRateMultiplier, 1);
			assert.strictEqual(e.spacingContribution, 0);
			assert.strictEqual(e.screenContribution, 0);
			assert.strictEqual(e.screenShotDelta, 0);
			assert.strictEqual(e.looseBallBonus, 1);
			assert.strictEqual(e.foulProneness, 1);
			assert.strictEqual(e.gambleStealMultiplier, 1);
			assert.strictEqual(e.energyRecoveryRate, 1);
			assert.strictEqual(e.chemistryContribution, 0);
			assert.strictEqual(e.clutchShotModifier(closeLate), 0);
			assert.strictEqual(e.clutchFtModifier(closeLate), 0);
			assert.strictEqual(e.clutchTurnoverMult(closeLate), 1);
			assert.strictEqual(e.gameFormShotDelta(0), 0);
			assert.deepStrictEqual(e.shotSelectionBias(0.8), {
				attemptWeightMult: 1,
				shotQualityDelta: 0,
			});
			assert.strictEqual(e.pressureTurnoverMult(1), 1);
			assert.strictEqual(e.lateGameDecisionQuality(closeLate), 0);
		}
		assert.isTrue(traitEffects(undefined).neutral);
		assert.strictEqual(traitEffects(undefined), NEUTRAL_EFFECTS);
		assert.isFalse(traitEffects(allScores(50)).neutral);
	});

	test("hooks are bounded for every score from 0 to 100 and every situation", () => {
		const A = EFFECT_AMPLITUDES;
		for (let score = 0; score <= 100; score++) {
			const e = traitEffects(allScores(score));
			assert.isAtLeast(e.varianceScale, 1 - A.variance - 1e-9);
			assert.isAtMost(e.varianceScale, 1 + A.variance + 1e-9);
			assert.isAtLeast(e.injuryRateMultiplier, 1 - A.injury - 1e-9);
			assert.isAtMost(e.injuryRateMultiplier, 1 + A.injury + 1e-9);
			assert.isAtMost(Math.abs(e.spacingContribution), A.spacing + 1e-9);
			assert.isAtMost(Math.abs(e.screenContribution), A.screenSynergy + 1e-9);
			assert.isAtMost(Math.abs(e.screenShotDelta), A.screenShot + 1e-9);
			assert.isAtMost(Math.abs(e.looseBallBonus - 1), A.hustle + 1e-9);
			assert.isAtMost(
				Math.abs(e.foulProneness - 1),
				A.foul + A.veteranFoul + 1e-9,
			);
			assert.isAtMost(
				Math.abs(e.gambleStealMultiplier - 1),
				A.gambleSteal + 1e-9,
			);
			assert.isAtMost(Math.abs(e.energyRecoveryRate - 1), A.recovery + 1e-9);
			assert.isAtMost(Math.abs(e.chemistryContribution), 1);
			assert.isAtMost(Math.abs(e.bigGameShotDelta), A.bigGameShot + 1e-9);
			assert.isAtMost(Math.abs(e.bigGameFtDelta), A.bigGameFt + 1e-9);
			assert.isAtMost(
				Math.abs(e.bigGameTurnoverMult - 1),
				A.bigGameTurnover + 1e-9,
			);
			assert.isAtMost(Math.abs(e.techProneness - 1), A.temperTech + 1e-9);
			assert.isAtMost(
				Math.abs(e.flagrantProneness - 1),
				A.temperFlagrant + 1e-9,
			);
			for (const period of [1, 4, 5, 7]) {
				for (const timeLeft of [0, 30, 120, 300, 720]) {
					for (const scoreDiff of [-30, -9, -3, 0, 3, 9, 30]) {
						const sit = { period, timeLeft, scoreDiff };
						assert.isAtMost(
							Math.abs(e.clutchShotModifier(sit)),
							A.clutchShot + A.veteranClutchShot + A.temperClutchShot + 1e-9,
						);
						assert.isAtMost(
							Math.abs(e.clutchFtModifier(sit)),
							A.clutchFt + A.veteranClutchFt + A.temperClutchFt + 1e-9,
						);
						assert.isAtMost(
							Math.abs(e.clutchTurnoverMult(sit) - 1),
							A.clutchTurnover +
								A.veteranClutchTurnover +
								A.temperClutchTurnover +
								1e-9,
						);
						assert.isAtMost(
							Math.abs(e.lateGameDecisionQuality(sit)),
							A.lateGameDecision + A.veteranLateGame + 1e-9,
						);
					}
				}
			}
			for (const usage of [0, 0.5, 1, 2]) {
				const b = e.shotSelectionBias(usage);
				assert.isAtMost(
					Math.abs(b.attemptWeightMult - 1),
					A.shotAttemptWeight + 1e-9,
				);
				assert.isAtMost(Math.abs(b.shotQualityDelta), A.shotQuality + 1e-9);
			}
			for (const pressure of [0, 0.5, 1, 3]) {
				assert.isAtMost(
					Math.abs(e.pressureTurnoverMult(pressure) - 1),
					A.pressureTurnover + A.veteranPressureTurnover + 1e-9,
				);
			}
		}
	});

	test("direction: positive z is the good end", () => {
		const good = traitEffects(allScores(90));
		const bad = traitEffects(allScores(10));
		assert.isAbove(good.clutchShotModifier(closeLate), 0);
		assert.isBelow(bad.clutchShotModifier(closeLate), 0);
		assert.isBelow(good.clutchTurnoverMult(closeLate), 1);
		assert.isBelow(good.varianceScale, 1);
		assert.isAbove(bad.varianceScale, 1);
		assert.isBelow(good.injuryRateMultiplier, 1);
		assert.isAbove(bad.injuryRateMultiplier, 1);
		assert.isAbove(good.spacingContribution, 0);
		assert.isAbove(good.looseBallBonus, 1);
		assert.isBelow(good.foulProneness, 1);
		assert.isBelow(good.gambleStealMultiplier, 1);
		assert.isAbove(good.energyRecoveryRate, 1);
		assert.isBelow(good.pressureTurnoverMult(1), 1);
		assert.isAbove(good.lateGameDecisionQuality(closeLate), 0);
	});

	test("gunner: high usage and low discipline shoots more and worse", () => {
		const gunner = traitEffects({
			...allScores(50),
			shotDiscipline: 15,
		}).shotSelectionBias(0.8);
		const disciplined = traitEffects({
			...allScores(50),
			shotDiscipline: 85,
		}).shotSelectionBias(0.8);
		const lowUsageGunner = traitEffects({
			...allScores(50),
			shotDiscipline: 15,
		}).shotSelectionBias(0.1);
		assert.isAbove(gunner.attemptWeightMult, 1);
		assert.isBelow(gunner.shotQualityDelta, 0);
		assert.isBelow(disciplined.attemptWeightMult, 1);
		assert.isAbove(disciplined.shotQualityDelta, 0);
		assert.isBelow(
			Math.abs(lowUsageGunner.shotQualityDelta),
			Math.abs(gunner.shotQualityDelta),
		);
	});

	test("situational weights", () => {
		// Not clutch before the last period, when it is a blowout, or early in the quarter
		assert.strictEqual(clutchSituationWeight({ ...closeLate, period: 3 }), 0);
		assert.strictEqual(
			clutchSituationWeight({ ...closeLate, scoreDiff: 12 }),
			0,
		);
		assert.strictEqual(
			clutchSituationWeight({ ...closeLate, timeLeft: 400 }),
			0,
		);
		assert.strictEqual(clutchSituationWeight(closeLate), 1);
		assert.strictEqual(clutchSituationWeight({ ...closeLate, period: 6 }), 1);
		// Symmetric in the sign of the margin
		assert.strictEqual(
			clutchSituationWeight({ ...closeLate, scoreDiff: -2 }),
			clutchSituationWeight({ ...closeLate, scoreDiff: 2 }),
		);
		// Other numbers of periods (e.g. 2 halves)
		assert.strictEqual(
			clutchSituationWeight({ ...closeLate, period: 2, numPeriods: 2 }),
			1,
		);
		assert.strictEqual(
			clutchSituationWeight({ ...closeLate, period: 1, numPeriods: 2 }),
			0,
		);
		assert.strictEqual(lateGameSituationWeight({ ...closeLate, period: 2 }), 0);
		assert.strictEqual(lateGameSituationWeight(closeLate), 1);
		assert.isAbove(lateGameSituationWeight({ ...closeLate, scoreDiff: 10 }), 0);
		assert.strictEqual(
			lateGameSituationWeight({ ...closeLate, scoreDiff: 20 }),
			0,
		);
	});

	test("team chemistry and late-game aggregation", () => {
		assert.strictEqual(teamChemistryBonus([]), 0);
		assert.strictEqual(teamChemistryBonus([0, 0, 0, 0, 0]), 0);
		assert.strictEqual(
			teamChemistryBonus([1, 1, 1, 1, 1]),
			-teamChemistryBonus([-1, -1, -1, -1, -1]),
		);
		assert.isAtMost(
			Math.abs(teamChemistryBonus([1, 1, 1, 1, 1])),
			EFFECT_AMPLITUDES.chemistryTeam,
		);
		assert.isAbove(teamChemistryBonus([1, 0.5, 0, 0, 0]), 0);
		const good = traitEffects(allScores(90));
		const neutral = traitEffects(allScores(50));
		assert.strictEqual(teamLateGameDecisionQuality([], closeLate), 0);
		assert.strictEqual(
			teamLateGameDecisionQuality([neutral, neutral], closeLate),
			0,
		);
		assert.isAbove(
			teamLateGameDecisionQuality([good, neutral, neutral], closeLate),
			0,
		);
		// The ball handler counts the most
		assert.isAbove(
			teamLateGameDecisionQuality([good, neutral, neutral], closeLate),
			teamLateGameDecisionQuality([neutral, neutral, good], closeLate),
		);
	});
});

describe("effects: mean-zero scores give no net effect (Monte Carlo)", () => {
	// Scores distributed symmetrically around 50 with a realistic spread, independent per trait
	test("league-wide averages of every hook equal the neutral value", () => {
		const n = 20000;
		const acc: Record<string, number> = {};
		const add = (k: string, v: number) => {
			acc[k] = (acc[k] ?? 0) + v;
		};
		const sit: TraitSituation = { scoreDiff: 2, timeLeft: 90, period: 4 };
		for (let pid = 0; pid < n; pid++) {
			const seeds = generateTraitSeeds(11, pid);
			// Average ratings, the average age and experience the calibration was done at, and random seeds
			const scores = traitScores(avgRatings, seeds, {
				age: 26.6,
				experience: 6.9,
			});
			const e = traitEffects(scores);
			add("var", e.varianceScale);
			add("inj", e.injuryRateMultiplier);
			add("space", e.spacingContribution);
			add("screen", e.screenContribution);
			add("loose", e.looseBallBonus);
			add("foul", e.foulProneness);
			add("steal", e.gambleStealMultiplier);
			add("rec", e.energyRecoveryRate);
			add("clutchShot", e.clutchShotModifier(sit));
			add("clutchTov", e.clutchTurnoverMult(sit));
			add("press", e.pressureTurnoverMult(0.7));
			add("late", e.lateGameDecisionQuality(sit));
			add("quality", e.shotSelectionBias(0.6).shotQualityDelta);
			add("attempt", e.shotSelectionBias(0.6).attemptWeightMult);
			add("form", e.gameFormShotDelta((pid % 7) - 3));
			add("chem", e.chemistryContribution);
		}
		const mean = (k: string) => acc[k]! / n;
		assert.approximately(mean("var"), 1, 0.02);
		assert.approximately(mean("inj"), 1, 0.02);
		assert.approximately(mean("space"), 0, 0.003);
		assert.approximately(mean("screen"), 0, 0.003);
		assert.approximately(mean("loose"), 1, 0.01);
		assert.approximately(mean("foul"), 1, 0.015);
		assert.approximately(mean("steal"), 1, 0.01);
		assert.approximately(mean("rec"), 1, 0.01);
		assert.approximately(mean("clutchShot"), 0, 0.002);
		assert.approximately(mean("clutchTov"), 1, 0.009);
		assert.approximately(mean("press"), 1, 0.01);
		assert.approximately(mean("late"), 0, 0.002);
		assert.approximately(mean("quality"), 0, 0.002);
		assert.approximately(mean("attempt"), 1, 0.01);
		assert.approximately(mean("form"), 0, 0.003);
		assert.approximately(mean("chem"), 0, 0.05);
	});

	test("traitZ is clamped and linear", () => {
		assert.strictEqual(traitZ(50), 0);
		assert.strictEqual(traitZ(90), 1);
		assert.strictEqual(traitZ(100), 1);
		assert.strictEqual(traitZ(0), -1);
		assert.strictEqual(traitZ(70), 0.5);
	});
});

describe("scouting", () => {
	test("prospects are uncertain, better scouting is less so, pros reveal over time", () => {
		const prospect = (level: number, key: any) =>
			traitUncertainty({
				key,
				isProspect: true,
				experience: 0,
				scoutingLevel: level,
			});
		assert.isBelow(prospect(100, "clutch"), prospect(1, "clutch"));
		assert.isAbove(prospect(34, "clutch"), prospect(34, "hustle"));
		const pro = (experience: number, key: any) =>
			traitUncertainty({ key, isProspect: false, experience });
		assert.isAbove(pro(0, "clutch"), pro(1, "clutch"));
		assert.strictEqual(pro(3, "clutch"), 0);
		assert.strictEqual(pro(0, "hustle"), 0);
		assert.strictEqual(
			traitUncertainty({
				key: "clutch",
				isProspect: true,
				experience: 0,
				godMode: true,
			}),
			0,
		);
		for (const key of TRAIT_KEYS) {
			assert.isTrue(
				["visible", "hidden"].includes(TRAIT_DEFINITIONS[key].visibility),
			);
		}
	});

	test("the reading is stable, bounded, unbiased on average, and exact when sd is 0", () => {
		const a = scoutTrait({
			key: "clutch",
			trueScore: 70,
			sd: 15,
			leagueSeed: 1,
			pid: 4,
		});
		const b = scoutTrait({
			key: "clutch",
			trueScore: 70,
			sd: 15,
			leagueSeed: 1,
			pid: 4,
		});
		assert.deepStrictEqual(a, b);
		assert.isFalse(a.exact);
		assert.isAtMost(a.low, a.estimate);
		assert.isAtLeast(a.high, a.estimate);
		assert.isAtMost(Math.abs(a.estimate - 70), 30);
		const exact = scoutTrait({
			key: "clutch",
			trueScore: 70,
			sd: 0,
			leagueSeed: 1,
			pid: 4,
		});
		assert.isTrue(exact.exact);
		assert.strictEqual(exact.estimate, 70);
		let total = 0;
		for (let pid = 0; pid < 3000; pid++) {
			total +=
				scoutTrait({ key: "clutch", trueScore: 50, sd: 15, leagueSeed: 2, pid })
					.estimate - 50;
		}
		assert.isAtMost(Math.abs(total / 3000), 0.8);
		const edge = scoutTrait({
			key: "clutch",
			trueScore: 99,
			sd: 40,
			leagueSeed: 1,
			pid: 1,
		});
		assert.isAtMost(edge.high, 100);
		assert.isAtLeast(edge.low, 0);
	});
});

describe("UI helpers", () => {
	test("levels", () => {
		assert.strictEqual(traitLevel(95), "elite");
		assert.strictEqual(traitLevel(70), "strong");
		assert.strictEqual(traitLevel(50), "average");
		assert.strictEqual(traitLevel(30), "weak");
		assert.strictEqual(traitLevel(5), "poor");
	});

	test("badges: only notable traits, most extreme first, capped", () => {
		assert.deepStrictEqual(traitBadges(allScores(50)), []);
		const badges = traitBadges({
			...allScores(50),
			clutch: 90,
			durability: 10,
			hustle: 72,
			leadership: 28,
		});
		assert.deepStrictEqual(
			badges.map((b) => [b.key, b.tone]),
			[
				["clutch", "good"],
				["durability", "bad"],
				["hustle", "good"],
				["leadership", "bad"],
			],
		);
		assert.strictEqual(traitBadges(allScores(95), { max: 3 }).length, 3);
		assert.strictEqual(badges[0]!.label, TRAIT_DEFINITIONS.clutch.badgeHigh);
		assert.strictEqual(badges[1]!.label, TRAIT_DEFINITIONS.durability.badgeLow);
	});

	test("filters", () => {
		const s = { ...allScores(50), clutch: 80, durability: 20 };
		assert.isTrue(matchesTraitFilters(s, []));
		assert.isTrue(matchesTraitFilters(undefined, []));
		assert.isFalse(
			matchesTraitFilters(undefined, [{ key: "clutch", min: 10 }]),
		);
		assert.isTrue(matchesTraitFilters(s, [{ key: "clutch", min: 70 }]));
		assert.isFalse(matchesTraitFilters(s, [{ key: "clutch", min: 85 }]));
		assert.isTrue(
			matchesTraitFilters(s, [
				{ key: "durability", max: 30 },
				{ key: "clutch", min: 70 },
			]),
		);
		assert.isFalse(
			matchesTraitFilters(s, [
				{ key: "durability", max: 30 },
				{ key: "hustle", min: 60 },
			]),
		);
		assert.isTrue(isTraitKey("clutch"));
		assert.isFalse(isTraitKey("nope"));
	});

	test("every trait is documented", () => {
		for (const key of TRAIT_KEYS) {
			const def = TRAIT_DEFINITIONS[key];
			assert.strictEqual(def.key, key);
			for (const text of [
				def.name,
				def.description,
				def.effect,
				def.low,
				def.high,
				def.badgeHigh,
				def.badgeLow,
				def.growth,
			]) {
				assert.isAbove(text.length, 3);
			}
		}
	});
});
