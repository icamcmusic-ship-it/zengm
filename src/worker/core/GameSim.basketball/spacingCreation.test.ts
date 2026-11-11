import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import {
	lineupSpacing,
	NON_SHOOTER_THREAT,
	SPACING,
	spacingAround,
	synergySpacingFactor,
} from "./spacingCreation.ts";
import { range } from "../../../common/utils.ts";

/*
 * Spacing & Shot Creation (the spacingCreation setting, spacingCreation.ts). Off: nothing changes (the fixed-seed box scores of
 * outcomeInvariance.test.ts, which runs with every setting at its existing-league default). On: league averages about the same, assisted
 * shares by shot type, and shooters around a driver open up the paint. The calibration tables are in docs/native-features.md
 * (spacingMatchup.script.test.ts).
 */

afterAll(() => {
	resetG();
});

const SEEDS = range(10).map((i) => 700 + i * 53);

type Tally = {
	made: Record<string, number>;
	ast: Record<string, number>;
};

// Simulates games (both teams' rosters from genTeams), optionally changing the loaded teams first. Counts made shots and assists by type
const sim = async (
	settings: Record<string, boolean>,
	{
		seeds = SEEDS,
		games = 1,
		edit,
	}: {
		seeds?: number[];
		games?: number;
		edit?: (teams: Record<number, any>) => void;
	} = {},
) => {
	const tally: Tally = { made: {}, ast: {} };
	const proto = GameSim.prototype as any;
	const orig = proto.doFg;
	proto.doFg = function (p: any, passer: any, type: string, andOne: boolean) {
		tally.made[type] = (tally.made[type] ?? 0) + 1;
		if (passer) {
			tally.ast[type] = (tally.ast[type] ?? 0) + 1;
		}
		return orig.call(this, p, passer, type, andOne);
	};
	const results: any[] = [];
	const loaded: any[] = [];
	try {
		for (const seed of seeds) {
			await withSeededRandom(seed, async () => {
				await genTeams();
				for (const [key, value] of Object.entries(settings)) {
					g.setWithoutSavingToDB(key as any, value);
				}
				for (const i of range(games)) {
					const teams = await loadTeams([0, 1], {});
					edit?.(teams);
					// (the sim deletes the composite ratings from its result)
					loaded.push({ ...teams[0]!.player[0]!.compositeRating });
					const gameSim = new GameSim({
						gid: seed + i,
						teams: [teams[0]!, teams[1]!],
						baseInjuryRate: 0,
						doPlayByPlay: false,
						homeCourtFactor: 1,
						allStarGame: false,
						neutralSite: false,
					});
					results.push(gameSim.run());
				}
			});
		}
	} finally {
		proto.doFg = orig;
	}
	return { results, tally, loaded };
};

const teamAverages = (results: any[]) => {
	const sums: Record<string, number> = {};
	let n = 0;
	for (const result of results) {
		for (const t of result.team) {
			n += 1;
			for (const key of ["pts", "fg", "fga", "tp", "tpa", "ast", "tov"]) {
				sums[key] = (sums[key] ?? 0) + t.stat[key];
			}
		}
	}
	return {
		pts: sums.pts! / n,
		ast: sums.ast! / n,
		tov: sums.tov! / n,
		fgp: sums.fg! / sums.fga!,
		tpaRate: sums.tpa! / sums.fga!,
	};
};

test("spacingCreation off: no creation composites, the sim does not use it", async () => {
	const { loaded } = await sim({ spacingCreation: false }, { seeds: [1] });
	assert.isUndefined(loaded[0].creation);
	assert.isUndefined(loaded[0].spacingThreat);
});

