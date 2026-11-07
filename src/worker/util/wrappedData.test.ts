import * as fakeIndexedDB from "fake-indexeddb";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import { PHASE, PLAYER } from "../../common/constants.ts";
import type {
	Game,
	Player,
	TeamSeason,
	TeamStats,
} from "../../common/types.ts";
import { LeagueIndex } from "../../common/wrapped/league.ts";
import { resetCache, resetG } from "../../test/helpers.ts";
import { player, team } from "../core/index.ts";
import { changeLog } from "../db/changeLog.ts";
import { STORES } from "../db/Cache.ts";
import { connectLeague, idb } from "../db/index.ts";
import { forgetLeague } from "./wrappedPersist.ts";
import { g } from "./index.ts";
import {
	getWrapped,
	loadWrappedLeague,
	memoize,
	resetWrappedCache,
} from "./wrappedData.ts";

const IDB_GLOBALS = [
	"IDBCursor",
	"IDBCursorWithValue",
	"IDBDatabase",
	"IDBIndex",
	"IDBObjectStore",
	"IDBOpenDBRequest",
	"IDBRequest",
	"IDBTransaction",
] as const;

const SEASON = 2016;
const FIRST = 2009;

const statRow = (season: number, tid: number, pts: number, playoffs = false) =>
	({
		season,
		tid,
		playoffs,
		gp: 10,
		gs: 5,
		min: 300,
		pts,
		orb: 10,
		drb: 20,
		ast: 30,
		stl: 4,
		blk: 3,
		tov: 7,
		tp: 5,
		tpa: 12,
		fg: 40,
		fga: 90,
		ft: 20,
		fta: 25,
		per: 15,
		ows: 1,
		dws: 1,
		obpm: 1,
		dbpm: 1,
		vorp: 0.5,
	}) as any;

const makePlayer = (
	pid: number,
	tid: number,
	seasons: number[],
	overrides: Partial<Player> = {},
): Player => {
	const p = player.generate(tid, 25, FIRST - 3, true, DEFAULT_LEVEL);
	return {
		...p,
		pid,
		tid,
		retiredYear: tid === PLAYER.RETIRED ? seasons.at(-1)! : Infinity,
		stats: seasons.map((s) => statRow(s, 0, 100 + pid * 10 + s - FIRST)),
		...overrides,
	};
};

const makeTeamSeason = (
	rid: number,
	tid: number,
	season: number,
): TeamSeason => {
	const t = team.generate({
		tid,
		cid: 0,
		did: 0,
		region: "Region",
		name: `Name${tid}`,
		abbrev: `AB${tid}`,
		pop: 1,
	});
	return {
		...team.genSeasonRow(t),
		rid,
		season,
		won: 40 + tid,
		lost: 42 - tid,
	};
};

const makeTeamStats = (
	rid: number,
	tid: number,
	season: number,
): TeamStats => ({
	...team.genStatsRow(tid, false),
	rid,
	season,
	gp: 82,
	pts: 8200 + season,
});

const makeGame = (gid: number, season: number): Game =>
	({
		gid,
		season,
		day: gid,
		lost: { tid: 1, pts: 90 },
		won: { tid: 0, pts: 100 },
		overtimes: 0,
		teams: [
			{
				tid: 0,
				pts: 100,
				players: [
					{ pid: 3, name: "A B", min: 30, pts: 20, orb: 1, drb: 4, ast: 5 },
				],
			},
			{ tid: 1, pts: 90, players: [] },
		],
	}) as any;

// Everything about the snapshot that matters, in a form that can be compared
const plain = (x: unknown) => structuredClone(x);

const marks = () =>
	((globalThis as any).__wperf ?? []) as { name: string; ms: number }[];
const lastMark = (name: string) => marks().findLast((m) => m.name === name)?.ms;

beforeAll(async () => {
	for (const name of IDB_GLOBALS) {
		(globalThis as any)[name] = fakeIndexedDB[name];
	}
	globalThis.indexedDB = new fakeIndexedDB.IDBFactory();
	resetG();
	idb.league = await connectLeague(1);
});

