import { assert, beforeEach, describe, test } from "vitest";
import { DEFAULT_LEVEL, levelToEffect } from "../../../common/budgetLevels.ts";
import { PHASE } from "../../../common/constants.ts";
import { COACH_FREE_AGENT, COACH_ROLES } from "../../../common/staff.ts";
import type { Team } from "../../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { finances, player, team } from "../index.ts";
import {
	COACH_OF_THE_YEAR,
	ensureStaff,
	getCoachingCarousel,
	getStaffLevel,
	getStaffPayroll,
	getTeamCoachStyle,
	getTeamStaff,
	runOffseason,
	onPreseason,
	userExtend,
	userFire,
	userHire,
} from "./index.ts";

const setup = async (coachingStaff = true) => {
	resetG();
	g.setWithoutSavingToDB("coachingStaff", coachingStaff);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
};

// Fake a finished season, records random but summing to a real league
const finishSeason = async () => {
	const season = g.get("season");
	const teams = await idb.cache.teams.getAll();
	for (const t of teams) {
		const won = Math.round(Math.random() * 82);
		const ts = team.genSeasonRow(t, undefined, season);
		ts.won = won;
		ts.lost = 82 - won;
		ts.playoffRoundsWon = won > 45 ? Math.floor(Math.random() * 5) : -1;
		await idb.cache.teamSeasons.add(ts);
	}
	g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
};

const nextSeason = async () => {
	g.setWithoutSavingToDB("season", g.get("season") + 1);
	g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
	await onPreseason();
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
};

const assertFullStaffs = async ({ skipUser }: { skipUser: boolean }) => {
	const teams = await idb.cache.teams.getAll();
	for (const t of teams) {
		if (skipUser && t.tid === g.get("userTid")) {
			continue;
		}
		const staff = await getTeamStaff(t.tid);
		for (const role of COACH_ROLES) {
			assert.isDefined(staff[role], `${t.abbrev} ${role}`);
		}
		const all = await idb.cache.coaches.indexGetAll("coachesByTid", t.tid);
		assert.strictEqual(all.length, 4, t.abbrev);
	}
};

