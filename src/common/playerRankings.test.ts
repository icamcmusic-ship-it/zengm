import { assert, test } from "vitest";
import {
	keyFranchise,
	keyLeague,
	PR_LEAGUE_K,
	prAddRetired,
	prBuildBoard,
	prEmpty,
	prPlayerRankings,
	prRankIn,
	prRowsOf,
	prThresholds,
	type PRBoard,
	type PRRow,
} from "./playerRankings.ts";

const row = (
	season: number,
	tid: number,
	pts: number,
	extra: Record<string, number | boolean> = {},
) => ({
	season,
	tid,
	playoffs: false,
	gp: 70,
	min: 2000,
	pts,
	orb: 0,
	drb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tp: 0,
	ft: 0,
	...extra,
});

const rows = (...xs: any[]): PRRow[] => prRowsOf(xs);

// A league with history: enough players and seasons that the thresholds are at their maximum
const deepBoard = (board: PRBoard): PRBoard => ({
	...board,
	n: 5000,
	nFr: new Map([...board.nFr.keys()].map((t) => [t, 500])),
	minSeason: 1950,
	frMin: new Map([...board.frMin.keys()].map((t) => [t, 1950])),
});

test("rows: pre-draft/college rows and rows without games are left out, trb and ws are summed", () => {
	const r = rows(
		row(2000, -2, 500),
		row(2000, 1, 10, { gp: 0 }),
		row(2001, 1, 100, { orb: 3, drb: 7, ows: 1.25, dws: 0.5 }),
	);
	assert.strictEqual(r.length, 1);
	assert.strictEqual(r[0]!.trb, 10);
	assert.strictEqual(r[0]!.ws, 1.75);
});

test("ties use competition ranking (1, 1, 3) and report the tie", () => {
	const state = prEmpty(2049);
	prAddRetired(state, 1, rows(row(2000, 0, 1000)));
	prAddRetired(state, 2, rows(row(2000, 0, 1000)));
	prAddRetired(state, 3, rows(row(2000, 0, 900)));
	const board = deepBoard(prBuildBoard(state, []));
	const list = board.lists.get(keyLeague("pts", 0))!;
	assert.deepEqual(prRankIn(list, 2, 1000, PR_LEAGUE_K), {
		rank: 1,
		tied: true,
		above: undefined,
	});
	assert.deepEqual(prRankIn(list, 3, 900, PR_LEAGUE_K), {
		rank: 3,
		tied: false,
		above: { pid: 1, v: 1000, rank: 1 },
	});

	const r = prPlayerRankings(board, 3, rows(row(2000, 0, 900)), 2050).find(
		(x) => x.scope === "league" && x.stat === "pts",
	)!;
	assert.strictEqual(r.rank, 3);
	assert.isFalse(r.tied);
	const t = prPlayerRankings(board, 1, rows(row(2000, 0, 1000)), 2050).find(
		(x) => x.scope === "league" && x.stat === "pts",
	)!;
	assert.strictEqual(t.rank, 1);
	assert.isTrue(t.tied);
});

test("a cut list doesn't give a rank past its depth", () => {
	const list: [number, number][] = [];
	for (let i = 0; i < PR_LEAGUE_K; i++) {
		list.push([i, 10000 - i]);
	}
	assert.isUndefined(prRankIn(list, 999, 5, PR_LEAGUE_K));
	// Tied with the last kept total: still known
	assert.strictEqual(
		prRankIn(list, 999, 10000 - PR_LEAGUE_K + 1, PR_LEAGUE_K)!.rank,
		PR_LEAGUE_K,
	);
});

test("franchise = tid: a relocated team's seasons add up, a traded player counts for each franchise", () => {
	const state = prEmpty(2049);
	// Franchise 4 relocated in 2010 (same tid, new name): his seasons there are one franchise total
	prAddRetired(state, 1, rows(row(2005, 4, 600), row(2012, 4, 600)));
	// More points overall but split between two franchises
	prAddRetired(state, 2, rows(row(2005, 4, 1000), row(2006, 7, 1000)));
	const board = deepBoard(prBuildBoard(state, []));
	assert.deepEqual(board.lists.get(keyFranchise(4, "pts", 0)), [
		[1, 1200],
		[2, 1000],
	]);
	const r2 = prPlayerRankings(
		board,
		2,
		rows(row(2005, 4, 1000), row(2006, 7, 1000)),
		2050,
	);
	const fr = r2.filter((x) => x.scope === "franchise" && x.stat === "pts");
	assert.deepEqual(
		fr.map((x) => [x.tid, x.rank]).sort((a, b) => a[0]! - b[0]!),
		[
			[4, 2],
			[7, 1],
		],
	);
	assert.strictEqual(
		r2.find((x) => x.scope === "league" && x.stat === "pts")!.rank,
		1,
	);
});

