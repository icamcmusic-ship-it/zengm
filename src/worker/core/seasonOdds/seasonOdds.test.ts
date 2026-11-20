import { assert, beforeEach, describe, test } from "vitest";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { simBracket, simSeasonOdds, winProb } from "./simSeason.ts";
import { awardWinProbs } from "./awardOdds.ts";
import {
	getWhatIfChances,
	lotteryWhatIfProbs,
} from "../draft/lotteryWhatIf.ts";

const mulberry32 = (seed: number) => () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

beforeEach(() => {
	resetG();
});

// 30 teams in the default 2 conferences / 6 divisions, tid 0 is the best and tid 29 the worst, each played 41 of 82 with a record
// that matches its strength
const makeLeague = () => {
	const divs = g.get("divs");
	const teams = Array.from({ length: 30 }, (_, tid) => {
		const div = divs[Math.floor(tid / 5)]!;
		const rating = 10 - (20 * tid) / 29;
		const won = Math.round(41 * winProb(rating));
		return {
			tid,
			rating,
			record: {
				tid,
				cid: div.cid,
				did: div.did,
				won,
				lost: 41 - won,
				otl: 0,
				tied: 0,
				wonDiv: 0,
				lostDiv: 0,
				otlDiv: 0,
				tiedDiv: 0,
				wonConf: 0,
				lostConf: 0,
				otlConf: 0,
				tiedConf: 0,
			},
		};
	});

	// Round robin-ish remaining schedule: 41 more games each
	const rand = mulberry32(1);
	const schedule: { homeTid: number; awayTid: number }[] = [];
	const left = new Array(30).fill(41);
	for (let round = 0; round < 41; round++) {
		const order = Array.from({ length: 30 }, (_, i) => i).sort(
			() => rand() - 0.5,
		);
		for (let i = 0; i < 30; i += 2) {
			const a = order[i]!;
			const b = order[i + 1]!;
			if (left[a] > 0 && left[b] > 0) {
				schedule.push({ homeTid: a, awayTid: b });
				left[a] -= 1;
				left[b] -= 1;
			}
		}
	}
	return { teams, schedule };
};

describe("season odds", () => {
	test("probabilities add up and follow team strength", async () => {
		const { teams, schedule } = makeLeague();
		const start = performance.now();
		const odds = await simSeasonOdds({
			teams,
			schedule,
			numGamesPlayoffSeries: g.get("numGamesPlayoffSeries", "current"),
			hca: 2.5,
			byConf: 2,
			numSims: 500,
			random: mulberry32(2),
		});
		console.log(`500 sims in ${Math.round(performance.now() - start)} ms`);

		const numPlayoffTeams = 2 ** odds.numRounds;
		const sumPlayoffs = odds.teams.reduce((sum, t) => sum + t.playoffs, 0);
		const sumTitle = odds.teams.reduce((sum, t) => sum + t.title, 0);
		assert.closeTo(sumPlayoffs, numPlayoffTeams, 1e-9);
		assert.closeTo(sumTitle, 1, 1e-9);

		for (const t of odds.teams) {
			const sumSeeds = t.seeds.reduce((sum, x) => sum + (x ?? 0), 0);
			assert.closeTo(sumSeeds, t.playoffs, 1e-9);
			assert.isAtMost(t.title, t.playoffs);
		}

		const best = odds.teams.find((t) => t.tid === 0)!;
		const worst = odds.teams.find((t) => t.tid === 29)!;
		assert.isAbove(best.playoffs, 0.99);
		assert.isAbove(best.title, 0.15);
		assert.isBelow(worst.playoffs, 0.01);
		assert.isAbove(best.projWon, worst.projWon + 30);

		if (g.get("playIn")) {
			const sumPlayIn = odds.teams.reduce((sum, t) => sum + t.playIn, 0);
			// 4 teams per conference
			assert.closeTo(sumPlayIn, 8, 1e-9);
		}
	});

	test("finished regular season is deterministic for seeding", async () => {
		const { teams } = makeLeague();
		const odds = await simSeasonOdds({
			teams,
			schedule: [],
			numGamesPlayoffSeries: g.get("numGamesPlayoffSeries", "current"),
			hca: 2.5,
			byConf: 2,
			numSims: 200,
			random: mulberry32(3),
		});
		// The best team in each conference is the #1 seed every time
		const best = odds.teams.find((t) => t.tid === 0)!;
		assert.strictEqual(best.seeds[0], 1);
	});
});

