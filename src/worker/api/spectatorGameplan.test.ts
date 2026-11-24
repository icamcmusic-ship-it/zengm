// Spectator mode: the AI runs the user's team, so the game plan settings the sim ignores then (shot plan, shot profile, defensive
// scheme, the offense dials) are refused, like the read-only UI (Roster hides the Shots column, Offense is disabled)
import { assert, test } from "vitest";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import { resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../db/index.ts";
import { player, team } from "../core/index.ts";
import { g, helpers } from "../util/index.ts";
import api from "./index.ts";
import { PRESETS } from "../../common/offEmphasis.ts";
import {
	coachEmphasis,
	ensureTeamEmphasis,
} from "../core/offEmphasis/index.ts";
import { local } from "../util/index.ts";

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

test("the AI's dials while it runs the user's team, his manual ones kept", async () => {
	await setup();
	g.setWithoutSavingToDB("spectator", false);
	const t = (await idb.cache.teams.get(0))!;
	t.offEmphasis = {
		mode: "manual",
		e: PRESETS.postCentric,
		set: { season: g.get("season"), day: 0 },
	};
	await idb.cache.teams.put(t);
	assert.deepEqual((await ensureTeamEmphasis(t, 1)).e, PRESETS.postCentric);

	const auto = await coachEmphasis(0, 1);
	for (const mode of ["spectator", "autoPlay"]) {
		g.setWithoutSavingToDB("spectator", mode === "spectator");
		local.autoPlayUntil =
			mode === "autoPlay" ? ({ season: 9999, phase: 0 } as any) : undefined;
		const state = await ensureTeamEmphasis(t, 1);
		assert.deepEqual(state.e, auto);
		const stored = (await idb.cache.teams.get(0))!.offEmphasis!;
		assert.strictEqual(stored.mode, "manual");
		assert.deepEqual(stored.e, PRESETS.postCentric);
	}
	local.autoPlayUntil = undefined;
	g.setWithoutSavingToDB("spectator", false);
});
