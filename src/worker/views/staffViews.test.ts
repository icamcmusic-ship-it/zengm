// The coaching pages' views (Coaching Staff, Coaches, coach page) in a league with a full staff, with Coaching Systems on and off
import { assert, describe, test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { COACH_FREE_AGENT, COACH_ROLES } from "../../common/staff.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import { player, team } from "../core/index.ts";
import { ensureStaff } from "../core/staff/index.ts";
import * as views from "./index.ts";

const loadView = (id: string, params: Record<string, unknown> = {}) => {
	const view = (views as any)[id];
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	return view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: inputs,
		prevOutput: {},
		conditions: {},
	});
};

const setup = async (coachSystems: boolean) => {
	resetG();
	g.setWithoutSavingToDB("coachingStaff", true);
	g.setWithoutSavingToDB("coachSystems", coachSystems);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
	for (const t of teams) {
		for (let i = 0; i < 10; i++) {
			const p = player.generate(
				t.tid,
				22 + i,
				g.get("season") - 22 - i,
				true,
				50,
			);
			p.injury = { type: "Healthy", gamesRemaining: 0 };
			p.valueNoPot = p.ratings[0].ovr;
			await idb.cache.players.add(p);
		}
	}
	assert.isTrue(await ensureStaff());
};

describe("coaching staff views", () => {
	for (const coachSystems of [true, false]) {
		test(`staff, coaches and coach pages load (coaching systems ${coachSystems ? "on" : "off"})`, async () => {
			await setup(coachSystems);
			const userTid = g.get("userTid");

			const staff = await loadView("staff", {});
			assert.isUndefined(staff.errorMessage);
			assert.strictEqual(staff.tid, userTid);
			assert.isTrue(staff.isUser);
			assert.strictEqual(staff.slots.length, 4);
			assert.strictEqual(staff.coachSystems, coachSystems);
			assert.lengthOf(staff.colors, 3);
			if (coachSystems) {
				assert.isDefined(staff.head);
				assert.isAtLeast(staff.head.fit, 0);
				assert.isAtMost(staff.head.fit, 100);
				assert.isString(staff.head.offenseName);
				assert.isString(staff.head.hotSeatText);
			} else {
				assert.isUndefined(staff.head);
			}
			for (const role of COACH_ROLES) {
				const list = staff.candidates[role];
				assert.isAbove(list.length, 0, role);
				// Every recommendation tag is given once, to the leader
				const tags = list.flatMap((c: any) => c.tags);
				assert.strictEqual(new Set(tags).size, tags.length, role);
				assert.include(tags, "Best overall");
				const best = list.find((c: any) => c.tags.includes("Best overall"));
				assert.strictEqual(best.ovr, Math.max(...list.map((c: any) => c.ovr)));
				if (role === "head") {
					assert.strictEqual(
						tags.includes("Best fit"),
						coachSystems,
						"Best fit only with coaching systems",
					);
					assert.strictEqual(!!list[0].outlook, coachSystems);
				}
				for (const c of list) {
					assert.isAtLeast(c.levelIfHired, 1);
					assert.isAtMost(c.levelIfHired, 100);
				}
			}
			for (const slot of staff.slots) {
				assert.isDefined(slot.coach);
				// A vacant job is never better for development than a hired coach
				assert.isAtMost(slot.coach.levelIfVacant, staff.level);
			}

			// Another team's staff: no market
			const other = await loadView("staff", {
				team: `${g.get("teamInfoCache")[1]!.abbrev}_1`,
			});
			assert.isFalse(other.isUser);
			assert.strictEqual(other.candidates.head.length, 0);

			const coaches = await loadView("coaches", {});
			assert.isUndefined(coaches.errorMessage);
			const heads = coaches.rows.filter((r: any) => r.status === "head");
			assert.strictEqual(heads.length, g.get("numActiveTeams"));
			assert.isAbove(
				coaches.rows.filter((r: any) => r.status === "available").length,
				0,
			);
			assert.strictEqual(
				coaches.rows.filter((r: any) => r.status === "assistant").length,
				3 * g.get("numActiveTeams"),
			);
			for (const r of heads) {
				assert.strictEqual(!!r.offenseName, coachSystems);
				assert.strictEqual(r.hotSeatText !== "", coachSystems);
			}

			const cid = staff.slots[0].coach.cid;
			const coach = await loadView("coach", { cid: String(cid) });
			assert.strictEqual(coach.coach.cid, cid);
			assert.lengthOf(coach.colors, 3);
			const fa = (await idb.cache.coaches.getAll()).find(
				(c) => c.tid === COACH_FREE_AGENT,
			)!;
			const faPage = await loadView("coach", { cid: String(fa.cid) });
			assert.isUndefined(faPage.colors);
		});
	}

	test("pages say how to turn the coaching staff on", async () => {
		resetG();
		g.setWithoutSavingToDB("coachingStaff", false);
		idb.league = mockIDBLeague();
		await resetCache({ teams: helpers.getTeamsDefault().map(team.generate) });
		for (const id of ["staff", "coaches"]) {
			const out = await loadView(id, {});
			assert.include(out.errorMessage, "League Extras");
		}
	});
});
