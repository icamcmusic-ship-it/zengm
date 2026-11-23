import { assert, describe, test } from "vitest";
import {
	CATEGORIES,
	TIERED_BADGES,
	assignTiers,
	badgePointCap,
	badgePoints,
	badgeToken,
	badgeWhyLine,
	computeCutoffs,
	enforceLegendLimit,
	parseBadgeToken,
	progressToNext,
	quantileSorted,
	sortedBadges,
	tbValue,
	tierOfScore,
	tieredBadgeScore,
	withTierEntry,
	type Tier,
} from "../tieredBadges/index.ts";
import { NUM_SUBS, SUB_INDEX } from "../subRatings.ts";
import { makeSeededRandom } from "../random.ts";

const BASE = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
];

const genRows = (n: number, seed: number, withSubs: boolean) => {
	const rand = makeSeededRandom(seed);
	const normal = () => {
		const u = Math.max(rand(), 1e-9);
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
	};
	const bound = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
	return Array.from({ length: n }, () => {
		const r: Record<string, any> = {};
		for (const k of BASE) {
			r[k] = bound(48 + 13 * normal());
		}
		r.ovr = bound(50 + 9 * normal());
		if (withSubs) {
			r.sub = Array.from({ length: NUM_SUBS }, () => bound(48 + 14 * normal()));
		}
		return r;
	});
};

describe("2K Badges definitions", () => {
	test("27 badges in the five categories, unique keys and short labels", () => {
		assert.strictEqual(TIERED_BADGES.length, 27);
		assert.strictEqual(new Set(TIERED_BADGES.map((d) => d.key)).size, 27);
		assert.strictEqual(new Set(TIERED_BADGES.map((d) => d.short)).size, 27);
		for (const cat of CATEGORIES) {
			assert.isAtLeast(
				TIERED_BADGES.filter((d) => d.category === cat).length,
				5,
				cat,
			);
		}
	});

	test("every input reads a 0-100 value, with and without sub-ratings", () => {
		const [withSubs] = genRows(1, 1, true);
		const [without] = genRows(1, 1, false);
		for (const def of TIERED_BADGES) {
			for (const [key] of [
				...def.score,
				...(def.gates ?? []).map((g) => [g.key] as const),
			]) {
				for (const r of [withSubs!, without!]) {
					const v = tbValue(r, key);
					assert.isTrue(v >= 0 && v <= 100, `${def.key} ${key} ${v}`);
				}
			}
		}
		// A sub-rating reads the row's sub array when it has one
		assert.strictEqual(
			tbValue(withSubs!, "tcs"),
			withSubs!.sub[SUB_INDEX.tcs!],
		);
		// ... and its base rating (or expanded rating) otherwise
		assert.strictEqual(tbValue(without!, "tcs"), without!.tp);
		assert.strictEqual(tbValue({ ...without!, oreb: 77 }, "orb"), 77);
	});
});

