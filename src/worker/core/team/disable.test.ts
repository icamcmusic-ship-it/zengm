import { assert, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { team } from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";

test("a folded team's draft pick conditions lapse, and picks it held go back to their teams", async () => {
	resetG();
	idb.league = mockIDBLeague();
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	const teams = helpers.getTeamsDefault().slice(0, 4).map(team.generate);
	g.setWithoutSavingToDB("numTeams", 4);
	g.setWithoutSavingToDB("numActiveTeams", 4);
	g.setWithoutSavingToDB("numDraftRounds", 1);
	const season = g.get("season");
	g.setWithoutSavingToDB("numSeasonsFutureDraftPicks", 1);
	const pick = (dpid: number, originalTid: number, tid: number) => ({
		dpid,
		tid,
		originalTid,
		round: 1,
		season,
		pick: 0,
	});
	await resetCache({ teams });
	await idb.cache.draftPicks.addAll([
		// Team 2 traded team 1's pick to team 3, protected (team 2 keeps it if it lands in the top 2)
		{
			...pick(1, 1, 3),
			protection: { tid: 2, top: 2, rollover: [], then: "extinguish" },
		},
		// Team 2 holds the right to swap with team 0's pick, held by team 3
		{ ...pick(0, 0, 3), swap: { tid: 2 } },
		pick(2, 2, 2),
		// Team 2 holds team 3's pick
		pick(3, 3, 2),
	]);

	await team.disable(2);

	const dps = await idb.cache.draftPicks.getAll();
	const byOriginal = new Map(dps.map((dp) => [dp.originalTid, dp]));
	assert.isUndefined(byOriginal.get(2), "the folded team's own pick is gone");
	assert.strictEqual(byOriginal.get(3)!.tid, 3);
	assert.strictEqual(byOriginal.get(1)!.tid, 3);
	assert.isUndefined(byOriginal.get(1)!.protection);
	assert.strictEqual(byOriginal.get(0)!.tid, 3);
	assert.isUndefined(byOriginal.get(0)!.swap);
	assert.strictEqual(dps.length, 3);
});
