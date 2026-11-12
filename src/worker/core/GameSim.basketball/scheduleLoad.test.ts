import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import {
	crowdLevel,
	homeCourtModifier,
	isThreeInFour,
	LOAD,
	loadFatigue,
	refLean,
	tiredInjuryWeight,
	travelDistance,
	travelEndurance,
} from "./scheduleLoad.ts";
import { setSimDay } from "../player/injuryDepth.ts";
import { PHASE } from "../../../common/constants.ts";
import { range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";

/*
 * Load, Fatigue & Venue (the scheduleLoad setting, scheduleLoad.ts). Off: nothing runs and no extra random numbers are drawn (the fixed-seed
 * box scores of outcomeInvariance.test.ts are recorded with it off, and the checks below). On: the intended effects. League averages,
 * home win% and injuries are in docs/native-features.md (scheduleLoad.script.test.ts, scheduleLoadSeason.script.test.ts).
 */

afterAll(() => {
	resetG();
	setSimDay(undefined);
});

const load = (
	seed: number,
	settings: Record<string, unknown>,
	teamSeason?: Record<string, unknown>,
) =>
	withSeededRandom(seed, async () => {
		await genTeams();
		g.setWithoutSavingToDB("storePlayByPlay", false);
		for (const [key, value] of Object.entries(settings)) {
			g.setWithoutSavingToDB(key as any, value as any);
		}
		if (teamSeason) {
			const { idb } = await import("../../db/index.ts");
			for (const ts of await idb.cache.teamSeasons.getAll()) {
				Object.assign(ts, teamSeason);
				await idb.cache.teamSeasons.put(ts);
			}
		}
		return loadTeams([0, 1], {});
	});

const game = (
	seed: number,
	settings: Record<string, unknown>,
	neutralSite = false,
) =>
	withSeededRandom(seed, async () => {
		await genTeams();
		g.setWithoutSavingToDB("storePlayByPlay", false);
		for (const [key, value] of Object.entries(settings)) {
			g.setWithoutSavingToDB(key as any, value as any);
		}
		const teams = await loadTeams([0, 1], {});
		const sim: any = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay: false,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite,
		});
		return sim;
	});

test("off: loadTeams adds nothing, the sim uses nothing, the same game whether false or missing", async () => {
	const teams = await load(1, { scheduleLoad: false });
	const t: any = teams[0];
	assert.isUndefined(t.crowdHype);
	assert.isUndefined(t.region);
	assert.isUndefined(t.threeInFour);
	assert.isUndefined(t.player[0].loadInjuryFactor);

	const box = async (settings: Record<string, unknown>) => {
		const sim = await game(2, settings);
		return withSeededRandom(3, () => JSON.stringify(sim.run().team));
	};
	const a = await box({ scheduleLoad: false });
	const b = await box({});
	const c = await box({ scheduleLoad: true });
	assert.strictEqual(a, b);
	assert.notStrictEqual(a, c);

	const sim = await game(4, { scheduleLoad: false });
	assert.isFalse(sim.scheduleLoad);
	assert.deepStrictEqual(sim.foulMult, [1, 1]);
	assert.isUndefined(sim.travelKm);
	assert.strictEqual(sim.fatigue(0.7), sim.fatigue(0.7, false, true));
});

test("fatigue: the same at the reference penalty, gentler when fresh, steeper when tired", () => {
	const x0 = LOAD.fatigueX0;
	assert.closeTo(loadFatigue(1 - x0), 1 - x0, 1e-12);
	assert.closeTo(loadFatigue(1), 1, 1e-12);
	assert.isAbove(loadFatigue(0.95), 0.95);
	assert.isBelow(loadFatigue(0.7), 0.7);
	// each further step of tiredness costs more
	const step = (e: number) => loadFatigue(e) - loadFatigue(e - 0.05);
	assert.isAbove(step(0.75), step(0.95));

	return game(5, { scheduleLoad: true }).then((sim) => {
		// (only the shooter's: the composites and the substitution decisions keep the stock curve, so minutes don't move)
		assert.closeTo(sim.fatigue(0.7), 0.716, 1e-9);
		assert.isBelow(sim.fatigue(0.7, false, true), 0.716);
	});
});

