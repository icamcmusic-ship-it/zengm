// Old box scores kept for another reason than the seasons kept in full (playoffs, a note) lose their play-by-play and shot
// log once they are older than those seasons; the ones in those seasons keep everything
import "fake-indexeddb/auto";
import { assert, test } from "vitest";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import connectLeague from "../../db/connectLeague.ts";
import { g } from "../../util/index.ts";
import { deleteOldBoxScores } from "./newPhaseRegularSeason.ts";

const box = (gid: number, season: number, extra: object = {}) =>
	({
		gid,
		season,
		day: 1,
		overtimes: 0,
		teams: [
			{ tid: 5, pts: 100, players: [] },
			{ tid: 6, pts: 90, players: [] },
		],
		won: { tid: 5, pts: 100 },
		lost: { tid: 6, pts: 90 },
		pbp: "x".repeat(1000),
		shotLog: [[1, 2, 1, 0, 0, 0, 0, 0]],
		...extra,
	}) as any;

test("kept old box scores lose their play-by-play and shot log after the seasons kept in full", async () => {
	resetG();
	idb.league = await connectLeague(901);
	await resetCache({}, { stubFlush: false });
	g.setWithoutSavingToDB("season", 2030);
	g.setWithoutSavingToDB("userTid", 0);
	g.setWithoutSavingToDB("saveOldBoxScores", {
		pastSeasons: 2,
		pastSeasonsType: "all",
		note: "all",
		playoffs: "all",
	});
	const games = [
		// old: deleted, kept (playoffs) and stripped, kept (note) and stripped
		box(1, 2025),
		box(2, 2025, { playoffs: true }),
		box(3, 2026, { note: "hi", noteBool: 1 }),
		// in the seasons kept in full: untouched
		box(4, 2028),
		box(5, 2029, { playoffs: true }),
	];
	const tx = idb.league.transaction("games", "readwrite");
	for (const gm of games) {
		void tx.store.put(gm);
	}
	await tx.done;

	await deleteOldBoxScores();
	await idb.cache.flush();
	// Twice: safe to repeat
	await deleteOldBoxScores();
	await idb.cache.flush();

	const stored = new Map(
		(await idb.league.transaction("games").store.getAll()).map((gm) => [
			gm.gid,
			gm,
		]),
	);
	assert.deepEqual([...stored.keys()].sort(), [2, 3, 4, 5]);
	for (const gid of [2, 3]) {
		assert.isUndefined(stored.get(gid)!.pbp);
		assert.isUndefined(stored.get(gid)!.shotLog);
		assert.strictEqual(stored.get(gid)!.teams[0].pts, 100);
	}
	assert.strictEqual(stored.get(3)!.note, "hi");
	for (const gid of [4, 5]) {
		assert.isString(stored.get(gid)!.pbp);
		assert.isDefined(stored.get(gid)!.shotLog);
	}
	idb.league.close();
});
