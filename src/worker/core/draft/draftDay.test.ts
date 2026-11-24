import { afterAll, assert, beforeAll, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { mockIDBLeague } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, local } from "../../util/index.ts";
import { draft } from "../index.ts";
import { getAITeamBoards, getDraftDayTrade } from "./draftDay.ts";
import { loadTeamSeasons } from "./testHelpers.ts";

describe("draft-day boards", () => {
	beforeAll(async () => {
		await loadTeamSeasons();
		idb.league = mockIDBLeague();
		g.setWithoutSavingToDB("phase", PHASE.DRAFT);
		g.setWithoutSavingToDB("userTid", 0);
		g.setWithoutSavingToDB("userTids", [0]);
		await draft.genPlayers(g.get("season"), DEFAULT_LEVEL);
		await draft.genOrder(false, undefined, "nba1994");
		await idb.cache.trade.put({
			rid: 0,
			teams: [
				{ tid: 0, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
				{ tid: 1, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
			],
		});
	});
	afterAll(() => {
		g.setWithoutSavingToDB("spectator", false);
		local.autoPlayUntil = undefined;
		// @ts-expect-error
		idb.league = undefined;
	});

	test("the user's own team has no board while the user runs it", async () => {
		g.setWithoutSavingToDB("spectator", false);
		const boards = await getAITeamBoards();
		assert.isFalse(boards.some((b) => b.tid === 0));
		assert.isFalse(boards.some((b) => b.user));
		assert.strictEqual(boards.length, g.get("numActiveTeams") - 1);
	});

	test("spectator mode and auto play: the AI runs the user's team, so it has a board too", async () => {
		g.setWithoutSavingToDB("spectator", true);
		let boards = await getAITeamBoards();
		const own = boards.find((b) => b.tid === 0);
		assert.isDefined(own);
		assert.isTrue(own!.user);
		assert.strictEqual(own!.board.length, 5);
		assert.strictEqual(boards.length, g.get("numActiveTeams"));
		g.setWithoutSavingToDB("spectator", false);

		local.autoPlayUntil = {
			season: g.get("season") + 1,
			phase: 0,
			start: 0,
			resolve: () => {},
			reject: () => {},
		};
		boards = await getAITeamBoards();
		assert.isTrue(boards.some((b) => b.tid === 0 && b.user));
		local.autoPlayUntil = undefined;
	});

	test("the user's own team is never a trade partner", async () => {
		assert.isUndefined(await getDraftDayTrade(0));
		const other = await getDraftDayTrade(1);
		assert.strictEqual(other?.teams[0].tid, 0);
		assert.strictEqual(other?.teams[1].tid, 1);
	});
});
