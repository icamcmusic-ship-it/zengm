// Coaching audit fixes: Staff page actions on the page's team (multi-team), capped extensions, kept interims safe from the firing that
// follows, first-season protection for head coaches, a centered philosophy shift, the user told when his head coach leaves, the acting
// coach of a vacant head coach job, and scheme-fit numbers from the ratings the user can see
import { afterAll, assert, describe, test } from "vitest";
import { makeSeededRandom } from "../../../common/random.ts";
import { PHASE } from "../../../common/constants.ts";
import {
	NEUTRAL_COACH_SIM,
	coachSimEffects,
	deriveCoachProfile,
	normalizeCoachSims,
} from "../../../common/coachSystems.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import api from "../../api/index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import {
	applyCoachSystems,
	ensureStaff,
	getCoachProfile,
	getTeamStaff,
	headTenure,
	maxCoachContractExp,
	onPreseason,
	philosophyLeagueMean,
	philosophyLevelDelta,
	runOffseason,
	userExtend,
} from "./index.ts";
import {
	ACTING_COACH_PERCENTILE,
	actingCoachSim,
	hotSeatFireProb,
	playerSystemFit,
} from "./systems.ts";
import { rosterFitPlayers } from "../../views/staffShared.ts";
import type { Coach } from "../../../common/types.ts";
import {
	coachAgeOffset,
	coachOvr,
	coachRatingDrift,
	coachRatingRef,
} from "../../../common/staff.ts";

const realRandom = Math.random;

const setup = async ({
	seed = 7,
	market = false,
	systems = false,
}: { seed?: number; market?: boolean; systems?: boolean } = {}) => {
	Math.random = makeSeededRandom(seed);
	resetG();
	g.setWithoutSavingToDB("coachingStaff", true);
	g.setWithoutSavingToDB("coachSystems", systems);
	if (market) {
		g.setWithoutSavingToDB("featureCoachingDepth" as any, true);
		g.setWithoutSavingToDB("featureCoachMarket" as any, true);
	}
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
	await ensureStaff();
};

const finishSeason = async (wonOf: (tid: number) => number) => {
	const season = g.get("season");
	for (const t of await idb.cache.teams.getAll()) {
		const ts = team.genSeasonRow(t, undefined, season);
		ts.won = wonOf(t.tid);
		ts.lost = 82 - ts.won;
		await idb.cache.teamSeasons.add(ts);
	}
	g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
};

const headRow = (season: number, tid: number, won: number, exp?: number) => ({
	season,
	tid,
	role: "head" as const,
	won,
	lost: 82 - won,
	tied: 0,
	otl: 0,
	playoffRoundsWon: -1,
	expectedPct: exp,
});

afterAll(() => {
	Math.random = realRandom;
	resetG();
});

