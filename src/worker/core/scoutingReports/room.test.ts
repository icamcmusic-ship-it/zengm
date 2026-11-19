// Scout Consensus & Flags in a mock league: every prospect gets a room and flags, the same on every load, read only through the user's
// view (no stored data, no game random numbers), and nothing while the setting is off
import { afterEach, assert, beforeAll, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import { clearScoutingCache } from "./input.ts";
import { getProspectRooms } from "./room.ts";

const realRandom = Math.random;
afterEach(() => {
	Math.random = realRandom;
});

const setup = async () => {
	resetG();
	g.setWithoutSavingToDB("featureScoutingReports" as any, true);
	g.setWithoutSavingToDB("featureScoutRoom" as any, true);
	g.setWithoutSavingToDB("featureScoutingDepth" as any, true);
	g.setWithoutSavingToDB("playerTraits", true);
	g.setWithoutSavingToDB("playerTraitsSeed", 777);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
	const season = g.get("season");
	for (let i = 0; i < 70; i++) {
		const p = player.generate(
			PLAYER.UNDRAFTED,
			19 + (i % 4),
			season + (i < 60 ? 0 : 1),
			false,
			50,
		);
		// ovr and pot
		await player.develop(p, 0);
		await player.updateValues(p);
		await idb.cache.players.add(p);
	}
	clearScoutingCache();
};

describe("scout consensus and flags in a league", () => {
	beforeAll(setup, 60000);

	test("every prospect gets a room and at most four flags, stable across loads, without touching players or Math.random", async () => {
		const prospects = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		const before = JSON.stringify(prospects);
		Math.random = () => {
			throw new Error("Math.random");
		};
		const a = await getProspectRooms(prospects);
		clearScoutingCache();
		const b = await getProspectRooms(prospects);
		Math.random = realRandom;
		assert.strictEqual(JSON.stringify(prospects), before);
		assert.strictEqual(a.size, prospects.length);
		assert.deepEqual([...a.entries()], [...b.entries()]);
		const labels = new Set<string>();
		for (const p of prospects) {
			const x = a.get(p.pid)!;
			assert.isDefined(x.room);
			assert.isAtLeast(x.room!.n, 1);
			assert.isAtMost(x.flags.length, 4);
			labels.add(x.room!.label);
			for (const f of x.flags) {
				if (f.hint) {
					assert.notMatch(f.why, /\d/);
					assert.match(f.text, /\(unconfirmed\)$/);
				}
			}
		}
		// The top of this year's class is seen by the whole room
		const top = prospects
			.filter((p) => p.draft.year === g.get("season"))
			.sort((x, y) => y.valueFuzz - x.valueFuzz)[0]!;
		assert.isAtLeast(a.get(top.pid)!.room!.n, 2);
		assert.isAtLeast(labels.size, 1);
	});

	test("off: nothing", async () => {
		g.setWithoutSavingToDB("featureScoutRoom" as any, false);
		const prospects = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		assert.strictEqual((await getProspectRooms(prospects)).size, 0);
		g.setWithoutSavingToDB("featureScoutRoom" as any, true);
	});
});
