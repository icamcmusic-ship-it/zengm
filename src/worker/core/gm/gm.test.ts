import { assert, beforeEach, describe, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PHASE } from "../../../common/constants.ts";
import {
	genGmTraits,
	gmDraftUpsideAdjustment,
	gmFireProb,
	gmHotSeat,
	gmPathExpWon,
	gmPlayerStyleScore,
	gmProgressScore,
	gmRebuildWeight,
	gmSeasonScore,
	gmWeightsFromTraits,
	NEUTRAL_GM_TRAITS,
} from "../../../common/gmPersonality.ts";
import type { GmTraits } from "../../../common/types.ts";
import { mulberry32 } from "../../../test/ratingInflation/harness.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local } from "../../util/index.ts";
import { player, team, trade } from "../index.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import { getDraftAdjustment } from "../draft/draftNeeds.ts";
import {
	currentPlayoffTids,
	ensureGms,
	extraFirstRoundPicks,
	getAllGmWeights,
	getGmWeights,
	HOT_SEAT_NEWS_MAX,
	hotSeatMinGp,
	hotSeatNews,
	judgedSeasons,
	leaveTeam,
	onGmMarket,
	onRegularSeason,
	projectedSeasonFireProb,
	runOffseason,
	syncGms,
} from "./index.ts";
import frontOfficesView from "../../views/frontOffices.ts";
import { getGmProfile } from "./profile.ts";

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
			"faYouthShift",
			"draftUpside",
			"optionShift",
			"strategyShift",
			"coachDevWeight",
		] as const) {
			assert.strictEqual(Math.abs(w[key]), 0, key);
		}
		assert.strictEqual(w.overCapResignRank, Infinity);
		assert.strictEqual(w.faCapRoom, 0);
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
		// Trade weights average about 1 (they're relative chances, so league-wide trade volume stays the same), but spread widely: a
		// dealmaker is picked several times as often as a quiet GM
		const weights = all.map((t) => gmWeightsFromTraits(t).tradeWeight);
		const meanWeight = weights.reduce((a, b) => a + b, 0) / all.length;
		assert.closeTo(meanWeight, 1, 0.06);
		const sorted = weights.toSorted((a, b) => a - b);
		const q = Math.floor(sorted.length / 5);
		assert.isAbove(sorted[sorted.length - q]! / sorted[q]!, 3);
		// Extreme leanings move a player's value by at most ~10% through any single factor (picks 20%)
		const extreme = gmWeightsFromTraits({
			...NEUTRAL_GM_TRAITS,
			patience: 1,
			analytics: 1,
		});
		assert.isAtMost(extreme.futureFactor, 1.1 + 1e-9);
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

