import { afterEach, assert, describe, test, vi } from "vitest";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import fs from "node:fs";
import GameSim from "./index.ts";
import { player, team } from "../index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g, helpers } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { PHASE } from "../../../common/constants.ts";
import { setSimDay } from "../player/injuryDepth.ts";
import {
	EFFECT_AMPLITUDES,
	NEUTRAL_SCORES,
	traitEffects,
	type TraitKey,
} from "../../../common/playerTraits/index.ts";
import {
	leagueAverages,
	mean,
	sd,
	simTraitGames,
	thirdsByTrait,
} from "./traitsMetrics.ts";
import getInjuryRate from "./getInjuryRate.ts";

/*
 * Player traits in the game sim (the playerTraits setting, docs/player-traits.md, part 2). Hard requirements checked here:
 * - the traits work in the pure sim: the same seeded game gives the same box score with play-by-play logging off, live and stored, with
 *   realisticPossessions, technicalFouls and injuryDepth on or off
 * - each hook changes the sim's numbers by the designed amount (the wiring tests)
 * - league averages with traits on are the same as with them off (calibration; the big table: TRAITS_METRICS=1)
 */

const env = (globalThis as any).process?.env ?? {};

afterEach(() => {
	vi.restoreAllMocks();
	setSimDay(undefined);
});

const setupLeague = async ({
	seed,
	traits,
	realistic,
	techFouls,
	injuryDepth,
}: {
	seed: number;
	traits: boolean;
	realistic: boolean;
	techFouls: boolean;
	injuryDepth: boolean;
}) => {
	resetG();
	g.setWithoutSavingToDB("season", 2013);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("playerTraits", traits);
	g.setWithoutSavingToDB("playerTraitsSeed", 12345);
	g.setWithoutSavingToDB("realisticPossessions", realistic);
	g.setWithoutSavingToDB("technicalFouls", techFouls);
	g.setWithoutSavingToDB("injuryDepth", injuryDepth);
	// High, so injuries actually happen in a single game
	g.setWithoutSavingToDB("injuryRate", 0.005);
	const teamsDefault = helpers.getTeamsDefault().slice(0, 2);
	const players = [
		...range(15).map(() => player.generate(0, 25, 2010, true, DEFAULT_LEVEL)),
		...range(15).map(() => player.generate(1, 25, 2010, true, DEFAULT_LEVEL)),
	];
	for (const [i, p] of players.entries()) {
		if (injuryDepth && i % 3 === 0) {
			p.health = {
				restrict: 5,
				restrictTotal: 8,
				returnGames: 10,
				bodyPart: "Knee",
			};
		}
		if (injuryDepth && i % 5 === 0) {
			p.born.year = 1978;
		}
	}
	const teamSeasons = teamsDefault.map((t) => team.genSeasonRow(t));
	for (const ts of teamSeasons) {
		ts.lastGameDay = 9;
	}
	await resetCache({
		players,
		teams: teamsDefault.map((t) => ({
			...team.generate(t),
			loadManagement: true,
		})),
		teamSeasons,
		teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
	});
	setSimDay(10);
	void seed;
};

type Mode = "off" | "stored" | "live";

const simGame = async (
	seed: number,
	mode: Mode,
	config: {
		traits: boolean;
		realistic: boolean;
		techFouls: boolean;
		injuryDepth: boolean;
	},
) => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		await setupLeague({ seed, ...config });
		// off: the sim logs no events at all; stored: it logs what a stored play-by-play needs; live: everything
		g.setWithoutSavingToDB("storePlayByPlay", mode === "stored");
		const teams = await loadTeams([0, 1], {});
		const sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay: mode === "live",
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		const traitsOn = (sim as any).traitsOn as boolean;
		const result = sim.run();
		return {
			traitsOn,
			hasEvents: result.playByPlay !== undefined,
			box: JSON.stringify({
				overtimes: result.overtimes,
				clutchPlays: result.clutchPlays.map((c) => c.text),
				team: result.team.map((t) => ({
					id: t.id,
					stat: t.stat,
					players: t.player.map((p) => ({
						id: p.id,
						stat: p.stat,
						injured: p.injured,
						newInjury: p.newInjury,
						skills: p.skills,
					})),
				})),
			}),
		};
	} finally {
		Math.random = original;
	}
};

