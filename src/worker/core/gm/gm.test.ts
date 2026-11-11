import { assert, beforeEach, describe, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PHASE } from "../../../common/constants.ts";
import {
	genGmTraits,
	gmDraftUpsideAdjustment,
	gmFireProb,
	gmHotSeat,
	gmPlayerStyleScore,
	gmSeasonScore,
	gmWeightsFromTraits,
	NEUTRAL_GM_TRAITS,
} from "../../../common/gmPersonality.ts";
import type { GmTraits } from "../../../common/types.ts";
import { mulberry32 } from "../../../test/ratingInflation/harness.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local } from "../../util/index.ts";
import { player, team } from "../index.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import { getDraftAdjustment } from "../draft/draftNeeds.ts";
import {
	ensureGms,
	getAllGmWeights,
	getGmWeights,
	onRegularSeason,
	runOffseason,
} from "./index.ts";

const withRandom = async <T>(seed: number, f: () => Promise<T>) => {
	const orig = Math.random;
	Math.random = mulberry32(seed);
	try {
		return await f();
	} finally {
		Math.random = orig;
	}
};

const setup = async (on = true) => {
	resetG();
	g.setWithoutSavingToDB("featureGmPersonalities", on);
	g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
};

const setTraits = async (tid: number, traits: Partial<GmTraits>) => {
	const t = (await idb.cache.teams.get(tid))!;
	t.gm!.traits = { ...NEUTRAL_GM_TRAITS, ...traits };
	await idb.cache.teams.put(t);
};

// A finished regular season and playoffs for every team, from a won function
const finishSeason = async (
	won: (tid: number) => number,
	roundsWon: (tid: number) => number = () => -1,
) => {
	const season = g.get("season");
	for (const t of await idb.cache.teams.getAll()) {
		let ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			season,
			t.tid,
		]);
		if (!ts) {
			await idb.cache.teamSeasons.add(team.genSeasonRow(t, undefined, season));
			ts = (await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
				season,
				t.tid,
			]))!;
		}
		ts.won = won(t.tid);
		ts.lost = 82 - ts.won;
		ts.playoffRoundsWon = roundsWon(t.tid);
		await idb.cache.teamSeasons.put(ts);
	}
	g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
};

const nextSeason = async () => {
	g.setWithoutSavingToDB("season", g.get("season") + 1);
	g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
	await ensureGms();
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
};

