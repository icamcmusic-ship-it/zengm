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
import { findRealComps } from "../../../common/realComps.ts";

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

test(
	"every prospect of a generated class gets 3 real players' real young seasons, fast",
	{ timeout: 60_000 },
	async () => {
		await getRealCompIndex();
		const start = performance.now();
		const comps = await getRealComps(players);
		const ms = performance.now() - start;
		// A guard against a blowup (a scan per pair of prospects, the index rebuilt per prospect, ...), not a benchmark: a class takes
		// ~0.1 s alone (0.15 s before rows that cannot make the result were skipped), but a combined run shares the CPU with other
		// test files' leagues, which stretched it past a tighter 1.5 s
		assert.isBelow(ms, 5000, `${ms} ms for ${players.length} prospects`);
		assert.strictEqual(comps.size, players.length);
		// (comp fix: the user saw the same few names for late picks) A real player is the comp of at most 2 prospects of a class
		const uses = new Map<string, number>();
		for (const list of comps.values()) {
			for (const c of list) {
				uses.set(c.name, (uses.get(c.name) ?? 0) + 1);
			}
		}
		assert.isAtMost(Math.max(...uses.values()), 2);
		assert.isAbove(uses.size, players.length);

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

		// The search skips rows that can't make the result (findRealComps): the same closest players as a search that keeps every
		// one (count = every player: it never skips, but its own pick of the best is slow, so only a few prospects)
		players.forEach((p, i) => {
			const input = { ...shownCompInput(p), levelPct: 0.5 };
			const { levelPct: _, ...noLevel } = input;
			for (const x of [input, noLevel]) {
				const ref = findRealComps(index, x, i < 3 ? index.slugs.length : 40);
				assert.deepStrictEqual(findRealComps(index, x, 15), ref.slice(0, 15));
				assert.deepStrictEqual(findRealComps(index, x, 3), ref.slice(0, 3));
			}
		});

		// Same prospect, same comps (also from a fresh index)
		resetRealCompsForTests();
		const again = await getRealComps(players);
		for (const p of players) {
			assert.deepStrictEqual(again.get(p.pid), comps.get(p.pid));
		}
	},
);

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