describe("fair job security", () => {
	const season = (won: number, expWon: number, extra = {}) =>
		gmSeasonScore({
			won,
			lost: 82 - won,
			tied: 0,
			otl: 0,
			expWon,
			numGames: 82,
			playoffRoundsWon: -1,
			...extra,
		});

	test("a bad team that does what its roster was expected to do isn't blamed for being bad", () => {
		const bad = season(22, 22);
		assert.isAbove(bad, -2);
		const hot = gmHotSeat([bad, bad, bad]);
		for (const tenure of [1, 2, 3, 4]) {
			assert.strictEqual(
				gmFireProb({
					hotSeat: hot,
					tenure,
					rebuilding: false,
					droughtSeasons: tenure,
				}),
				0,
			);
		}
		// A contender that misses the playoffs is blamed, even at its expected win total
		assert.isBelow(season(50, 50), -3);
	});

	test("honeymoon: no firing in the first two seasons unless it's extreme against expectations", () => {
		// 12 wins below a bad projection: bad, but not extreme
		const poor = gmHotSeat([season(10, 22)]);
		assert.strictEqual(
			gmFireProb({
				hotSeat: poor,
				tenure: 1,
				rebuilding: false,
				droughtSeasons: 1,
			}),
			0,
		);
		assert.strictEqual(
			gmFireProb({
				hotSeat: gmHotSeat([season(10, 22), season(10, 22)]),
				tenure: 1,
				rebuilding: false,
				droughtSeasons: 2,
			}),
			0,
		);
		// 30 wins under a .500 projection is extreme
		assert.isAbove(
			gmFireProb({
				hotSeat: gmHotSeat([season(11, 41)]),
				tenure: 1,
				rebuilding: false,
				droughtSeasons: 1,
			}),
			0,
		);
		// After the honeymoon the same sustained miss gets him fired
		assert.isAbove(
			gmFireProb({
				hotSeat: gmHotSeat([season(10, 22), season(10, 22), season(10, 22)]),
				tenure: 3,
				rebuilding: false,
				droughtSeasons: 3,
			}),
			0.3,
		);
	});

	test("improvement path from the roster he inherited", () => {
		assert.strictEqual(
			gmPathExpWon({
				baseExpWon: 20,
				numGames: 82,
				seasonIndex: 0,
				rebuilding: false,
			}),
			20,
		);
		const y3 = gmPathExpWon({
			baseExpWon: 20,
			numGames: 82,
			seasonIndex: 3,
			rebuilding: false,
		});
		const y3r = gmPathExpWon({
			baseExpWon: 20,
			numGames: 82,
			seasonIndex: 3,
			rebuilding: true,
		});
		assert.isAbove(y3, y3r);
		assert.isAbove(y3r, 20);
		assert.isBelow(y3, 41);
		// A good team is expected to stay good, not improve
		assert.strictEqual(
			gmPathExpWon({
				baseExpWon: 55,
				numGames: 82,
				seasonIndex: 3,
				rebuilding: false,
			}),
			55,
		);
	});

	test("rebuild credit: progress counts for a patient GM or a rebuilding team", () => {
		assert.strictEqual(
			gmRebuildWeight({ patience: -0.8, rebuilding: false }),
			0,
		);
		assert.isAbove(
			gmRebuildWeight({ patience: 0.8, rebuilding: true }),
			gmRebuildWeight({ patience: 0, rebuilding: true }),
		);
		const progress = gmProgressScore({
			youthChange: 8,
			extraFirsts: 2,
			capRoom: 0.3,
			winTrend: 6,
		});
		assert.isAbove(progress, 8);
		assert.isBelow(
			gmProgressScore({
				youthChange: -6,
				extraFirsts: -2,
				capRoom: -0.2,
				winTrend: -8,
			}),
			-5,
		);
		const tank = { pathExpWon: 30 };
		const judgedOnWins = season(18, 22, tank);
		const withCredit = season(18, 22, {
			...tank,
			progress,
			rebuildWeight: 0.7,
		});
		assert.isAbove(withCredit, judgedOnWins + 5);
		// No progress, no credit
		assert.isBelow(
			season(18, 22, { ...tank, progress: -6, rebuildWeight: 0.7 }),
			0,
		);
		// Rebuilding teams get more rope after the honeymoon
		const hot = -16;
		assert.isBelow(
			gmFireProb({
				hotSeat: hot,
				tenure: 3,
				rebuilding: true,
				droughtSeasons: 3,
				patience: 0.5,
			}),
			gmFireProb({
				hotSeat: hot,
				tenure: 3,
				rebuilding: false,
				droughtSeasons: 3,
			}),
		);
		// Win-now hires on expected contenders get a shorter leash
		assert.isAbove(
			gmFireProb({
				hotSeat: -10,
				tenure: 3,
				rebuilding: false,
				droughtSeasons: 0,
				patience: -0.8,
				contender: true,
			}),
			gmFireProb({
				hotSeat: -10,
				tenure: 3,
				rebuilding: false,
				droughtSeasons: 0,
			}),
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

	test("judged only on full seasons he ran: inherited and taken-over-midway seasons don't count", async () => {
		await ensureGms();
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		await onRegularSeason();
		const tid = 5;
		const t0 = (await idb.cache.teams.get(tid))!;
		const gm = t0.gm!;
		// His predecessor's awful seasons with this team are not his
		gm.seasons.push({
			season: g.get("season") - 1,
			tid,
			won: 5,
			lost: 77,
			tied: 0,
			otl: 0,
			expWon: 41,
			numGames: 82,
			playoffRoundsWon: -1,
		});
		// He took over midway, so no expectation was set for him
		gm.expWon = undefined;
		await idb.cache.teams.put(t0);
		await finishSeason((tid2) => (tid2 === tid ? 5 : 41));
		await withRandom(1, runOffseason);
		const t1 = (await idb.cache.teams.get(tid))!;
		assert.strictEqual(t1.gm!.gmid, gm.gmid);
		const row = t1.gm!.seasons.at(-1)!;
		assert.isTrue(row.partial);
		assert.strictEqual(judgedSeasons(t1.gm!, tid).length, 0);
		assert.isUndefined(t1.gm!.hotSeat);

		// His first full season counts, against the expectation for his roster
		await nextSeason();
		await onRegularSeason();
		await finishSeason((tid2) => (tid2 === tid ? 40 : 41));
		await withRandom(2, runOffseason);
		const t2 = (await idb.cache.teams.get(tid))!;
		assert.strictEqual(judgedSeasons(t2.gm!, tid).length, 1);
		assert.isAbove(t2.gm!.hotSeat!, -5);
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

		// Team 5 is far below expectations (but not extreme enough to end the honeymoon) for 3 seasons, everyone else is average, and a few teams win titles
		for (let i = 0; i < 3; i++) {
			await finishSeason((tid2) => (tid2 === tid ? 22 : 41));
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

describe("GM hot seat news", () => {
	beforeEach(async () => {
		await setup();
		await ensureGms();
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		await onRegularSeason();
	});

	// Teams far below expectations for two seasons (past the honeymoon), then a bad start to the third
	const badTids = [3, 5, 7, 9, 11];
	const setupBadSeasons = async () => {
		for (let i = 0; i < 2; i++) {
			await finishSeason((tid) => (badTids.includes(tid) ? 20 : 41));
			await withRandom(i + 1, async () => {
				// Only the bad seasons get recorded here: no firing yet in the honeymoon
				await runOffseason();
			});
			await nextSeason();
			await onRegularSeason();
		}
		const season = g.get("season");
		for (const t of await idb.cache.teams.getAll()) {
			if (
				!(await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
					season,
					t.tid,
				]))
			) {
				await idb.cache.teamSeasons.add(
					team.genSeasonRow(t, undefined, season),
				);
			}
			const ts = (await idb.cache.teamSeasons.indexGet(
				"teamSeasonsBySeasonTid",
				[season, t.tid],
			))!;
			ts.won = badTids.includes(t.tid) ? 6 : 20;
			ts.lost = badTids.includes(t.tid) ? 34 : 20;
			await idb.cache.teamSeasons.put(ts);
		}
	};

	const newsTexts = async () =>
		(await idb.cache.events.getAll())
			.map((e) => e.text ?? "")
			.filter((x) => x.includes("reportedly"));

	test("GMs about to be fired are reported, at most a few a season, once each, without main stream draws", async () => {
		await setupBadSeasons();
		const orig = Math.random;
		Math.random = () => {
			throw new Error("Math.random called");
		};
		try {
			await hotSeatNews();
			const texts = await newsTexts();
			assert.isAbove(texts.length, 0);
			assert.isAtMost(texts.length, HOT_SEAT_NEWS_MAX);
			for (const tid of badTids) {
				const t = (await idb.cache.teams.get(tid))!;
				if (t.gm!.hotSeatNews === g.get("season")) {
					assert.isTrue(
						texts.some((x) => x.includes(t.gm!.lastName)),
						"news for a marked GM",
					);
				}
			}
			const event = (await idb.cache.events.getAll()).find((e) =>
				e.text?.includes("reportedly"),
			)!;
			assert.isTrue(badTids.includes(event.tids![0]!));

			// Again (another day in the mid-season window): nobody twice
			await hotSeatNews();
			const again = await newsTexts();
			assert.isAtMost(again.length, HOT_SEAT_NEWS_MAX + badTids.length);
			assert.strictEqual(
				new Set(again).size,
				again.length,
				"no GM reported twice",
			);
		} finally {
			Math.random = orig;
		}
	});

	test("nothing for teams doing fine, in college or with the setting off", async () => {
		await hotSeatNews();
		assert.strictEqual(
			(await newsTexts()).length,
			0,
			"first season: honeymoon",
		);

		await setupBadSeasons();
		g.setWithoutSavingToDB("leagueType", "college" as any);
		await hotSeatNews();
		assert.strictEqual((await newsTexts()).length, 0, "college");
		g.setWithoutSavingToDB("leagueType", undefined as any);

		g.setWithoutSavingToDB("featureGmPersonalities", false);
		await hotSeatNews();
		assert.strictEqual((await newsTexts()).length, 0, "setting off");
	});

	test("a team in a playoff spot is projected to make the playoffs", async () => {
		await setupBadSeasons();
		const tid = badTids[0]!;
		const teams = await idb.cache.teams.getAll();
		const t = teams.find((x) => x.tid === tid)!;
		const ts = (await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			g.get("season"),
			tid,
		]))!;
		// A bit under .500 this season after two bad ones, not hopeless
		ts.won = 19;
		ts.lost = 21;
		const missed = await projectedSeasonFireProb(t, teams, ts, () =>
			Promise.resolve(new Set<number>()),
		);
		const made = await projectedSeasonFireProb(t, teams, ts, () =>
			Promise.resolve(new Set([tid])),
		);
		assert.isAbove(missed, 0);
		assert.isBelow(made, missed);

		// The standings decide who's in a playoff spot now
		const best = (await idb.cache.teamSeasons.indexGet(
			"teamSeasonsBySeasonTid",
			[g.get("season"), 1],
		))!;
		best.won = 39;
		best.lost = 1;
		await idb.cache.teamSeasons.put(best);
		const playoffTids = await currentPlayoffTids();
		assert.isTrue(playoffTids.has(1));
		assert.isFalse(playoffTids.has(tid));
	});

	test("short seasons: the games needed before hot seat news scale with the season", async () => {
		assert.strictEqual(hotSeatMinGp(), 10);
		await setupBadSeasons();
		g.setWithoutSavingToDB("numGames", 10);
		assert.strictEqual(hotSeatMinGp(), 2);
		for (const ts of await idb.cache.teamSeasons.indexGetAll(
			"teamSeasonsBySeasonTid",
			[[g.get("season")], [g.get("season"), "Z"]],
		)) {
			ts.won = badTids.includes(ts.tid) ? 0 : 2;
			ts.lost = badTids.includes(ts.tid) ? 3 : 1;
			await idb.cache.teamSeasons.put(ts);
		}
		await hotSeatNews();
		assert.isAbove((await newsTexts()).length, 0);
		g.setWithoutSavingToDB("numGames", 1);
		assert.strictEqual(hotSeatMinGp(), 1);
	});
});

describe("rebuild credit: first round picks", () => {
	const own = (seasons: number[]) =>
		seasons.map((season) => ({ round: 1, season }));
	const season = 2025;

	test("a team holding its own picks has no extra ones, whatever the phase", () => {
		// Before the draft: this season's pick (still unused) and the next 3
		assert.strictEqual(
			extraFirstRoundPicks(own([2025, 2026, 2027, 2028]), {
				season,
				phase: PHASE.PLAYOFFS,
				numFuture: 4,
			}),
			0,
		);
		assert.strictEqual(
			extraFirstRoundPicks(own([2025, 2026, 2027, 2028]), {
				season,
				phase: PHASE.REGULAR_SEASON,
				numFuture: 4,
			}),
			0,
		);
		// After the draft: the next 4
		assert.strictEqual(
			extraFirstRoundPicks(own([2026, 2027, 2028, 2029]), {
				season,
				phase: PHASE.FREE_AGENCY,
				numFuture: 4,
			}),
			0,
		);
		// During the draft: this season's are being used, the next ones are there
		assert.strictEqual(
			extraFirstRoundPicks(own([2026, 2027, 2028]), {
				season,
				phase: PHASE.DRAFT,
				numFuture: 4,
			}),
			0,
		);
		// Second rounders don't count
		assert.strictEqual(
			extraFirstRoundPicks(
				[{ round: 2, season: 2025 }, ...own([2025, 2026, 2027, 2028])],
				{ season, phase: PHASE.PLAYOFFS, numFuture: 4 },
			),
			0,
		);
		// No future picks setting (or no draft): nothing to count
		assert.strictEqual(
			extraFirstRoundPicks([], { season, phase: PHASE.PLAYOFFS, numFuture: 0 }),
			0,
		);
	});

	test("this year's pick counts, extra and missing picks too", () => {
		const opts = { season, phase: PHASE.PLAYOFFS, numFuture: 4 };
		// Traded this season's pick away
		assert.strictEqual(extraFirstRoundPicks(own([2026, 2027, 2028]), opts), -1);
		// Got another team's lottery pick this season
		assert.strictEqual(
			extraFirstRoundPicks(own([2025, 2025, 2026, 2027, 2028]), opts),
			1,
		);
		// More than 4 seasons of picks are scaled to 4
		assert.strictEqual(
			extraFirstRoundPicks(
				own([2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032]),
				{
					...opts,
					numFuture: 8,
				},
			),
			0,
		);
	});
});

describe("AI GMs and the user's teams", () => {
	beforeEach(async () => {
		await setup();
		await ensureGms();
	});

	// Fails the test if anything draws from the main random stream
	const noRandom = async <T>(f: () => Promise<T>) => {
		const orig = Math.random;
		Math.random = () => {
			throw new Error("Math.random called");
		};
		try {
			return await f();
		} finally {
			Math.random = orig;
		}
	};

	const allGmids = async () => {
		const gmids: number[] = [];
		for (const t of await idb.cache.teams.getAll()) {
			for (const gm of [...(t.gm ? [t.gm] : []), ...(t.formerGms ?? [])]) {
				gmids.push(gm.gmid);
			}
		}
		return gmids;
	};

	test("taking a team over ends its GM's tenure, giving it up names a new GM at once, without main stream draws", async () => {
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		const tid = 5;
		const before = (await idb.cache.teams.get(tid))!.gm!;
		const season = g.get("season");

		// Multi team mode: the user adds team 5
		g.setWithoutSavingToDB("userTids", [g.get("userTid"), tid]);
		await noRandom(syncGms);
		const t1 = (await idb.cache.teams.get(tid))!;
		assert.isUndefined(t1.gm);
		const left = t1.formerGms!.at(-1)!;
		assert.strictEqual(left.gmid, before.gmid);
		assert.strictEqual(left.tenures.at(-1)!.reason, "left");
		// Taken over during the regular season: his last season was the one before (never before his first)
		assert.strictEqual(
			left.tenures.at(-1)!.end,
			Math.max(season - 1, left.tenures.at(-1)!.start - 1),
		);
		assert.isTrue(onGmMarket(left));

		// The AI doesn't record a season for him on the user's team, nor set expectations
		await onRegularSeason();
		assert.isUndefined((await idb.cache.teams.get(tid))!.gm);

		// Given up: a new GM at once, a new id
		g.setWithoutSavingToDB("userTids", [g.get("userTid")]);
		await noRandom(syncGms);
		const t2 = (await idb.cache.teams.get(tid))!;
		assert.isDefined(t2.gm);
		assert.notStrictEqual(t2.gm!.gmid, before.gmid);
		assert.strictEqual(t2.gm!.tenures.at(-1)!.start, season);
		const gmids = await allGmids();
		assert.strictEqual(new Set(gmids).size, gmids.length);
		const texts = (await idb.cache.events.getAll()).map((e) => e.text ?? "");
		assert.isTrue(texts.some((x) => x.includes(" left ")));
		assert.isTrue(texts.some((x) => x.includes(" named ")));

		// Hired during the season: the GM carousel files him under this season, not the offseason before it
		assert.isTrue(t2.gm!.tenures.at(-1)!.midSeason);
		const fo = (await frontOfficesView.load({
			inputs: {},
			updateEvents: new Set(["firstRun"]),
			prevInputs: {},
			prevOutput: {},
			conditions: {},
		} as any)) as any;
		const hire = fo.moves.find(
			(m: any) => m.type === "hired" && m.gmid === t2.gm!.gmid,
		);
		assert.strictEqual(hire.season, season);
		assert.isTrue(hire.midSeason);

		// Spectator mode on and off: the user's team gets a GM, and loses him again
		g.setWithoutSavingToDB("spectator", true);
		await syncGms();
		const spectatorGm = (await idb.cache.teams.get(g.get("userTid")))!.gm!;
		assert.isDefined(spectatorGm);
		g.setWithoutSavingToDB("spectator", false);
		await syncGms();
		const userTeam = (await idb.cache.teams.get(g.get("userTid")))!;
		assert.isUndefined(userTeam.gm);
	});

	test("toggling spectator mode doesn't churn GMs: the same GM steps in, no zero game tenures or news", async () => {
		const userTid = g.get("userTid");
		const numEvents = async () => (await idb.cache.events.getAll()).length;
		g.setWithoutSavingToDB("phase", PHASE.DRAFT);

		// First time on: a new GM, named in the news
		g.setWithoutSavingToDB("spectator", true);
		await noRandom(syncGms);
		const gm = (await idb.cache.teams.get(userTid))!.gm!;
		assert.isDefined(gm);
		assert.strictEqual(gm.spectatorFor, userTid);
		const eventsAfterHire = await numEvents();
		assert.strictEqual(eventsAfterHire, 1);
		const gmidsBefore = await allGmids();

		// Off and on a few times, in the offseason and during the season: always him, no tenure left behind, no news
		for (const phase of [
			PHASE.DRAFT,
			PHASE.FREE_AGENCY,
			PHASE.PRESEASON,
			PHASE.REGULAR_SEASON,
		]) {
			if (phase === PHASE.PRESEASON) {
				g.setWithoutSavingToDB("season", g.get("season") + 1);
			}
			g.setWithoutSavingToDB("phase", phase);
			g.setWithoutSavingToDB("spectator", false);
			await noRandom(syncGms);
			const off = (await idb.cache.teams.get(userTid))!;
			assert.isUndefined(off.gm);
			const parked = off.formerGms!.find((x) => x.gmid === gm.gmid)!;
			assert.strictEqual(parked.tenures.length, 0, "no zero game tenure");
			assert.isFalse(onGmMarket(parked));

			g.setWithoutSavingToDB("spectator", true);
			await noRandom(syncGms);
			const on = (await idb.cache.teams.get(userTid))!;
			assert.strictEqual(on.gm!.gmid, gm.gmid);
			assert.isFalse((on.formerGms ?? []).some((x) => x.gmid === gm.gmid));
		}
		assert.strictEqual(await numEvents(), eventsAfterHire);
		assert.deepStrictEqual(await allGmids(), gmidsBefore);

		// He runs a full season, so turning spectator mode off ends a real tenure (with news), and he still steps in again
		await onRegularSeason();
		await finishSeason(() => 41);
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		const t = (await idb.cache.teams.get(userTid))!;
		t.gm!.born.year = g.get("season") - 40;
		await idb.cache.teams.put(t);
		await withRandom(1, runOffseason);
		assert.strictEqual(
			(await idb.cache.teams.get(userTid))!.gm!.gmid,
			gm.gmid,
			"not fired after an average season",
		);
		g.setWithoutSavingToDB("phase", PHASE.DRAFT);
		g.setWithoutSavingToDB("spectator", false);
		await noRandom(syncGms);
		const left = (await idb.cache.teams.get(userTid))!.formerGms!.find(
			(x) => x.gmid === gm.gmid,
		)!;
		assert.strictEqual(left.tenures.length, 1);
		assert.strictEqual(left.tenures[0]!.reason, "left");
		assert.strictEqual(left.tenures[0]!.end, g.get("season"));
		assert.strictEqual(left.seasons.length, 1);
		g.setWithoutSavingToDB("spectator", true);
		await noRandom(syncGms);
		assert.strictEqual((await idb.cache.teams.get(userTid))!.gm!.gmid, gm.gmid);

		// Fired: he's not the one who comes back
		const t2 = (await idb.cache.teams.get(userTid))!;
		leaveTeam(t2, "fired", g.get("season"));
		await idb.cache.teams.put(t2);
		assert.isUndefined(
			t2.formerGms!.find((x) => x.gmid === gm.gmid)!.spectatorFor,
		);
	});

	test("auto play: no GM is hired or fired on the user's team", async () => {
		local.autoPlayUntil = {
			season: g.get("season") + 5,
			phase: PHASE.PRESEASON,
			start: Date.now(),
			resolve: () => {},
			reject: () => {},
		};
		try {
			await ensureGms();
			g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
			await onRegularSeason();
			await finishSeason(() => 10);
			await withRandom(1, runOffseason);
			const t = (await idb.cache.teams.get(g.get("userTid")))!;
			assert.isUndefined(t.gm);
			assert.isUndefined(t.formerGms);
			assert.isUndefined(await getGmWeights(t.tid));
		} finally {
			local.autoPlayUntil = undefined;
		}
	});

	test("contraction: the GM leaves for the market, ids stay unique, the history stays", async () => {
		const tid = 7;
		const t = (await idb.cache.teams.get(tid))!;
		const gm = t.gm!;
		const maxGmid = Math.max(...(await allGmids()));
		gm.gmid = maxGmid + 10;
		t.disabled = true;
		await idb.cache.teams.put(t);
		await noRandom(syncGms);
		const t1 = (await idb.cache.teams.get(tid))!;
		assert.isUndefined(t1.gm);
		assert.strictEqual(t1.formerGms!.at(-1)!.tenures.at(-1)!.reason, "left");

		// The carousel's new GMs get ids above every GM's, the contracted team's included
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		await onRegularSeason();
		for (const tid2 of [3, 4]) {
			const t2 = (await idb.cache.teams.get(tid2))!;
			t2.gm!.born.year = g.get("season") - 80;
			await idb.cache.teams.put(t2);
		}
		await finishSeason(() => 41);
		await withRandom(5, runOffseason);
		const gmids = await allGmids();
		assert.strictEqual(new Set(gmids).size, gmids.length);

		// Front Offices: the contracted team's GM moves are listed
		const fo = await frontOfficesView.load({
			inputs: {},
			updateEvents: new Set(["firstRun"]),
			prevInputs: {},
			prevOutput: {},
			conditions: {},
		} as any);
		assert.isTrue(
			(fo as any).moves.some(
				(m: any) => m.tid === tid && m.type === "left" && m.gmid === gm.gmid,
			),
		);
		assert.isFalse((fo as any).rows.some((r: any) => r.tid === tid));
		for (const row of (fo as any).market) {
			assert.isAtMost(row.age, 66);
		}

		// A revived team names a new GM
		t1.disabled = false;
		await idb.cache.teams.put(t1);
		await noRandom(syncGms);
		const t3 = (await idb.cache.teams.get(tid))!;
		assert.isDefined(t3.gm);
		assert.notStrictEqual(t3.gm!.gmid, gm.gmid);
	});

	test("retired GMs keep career totals instead of season rows, the market matches who can be hired", async () => {
		const tid = 9;
		const t = (await idb.cache.teams.get(tid))!;
		const gm = t.gm!;
		gm.born.year = g.get("season") - 80;
		gm.tenures[0]!.start = g.get("season") - 1;
		gm.seasons.push({
			season: g.get("season") - 1,
			tid,
			won: 60,
			lost: 21,
			tied: 1,
			otl: 0,
			numGames: 82,
			playoffRoundsWon: 4,
		});
		await idb.cache.teams.put(t);
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		await onRegularSeason();
		await finishSeason(() => 41);
		await withRandom(3, runOffseason);
		const retired = (await idb.cache.teams.get(tid))!.formerGms!.find(
			(x) => x.gmid === gm.gmid,
		)!;
		assert.isDefined(retired.retiredYear);
		assert.strictEqual(retired.seasons.length, 0);
		assert.strictEqual(retired.career!.seasons, 2);
		assert.strictEqual(retired.career!.won, 101);
		assert.strictEqual(retired.career!.tied, 1);
		assert.strictEqual(retired.career!.titles, 1);
		assert.isFalse(onGmMarket(retired));
		// His job's record is kept too, so his profile doesn't show 0-0
		assert.deepStrictEqual(retired.tenures[0]!.record, {
			won: 101,
			lost: 62,
			tied: 1,
			otl: 0,
			playoffs: 1,
			titles: 1,
		});
		const profile = (await getGmProfile(retired.gmid))!;
		assert.strictEqual(profile.tenures[0]!.won, 101);
		assert.strictEqual(profile.tenures[0]!.lost, 62);
		assert.strictEqual(profile.tenures[0]!.playoffs, 1);
		assert.strictEqual(profile.tenures[0]!.titles, 1);

		// Retired before tenure records were kept: from the team seasons
		delete retired.tenures[0]!.record;
		const legacy = (await getGmProfile(retired.gmid))!;
		assert.strictEqual(legacy.tenures[0]!.won, 41);
		assert.strictEqual(legacy.tenures[0]!.lost, 41);

		// A 67 year old former GM can't be hired, so he's not on the market
		const t2 = (await idb.cache.teams.get(11))!;
		const old = t2.gm!;
		old.born.year = g.get("season") - 67;
		old.tenures.at(-1)!.end = g.get("season") - 1;
		old.tenures.at(-1)!.reason = "fired";
		t2.formerGms = [...(t2.formerGms ?? []), old];
		t2.gm = undefined;
		await idb.cache.teams.put(t2);
		assert.isFalse(onGmMarket(old));
	});

	test("turned on during the playoffs, the first tenures start next season", async () => {
		await setup();
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		await ensureGms();
		const season = g.get("season");
		const t = (await idb.cache.teams.get(5))!;
		assert.strictEqual(t.gm!.tenures[0]!.start, season + 1);
		await finishSeason(() => 41);
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		await withRandom(1, runOffseason);
		const t1 = (await idb.cache.teams.get(5))!;
		assert.strictEqual(t1.gm!.seasons.length, 0);
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
		// by less than 15%, and one extreme leaning a pick by less than the 20% pick factor (less than the team strategy factors)
		for (const [x, base, max] of [
			[patientYoung, neutralYoung, 0.15],
			[winNowVet, neutralVet, 0.15],
			[hoarder, neutralPick, 0.201],
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

describe("AI GM finance styles", () => {
	const setupFinance = async (on: boolean) => {
		await setup();
		g.setWithoutSavingToDB("featureGmFinance", on);
	};

	test("every GM gets a stable style from his id, without main stream draws", async () => {
		const run = async (on: boolean) => {
			await setupFinance(on);
			const next = await withRandom(7, async () => {
				await ensureGms();
				return Math.random();
			});
			const teams = await idb.cache.teams.getAll();
			return {
				next,
				gms: teams.map((t) =>
					t.gm ? JSON.stringify([t.gm.firstName, t.gm.traits]) : "",
				),
				styles: teams.map((t) => t.gm?.financeStyle),
			};
		};
		const off = await run(false);
		const on = await run(true);
		// Same GMs and the same next random number either way
		assert.strictEqual(on.next, off.next);
		assert.deepStrictEqual(on.gms, off.gms);
		assert.isTrue(off.styles.every((style) => style === undefined));
		const styles = on.styles.filter((style) => style !== undefined);
		assert.strictEqual(styles.length, on.gms.length - 1);
		assert.isAbove(new Set(styles).size, 2);

		// An existing GM without a style gets the same one back
		for (const t of await idb.cache.teams.getAll()) {
			if (t.gm) {
				delete t.gm.financeStyle;
				await idb.cache.teams.put(t);
			}
		}
		await ensureGms();
		assert.deepStrictEqual(
			(await idb.cache.teams.getAll()).map((t) => t.gm?.financeStyle),
			on.styles,
		);
	});

	test("style moves tax willingness, the owner's type wins", async () => {
		await setupFinance(true);
		g.setWithoutSavingToDB("featureCommercial", true);
		await ensureGms();
		const tid = 1;
		const set = async (
			financeStyle: "frugal" | "spendthrift" | "balanced",
			ownerType?: "profit",
		) => {
			const t = (await idb.cache.teams.get(tid))!;
			t.gm!.traits = { ...NEUTRAL_GM_TRAITS };
			t.gm!.financeStyle = financeStyle;
			t.commercial = ownerType ? { deals: {}, ownerType } : undefined;
			await idb.cache.teams.put(t);
			return (await getGmWeights(tid))!;
		};
		const balanced = await set("balanced");
		const frugal = await set("frugal");
		const spendthrift = await set("spendthrift");
		assert.strictEqual(balanced.avoidTaxRankShift, 0);
		assert.isBelow(frugal.avoidTaxRankShift, 0);
		assert.isAbove(spendthrift.avoidTaxRankShift, 0);
		// A frugal GM keeps cap room in free agency and only pays his best players over the cap; the others don't
		assert.isAbove(frugal.faCapRoom, 0);
		assert.isBelow(frugal.overCapResignRank, 5);
		assert.isBelow(frugal.dumpPayrollFactor, 1);
		for (const w of [balanced, spendthrift]) {
			assert.strictEqual(w.faCapRoom, 0);
			assert.strictEqual(w.overCapResignRank, Infinity);
		}
		assert.isAbove(spendthrift.dumpPayrollFactor, 1);
		assert.isAbove(spendthrift.faStarShift, frugal.faStarShift);
		assert.isTrue(frugal.refusesTax);
		assert.isFalse(balanced.refusesTax);
		assert.isFalse(spendthrift.refusesTax);

		// In a trade, a frugal GM takes on no salary that leaves him over the luxury tax line; the others do
		const salaryCap = g.get("salaryCap");
		const luxuryPayroll = g.get("luxuryPayroll");
		g.setWithoutSavingToDB("salaryCap", 1e9);
		g.setWithoutSavingToDB("luxuryPayroll", 1000);
		const other = player.generate(
			2,
			26,
			g.get("season") - 6,
			true,
			DEFAULT_LEVEL,
		);
		const otherPid = (await idb.cache.players.add(
			Object.assign(other, {
				contract: { amount: 5000, exp: g.get("season") + 1 },
			}),
		)) as number;
		const taxWarning = async () =>
			(
				await trade.summary([
					{ tid, pids: [], dpids: [], pidsExcluded: [], dpidsExcluded: [] },
					{
						tid: 2,
						pids: [otherPid],
						dpids: [],
						pidsExcluded: [],
						dpidsExcluded: [],
					},
				])
			).warning;
		await set("frugal");
		assert.include(await taxWarning(), "luxury tax");
		await set("spendthrift");
		assert.isNull(await taxWarning());
		g.setWithoutSavingToDB("salaryCap", salaryCap);
		g.setWithoutSavingToDB("luxuryPayroll", luxuryPayroll);
		// A bottom line owner won't let a spendthrift pay tax
		const blocked = await set("spendthrift", "profit");
		assert.strictEqual(blocked.avoidTaxRankShift, 0);

		// Off: no change
		g.setWithoutSavingToDB("featureGmFinance", false);
		const off = await set("frugal");
		assert.strictEqual(off.avoidTaxRankShift, 0);
	});
});
