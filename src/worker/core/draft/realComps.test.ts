import { afterAll, assert, beforeAll, test } from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { draft } from "../index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import loadDataBasketball from "../realRosters/loadData.basketball.ts";
import {
	getRealCompIndex,
	getRealComps,
	resetRealCompsForTests,
	shownCompInput,
} from "./realComps.ts";
import type { Player } from "../../../common/types.ts";

let players: Player[];

beforeAll(async () => {
	resetG();
	g.setWithoutSavingToDB("featureRealComps" as any, true);
	await resetCache({});
	idb.league = mockIDBLeague();
	resetRealCompsForTests();
	await draft.genPlayers(g.get("season"), DEFAULT_LEVEL);
	players = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
	).filter((p) => p.draft.year === g.get("season"));
});

afterAll(() => {
	resetRealCompsForTests();
	// @ts-expect-error
	idb.league = undefined;
});

test("every prospect of a generated class gets 3 real players' real young seasons, fast", async () => {
	await getRealCompIndex();
	const start = performance.now();
	const comps = await getRealComps(players);
	const ms = performance.now() - start;
	assert.isBelow(ms, 1500, `${ms} ms for ${players.length} prospects`);
	assert.strictEqual(comps.size, players.length);

	const data = await loadDataBasketball();
	const realNames = new Set(Object.values(data.bios).map((b) => b.name));
	for (const p of players) {
		const list = comps.get(p.pid)!;
		assert.strictEqual(list.length, 3);
		assert.strictEqual(new Set(list.map((c) => c.name)).size, 3);
		for (const c of list) {
			assert.isTrue(realNames.has(c.name), c.name);
			assert.match(c.season, /^\d{4}-\d{2}$/);
			assert.isAtMost(c.age, 40);
			assert.include(["very close", "close", "fair", "loose"], c.similarity);
			assert.include(
				["MVP", "All-Star", "starter", "role player", "bench player"],
				c.became,
			);
		}
		// Best first
		assert.isAtMost(list[0]!.distance, list[2]!.distance);
	}

	// Each comp season is one he really played for an NBA team
	const index = (await getRealCompIndex())!;
	for (let row = 0; row < index.rowPlayer.length; row += 97) {
		const slug = index.slugs[index.rowPlayer[row]!]!;
		const season = index.rowSeason[row]!;
		assert.isTrue(
			data.teams[slug]!.some(
				(t) => t.season === season && typeof t.abbrev === "string",
			),
		);
		assert.isTrue(
			data.ratings.some((r) => r.slug === slug && r.season === season),
		);
		assert.isBelow(season, index.lastSeason);
	}

	// Same prospect, same comps (also from a fresh index)
	resetRealCompsForTests();
	const again = await getRealComps(players);
	for (const p of players) {
		assert.deepStrictEqual(again.get(p.pid), comps.get(p.pid));
	}
});

test("comps read the ratings as the scouts see them", () => {
	const p = players[0]!;
	const pr = p.ratings.at(-1)! as any;
	const oldFuzz = pr.fuzz;
	pr.fuzz = 5;
	const input = shownCompInput(p);
	assert.strictEqual(input.ratings.hgt, pr.hgt);
	assert.strictEqual(input.ratings.oiq, Math.min(100, Math.round(pr.oiq + 5)));
	pr.fuzz = oldFuzz;
});

test("nothing for non-prospects, with the feature off, with no visible ratings, or without the data", async () => {
	const p = players[0]!;
	const drafted = { ...p, tid: 0 } as Player;
	assert.strictEqual((await getRealComps([drafted])).size, 0);

	g.setWithoutSavingToDB("featureRealComps" as any, false);
	assert.strictEqual((await getRealComps([p])).size, 0);
	g.setWithoutSavingToDB("featureRealComps" as any, true);

	g.setWithoutSavingToDB("challengeNoRatings", true);
	assert.strictEqual((await getRealComps([p])).size, 0);
	g.setWithoutSavingToDB("challengeNoRatings", false);

	// Offline: quietly nothing, and no new try right away
	let calls = 0;
	resetRealCompsForTests(() => {
		calls += 1;
		return Promise.reject(new Error("offline"));
	});
	assert.strictEqual((await getRealComps([p])).size, 0);
	assert.strictEqual((await getRealComps([p])).size, 0);
	assert.strictEqual(calls, 1);
	resetRealCompsForTests();
	assert.strictEqual((await getRealComps([p])).size, 1);
});