test("injury risk rises with tiredness, the same on average over the court", async () => {
	assert.isAbove(tiredInjuryWeight(0.7), tiredInjuryWeight(0.95));
	assert.isAbove(tiredInjuryWeight(0.7) / tiredInjuryWeight(1), 2);
	// with everyone equally tired, the rate is what it was
	const rate = async (energies: number[]) => {
		const sim = await game(9, { scheduleLoad: true }, true);
		sim.baseInjuryRate = 0.02;
		let n = 0;
		const counts = new Map();
		const original = Math.random;
		Math.random = makeSeededRandom(10);
		try {
			for (let i = 0; i < 1000; i++) {
				for (const t of [0, 1]) {
					for (const [j, p] of sim.playersOnCourt[t].entries()) {
						p.stat.energy = energies[j];
						p.injured = false;
					}
				}
				for (const p of [...sim.playersOnCourt[0], ...sim.playersOnCourt[1]]) {
					p.newInjury = false;
				}
				sim.injuries();
				for (const t of [0, 1]) {
					for (const [j, p] of sim.playersOnCourt[t].entries()) {
						if (p.newInjury) {
							n += 1;
							counts.set(j, (counts.get(j) ?? 0) + 1);
						}
					}
				}
			}
		} finally {
			Math.random = original;
		}
		return { n, counts };
	};
	const flat = await rate([0.8, 0.8, 0.8, 0.8, 0.8]);
	const mixed = await rate([0.6, 0.8, 0.8, 0.8, 1]);
	// (the same number of injuries, give or take, but the tired player gets more of them)
	assert.closeTo(mixed.n / flat.n, 1, 0.25);
	assert.isAbove(mixed.counts.get(0) ?? 0, mixed.counts.get(4) ?? 0);
});

test("3 games in 4 nights", () => {
	assert.isTrue(isThreeInFour(10, 9, 7));
	assert.isTrue(isThreeInFour(10, 8, 7));
	assert.isFalse(isThreeInFour(10, 8, 6));
	assert.isFalse(isThreeInFour(10, 9, undefined));
	assert.isFalse(isThreeInFour(undefined, 9, 8));
});

test("3 games in 4 nights in loadTeams: only with the realistic schedule length, not in the playoffs", async () => {
	setSimDay(10);
	try {
		const ts = { lastGameDay: 9, prevGameDay: 7 };
		// realistic schedule length (fewer days with daily processes than calendar days)
		const on = await load(
			6,
			{
				scheduleLoad: true,
				phase: PHASE.REGULAR_SEASON,
				scheduleDayScale: 0.55,
			},
			ts,
		);
		const p: any = on[0]!.player[0];
		assert.isTrue((on[0] as any).threeInFour);
		assert.closeTo(
			p.loadInjuryFactor,
			LOAD.injuryNorm * LOAD.threeInFourInjury,
			1e-12,
		);
		const fresh = await load(
			6,
			{
				scheduleLoad: true,
				phase: PHASE.REGULAR_SEASON,
				scheduleDayScale: 0.55,
			},
			{ lastGameDay: 8, prevGameDay: 5 },
		);
		assert.isFalse((fresh[0] as any).threeInFour);
		assert.closeTo(
			on[0]!.player[0]!.compositeRating.endurance /
				fresh[0]!.player[0]!.compositeRating.endurance,
			LOAD.threeInFourEndurance,
			1e-9,
		);
		// Injury Depth's back-to-back risk, retuned for the realistic schedule
		const depth = await load(
			6,
			{
				scheduleLoad: true,
				injuryDepth: true,
				phase: PHASE.REGULAR_SEASON,
				scheduleDayScale: 0.55,
			},
			{ lastGameDay: 8, prevGameDay: 5 },
		);
		assert.closeTo(
			(depth[0]!.player[0] as any).loadInjuryFactor,
			LOAD.injuryNorm * LOAD.injuryDepthRealisticSchedule,
			1e-12,
		);
		// The old compact schedule (and college mode): teams play nearly every day, no 3-in-4s and no normalization
		const old = await load(
			6,
			{ scheduleLoad: true, phase: PHASE.REGULAR_SEASON, scheduleDayScale: 1 },
			ts,
		);
		assert.isFalse((old[0] as any).threeInFour);
		assert.strictEqual((old[0]!.player[0] as any).loadInjuryFactor, 1);
		const playoffs = await load(
			6,
			{ scheduleLoad: true, phase: PHASE.PLAYOFFS, scheduleDayScale: 0.55 },
			ts,
		);
		assert.isFalse((playoffs[0] as any).threeInFour);
	} finally {
		setSimDay(undefined);
	}
});