afterAll(() => {
	idb.league.close();
	// @ts-expect-error
	idb.league = undefined;
	// @ts-expect-error
	delete globalThis.indexedDB;
	for (const name of IDB_GLOBALS) {
		delete globalThis[name];
	}
});

beforeEach(async () => {
	const tx = idb.league.transaction(STORES, "readwrite");
	for (const store of STORES) {
		await tx.objectStore(store).clear();
	}
	await tx.done;
	await resetCache({});
	resetG();
	Object.assign(g, {
		lid: 1,
		season: SEASON,
		startingSeason: FIRST,
		phase: PHASE.REGULAR_SEASON,
	});
	changeLog.reset();
	resetWrappedCache();
	await forgetLeague(1);
	(globalThis as any).__wperf = [];

	// Retired players only in IndexedDB
	await idb.league.put("players", makePlayer(1, PLAYER.RETIRED, [2009, 2015]));
	await idb.league.put("players", makePlayer(2, PLAYER.RETIRED, [2009]));
	// Active players are in the cache
	await idb.cache.players.put(makePlayer(3, 0, [2009, 2015, 2016]));
	await idb.cache.players.put(makePlayer(4, 1, [2015, 2016]));
	// The cache has the last few seasons of team seasons and the current season of team stats
	let rid = 0;
	for (const season of [2009, 2015, 2016]) {
		for (const tid of [0, 1]) {
			const ts = makeTeamSeason(rid++, tid, season);
			await idb.league.put("teamSeasons", ts);
			if (season >= 2015) {
				await idb.cache.teamSeasons.put(ts);
			}
			const st = makeTeamStats(rid, tid, season);
			await idb.league.put("teamStats", st);
			if (season === 2016) {
				await idb.cache.teamStats.put(st);
			}
		}
	}
	await idb.league.put("games", makeGame(1, 2015));
	await idb.league.put("games", makeGame(2, 2015));
	await idb.cache.games.put(makeGame(3, 2016));
	await idb.league.put("playoffSeries", {
		season: 2015,
		currentRound: 1,
		series: [
			[
				{
					home: { tid: 0, cid: 0, seed: 1, won: 4 },
					away: { tid: 1, cid: 0, seed: 2, won: 1 },
				},
			],
		],
	} as any);
});

