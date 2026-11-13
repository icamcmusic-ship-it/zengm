import { afterAll, assert, describe, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { range } from "../../../common/utils.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import {
	ADV,
	advStat,
	LU,
	PLAY_TYPES,
	PT_FGA,
	PT_FGM,
	PT_POSS,
	PT_PTS,
	PT_TOV,
	ptIndex,
	TEAM_ADV,
	type TeamAdv,
} from "../../../common/advStats.ts";
import { pickPlayType, roleOf, shotWeights } from "./advTracking.ts";

/*
 * Advanced Tracking Stats (the advStats setting, advTracking.ts). Recording never changes a game: the same seeds give the same box scores
 * with the setting on and off, with the new-league defaults and with every other sim extra off (outcomeInvariance.test.ts covers the
 * existing-league defaults, where it is off). And what is recorded adds up to the box score.
 */

afterAll(() => {
	resetG();
});

const SEEDS = range(6).map((i) => 4100 + i * 61);

const boxOf = (result: any) =>
	JSON.stringify(
		result.team.map((t: any) => ({
			stat: t.stat,
			players: t.player.map((p: any) => ({
				id: p.id,
				stat: p.stat,
				injured: p.injured,
			})),
		})),
	);

const simGames = async (settings: Record<string, unknown>, seeds = SEEDS) => {
	const results: any[] = [];
	for (const seed of seeds) {
		await withSeededRandom(seed, async () => {
			await genTeams();
			for (const [key, value] of Object.entries(settings)) {
				g.setWithoutSavingToDB(key as any, value as any);
			}
			const teams = await loadTeams([0, 1], {});
			const gameSim = new GameSim({
				gid: seed,
				teams: [teams[0]!, teams[1]!],
				baseInjuryRate: g.get("injuryRate"),
				doPlayByPlay: false,
				homeCourtFactor: 1,
				allStarGame: false,
				neutralSite: false,
			});
			results.push(gameSim.run());
		});
	}
	return results;
};

const NEW_LEAGUE = getDefaultSettings() as Record<string, unknown>;