test("home court: base and crowd parts, larger in the playoffs, and the referees' lean", async () => {
	assert.isAbove(
		homeCourtModifier(1, crowdLevel(1, false)),
		homeCourtModifier(1, crowdLevel(0, false)),
	);
	assert.isAbove(crowdLevel(0.5, true), crowdLevel(0.5, false));
	assert.closeTo(crowdLevel(0.5, false), 1, 1e-12);
	// the average crowd: the composites get (base + crowd) of the setting, the rest is the referees'
	assert.closeTo(
		homeCourtModifier(1, 1),
		1 + 0.01 * (LOAD.baseShare + LOAD.crowdShare),
		1e-12,
	);
	assert.closeTo(refLean(1), LOAD.refFoulLean, 1e-12);
	assert.strictEqual(refLean(0), 0);

	const sim = await game(7, {
		scheduleLoad: true,
		scheduleLoadRefVariance: false,
	});
	assert.closeTo(sim.foulMult[0], 1 - LOAD.refFoulLean, 1e-12);
	assert.closeTo(sim.foulMult[1], 1 + LOAD.refFoulLean, 1e-12);
	// neutral site: no home court at all
	const neutral = await game(
		7,
		{
			scheduleLoad: true,
			scheduleLoadRefVariance: false,
		},
		true,
	);
	assert.deepStrictEqual(neutral.foulMult, [1, 1]);
	assert.isUndefined(neutral.travelKm);
});

test("referee crews: one draw per game, only with the option", async () => {
	const draws = async (option: boolean) => {
		const original = Math.random;
		let n = 0;
		await withSeededRandom(8, async () => {
			await genTeams();
			g.setWithoutSavingToDB("scheduleLoad", true);
			g.setWithoutSavingToDB("scheduleLoadRefVariance", option);
			const teams = await loadTeams([0, 1], {});
			const inner = Math.random;
			Math.random = () => {
				n += 1;
				return inner();
			};
			try {
				new GameSim({
					gid: 8,
					teams: [teams[0]!, teams[1]!],
					baseInjuryRate: 0,
					doPlayByPlay: false,
					homeCourtFactor: 1,
					allStarGame: false,
					neutralSite: true,
				});
			} finally {
				Math.random = inner;
			}
		});
		Math.random = original;
		return n;
	};
	const withOption = await draws(true);
	const without = await draws(false);
	// (the gaussian draw takes two uniform numbers)
	assert.isAbove(withOption, without);
	assert.isAtMost(withOption - without, 2);

	const crews = [];
	for (const seed of range(30)) {
		const sim = await game(100 + seed, { scheduleLoad: true }, true);
		crews.push(sim.foulMult[0]);
	}
	const mean = crews.reduce((a, b) => a + b, 0) / crews.length;
	assert.closeTo(mean, 1, 0.05);
	assert.isAbove(Math.max(...crews) - Math.min(...crews), 0.1);
});

test("travel: by distance between the teams' regions, nothing without coordinates", () => {
	const d = travelDistance("Boston", "Los Angeles")!;
	assert.closeTo(d, 4170, 100);
	assert.isBelow(travelDistance("New York", "Philadelphia")!, 200);
	assert.isUndefined(travelDistance("Boston", "Nowhere Town"));
	assert.isUndefined(travelDistance(undefined, "Boston"));
	assert.strictEqual(travelEndurance(undefined), 1);
	assert.closeTo(travelEndurance(10000), 1 - LOAD.travelMax, 1e-12);
	assert.isAbove(travelEndurance(500), travelEndurance(3000));
});

test("on: the home team draws more free throws, games still sane, with the other sim extras too", async () => {
	for (const settings of [
		{ scheduleLoad: true },
		{
			scheduleLoad: true,
			smartEndgame: true,
			realisticPossessions: true,
			realisticRotations: true,
			simFixes: true,
			positionalComposites: true,
			expandedRatings: true,
			playerTraits: true,
			technicalFouls: true,
			spacingCreation: true,
			matchupDefense: true,
			injuryDepth: true,
		},
	]) {
		let pts = 0;
		let min = 0;
		const seeds = range(8).map((i) => 900 + i * 13);
		for (const seed of seeds) {
			const sim = await game(seed, settings);
			const result = await withSeededRandom(seed, () => sim.run());
			for (const t of result.team) {
				pts += t.stat.pts;
				for (const p of t.player) {
					min += p.stat.min;
				}
			}
		}
		const n = seeds.length * 2;
		assert.isAbove(pts / n, 80);
		assert.isBelow(pts / n, 135);
		assert.isAbove(min / n, 239);
	}
});
