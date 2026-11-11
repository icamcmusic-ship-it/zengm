import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { simFixInjuryFactor } from "./simSettings.ts";
import { range } from "../../../common/utils.ts";

/*
 * Game Simulation League extras that change how ratings work in the sim (simSettings.ts): with a setting off nothing changes (the
 * fixed-seed box scores of outcomeInvariance.test.ts), with it on games still look like basketball games. The calibration tables
 * (league averages, marginal rating values) are in docs/native-features.md.
 */

afterAll(() => {
	resetG();
});

const simGames = async (
	settings: Record<string, boolean>,
	seeds: number[],
	playoffs = false,
) => {
	const results = [];
	for (const seed of seeds) {
		const result = await withSeededRandom(seed, async () => {
			await genTeams();
			for (const [key, value] of Object.entries(settings)) {
				g.setWithoutSavingToDB(key as any, value);
			}
			if (playoffs) {
				g.setWithoutSavingToDB("phase", 3);
			}
			const teams = await loadTeams([0, 1], {});
			// (the sim deletes the composite ratings from its result)
			const p0 = teams[0]!.player[0]! as any;
			const first = {
				compositeRating: { ...p0.compositeRating },
				simInjuryFactor: p0.simInjuryFactor,
			};
			const sim = new GameSim({
				gid: seed,
				teams: [teams[0]!, teams[1]!],
				baseInjuryRate: g.get("injuryRate"),
				doPlayByPlay: false,
				homeCourtFactor: 1,
				allStarGame: false,
				neutralSite: false,
			});
			return { first, result: sim.run() };
		});
		results.push(result);
	}
	return results;
};

const SEEDS = range(8).map((i) => 500 + i * 41);

const checkSane = (results: Awaited<ReturnType<typeof simGames>>) => {
	let pts = 0;
	let min = 0;
	for (const { result } of results) {
		for (const t of result.team) {
			pts += t.stat.pts;
			for (const p of t.player) {
				min += p.stat.min;
			}
		}
	}
	const n = results.length * 2;
	assert.isAbove(pts / n, 80);
	assert.isBelow(pts / n, 135);
	assert.isAbove(min / n, 239);
};

test("simFixes: composites only with the setting on, games still sane", async () => {
	const off = await simGames({ simFixes: false }, SEEDS.slice(0, 1));
	const p0 = off[0]!.first;
	assert.isUndefined(p0.compositeRating.shootingMidRangeMake);
	assert.isUndefined(p0.simInjuryFactor);

	for (const expandedRatings of [false, true]) {
		const on = await simGames({ simFixes: true, expandedRatings }, SEEDS);
		const p = on[0]!.first;
		assert.isNumber(p.compositeRating.shootingMidRangeMake);
		assert.isNumber(p.compositeRating.shootingLowPostMake);
		assert.isNumber(p.simInjuryFactor);
		checkSane(on);
	}
});

test("simFixes: stronger, more durable players get hurt less, the average player about as often", () => {
	assert.isBelow(simFixInjuryFactor(70, 70), simFixInjuryFactor(40, 40));
	assert.closeTo(simFixInjuryFactor(51.4, 51.4), 1, 1e-9);
});
