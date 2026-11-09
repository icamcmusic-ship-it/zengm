import { assert, describe, test } from "vitest";
import {
	addGame,
	allStreaks,
	buildBook,
	crossed,
	emptyState,
	findChases,
	reachedThisSeason,
	teamGamesToReach,
	type RBGameIn,
	type RBPlayer,
	type RBRow,
} from "./recordsBook.ts";

const row = (
	season: number,
	tid: number,
	gp: number,
	pts: number,
	playoffs = false,
	other: Partial<RBRow> = {},
): RBRow => ({
	season,
	tid,
	playoffs,
	gp,
	pts,
	trb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tp: 0,
	...other,
});

const line = (pid: number, pts: number, min = 30) => ({
	pid,
	min,
	pts,
	trb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tp: 0,
});

const game = (
	gid: number,
	season: number,
	[a, b]: [number, number],
	[ptsA, ptsB]: [number, number],
	lines: ReturnType<typeof line>[] = [],
	playoffs = false,
): RBGameIn => ({
	gid,
	season,
	day: gid,
	playoffs,
	teams: [
		{ tid: a, pts: ptsA, players: lines },
		{ tid: b, pts: ptsB, players: [] },
	],
});

const ctx = {
	season: 2025,
	numGames: () => 82,
	teamGamesNow: 40,
	regularSeasonDone: false,
};

describe("single-game highs and streaks", () => {
	test("a new league single-game high is news only when it beats an earlier season's record", () => {
		const state = emptyState();
		assert.deepEqual(
			addGame(state, game(1, 2024, [0, 1], [100, 90], [line(5, 50)]), true),
			[],
		);
		// Same season: not news yet (the record is a few games old)
		assert.deepEqual(
			addGame(state, game(2, 2024, [0, 1], [100, 90], [line(6, 55)]), true),
			[],
		);
		const news = addGame(
			state,
			game(3, 2025, [0, 1], [100, 90], [line(7, 60)]),
			true,
		);
		assert.strictEqual(news.length, 1);
		const n = news[0]!;
		assert.strictEqual(n.kind, "game");
		if (n.kind === "game") {
			assert.strictEqual(n.high.p, 7);
			assert.strictEqual(n.prev.p, 6);
		}
		assert.deepEqual(
			state.game["pts|0"]!.map((x) => x.v),
			[60, 55, 50],
		);
		assert.strictEqual(state.gameFr["0"]!["pts|0"]!.length, 3);
		// Already processed games are skipped
		assert.deepEqual(
			addGame(state, game(3, 2025, [0, 1], [100, 90], [line(8, 99)]), true),
			[],
		);
		assert.strictEqual(state.game["pts|0"]![0]!.v, 60);
	});

	test("did-not-play lines and playoff games are kept apart", () => {
		const state = emptyState();
		addGame(state, game(1, 2024, [0, 1], [1, 0], [line(1, 40, 0)]), false);
		addGame(state, game(2, 2024, [0, 1], [1, 0], [line(2, 41)], true), false);
		assert.isUndefined(state.game["pts|0"]);
		assert.strictEqual(state.game["pts|1"]![0]!.p, 2);
	});

	test("streaks: runs within a season, finished and ongoing, and the record winning streak", () => {
		const state = emptyState();
		let gid = 0;
		for (let i = 0; i < 12; i++) {
			addGame(state, game(++gid, 2024, [0, 1], [100, 90]), true);
		}
		// Season change ends the run
		addGame(state, game(++gid, 2025, [1, 0], [100, 90]), true);
		const wins = allStreaks(state, 1);
		assert.strictEqual(wins[0]!.n, 12);
		assert.isFalse(wins[0]!.ongoing);
		assert.strictEqual(allStreaks(state, -1)[0]!.n, 12);
		assert.strictEqual(state.rec.streak!.v, 12);

		const news = [];
		for (let i = 0; i < 13; i++) {
			news.push(...addGame(state, game(++gid, 2025, [1, 0], [100, 90]), true));
		}
		assert.strictEqual(news.length, 1);
		assert.strictEqual(news[0]!.kind, "streak");
		assert.strictEqual(state.rec.streak!.v, 14);
		assert.isTrue(allStreaks(state, 1)[0]!.ongoing);
	});
});

