import { assert, beforeAll, describe, test } from "vitest";
import { player, team } from "../index.ts";
import { g, helpers } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { idb } from "../../db/index.ts";
import {
	getTieredBadgeCutoffs,
	simTiers,
	tieredBadgesForPlayer,
	updateTieredBadges,
} from "./tieredBadges.ts";
import {
	TIERED_BADGES,
	badgePointCap,
	badgePoints,
	entryForSeason,
} from "../../../common/tieredBadges/index.ts";

const NUM_TEAMS = 30;

describe("2K Badges in a league", () => {
	beforeAll(async () => {
		const original = Math.random;
		Math.random = makeSeededRandom(42);
		try {
			resetG();
			g.setWithoutSavingToDB("season", 2025);
			g.setWithoutSavingToDB("numActiveTeams", NUM_TEAMS);
			g.setWithoutSavingToDB("featureTwoKBadges" as any, true);
			const teamsDefault = helpers.getTeamsDefault().slice(0, NUM_TEAMS);
			const players = range(NUM_TEAMS).flatMap((tid) =>
				range(13).map(() =>
					player.generate(tid, 19 + (tid % 12), 2024, true, DEFAULT_LEVEL),
				),
			);
			await resetCache({
				players,
				teams: teamsDefault.map(team.generate),
			});
		} finally {
			Math.random = original;
		}
		await updateTieredBadges();
	});

	test("cutoffs are saved for the season, from the rotation players", () => {
		const cutoffs = getTieredBadgeCutoffs(2025);
		assert.isDefined(cutoffs);
		assert.strictEqual(cutoffs!.n, NUM_TEAMS * 10);
		assert.strictEqual(Object.keys(cutoffs!.c).length, TIERED_BADGES.length);
	});

	test("every player has an entry, within his point cap (or one tier of last season), at most one Legend per badge", async () => {
		const players = await idb.cache.players.getAll();
		const legends: Record<string, number> = {};
		let holders = 0;
		for (const p of players) {
			const entry = entryForSeason(p.badges2k, 2025);
			assert.isDefined(entry);
			const r = p.ratings.at(-1)!;
			assert.isAtMost(badgePoints(entry!.t), badgePointCap(r.ovr));
			for (const [key, tier] of Object.entries(entry!.t)) {
				if (tier === 5) {
					legends[key] = (legends[key] ?? 0) + 1;
				}
			}
			if (Object.keys(entry!.t).length > 0) {
				holders++;
			}
		}
		for (const n of Object.values(legends)) {
			assert.strictEqual(n, 1);
		}
		assert.isAbove(holders, players.length / 4);
	});

	test("next season: no badge drops more than one tier, and the history keeps both seasons", async () => {
		const before = new Map(
			(await idb.cache.players.getAll()).map((p) => [
				p.pid,
				{ ...entryForSeason(p.badges2k, 2025)!.t },
			]),
		);
		g.setWithoutSavingToDB("season", 2026);
		const original = Math.random;
		Math.random = makeSeededRandom(7);
		try {
			for (const p of await idb.cache.players.getAll()) {
				// A new ratings row, developed (some decline a lot)
				player.addRatingsRow(p, DEFAULT_LEVEL);
				await player.develop(p, 1);
				await player.updateValues(p);
				await idb.cache.players.put(p);
			}
		} finally {
			Math.random = original;
		}
		await updateTieredBadges();
		for (const p of await idb.cache.players.getAll()) {
			assert.strictEqual(p.badges2k!.length, 2);
			const now = entryForSeason(p.badges2k, 2026)!.t;
			for (const [key, tier] of Object.entries(before.get(p.pid)!)) {
				assert.isAtLeast(now[key] ?? 0, tier - 1, `${p.pid} ${key}`);
			}
		}
	});

	test("sim tiers and the player page info", async () => {
		const players = await idb.cache.players.getAll();
		const numBadges = (p: (typeof players)[number]) =>
			Object.keys(entryForSeason(p.badges2k, 2026)!.t).length;
		const p = players.reduce((a, b) => (numBadges(b) > numBadges(a) ? b : a));

		const bt = simTiers(p)!;
		assert.strictEqual(bt.length, TIERED_BADGES.length);
		assert.strictEqual(bt.filter((x) => x > 0).length, numBadges(p));
		const info = (await tieredBadgesForPlayer(p, false))!;
		assert.isFalse(info.live);
		assert.isAbove(info.categories.length, 0);
		const badge = info.categories[0]!.badges[0]!;
		assert.isDefined(badge.drivers[0]!.value);
		// No visible ratings: badges, but no numbers
		const hidden = (await tieredBadgesForPlayer(p, true))!;
		const badge2 = hidden.categories[0]!.badges[0]!;
		assert.strictEqual(badge2.key, badge.key);
		assert.isUndefined(badge2.score);
		assert.isUndefined(badge2.progress);
		assert.isUndefined(badge2.drivers[0]!.value);
		assert.isUndefined(hidden.cap);
	});
});