describe("coaching staff", () => {
	beforeEach(async () => {
		await setup();
	});

	test("does nothing when disabled", async () => {
		await setup(false);
		assert.isFalse(await ensureStaff());
		assert.strictEqual((await idb.cache.coaches.getAll()).length, 0);
		assert.isUndefined(await getTeamCoachStyle(0));
		assert.deepEqual(await getCoachingCarousel(g.get("season")), []);
	});

	test("generates a full staff for every team, with a free agent pool", async () => {
		assert.isTrue(await ensureStaff());
		await assertFullStaffs({ skipUser: false });

		// Second call is a no-op
		assert.isFalse(await ensureStaff());

		const coaches = await idb.cache.coaches.getAll();
		const fas = coaches.filter((c) => c.tid === COACH_FREE_AGENT);
		assert.isAbove(fas.length, 20);

		for (const c of coaches) {
			assert.isString(c.firstName);
			assert.isAbove(c.contract.amount, 0);
			assert.isAtLeast(c.contract.exp, g.get("season"));
			for (const value of Object.values(c.ratings)) {
				assert.isAtLeast(value, 1);
				assert.isAtMost(value, 100);
			}
			for (const value of Object.values(c.style)) {
				assert.isAtLeast(value, -1);
				assert.isAtMost(value, 1);
			}
			// Initial hires are not a coaching carousel
			assert.strictEqual(c.transactions.length, 0);
		}

		// Budget level follows the staff, including the initial budget used to impute past seasons
		for (const t of await idb.cache.teams.getAll()) {
			const level = await getStaffLevel(t.tid);
			assert.strictEqual(t.budget.coaching, level);
			assert.strictEqual(t.initialBudget.coaching, level);
		}

		// Staff payroll is similar to the default coaching budget expense
		let total = 0;
		const teams = await idb.cache.teams.getAll();
		for (const t of teams) {
			total += await getStaffPayroll(t.tid);
		}
		const avg = total / teams.length;
		assert.isAbove(avg, 12000);
		assert.isBelow(avg, 26000);

		assert.isDefined(await getTeamCoachStyle(0));
	});

	test("offseason market records seasons, awards Coach of the Year, and refills AI staffs", async () => {
		await ensureStaff();
		const season = g.get("season");

		// Make the user's head coach expire, so it leaves unless extended
		const userStaff = await getTeamStaff(g.get("userTid"));
		userStaff.head!.contract.exp = season;
		await idb.cache.coaches.put(userStaff.head!);

		await finishSeason();
		await runOffseason();

		const coaches = await idb.cache.coaches.getAll();
		const coy = coaches.filter((c) =>
			c.awards.some((a) => a.season === season && a.type === COACH_OF_THE_YEAR),
		);
		assert.strictEqual(coy.length, 1);

		// Everyone who was on a team at season end has a record row
		const withStats = coaches.filter((c) =>
			c.stats.some((row) => row.season === season),
		);
		assert.isAtLeast(withStats.length, g.get("numActiveTeams") * 4);

		await assertFullStaffs({ skipUser: true });

		const userHead = await idb.cache.coaches.get(userStaff.head!.cid);
		assert.notStrictEqual(userHead!.tid, g.get("userTid"));
		assert.strictEqual((await getTeamStaff(g.get("userTid"))).head, undefined);

		// Preseason fills the user's vacancy
		await nextSeason();
		await assertFullStaffs({ skipUser: false });
	});

	test("user can hire, fire (paying a buyout) and extend", async () => {
		await ensureStaff();
		const tid = g.get("userTid");
		const t = (await idb.cache.teams.get(tid))!;
		await idb.cache.teamSeasons.add(team.genSeasonRow(t));

		const staff = await getTeamStaff(tid);
		const dev = staff.dev!;
		const cashBefore = (await idb.cache.teamSeasons.indexGet(
			"teamSeasonsBySeasonTid",
			[g.get("season"), tid],
		))!.cash;
		const buyout = await userFire({ cid: dev.cid, tid });
		assert.isAbove(buyout, 0);
		const cashAfter = (await idb.cache.teamSeasons.indexGet(
			"teamSeasonsBySeasonTid",
			[g.get("season"), tid],
		))!.cash;
		assert.strictEqual(cashBefore - cashAfter, buyout);
		assert.isUndefined((await getTeamStaff(tid)).dev);

		const best = (await idb.cache.coaches.getAll())
			.filter((c) => c.tid === COACH_FREE_AGENT && c.cid !== dev.cid)
			.sort((a, b) => b.ratings.dev - a.ratings.dev)[0]!;
		await userHire({ cid: best.cid, role: "dev", years: 2, tid });
		const hired = (await getTeamStaff(tid)).dev!;
		assert.strictEqual(hired.cid, best.cid);
		assert.strictEqual(hired.contract.exp, g.get("season") + 1);
		assert.strictEqual(
			(await idb.cache.teams.get(tid))!.budget.coaching,
			await getStaffLevel(tid),
		);

		// Can't double up a job
		let threw = false;
		try {
			await userHire({ cid: dev.cid, role: "dev", years: 2, tid });
		} catch {
			threw = true;
		}
		assert.isTrue(threw);

		await userExtend({ cid: hired.cid, tid, years: 3 });
		assert.strictEqual(
			(await idb.cache.coaches.get(hired.cid))!.contract.exp,
			g.get("season") + 4,
		);

		const carousel = await getCoachingCarousel(g.get("season"));
		assert.isTrue(
			carousel.some((m) => m.type === "fired" && m.cid === dev.cid),
		);
		assert.isTrue(
			carousel.some((m) => m.type === "hired" && m.cid === best.cid),
		);
	});

	test("a coach hired during the season gets only the games he coached", async () => {
		await ensureStaff();
		const tid = g.get("userTid");
		const t = (await idb.cache.teams.get(tid))!;
		const ts = team.genSeasonRow(t);
		ts.won = 10;
		ts.lost = 20;
		await idb.cache.teamSeasons.add(ts);

		const old = (await getTeamStaff(tid)).off!;
		await userFire({ cid: old.cid, tid });
		const fired = (await idb.cache.coaches.get(old.cid))!;
		const firedRow = fired.stats.find((r) => r.season === g.get("season"))!;
		assert.strictEqual(firedRow.won, 10);
		assert.strictEqual(firedRow.lost, 20);

		const next = (await idb.cache.coaches.getAll()).find(
			(c) => c.tid === COACH_FREE_AGENT && c.cid !== old.cid,
		)!;
		await userHire({ cid: next.cid, role: "off", years: 2, tid });

		ts.won = 40;
		ts.lost = 42;
		await idb.cache.teamSeasons.put(ts);
		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
		for (const t2 of await idb.cache.teams.getAll()) {
			if (t2.tid !== tid) {
				await idb.cache.teamSeasons.add(team.genSeasonRow(t2));
			}
		}
		await runOffseason();
		const row = (await idb.cache.coaches.get(next.cid))!.stats.find(
			(r) => r.season === g.get("season"),
		)!;
		assert.strictEqual(row.won, 30);
		assert.strictEqual(row.lost, 22);
	});
});

