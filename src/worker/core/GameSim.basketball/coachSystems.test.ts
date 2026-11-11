import { afterAll, assert, describe, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g, helpers } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { boxAverages, genLeague, simLeague } from "./coachSystemsMetrics.ts";
import {
	COACH_SIM_ADD_KEYS,
	COACH_SIM_MULT_KEYS,
	DEFENSE_SYSTEMS,
	NEUTRAL_COACH_SIM,
	OFFENSE_SYSTEMS,
	coachSimEffects,
	deriveCoachProfile,
	normalizeCoachSims,
	seriesAdjustment,
	type CoachSim,
} from "../../../common/coachSystems.ts";
import { PHASE } from "../../../common/constants.ts";
import { team } from "../index.ts";
import {
	applyCoachSystems,
	coachReputation,
	ensureStaff,
	getCoachProfile,
	headCoachFitBonus,
	getTeamHiringContext,
	hotSeat,
	philosophyLevelDelta,
	playerSystemFitForTeam,
	rankHeadCoachCandidates,
	runOffseason,
} from "../staff/index.ts";
import { range } from "../../../common/utils.ts";

/*
 * Coaching systems (common/coachSystems.ts, staff/systems.ts): off changes nothing, the sim multipliers are neutral over a league, fit
 * effects are bounded, everything is deterministic, and coaches from before the setting get a profile without random draws. The calibration
 * tables are in docs/native-features.md (coachSystems.script.test.ts).
 */

afterAll(() => {
	resetG();
});

const simOne = (seed: number, sims?: [CoachSim, CoachSim]) =>
	withSeededRandom(seed, async () => {
		await genTeams();
		g.setWithoutSavingToDB("realisticPossessions", true);
		const teams = await loadTeams([0, 1], {});
		if (sims) {
			(teams[0] as any).coachSim = sims[0];
			(teams[1] as any).coachSim = sims[1];
		}
		const sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay: false,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		const result = sim.run();
		return JSON.stringify(result.team.map((t: any) => t.stat));
	});

const neutral: CoachSim = {
	...NEUTRAL_COACH_SIM,
	off: "motion",
	def: "switch",
};

const profileSource = (i: number) => ({
	firstName: `A${i}`,
	lastName: `B${i}`,
	born: { year: 1970 + (i % 20), loc: "USA" },
	ratings: {
		dev: 40 + (i % 30),
		off: 35 + ((i * 7) % 40),
		def: 35 + ((i * 11) % 40),
		mot: 50,
	},
	style: {
		pace: ((i * 13) % 200) / 100 - 1,
		threes: ((i * 29) % 200) / 100 - 1,
		defense: ((i * 31) % 200) / 100 - 1,
		rotation: ((i * 17) % 200) / 100 - 1,
	},
});