test("playoffs and regular season are ranked separately", () => {
	const state = prEmpty(2049);
	prAddRetired(
		state,
		1,
		rows(row(2000, 0, 5000), row(2000, 0, 50, { playoffs: true })),
	);
	prAddRetired(
		state,
		2,
		rows(row(2000, 1, 3000), row(2000, 1, 800, { playoffs: true })),
	);
	const board = deepBoard(prBuildBoard(state, []));
	const r = prPlayerRankings(
		board,
		2,
		rows(row(2000, 1, 3000), row(2000, 1, 800, { playoffs: true })),
		2050,
	);
	const reg = r.find(
		(x) => x.scope === "league" && x.stat === "pts" && !x.playoffs,
	)!;
	const po = r.find(
		(x) => x.scope === "league" && x.stat === "pts" && x.playoffs,
	)!;
	assert.strictEqual(reg.rank, 2);
	assert.strictEqual(po.rank, 1);
	assert.strictEqual(po.v, 800);
});

test("live players are laid over the kept lists, replacing their kept entries (comebacks)", () => {
	const state = prEmpty(2049);
	prAddRetired(state, 1, rows(row(2000, 0, 1000)));
	prAddRetired(state, 2, rows(row(2000, 0, 900)));
	// Player 2 came back and scored 500 more
	const board = prBuildBoard(state, [
		{ pid: 2, rows: rows(row(2000, 0, 900), row(2050, 0, 500)) },
		{ pid: 3, rows: rows(row(2050, 1, 1100)) },
	]);
	assert.deepEqual(board.lists.get(keyLeague("pts", 0)), [
		[2, 1400],
		[3, 1100],
		[1, 1000],
	]);
	// He retires again: his entries are replaced, not duplicated
	prAddRetired(state, 2, rows(row(2000, 0, 900), row(2050, 0, 500)));
	assert.deepEqual(state.lists[keyLeague("pts", 0)], [
		[2, 1400],
		[1, 1000],
	]);
});

test("thresholds grow with the league's history and players; new franchises have none at first", () => {
	const base = {
		n: 500,
		nFr: new Map([
			[0, 200],
			[9, 15],
		]),
		minSeason: 2000,
		frMin: new Map([
			[0, 2000],
			[9, 2050],
		]),
	};
	assert.strictEqual(
		prThresholds({ ...base, minSeason: 2050 }, 2050).league,
		0,
	);
	assert.strictEqual(prThresholds(base, 2050).league, 20);
	assert.strictEqual(prThresholds({ ...base, n: 10000 }, 2050).league, 50);
	assert.strictEqual(prThresholds(base, 2050, 0).franchise, 10);
	// Expansion team in its first season
	assert.strictEqual(prThresholds(base, 2050, 9).franchise, 0);
	assert.strictEqual(prThresholds(base, 2051, 9).franchise, 3);
});

test("single seasons: his seasons are ranked, summed over teams", () => {
	const state = prEmpty(2049);
	prAddRetired(state, 1, rows(row(1990, 0, 2500)));
	prAddRetired(state, 2, rows(row(1991, 0, 2200)));
	for (let i = 0; i < 10; i++) {
		prAddRetired(state, 10 + i, rows(row(1992, 0, 1500)));
	}
	const board = deepBoard(
		prBuildBoard(state, [
			{
				pid: 3,
				// Traded mid-season: 1,300 + 1,000 = 2,300
				rows: rows(row(2049, 0, 1300), row(2049, 5, 1000), row(2050, 5, 100)),
			},
		]),
	);
	const r = prPlayerRankings(
		board,
		3,
		rows(row(2049, 0, 1300), row(2049, 5, 1000), row(2050, 5, 100)),
		2050,
	).filter((x) => x.scope === "season" && x.stat === "pts");
	assert.deepEqual(
		r.map((x) => [x.season, x.rank, x.v]),
		[[2049, 2, 2300]],
	);
});

test("sorted by significance: a league top 5 before a deep franchise rank", () => {
	const state = prEmpty(2049);
	for (let i = 0; i < 40; i++) {
		prAddRetired(state, 100 + i, rows(row(2000, i % 2, 10000 - i * 100)));
	}
	// A short stint with franchise 3 (5 games) is no franchise career
	const mine = rows(row(2040, 0, 9650), row(2041, 3, 10, { gp: 5 }));
	const board = deepBoard(prBuildBoard(state, [{ pid: 1, rows: mine }]));
	const r = prPlayerRankings(board, 1, mine, 2050, [20, 2]);
	assert.isFalse(r.some((x) => x.tid === 3));
	assert.strictEqual(r[0]!.scope, "league");
	assert.strictEqual(r[0]!.stat, "pts");
	assert.strictEqual(r[0]!.rank, 5);
	assert.deepEqual(r[0]!.above, { pid: 103, v: 9700, rank: 4 });
});
