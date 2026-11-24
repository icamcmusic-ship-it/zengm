import { assert, describe, test } from "vitest";
import { legacyTidOf } from "./legacyTid.ts";
import { processPlayersHallOfFame } from "../worker/util/processPlayersHallOfFame.ts";
import { legacyTidOf as ballotLegacyTidOf } from "../worker/core/hallOfFame/index.ts";

describe("legacy team", () => {
	test("the team he gave the most value for, playoffs included", () => {
		const stats = [
			{ tid: 1, gp: 82, ewa: 5 },
			{ tid: 1, gp: 82, ewa: 5 },
			// More games for team 2, less value
			{ tid: 2, gp: 82, ewa: 3 },
			{ tid: 2, gp: 82, ewa: 3 },
			{ tid: 2, gp: 82, ewa: 3 },
			// The playoffs tip it to team 2
			{ tid: 2, gp: 20, ewa: 2, playoffs: true },
			{ tid: -1, gp: 82, ewa: 50 },
		];
		assert.strictEqual(legacyTidOf(stats), 2);
		assert.strictEqual(legacyTidOf(stats.slice(0, 5)), 1);
	});

	test("no value stat: most regular season games, then the lower tid", () => {
		assert.strictEqual(
			legacyTidOf([
				{ tid: 3, gp: 50 },
				{ tid: 1, gp: 60 },
				{ tid: 1, gp: 30, playoffs: true },
			]),
			1,
		);
		assert.strictEqual(
			legacyTidOf([
				{ tid: 3, gp: 50 },
				{ tid: 2, gp: 50 },
			]),
			2,
		);
		assert.strictEqual(legacyTidOf([]), -1);
	});

	test("the Hall of Fame page and the ballot agree", () => {
		const stats = [
			{ season: 2020, tid: 4, gp: 82, ewa: 4, playoffs: false },
			{ season: 2021, tid: 7, gp: 40, ewa: 3, playoffs: false },
			{ season: 2021, tid: 7, gp: 15, ewa: 2, playoffs: true },
		];
		const [processed] = processPlayersHallOfFame([{ ratings: [], stats }]);
		assert.strictEqual(processed!.legacyTid, 7);
		assert.strictEqual(ballotLegacyTidOf({ stats } as any), 7);
	});
});
