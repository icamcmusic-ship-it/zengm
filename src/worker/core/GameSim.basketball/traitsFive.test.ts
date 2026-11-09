// Big-game and temper traits in the sim (pure sim numbers, no play-by-play), and outcome invariance with them on.
import { afterEach, assert, test } from "vitest";
import GameSim, { TECHNICAL_FOUL_RATES } from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { PHASE } from "../../../common/constants.ts";
import type { Phase } from "../../../common/types.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { getTraitSeeds } from "../player/traits.ts";

const RATES = { ...TECHNICAL_FOUL_RATES };
afterEach(() => {
	Object.assign(TECHNICAL_FOUL_RATES, RATES);
});

type Seeds = Partial<Record<"bigGameSeed" | "temperSeed", number>>;

// Many games between the same two teams, with every player's seeds overridden
const simGames = (
	seed: number,
	numGames: number,
	{
		seeds,
		phase = PHASE.REGULAR_SEASON,
		doPlayByPlay = false,
		techFouls = true,
	}: {
		seeds: Seeds;
		phase?: Phase;
		doPlayByPlay?: boolean;
		techFouls?: boolean;
	},
) =>
	withSeededRandom(seed, async () => {
		await genTeams();
		g.setWithoutSavingToDB("playerTraits", true);
		g.setWithoutSavingToDB("playerTraitsSeed", 99);
		g.setWithoutSavingToDB("technicalFouls", techFouls);
		g.setWithoutSavingToDB("phase", phase);
		for (const p of await idb.cache.players.getAll()) {
			p.traits = { ...getTraitSeeds(p as any), ...seeds };
			await idb.cache.players.put(p);
		}
		const out = [];
		for (let i = 0; i < numGames; i++) {
			const teams = await loadTeams([0, 1], {});
			const sim = new GameSim({
				gid: seed * 1000 + i,
				teams: [teams[0]!, teams[1]!],
				baseInjuryRate: g.get("injuryRate"),
				doPlayByPlay,
				homeCourtFactor: 1,
				allStarGame: false,
				neutralSite: false,
			});
			const result = sim.run();
			let techs = 0;
			for (const [key, num] of sim.techs) {
				if (typeof key !== "number") {
					techs += num;
				}
			}
			let flagrants = 0;
			for (const num of sim.flagrants.values()) {
				flagrants += num;
			}
			out.push({
				techs,
				flagrants,
				box: JSON.stringify(
					result.team.map((t) => ({
						stat: t.stat,
						players: t.player.map((p) => p.stat),
					})),
				),
				fg: result.team[0].stat.fg + result.team[1].stat.fg,
				fga: result.team[0].stat.fga + result.team[1].stat.fga,
			});
		}
		return out;
	});

test("play-by-play on or off gives identical games with traits, technicals and the playoffs on", async () => {
	for (const seed of [3, 4]) {
		const seeds = { temperSeed: -2.5, bigGameSeed: 2 };
		const off = await simGames(seed, 3, {
			seeds,
			phase: PHASE.PLAYOFFS,
		});
		const on = await simGames(seed, 3, {
			seeds,
			phase: PHASE.PLAYOFFS,
			doPlayByPlay: true,
		});
		assert.deepStrictEqual(
			on.map((x) => x.box),
			off.map((x) => x.box),
		);
	}
});

test("big-game does nothing in the regular season", async () => {
	const risers = await simGames(5, 4, { seeds: { bigGameSeed: 3 } });
	const shrinkers = await simGames(5, 4, { seeds: { bigGameSeed: -3 } });
	assert.deepStrictEqual(
		risers.map((x) => x.box),
		shrinkers.map((x) => x.box),
	);
});

test("big-game risers shoot better in the playoffs than shrinkers", async () => {
	const fgp = (games: { fg: number; fga: number }[]) =>
		games.reduce((a, x) => a + x.fg, 0) / games.reduce((a, x) => a + x.fga, 0);
	const risers = await simGames(6, 60, {
		seeds: { bigGameSeed: 3 },
		phase: PHASE.PLAYOFFS,
	});
	const shrinkers = await simGames(6, 60, {
		seeds: { bigGameSeed: -3 },
		phase: PHASE.PLAYOFFS,
	});
	assert.isAbove(fgp(risers), fgp(shrinkers) + 0.02);
}, 120_000);

test("hotheads get more technical and flagrant fouls", async () => {
	TECHNICAL_FOUL_RATES.techPerDeadBall *= 5;
	TECHNICAL_FOUL_RATES.flagrantPerPossession *= 5;
	const sum = (games: { techs: number; flagrants: number }[]) =>
		games.reduce((a, x) => a + x.techs + x.flagrants, 0);
	const hotheads = await simGames(7, 60, { seeds: { temperSeed: -3 } });
	const calm = await simGames(7, 60, { seeds: { temperSeed: 3 } });
	assert.isAbove(sum(hotheads), 1.5 * sum(calm));
}, 120_000);