describe("season odds bracket format", () => {
	// Seed n is tid n - 1
	const st = (seed: number, won = 0, cid = 0) => ({
		tid: seed - 1,
		cid,
		seed,
		won,
	});
	const play = (
		series: { home: ReturnType<typeof st>; away?: ReturnType<typeof st> }[],
		numGamesPlayoffSeries: number[],
		ratingBySeed: Record<number, number>,
		{
			hca = 0,
			reseed = false,
			byConf = false as number | false,
			winp = (tid: number) => -tid,
		} = {},
	) => {
		const ratings = new Map<number, number>();
		for (let seed = 1; seed <= 16; seed++) {
			ratings.set(seed - 1, ratingBySeed[seed] ?? 0);
		}
		const roundsWon: number[][] = numGamesPlayoffSeries.map(() => []);
		simBracket({
			series: [series],
			startRound: 0,
			numGamesPlayoffSeries,
			ratings,
			hca,
			// Deterministic: the favorite always wins
			random: () => 0.5,
			onRoundWon: (tid, rnd) => roundsWon[rnd]!.push(tid + 1),
			byConf,
			reseed,
			winp,
		});
		return roundsWon;
	};

	test("home court follows the real schedule (best of 3: game 3 at the better seed)", () => {
		// 1-1 going into game 3 of a best of 3, even teams, home court decides it
		const won = play(
			[{ home: st(1, 1), away: st(2, 1) }],
			[3],
			{},
			{ hca: 50 },
		);
		assert.deepEqual(won, [[1]]);
	});

	// 8 teams: 8 and 6 pull upsets, 4 is the best team, 2 the worst left
	const ratings = { 8: 100, 6: 100, 4: 200, 7: -100 };
	const bracket = () => [
		{ home: st(1), away: st(8) },
		{ home: st(4), away: st(5) },
		{ home: st(3), away: st(6) },
		{ home: st(2), away: st(7) },
	];

	test("no reseeding: bracket positions", () => {
		// 4 v 8 and 2 v 6
		const won = play(bracket(), [1, 1, 1], ratings);
		assert.deepEqual(won[1], [4, 6]);
	});

	test("reseeding: best remaining seed plays the worst", () => {
		// 2 v 8 and 4 v 6
		const won = play(bracket(), [1, 1, 1], ratings, { reseed: true });
		assert.deepEqual(won[1], [8, 4]);
	});

	test("reseeding by conference uses the stored cid, then records across conferences", () => {
		// Conference 0 has seeds 1-4 of its own, conference 1 too, but the bracket lists them interleaved
		const c = (seed: number, cid: number) => st(seed, 0, cid);
		const series = [
			{ home: c(1, 0), away: c(4, 0) },
			{ home: { ...c(1, 1), tid: 10 }, away: { ...c(4, 1), tid: 13 } },
			{ home: c(2, 0), away: c(3, 0) },
			{ home: { ...c(2, 1), tid: 11 }, away: { ...c(3, 1), tid: 12 } },
		];
		const rating = new Map<number, number>([
			[0, 0],
			[3, 100],
			[10, 100],
			[13, 0],
			[1, 0],
			[2, 100],
			[11, 100],
			[12, 0],
		]);
		const roundsWon: number[][] = [[], [], []];
		simBracket({
			series: [series],
			startRound: 0,
			numGamesPlayoffSeries: [1, 1, 1],
			ratings: rating,
			hca: 0,
			random: () => 0.5,
			onRoundWon: (tid, rnd) => roundsWon[rnd]!.push(tid),
			byConf: 2,
			reseed: true,
			winp: () => 0.5,
		});
		// Conference 0: 4 (tid 3) and 3 (tid 2) won, conference 1: 1 (tid 10) and 2 (tid 11). Each conference final is within the
		// conference (by position, 3 would have met 1 of the other conference)
		assert.deepEqual(roundsWon[0], [3, 10, 2, 11]);
		// (even teams, so the road team wins: 3 at 2 and 11 at 10; grouped by position it would be 3 at 10 and 2 at 11)
		assert.deepEqual(roundsWon[1], [3, 11]);
	});
});

describe("award odds", () => {
	const scores = [
		{ pid: 1, score: 30 },
		{ pid: 2, score: 28 },
		{ pid: 3, score: 20 },
		{ pid: 4, score: 10 },
	];

	test("sum to 1, leader favored, more certain later in the season", () => {
		const early = awardWinProbs({
			scores,
			fracPlayed: 0.2,
			random: mulberry32(4),
		});
		const late = awardWinProbs({
			scores,
			fracPlayed: 0.9,
			random: mulberry32(4),
		});
		const sum = Object.values(early).reduce((a, b) => a + b, 0);
		assert.closeTo(sum, 1, 1e-9);
		assert.isAbove(early[1]!, early[3]!);
		assert.isAbove(late[1]!, early[1]!);
		assert.isBelow(late[4]!, early[4]! + 1e-9);
	});

	test("season over: leader wins", () => {
		const done = awardWinProbs({ scores, fracPlayed: 1 });
		assert.strictEqual(done[1], 1);
		assert.strictEqual(done[2], 0);
	});
});

describe("lottery what-if", () => {
	test("NBA 2019 odds, exact and simulated", () => {
		const info = getWhatIfChances({
			draftType: "nba2019",
			numLotteryTeams: 14,
			currentChances: [],
			currentDraftType: "nba2019",
			currentNumToPick: 4,
			numPlayInTeams: 4,
		});
		assert.strictEqual(info.numToPick, 4);
		assert.strictEqual(info.chances[0], 140);
		const out = lotteryWhatIfProbs({ ...info, numSims: 20000 });
		assert.closeTo(out.probs![0]![0]!, 0.14, 1e-6);
		assert.closeTo(out.monteCarlo[0]![0]!, 0.14, 0.015);
		// Worst team can't fall below 5th
		assert.strictEqual(out.monteCarlo[0]![5], 0);
		assert.strictEqual(out.sample.length, 14);
	});

	test("current format keeps the given chances", () => {
		const info = getWhatIfChances({
			draftType: "current",
			numLotteryTeams: 3,
			currentChances: [5, 3, 1],
			currentDraftType: "custom",
			currentNumToPick: 1,
			numPlayInTeams: 4,
		});
		const out = lotteryWhatIfProbs({ ...info, numSims: 5000 });
		assert.closeTo(out.probs![0]![0]!, 5 / 9, 1e-6);
	});
});
