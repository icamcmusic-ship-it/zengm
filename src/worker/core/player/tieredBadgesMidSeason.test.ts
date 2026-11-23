// 2K badges for a player who enters the league mid-season (import, God Mode create or clone): stored against the season's cutoffs, so
// he has sim badges and pills, without a second Legend
import { assert, beforeAll, describe, test } from "vitest";
import { player, team } from "../index.ts";
import { g, helpers } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PLAYER } from "../../../common/constants.ts";
import { range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { idb } from "../../db/index.ts";
import {
	refreshTieredBadgesFor,
	simTiers,
	tieredBadgesForPlayer,
	updateTieredBadges,
} from "./tieredBadges.ts";
import {
	displayTiersOf,
	entryForSeason,
} from "../../../common/tieredBadges/index.ts";
import type { Player } from "../../../common/types.ts";

const NUM_TEAMS = 30;
const SEASON = 2025;

const legendCounts = async (shown: boolean) => {
	const counts: Record<string, number> = {};
	for (const p of await idb.cache.players.getAll()) {
		const e = entryForSeason(p.badges2k, SEASON);
		if (!e) {
			continue;
		}
		for (const [key, tier] of Object.entries(shown ? displayTiersOf(e) : e.t)) {
			if (tier === 5) {
				counts[key] = (counts[key] ?? 0) + 1;
			}
		}
	}
	return counts;
};

describe("2K badges for a player added mid-season", () => {
	beforeAll(async () => {
		const original = Math.random;
		Math.random = makeSeededRandom(7);
		try {
			resetG();
			g.setWithoutSavingToDB("season", SEASON);
			g.setWithoutSavingToDB("numActiveTeams", NUM_TEAMS);
			const teamsDefault = helpers.getTeamsDefault().slice(0, NUM_TEAMS);
			const players = range(NUM_TEAMS).flatMap((tid) =>
				range(13).map(() =>
					player.generate(
						tid,
						19 + (tid % 12),
						SEASON - 1,
						true,
						DEFAULT_LEVEL,
					),
				),
			);
			// A superstar, so some badges have a Legend
			const star = players[0]!;
			const r = star.ratings.at(-1)! as any;
			for (const key of Object.keys(r)) {
				if (
					typeof r[key] === "number" &&
					!["hgt", "season", "fuzz", "ovr", "pot"].includes(key)
				) {
					r[key] = 100;
				}
			}
			await player.develop(star, 0);
			await resetCache({
				players,
				teams: teamsDefault.map(team.generate),
			});
		} finally {
			Math.random = original;
		}
		await updateTieredBadges();
	});

	test("a new player gets this season's tiers, and a copy of a Legend holder doesn't make a second Legend", async () => {
		const before = await legendCounts(false);
		assert.isAbove(Object.keys(before).length, 0);

		// A copy of a Legend holder: same ratings, so the same scores, entering mid-season (like an import or a God Mode clone)
		const holder = (await idb.cache.players.getAll()).find((p) =>
			Object.values(entryForSeason(p.badges2k, SEASON)!.t).includes(5),
		)!;
		const copy = helpers.deepCopy(holder) as Partial<Player>;
		delete copy.pid;
		delete copy.badges2k;
		copy.tid = 3;
		await idb.cache.players.put(copy as Player);
		const p = copy as Player;
		assert.isUndefined(simTiers(p));

		assert.isTrue(await refreshTieredBadgesFor(p));
		const entry = entryForSeason(p.badges2k, SEASON);
		assert.isDefined(entry);
		assert.isDefined(simTiers(p));
		// His badges are the holder's, with Hall of Fame where the holder has Legend
		const holderTiers = entryForSeason(holder.badges2k, SEASON)!.t;
		for (const [key, tier] of Object.entries(holderTiers)) {
			assert.strictEqual(entry!.t[key], tier === 5 ? 4 : tier, key);
		}
		assert.deepEqual(await legendCounts(false), before);
		for (const n of Object.values(await legendCounts(true))) {
			assert.strictEqual(n, 1);
		}

		// The player page reads the stored entry, not a live one
		const view = await tieredBadgesForPlayer(p, false);
		assert.isFalse(view!.live);
		assert.isAbove(view!.earned.length, 0);
	});

	test("no entry for draft prospects or retired players, nor without cutoffs", async () => {
		const prospect = player.generate(
			PLAYER.UNDRAFTED,
			19,
			SEASON,
			false,
			DEFAULT_LEVEL,
		);
		await idb.cache.players.put(prospect);
		assert.isFalse(await refreshTieredBadgesFor(prospect as Player));
		assert.isUndefined(prospect.badges2k);

		const p = player.generate(3, 25, SEASON, true, DEFAULT_LEVEL);
		await idb.cache.players.put(p);
		g.setWithoutSavingToDB("season", SEASON + 1);
		try {
			assert.isFalse(await refreshTieredBadgesFor(p as Player));
		} finally {
			g.setWithoutSavingToDB("season", SEASON);
		}
	});
});
