// loadTeams: the user's own settings (playing time, shot plans and profiles, defensive scheme, his roster-order rotation) apply only
// while he runs the team (userRunsTeam). In auto play the AI runs it exactly as in spectator mode
import { afterEach, assert, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { range } from "../../../common/utils.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { player, team } from "../index.ts";
import { g, helpers, local } from "../../util/index.ts";
import loadTeams from "./loadTeams.ts";

const realRandom = Math.random;
afterEach(() => {
	Math.random = realRandom;
	local.autoPlayUntil = undefined;
});

const load = async (mode: "user" | "spectator" | "autoPlay") => {
	Math.random = makeSeededRandom(11);
	resetG();
	g.setWithoutSavingToDB("season", 2013);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("realisticRotations", true);
	g.setWithoutSavingToDB("shotShareModel", true);
	g.setWithoutSavingToDB("featureShotProfiles", true);
	g.setWithoutSavingToDB("spectator", mode === "spectator");
	local.autoPlayUntil =
		mode === "autoPlay"
			? ({
					season: 2014,
					phase: PHASE.PRESEASON,
					start: 0,
					resolve: () => {},
					reject: () => {},
				} as any)
			: undefined;
	const teamsDefault = helpers.getTeamsDefault().slice(0, 2);
	const players = [
		...range(13).map(() => player.generate(0, 25, 2010, true, DEFAULT_LEVEL)),
		...range(13).map(() => player.generate(1, 25, 2010, true, DEFAULT_LEVEL)),
	];
	// The user's settings on his team
	for (const p of players.slice(0, 13)) {
		p.ptModifier = 0.75;
		p.shotPlan = 1;
		p.shotProfile = "mid";
	}
	await resetCache({
		players,
		teams: teamsDefault.map((t) => ({
			...team.generate(t),
			...(t.tid === 0 ? { defScheme: "runOff" as const } : {}),
		})),
		teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
		teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
	});
	const teams = await loadTeams([0, 1], {});
	const t = teams[0]!;
	return {
		ptModifiers: t.player.map((p: any) => p.ptModifier),
		shotPlans: t.player.map((p: any) => p.shotPlan),
		shotProfiles: t.player.map((p: any) => p.shotProfile),
		defScheme: t.defScheme,
		userRotation: t.userRotation,
	};
};

test("the user's settings apply while he runs his team", async () => {
	const out = await load("user");
	assert.isTrue(out.ptModifiers.every((x: number) => x === 0.75));
	assert.isTrue(out.shotPlans.every((x: number) => x === 1));
	assert.isTrue(out.shotProfiles.every((x: string) => x === "mid"));
	assert.strictEqual(out.defScheme, "runOff");
	assert.isTrue(out.userRotation);
});

test("auto play ignores them, exactly like spectator mode", async () => {
	const spectator = await load("spectator");
	const autoPlay = await load("autoPlay");
	assert.isTrue(autoPlay.ptModifiers.every((x: number) => x === 1));
	assert.isUndefined(autoPlay.userRotation);
	assert.deepEqual(autoPlay, spectator);
	assert.notDeepEqual(autoPlay, await load("user"));
});
