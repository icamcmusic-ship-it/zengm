// Spectator mode: the AI runs the user's team, so the game plan settings the sim ignores then (shot plan, shot profile, defensive
// scheme, the offense dials) are refused, like the read-only UI (Roster hides the Shots column, Offense is disabled)
import { assert, test } from "vitest";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import { resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../db/index.ts";
import { player, team } from "../core/index.ts";
import { g, helpers } from "../util/index.ts";
import api from "./index.ts";

const setup = async () => {
	resetG();
	const p = player.generate(0, 25, 2013, true, DEFAULT_LEVEL);
	await resetCache({
		players: [p],
		teams: helpers.getTeamsDefault().slice(0, 2).map(team.generate),
	});
	return (await idb.cache.players.indexGetAll("playersByTid", 0))[0]!.pid;
};

test("refused in spectator mode, allowed otherwise", async () => {
	const pid = await setup();

	g.setWithoutSavingToDB("spectator", true);
	for (const call of [
		() => api.main.updateShotPlan({ pid, shotPlan: 1 }),
		() => api.main.updateShotProfile({ pid, shotProfile: "mid" }),
		() => api.main.updateDefScheme({ defScheme: "zone" }),
		() => api.main.offEmphasisAction({ mode: "manual" } as any),
	]) {
		let error: Error | undefined;
		try {
			await call();
		} catch (error2) {
			error = error2 as Error;
		}
		assert.match(error?.message ?? "", /spectator/);
	}
	assert.isUndefined((await idb.cache.players.get(pid))!.shotPlan);
	assert.isUndefined((await idb.cache.teams.get(0))!.defScheme);

	g.setWithoutSavingToDB("spectator", false);
	await api.main.updateShotPlan({ pid, shotPlan: 1 });
	await api.main.updateDefScheme({ defScheme: "zone" });
	assert.strictEqual((await idb.cache.players.get(pid))!.shotPlan, 1);
	assert.strictEqual((await idb.cache.teams.get(0))!.defScheme, "zone");
});
