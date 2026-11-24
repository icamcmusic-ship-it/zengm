// Face aging in a mock league: players created outside genPlayers are aged when created, and scouts' faces are generated once
import { beforeAll, describe, expect, test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "./index.ts";
import { player, team } from "../core/index.ts";
import { seededFace } from "../core/scoutingReports/index.ts";
import { featureOn } from "./nativeFeatures.ts";

describe("face aging in a league", () => {
	beforeAll(async () => {
		resetG();
		g.setWithoutSavingToDB("featureFaceAging" as any, true);
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		idb.league = mockIDBLeague();
		const teams = helpers.getTeamsDefault().map(team.generate);
		await resetCache({ teams });
	}, 60000);

	test("a free agent made mid-season is aged at creation", async () => {
		expect(featureOn("faceAging")).toBe(true);
		const p = await player.genRandomFreeAgent();
		expect((p as any).faceAging?.s).toBe(g.get("season"));
		const stored = await idb.cache.players.get(p.pid);
		expect((stored as any).faceAging?.s).toBe(g.get("season"));
	});

	test("scout faces are generated once per scout, without moving Math.random", () => {
		const before = Math.random;
		const a = seededFace("scout|x|1", 50);
		const b = seededFace("scout|x|1", 50);
		expect(b).toBe(a);
		expect(Math.random).toBe(before);
		expect(seededFace("scout|x|2", 50)).not.toBe(a);
	});
});
