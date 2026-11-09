import { afterEach, assert, beforeEach, test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { emptyState } from "../../common/recordsBook.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../db/index.ts";
import { g } from "./index.ts";
import { getMilestones, recordsCheckNow } from "./recordsBookData.ts";

const statsRow = (season: number, tid: number, gp: number, pts: number) => ({
	season,
	tid,
	playoffs: false,
	gp,
	pts,
	orb: 0,
	drb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tp: 0,
});

const player = (pid: number, tid: number, stats: any[]) => ({
	pid,
	tid,
	firstName: "Player",
	lastName: String(pid),
	stats,
	ratings: [],
	awards: [],
	draft: { year: 2000 },
});

const box = (pid: number, pts: number) => ({
	pid,
	min: 30,
	pts,
	orb: 0,
	drb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tp: 0,
});

let league: unknown;

beforeEach(async () => {
	resetG();
	league = idb.league;
	idb.league = mockIDBLeague();
	g.setWithoutSavingToDB("lid", 1);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("startingSeason", 2010);
	delete (g as any).recordsBook;
	await resetCache({
		players: [
			// User's player: 9,990 career points before today's 15
			player(1, 0, [statsRow(2015, 0, 82, 9990), statsRow(2016, 0, 1, 15)]),
			// Retired all-time leader
			player(2, -3, [statsRow(2005, 3, 82, 30000)]),
			// Passes him today
			player(3, 1, [statsRow(2015, 1, 82, 29990), statsRow(2016, 1, 1, 30)]),
		],
	});
});

afterEach(() => {
	idb.league = league as any;
});

test("the first check starts from the stored games quietly, later checks announce records and milestones", async () => {
	await recordsCheckNow();
	const seeded = g.get("recordsBook" as any) as ReturnType<typeof emptyState>;
	assert.strictEqual(seeded.rec.career.pts!.p, 3);
	assert.strictEqual((await idb.cache.events.getAll()).length, 0);

	// As it was before today's game
	const state = emptyState();
	state.lastGid = 0;
	state.rec.career.pts = { p: 2, v: 30000 };
	g.setWithoutSavingToDB("recordsBook" as any, state);
	await idb.cache.games.put({
		gid: 1,
		season: 2016,
		day: 5,
		playoffs: false,
		overtimes: 0,
		teams: [
			{ tid: 0, pts: 100, players: [box(1, 15)] },
			{ tid: 1, pts: 90, players: [box(3, 30)] },
		],
	} as any);

	await recordsCheckNow();
	const texts = (await idb.cache.events.getAll()).map((e) => e.text);
	assert.isTrue(
		texts.some((t) => t!.includes("reached 10,000 career points")),
		texts.join("\n"),
	);
	assert.isTrue(
		texts.some((t) => t!.includes("most career points in league history")),
		texts.join("\n"),
	);
	const after = g.get("recordsBook" as any) as ReturnType<typeof emptyState>;
	assert.strictEqual(after.lastGid, 1);
	assert.deepEqual(
		after.ms.find((m) => m.p === 1),
		{
			p: 1,
			k: "pts",
			t: 10000,
			s: 2016,
			tm: 0,
			day: 5,
			g: 1,
		},
	);
	assert.deepEqual(after.rec.career.pts, { p: 3, v: 30020 });

	// Nothing new: no news again
	await recordsCheckNow();
	assert.strictEqual((await idb.cache.events.getAll()).length, texts.length);
});

test("after the trade deadline, a milestone still projects to a game this season", async () => {
	g.setWithoutSavingToDB("numGames", 82);
	await resetCache({
		players: [
			player(1, 0, [statsRow(2015, 0, 82, 8590), statsRow(2016, 0, 70, 1400)]),
		],
		teamSeasons: [
			{ tid: 0, season: 2016, won: 35, lost: 35 },
			{ tid: 1, season: 2016, won: 35, lost: 35 },
		] as any,
	});
	await idb.cache.schedule.addAll([
		{ gid: 10, day: 100, homeTid: 0, awayTid: 1 },
		{ gid: 11, day: 101, homeTid: 1, awayTid: 0 },
	] as any);
	for (const phase of [PHASE.REGULAR_SEASON, PHASE.AFTER_TRADE_DEADLINE]) {
		g.setWithoutSavingToDB("phase", phase);
		const { rows } = (await getMilestones({ horizon: "season" })) as any;
		const row = rows.find((r: any) => r.pid === 1 && r.target.mark === 10000);
		assert.isDefined(row, `phase ${phase}`);
		assert.strictEqual(row.when.type, "game", `phase ${phase}`);
	}
});