// Every sim extra off except the one being tested
const STOCK: Record<string, unknown> = {
	realisticPossessions: false,
	spacingCreation: false,
	matchupDefense: false,
	smartEndgame: false,
	realisticTurnovers: false,
	coachSystems: false,
	realisticRotations: false,
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const checkTotals = (results: any[]) => {
	for (const result of results) {
		for (const i of [0, 1] as const) {
			const t = result.team[i];
			const opp = result.team[1 - i];
			const players = t.player.filter((p: any) => p.stat.min > 0);
			const advs = players.map((p: any) => p.adv as number[]);
			for (const p of t.player) {
				if (p.stat.min > 0) {
					assert.isDefined(p.adv, "a player who played has a record");
				} else {
					assert.isUndefined(p.adv);
				}
			}
			const ptSum = (field: number) =>
				sum(
					advs.flatMap((a: number[]) =>
						PLAY_TYPES.map((_pt, j) => a[ptIndex(j, field)]!),
					),
				);
			// Every field goal attempt and turnover has a play type, and the points of the plays are all but the free throws of
			// non-shooting, flagrant and technical fouls
			assert.strictEqual(ptSum(PT_FGA), t.stat.fga);
			assert.strictEqual(ptSum(PT_FGM), t.stat.fg);
			assert.strictEqual(ptSum(PT_TOV), t.stat.tov);
			const ptPts = ptSum(PT_PTS);
			assert.isAtMost(ptPts, t.stat.pts);
			assert.isAtMost(t.stat.pts - ptPts, t.stat.ft);
			assert.isAtLeast(ptSum(PT_POSS), t.stat.fga + t.stat.tov);

			// Assisted makes are the assists, and every make is assisted or not
			const astMakes = sum(
				advs.map(
					(a: number[]) => a[ADV.astRim]! + a[ADV.astShort]! + a[ADV.astLong]! + a[ADV.ast3]!,
				),
			);
			const unastMakes = sum(
				advs.map(
					(a: number[]) => a[ADV.unRim]! + a[ADV.unShort]! + a[ADV.unLong]! + a[ADV.un3]!,
				),
			);
			assert.strictEqual(astMakes, t.stat.ast);
			assert.strictEqual(astMakes + unastMakes, t.stat.fg);
			assert.strictEqual(
				sum(advs.map((a: number[]) => a[ADV.cs3a]! + a[ADV.pu3a]!)),
				t.stat.tpa,
			);
			assert.strictEqual(
				sum(advs.map((a: number[]) => a[ADV.cs3m]! + a[ADV.pu3m]!)),
				t.stat.tp,
			);

			// Each of the opponents' shots has one closest defender, and each of their rim attempts one rim protector
			const oppPlayers = opp.player.filter((p: any) => p.stat.min > 0);
			assert.strictEqual(
				sum(advs.map((a: number[]) => a[ADV.dfga2]! + a[ADV.dfga3]!)),
				opp.stat.fga,
			);
			assert.strictEqual(
				sum(advs.map((a: number[]) => a[ADV.dfgm2]! + a[ADV.dfgm3]!)),
				opp.stat.fg,
			);
			assert.strictEqual(
				sum(advs.map((a: number[]) => a[ADV.rimDfga]!)),
				opp.stat.fgaAtRim,
			);
			assert.strictEqual(advs[0]![ADV.tmOppRim], opp.stat.fgaAtRim);
			assert.isAtLeast(oppPlayers.length, 5);

			// On/off: the five on the floor share every possession and point
			const ta: TeamAdv = t.adv;
			const n = result.numPlayersOnCourt;
			assert.strictEqual(
				sum(advs.map((a: number[]) => a[ADV.possFor]!)),
				n * ta.t[TEAM_ADV.possFor]!,
			);
			assert.strictEqual(
				sum(advs.map((a: number[]) => a[ADV.ptsFor]!)),
				n * t.stat.pts,
			);
			assert.strictEqual(
				sum(advs.map((a: number[]) => a[ADV.ptsFor]! - a[ADV.ptsAgainst]!)),
				sum(players.map((p: any) => p.stat.pm)),
			);
			assert.strictEqual(advs[0]![ADV.tmPtsFor], t.stat.pts);
			// About 100 possessions each, the same number for both teams within a couple
			assert.isAbove(ta.t[TEAM_ADV.possFor]!, 75);
			assert.isBelow(ta.t[TEAM_ADV.possFor]!, 135);
			assert.isAtMost(
				Math.abs(ta.t[TEAM_ADV.possFor]! - ta.t[TEAM_ADV.possAgainst]!),
				2,
			);

			// Lineups: the whole game, every point
			const minutes = 48 + 5 * result.overtimes;
			const luSec = sum(ta.lu.map((row) => row[n + LU.sec]!));
			assert.closeTo(luSec, minutes * 60, 2 + ta.lu.length);
			assert.strictEqual(sum(ta.lu.map((row) => row[n + LU.ptsFor]!)), t.stat.pts);
			assert.strictEqual(
				sum(ta.lu.map((row) => row[n + LU.possFor]!)),
				ta.t[TEAM_ADV.possFor]!,
			);
			for (const row of ta.lu) {
				const pids = row.slice(0, n);
				assert.deepStrictEqual(pids, pids.toSorted((a, b) => a - b));
			}

			// Clutch: a part of the game
			assert.isAtMost(
				sum(advs.map((a: number[]) => a[ADV.clPts]!)),
				t.stat.pts,
			);
			assert.isAtMost(ta.t[TEAM_ADV.clSec]!, 5 * 60 * (1 + result.overtimes) + 1);
		}
	}
};

describe("advanced tracking stats", () => {
	for (const [name, base] of [
		["new-league defaults", NEW_LEAGUE],
		["sim extras off", { ...NEW_LEAGUE, ...STOCK }],
	] as const) {
		test(`${name}: recording does not change the games, and adds up`, async () => {
			const off = await simGames({ ...base, advStats: false });
			const on = await simGames({ ...base, advStats: true });
			for (let i = 0; i < off.length; i++) {
				assert.strictEqual(boxOf(on[i]), boxOf(off[i]), `seed ${SEEDS[i]}`);
				for (const t of off[i].team) {
					assert.isUndefined(t.adv);
					for (const p of t.player) {
						assert.isUndefined(p.adv);
					}
				}
			}
			checkTotals(on);
		});
	}

	test("the derived stats read the record", async () => {
		const [result] = await simGames({ ...NEW_LEAGUE, advStats: true }, [
			SEEDS[0]!,
		]);
		const p = result.team[0].player[0];
		const adv = p.adv as number[];
		const freqs = PLAY_TYPES.map(
			(pt) =>
				advStat(adv, `pt${pt.key.charAt(0).toUpperCase()}${pt.key.slice(1)}Freq`) ??
				0,
		);
		assert.closeTo(sum(freqs), 100, 1e-6);
		assert.isDefined(advStat(adv, "onNet"));
		assert.strictEqual(advStat(adv, "dfga"), adv[ADV.dfga2]! + adv[ADV.dfga3]!);
	});
});

describe("play type classifier", () => {
	const guard = roleOf({
		id: 1,
		stat: {},
		compositeRating: {},
		advR: { hgt: 25, drb: 75, pss: 70, spd: 75 },
	});
	const big = roleOf({
		id: 2,
		stat: {},
		compositeRating: {},
		advR: { hgt: 75, drb: 30, pss: 35, spd: 45 },
	});
	const share = (w: ReturnType<typeof shotWeights>, key: string) => {
		let total = 0;
		for (const v of Object.values(w)) {
			total += v!;
		}
		return (w[key as keyof typeof w] ?? 0) / total;
	};

	test("a big finishing a guard's pass at the rim is mostly a roll man", () => {
		assert.isAbove(share(shotWeights("atRim", big, guard), "prr"), 0.4);
		assert.isBelow(share(shotWeights("atRim", guard, big), "prr"), 0.1);
	});

	test("a self-created guard is a pick-and-roll ball handler or isolation, a catch-and-shoot three mostly a spot-up", () => {
		const w = shotWeights("threePointer", guard, undefined);
		assert.isAbove(share(w, "prb") + share(w, "iso"), 0.7);
		assert.isAbove(share(shotWeights("threePointer", guard, guard), "spot"), 0.6);
	});

	test("the split is deterministic", () => {
		const w = shotWeights("midRange", guard, undefined);
		assert.strictEqual(pickPlayType(w, 0.3), pickPlayType(w, 0.3));
		assert.strictEqual(pickPlayType(w, 0), "prb");
	});
});
