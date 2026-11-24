// More draft rounds mid-league: every upcoming class is topped up once, without touching anyone already in it
import { afterAll, assert, beforeAll, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { mockIDBLeague } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { draft, league } from "../index.ts";
import { getDraftClassTargetSize } from "./genPlayersWithoutSaving.ts";
import { loadTeamSeasons } from "./testHelpers.ts";

const sizes = async () => {
	const m = new Map<number, number>();
	for (const p of await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	)) {
		m.set(p.draft.year, (m.get(p.draft.year) ?? 0) + 1);
	}
	return m;
};

describe("top up undersized draft classes", () => {
	beforeAll(async () => {
		await loadTeamSeasons();
		idb.league = mockIDBLeague();
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		g.setWithoutSavingToDB("numDraftClasses", 2);
		for (const year of [g.get("season"), g.get("season") + 1]) {
			await draft.genPlayers(year, DEFAULT_LEVEL);
		}
	});
	afterAll(() => {
		// @ts-expect-error
		idb.league = undefined;
	});

	test("without a settings change, full classes are left alone", async () => {
		assert.deepEqual(
			await draft.topUpDraftClasses(undefined, undefined, {
				undersized: true,
			}),
			[],
		);
	});

	test("a third round: both classes grow to the new size, the old prospects untouched", async () => {
		const before = await sizes();
		const old = new Map(
			(
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			).map((p) => [p.pid, JSON.stringify(p.ratings)]),
		);
		await league.setGameAttributes({ numDraftRounds: 3 });
		const after = await sizes();
		const target = getDraftClassTargetSize().baseNumPlayers;
		for (const [year, n] of before) {
			assert.isBelow(n, target);
			assert.strictEqual(after.get(year), target, String(year));
		}
		for (const p of await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		)) {
			if (old.has(p.pid)) {
				assert.strictEqual(JSON.stringify(p.ratings), old.get(p.pid));
			}
		}
		// Once: nothing left to do
		assert.deepEqual(
			await draft.topUpDraftClasses(undefined, undefined, {
				undersized: true,
			}),
			[],
		);
	});

	test("fewer rounds: nothing removed or added", async () => {
		const before = await sizes();
		await league.setGameAttributes({ numDraftRounds: 2 });
		assert.deepEqual(await sizes(), before);
	});
});