describe("GM personality weights", () => {
	test("neutral traits give neutral weights", () => {
		const w = gmWeightsFromTraits(NEUTRAL_GM_TRAITS);
		for (const key of [
			"futureFactor",
			"vetFactor",
			"pickFactor",
			"injuryFactor",
			"contractsFactor",
			"loyaltyFactor",
			"tradeWeight",
			"dumpPayrollFactor",
			"faActivity",
			"draftNeedScale",
			"extensionFactor",
			"coachFireFactor",
		] as const) {
			assert.strictEqual(w[key], 1, key);
		}
		for (const key of [
			"styleStrength",
			"buyerWinpShift",
			"avoidTaxRankShift",
			"faStarShift",
			"draftUpside",
			"optionShift",
			"strategyShift",
			"coachDevWeight",
		] as const) {
			assert.strictEqual(Math.abs(w[key]), 0, key);
		}
	});

	test("traits are bounded, centered and modest", () => {
		const random = mulberry32(7);
		const gaussian = () => {
			// Box-Muller from the seeded uniform
			const u = 1 - random();
			const v = random();
			return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
		};
		const all = Array.from({ length: 3000 }, () => genGmTraits(gaussian));
		for (const key of Object.keys(NEUTRAL_GM_TRAITS) as (keyof GmTraits)[]) {
			const xs = all.map((t) => t[key]);
			const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
			assert.isBelow(Math.abs(mean), 0.05, key);
			assert.isAtMost(Math.max(...xs.map(Math.abs)), 1, key);
		}
		// Trade weights average 1, so league-wide trade volume stays the same
		const meanWeight =
			all
				.map((t) => gmWeightsFromTraits(t).tradeWeight)
				.reduce((a, b) => a + b, 0) / all.length;
		assert.closeTo(meanWeight, 1, 0.03);
		// Extreme leanings move a player's value by at most ~7% through any single factor
		const extreme = gmWeightsFromTraits({
			...NEUTRAL_GM_TRAITS,
			patience: 1,
			analytics: 1,
		});
		assert.isAtMost(extreme.futureFactor, 1.07 + 1e-9);
		assert.isAtMost(Math.abs(extreme.styleStrength), 0.06 + 1e-9);
	});

	test("analytics GMs like young productive players, old-school GMs like big experienced ones", () => {
		const young = gmPlayerStyleScore({
			age: 22,
			ovr: 50,
			pot: 62,
			hgt: 40,
			per: 20,
			min: 1500,
		});
		const vet = gmPlayerStyleScore({
			age: 31,
			ovr: 58,
			pot: 58,
			hgt: 85,
			per: 12,
			min: 1500,
		});
		assert.isAbove(young, 0.3);
		assert.isBelow(vet, -0.3);
	});

	test("draft weights: best available ignores need, upside likes raw young prospects", () => {
		const prospect = { value: 50, ratings: [{ pos: "C", ovr: 40, pot: 60 }] };
		const needs = { G: 0, F: 0, C: 0.3 };
		const neutral = getDraftAdjustment(prospect, needs, undefined);
		const bpa = getDraftAdjustment(
			prospect,
			needs,
			undefined,
			gmWeightsFromTraits({ ...NEUTRAL_GM_TRAITS, draftBPA: 1 }).draftNeedScale,
		);
		const need = getDraftAdjustment(
			prospect,
			needs,
			undefined,
			gmWeightsFromTraits({ ...NEUTRAL_GM_TRAITS, draftBPA: -1 })
				.draftNeedScale,
		);
		assert.isAbove(neutral, 0);
		assert.isBelow(bpa, neutral);
		assert.isAbove(need, neutral);

		const upside = gmWeightsFromTraits({
			...NEUTRAL_GM_TRAITS,
			draftUpside: 1,
		});
		assert.isAbove(
			gmDraftUpsideAdjustment(upside, { age: 19, ovr: 40, pot: 62 }),
			0,
		);
		assert.isBelow(
			gmDraftUpsideAdjustment(upside, { age: 23, ovr: 50, pot: 54 }),
			0,
		);
	});

	test("job security: failing against expectations for years gets a GM fired, a new GM gets time", () => {
		const bad = gmSeasonScore({
			won: 20,
			lost: 62,
			tied: 0,
			otl: 0,
			expWon: 41,
			numGames: 82,
			playoffRoundsWon: -1,
		});
		const good = gmSeasonScore({
			won: 55,
			lost: 27,
			tied: 0,
			otl: 0,
			expWon: 45,
			numGames: 82,
			playoffRoundsWon: 2,
		});
		assert.isBelow(bad, -20);
		assert.isAbove(good, 10);
		const hot = gmHotSeat([bad, bad, bad]);
		assert.isAbove(
			gmFireProb({
				hotSeat: hot,
				tenure: 3,
				rebuilding: false,
				droughtSeasons: 3,
			}),
			0.5,
		);
		assert.strictEqual(
			gmFireProb({
				hotSeat: gmHotSeat([bad]),
				tenure: 0,
				rebuilding: false,
				droughtSeasons: 1,
			}),
			0,
		);
		assert.strictEqual(
			gmFireProb({
				hotSeat: gmHotSeat([good, good, good]),
				tenure: 3,
				rebuilding: false,
				droughtSeasons: 0,
			}),
			0,
		);
	});
});