describe("coaching audit fixes", () => {
	test("B1: Staff page actions act on the page's team, and only on a user team", async () => {
		await setup();
		g.setWithoutSavingToDB("userTids", [0, 1]);
		g.setWithoutSavingToDB("userTid", 0);
		const t1 = (await idb.cache.teams.get(1))!;
		await idb.cache.teamSeasons.add(team.genSeasonRow(t1));

		// Firing team 1's coach from team 1's page while team 0 is active
		const dev1 = (await getTeamStaff(1)).dev!;
		await api.main.staffAction({ type: "fire", cid: dev1.cid, tid: 1 });
		assert.isUndefined((await getTeamStaff(1)).dev);
		assert.isDefined((await getTeamStaff(0)).dev);

		// Not a user team
		const dev2 = (await getTeamStaff(2)).dev!;
		let threw = false;
		try {
			await api.main.staffAction({ type: "fire", cid: dev2.cid, tid: 2 });
		} catch {
			threw = true;
		}
		assert.isTrue(threw);
		assert.isDefined((await getTeamStaff(2)).dev);
	});

	test("B2: extensions can't take a contract more than 5 seasons out", async () => {
		await setup();
		const tid = g.get("userTid");
		const dev = (await getTeamStaff(tid)).dev!;
		const max = maxCoachContractExp();
		assert.strictEqual(max, g.get("season") + 4);
		for (let i = 0; i < 4; i++) {
			try {
				await userExtend({ cid: dev.cid, tid, years: 5 });
			} catch {}
		}
		const c = (await idb.cache.coaches.get(dev.cid))!;
		assert.strictEqual(c.contract.exp, max);
		// Already at the limit: refused
		let threw = false;
		try {
			await userExtend({ cid: dev.cid, tid, years: 1 });
		} catch {
			threw = true;
		}
		assert.isTrue(threw);
		assert.strictEqual(
			(await idb.cache.coaches.get(dev.cid))!.contract.exp,
			max,
		);

		// After the playoffs the next contract year is next season
		g.setWithoutSavingToDB("phase", PHASE.DRAFT);
		assert.strictEqual(maxCoachContractExp(), g.get("season") + 5);
	});

	test("B5: head tenure counts head coach seasons with this team only, and protects the first season", async () => {
		await setup({ systems: true });
		const season = g.get("season");
		const c = (await getTeamStaff(3)).head! as Coach;
		// Six seasons as his team's assistant, then one as head coach (15 wins under the expectation)
		c.stats = [
			...[6, 5, 4, 3, 2, 1].map((i) => ({
				...headRow(season - i, 3, 41),
				role: "off" as const,
			})),
			headRow(season, 3, 30, 0.55),
		];
		assert.strictEqual(headTenure(c), 1);
		// Hot: an ordinary firing after his second season, but not after his first
		const prob = hotSeatFireProb(c, 2);
		assert.isAbove(prob, 0.5);
		assert.isBelow(hotSeatFireProb(c, 1), prob);
		assert.isAtMost(hotSeatFireProb(c, 1), 0.3);

		// A small miss in the first season: no firing at all
		c.stats = [headRow(season, 3, 37, 0.5)];
		assert.isAbove(hotSeatFireProb(c, 2), 0);
		assert.strictEqual(hotSeatFireProb(c, 1), 0);

		// Seasons with another team, or as an assistant after head coach seasons, end the streak
		c.stats = [
			headRow(season - 2, 3, 41),
			headRow(season - 1, 5, 41),
			headRow(season, 3, 41),
		];
		assert.strictEqual(headTenure(c), 1);
		c.stats = [headRow(season - 1, 3, 41), headRow(season, 3, 41)];
		assert.strictEqual(headTenure(c), 2);
	});

	test("B3: an interim the AI just kept isn't fired in the same offseason", async () => {
		// Several leagues, since the firing is random (a 75% chance each without the fix)
		for (const seed of [1, 2, 3, 4, 5]) {
			await setup({ seed, market: true, systems: true });
			const season = g.get("season");
			const tid = 4;
			const c = (await getTeamStaff(tid)).head! as Coach;
			c.born.year = season - 45;
			c.contract.exp = season + 2;
			c.succession = { interim: { season, from: "off" } };
			// Earlier bad seasons, a .500 season under him (kept for sure), against a high expectation: red hot
			c.stats = [
				headRow(season - 2, tid, 15, 0.9),
				headRow(season - 1, tid, 15, 0.9),
			];
			c.profile = {
				...getCoachProfile(c),
				expect: { season, tid, pct: 0.95 },
			};
			await idb.cache.coaches.put(c);
			await finishSeason((t) => (t === tid ? 41 : 41));
			await runOffseason();
			const after = (await idb.cache.coaches.get(c.cid))!;
			assert.strictEqual(after.tid, tid, `seed ${seed}`);
			assert.strictEqual(after.role, "head");
			assert.isUndefined(after.succession?.interim);
		}
	});

	test("B6: the development philosophy shift is centered over the league's head coaches", async () => {
		await setup({ systems: true });
		const coaches = (await idb.cache.coaches.getAll()).filter(
			(c) => c.tid >= 0 && c.role === "head",
		);
		const profiles = new Map(
			coaches.map((c, i) => [
				c.tid,
				// Drifted toward development coaches
				{ ...getCoachProfile(c), philosophy: 0.3 + 0.02 * (i % 10) },
			]),
		);
		const mean = philosophyLeagueMean(profiles);
		assert.isAbove(mean, 0.3);
		for (const age of [21, 26, 33]) {
			let sum = 0;
			for (const profile of profiles.values()) {
				sum += philosophyLevelDelta(profile, age, mean);
			}
			assert.closeTo(sum / profiles.size, 0, 1e-9);
		}
		// Uncentered it pushed every young player up
		assert.isAbove(
			philosophyLevelDelta(profiles.values().next().value!, 21),
			2,
		);
		assert.strictEqual(philosophyLeagueMean(new Map()), 0);
	});

	test("B7: the user's head coach leaving when his contract runs out is in the news", async () => {
		// (the notification itself can't be seen from a test: toUI does nothing here)
		await setup();
		const tid = g.get("userTid");
		const head = (await getTeamStaff(tid)).head!;
		head.contract.exp = g.get("season");
		head.born.year = g.get("season") - 45;
		await idb.cache.coaches.put(head);
		await finishSeason(() => 41);
		const events: { text?: string; tids?: number[] }[] = [];
		const realAdd = idb.cache.events.add.bind(idb.cache.events);
		(idb.cache.events as any).add = (e: any) => {
			events.push(e);
			return realAdd(e);
		};
		try {
			await runOffseason();
		} finally {
			(idb.cache.events as any).add = realAdd;
		}
		// (gone from the user's team: a free agent, or already hired by an AI team with an open job)
		assert.notStrictEqual((await idb.cache.coaches.get(head.cid))!.tid, tid);
		assert.isTrue(
			events.some(
				(e) =>
					e.tids?.includes(tid) &&
					e.text?.includes("when his contract expired"),
			),
		);
	});

	test("gap: a vacant head coach job plays under a below-average acting coach", async () => {
		const sims = normalizeCoachSims(
			Array.from({ length: 30 }, (_, i) => {
				const profile = deriveCoachProfile({
					firstName: `A${i}`,
					lastName: `B${i}`,
					born: { year: 1970 + i, loc: "USA" },
					ratings: { dev: 50, off: 30 + 2 * i, def: 80 - i, mot: 40 + i },
					style: { pace: 0, threes: 0, defense: 0, rotation: 0 },
				} as any);
				return coachSimEffects({
					profile,
					head: { dev: 50, off: 30 + 2 * i, def: 80 - i, mot: 40 + i },
					install: 1,
					offFit: 0,
					defFit: 0,
					style: { pace: 0, threes: 0, defense: 0, rotation: 0 },
				});
			}),
		);
		const acting = actingCoachSim(sims)!;
		assert.isAtMost(acting.make, 0);
		assert.isAtLeast(acting.dMake, 0);
		assert.isAtMost(acting.clutchMake, 0);
		assert.isBelow(acting.make + -acting.dMake + acting.clutchMake, 0);
		// No system of his own
		for (const key of ["three", "pace", "foul", "tov"] as const) {
			assert.strictEqual(acting[key], NEUTRAL_COACH_SIM[key]);
		}
		// About the 35th percentile
		const makes = sims.map((s) => s.make).toSorted((a, b) => a - b);
		const below = makes.filter((x) => x < acting.make).length / makes.length;
		assert.closeTo(below, ACTING_COACH_PERCENTILE, 0.1);
		assert.isUndefined(actingCoachSim([]));

		// In a league: the team without a head coach gets the acting coach, only with Coaching Systems on
		for (const systems of [false, true]) {
			await setup({ systems });
			const head = (await getTeamStaff(1)).head!;
			await idb.cache.coaches.delete(head.cid);
			const teams: Record<number, any> = {
				0: { player: [] },
				1: { player: [] },
			};
			await applyCoachSystems([{ homeTid: 0, awayTid: 1, day: 2 }], teams);
			if (systems) {
				assert.isDefined(teams[0].coachSim);
				assert.isDefined(teams[1].coachSim);
				assert.isAtMost(teams[1].coachSim.make, 0);
				assert.isAtLeast(teams[1].coachSim.dMake, 0);
			} else {
				assert.isUndefined(teams[0].coachSim);
				assert.isUndefined(teams[1].coachSim);
			}
		}
	});

	test("B4: Helping/Hurting fit numbers come from the fuzzed ratings, and none under No Visible Ratings", async () => {
		await setup({ systems: true });
		const tid = 2;
		const players = range13().map(() =>
			player.generate(tid, 27, g.get("season") - 1, true, DEFAULT_LEVEL),
		);
		for (const p of players) {
			// Fuzz moves all ratings together, which a fit (a player's shape) mostly ignores: a huge one, so ratings hit the floor and
			// the shown number differs from the true one
			p.ratings.at(-1)!.fuzz = -40;
			await player.updateValues(p);
			await idb.cache.players.put(p);
		}
		const head = (await getTeamStaff(tid)).head!;
		const profile = getCoachProfile(head);
		const fit = await rosterFitPlayers(tid, head);
		const listed = [...fit.helping, ...fit.hurting];
		assert.isAbove(listed.length, 0);
		let differs = false;
		for (const row of listed) {
			const p = (await idb.cache.players.get(row.pid))!;
			if (row.score !== playerSystemFit(p, profile).score) {
				differs = true;
			}
		}
		assert.isTrue(differs);

		g.setWithoutSavingToDB("challengeNoRatings", true);
		assert.deepEqual(await rosterFitPlayers(tid, head), {
			helping: [],
			hurting: [],
		});
	});
});

