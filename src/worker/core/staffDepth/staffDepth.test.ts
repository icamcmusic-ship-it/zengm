// Coaching Staff Depth / Scouting Director & Regions fixes: AI spending on the newer jobs, safe suggested hires, development plans in
// Suggest mode, contraction releasing coaches, scouts keeping their attributes when they move up, departure news
import { afterAll, assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	AI_SPEND_REFERENCE_RATINGS,
	COACH_FREE_AGENT,
	coachSalaryDemand,
} from "../../../common/staff.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import {
	ensureStaff,
	fire,
	getTeamStaff,
	releaseTeamCoaches,
} from "../staff/index.ts";
import { applyStaffAction } from "./actions.ts";
import { planFor, stateOf } from "./coaching.ts";
import { directorFor } from "./scouting.ts";

const setup = async () => {
	Math.random = makeSeededRandom(21);
	resetG();
	g.setWithoutSavingToDB("coachingStaff", true);
	g.setWithoutSavingToDB("featureCoachingDepth" as any, true);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
	assert.isTrue(await ensureStaff());
};

describe("coaching staff depth", () => {
	const realRandom = Math.random;
	afterAll(() => {
		Math.random = realRandom;
	});
	beforeEach(async () => {
		await setup();
	});

	test("AI teams budget for good coaches in the newer jobs, like the original ones", () => {
		const salaryCap = g.get("salaryCap");
		for (const role of ["shoot", "sc", "video"] as const) {
			// A coach rated 60 at the job costs what the reference costs
			const at60 = coachSalaryDemand(
				{ dev: 60, off: 60, def: 60, mot: 60, sht: 60, cnd: 60, vid: 60 },
				role,
				salaryCap,
			);
			assert.strictEqual(
				coachSalaryDemand(AI_SPEND_REFERENCE_RATINGS, role, salaryCap),
				at60,
			);
			// The old reference (no job ratings, read as 40) was far below that
			const old = coachSalaryDemand(
				{ dev: 60, off: 60, def: 60, mot: 60 },
				role,
				salaryCap,
			);
			assert.isBelow(old, 0.6 * at60, role);
		}
	});

	test("AI staffs in the newer jobs are not capped around 52", async () => {
		const coaches = await idb.cache.coaches.getAll();
		const shooters = coaches.filter((c) => c.tid >= 0 && c.role === "shoot");
		assert.isAbove(shooters.length, 0);
		const best = Math.max(...shooters.map((c) => c.ratings.sht ?? 0));
		assert.isAbove(best, 55);
	});

	test("a suggested hire that fails leaves the current coach in place, without a buyout", async () => {
		const tid = g.get("userTid");
		const before = (await getTeamStaff(tid)).sc!;
		// A coach employed elsewhere can't be hired
		const other = (await idb.cache.coaches.getAll()).find(
			(c) => c.tid >= 0 && c.tid !== tid && c.role === "sc",
		)!;
		const ts = team.genSeasonRow(
			(await idb.cache.teams.get(tid))!,
			undefined,
			g.get("season"),
		);
		await idb.cache.teamSeasons.add(ts);
		let threw = false;
		try {
			await applyStaffAction({ type: "hire", cid: other.cid, role: "sc" });
		} catch {
			threw = true;
		}
		assert.isTrue(threw);
		const after = (await getTeamStaff(tid)).sc!;
		assert.strictEqual(after.cid, before.cid);
		assert.isFalse(after.transactions.some((tx) => tx.type === "fired"));
		const ts2 = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			g.get("season"),
			tid,
		]);
		assert.strictEqual(ts2!.expenses.coaching, ts.expenses.coaching);
	});

	test("a suggested hire that works replaces the coach (hired, then the old one fired)", async () => {
		const tid = g.get("userTid");
		const before = (await getTeamStaff(tid)).sc!;
		const fa = (await idb.cache.coaches.getAll()).find(
			(c) => c.tid === COACH_FREE_AGENT,
		)!;
		await applyStaffAction({ type: "hire", cid: fa.cid, role: "sc" });
		const staff = await getTeamStaff(tid);
		assert.strictEqual(staff.sc!.cid, fa.cid);
		const old = (await idb.cache.coaches.get(before.cid))!;
		assert.strictEqual(old.tid, COACH_FREE_AGENT);
		assert.strictEqual(old.transactions.at(-1)!.type, "fired");
		const sc = (await idb.cache.coaches.getAll()).filter(
			(c) => c.tid === tid && c.role === "sc",
		);
		assert.strictEqual(sc.length, 1);
	});

	test("Suggest mode gives a plan to players with none approved (draftees, signings, trades)", async () => {
		const tid = g.get("userTid");
		const p = player.generate(tid, 20, g.get("season"), true, 50);
		const t = (await idb.cache.teams.get(tid))!;
		const state = stateOf(t);
		state.delegation.development = "suggest";
		const plan = planFor(p, g.get("season") + 1, state);
		assert.isDefined(plan);
		assert.strictEqual(plan!.src, "staff");
		// Manual still means none
		state.delegation.development = "manual";
		assert.isUndefined(planFor(p, g.get("season") + 1, state));
		// Free agents have none
		p.tid = PLAYER.FREE_AGENT;
		state.delegation.development = "suggest";
		assert.isUndefined(planFor(p, g.get("season") + 1, state));
	});

	test("a contracted team's coaches go back on the market", async () => {
		const tid = 3;
		const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
		assert.isAbove(coaches.length, 0);
		const t = (await idb.cache.teams.get(tid))!;
		t.disabled = true;
		await idb.cache.teams.put(t);
		await releaseTeamCoaches(tid);
		assert.strictEqual(
			(await idb.cache.coaches.indexGetAll("coachesByTid", tid)).length,
			0,
		);
		for (const c of coaches) {
			const c2 = (await idb.cache.coaches.get(c.cid))!;
			assert.strictEqual(c2.tid, COACH_FREE_AGENT);
			assert.strictEqual(c2.transactions.at(-1)!.type, "left");
		}
	});

	test("an assistant leaving is in the news", async () => {
		const tid = g.get("userTid");
		const sc = (await getTeamStaff(tid)).sc!;
		const events: string[] = [];
		const realAdd = idb.cache.events.add.bind(idb.cache.events);
		(idb.cache.events as any).add = (e: any) => {
			events.push(e.text);
			return realAdd(e);
		};
		try {
			await fire(sc);
		} finally {
			(idb.cache.events as any).add = realAdd;
		}
		assert.isTrue(
			events.some((text) => text.includes("was fired by")),
			events.join("\n"),
		);
	});
});

describe("scout careers", () => {
	test("a promoted or poached scout keeps his quality and age", () => {
		resetG();
		const season = g.get("season");
		const t = {
			tid: 0,
			scoutCareer: {
				cuts: {},
				dirs: [
					{
						id: 12345,
						since: season,
						how: "poached" as const,
						q: 0.83,
						age: 51,
					},
				],
				rep: {},
				ourGuys: [],
				log: [],
			},
		} as any;
		// A low budget level would make a new hire worse, he keeps his own quality
		const s = directorFor(t, season, 1);
		assert.strictEqual(s.age, 51);
		assert.closeTo(s.quality, 0.83, 1e-9);
		const later = directorFor(t, season + 3, 1);
		assert.strictEqual(later.age, 54);
		assert.isAbove(later.quality, 0.83);
	});
});