const SEEDS = range(5).map((i) => 301 + i * 29);

describe("traits in the pure sim (no play-by-play)", () => {
	for (const realistic of [false, true]) {
		for (const techFouls of [false, true]) {
			test(`traits on, realisticPossessions ${realistic}, technicalFouls ${techFouls}, injuryDepth on: identical box scores with play-by-play off, stored and live`, async () => {
				const config = {
					traits: true,
					realistic,
					techFouls,
					injuryDepth: true,
				};
				let numTraitsOn = 0;
				for (const seed of SEEDS) {
					const off = await simGame(seed, "off", config);
					const stored = await simGame(seed, "stored", config);
					const live = await simGame(seed, "live", config);
					assert.isTrue(off.traitsOn);
					assert.isFalse(off.hasEvents, "no logging in the pure sim");
					assert.strictEqual(stored.box, off.box, `stored, seed ${seed}`);
					assert.strictEqual(live.box, off.box, `live, seed ${seed}`);
					numTraitsOn += off.traitsOn ? 1 : 0;
				}
				assert.strictEqual(numTraitsOn, SEEDS.length);
			});
		}
	}

	test("traits on actually changes games, traits off does not touch them", async () => {
		let differ = 0;
		for (const seed of SEEDS) {
			const base = {
				realistic: false,
				techFouls: false,
				injuryDepth: false,
			};
			const off = await simGame(seed, "off", { ...base, traits: false });
			const off2 = await simGame(seed, "off", { ...base, traits: false });
			const on = await simGame(seed, "off", { ...base, traits: true });
			assert.isFalse(off.traitsOn);
			assert.strictEqual(off.box, off2.box);
			if (on.box !== off.box) {
				differ += 1;
			}
		}
		assert.strictEqual(differ, SEEDS.length);
	});
});

/* ---- Wiring: each hook moves the sim's numbers by the designed amount ---- */

const scoresWith = (changes: Partial<Record<TraitKey, number>>) => ({
	...NEUTRAL_SCORES,
	...changes,
});

// A sim with trait effects on every player (neutral unless changed), the clock and score set by the caller
const makeSim = async () => {
	// Seeded: these tests compare exact deltas, which only hold when probabilities aren't clipped, so they must not depend on randomly generated players
	const original = Math.random;
	Math.random = makeSeededRandom(1);
	try {
		return await makeSimInner();
	} finally {
		Math.random = original;
	}
};

const makeSimInner = async () => {
	await setupLeague({
		seed: 1,
		traits: false,
		realistic: false,
		techFouls: false,
		injuryDepth: false,
	});
	const teams = await loadTeams([0, 1], {});
	for (const t of [teams[0]!, teams[1]!] as any[]) {
		for (const p of t.player) {
			p.traitEffects = traitEffects(scoresWith({}));
			p.gameZ = 0;
		}
	}
	const sim = new GameSim({
		gid: 1,
		teams: [teams[0]!, teams[1]!],
		baseInjuryRate: 0,
		doPlayByPlay: false,
		homeCourtFactor: 1,
		allStarGame: false,
		neutralSite: false,
	}) as any;
	sim.traitsOn = true;
	sim.o = 0;
	sim.d = 1;
	sim.updateTeamCompositeRatings();
	return sim;
};

const setEffects = (
	sim: any,
	t: 0 | 1,
	changes: Partial<Record<TraitKey, number>>,
	players?: number[],
) => {
	for (const [i, p] of sim.playersOnCourt[t].entries()) {
		if (!players || players.includes(i)) {
			p.traitEffects = traitEffects(scoresWith(changes));
		}
	}
};

const shotProb = (sim: any, p: any, passer?: any) => {
	// Fixed random numbers: same shot type for every call
	vi.spyOn(Math, "random").mockReturnValue(0.5);
	const out = sim.getShotInfo({
		currentFatigue: 1,
		lateGamePutBack: false,
		p,
		passer,
		tipInFromOutOfBounds: false,
		putBack: false,
	});
	vi.restoreAllMocks();
	return out;
};

