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

	const addTrade = async (season: number, phase: number, otherTid: number) => {
		await idb.cache.events.add({
			type: "trade",
			season,
			phase: phase as any,
			tids: [g.get("userTid"), otherTid],
			pids: [],
			dpids: [],
			score: 5,
			teams: [{ assets: [] }, { assets: [] }],
		} as any);
	};

	test("trades with the user: this offseason's are his, an AI-run preseason's aren't", async () => {
		const season = g.get("season");
		const otherTid = 3;
		const gmid = (await idb.cache.teams.get(otherTid))!.gm!.gmid;

		// During this offseason (they count for next season): marked "(you)" on his profile
		g.setWithoutSavingToDB("phase", PHASE.DRAFT);
		await addTrade(season, PHASE.DRAFT, otherTid);
		const profile = (await getGmProfile(gmid))!;
		assert.strictEqual(profile.notableTrades.length, 1);
		assert.isTrue(profile.notableTrades[0]!.withUser);
		assert.strictEqual(
			(await getUserVsGms()).find((row) => row.gmid === gmid)!.trades.length,
			1,
		);

		// Next preseason in spectator mode: the AI made that trade for the user's team, it's not his
		g.setWithoutSavingToDB("season", season + 1);
		g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
		g.setWithoutSavingToDB("spectator", true);
		await addTrade(season + 1, PHASE.PRESEASON, otherTid);
		const spectating = (await getUserVsGms()).find((row) => row.gmid === gmid);
		assert.isFalse(
			(spectating?.trades ?? []).some((x) => x.season === season + 1),
		);
		g.setWithoutSavingToDB("spectator", false);
		const user = (await getUserVsGms()).find((row) => row.gmid === gmid)!;
		assert.deepEqual(
			user.trades.map((x) => x.season),
			[season + 1, season],
		);
	});

	test("No Visible Ratings: no expected wins sent", async () => {
		const t = (await idb.cache.teams.get(3))!;
		t.gm!.expWon = 50;
		await idb.cache.teams.put(t);
		const load = (await import("../../views/gm.ts")).default.load;
		const frontOffices = (await import("../../views/frontOffices.ts")).default
			.load;
		const view = async () =>
			(await load({
				inputs: { gmid: t.gm!.gmid },
				updateEvents: new Set(["firstRun"]),
				prevInputs: {},
				prevOutput: {},
				conditions: {},
			} as any)) as any;
		const fo = async () =>
			(await frontOffices({
				inputs: {},
				updateEvents: new Set(["firstRun"]),
				prevInputs: {},
				prevOutput: {},
				conditions: {},
			} as any)) as any;
		assert.isFalse((await view()).noRatings);
		assert.strictEqual(
			(await fo()).rows.find((row: any) => row.tid === 3).gm.expWon,
			50,
		);
		g.setWithoutSavingToDB("challengeNoRatings", true);
		assert.isTrue((await view()).noRatings);
		const rowGm = (await fo()).rows.find((row: any) => row.tid === 3).gm;
		assert.isUndefined(rowGm.expWon);
		assert.isUndefined(rowGm.aboveExp);
		assert.isTrue((await fo()).noRatings);
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