describe("coaching systems", () => {
	test("neutral multipliers play exactly like no coaching systems (no extra random draws)", async () => {
		for (const seed of [11, 12]) {
			assert.strictEqual(
				await simOne(seed, [neutral, neutral]),
				await simOne(seed),
			);
		}
	});

	test("deterministic: same coaches and seed, same game", async () => {
		const a = coachSimEffects({
			profile: deriveCoachProfile(profileSource(3)),
			head: profileSource(3).ratings,
			install: 1,
			offFit: 1,
			defFit: -0.5,
			style: profileSource(3).style,
		});
		const b = coachSimEffects({
			profile: deriveCoachProfile(profileSource(8)),
			head: profileSource(8).ratings,
			install: 0.5,
			offFit: -1,
			defFit: 0.5,
			style: profileSource(8).style,
		});
		const first = await simOne(21, [a, b]);
		assert.strictEqual(await simOne(21, [{ ...a }, { ...b }]), first);
		assert.notStrictEqual(first, await simOne(21));
	});

	test("migration: profiles come from the coach alone, with no random draws, and cover every system", () => {
		const original = Math.random;
		Math.random = () => {
			throw new Error("Math.random called");
		};
		try {
			const offs = new Set<string>();
			const defs = new Set<string>();
			for (const i of range(400)) {
				const p1 = deriveCoachProfile(profileSource(i));
				const p2 = deriveCoachProfile(profileSource(i));
				assert.deepEqual(p1, p2);
				offs.add(p1.off);
				defs.add(p1.def);
				for (const key of [
					"crash",
					"fouls",
					"closing",
					"timeouts",
					"youth",
					"rest",
					"philosophy",
					"personality",
				] as const) {
					assert.isAtLeast(p1[key], -1);
					assert.isAtMost(p1[key], 1);
				}
			}
			assert.strictEqual(offs.size, OFFENSE_SYSTEMS.length);
			assert.strictEqual(defs.size, DEFENSE_SYSTEMS.length);
		} finally {
			Math.random = original;
		}
	});

	test("fit effects are bounded and the league normalization is neutral", () => {
		const sims = range(30).map((i) =>
			coachSimEffects({
				profile: deriveCoachProfile(profileSource(i)),
				head: profileSource(i).ratings,
				install: i % 3 === 0 ? 0.35 : 1,
				offFit: (i % 7) - 3,
				defFit: 3 - (i % 5),
				style: profileSource(i).style,
			}),
		);
		const normalized = normalizeCoachSims(sims);
		for (const key of COACH_SIM_MULT_KEYS) {
			const m =
				key === "foul"
					? Math.sqrt(normalized.reduce((a, s) => a + s[key] ** 2, 0) / 30)
					: normalized.reduce((a, s) => a + s[key], 0) / 30;
			assert.closeTo(m, 1, 1e-9, key);
		}
		for (const key of COACH_SIM_ADD_KEYS) {
			assert.closeTo(
				normalized.reduce((a, s) => a + s[key], 0),
				0,
				1e-9,
				key,
			);
		}
		for (const s of normalized) {
			// A few percent of make probability at most, even for a 3 SD fit with a full system and a great coach
			assert.isBelow(Math.abs(s.make), 0.04);
			assert.isBelow(Math.abs(s.dMake), 0.04);
			for (const key of COACH_SIM_MULT_KEYS) {
				assert.isAbove(s[key], 0.5, key);
				assert.isBelow(s[key], 2, key);
			}
		}
		// Fit alone: 1 SD is worth FIT_MAKE_FACTOR of make probability
		const base = {
			profile: deriveCoachProfile(profileSource(1)),
			head: profileSource(1).ratings,
			install: 1,
			defFit: 0,
			style: profileSource(1).style,
		};
		const diff =
			coachSimEffects({ ...base, offFit: 1 }).make -
			coachSimEffects({ ...base, offFit: 0 }).make;
		assert.isAbove(diff, 0);
		assert.isBelow(diff, 0.01);
	});

	test("playoff adjustments: only for the team behind in the series, toward what the other defense concedes", () => {
		const own = { ...neutral };
		const opp = { ...neutral, dThree: 1.2, dRim: 0.8 };
		assert.deepEqual(seriesAdjustment(own, opp, 80, 0), own);
		const adj = seriesAdjustment(own, opp, 80, 2);
		assert.isAbove(adj.three, 1);
		assert.isBelow(adj.rim, 1);
		const stubborn = seriesAdjustment(own, opp, 10, 2);
		assert.isBelow(stubborn.three, adj.three);
	});

	test("league averages stay the same with random coaches", async () => {
		const settings = { realisticPossessions: true };
		const league = await genLeague({ numPairs: 6, seed: 7, settings });
		const off = boxAverages(
			await simLeague({
				league,
				seed: 9,
				gamesPerPair: 8,
				coaches: false,
				settings,
			}),
		);
		const on = boxAverages(
			await simLeague({
				league,
				seed: 9,
				gamesPerPair: 8,
				coaches: true,
				settings,
			}),
		);
		// (small samples: the calibration with thousands of games is in docs/native-features.md)
		assert.closeTo(on.pts!, off.pts!, 3);
		assert.closeTo(on.fgp!, off.fgp!, 0.012);
		assert.closeTo(on.tpaRate!, off.tpaRate!, 0.02);
		assert.closeTo(on.tov!, off.tov!, 1.2);
		assert.closeTo(on.orb!, off.orb!, 1.2);
		assert.closeTo(on.poss!, off.poss!, 2.5);
	});
});

