import { afterAll, assert, beforeAll, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import player from "../player/index.ts";
import {
	boostRatingsTo,
	isUnretireEligible,
	rollUnretirement,
	unretireAtPhase,
} from "./unretire.ts";

const makeRetired = (age: number, ovr = 50) => {
	const p = player.generate(
		PLAYER.RETIRED,
		25,
		g.get("season") - 15,
		true,
		DEFAULT_LEVEL,
	);
	p.born.year = g.get("season") - 1 - age;
	p.retiredYear = g.get("season") - 1;
	const r = p.ratings.at(-1)!;
	r.season = g.get("season") - 1;
	r.ovr = ovr;
	return p;
};

beforeAll(() => {
	resetG();
	idb.league = mockIDBLeague();
});
afterAll(() => {
	// @ts-expect-error
	idb.league = undefined;
});

describe("Unretirements", () => {
	test("eligibility: retired, alive, old enough, never came back", () => {
		const p = makeRetired(36);
		assert(isUnretireEligible(p, 35));
		assert(!isUnretireEligible(p, 37));
		assert(!isUnretireEligible({ ...p, diedYear: 2010 }, 35));
		assert(!isUnretireEligible({ ...p, tid: PLAYER.FREE_AGENT }, 35));
		assert(!isUnretireEligible({ ...p, unretired: 2014 }, 35));
		assert(!isUnretireEligible({ ...p, unretiredByScript: true }, 35));
	});

	test("boost raises non-height ratings until ovr reaches the target", () => {
		const ratings: Record<string, number> = {
			hgt: 40,
			stre: 40,
			spd: 40,
			jmp: 40,
			endu: 40,
			ins: 40,
			dnk: 40,
			ft: 40,
			fg: 40,
			tp: 40,
			oiq: 40,
			diq: 40,
			drb: 40,
			pss: 40,
			reb: 40,
		};
		const target = player.ovr(ratings as any) + 5;
		boostRatingsTo(ratings, target, player.ovr as any);
		assert(player.ovr(ratings as any) >= target);
		assert.strictEqual(ratings.hgt, 40);
		for (const value of Object.values(ratings)) {
			assert(value <= 100);
		}
	});

	test("a forced roll brings an eligible player back as a free agent with a boost", async () => {
		const young = makeRetired(30);
		const old = makeRetired(38, 55);
		const oldOvrBefore = old.ratings.at(-1)!.ovr;
		await resetCache({ players: [young, old] });
		Object.assign(g, {
			featureUnretire: true,
			unretireMinAge: 35,
			unretireBoostMin: 3,
			unretireBoostMax: 3,
		});

		const result = await rollUnretirement({ force: true });
		assert(result);
		assert.strictEqual(result.pid, old.pid);
		const p = (await idb.cache.players.get(old.pid))!;
		assert.strictEqual(p.tid, PLAYER.FREE_AGENT);
		assert.strictEqual(p.retiredYear, Infinity);
		assert.strictEqual((p as any).unretired, g.get("season"));
		assert.strictEqual(p.ratings.at(-1)!.season, g.get("season"));
		assert(p.ratings.at(-1)!.ovr >= oldOvrBefore + 3 - 1);

		// Nobody else is eligible now
		assert.strictEqual(await rollUnretirement({ force: true }), undefined);
	});

	test("the phase hook does nothing while the feature is off or the chance is 0", async () => {
		const p = makeRetired(40);
		await resetCache({ players: [p] });
		Object.assign(g, { featureUnretire: false, unretireChance: 100 });
		await unretireAtPhase(PHASE.FREE_AGENCY);
		assert.strictEqual(
			(await idb.cache.players.get(p.pid))!.tid,
			PLAYER.RETIRED,
		);

		Object.assign(g, { featureUnretire: true, unretireChance: 0 });
		await unretireAtPhase(PHASE.FREE_AGENCY);
		assert.strictEqual(
			(await idb.cache.players.get(p.pid))!.tid,
			PLAYER.RETIRED,
		);

		Object.assign(g, { unretireChance: 100 });
		await unretireAtPhase(PHASE.DRAFT);
		assert.strictEqual(
			(await idb.cache.players.get(p.pid))!.tid,
			PLAYER.RETIRED,
		);

		await unretireAtPhase(PHASE.FREE_AGENCY);
		assert.strictEqual(
			(await idb.cache.players.get(p.pid))!.tid,
			PLAYER.FREE_AGENT,
		);
	});
});