describe("2K Badges tiers", () => {
	const rows = genRows(300, 7, true);
	const cutoffs = computeCutoffs(rows, 2025);

	test("cutoffs are the league percentiles, strictly increasing", () => {
		assert.strictEqual(cutoffs.n, 300);
		for (const def of TIERED_BADGES) {
			const cuts = cutoffs.c[def.key]!;
			assert.strictEqual(cuts.length, 5);
			for (let i = 1; i < 5; i++) {
				assert.isAbove(cuts[i]!, cuts[i - 1]!);
			}
			const scores = rows.map((r) => tieredBadgeScore(r, def));
			const atLeastBronze = scores.filter((s) => s >= cuts[0]!).length;
			// 15% of the rotation reaches Bronze (by score alone)
			assert.approximately(atLeastBronze / 300, 0.15, 0.01);
			// One player at most reaches Legend
			assert.isAtMost(scores.filter((s) => s >= cuts[4]!).length, 1);
		}
		assert.isDefined(cutoffs.med.rng);
	});

	test("quantile and tier helpers", () => {
		assert.strictEqual(quantileSorted([0, 10], 0.5), 5);
		assert.strictEqual(tierOfScore(5, [10, 20, 30, 40, 50]), 0);
		assert.strictEqual(tierOfScore(35, [10, 20, 30, 40, 50]), 3);
		assert.strictEqual(tierOfScore(99, [10, 20, 30, 40, 50]), 5);
		assert.strictEqual(progressToNext(25, [10, 20, 30, 40, 50], 2), 0.5);
		assert.isUndefined(progressToNext(60, [10, 20, 30, 40, 50], 5));
	});

	test("badge points are capped by ovr, keeping the highest-scoring", () => {
		assert.strictEqual(badgePointCap(75), 16);
		assert.strictEqual(badgePointCap(60), 8);
		assert.strictEqual(badgePointCap(50), 3);
		// A player good at everything
		const star: Record<string, any> = {
			...rows[0],
			sub: rows[0]!.sub.map(() => 100),
		};
		for (const k of BASE) {
			star[k] = 100;
		}
		for (const ovr of [45, 55, 65, 75]) {
			const { t, capped } = assignTiers(star, ovr, cutoffs);
			assert.isAtMost(badgePoints(t), badgePointCap(ovr));
			assert.isAbove(capped.length, 0);
		}
		// The bench player's few points go to his deepest badges
		const { t } = assignTiers(star, 45, cutoffs);
		assert.isAtMost(Object.keys(t).length, 3);
	});

	test("hysteresis keeps a tier just under its cutoff, and a badge drops at most one tier a season", () => {
		const def = TIERED_BADGES.find((d) => d.key === "freeThrowAce")!;
		const cuts = cutoffs.c[def.key]!;
		const r: Record<string, any> = { ...rows[0]!, ovr: 80 };
		// Just below Gold
		r.ft = cuts[2]! - 0.3;
		assert.strictEqual(assignTiers(r, 80, cutoffs).t[def.key], 2);
		assert.strictEqual(
			assignTiers(r, 80, cutoffs, { [def.key]: 3 }).t[def.key],
			3,
		);
		// Far below: one tier down, not to nothing
		r.ft = 0;
		assert.strictEqual(
			assignTiers(r, 80, cutoffs, { [def.key]: 4 }).t[def.key],
			3,
		);
		assert.isUndefined(
			assignTiers(r, 80, cutoffs, { [def.key]: 1 }).t[def.key],
		);
	});

	test("at most one Legend per badge in the league", () => {
		const players = [1, 2, 3].map((pid) => ({
			pid,
			t: { clamps: 5 as Tier, glove: 4 as Tier },
			scores: { clamps: 90 + pid, glove: 80 },
		}));
		enforceLegendLimit(players);
		assert.deepEqual(
			players.map((p) => p.t.clamps),
			[4, 4, 5],
		);
	});

	test("a fresh league's tiers fill the pyramid", () => {
		const counts = [0, 0, 0, 0, 0, 0];
		const assigned = rows.map((r, pid) => {
			const { t } = assignTiers(r, r.ovr, cutoffs);
			const scores: Record<string, number> = {};
			for (const key of Object.keys(t)) {
				scores[key] = tieredBadgeScore(
					r,
					TIERED_BADGES.find((d) => d.key === key)!,
				);
			}
			return { pid, t, scores };
		});
		enforceLegendLimit(assigned);
		for (const { t } of assigned) {
			for (const tier of Object.values(t)) {
				counts[tier]!++;
			}
		}
		assert.isAbove(counts[1]!, counts[2]!);
		assert.isAbove(counts[2]!, counts[3]!);
		assert.isAbove(counts[3]!, counts[5]!);
		assert.isAtMost(counts[5]!, TIERED_BADGES.length);
	});
});

describe("2K Badges display helpers", () => {
	test("tokens round trip, sorted by tier", () => {
		const parsed = parseBadgeToken(badgeToken("catchShoot", 4));
		assert.strictEqual(parsed?.def.name, "Catch & Shoot");
		assert.strictEqual(parsed?.tier, 4);
		assert.isUndefined(parseBadgeToken("Cs"));
		assert.isUndefined(parseBadgeToken("2k:nope:3"));
		assert.deepEqual(
			sortedBadges({ glove: 1, clamps: 3, dimer: 3 }).map((b) => b.key),
			["dimer", "clamps", "glove"],
		);
	});

	test("history entries replace their season, oldest first", () => {
		let entries = withTierEntry(undefined, { season: 2026, t: { glove: 1 } });
		entries = withTierEntry(entries, { season: 2025, t: { glove: 2 } });
		entries = withTierEntry(entries, { season: 2026, t: { glove: 3 } });
		assert.deepEqual(
			entries.map((e) => [e.season, e.t.glove]),
			[
				[2025, 2],
				[2026, 3],
			],
		);
	});

	test("archetype why line cites Gold or better", () => {
		assert.isUndefined(badgeWhyLine({ glove: 2 }));
		assert.strictEqual(
			badgeWhyLine({ glove: 3, clamps: 5 }),
			"Backed by his badges: Clamps (Legend) and Glove (Gold).",
		);
	});
});
