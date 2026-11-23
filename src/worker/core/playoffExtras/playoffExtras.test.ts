import { assert, beforeEach, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { team } from "../index.ts";
import {
	challengeStatus,
	getChallengeEntries,
	maxPoints,
	roundPoints,
	scoreBracketChallenge,
	submitBracketPicks,
} from "./index.ts";
import type { PlayoffSeries } from "../../../common/types.ts";

const side = (tid: number, seed: number, won = 0) => ({
	tid,
	seed,
	cid: 0,
	won,
});

// 8 teams, 3 rounds of best-of-7
const setup = async () => {
	resetG();
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	g.setWithoutSavingToDB("numGamesPlayoffSeries", [
		{ start: -Infinity, value: [7, 7, 7] },
	] as any);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
	const ps: PlayoffSeries = {
		season: g.get("season"),
		currentRound: 0,
		series: [
			[
				{ home: side(0, 1), away: side(7, 8) },
				{ home: side(3, 4), away: side(4, 5) },
				{ home: side(1, 2), away: side(6, 7) },
				{ home: side(2, 3), away: side(5, 6) },
			],
		],
	};
	await idb.cache.playoffSeries.put(ps);
	return ps;
};

describe("bracket challenge", () => {
	beforeEach(async () => {
		await setup();
	});

	test("picks are validated, closed once games are played, and scored after each round", async () => {
		let ps = (await idb.cache.playoffSeries.get(g.get("season")))!;
		assert.strictEqual(challengeStatus(ps), "open");
		assert.strictEqual(maxPoints(ps), 4 * 10 + 2 * 20 + 40);

		// A pick that isn't in its series
		let threw = false;
		try {
			await submitBracketPicks([[0, 3, 1, 2], [0, 1], [5]]);
		} catch {
			threw = true;
		}
		assert.isTrue(threw);

		await submitBracketPicks([[0, 3, 1, 2], [0, 1], [0]]);
		assert.strictEqual(getChallengeEntries().length, 1);

		// First round: 0, 4 (upset), 1, 2 win
		ps.series[0] = [
			{ home: side(0, 1, 4), away: side(7, 8, 1) },
			{ home: side(3, 4, 2), away: side(4, 5, 4) },
			{ home: side(1, 2, 4), away: side(6, 7, 0) },
			{ home: side(2, 3, 4), away: side(5, 6, 3) },
		];
		ps.series[1] = [
			{ home: side(0, 1), away: side(4, 5) },
			{ home: side(1, 2), away: side(2, 3) },
		];
		ps.currentRound = 1;
		await idb.cache.playoffSeries.put(ps);
		assert.strictEqual(challengeStatus(ps), "closed");
		await scoreBracketChallenge();
		let entry = getChallengeEntries()[0]!;
		assert.deepEqual(entry.points, [3 * roundPoints(0)]);
		assert.strictEqual(entry.scoredRounds, 1);
		// Scoring again does nothing
		await scoreBracketChallenge();
		const events = (await idb.cache.events.getAll()).filter((e) =>
			e.text?.includes("Bracket Challenge"),
		);
		assert.strictEqual(events.length, 1);

		// Second round and the finals
		ps = (await idb.cache.playoffSeries.get(g.get("season")))!;
		ps.series[1] = [
			{ home: side(0, 1, 4), away: side(4, 5, 0) },
			{ home: side(1, 2, 1), away: side(2, 3, 4) },
		];
		ps.series[2] = [{ home: side(0, 1, 4), away: side(2, 3, 3) }];
		ps.currentRound = 2;
		await idb.cache.playoffSeries.put(ps);
		await scoreBracketChallenge();
		entry = getChallengeEntries()[0]!;
		assert.deepEqual(entry.points, [30, 20, 40]);
		assert.strictEqual(entry.scoredRounds, 3);
		const texts = (await idb.cache.events.getAll()).map((e) => e.text ?? "");
		assert.isTrue(texts.some((x) => x.includes("90 of 120 in all")));
	});
});