// Over many simulated offseasons, the staff-based coaching levels should give about the same league-wide development as the default AI coaching budgets do, with a similar spread between teams
describe("coaching staff development calibration", () => {
	test("league-wide progression stays realistic over simulated seasons", async () => {
		await setup();
		await ensureStaff();

		const NUM_SEASONS = 12;
		const staffEffects: number[] = [];
		const budgetEffects: number[] = [];
		const staffChanges: number[] = [];
		const budgetChanges: number[] = [];

		for (let i = 0; i < NUM_SEASONS; i++) {
			await finishSeason();
			await runOffseason();
			await nextSeason();

			const teams = (await idb.cache.teams.getAll()) as Team[];
			const popRanks = helpers.getPopRanks(teams);
			for (const [j, t] of teams.entries()) {
				const staffLevel = await getStaffLevel(t.tid);
				const budgetLevel = finances.defaultBudgetLevel(popRanks[j]!);
				staffEffects.push(levelToEffect(staffLevel));
				budgetEffects.push(levelToEffect(budgetLevel));

				// Same young players developed under both levels
				for (let k = 0; k < 6; k++) {
					const p = player.generate(
						t.tid,
						21,
						g.get("season") - 21,
						true,
						DEFAULT_LEVEL,
					);
					await player.develop(p, 0);
					const ovr0 = p.ratings[0].ovr;
					const p1 = structuredClone(p);
					const p2 = structuredClone(p);
					await player.develop(p1, 1, false, staffLevel);
					await player.develop(p2, 1, false, budgetLevel);
					staffChanges.push(p1.ratings[0].ovr - ovr0);
					budgetChanges.push(p2.ratings[0].ovr - ovr0);
				}
			}

			// No team is ever left without a staff
			await assertFullStaffs({ skipUser: false });
		}

		const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
		const sd = (xs: number[]) => {
			const m = mean(xs);
			return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
		};

		const staffMean = mean(staffEffects);
		const budgetMean = mean(budgetEffects);
		console.log("staff effect mean/sd", staffMean, sd(staffEffects));
		console.log("budget effect mean/sd", budgetMean, sd(budgetEffects));
		console.log(
			"ovr change staff/budget",
			mean(staffChanges),
			mean(budgetChanges),
		);

		// Average team is close to the neutral level, like AI budgets
		assert.isBelow(Math.abs(staffMean - budgetMean), 0.2);
		// Spread across teams is similar to budgets (budgets are a bit wider since they're tied to market size)
		assert.isAbove(sd(staffEffects), 0.25);
		assert.isBelow(sd(staffEffects), sd(budgetEffects) * 1.3);
		// League-wide progression is about the same
		assert.isBelow(Math.abs(mean(staffChanges) - mean(budgetChanges)), 0.3);

		// The market keeps working: a Coach of the Year every season, and a carousel
		const coy = (await idb.cache.coaches.getAll()).flatMap((c) =>
			c.awards.filter((a) => a.type === COACH_OF_THE_YEAR),
		);
		assert.strictEqual(coy.length, NUM_SEASONS);
		const pool = (await idb.cache.coaches.getAll()).filter(
			(c) => c.tid === COACH_FREE_AGENT,
		);
		assert.isAbove(pool.length, 10);
	}, 120_000);

	test("league-average development effect doesn't drift over decades (rating inflation)", async () => {
		await ensureStaff();
		const yearlyMeans: number[] = [];
		for (let i = 0; i < 30; i++) {
			const effects: number[] = [];
			for (const t of await idb.cache.teams.getAll()) {
				effects.push(levelToEffect(await getStaffLevel(t.tid)));
			}
			yearlyMeans.push(effects.reduce((a, b) => a + b, 0) / effects.length);
			await finishSeason();
			await runOffseason();
			await nextSeason();
		}
		// With a fixed reference, the mean started around -0.2 and climbed to +0.2 after ~20 seasons, as the coach pool's
		// ratings drifted. Normalized by the league average staff, it stays centered (like AI coaching budgets).
		for (const m of yearlyMeans) {
			assert.isBelow(Math.abs(m), 0.08);
		}
	}, 120_000);
});