describe("coaching systems in a league", () => {
	const setup = async (coachSystems: boolean) => {
		resetG();
		g.setWithoutSavingToDB("coachingStaff", true);
		g.setWithoutSavingToDB("coachSystems", coachSystems);
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		idb.league = mockIDBLeague();
		const teams = helpers.getTeamsDefault().map(team.generate);
		await resetCache({ teams });
		await ensureStaff();
	};

	test("off: no profiles stored, no sim multipliers", async () => {
		await setup(false);
		const coaches = await idb.cache.coaches.getAll();
		assert.isTrue(coaches.length > 0);
		assert.isTrue(coaches.every((c) => c.profile === undefined));
		const teams: Record<number, any> = { 0: { player: [] }, 1: { player: [] } };
		await applyCoachSystems([{ homeTid: 0, awayTid: 1 }], teams);
		assert.isUndefined(teams[0].coachSim);
		assert.strictEqual(
			(await playerSystemFitForTeam({ ratings: [] } as any, 0)).fit,
			0,
		);
	});

	test("on: profiles, sim multipliers, hiring by fit, reputation and hot seat", async () => {
		await setup(true);
		const coaches = await idb.cache.coaches.getAll();
		assert.isTrue(coaches.every((c) => c.profile !== undefined));
		// Initial staffs have their systems installed
		assert.isTrue(coaches.every((c) => c.profile!.since === undefined));
		const teams: Record<number, any> = {
			0: { player: [], pbpGame: range(12).map(() => 1) },
			1: { player: [] },
		};
		await applyCoachSystems([{ homeTid: 0, awayTid: 1, day: 1 }], teams);
		assert.isDefined(teams[0].coachSim);
		assert.isDefined(teams[1].coachSim);
		assert.strictEqual(teams[0].pbpGame.length, 17);

		const head = coaches.find((c) => c.role === "head")!;
		const rep = coachReputation(head);
		assert.isAtLeast(rep, 0);
		assert.isAtMost(rep, 100);
		const heat = hotSeat({
			...head,
			stats: [
				{
					season: g.get("season") - 1,
					tid: head.tid,
					role: "head",
					won: 20,
					lost: 62,
					tied: 0,
					otl: 0,
					playoffRoundsWon: -1,
					expectedPct: 0.6,
				},
			],
		});
		assert.isAbove(heat, 0.8);

		const ctx = await getTeamHiringContext(0);
		const developer = {
			...head,
			profile: { ...getCoachProfile(head), philosophy: 1, youth: 1 },
		};
		const winNow = {
			...head,
			profile: { ...getCoachProfile(head), philosophy: -1, youth: -1 },
		};
		assert.isAbove(
			headCoachFitBonus(developer, { ...ctx, strategy: "rebuilding" }),
			headCoachFitBonus(winNow, { ...ctx, strategy: "rebuilding" }),
		);
		assert.isAbove(
			headCoachFitBonus(winNow, {
				...ctx,
				strategy: "contending",
				numYoung: 0,
			}),
			headCoachFitBonus(developer, {
				...ctx,
				strategy: "contending",
				numYoung: 0,
			}),
		);
		const ranked = await rankHeadCoachCandidates(0);
		for (let i = 1; i < ranked.length; i++) {
			assert.isAtLeast(ranked[i - 1]!.score, ranked[i]!.score);
		}

		// Development philosophy: centered (young up, veterans down for a development coach)
		const p = getCoachProfile(head);
		assert.strictEqual(
			Math.sign(philosophyLevelDelta({ ...p, philosophy: 1 }, 21)),
			1,
		);
		assert.strictEqual(
			Math.sign(philosophyLevelDelta({ ...p, philosophy: 1 }, 33)),
			-1,
		);
	});

	test("offseason: season rows get systems, coaches keep running", async () => {
		await setup(true);
		const season = g.get("season");
		for (const t of await idb.cache.teams.getAll()) {
			const ts = team.genSeasonRow(t, undefined, season);
			ts.won = 20 + t.tid;
			ts.lost = 82 - ts.won;
			await idb.cache.teamSeasons.add(ts);
		}
		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
		await runOffseason();
		const heads = (await idb.cache.coaches.getAll()).filter(
			(c) => c.role === "head" && c.stats.some((r) => r.season === season),
		);
		assert.isTrue(heads.length > 0);
		for (const c of heads) {
			const row = c.stats.find((r) => r.season === season && r.role === "head");
			if (row) {
				assert.isDefined(row.off);
				assert.isDefined(row.def);
			}
		}
	});
});
