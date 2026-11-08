import { assert, test } from "vitest";
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

/*
 * The injuryDepth setting (re-injury risk, minutes restrictions, load management) works in the pure sim: it only changes the inputs of
 * a game (ptModifier, who is available, a per-player injury risk factor), never reads play-by-play. So the same seeded game gives the
 * same result with play-by-play logging on or off.
 */

const stableStringify = (x: unknown) => JSON.stringify(x);

const simGame = async (seed: number, doPlayByPlay: boolean) => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		resetG();
		g.setWithoutSavingToDB("season", 2013);
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		g.setWithoutSavingToDB("injuryDepth", true);
		// High, so injuries (and the re-injury code) actually happen in a single game
		g.setWithoutSavingToDB("injuryRate", 0.01);
		const teamsDefault = helpers.getTeamsDefault().slice(0, 2);
		const players = [
			...range(15).map(() => player.generate(0, 25, 2010, true, DEFAULT_LEVEL)),
			...range(15).map(() => player.generate(1, 25, 2010, true, DEFAULT_LEVEL)),
		];
		for (const [i, p] of players.entries()) {
			if (i % 3 === 0) {
				p.health = {
					restrict: 5,
					restrictTotal: 8,
					returnGames: 10,
					bodyPart: "Knee",
				};
			}
			if (i % 5 === 0) {
				p.born.year = 1978; // old, so load management rests him on a back-to-back
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
		const teams = await loadTeams([0, 1], {});
		const rested = teams[0]!.player.filter((p: any) => p.rested).length;
		const sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		const result = sim.run();
		return {
			rested,
			newInjuries: result.team.flatMap((t) =>
				t.player.filter((p) => p.newInjury).map((p) => p.id),
			).length,
			box: stableStringify(
				result.team.map((t) => ({
					stat: t.stat,
					players: t.player.map((p) => ({
						id: p.id,
						stat: p.stat,
						injured: p.injured,
						newInjury: p.newInjury,
					})),
				})),
			),
		};
	} finally {
		setSimDay(undefined);
		Math.random = original;
	}
};

test("injury depth: same seeded game with play-by-play on and off", async () => {
	let totalRested = 0;
	let totalInjuries = 0;
	for (const seed of range(8).map((i) => 77 + i * 13)) {
		const off = await simGame(seed, false);
		const on = await simGame(seed, true);
		assert.strictEqual(on.box, off.box, `seed ${seed}`);
		totalRested += off.rested;
		totalInjuries += off.newInjuries;
	}
	// The features were actually exercised
	assert.isAbove(totalRested, 0);
	assert.isAbove(totalInjuries, 0);
});