describe("AI GMs", () => {
	beforeEach(async () => {
		await setup();
	});

	test("does nothing when the setting is off", async () => {
		await setup(false);
		assert.isFalse(await ensureGms());
		for (const t of await idb.cache.teams.getAll()) {
			assert.isUndefined(t.gm);
		}
		assert.isUndefined(await getGmWeights(1));
		assert.strictEqual((await getAllGmWeights()).size, 0);
		await finishSeason(() => 41);
		await runOffseason();
		for (const t of await idb.cache.teams.getAll()) {
			assert.isUndefined(t.gm);
			assert.isUndefined(t.formerGms);
		}
	});

	test("every AI team gets a GM, the user's team doesn't", async () => {
		assert.isTrue(await ensureGms());
		const teams = await idb.cache.teams.getAll();
		const gmids = new Set<number>();
		for (const t of teams) {
			if (t.tid === g.get("userTid")) {
				assert.isUndefined(t.gm);
				assert.isUndefined(await getGmWeights(t.tid));
			} else {
				assert.isDefined(t.gm);
				gmids.add(t.gm!.gmid);
				assert.isTrue(t.gm!.tenures[0]!.initial);
				assert.isDefined(await getGmWeights(t.tid));
			}
		}
		assert.strictEqual(gmids.size, teams.length - 1);
		// No news for the league's first GMs
		assert.strictEqual((await idb.cache.events.getAll()).length, 0);

		// Spectator mode: the AI runs the user's team too
		g.setWithoutSavingToDB("spectator", true);
		await ensureGms();
		assert.isDefined((await idb.cache.teams.get(g.get("userTid")))!.gm);
		g.setWithoutSavingToDB("spectator", false);
		assert.isUndefined(await getGmWeights(g.get("userTid")));
	});

	test("generation is deterministic for a seed", async () => {
		const run = async () => {
			await setup();
			await withRandom(42, ensureGms);
			return (await idb.cache.teams.getAll()).map((t) =>
				t.gm
					? JSON.stringify([t.gm.firstName, t.gm.lastName, t.gm.traits])
					: "",
			);
		};
		const a = await run();
		const b = await run();
		assert.deepStrictEqual(a, b);
		assert.isAbove(new Set(a).size, 20);
	});

	test("expectations, firing after sustained failure and the carousel", async () => {
		await ensureGms();
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		await onRegularSeason();
		const tid = 5;
		const t0 = (await idb.cache.teams.get(tid))!;
		const firedGmid = t0.gm!.gmid;
		// No players, so every team is expected to win half its games
		assert.closeTo(t0.gm!.expWon!, 41, 0.5);

		// Team 5 is awful for 3 seasons, everyone else is average, and a few teams win titles
		for (let i = 0; i < 3; i++) {
			await finishSeason((tid2) => (tid2 === tid ? 12 : 41));
			await withRandom(i + 1, runOffseason);
			if (i < 2) {
				// Not fired yet: new GMs get time
				assert.strictEqual(
					(await idb.cache.teams.get(tid))!.gm!.gmid,
					firedGmid,
				);
				await nextSeason();
				await onRegularSeason();
			}
		}

		const t = (await idb.cache.teams.get(tid))!;
		assert.notStrictEqual(t.gm!.gmid, firedGmid, "fired and replaced");
		const fired = t.formerGms!.find((x) => x.gmid === firedGmid)!;
		assert.strictEqual(fired.tenures.at(-1)!.reason, "fired");
		assert.strictEqual(fired.seasons.length, 3);
		assert.isBelow(fired.hotSeat!, -14);
		assert.strictEqual(t.gm!.tenures.at(-1)!.start, g.get("season") + 1);

		const texts = (await idb.cache.events.getAll()).map((e) => e.text ?? "");
		assert.isTrue(texts.some((x) => x.includes("fired general manager")));
		assert.isTrue(texts.some((x) => x.includes(" hired ")));

		// Another job opens: the fired GM is on the market, but never goes back to the team that fired him
		const other = (await idb.cache.teams.get(7))!;
		other.gm!.born.year = g.get("season") - 80;
		await idb.cache.teams.put(other);
		await nextSeason();
		await finishSeason(() => 41);
		await withRandom(99, runOffseason);
		const other2 = (await idb.cache.teams.get(7))!;
		assert.strictEqual(
			other2.formerGms!.at(-1)!.tenures.at(-1)!.reason,
			"retired",
		);
		assert.isDefined(other2.gm);
		const t2 = (await idb.cache.teams.get(tid))!;
		assert.notStrictEqual(t2.gm!.gmid, firedGmid);
	});
});

