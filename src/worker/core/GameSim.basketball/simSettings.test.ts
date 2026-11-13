import { afterAll, assert, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { simFixInjuryFactor } from "./simSettings.ts";
import { positionalShares } from "./positionalComposites.ts";
import {
	foulTroubleSitUntil,
	pickClosers,
	planMinutes,
} from "./rotationPlanner.ts";
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

test("positionalComposites: bigs get the rim protection share, ball handlers the dribbling share", () => {
	const mk = (pos: string, hgt: number, dribbling: number) => ({
		pos,
		simHgt: hgt,
		compositeRating: { dribbling },
	});
	const players = [
		mk("PG", 30, 0.8),
		mk("C", 80, 0.3),
		mk("SF", 50, 0.5),
		mk("SG", 35, 0.6),
		mk("PF", 65, 0.4),
	];
	const shares = positionalShares(players)!;
	assert.strictEqual(shares.interior[1], Math.max(...shares.interior));
	assert.strictEqual(shares.perimeter[0], Math.max(...shares.perimeter));
	assert.strictEqual(shares.ball[0], Math.max(...shares.ball));
	for (const key of ["interior", "rebound", "perimeter", "ball"] as const) {
		assert.closeTo(
			shares[key].reduce((a, b) => a + b, 0),
			5,
			1e-9,
		);
	}
	assert.isUndefined(positionalShares(players.slice(0, 4)));
});

test("positionalComposites: games still sane", async () => {
	for (const expandedRatings of [false, true]) {
		checkSane(
			await simGames({ positionalComposites: true, expandedRatings }, SEEDS),
		);
	}
});

test("positionalComposites: with fewer than 5 players on the court, shots still go in", async () => {
	for (const numPlayersOnCourt of [3, 4]) {
		const results = await simGames(
			{ positionalComposites: true, numPlayersOnCourt } as any,
			SEEDS.slice(0, 3),
		);
		for (const { result } of results) {
			for (const t of result.team) {
				// It was 0 of every shot: no shares, so the inside and outside shot defense were undefined and every make probability NaN
				assert.isAbove(t.stat.fg / t.stat.fga, 0.2);
			}
		}
	}
	g.setWithoutSavingToDB("numPlayersOnCourt", 5);
});

const roster = (n: number) =>
	range(n).map((i) => ({
		valueNoPot: 70 - 2 * i,
		injured: false,
		ptModifier: 1,
	}));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const opts = {
	playoffs: false,
	backToBack: false,
	numPlayersOnCourt: 5,
	allStarGame: false,
};

test("realisticRotations: minutes plan", () => {
	const regular = planMinutes(roster(14), opts);
	assert.closeTo(sum(regular), 240, 0.1);
	assert.isAbove(regular[0]!, regular[5]!);
	assert.strictEqual(regular[13], 0);

	// Playoffs: 8-man rotation, stars around 40
	const playoffs = planMinutes(roster(14), { ...opts, playoffs: true });
	assert.closeTo(sum(playoffs), 240, 0.1);
	assert.strictEqual(playoffs.filter((m) => m > 0).length, 8);
	assert.isAtLeast(playoffs[0]!, 40);

	// Back-to-back: starters a little less, the bench a little more
	const b2b = planMinutes(roster(14), { ...opts, backToBack: true });
	assert.closeTo(sum(b2b), 240, 0.1);
	assert.isBelow(b2b[0]!, regular[0]!);
	assert.isAbove(b2b[6]!, regular[6]!);

	// Injured players and a minutes restriction
	const players = roster(14);
	players[0]!.injured = true;
	players[1]!.ptModifier = 0.6;
	(players[1] as any).minutesRestriction = 0.6;
	const restricted = planMinutes(players, opts);
	assert.strictEqual(restricted[0], 0);
	assert.isAtMost(restricted[1]!, 36 * 0.6);
	assert.closeTo(sum(restricted), 240, 0.1);

	// Coach style hook: a tight rotation gives the top players more
	const tight = planMinutes(roster(14), { ...opts, rotationStyle: -1 });
	assert.isAbove(tight[3]!, regular[3]!);
	assert.isBelow(tight[9]!, regular[9]!);
});

test("realisticRotations: foul trouble rules", () => {
	const base = {
		numPeriods: 4,
		foulsNeededToFoulOut: 6,
		quarterSeconds: 720,
	};
	// 2 in the 1st: until 6:00 of the 2nd
	assert.strictEqual(foulTroubleSitUntil({ ...base, pf: 2, period: 1 }), 1080);
	// 2 in the 2nd: fine
	assert.isUndefined(foulTroubleSitUntil({ ...base, pf: 2, period: 2 }));
	// 3 in the first half: until halftime
	assert.strictEqual(foulTroubleSitUntil({ ...base, pf: 3, period: 2 }), 1440);
	// 4 in the 3rd: until 8:00 of the 4th
	assert.strictEqual(foulTroubleSitUntil({ ...base, pf: 4, period: 3 }), 2400);
	assert.isUndefined(foulTroubleSitUntil({ ...base, pf: 4, period: 4 }));
	// 5: the closing 5 minutes
	assert.strictEqual(foulTroubleSitUntil({ ...base, pf: 5, period: 2 }), 2580);
	// Other settings: no rules
	assert.isUndefined(
		foulTroubleSitUntil({ ...base, numPeriods: 2, pf: 3, period: 1 }),
	);
});

test("realisticRotations: closers are the best valid lineup", () => {
	const mk = (pos: string, valueNoPot: number) => ({ pos, valueNoPot });
	// The five best are all bigs: a guard has to close
	const candidates = [
		mk("C", 70),
		mk("PF", 69),
		mk("FC", 68),
		mk("C", 67),
		mk("SF", 66),
		mk("PG", 60),
		mk("SG", 59),
		mk("G", 50),
	];
	const closers = pickClosers(candidates, 5);
	assert.strictEqual(closers.size, 5);
	assert.isTrue(closers.has(candidates[5]!));
	assert.isTrue(closers.has(candidates[0]!));
});

test("realisticRotations: games still sane, regular season and playoffs", async () => {
	checkSane(await simGames({ realisticRotations: true }, SEEDS));
	checkSane(await simGames({ realisticRotations: true }, SEEDS, true));
});

test("all three on, with every other sim extra: games still sane", async () => {
	checkSane(
		await simGames(
			{
				simFixes: true,
				positionalComposites: true,
				realisticRotations: true,
				expandedRatings: true,
				playerTraits: true,
				realisticPossessions: true,
				injuryDepth: true,
				technicalFouls: true,
				perimeterDefense: true,
				spacingCreation: true,
				matchupDefense: true,
			},
			SEEDS,
		),
	);
});