test("spacingCreation: spacing around a shooter, cramped lineups", () => {
	const mk = (threat: number) => ({
		compositeRating: { spacingThreat: threat },
	});
	const shooters = lineupSpacing([0.6, 0.6, 0.6, 0.6, 0.3].map(mk));
	const cramped = lineupSpacing([0.6, 0.3, 0.3, 0.3, 0.3].map(mk));
	assert.strictEqual(shooters.nonShooters, 1);
	assert.strictEqual(cramped.nonShooters, 4);
	// The driver (0.3) with four shooters around him, or three other non-shooters
	const open = spacingAround(shooters, 0.3, 4);
	const tight = spacingAround(cramped, 0.3, 4);
	assert.isAbove(open, 0.1);
	assert.isBelow(tight, -0.1);
	// Two non-shooters around him cost more than the plain drop in average threat
	const one = lineupSpacing([0.5, 0.5, 0.5, 0.3, 0.6].map(mk));
	const two = lineupSpacing([0.5, 0.5, 0.3, 0.3, 0.8].map(mk));
	assert.isBelow(
		spacingAround(two, 0.5, 4),
		spacingAround(one, 0.5, 4) - SPACING.crampedStep + 1e-9,
	);
	assert.isBelow(NON_SHOOTER_THREAT, SPACING.ref);
	// Synergy: shooters lift the spacing factor, which stays between 0 and 1
	assert.isAbove(
		synergySpacingFactor(shooters, 5),
		synergySpacingFactor(cramped, 5),
	);
	assert.strictEqual(synergySpacingFactor(cramped, 5), 0);
});

test("spacingCreation: league averages about the same, assisted share by shot type", async () => {
	const off = await sim({ spacingCreation: false }, { games: 2 });
	const on = await sim({ spacingCreation: true }, { games: 2 });
	assert.isNumber(on.loaded[0].creation);
	assert.isNumber(on.loaded[0].spacingThreat);
	const a = teamAverages(off.results);
	const b = teamAverages(on.results);
	assert.closeTo(b.pts, a.pts, 5);
	assert.closeTo(b.fgp, a.fgp, 0.02);
	assert.closeTo(b.ast, a.ast, 2.5);
	assert.closeTo(b.tpaRate, a.tpaRate, 0.03);

	const share = (t: Tally, type: string) => (t.ast[type] ?? 0) / t.made[type]!;
	// Off: about the same share for every type. On: threes mostly assisted, then shots at the rim, then post-ups and mid-range jumpers
	const three = share(on.tally, "threePointer");
	const rim = share(on.tally, "atRim");
	const mid = share(on.tally, "midRange");
	assert.isAbove(three, 0.75);
	assert.isAbove(three, rim + 0.1);
	assert.isAbove(rim, mid + 0.1);
	assert.isBelow(mid, 0.55);
	assert.closeTo(
		share(off.tally, "threePointer"),
		share(off.tally, "midRange"),
		0.1,
	);
});

// A star driver (the starter with the highest usage) with four shooters around him, or with non-shooters: how often he gets to the rim
// and how well he finishes there
const starDriver = async (threat: number, seeds = SEEDS, games = 2) => {
	let fgaAtRim = 0;
	let fgAtRim = 0;
	let fga = 0;
	const stars = new Set<number>();
	const { results } = await sim(
		{ spacingCreation: true },
		{
			seeds,
			games,
			edit: (teams) => {
				const starters = teams[0].player.slice(0, 5);
				const star = starters.reduce((a: any, b: any) =>
					a.compositeRating.usage > b.compositeRating.usage ? a : b,
				);
				stars.add(star.id);
				for (const p of teams[0].player) {
					if (p !== star) {
						p.compositeRating.spacingThreat = threat;
					}
				}
			},
		},
	);
	for (const result of results) {
		for (const p of result.team[0].player) {
			if (stars.has(p.id)) {
				fgaAtRim += p.stat.fgaAtRim;
				fgAtRim += p.stat.fgAtRim;
				fga += p.stat.fga;
			}
		}
	}
	return { rimShare: fgaAtRim / fga, rimFgp: fgAtRim / fgaAtRim };
};

test("spacingCreation: shooters around a star driver open up the paint", async () => {
	const games = Number((globalThis as any).process.env.SM_GAMES ?? 6);
	const shooters = await starDriver(0.6, SEEDS, games);
	const nonShooters = await starDriver(0.3, SEEDS, games);
	if ((globalThis as any).process.env.SM_PRINT) {
		console.log(
			"star driver, shooters around",
			shooters,
			"non-shooters",
			nonShooters,
		);
	}
	assert.isAbove(shooters.rimShare, nonShooters.rimShare + 0.05);
	assert.isAbove(shooters.rimFgp, nonShooters.rimFgp + 0.03);
});