describe("trade value", () => {
	const TID = 3;
	const PARTNER = 4;
	let youngPid: number;
	let vetPid: number;
	let dpid: number;

	beforeEach(async () => {
		resetG();
		g.setWithoutSavingToDB("featureGmPersonalities", true);
		const season = g.get("season");
		const players = [];
		for (let tid = 0; tid < 30; tid++) {
			for (let i = 0; i < 10; i++) {
				const p = player.generate(tid, 26, season - 6, true, DEFAULT_LEVEL);
				p.value = 45 + (i % 5);
				players.push(p);
			}
		}
		const young = player.generate(PARTNER, 21, season - 2, true, DEFAULT_LEVEL);
		young.value = 62;
		young.ratings.at(-1)!.ovr = 50;
		young.ratings.at(-1)!.pot = 64;
		const vet = player.generate(PARTNER, 31, season - 11, true, DEFAULT_LEVEL);
		vet.value = 62;
		vet.ratings.at(-1)!.ovr = 60;
		vet.ratings.at(-1)!.pot = 60;
		players.push(young, vet);
		await resetCache({
			players,
			teams: helpers.getTeamsDefault().map(team.generate),
		});
		idb.league = mockIDBLeague();
		local.playerOvrMeanStdStale = true;
		const all = await idb.cache.players.indexGetAll("playersByTid", PARTNER);
		youngPid = all.find((p) => p.born.year === season - 21)!.pid;
		vetPid = all.find((p) => p.born.year === season - 31)!.pid;
		dpid = await idb.cache.draftPicks.add({
			tid: PARTNER,
			originalTid: PARTNER,
			round: 1,
			pick: 0,
			season: season + 1,
		});
		await ensureGms();
	});

	const value = (args: { pidsAdd?: number[]; dpidsAdd?: number[] }) =>
		new ValueChangeCalculator().evaluate({
			tid: TID,
			pidsAdd: args.pidsAdd ?? [],
			pidsRemove: [],
			dpidsAdd: args.dpidsAdd ?? [],
			dpidsRemove: [],
			tradingPartnerTid: PARTNER,
		});

	test("pick valuation, timeline and evaluation style move values modestly", async () => {
		await setTraits(TID, {});
		const neutralPick = await value({ dpidsAdd: [dpid] });
		const neutralYoung = await value({ pidsAdd: [youngPid] });
		const neutralVet = await value({ pidsAdd: [vetPid] });

		await setTraits(TID, { pickValue: 1 });
		const hoarder = await value({ dpidsAdd: [dpid] });
		await setTraits(TID, { pickValue: -1 });
		const trader = await value({ dpidsAdd: [dpid] });
		assert.isAbove(hoarder, neutralPick);
		assert.isBelow(trader, neutralPick);

		await setTraits(TID, { patience: 1, analytics: 1 });
		const patientYoung = await value({ pidsAdd: [youngPid] });
		const patientVet = await value({ pidsAdd: [vetPid] });
		await setTraits(TID, { patience: -1, analytics: -1 });
		const winNowYoung = await value({ pidsAdd: [youngPid] });
		const winNowVet = await value({ pidsAdd: [vetPid] });
		assert.isAbove(patientYoung, neutralYoung);
		assert.isAbove(winNowVet, neutralVet);
		assert.isAbove(patientYoung - patientVet, winNowYoung - winNowVet);

		// Bounded: trade values are value ** 7 (basketball), so on the value scale even two extreme leanings combined move a player
		// by less than 15%, and one extreme leaning a pick by less than the 12% pick factor (less than the team strategy factors)
		for (const [x, base, max] of [
			[patientYoung, neutralYoung, 0.15],
			[winNowVet, neutralVet, 0.15],
			[hoarder, neutralPick, 0.121],
		] as const) {
			assert.isBelow(Math.abs((x / base) ** (1 / 7) - 1), max);
		}
	});

	test("the user's team uses no GM weights", async () => {
		assert.isUndefined(await getGmWeights(g.get("userTid")));
		const t = (await idb.cache.teams.get(g.get("userTid")))!;
		assert.isUndefined(t.gm);
	});
});
