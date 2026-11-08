import { assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { g, helpers } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { draft, player, team } from "../index.ts";
import customizePlayer from "../../views/customizePlayer.ts";
import createRandomPlayers from "../league/create/createRandomPlayers.ts";
import createGameAttributes from "../league/createGameAttributes.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { last, range } from "../../../common/utils.ts";
import {
	SEASONS_TO_REVEAL,
	TRAIT_DEFINITIONS,
	TRAIT_KEYS,
	formatTraitReading,
	generateTraitSeeds,
	seedKey,
	traitEffects,
	traitScores,
	traitZ,
	type TraitSituation,
} from "../../../common/playerTraits/index.ts";

import { getTraitScoresByPid } from "../../util/playerTraitsView.ts";

const sit: TraitSituation = { scoreDiff: 2, timeLeft: 90, period: 4 };

describe("calibration on generated leagues", () => {
	test("league-wide averages of the trait effects equal the neutral value", async () => {
		const sums: Record<string, number> = {};
		const add = (k: string, v: number, w = 1) => {
			sums[k] = (sums[k] ?? 0) + v * w;
		};
		let n = 0;
		let usageTotal = 0;
		let attemptTotal = 0;
		for (let rep = 0; rep < 4; rep++) {
			resetG();
			g.setWithoutSavingToDB("playerTraits", true);
			g.setWithoutSavingToDB("playerTraitsSeed", 1000 + rep);
			const players = await createRandomPlayers({
				activeTids: range(30),
				onlyFreeAgents: false,
				scoutingLevel: DEFAULT_LEVEL,
				teams: range(30).map((tid) => ({ tid })),
			});
			const season = g.get("season");
			const rotation = players
				.filter((p) => p.tid >= 0)
				.sort((a, b) => last(b.ratings).ovr - last(a.ratings).ovr)
				.slice(0, 300);
			for (const [i, p] of rotation.entries()) {
				const pid = rep * 1000 + i;
				const r = last(p.ratings) as any;
				const scores = traitScores(r, generateTraitSeeds(1000 + rep, pid), {
					age: season - p.born.year,
					experience: Math.max(0, season - p.draft.year),
				});
				const e = traitEffects(scores);
				for (const key of TRAIT_KEYS) {
					add(`score:${key}`, scores[key]);
					add(`z:${key}`, traitZ(scores[key]));
				}
				add("inj", e.injuryRateMultiplier);
				add("var", e.varianceScale);
				add("space", e.spacingContribution);
				add("screen", e.screenContribution);
				add("loose", e.looseBallBonus);
				add("foul", e.foulProneness);
				add("steal", e.gambleStealMultiplier);
				add("rec", e.energyRecoveryRate);
				add("clutchShot", e.clutchShotModifier(sit));
				add("clutchFt", e.clutchFtModifier(sit));
				add("clutchTov", e.clutchTurnoverMult(sit));
				add("press", e.pressureTurnoverMult(0.7));
				add("late", e.lateGameDecisionQuality(sit));
				add("chem", e.chemistryContribution);

				// Shot selection is weighted by how many shots each player takes (about usage squared)
				const usage = helpers.bound(
					(r.ins * 0.2 +
						r.dnk * 0.1 +
						r.fg * 0.2 +
						r.tp * 0.2 +
						r.spd * 0.05 +
						r.hgt * 0.05 +
						r.drb * 0.1 +
						r.oiq * 0.1) /
						100,
					0,
					1,
				);
				const w = usage * usage;
				const bias = e.shotSelectionBias(usage);
				add("quality", bias.shotQualityDelta, w);
				add("attempt", bias.attemptWeightMult, w);
				usageTotal += w;
				attemptTotal += 1;
				n++;
			}
		}
		const mean = (k: string) => sums[k]! / n;
		for (const key of TRAIT_KEYS) {
			assert.approximately(mean(`score:${key}`), 50, 2, `${key} mean score`);
			assert.approximately(mean(`z:${key}`), 0, 0.06, `${key} mean z`);
		}
		assert.approximately(mean("inj"), 1, 0.02);
		assert.approximately(mean("var"), 1, 0.03);
		assert.approximately(mean("space"), 0, 0.004);
		assert.approximately(mean("screen"), 0, 0.004);
		assert.approximately(mean("loose"), 1, 0.012);
		assert.approximately(mean("foul"), 1, 0.02);
		assert.approximately(mean("steal"), 1, 0.01);
		assert.approximately(mean("rec"), 1, 0.012);
		assert.approximately(mean("clutchShot"), 0, 0.002);
		assert.approximately(mean("clutchFt"), 0, 0.003);
		assert.approximately(mean("clutchTov"), 1, 0.007);
		assert.approximately(mean("press"), 1, 0.01);
		assert.approximately(mean("late"), 0, 0.003);
		assert.approximately(mean("chem"), 0, 0.06);
		// Shot-weighted
		assert.approximately(sums.quality! / usageTotal, 0, 0.002);
		assert.approximately(sums.attempt! / usageTotal, 1, 0.025);
		assert.isAbove(attemptTotal, 0);
	}, 120000);
});

describe("generation, settings and storage", () => {
	beforeEach(() => {
		resetG();
		g.setWithoutSavingToDB("season", 2026);
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	});

	test("setting defaults: off for existing leagues, seed 0", () => {
		assert.strictEqual(defaultGameAttributes.playerTraits, false);
		assert.strictEqual(defaultGameAttributes.playerTraitsSeed, 0);
	});

	test("a new league gets its own seed, a league file's seed is kept", async () => {
		const make = (gameAttributesInput: any) =>
			createGameAttributes({
				startingSeason: 2015,
				gameAttributesInput,
				teamInfos: helpers.getTeamsDefault(),
				userTid: 0,
			});
		const a = await make({});
		const b = await make({});
		assert.isAbove(a.playerTraitsSeed, 0);
		assert.notStrictEqual(a.playerTraitsSeed, b.playerTraitsSeed);
		const c = await make({ playerTraitsSeed: 12345, playerTraits: true });
		assert.strictEqual(c.playerTraitsSeed, 12345);
		assert.strictEqual(c.playerTraits, true);
		const d = await make({ playerTraits: false });
		assert.strictEqual(d.playerTraits, false);
	});

	test("draft prospects get deterministic trait seeds from league seed and pid", async () => {
		g.setWithoutSavingToDB("playerTraitsSeed", 777);
		idb.league = mockIDBLeague();
		await resetCache({ players: [] });
		await draft.genPlayers(2026, DEFAULT_LEVEL);
		const prospects = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		assert.isAbove(prospects.length, 30);
		for (const p of prospects) {
			assert.deepStrictEqual(p.traits, generateTraitSeeds(777, p.pid));
		}
	}, 60000);

	test("lazy creation: missing traits are derived, ensureTraits stores them once", () => {
		g.setWithoutSavingToDB("playerTraitsSeed", 31);
		const p: any = {
			...player.generate(PLAYER.FREE_AGENT, 25, 2026, false, DEFAULT_LEVEL),
			pid: 5,
		};
		assert.isUndefined(p.traits);
		const before = player.getPlayerTraitScores(p);
		assert.isTrue(player.ensureTraits(p));
		assert.deepStrictEqual(p.traits, generateTraitSeeds(31, 5));
		assert.isFalse(player.ensureTraits(p));
		assert.deepStrictEqual(player.getPlayerTraitScores(p), before);
	});

	test("export/import round trip keeps traits (JSON, then the league file path)", async () => {
		g.setWithoutSavingToDB("playerTraitsSeed", 9);
		const p: any = {
			...player.generate(PLAYER.FREE_AGENT, 25, 2026, false, DEFAULT_LEVEL),
			pid: 8,
		};
		player.initTraits(p);
		p.traits.clutchSeed = 2.5;
		const exported = structuredClone(p);
		assert.deepStrictEqual(exported.traits, p.traits);
		const imported = await player.augmentPartialPlayer(
			exported,
			DEFAULT_LEVEL,
			2026,
		);
		assert.deepStrictEqual(imported.traits, p.traits);
		// A hand-edited file with junk is repaired, good values survive
		const junk: any = {
			...exported,
			traits: { clutchSeed: 99, hustleSeed: "x", leadershipSeed: 1.1 },
		};
		junk.pid = 8;
		assert.isTrue(player.ensureTraits(junk));
		assert.strictEqual(junk.traits.clutchSeed, 8);
		assert.strictEqual(junk.traits.leadershipSeed, 1.1);
		assert.strictEqual(
			junk.traits.hustleSeed,
			generateTraitSeeds(9, 8).hustleSeed,
		);
	});

	test("sim effects: undefined when the setting is off, defined when on", () => {
		const p: any = {
			...player.generate(PLAYER.FREE_AGENT, 25, 2026, false, DEFAULT_LEVEL),
			pid: 3,
		};
		g.setWithoutSavingToDB("playerTraits", false);
		assert.strictEqual(player.getTraitInjuryRateMultiplier(p), 1);
		assert.isUndefined(player.getSimTraitEffects(p));
		assert.isUndefined(player.getPlayerTraitsForUI(p));
		g.setWithoutSavingToDB("playerTraits", true);
		const e = player.getSimTraitEffects(p)!;
		assert.isFalse(e.neutral);
		assert.strictEqual(
			player.getTraitInjuryRateMultiplier(p),
			e.injuryRateMultiplier,
		);
		assert.isAtLeast(e.injuryRateMultiplier, 0.7);
		assert.isAtMost(e.injuryRateMultiplier, 1.3);
	});

	test("preseason development drifts the seeds slowly and deterministically", () => {
		g.setWithoutSavingToDB("playerTraitsSeed", 4);
		const a: any = {
			...player.generate(PLAYER.FREE_AGENT, 25, 2026, false, DEFAULT_LEVEL),
			pid: 2,
		};
		const b = structuredClone(a);
		player.initTraits(a);
		player.initTraits(b);
		player.developTraits(a, 2027);
		player.developTraits(b, 2027);
		assert.deepStrictEqual(a.traits, b.traits);
		assert.notStrictEqual(
			JSON.stringify(a.traits),
			JSON.stringify(generateTraitSeeds(4, 2)),
		);
		for (const key of TRAIT_KEYS) {
			assert.isBelow(
				Math.abs(
					a.traits[seedKey(key)] - generateTraitSeeds(4, 2)[seedKey(key)],
				),
				1.6,
			);
		}
	});

	test("prospects show estimates, God Mode shows the truth, pros reveal over time", () => {
		g.setWithoutSavingToDB("playerTraits", true);
		g.setWithoutSavingToDB("playerTraitsSeed", 6);
		const prospect: any = {
			...player.generate(PLAYER.UNDRAFTED, 19, 2026, false, DEFAULT_LEVEL),
			pid: 11,
		};
		const ui = player.getPlayerTraitsForUI(prospect, {
			scoutingLevel: 34,
			godMode: false,
			includeExact: true,
		})!;
		assert.isTrue(ui.isProspect);
		assert.isTrue(ui.traits.some((t) => !t.exact));
		const exact = player.getPlayerTraitsForUI(prospect, { godMode: true })!;
		assert.isTrue(exact.traits.every((t) => t.exact));
		assert.deepStrictEqual(exact.scores, ui.exactScores);
		// Same reading every time
		assert.deepStrictEqual(
			player.getPlayerTraitsForUI(prospect, {
				scoutingLevel: 34,
				godMode: false,
			})!.scores,
			ui.scores,
		);
		const vet: any = {
			...player.generate(PLAYER.FREE_AGENT, 28, 2018, false, DEFAULT_LEVEL),
			pid: 12,
		};
		assert.isTrue(
			player
				.getPlayerTraitsForUI(vet, { godMode: false })!
				.traits.every((t) => t.exact),
		);
	});

	test("hidden traits of young pros are ranges with a ?, never the exact score", () => {
		g.setWithoutSavingToDB("playerTraits", true);
		g.setWithoutSavingToDB("playerTraitsSeed", 6);
		// One season in the league: hidden traits are still being learned, visible ones are exact
		const rookie: any = {
			...player.generate(0, 21, 2025, false, DEFAULT_LEVEL),
			pid: 13,
		};
		const ui = player.getPlayerTraitsForUI(rookie, { godMode: false })!;
		const truth = player.getPlayerTraitsForUI(rookie, { godMode: true })!;
		assert.isUndefined(ui.exactScores);
		for (const t of ui.traits) {
			const hidden = TRAIT_DEFINITIONS[t.key].visibility === "hidden";
			assert.strictEqual(t.exact, !hidden, t.key);
			const shown = formatTraitReading(t);
			if (hidden) {
				assert.match(shown, /^\d+-\d+\?$/);
				assert.isAtMost(t.low, t.estimate);
				assert.isAtLeast(t.high, t.estimate);
			} else {
				assert.strictEqual(shown, String(truth.scores[t.key]));
			}
		}
		// The estimates are readings with error, not the true scores
		assert.isTrue(
			ui.traits.some((t) => !t.exact && t.estimate !== truth.scores[t.key]),
		);

		// Tables get the same display strings
		const byPid = getTraitScoresByPid([rookie], {
			enabled: true,
			scoutingLevel: DEFAULT_LEVEL,
			godMode: false,
		});
		const row = byPid.get(13)!;
		assert.deepStrictEqual(row.scores, ui.scores);
		assert.match(row.display.clutch, /\?$/);

		// After enough seasons, or with God Mode, they're exact
		g.setWithoutSavingToDB("season", 2025 + SEASONS_TO_REVEAL);
		const later = player.getPlayerTraitsForUI(rookie, { godMode: false })!;
		assert.isTrue(later.traits.every((t) => t.exact));
		const god = getTraitScoresByPid([rookie], {
			enabled: true,
			scoutingLevel: DEFAULT_LEVEL,
			godMode: true,
		}).get(13)!;
		assert.strictEqual(god.display.clutch, String(god.scores.clutch));
	});

	test("Customize Player only sends trait seeds in God Mode", async () => {
		g.setWithoutSavingToDB("playerTraits", true);
		g.setWithoutSavingToDB("playerTraitsSeed", 6);
		idb.league = mockIDBLeague();
		const p: any = {
			...player.generate(PLAYER.FREE_AGENT, 21, 2025, false, DEFAULT_LEVEL),
			pid: 0,
		};
		player.initTraits(p);
		const teams = helpers.getTeamsDefault().slice(0, 2).map(team.generate);
		await resetCache({ players: [p], teams });
		const load = (godMode: boolean) => {
			g.setWithoutSavingToDB("godMode", godMode);
			return customizePlayer.load({
				inputs: { pid: 0, type: undefined },
				updateEvents: new Set(["firstRun"]),
				prevInputs: undefined,
				prevOutput: undefined,
			} as any) as any;
		};
		const normal = await load(false);
		assert.isUndefined(normal.p.traits);
		assert.isUndefined(normal.traitsInfo);
		const god = await load(true);
		assert.deepStrictEqual(god.p.traits, p.traits);
		assert.isDefined(god.traitsInfo);
		// The stored player is untouched
		assert.deepStrictEqual((await idb.cache.players.get(0))!.traits, p.traits);
	});

	test("formatTraitReading", () => {
		assert.strictEqual(
			formatTraitReading({ estimate: 60, low: 50, high: 70, exact: false }),
			"50-70?",
		);
		assert.strictEqual(
			formatTraitReading({ estimate: 60, low: 60, high: 60, exact: true }),
			"60",
		);
	});

	test("God Mode editing moves the score to the wanted value", () => {
		g.setWithoutSavingToDB("playerTraitsSeed", 6);
		const p: any = {
			...player.generate(PLAYER.FREE_AGENT, 26, 2020, false, DEFAULT_LEVEL),
			pid: 20,
		};
		player.setTraitScores(p, { clutch: 90, durability: 12 });
		const s = player.getPlayerTraitScores(p);
		assert.approximately(s.clutch, 90, 1);
		assert.approximately(s.durability, 12, 1);
		const seeds = generateTraitSeeds(6, 20);
		assert.strictEqual(p.traits.hustleSeed, seeds.hustleSeed);
	});
});