const clutchTime = (sim: any) => {
	sim.t = 60;
	sim.team[0].stat.ptsQtrs = [20, 20, 20, 20];
	sim.team[1].stat.ptsQtrs = [20, 20, 20, 20];
	sim.team[0].stat.pts = 80;
	sim.team[1].stat.pts = 80;
};

describe("trait hooks in the sim", () => {
	test("clutch: shot and free throw probability and turnovers in clutch time, nothing outside it", async () => {
		const sim = await makeSim();
		const p = sim.playersOnCourt[0][0];
		const neutral = shotProb(sim, p);

		// Early in the game: no clutch effect
		setEffects(sim, 0, { clutch: 90 });
		const early = shotProb(sim, p);
		assert.closeTo(early.probMake, neutral.probMake, 1e-12);
		assert.closeTo(sim.freeThrowProb(0, p), sim.freeThrowProb(0, p), 0);

		clutchTime(sim);
		setEffects(sim, 0, { clutch: 50 });
		const base = shotProb(sim, p).probMake;
		const baseFt = sim.freeThrowProb(0, p);
		const baseTov = sim.probTov();
		setEffects(sim, 0, { clutch: 90 });
		assert.closeTo(
			shotProb(sim, p).probMake - base,
			EFFECT_AMPLITUDES.clutchShot,
			1e-9,
		);
		assert.closeTo(
			sim.freeThrowProb(0, p) - baseFt,
			EFFECT_AMPLITUDES.clutchFt,
			1e-9,
		);
		assert.closeTo(
			sim.probTov() / baseTov,
			1 - EFFECT_AMPLITUDES.clutchTurnover,
			1e-9,
		);
		setEffects(sim, 0, { clutch: 10 });
		assert.closeTo(
			shotProb(sim, p).probMake - base,
			-EFFECT_AMPLITUDES.clutchShot,
			1e-9,
		);
		// Not close any more: gone
		sim.team[0].stat.pts = 100;
		assert.closeTo(shotProb(sim, p).probMake, shotProb(sim, p).probMake, 0);
		setEffects(sim, 0, { clutch: 50 });
		const blowoutBase = shotProb(sim, p).probMake;
		setEffects(sim, 0, { clutch: 90 });
		assert.closeTo(shotProb(sim, p).probMake, blowoutBase, 1e-12);
	});

	test("game form: one normal draw per player per game, scaled by consistency", async () => {
		const sim = await makeSim();
		const p = sim.playersOnCourt[0][0];
		p.gameZ = 1;
		setEffects(sim, 0, { consistency: 50 });
		const base = shotProb(sim, p).probMake;
		p.gameZ = 0;
		const zero = shotProb(sim, p).probMake;
		assert.closeTo(base - zero, EFFECT_AMPLITUDES.gameFormSd, 1e-9);

		// Volatile players (low consistency) swing more, steady ones less
		p.gameZ = 1;
		setEffects(sim, 0, { consistency: 10 });
		const volatile = shotProb(sim, p).probMake - zero;
		setEffects(sim, 0, { consistency: 90 });
		const steady = shotProb(sim, p).probMake - zero;
		assert.closeTo(volatile, EFFECT_AMPLITUDES.gameFormSd * 1.4, 1e-9);
		assert.closeTo(steady, EFFECT_AMPLITUDES.gameFormSd * 0.6, 1e-9);

		// The draw: once per player, only with effects. Over many games sd(delta) is in the ratio of the variance scales
		const deltas: Record<string, number[]> = { volatile: [], steady: [] };
		for (const seed of range(400)) {
			const original = Math.random;
			Math.random = makeSeededRandom(seed);
			try {
				const teams = await loadTeams([0, 1], {});
				for (const t of [teams[0]!, teams[1]!] as any[]) {
					for (const [j, tp] of t.player.entries()) {
						tp.traitEffects = traitEffects(
							scoresWith({ consistency: j % 2 === 0 ? 10 : 90 }),
						);
					}
				}
				const s2 = new GameSim({
					gid: seed,
					teams: [teams[0]!, teams[1]!],
					baseInjuryRate: 0,
					doPlayByPlay: false,
					homeCourtFactor: 1,
					allStarGame: false,
					neutralSite: false,
				}) as any;
				for (const [j, tp] of s2.team[0].player.entries()) {
					deltas[j % 2 === 0 ? "volatile" : "steady"]!.push(
						tp.traitEffects.gameFormShotDelta(tp.gameZ),
					);
				}
			} finally {
				Math.random = original;
			}
		}
		assert.closeTo(mean(deltas["volatile"]!), 0, 0.004);
		assert.closeTo(
			sd(deltas["volatile"]!) / sd(deltas["steady"]!),
			1.4 / 0.6,
			0.3,
		);
	});

	test("no trait effects, no extra random numbers", async () => {
		await setupLeague({
			seed: 1,
			traits: false,
			realistic: false,
			techFouls: false,
			injuryDepth: false,
		});
		const teams = await loadTeams([0, 1], {});
		assert.isUndefined((teams[0] as any).player[0].traitEffects);
		const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
		const sim = new GameSim({
			gid: 1,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: 0,
			doPlayByPlay: false,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		}) as any;
		assert.isFalse(sim.traitsOn);
		const callsAfterConstructor = random.mock.calls.length;
		// (the constructor draws a few numbers of its own for the lineups; with traits on it would draw 2 or more per player on top)
		const teams2 = await loadTeams([0, 1], {});
		for (const t of [teams2[0]!, teams2[1]!] as any[]) {
			for (const p of t.player) {
				p.traitEffects = traitEffects(scoresWith({}));
			}
		}
		const before = random.mock.calls.length;
		new GameSim({
			gid: 1,
			teams: [teams2[0]!, teams2[1]!],
			baseInjuryRate: 0,
			doPlayByPlay: false,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		const withTraits = random.mock.calls.length - before;
		assert.isAtLeast(
			withTraits - callsAfterConstructor,
			2 * (teams2[0] as any).player.length,
		);
	});

	test("shot selection: gunners (low shot discipline) take more shots at a lower make probability, disciplined players fewer at a higher one", async () => {
		const sim = await makeSim();
		const i = 2;
		const p = sim.playersOnCourt[0][i];
		const usage = p.compositeRating.usage;
		const weights = () => {
			const arr = sim.ratingArray("usage", 0, 1.25, new Array(5));
			return arr as number[];
		};
		const neutralWeights = [...weights()];
		const neutralProb = shotProb(sim, p).probMake;

		setEffects(sim, 0, { shotDiscipline: 10 }, [i]);
		const gunner = weights();
		assert.closeTo(
			gunner[i]! / neutralWeights[i]!,
			1 + EFFECT_AMPLITUDES.shotAttemptWeight * usage,
			1e-9,
		);
		assert.closeTo(
			shotProb(sim, p).probMake - neutralProb,
			-EFFECT_AMPLITUDES.shotQuality * usage,
			1e-9,
		);

		setEffects(sim, 0, { shotDiscipline: 90 }, [i]);
		const disciplined = weights();
		assert.closeTo(
			disciplined[i]! / neutralWeights[i]!,
			1 - EFFECT_AMPLITUDES.shotAttemptWeight * usage,
			1e-9,
		);
		assert.closeTo(
			shotProb(sim, p).probMake - neutralProb,
			EFFECT_AMPLITUDES.shotQuality * usage,
			1e-9,
		);
	});

	test("screens: assisted shots get screenShotDelta, spacing and screens add to the team's offensive synergy", async () => {
		const sim = await makeSim();
		const p = sim.playersOnCourt[0][0];
		const passer = sim.playersOnCourt[0][1];
		const base = shotProb(sim, p, passer).probMake;
		const baseSynergy = sim.team[0].synergy.off;
		setEffects(sim, 0, { screen: 90 }, [0]);
		const withScreen = shotProb(sim, p, passer);
		// (the shot type is fixed by the mocked random numbers; the delta only applies to jumpers and finishes off a pass)
		assert.closeTo(
			withScreen.probMake - base,
			EFFECT_AMPLITUDES.screenShot,
			1e-9,
		);
		assert.closeTo(shotProb(sim, p).probMake - shotProb(sim, p).probMake, 0, 0);

		// Unassisted: no screen effect
		setEffects(sim, 0, { screen: 50 }, [0]);
		const unassistedBase = shotProb(sim, p).probMake;
		setEffects(sim, 0, { screen: 90 }, [0]);
		assert.closeTo(shotProb(sim, p).probMake, unassistedBase, 1e-12);

		// Synergy: five good screeners and movers
		setEffects(sim, 0, { screen: 90, offBall: 90 });
		sim.updateSynergy();
		assert.closeTo(
			sim.team[0].synergy.off - baseSynergy,
			5 * (EFFECT_AMPLITUDES.spacing + EFFECT_AMPLITUDES.screenSynergy),
			1e-9,
		);
		setEffects(sim, 0, { screen: 10, offBall: 10 });
		sim.updateSynergy();
		assert.closeTo(
			sim.team[0].synergy.off - baseSynergy,
			-5 * (EFFECT_AMPLITUDES.spacing + EFFECT_AMPLITUDES.screenSynergy),
			1e-9,
		);
	});

	test("hustle, fouls, steals: who gets the loose balls, fouls and steals, and how often a team fouls and steals", async () => {
		const sim = await makeSim();
		const i = 1;
		const base = {
			rebounding: [...sim.ratingArray("rebounding", 0, 3, new Array(5))],
			stealing: [...sim.ratingArray("stealing", 0, 4, new Array(5))],
			fouling: [...sim.ratingArray("fouling", 0, 1, new Array(5))],
		};
		const baseNonShootingFoul = sim.probNonShootingFoul();
		const baseSteal = sim.probStl();

		setEffects(sim, 0, { hustle: 90 }, [i]);
		assert.closeTo(
			sim.ratingArray("rebounding", 0, 3, new Array(5))[i] / base.rebounding[i],
			1 + EFFECT_AMPLITUDES.hustle,
			1e-9,
		);
		assert.closeTo(
			sim.ratingArray("stealing", 0, 4, new Array(5))[i] / base.stealing[i],
			1 + EFFECT_AMPLITUDES.hustle,
			1e-9,
		);

		// Foul discipline: disciplined players foul less (and take fewer gambles), the fouling defense of a whole team does too
		setEffects(sim, 0, { foulDiscipline: 90 }, [i]);
		assert.closeTo(
			sim.ratingArray("fouling", 0, 1, new Array(5))[i] / base.fouling[i],
			1 - EFFECT_AMPLITUDES.foul,
			1e-9,
		);
		setEffects(sim, 1, { foulDiscipline: 90 });
		// (team 1 defends, o = 0)
		assert.closeTo(
			sim.probNonShootingFoul() / baseNonShootingFoul,
			1 - EFFECT_AMPLITUDES.foul,
			1e-9,
		);
		assert.closeTo(
			sim.probStl() / baseSteal,
			1 - EFFECT_AMPLITUDES.gambleSteal,
			1e-9,
		);
		setEffects(sim, 1, { foulDiscipline: 10 });
		assert.closeTo(
			sim.probNonShootingFoul() / baseNonShootingFoul,
			1 + EFFECT_AMPLITUDES.foul,
			1e-9,
		);
		assert.closeTo(
			sim.probStl() / baseSteal,
			1 + EFFECT_AMPLITUDES.gambleSteal,
			1e-9,
		);
	});

	test("handle under pressure: turnover probability", async () => {
		const sim = await makeSim();
		const base = sim.probTov();
		const pressure = sim.traitPressure(0);
		setEffects(sim, 0, { handle: 90 });
		assert.closeTo(
			sim.probTov() / base,
			1 - EFFECT_AMPLITUDES.pressureTurnover * pressure,
			1e-9,
		);
		setEffects(sim, 0, { handle: 10 });
		assert.closeTo(
			sim.probTov() / base,
			1 + EFFECT_AMPLITUDES.pressureTurnover * pressure,
			1e-9,
		);
	});

	test("recovery: energy regained on the bench", async () => {
		const sim = await makeSim();
		const bench = sim.team[0].player.find(
			(p: any) => !sim.playersOnCourt[0].includes(p),
		);
		const regained = (recovery: number) => {
			bench.traitEffects = traitEffects(scoresWith({ recovery }));
			bench.stat.energy = 0.2;
			sim.updatePlayingTime(60);
			return bench.stat.energy - 0.2;
		};
		const base = regained(50);
		assert.closeTo(regained(90) / base, 1 + EFFECT_AMPLITUDES.recovery, 1e-9);
		assert.closeTo(regained(10) / base, 1 - EFFECT_AMPLITUDES.recovery, 1e-9);
	});

	test("durability: injury rate, combined with the injury depth factor", async () => {
		const sim = await makeSim();
		const p = sim.playersOnCourt[0][0];
		sim.baseInjuryRate = 0.01;
		const rate = getInjuryRate(
			(0.01 * 100) / g.get("pace"),
			p.age,
			p.injury.gamesRemaining > 0,
		);
		// The same draw hurts a fragile player and not a durable one: exactly the neutral rate
		const draw = rate;
		const hurts = (durability: number, riskFactor = 1) => {
			for (const t of sim.team) {
				for (const q of t.player) {
					q.injured = false;
					q.newInjury = false;
				}
			}
			p.traitEffects = traitEffects(scoresWith({ durability }));
			p.injuryRiskFactor = riskFactor;
			vi.spyOn(Math, "random").mockReturnValue(draw * 0.9999);
			sim.injuries();
			vi.restoreAllMocks();
			return p.injured as boolean;
		};
		// at exactly the neutral rate (just under), a neutral player is hurt; a durable one (rate x0.7) is not; a fragile one is
		assert.isTrue(hurts(50));
		assert.isFalse(hurts(90));
		assert.isTrue(hurts(10));
		// Combined with the injury depth factor: durable (0.7) x risky (1.5) = 1.05 of the neutral rate
		assert.isTrue(hurts(90, 1.5));
		assert.isFalse(hurts(90, 1.3));
	});

	test("late-game IQ: poor decision makers sometimes miss the foul, never outside the last four minutes", async () => {
		const sim = await makeSim();
		// 3 points up with 30 s left in the 4th: the defense (team 1) should foul
		sim.t = 30;
		sim.team[0].stat.ptsQtrs = [20, 20, 20, 20];
		sim.team[1].stat.ptsQtrs = [20, 20, 20, 20];
		sim.team[0].stat.pts = 83;
		sim.team[1].stat.pts = 80;
		const run = (iq: number, n = 2000) => {
			setEffects(sim, 1, { lateGameIq: iq });
			const original = Math.random;
			Math.random = makeSeededRandom(7);
			let correct = 0;
			for (let k = 0; k < n; k++) {
				if (
					sim.applyLateGameDecision("intentionalFoul") === "intentionalFoul"
				) {
					correct += 1;
				}
			}
			Math.random = original;
			return correct / n;
		};
		const good = run(95);
		const neutral = run(50);
		const bad = run(5);
		assert.isAbove(good, neutral);
		assert.isAbove(neutral, bad);
		assert.isAtLeast(good, 0.99);
		assert.closeTo(
			bad,
			1 - 0.06 - EFFECT_AMPLITUDES.lateGameDecision * 1,
			0.05,
		);

		// Not in the last four minutes, and not in other decisions
		sim.t = 600;
		setEffects(sim, 1, { lateGameIq: 5 });
		assert.strictEqual(
			sim.applyLateGameDecision("intentionalFoul"),
			"intentionalFoul",
		);
		sim.t = 30;
		assert.strictEqual(sim.applyLateGameDecision("catchUp"), "catchUp");
		assert.isUndefined(sim.applyLateGameDecision(undefined));
	});

	test("leadership: team chemistry moves every team composite rating a little", async () => {
		const sim = await makeSim();
		sim.updateTeamCompositeRatings();
		const base = { ...sim.team[0].compositeRating };
		const keys = [
			"dribbling",
			"passing",
			"rebounding",
			"defense",
			"defensePerimeter",
			"blocking",
		];
		setEffects(sim, 0, { leadership: 90 });
		sim.updateTeamCompositeRatings();
		const factor = 1 + EFFECT_AMPLITUDES.chemistryTeam * Math.tanh(1.5);
		for (const key of keys) {
			assert.closeTo(
				sim.team[0].compositeRating[key] / base[key],
				factor,
				1e-9,
			);
		}
		setEffects(sim, 0, { leadership: 10 });
		sim.updateTeamCompositeRatings();
		for (const key of keys) {
			assert.closeTo(
				sim.team[0].compositeRating[key] / base[key],
				2 - factor,
				1e-9,
			);
		}
		// The other team is untouched
		const other = { ...sim.team[1].compositeRating };
		sim.updateTeamCompositeRatings();
		assert.deepStrictEqual(sim.team[1].compositeRating, other);
	});

	test("possession model hooks: shot discipline and consistency come from the real traits", async () => {
		const sim = await makeSim();
		sim.realPoss = true;
		const neutral = sim.violationTendency();
		sim.traits = [
			{ shotDiscipline: 1, consistency: 1 },
			{ shotDiscipline: 1, consistency: 1 },
		];
		const { deriveTraits } = await import("./possessionModel.ts");
		const disciplined = deriveTraits(
			sim.playersOnCourt[0].map(() =>
				traitEffects(scoresWith({ shotDiscipline: 90, consistency: 90 })),
			),
		);
		const wild = deriveTraits(
			sim.playersOnCourt[0].map(() =>
				traitEffects(scoresWith({ shotDiscipline: 10, consistency: 10 })),
			),
		);
		assert.isBelow(disciplined.shotDiscipline, 1);
		assert.isAbove(wild.shotDiscipline, 1);
		assert.isBelow(disciplined.consistency, 1);
		assert.isAbove(wild.consistency, 1);
		sim.traits = [disciplined, disciplined];
		assert.isBelow(sim.violationTendency(), neutral);
		sim.traits = [wild, wild];
		assert.isAbove(sim.violationTendency(), neutral);
		assert.deepStrictEqual(
			deriveTraits(sim.playersOnCourt[0].map(() => undefined)),
			{ shotDiscipline: 1, consistency: 1 },
		);
	});
});

/* ---- League averages and effects over many games ---- */

test("a small calibration check: league averages with traits on stay close to traits off", async () => {
	const numGames = Number(env.TRAITS_GAMES ?? 250);
	const off = leagueAverages(await simTraitGames({ traits: false, numGames }));
	const on = leagueAverages(await simTraitGames({ traits: true, numGames }));
	// Loose bounds: this is a smoke test with few games (the 1000-game table is TRAITS_METRICS=1)
	assert.closeTo(on.pts / off.pts, 1, 0.03);
	assert.closeTo(on.fgPct / off.fgPct, 1, 0.02);
	assert.closeTo(on.tpaRate / off.tpaRate, 1, 0.04);
	assert.closeTo(on.tovPct / off.tovPct, 1, 0.06);
	assert.closeTo(on.ftPct / off.ftPct, 1, 0.02);
	assert.closeTo(on.pfPerGame / off.pfPerGame, 1, 0.05);
}, 600_000);

const fmt = (x: number) => (Math.abs(x) < 1 ? x.toFixed(4) : x.toFixed(2));

test.skipIf(!env.TRAITS_METRICS)(
	"prints league averages with traits off and on, and the effects of individual traits",
	{ timeout: 60 * 60 * 1000 },
	async () => {
		const numGames = Number(env.TRAITS_METRICS_GAMES ?? 1000);
		const lines: string[] = [];
		for (const realistic of [false, true]) {
			const offRaw = await simTraitGames({
				traits: false,
				numGames,
				realistic,
			});
			const onRaw = await simTraitGames({ traits: true, numGames, realistic });
			const off = leagueAverages(offRaw);
			const on = leagueAverages(onRaw);
			lines.push(
				`\nLeague averages over ${numGames} games each (realisticPossessions ${realistic})`,
				`${"metric".padEnd(18)}${"off".padStart(10)}${"on".padStart(10)}${"diff %".padStart(9)}`,
			);
			for (const key of Object.keys(off) as (keyof typeof off)[]) {
				lines.push(
					`${key.padEnd(18)}${fmt(off[key]).padStart(10)}${fmt(on[key]).padStart(10)}${((100 * (on[key] / off[key] - 1)).toFixed(2) + "%").padStart(9)}`,
				);
			}

			// Effects: players in the top and bottom thirds of a trait (by the traits-on run), the same players with traits off
			const lookup = (res: typeof onRaw, keys: string[]) =>
				keys.map((k) => res.players.get(k)!).filter(Boolean);
			const keyOf = (res: typeof onRaw, line: any) =>
				[...res.players.entries()].find(([, l]) => l === line)![0];
			const per36 = (ls: { fga: number; min: number }[]) =>
				(36 * ls.reduce((a, l) => a + l.fga, 0)) /
				ls.reduce((a, l) => a + l.min, 0);
			const fgp = (ls: { fg: number; fga: number }[]) =>
				ls.reduce((a, l) => a + l.fg, 0) / ls.reduce((a, l) => a + l.fga, 0);

			lines.push(
				"",
				"Shot selection (shot discipline, bottom vs top third of rotation players): FGA per 36 min, FG%",
			);
			const sd3 = thirdsByTrait(onRaw, "shotDiscipline");
			for (const [name, group] of [
				["gunners (low)", sd3.low],
				["disciplined (high)", sd3.high],
			] as const) {
				const keys = group.map((l) => keyOf(onRaw, l));
				const offGroup = lookup(offRaw, keys);
				lines.push(
					`  ${name.padEnd(20)} traits off: ${per36(offGroup).toFixed(2)} FGA, ${(100 * fgp(offGroup)).toFixed(1)}%   traits on: ${per36(group).toFixed(2)} FGA, ${(100 * fgp(group)).toFixed(1)}%`,
				);
			}

			lines.push(
				"",
				"Clutch (mean make probability of shots in clutch time, weighted by how clutch the moment is):",
			);
			const cl3 = thirdsByTrait(onRaw, "clutch");
			for (const [name, group] of [
				["low clutch", cl3.low],
				["high clutch", cl3.high],
			] as const) {
				const keys = group.map((l) => keyOf(onRaw, l));
				const offGroup = lookup(offRaw, keys);
				const clutchP = (ls: typeof group) =>
					ls.reduce((a, l) => a + l.clutchProbSum, 0) /
					ls.reduce((a, l) => a + l.clutchWeightSum, 0);
				lines.push(
					`  ${name.padEnd(20)} traits off: ${(100 * clutchP(offGroup)).toFixed(2)}%   traits on: ${(100 * clutchP(group)).toFixed(2)}%  (diff ${(100 * (clutchP(group) - clutchP(offGroup))).toFixed(2)} points)`,
				);
			}

			lines.push(
				"",
				"Game-to-game variance (consistency): sd of per-game FG% for games with 6+ FGA",
			);
			const co3 = thirdsByTrait(onRaw, "consistency");
			for (const [name, group] of [
				["volatile (low)", co3.low],
				["steady (high)", co3.high],
			] as const) {
				const keys = group.map((l) => keyOf(onRaw, l));
				const offGroup = lookup(offRaw, keys);
				const sdOf = (ls: typeof group) => sd(ls.flatMap((l) => l.fgpGames));
				lines.push(
					`  ${name.padEnd(20)} traits off: ${sdOf(offGroup).toFixed(4)}   traits on: ${sdOf(group).toFixed(4)}`,
				);
			}
		}
		const text = `${lines.join("\n")}\n`;
		if (env.TRAITS_METRICS_OUT) {
			fs.writeFileSync(env.TRAITS_METRICS_OUT, text);
		}
		console.log(text);
	},
);
