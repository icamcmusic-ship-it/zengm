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
import { getGmBehaviors, getGmProfile, getUserVsGms } from "./profile.ts";

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

	test("track record: trades, picks, payroll, tax and roster age of the seasons he ran", async () => {
		const season = g.get("season");
		const tid = 3;
		const t = (await idb.cache.teams.get(tid))!;
		const gmid = t.gm!.gmid;
		// He ran team 3 last season and this one
		t.gm!.tenures[0]!.start = season - 1;
		await idb.cache.teams.put(t);
		const cap = g.get("salaryCap");
		const numGames = g.get("numGames");
		for (const [s, gp, payroll, tax, avgAge] of [
			[season - 2, numGames, 2 * cap, true, 30],
			[season - 1, numGames, 1.2 * cap, true, 28],
			[season, numGames / 2, 0.9 * cap, false, undefined],
		] as const) {
			const ts = team.genSeasonRow(t, undefined, s);
			ts.won = gp / 2;
			ts.lost = gp / 2;
			// Paid per game: payroll / numGames each
			ts.expenses.salary = (payroll * gp) / numGames;
			ts.expenses.luxuryTax = tax ? 1000 : 0;
			ts.avgAge = avgAge;
			await idb.cache.teamSeasons.add(ts);
		}
		const addPickTrade = async (s: number, phase: number) => {
			await idb.cache.events.add({
				type: "trade",
				season: s,
				phase: phase as any,
				tids: [tid, 7],
				pids: [],
				dpids: [],
				score: 0,
				// Team 3 gets a player, team 7 gets two picks and a swap
				teams: [
					{ assets: [{ pid: 1, name: "X" }] },
					{
						assets: [
							{ dpid: 1, season: s + 1, round: 1, originalTid: tid },
							{ dpid: 2, season: s + 2, round: 2, originalTid: tid },
							{
								dpid: 3,
								season: s + 2,
								round: 1,
								originalTid: tid,
								swap: true,
							},
						],
					},
				],
			} as any);
		};
		// Before his time (season - 2), in the offseason before his first season (counts for it) and this season
		await addPickTrade(season - 2, PHASE.REGULAR_SEASON);
		await addPickTrade(season - 2, PHASE.DRAFT);
		await addPickTrade(season, PHASE.REGULAR_SEASON);

		const b = (await getGmBehaviors([t.gm!])).get(gmid)!;
		assert.strictEqual(b.seasons, 2);
		assert.strictEqual(b.trades, 2);
		assert.strictEqual(b.tradesPerSeason, 1);
		assert.strictEqual(b.picksOut, 4);
		assert.strictEqual(b.picksIn, 0);
		// 1.2 caps last season, 0.9 so far this season
		assert.closeTo(b.payroll!, 1.05, 0.001);
		// The tax is assessed after the playoffs: only last season so far
		assert.strictEqual(b.taxSeasons, 1);
		assert.strictEqual(b.taxSeasonsOf, 1);
		assert.strictEqual(b.avgAge, 28);
		assert.deepEqual((await getGmProfile(gmid))!.behavior, b);
	});

	test("leanings: bands only, the exact numbers only in God Mode", async () => {
		const t = (await idb.cache.teams.get(3))!;
		t.gm!.traits = { ...t.gm!.traits, tradeFreq: 0.5, pickValue: -0.2 };
		await idb.cache.teams.put(t);
		const load = (await import("../../views/gm.ts")).default.load;
		const frontOffices = (await import("../../views/frontOffices.ts")).default
			.load;
		const args = (inputs: any) =>
			({
				inputs,
				updateEvents: new Set(["firstRun"]),
				prevInputs: {},
				prevOutput: {},
				conditions: {},
			}) as any;
		const check = async (godMode: boolean) => {
			g.setWithoutSavingToDB("godMode", godMode);
			const profile = (await load(args({ gmid: t.gm!.gmid }))) as any;
			const row = ((await frontOffices(args({}))) as any).rows.find(
				(x: any) => x.tid === 3,
			).gm;
			for (const out of [profile, row]) {
				assert.strictEqual(out.traitBands.tradeFreq, 2);
				assert.strictEqual(out.traitBands.pickValue, -1);
				if (godMode) {
					assert.strictEqual(out.traits.tradeFreq, 0.5);
				} else {
					assert.isUndefined(out.traits);
					// No leaning number anywhere in what is sent
					assert.notInclude(JSON.stringify(out), '"tradeFreq":0.5');
				}
				assert.isDefined(out.behavior);
			}
		};
		await check(false);
		await check(true);
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
