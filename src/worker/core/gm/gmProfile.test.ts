import { assert, beforeEach, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { team } from "../index.ts";
import {
	ensureGms,
	getGmSuccessor,
	setGmSuccessor,
	successorCandidates,
	syncGms,
} from "./index.ts";
import { getGmProfile, getUserVsGms } from "./profile.ts";

const setup = async () => {
	resetG();
	g.setWithoutSavingToDB("featureGmPersonalities", true);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
	await ensureGms();
};

describe("GM profile and successor", () => {
	beforeEach(setup);

	test("profile: tenures, career and links for any GM", async () => {
		const t = (await idb.cache.teams.get(3))!;
		const profile = (await getGmProfile(t.gm!.gmid))!;
		assert.strictEqual(profile.status, "employed");
		assert.strictEqual(profile.currentTid, 3);
		assert.strictEqual(profile.tenures.length, 1);
		assert.strictEqual(profile.tenures[0]!.tid, 3);
		assert.deepEqual(profile.notableTrades, []);
		assert.isUndefined(await getGmProfile(123456));
		// No games against anyone yet
		assert.deepEqual(await getUserVsGms(), []);
	});

	test("fired: the user picks a GM from the market, who takes over his old team when he leaves", async () => {
		const userTid = g.get("userTid");
		const marketTid = 5;
		const marketGm = (await idb.cache.teams.get(marketTid))!.gm!;

		// Team 5's GM goes to the market (the user takes team 5 over in multi team mode, then gives it up again)
		g.setWithoutSavingToDB("userTids", [userTid, marketTid]);
		await syncGms();
		g.setWithoutSavingToDB("userTids", [userTid]);
		await syncGms();
		const candidates = await successorCandidates(userTid);
		assert.isTrue(candidates.some((gm) => gm.gmid === marketGm.gmid));

		// Only once fired
		await assertRejects(() => setGmSuccessor(marketGm.gmid));
		g.setWithoutSavingToDB("gameOver", true);
		await setGmSuccessor(marketGm.gmid);
		assert.deepEqual(getGmSuccessor(), { tid: userTid, gmid: marketGm.gmid });

		// He takes a job with team 9: his old team hires the pick
		g.setWithoutSavingToDB("userTid", 9);
		g.setWithoutSavingToDB("userTids", [9]);
		await syncGms();
		const old = (await idb.cache.teams.get(userTid))!;
		assert.strictEqual(old.gm?.gmid, marketGm.gmid);
		assert.strictEqual(old.gm!.tenures.at(-1)!.tid, userTid);
		assert.isUndefined(getGmSuccessor());
		// Nobody has the same id twice
		const ids = (await idb.cache.teams.getAll()).flatMap((t) => [
			...(t.gm ? [t.gm.gmid] : []),
			...(t.formerGms ?? []).map((gm) => gm.gmid),
		]);
		assert.strictEqual(new Set(ids).size, ids.length);
		const texts = (await idb.cache.events.getAll()).map((e) => e.text ?? "");
		assert.isTrue(texts.some((x) => x.includes("successor picked")));

		const profile = (await getGmProfile(marketGm.gmid))!;
		assert.strictEqual(profile.tenures.length, 2);
	});
});

const assertRejects = async (f: () => Promise<unknown>) => {
	let threw = false;
	try {
		await f();
	} catch {
		threw = true;
	}
	assert.isTrue(threw);
};