const range13 = () => Array.from({ length: 13 }, (_, i) => i);

describe("coach rating progression", () => {
	test("a coach on his age's curve stays on it; above it he is pulled back", () => {
		for (const age of [32, 45, 60]) {
			const ref = coachRatingRef("off", "off") + coachAgeOffset(age);
			// Expected change equals the age trend, which is what the curve itself does from this age to the next
			assert.closeTo(
				coachRatingDrift(ref, "off", "off", age),
				coachAgeOffset(age + 1) - coachAgeOffset(age),
				0.11,
			);
			assert.isBelow(
				coachRatingDrift(ref + 20, "off", "off", age),
				coachRatingDrift(ref, "off", "off", age),
			);
		}
		// The job matters: an offensive coordinator's offense is made higher than a development coach's
		assert.isAbove(coachRatingRef("off", "off"), coachRatingRef("off", "dev"));
		assert.isAbove(coachRatingRef("mot", "head"), coachRatingRef("mot", "off"));
	});

	test("the league's coach ratings and salaries don't drift up over the decades (associate head coaches included)", async () => {
		await setup({ seed: 3, market: true, systems: true });
		g.setWithoutSavingToDB("userTids", []);
		const snapshot = async () => {
			const employed = (await idb.cache.coaches.getAll()).filter(
				(c) => c.tid >= 0,
			);
			const heads = employed.filter((c) => c.role === "head");
			const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
			return {
				head: mean(heads.map((c) => coachOvr(c.ratings, "head"))),
				salary: mean(employed.map((c) => c.contract.amount)),
			};
		};
		const start = await snapshot();
		for (let i = 0; i < 15; i++) {
			const season = g.get("season");
			await finishSeason(() => 31 + Math.floor(Math.random() * 21));
			await runOffseason();
			g.setWithoutSavingToDB("season", season + 1);
			g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
			await onPreseason();
			g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		}
		const end = await snapshot();
		// Before: head coach ovr about +10 and salaries about +40% over 15 seasons
		assert.isBelow(Math.abs(end.head - start.head), 3.5);
		assert.isBelow(end.salary / start.salary, 1.15);
		assert.isAbove(end.salary / start.salary, 0.8);
	});
});
