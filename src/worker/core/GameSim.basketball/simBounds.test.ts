import { afterAll, assert, describe, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { loadFatigue, refLean } from "./scheduleLoad.ts";
import { foulTroubleSitUntil, planMinutes } from "./rotationPlanner.ts";
import { validateGameSimSetting } from "../../../common/gameSimSettingsValidation.ts";
import { range } from "../../../common/utils.ts";

/*
 * Bounds and invariants of the basketball sim with the fork's game simulation features on: probabilities stay probabilities,
 * fatigue never turns into a bonus, minutes add up to the players on the court times the game length (regulation and overtime,
 * NBA and college lengths), points match the made shots, +/- balances, nothing is NaN, also with extreme custom settings.
 */

afterAll(() => {
	resetG();
});

// The game simulation League extras, all on
const ALL_FEATURES: Record<string, boolean> = {
	realisticPossessions: true,
	playerTraits: true,
	technicalFouls: true,
	expandedRatings: true,
	subRatings: true,
	subRatingsSim: true,
	perimeterDefense: true,
	simFixes: true,
	positionalComposites: true,
	realisticRotations: true,
	coachSystems: true,
	spacingCreation: true,
	matchupDefense: true,
	smartEndgame: true,
	scheduleLoad: true,
	realisticTurnovers: true,
	realisticPlayTypes: true,
	featureOffEmphasis: true,
	starClutchCal: true,
};

const simGames = async (
	settings: Record<string, unknown>,
	seeds: number[],
	check?: (sim: GameSim) => void,
	before?: (sim: GameSim) => void,
) => {
	const results = [];
	for (const seed of seeds) {
		results.push(
			await withSeededRandom(seed, async () => {
				await genTeams();
				for (const [key, value] of Object.entries({
					...ALL_FEATURES,
					...settings,
				})) {
					g.setWithoutSavingToDB(key as any, value as any);
				}
				const teams = await loadTeams([0, 1], {});
				const sim = new GameSim({
					gid: seed,
					teams: [teams[0]!, teams[1]!],
					baseInjuryRate: g.get("injuryRate"),
					doPlayByPlay: false,
					homeCourtFactor: 1,
					allStarGame: false,
					neutralSite: false,
				});
				before?.(sim);
				const result = sim.run();
				check?.(sim);
				return result;
			}),
		);
	}
	return results;
};

const hasNaN = (x: unknown): boolean => {
	if (typeof x === "number") {
		return Number.isNaN(x);
	}
	if (Array.isArray(x)) {
		return x.some(hasNaN);
	}
	if (x && typeof x === "object") {
		return Object.values(x).some(hasNaN);
	}
	return false;
};

const checkInvariants = (
	results: Awaited<ReturnType<typeof simGames>>,
	label: string,
) => {
	const numPlayersOnCourt = g.get("numPlayersOnCourt");
	const regulation = g.get("numPeriods") * g.get("quarterLength");
	for (const [i, result] of results.entries()) {
		const where = `${label} game ${i}`;
		const gameMinutes = regulation + result.overtimes * g.get("overtimeLength");
		let pmSum = 0;
		for (const t of result.team) {
			assert.isFalse(hasNaN(t.stat), `${where}: NaN team stat`);
			let min = 0;
			for (const p of t.player) {
				assert.isFalse(hasNaN(p.stat), `${where}: NaN player stat`);
				min += p.stat.min;
				pmSum += p.stat.pm;
			}
			assert.closeTo(
				min,
				numPlayersOnCourt * gameMinutes,
				1e-6 * Math.max(1, gameMinutes),
				`${where}: team minutes`,
			);
			// Points: 2 per field goal, 1 more per three, 1 per free throw
			assert.strictEqual(
				t.stat.pts,
				2 * t.stat.fg + t.stat.tp + t.stat.ft,
				`${where}: points identity`,
			);
		}
		assert.closeTo(pmSum, 0, 1e-9, `${where}: +/- sums to 0`);
	}
};

describe("probability bounds", () => {
	test("load fatigue stays in [0, 1] and never rises as energy falls", () => {
		let prev = Infinity;
		for (let e = 1; e >= -0.5; e -= 0.01) {
			const f = loadFatigue(e);
			assert.isAtLeast(f, 0);
			assert.isAtMost(f, 1);
			assert.isAtMost(f, prev + 1e-12);
			prev = f;
		}
		assert.strictEqual(loadFatigue(0.2), 0);
	});

	test("referee lean keeps the foul multipliers positive", () => {
		for (const hca of [0, 1, 10, 34, 50, 100, 1000, -1000]) {
			const lean = refLean(hca);
			assert.isAtLeast(1 - lean, 0.5);
			assert.isAtLeast(1 + lean, 0.5);
		}
		assert.strictEqual(refLean(Infinity), 0);
		assert.strictEqual(refLean(1), 0.03);
	});

	test("shot probabilities are always in [0, 1], with extreme settings", async () => {
		for (const settings of [
			{
				threePointAccuracyFactor: 5,
				twoPointAccuracyFactor: 5,
				foulRateFactor: 3,
			},
			{ threePointAccuracyFactor: 0, twoPointAccuracyFactor: 0 },
			{ homeCourtAdvantage: 100 },
		]) {
			let n = 0;
			await simGames(settings, [1], undefined, (sim) => {
				const orig = sim.getShotInfo.bind(sim);
				sim.getShotInfo = ((...args: Parameters<GameSim["getShotInfo"]>) => {
					const info = orig(...args);
					for (const key of [
						"probMake",
						"probAndOne",
						"probMissAndFoul",
					] as const) {
						assert.isAtLeast(info[key], 0, key);
						assert.isAtMost(info[key], 1, key);
					}
					n += 1;
					return info;
				}) as any;
			});
			assert.isAbove(n, 50);
		}
	}, 60_000);

	test("FT accuracy factor scales the whole free throw probability", async () => {
		const sims: GameSim[] = [];
		await simGames({ ftAccuracyFactor: 0 }, [2], (sim) => sims.push(sim));
		const sim = sims[0]!;
		const fake = (shootingFT: number) =>
			({ compositeRating: { shootingFT } }) as any;
		for (const ft of [0, 0.5, 1]) {
			assert.strictEqual(sim.freeThrowProb(0, fake(ft)), 0);
		}
		g.setWithoutSavingToDB("ftAccuracyFactor", 1);
		const sims2: GameSim[] = [];
		await simGames({ ftAccuracyFactor: 0.5 }, [2], (sim) => sims2.push(sim));
		// Half of the stock 0.6 c + 0.45
		assert.closeTo(sims2[0]!.freeThrowProb(0, fake(0.5)), 0.375, 1e-12);
	});
});

describe("shootouts", () => {
	test("never pick an ejected or fouled out shooter when someone else can shoot", async () => {
		await simGames({}, [3], undefined, (sim) => {
			const score = (p: any) =>
				p.compositeRating.shootingThreePointer + 0.2 * p.compositeRating.usage;
			const barred = new Set<unknown>();
			for (const t of [0, 1] as const) {
				const sorted = sim.team[t].player.toSorted(
					(a, b) => score(b) - score(a),
				);
				sim.ejected.add(sorted[0]!);
				sorted[1]!.stat.pf = sim.ga.foulsNeededToFoulOut;
				barred.add(sorted[0]!.id);
				barred.add(sorted[1]!.id);
			}
			sim.shootoutRounds = 3;
			sim.doShootout();
			assert.isAbove(sim.shootoutShots.length, 0);
			for (const [, pid] of sim.shootoutShots) {
				assert.isFalse(barred.has(pid));
			}
			// (don't play the game itself from this state)
			sim.run = (() => ({}) as any) as any;
		});
	});
});

describe("rotation planning scales with the game length", () => {
	const players = range(13).map((i) => ({
		valueNoPot: 70 - 2 * i,
		injured: false,
		ptModifier: 1,
	}));
	const options = {
		playoffs: false,
		backToBack: false,
		numPlayersOnCourt: 5,
		allStarGame: false,
	};

	test("minutes targets sum to 5 x the regulation length", () => {
		for (const regulationMinutes of [48, 40, 20, 60]) {
			const targets = planMinutes(players, { ...options, regulationMinutes });
			const sum = targets.reduce((a, b) => a + b, 0);
			assert.closeTo(sum, 5 * regulationMinutes, 0.05);
		}
		assert.deepStrictEqual(
			planMinutes(players, options),
			planMinutes(players, { ...options, regulationMinutes: 48 }),
		);
	});

	test("foul trouble sits in a 2-period game, at the same points of the game", () => {
		// Two fouls in the first quarter of an NBA game: sit until 6:00 of the 2nd quarter
		const nba = foulTroubleSitUntil({
			pf: 2,
			period: 1,
			numPeriods: 4,
			foulsNeededToFoulOut: 6,
			quarterSeconds: 720,
		});
		assert.strictEqual(nba, 720 + 360);
		// College (2 x 20, fouling out at 5 is below the rules' minimum of 5? no: 5 is allowed): two fouls early in the first half
		const college = foulTroubleSitUntil({
			pf: 1,
			period: 1,
			numPeriods: 2,
			foulsNeededToFoulOut: 5,
			quarterSeconds: 1200,
			elapsed: 300,
		});
		assert.strictEqual(college, (2400 / 4) * 1.5);
		// 3 fouls in the first half: until halftime
		assert.strictEqual(
			foulTroubleSitUntil({
				pf: 2,
				period: 1,
				numPeriods: 2,
				foulsNeededToFoulOut: 5,
				quarterSeconds: 1200,
				elapsed: 900,
			}),
			1200,
		);
		// Overtime: never
		assert.isUndefined(
			foulTroubleSitUntil({
				pf: 4,
				period: 3,
				numPeriods: 2,
				foulsNeededToFoulOut: 5,
				quarterSeconds: 1200,
				elapsed: 2400,
			}),
		);
	});
});

describe("seeded games with every game simulation feature on", () => {
	const SEEDS = range(12).map((i) => 500 + 31 * i);

	test("NBA length: invariants hold and box scores look like basketball", async () => {
		const results = await simGames({}, SEEDS);
		checkInvariants(results, "nba");
		let pts = 0;
		let fga = 0;
		let tpa = 0;
		for (const result of results) {
			for (const t of result.team) {
				pts += t.stat.pts;
				fga += t.stat.fga;
				tpa += t.stat.tpa;
			}
		}
		const n = results.length * 2;
		assert.isAbove(pts / n, 85);
		assert.isBelow(pts / n, 140);
		assert.isAbove(fga / n, 65);
		assert.isBelow(fga / n, 110);
		assert.isAbove(tpa / fga, 0.2);
		assert.isBelow(tpa / fga, 0.6);
	}, 120_000);

	test("college length (2 x 20, 5 fouls)", async () => {
		const results = await simGames(
			{ numPeriods: 2, quarterLength: 20, foulsNeededToFoulOut: 5 },
			SEEDS.slice(0, 6),
		);
		checkInvariants(results, "college");
		// Starters play a college share of the game, not an NBA plan squeezed into 40 minutes
		for (const result of results) {
			for (const t of result.team) {
				const maxMin = Math.max(...t.player.map((p) => p.stat.min));
				assert.isAtMost(maxMin, 40 + 5 * result.overtimes + 1e-9);
			}
		}
	}, 120_000);

	test("3-on-3", async () => {
		const results = await simGames({ numPlayersOnCourt: 3 }, SEEDS.slice(0, 3));
		checkInvariants(results, "3-on-3");
	}, 120_000);
});

describe("extreme settings", () => {
	const CASES: Record<string, unknown>[] = [
		{ threePointTendencyFactor: 10 },
		{ threePointTendencyFactor: 0 },
		{ threePointAccuracyFactor: 0, twoPointAccuracyFactor: 0 },
		{ threePointAccuracyFactor: 3, twoPointAccuracyFactor: 3 },
		{ ftAccuracyFactor: 0 },
		{ ftAccuracyFactor: 5 },
		{ orbFactor: 0 },
		{ orbFactor: 10 },
		{ foulRateFactor: 0 },
		{ foulRateFactor: 10 },
		{ turnoverFactor: 0, stealFactor: 0, blockFactor: 0 },
		{ turnoverFactor: 5, stealFactor: 5, blockFactor: 5 },
		{ homeCourtAdvantage: 50 },
		{ homeCourtAdvantage: -20 },
		{ pace: 1 },
		{ pace: 300 },
		{ quarterLength: 1 },
		{ quarterLength: 0.1, overtimeLength: 0.1 },
		{ numPeriods: 1, quarterLength: 30 },
	];

	test("no NaN, invariants hold", async () => {
		for (const settings of CASES) {
			const results = await simGames(settings, [77, 78]);
			checkInvariants(results, JSON.stringify(settings));
		}
	}, 300_000);

	test("three-point tendency is capped", async () => {
		const results = await simGames({ threePointTendencyFactor: 100 }, [5, 6]);
		for (const result of results) {
			for (const t of result.team) {
				// Some twos are still taken (putbacks, the shot-type cap), not every shot a three
				assert.isBelow(t.stat.tpa / t.stat.fga, 0.97);
			}
		}
	}, 120_000);

	test("tiny pace doesn't blow up injuries", async () => {
		const results = await simGames({ pace: 0.01 }, [9, 10, 11]);
		let injuries = 0;
		for (const result of results) {
			for (const t of result.team) {
				injuries += t.player.filter((p) => p.injured).length;
			}
		}
		// (a blow-up would be dozens; a handful is the luck of the seeds)
		assert.isAtMost(injuries, 5);
	}, 120_000);
});

describe("settings validation", () => {
	test("game factors must be finite and non-negative", () => {
		for (const key of [
			"threePointTendencyFactor",
			"orbFactor",
			"ftAccuracyFactor",
			"foulRateFactor",
		]) {
			for (const bad of [-0.1, Infinity, -Infinity, Number.NaN]) {
				assert.throws(() => validateGameSimSetting(key, bad));
			}
			validateGameSimSetting(key, 0);
			validateGameSimSetting(key, 2.5);
		}
	});

	test("quarter length, pace and home court", () => {
		assert.throws(() => validateGameSimSetting("quarterLength", 0));
		assert.throws(() => validateGameSimSetting("quarterLength", Infinity));
		validateGameSimSetting("quarterLength", 20);
		assert.throws(() => validateGameSimSetting("pace", 0));
		assert.throws(() => validateGameSimSetting("pace", 1000));
		validateGameSimSetting("pace", 100);
		assert.throws(() => validateGameSimSetting("homeCourtAdvantage", 200));
		assert.throws(() =>
			validateGameSimSetting("homeCourtAdvantage", Number.NaN),
		);
		validateGameSimSetting("homeCourtAdvantage", -5);
		validateGameSimSetting("homeCourtAdvantage", 1);
		// Not a game sim setting: no opinion
		validateGameSimSetting("season", -Infinity);
	});
});
