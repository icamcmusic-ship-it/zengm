import { afterEach, assert, beforeEach, test, vi } from "vitest";
import { PHASE, PLAYER } from "../../common/constants.ts";
import { keyLeague, type PRState } from "../../common/playerRankings.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../db/index.ts";
import { g } from "./index.ts";
import {
	getPlayerRankings,
	resetPlayerRankingsMemo,
} from "./playerRankingsData.ts";

const statsRow = (
	season: number,
	tid: number,
	pts: number,
	playoffs = false,
) => ({
	season,
	tid,
	playoffs,
	gp: playoffs ? 10 : 80,
	min: 2000,
	pts,
	orb: 0,
	drb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tp: 0,
	ft: 0,
});

const player = (
	pid: number,
	tid: number,
	stats: any[],
	retiredYear = Infinity,
) => ({
	pid,
	tid,
	retiredYear,
	firstName: "Player",
	lastName: String(pid),
	stats,
	ratings: [],
	awards: [],
	draft: { year: 1999 },
});

// Retired players "in IndexedDB" (the mock league has none, so the merged reads are stubbed)
let db: any[] = [];
let reads: any[] = [];
let league: unknown;

beforeEach(async () => {
	resetG();
	league = idb.league;
	idb.league = mockIDBLeague();
	g.setWithoutSavingToDB("lid", 1);
	g.setWithoutSavingToDB("season", 2050);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("numGames", 82);
	delete (g as any).playerRankings;
	resetPlayerRankingsMemo();
	db = [
		player(2, PLAYER.RETIRED, [statsRow(2000, 0, 20000)], 2010),
		player(3, PLAYER.RETIRED, [statsRow(2040, 1, 15000)], 2049),
	];
	reads = [];
	vi.spyOn(idb.merged.players, "getAll").mockImplementation((async (
		selector: any,
		opts: any,
	) => {
		reads.push(selector);
		const cache = await idb.cache.players.getAll();
		const cachePids = new Set(cache.map((p) => p.pid));
		const all = [...db.filter((p) => !cachePids.has(p.pid)), ...cache];
		const out = all.filter((p) =>
			selector.retiredYear !== undefined
				? p.retiredYear === selector.retiredYear
				: true,
		);
		return out.map((p) => (opts?.map ? opts.map(p) : p));
	}) as any);
	vi.spyOn(idb.merged.players, "get").mockImplementation(((pid: number) =>
		Promise.resolve(db.find((p) => p.pid === pid))) as any);
	await resetCache({
		players: [
			player(1, 0, [
				statsRow(2045, 0, 9000),
				statsRow(2046, 0, 8000),
				statsRow(2046, 0, 900, true),
			]),
			player(5, 1, [statsRow(2048, 1, 500)]),
		],
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	idb.league = league as any;
});

test("first use reads every retired player once, then only each season's retirees", async () => {
	const p1 = (await idb.cache.players.get(1))!;
	const r = (await getPlayerRankings(p1))!;
	const pts = r.find(
		(x) => x.scope === "league" && x.stat === "pts" && !x.playoffs,
	)!;
	assert.strictEqual(pts.rank, 2);
	assert.strictEqual(pts.v, 17000);
	assert.strictEqual(pts.above?.pid, 2);
	assert.strictEqual(pts.aboveName, "Player 2");
	const fr = r.find(
		(x) => x.scope === "franchise" && x.stat === "pts" && !x.playoffs,
	)!;
	assert.strictEqual(fr.tid, 0);
	assert.strictEqual(fr.rank, 2);
	const po = r.find(
		(x) => x.scope === "league" && x.stat === "pts" && x.playoffs,
	)!;
	assert.strictEqual(po.rank, 1);

	const state = g.get("playerRankings" as any) as PRState;
	assert.strictEqual(state.through, 2049);
	assert.deepEqual(state.lists[keyLeague("pts", 0)], [
		[2, 20000],
		[3, 15000],
	]);
	assert.deepEqual(reads, [{ activeAndRetired: true }, { retiredYear: 2050 }]);

	// Nothing changed: the board is reused, no reads
	reads = [];
	await getPlayerRankings(p1);
	assert.deepEqual(reads, []);

	// A game played: the board is rebuilt from the kept lists and the live players
	const p = (await idb.cache.players.get(1))!;
	p.stats.push(statsRow(2050, 0, 4000) as any);
	await idb.cache.players.put(p);
	const r2 = (await getPlayerRankings(p))!;
	assert.strictEqual(
		r2.find((x) => x.scope === "league" && x.stat === "pts" && !x.playoffs)!
			.rank,
		1,
	);
	assert.deepEqual(reads, [{ retiredYear: 2050 }]);

	// Player 5 retires in 2050, then a new season: only the 2050 retirees are added to the kept lists
	await idb.cache.players.delete(5);
	db.push(player(5, PLAYER.RETIRED, [statsRow(2048, 1, 500)], 2050));
	g.setWithoutSavingToDB("season", 2051);
	reads = [];
	await getPlayerRankings(p);
	assert.deepEqual(reads, [{ retiredYear: 2050 }, { retiredYear: 2051 }]);
	const after = g.get("playerRankings" as any) as PRState;
	assert.strictEqual(after.through, 2050);
	assert.strictEqual(after.n, 3);
	assert.deepEqual(after.lists[keyLeague("pts", 0)], [
		[2, 20000],
		[3, 15000],
		[5, 500],
	]);
});

test("a deleted kept player makes the lists rebuild", async () => {
	const p1 = (await idb.cache.players.get(1))!;
	await getPlayerRankings(p1);
	db = db.filter((p) => p.pid !== 2);
	resetPlayerRankingsMemo();
	await getPlayerRankings(p1);
	assert.isUndefined(g.get("playerRankings" as any));
	reads = [];
	const r = (await getPlayerRankings(p1))!;
	assert.deepEqual(reads[0], { activeAndRetired: true });
	assert.strictEqual(
		r.find((x) => x.scope === "league" && x.stat === "pts" && !x.playoffs)!
			.rank,
		1,
	);
});

test("off with the option", async () => {
	g.setWithoutSavingToDB("featurePlayerRankings" as any, false);
	assert.isUndefined(
		await getPlayerRankings((await idb.cache.players.get(1))!),
	);
});