describe("records book", () => {
	const players: RBPlayer[] = [
		{
			pid: 1,
			name: "Old Legend",
			tid: -3,
			rows: [row(2010, 0, 82, 2500), row(2011, 0, 82, 2400)],
		},
		{
			pid: 2,
			name: "Current Star",
			tid: 1,
			rows: [
				row(2023, 1, 82, 2000),
				row(2024, 1, 82, 2100),
				row(2025, 1, 40, 2700),
				row(2025, 1, 10, 300, true),
			],
		},
		{
			pid: 3,
			name: "Traded Guy",
			tid: 2,
			rows: [row(2025, 1, 20, 400), row(2025, 2, 20, 500)],
		},
	];

	const sections = buildBook({
		players,
		teamSeasons: [
			{ tid: 0, season: 2010, won: 70, lost: 12, tied: 0, otl: 0 },
			{ tid: 1, season: 2025, won: 38, lost: 2, tied: 0, otl: 0 },
		],
		state: undefined,
		ctx,
		scope: {},
	});
	const list = (id: string) =>
		sections.flatMap((s) => s.lists).find((l) => l.id === id)!;

	test("career: totals, active marker and a record broken this season", () => {
		const career = list("career:pts");
		assert.strictEqual(career.rows[0]!.pid, 2);
		assert.strictEqual(career.rows[0]!.v, 6800);
		assert.isTrue(career.rows[0]!.active);
		assert.isFalse(career.rows[1]!.active);
		assert.strictEqual(career.broken?.prev?.pid, 1);
		assert.strictEqual(career.broken?.prev?.v, 4900);
	});

	test("season: traded players are summed, records broken this season and the progression", () => {
		const season = list("season:pts");
		assert.strictEqual(season.rows[0]!.v, 2700);
		assert.isTrue(season.rows[0]!.thisSeason);
		assert.strictEqual(season.broken?.prev?.v, 2500);
		assert.strictEqual(season.rows.find((r) => r.pid === 3)!.v, 900);
		assert.deepEqual(
			season.history!.map((h) => h.v),
			[2500, 2700],
		);
		// Per game qualifiers: 70% of the team's games so far
		const ppg = list("season:ptspg");
		assert.strictEqual(ppg.rows[0]!.pid, 2);
		assert.closeTo(ppg.rows[0]!.v, 67.5, 1e-9);
		// 40 games for two teams: qualified, and summed
		assert.strictEqual(ppg.rows.find((r) => r.pid === 3)!.v, 22.5);
	});

	test("playoffs and teams", () => {
		assert.strictEqual(list("pocareer:pts").rows[0]!.v, 300);
		const best = list("team:best");
		// 2025 has played 40 of 82, which is enough this far into the season
		assert.strictEqual(best.rows[0]!.season, 2025);
		assert.isTrue(best.pct);
		assert.strictEqual(list("team:won").rows[0]!.v, 70);
		assert.strictEqual(list("team:worst").rows[0]!.season, 2010);
	});

	test("franchise scope counts only rows with that team", () => {
		const fr = buildBook({
			players,
			teamSeasons: [],
			state: undefined,
			ctx,
			scope: { tid: 1 },
		});
		const c = fr[0]!.lists.find((l) => l.id === "career:pts")!;
		assert.deepEqual(
			c.rows.map((r) => [r.pid, r.v]),
			[
				[2, 6800],
				[3, 400],
			],
		);
		// Traded away: not active for this franchise
		assert.isFalse(c.rows[1]!.active);
	});
});

describe("milestones", () => {
	test("crossed marks and team games to reach", () => {
		assert.deepEqual(crossed("pts", 9990, 10005), [10000]);
		assert.deepEqual(crossed("pts", 900, 2600), [1000, 2500]);
		assert.deepEqual(crossed("gp", 250, 260), []);
		assert.strictEqual(teamGamesToReach(50, { rate: 25, share: 1 }), 2);
		assert.strictEqual(teamGamesToReach(50, { rate: 25, share: 0.5 }), 4);
		assert.strictEqual(
			teamGamesToReach(50, { rate: 0, share: 1 }),
			Number.POSITIVE_INFINITY,
		);
	});

	test("chases: next mark and the next player above on the all-time list", () => {
		const players: RBPlayer[] = [
			{ pid: 1, name: "Leader", tid: -3, rows: [row(2010, 0, 82, 10050)] },
			{
				pid: 2,
				name: "Chaser",
				tid: 0,
				rows: [row(2024, 0, 82, 7000), row(2025, 0, 40, 2960)],
			},
		];
		const chases = findChases({
			players,
			season: 2025,
			teamGamesNow: () => 40,
			horizon: 42,
		});
		const pts = chases.filter((c) => c.pid === 2 && c.k === "pts");
		const mark = pts.find((c) => c.target.kind === "milestone")!;
		assert.strictEqual(mark.need, 40);
		assert.strictEqual(mark.teamGames, 1);
		const rank = pts.find((c) => c.target.kind === "rank")!;
		assert.strictEqual(rank.need, 91);
		assert.strictEqual(rank.teamGames, 2);
		if (rank.target.kind === "rank") {
			assert.strictEqual(rank.target.rank, 1);
			assert.strictEqual(rank.target.pid, 1);
		}
		// Retired players are not chasing anything
		assert.isUndefined(chases.find((c) => c.pid === 1));
	});

	test("reached this season", () => {
		const out = reachedThisSeason(
			[
				{
					pid: 2,
					name: "X",
					tid: 0,
					rows: [row(2024, 0, 82, 900), row(2025, 0, 10, 200)],
				},
			],
			2025,
		);
		assert.deepEqual(
			out.map((x) => [x.k, x.t]),
			[["pts", 1000]],
		);
	});
});
