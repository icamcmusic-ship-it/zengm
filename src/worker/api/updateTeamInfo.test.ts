import { afterAll, assert, test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import { team } from "../core/index.ts";
import api from "./index.ts";

afterAll(() => {
	resetG();
	// @ts-expect-error
	idb.league = undefined;
});

test("a team can't be disabled during the regular season (worker side, like the UI)", async () => {
	resetG();
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().slice(0, 4);
	await resetCache({ teams: teams.map((t) => team.generate(t)) });

	const newTeams = (await idb.cache.teams.getAll()).map((t) => ({
		...t,
		disabled: t.tid === 0,
	}));

	let error: Error | undefined;
	try {
		await api.main.updateTeamInfo({ teams: newTeams, from: "manageTeams" });
	} catch (err) {
		error = err as Error;
	}
	assert.include(error?.message, "can only be enabled or disabled");
	assert.isNotOk((await idb.cache.teams.get(0))!.disabled);
});
