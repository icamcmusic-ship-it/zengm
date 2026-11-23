// Coaching trees: systems carried from a mentor, and familiarity speeding up installation
import { afterAll, assert, beforeEach, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import {
	FAMILIARITY_START,
	INSTALL_START,
	installAfterGames,
	systemFamiliarity,
} from "../../../common/coachSystems.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { COACH_FREE_AGENT } from "../../../common/staff.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { team } from "../index.ts";
import { ensureStaff, fire, hire } from "./index.ts";
import { getCoachProfile } from "./systems.ts";

describe("coaching tree familiarity", () => {
	const realRandom = Math.random;
	afterAll(() => {
		Math.random = realRandom;
	});
	beforeEach(async () => {
		Math.random = makeSeededRandom(5);
		resetG();
		g.setWithoutSavingToDB("coachingStaff", true);
		g.setWithoutSavingToDB("coachSystems" as any, true);
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		idb.league = mockIDBLeague();
		const teams = helpers.getTeamsDefault().map(team.generate);
		await resetCache({ teams });
		assert.isTrue(await ensureStaff());
	});

	test("familiarity is bounded and ordered", () => {
		const none = systemFamiliarity({
			sameOff: false,
			sameDef: false,
			sameTree: false,
			treeAssistants: 0,
			inherited: 0,
		});
		const all = systemFamiliarity({
			sameOff: true,
			sameDef: true,
			sameTree: true,
			treeAssistants: 5,
			inherited: 2,
		});
		const off = systemFamiliarity({
			sameOff: true,
			sameDef: false,
			sameTree: false,
			treeAssistants: 0,
			inherited: 0,
		});
		assert.strictEqual(none, 0);
		assert.strictEqual(all, 1);
		assert.isAbove(off, none);
		assert.isBelow(off, all);

		// Installation: no familiarity is the old behavior, full familiarity starts higher and finishes sooner, both end at 1
		assert.strictEqual(installAfterGames(0, 82, 0), INSTALL_START);
		assert.closeTo(
			installAfterGames(0, 82, 1),
			INSTALL_START + FAMILIARITY_START,
			1e-9,
		);
		assert.strictEqual(installAfterGames(41, 82, 0), 1);
		assert.strictEqual(installAfterGames(30, 82, 1), 1);
		assert.isBelow(installAfterGames(30, 82, 0), 1);
		for (let gp = 0; gp <= 82; gp += 5) {
			assert.isAtLeast(
				installAfterGames(gp, 82, 0.6),
				installAfterGames(gp, 82, 0),
			);
		}
	});

	test("a head coach hired to replace one with the same systems knows them", async () => {
		const season = g.get("season");
		const coaches = await idb.cache.coaches.getAll();
		const oldHead = coaches.find((c) => c.tid === 0 && c.role === "head")!;
		oldHead.stats.push({
			season: season - 1,
			tid: 0,
			role: "head",
			won: 41,
			lost: 41,
			tied: 0,
			otl: 0,
			playoffRoundsWon: -1,
		});
		await idb.cache.coaches.put(oldHead);
		const oldProfile = getCoachProfile(oldHead);
		const candidate = coaches.find((c) => c.tid === COACH_FREE_AGENT)!;
		candidate.profile = {
			...getCoachProfile(candidate),
			off: oldProfile.off,
			def: oldProfile.def,
		};
		await idb.cache.coaches.put(candidate);
		await fire(oldHead);
		await hire(candidate, 0, "head");
		const hired = (await idb.cache.coaches.get(candidate.cid))!;
		assert.isAtLeast(hired.profile!.familiarity!, 0.6);

		// A different system: lower familiarity
		const other = (await idb.cache.coaches.getAll()).find(
			(c) => c.tid === COACH_FREE_AGENT && c.cid !== candidate.cid,
		)!;
		const op = getCoachProfile(other);
		other.profile = {
			...op,
			off: op.off === oldProfile.off ? "iso" : op.off,
			def: op.def === oldProfile.def ? "zone" : op.def,
		};
		if (other.profile.off === oldProfile.off) {
			other.profile.off = "motion";
		}
		if (other.profile.def === oldProfile.def) {
			other.profile.def = "drop";
		}
		await idb.cache.coaches.put(other);
		await fire(hired);
		await hire(other, 0, "head");
		const hired2 = (await idb.cache.coaches.get(other.cid))!;
		assert.isBelow(hired2.profile!.familiarity!, hired.profile!.familiarity!);
	});
});