describe("Wrapped snapshot", () => {
	test("reading the whole league, once, gives the same as a fresh read", async () => {
		const built = await getWrapped();
		expect(built.L.players.map((p) => p.pid)).toEqual([1, 2, 3, 4]);
		expect(built.L.games.map((gm) => gm.gid)).toEqual([1, 2, 3]);
		expect(built.L.teamSeasons).toHaveLength(6);
		expect(built.L.teamSeasons.every((ts) => ts.pts > 0)).toBe(true);
		expect(plain(built.L)).toEqual(plain(await loadWrappedLeague()));
	});

	test("nothing is rebuilt if nothing changed, and results are shared", async () => {
		const a = await getWrapped();
		const b = await getWrapped();
		expect(b).toBe(a);
		let runs = 0;
		const f = () => {
			runs += 1;
			return runs;
		};
		expect(await memoize(a, "k", f)).toBe(1);
		expect(await memoize(a, "k", f)).toBe(1);
	});

	test("after changes, only what changed is read again and the result is still right", async () => {
		const a = await getWrapped();
		const lines2015 = a.X.lines(2015);
		expect(lastMark("snapshot.playersRead")).toBe(2);

		// A game day: active players and the current season change
		const p4 = (await idb.cache.players.get(4))!;
		p4.stats.push(statRow(2016, 1, 999));
		p4.stats = p4.stats.filter((r) => !(r.season === 2016 && r.pts !== 999));
		await idb.cache.players.put(p4);
		await idb.cache.games.put(makeGame(4, 2016));
		const ts = (await idb.cache.teamSeasons.getAll()).find(
			(t) => t.season === 2016 && t.tid === 0,
		)!;
		ts.won += 1;
		await idb.cache.teamSeasons.put(ts);

		const b = await getWrapped();
		expect(b).not.toBe(a);
		// No retired player was read again
		expect(lastMark("snapshot.playersRead")).toBe(0);
		expect(b.L.games.map((gm) => gm.gid)).toEqual([1, 2, 3, 4]);
		expect(b.L.players[3]!.stats.find((r) => r.season === 2016)!.pts).toBe(999);
		expect(plain(b.L)).toEqual(plain(await loadWrappedLeague()));
		// Lines of a season that is over are kept
		expect(b.X.lines(2015)).toBe(lines2015);
		expect(plain(b.X.lines(2016))).toEqual(
			plain(new LeagueIndex(b.L).lines(2016)),
		);
	});

	test("changing a retired player updates the snapshot and the lines of his seasons", async () => {
		const a = await getWrapped();
		const before = a.X.lines(2015).find((l) => l.pid === 1)!.pts;

		// Like editing a retired player in God Mode
		const p1 = (await idb.merged.players.get(1))!;
		p1.stats = p1.stats.map((r) =>
			r.season === 2015 ? { ...r, pts: (r.pts ?? 0) + 500 } : r,
		);
		await idb.cache.players.put(p1);

		const b = await getWrapped();
		expect(b.X.lines(2015).find((l) => l.pid === 1)!.pts).toBe(before + 500);
		expect(plain(b.L)).toEqual(plain(await loadWrappedLeague()));
		expect(plain(b.X.lines(2015))).toEqual(
			plain(new LeagueIndex(b.L).lines(2015)),
		);
	});

	test("a player who retires moves in the player order, and lines of past seasons follow", async () => {
		const a = await getWrapped();
		a.X.lines(2015);
		a.X.poLines(2015);

		// Retiring: written to the cache and, once flushed, IndexedDB; he is read as a retired player from then on
		const p4 = (await idb.cache.players.get(4))!;
		p4.tid = PLAYER.RETIRED;
		p4.retiredYear = 2016;
		await idb.cache.players.put(p4);
		await idb.league.put("players", p4);
		delete idb.cache._data.players[4];

		const b = await getWrapped();
		// Retired players come first, then the rest
		expect(b.L.players.map((p) => p.pid)).toEqual([1, 2, 4, 3]);
		const fresh = new LeagueIndex(b.L);
		expect(plain(b.X.lines(2015))).toEqual(plain(fresh.lines(2015)));
		expect(plain(b.X.lines(2009))).toEqual(plain(fresh.lines(2009)));
		expect(plain(b.L)).toEqual(plain(await loadWrappedLeague()));
	});

	test("a new session starts from what the last one saved, and drops what was changed since", async () => {
		await getWrapped();
		// The save happens once things are quiet
		await new Promise((resolve) => {
			setTimeout(resolve, 1200);
		});

		resetWrappedCache();
		(globalThis as any).__wperf = [];
		const b = await getWrapped();
		expect(lastMark("snapshot.persistedPlayers")).toBe(2);
		expect(lastMark("snapshot.playersRead")).toBe(0);
		expect(plain(b.L)).toEqual(plain(await loadWrappedLeague()));

		// A retired player edited, then another new session
		const p2 = (await idb.merged.players.get(2))!;
		p2.stats = p2.stats.map((r) => ({ ...r, pts: 12345 }));
		await idb.cache.players.put(p2);
		// A flush writes him to IndexedDB, and a later session has him in IndexedDB only
		await idb.league.put("players", p2);
		delete idb.cache._data.players[2];
		resetWrappedCache();
		changeLog.reset();
		(globalThis as any).__wperf = [];
		const c = await getWrapped();
		expect(c.L.players.find((p) => p.pid === 2)!.stats[0]!.pts).toBe(12345);
		expect(lastMark("snapshot.playersRead")).toBeGreaterThan(0);
		expect(plain(c.L)).toEqual(plain(await loadWrappedLeague()));
	});
});
