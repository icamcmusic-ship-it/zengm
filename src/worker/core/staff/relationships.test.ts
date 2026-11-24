// Player–coach relationships: the season update, mood component and development plan boost
import { afterAll, assert, beforeEach, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import {
	relDevBoost,
	relLabel,
	relMood,
	relSeasonDelta,
} from "../../../common/playerCoachRel.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import type { Player } from "../../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import { ensureStaff } from "./index.ts";
import {
	coachRelMood,
	headCoachByTid,
	relDevRatingBoost,
	updateRelationships,
} from "./relationships.ts";

const base = {
	v: 0,
	minutes: 0,
	dev: 0,
	personality: 0,
	traits: [] as string[],
	winp: 0.5,
	noise: 0,
};

const setup = async (on: boolean) => {
	Math.random = makeSeededRandom(9);
	resetG();
	g.setWithoutSavingToDB("coachingStaff", true);
	g.setWithoutSavingToDB("featurePlayerCoachRel" as any, on);
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
	assert.isTrue(await ensureStaff());
	const season = g.get("season");
	for (let i = 0; i < 10; i++) {
		const p = player.generate(0, 22 + i, season, true, 50);
		await player.develop(p, 0);
		await player.updateValues(p);
		p.stats = [
			{
				...(p.stats[0] ?? {}),
				season,
				tid: 0,
				playoffs: false,
				gp: 70,
				// Everyone plays 30 minutes: low-value players play over their role, the best under it
				min: 70 * 30,
			} as any,
		];
		await idb.cache.players.add(p);
	}
};

describe("player–coach relationships", () => {
	const realRandom = Math.random;
	afterAll(() => {
		Math.random = realRandom;
	});
	beforeEach(async () => {
		await setup(true);
	});

	test("pure helpers are bounded and move the right way", () => {
		assert.isAbove(
			relSeasonDelta({ ...base, minutes: 1 }),
			relSeasonDelta(base),
		);
		assert.isBelow(relSeasonDelta({ ...base, minutes: -1 }), 0);
		assert.isAbove(relSeasonDelta({ ...base, dev: 1 }), relSeasonDelta(base));
		// Disciplinarians clash with divas (ego score: high = team-first, low = diva)
		assert.isBelow(
			relSeasonDelta({ ...base, personality: -1, ego: 10 }),
			relSeasonDelta({ ...base, personality: -1, ego: 70 }),
		);
		// Fame players care more about minutes
		assert.isBelow(
			relSeasonDelta({ ...base, minutes: -1, traits: ["F"] }),
			relSeasonDelta({ ...base, minutes: -1 }),
		);
		// One season moves it at most 0.45; it can't leave -1 ... 1
		const extreme = {
			...base,
			minutes: 1,
			dev: 1,
			personality: 1,
			winp: 1,
			noise: 1,
			traits: ["L", "W"],
		};
		assert.isAtMost(relSeasonDelta(extreme), 0.45);
		let v = 0;
		for (let i = 0; i < 30; i++) {
			v = relSeasonDelta({ ...extreme, v });
		}
		assert.isAtMost(v, 1);
		assert.strictEqual(relLabel(v), "Very close");
		assert.strictEqual(relMood(1), 1.5);
		assert.strictEqual(relMood(-1), -1.5);
		assert.strictEqual(relDevBoost(0.5), 4);
	});

	test("the season builds bonds that feed mood and development plans", async () => {
		await updateRelationships();
		const players = (await idb.cache.players.indexGetAll(
			"playersByTid",
			0,
		)) as Player[];
		const heads = await headCoachByTid();
		const cid = heads.get(0)!;
		assert.isDefined(cid);
		for (const p of players) {
			assert.strictEqual(p.coachRels?.length, 1);
			assert.strictEqual(p.coachRels![0]!.cid, cid);
			assert.strictEqual(p.coachRels![0]!.n, 1);
		}
		// Running it twice in a season does nothing
		const before = players.map((p) => p.coachRels![0]!.v);
		await updateRelationships();
		assert.deepEqual(
			players.map((p) => p.coachRels![0]!.v),
			before,
		);
		// Bench players who played 30 minutes are happier than stars who played 30
		const sorted = players.toSorted((a, b) => b.valueNoPot - a.valueNoPot);
		assert.isAbove(
			sorted.at(-1)!.coachRels![0]!.v,
			sorted[0]!.coachRels![0]!.v,
		);
		const p = sorted.at(-1)!;
		const mood = await coachRelMood(p, 0);
		assert.closeTo(mood, relMood(p.coachRels![0]!.v), 1e-9);
		// Only with that coach's team
		assert.strictEqual(await coachRelMood(p, 1), 0);
		assert.closeTo(
			relDevRatingBoost(p, heads),
			relDevBoost(p.coachRels![0]!.v),
			1e-9,
		);
	});

	test("does nothing when off", async () => {
		await setup(false);
		await updateRelationships();
		const players = (await idb.cache.players.indexGetAll(
			"playersByTid",
			0,
		)) as Player[];
		assert.isTrue(players.every((p) => p.coachRels === undefined));
		assert.strictEqual((await headCoachByTid()).size, 0);
		assert.strictEqual(await coachRelMood(players[0]!, 0), 0);
	});
});
