// GM career achievements (basketball): Survivor, Executive of the Year, Everywhere You Go, Blueprint
import { afterAll, assert, beforeEach, describe, test } from "vitest";
import { idb } from "../db/index.ts";
import g from "./g.ts";
import { team } from "../core/index.ts";
import { cbAfterAll, cbBeforeAll, get } from "./achievementTestHelpers.ts";
import type { Gm, TeamSeason } from "../../common/types.ts";

afterAll(cbAfterAll);

const NUM_ROUNDS = 4;

// Seasons before the current one (2013) for every team, with the user running userTid in each (userControl recorded)
const addSeasons = async (
	seasons: {
		season: number;
		userTid: number;
		titleTid?: number;
		ovrStart?: (tid: number) => number;
	}[],
) => {
	for (const t of await idb.cache.teams.getAll()) {
		for (const { season, userTid, titleTid, ovrStart } of seasons) {
			const ts: TeamSeason = {
				...team.genSeasonRow(t, undefined, season),
				rid: undefined as any,
			};
			delete (ts as any).rid;
			ts.playoffRoundsWon = t.tid === titleTid ? NUM_ROUNDS : -1;
			if (t.tid === userTid) {
				ts.userControl = "user";
			}
			if (ovrStart) {
				ts.ovrStart = ovrStart(t.tid);
			}
			await idb.cache.teamSeasons.add(ts);
		}
	}
};

const setCurrent = async (
	f: (ts: TeamSeason) => void,
	tid = g.get("userTid"),
) => {
	const ts = (await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
		g.get("season"),
		tid,
	]))!;
	f(ts);
	await idb.cache.teamSeasons.put(ts);
};

describe("GM career achievements", () => {
	beforeEach(async () => {
		await cbBeforeAll();
		g.setWithoutSavingToDB("startingSeason", 2011);
		g.setWithoutSavingToDB("featureGmPersonalities", true);
		g.setWithoutSavingToDB("featureCoachExecAwards", true);
		for (const t of await idb.cache.teams.getAll()) {
			await setCurrent((ts) => {
				ts.playoffRoundsWon = -1;
				if (t.tid === g.get("userTid")) {
					ts.userControl = "user";
				}
			}, t.tid);
		}
	});

	test("gm_eoty: the user won Executive of the Year this season", async () => {
		assert.isFalse(await get("gm_eoty").check());
		await setCurrent((ts) => {
			ts.execOfTheYear = { name: "You", user: true };
		});
		assert.isTrue(await get("gm_eoty").check());

		g.setWithoutSavingToDB("featureCoachExecAwards", false);
		assert.isFalse(await get("gm_eoty").check());
	});

	test("gm_outlast: 10 AI GMs fired during the user's career", async () => {
		const fire = async (count: number, end: number) => {
			const teams = await idb.cache.teams.getAll();
			for (let i = 0; i < count; i++) {
				const t = teams[i % teams.length]!;
				t.formerGms = [
					...(t.formerGms ?? []),
					{
						gmid: 1000 + (t.formerGms?.length ?? 0) * 100 + t.tid,
						tenures: [{ tid: t.tid, start: end - 3, end, reason: "fired" }],
					} as unknown as Gm,
				];
				await idb.cache.teams.put(t);
			}
		};
		// Before the user's career: don't count
		await fire(10, 2010);
		assert.isFalse(await get("gm_outlast").check());
		await fire(9, 2012);
		assert.isFalse(await get("gm_outlast").check());
		await fire(1, 2013);
		assert.isTrue(await get("gm_outlast").check());

		g.setWithoutSavingToDB("featureGmPersonalities", false);
		assert.isFalse(await get("gm_outlast").check());
	});

	test("gm_every_team: a title with every team the user ran, 2+ teams", async () => {
		// Ran team 3 in 2011 (title) and 2012, then team 7 (title now)
		await addSeasons([
			{ season: 2011, userTid: 3, titleTid: 3 },
			{ season: 2012, userTid: 3 },
		]);
		assert.isFalse(await get("gm_every_team").check(), "no title this season");
		await setCurrent((ts) => {
			ts.playoffRoundsWon = NUM_ROUNDS;
		});
		assert.isTrue(await get("gm_every_team").check());

		// A third team without a title
		const ts2012 = (await idb.cache.teamSeasons.indexGet(
			"teamSeasonsBySeasonTid",
			[2012, 5],
		))!;
		ts2012.userControl = "user";
		await idb.cache.teamSeasons.put(ts2012);
		assert.isFalse(await get("gm_every_team").check());
	});

	test("gm_every_team: not with a single team, and spectator seasons don't count", async () => {
		await addSeasons([
			{ season: 2011, userTid: 7 },
			{ season: 2012, userTid: 7 },
		]);
		await setCurrent((ts) => {
			ts.playoffRoundsWon = NUM_ROUNDS;
		});
		assert.isFalse(await get("gm_every_team").check(), "one team");

		// Team 3 run by the AI in spectator mode
		const ts = (await idb.cache.teamSeasons.indexGet(
			"teamSeasonsBySeasonTid",
			[2011, 3],
		))!;
		ts.userControl = "auto";
		await idb.cache.teamSeasons.put(ts);
		assert.isFalse(await get("gm_every_team").check());
	});

	test("gm_rebuild: projected bottom 3, title within 4 seasons with the same team", async () => {
		const userTid = g.get("userTid");
		// The user's team has the 2nd worst roster in 2011
		const ovrStart = (tid: number) => (tid === userTid ? 31 : 40 + tid);
		await addSeasons([
			{
				season: 2011,
				userTid,
				ovrStart: (tid) => (tid === 0 ? 30 : ovrStart(tid)),
			},
			{ season: 2012, userTid, ovrStart: () => 50 },
		]);
		assert.isFalse(await get("gm_rebuild").check(), "no title");
		await setCurrent((ts) => {
			ts.playoffRoundsWon = NUM_ROUNDS;
		});
		assert.isTrue(await get("gm_rebuild").check());

		// Middle of the pack in 2011: no
		for (const ts of await idb.cache.teamSeasons.indexGetAll(
			"teamSeasonsBySeasonTid",
			[[2011], [2011, "Z"]],
		)) {
			if (ts.tid === userTid) {
				ts.ovrStart = 60;
				await idb.cache.teamSeasons.put(ts);
			}
		}
		assert.isFalse(await get("gm_rebuild").check());
	});

	test("gm_rebuild: the bad season was with another team", async () => {
		const userTid = g.get("userTid");
		await addSeasons([
			{
				season: 2011,
				userTid: 3,
				ovrStart: (tid) => (tid === 3 || tid === userTid ? 20 : 50),
			},
			{ season: 2012, userTid },
		]);
		await setCurrent((ts) => {
			ts.playoffRoundsWon = NUM_ROUNDS;
		});
		assert.isFalse(await get("gm_rebuild").check());
	});
});
