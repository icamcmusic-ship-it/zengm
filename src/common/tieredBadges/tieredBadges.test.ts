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
	enforceLegendLimitAndReassign,
	keepBest,
	MAX_BADGES,
	parseBadgeToken,
	progressToNext,
	quantileSorted,
	recenterHeldTiers,
	simRelevant,
	sortedBadges,
	tbValue,
	tierOfScore,
	tieredBadgeScore,
	withTierEntry,
	type Tier,
} from "./index.ts";
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
	test("68 badges in the seven categories, unique keys and short labels", () => {
		assert.strictEqual(TIERED_BADGES.length, 68);
		assert.strictEqual(CATEGORIES.length, 7);
		assert.strictEqual(new Set(TIERED_BADGES.map((d) => d.key)).size, 68);
		assert.strictEqual(new Set(TIERED_BADGES.map((d) => d.short)).size, 68);
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
			// Bronze starts at the 85th percentile (by score alone): 15% of the rotation reaches it, give or take the players tied
			// at the cutoff (some scores read few distinct values in these generated rows)
			const below = scores.filter((s) => s < cuts[0]!).length;
			const above = scores.filter((s) => s > cuts[0]!).length;
			assert.isAtMost(below / 300, 0.86, def.key);
			assert.isAtMost(above / 300, 0.16, def.key);
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
		// A player with nothing but his free throws (so no better badges push this one out of his best MAX_BADGES)
		const r: Record<string, any> = { ...rows[0]!, ovr: 80 };
		for (const k of BASE) {
			r[k] = 20;
		}
		r.sub = r.sub.map(() => 20);
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

	test("the one-tier floor stays within the badge-point cap", () => {
		// Last season a Hall of Fame shooter and defender; now nothing is left (every rating 20) and his ovr allows 3 points
		const r: Record<string, any> = { ...rows[0]!, ovr: 51 };
		for (const k of BASE) {
			r[k] = 20;
		}
		r.sub = r.sub.map(() => 20);
		const prev = { freeThrowAce: 4, clamps: 4, glove: 3 } as const;
		const cap = badgePointCap(51);
		assert.strictEqual(cap, 3);
		const { t } = assignTiers(r, 51, cutoffs, prev);
		assert.isAtMost(badgePoints(t), cap);
		// The points go to the highest tiers last season (sim effects first, then by key): Clamps Gold
		assert.deepEqual(t, { clamps: 3 });
		// With room, every badge drops only one tier
		assert.deepEqual(assignTiers(r, 80, cutoffs, prev).t, {
			clamps: 3,
			freeThrowAce: 3,
			glove: 2,
		});
	});

	test("tier counts stay stationary over seasons of moving ratings (hysteresis, floor, cap, re-centering)", () => {
		// 390 rotation players whose ratings take a random walk (about 3 points a season), 12 seasons: each season new cutoffs, tiers
		// with last season's, the re-centering and one Legend per badge, as updateTieredBadges does
		const rand = makeSeededRandom(11);
		const normal = () => {
			const u = Math.max(rand(), 1e-9);
			return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
		};
		const bound = (x: number) => Math.max(0, Math.min(100, x));
		const league = genRows(390, 3, true);
		let prev: Record<string, Tier>[] = league.map(() => ({}));
		const bySeason: number[][] = [];
		let overCap = 0;
		for (let season = 0; season < 12; season++) {
			if (season > 0) {
				for (const r of league) {
					for (const k of BASE) {
						r[k] = bound(r[k] + 3 * normal());
					}
					r.sub = r.sub.map((x: number) => bound(x + 3 * normal()));
					r.ovr = bound(r.ovr + 2 * normal());
				}
			}
			const cuts = computeCutoffs(league, 2025 + season);
			const players = league.map((r, pid) => {
				const p = season > 0 ? prev[pid] : undefined;
				const { t } = assignTiers(r, r.ovr, cuts, p);
				return {
					pid,
					t,
					fresh: p ? assignTiers(r, r.ovr, cuts).t : t,
					scoreOf: (key: string) =>
						tieredBadgeScore(
							r,
							TIERED_BADGES.find((d) => d.key === key)!,
						),
					scores: {} as Record<string, number>,
				};
			});
			recenterHeldTiers(players);
			for (const p of players) {
				for (const key of Object.keys(p.t)) {
					p.scores[key] = p.scoreOf(key);
				}
			}
			enforceLegendLimit(players);
			const counts = [0, 0, 0, 0, 0, 0];
			for (const [pid, p] of players.entries()) {
				for (const tier of Object.values(p.t)) {
					counts[tier]!++;
				}
				if (badgePoints(p.t) > badgePointCap(league[pid]!.ovr)) {
					overCap++;
				}
				assert.isAtMost(Object.keys(p.t).length, MAX_BADGES);
			}
			bySeason.push(counts);
			prev = players.map((p) => p.t);
		}
		assert.strictEqual(overCap, 0);
		// Seasons 4-11 against the first (no history): each tier within 15% (Legend: one per badge at most, always)
		for (const tier of [1, 2, 3, 4]) {
			const first = bySeason[0]![tier]!;
			const later =
				bySeason.slice(4).reduce((a, c) => a + c[tier]!, 0) /
				bySeason.slice(4).length;
			assert.isAtMost(later, 1.15 * first, `tier ${tier}`);
			assert.isAtLeast(later, 0.85 * first, `tier ${tier}`);
		}
	}, 120_000);

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

	test("a duplicate Legend lowered to Hall of Fame gives its point back under the same rules", () => {
		// Two identical stars at the badge-point cap: the second (higher pid) loses his Legends
		const star: Record<string, any> = {
			...rows[0],
			sub: rows[0]!.sub.map(() => 100),
		};
		for (const k of BASE) {
			star[k] = 100;
		}
		const ovr = 75;
		const cap = badgePointCap(ovr);
		const scoresOf = (t: Record<string, Tier>) =>
			Object.fromEntries(
				Object.keys(t).map((key) => [
					key,
					tieredBadgeScore(
						star,
						TIERED_BADGES.find((d) => d.key === key)!,
					),
				]),
			);
		const players = [1, 2].map((pid) => {
			const { t, capped } = assignTiers(star, ovr, cutoffs);
			return { pid, t, capped, assigned: { ...t }, scores: scoresOf(t) };
		});
		const first = { ...players[0]!.t };
		assert.strictEqual(badgePoints(first), cap);
		const legends = Object.keys(first).filter((key) => first[key] === 5);
		assert.isAbove(legends.length, 0);

		const lowered = enforceLegendLimitAndReassign(
			players,
			(p, limits) => assignTiers(star, ovr, cutoffs, undefined, limits),
			(p) => scoresOf(p.t),
		);
		assert.deepEqual(
			lowered.map((p) => p.pid),
			[2],
		);
		assert.deepEqual(players[0]!.t, first);
		const second = players[1]!;
		// No second Legend of a badge, and the freed points are used (he is at the cap again, within 6)
		for (const key of legends) {
			assert.isAtMost(second.t[key] ?? 0, 4, key);
		}
		assert.strictEqual(badgePoints(second.t), cap);
		assert.isAtMost(Object.keys(second.t).length, MAX_BADGES);
		// Every Legend in the league is held once
		const count: Record<string, number> = {};
		for (const p of players) {
			for (const [key, tier] of Object.entries(p.t)) {
				if (tier === 5) {
					count[key] = (count[key] ?? 0) + 1;
				}
			}
		}
		for (const n of Object.values(count)) {
			assert.strictEqual(n, 1);
		}
		// "capped" is recomputed: a lowered Legend is not capped (the limit, not the cap, lowered it)
		for (const key of legends) {
			if (second.t[key] === 4) {
				assert.notInclude(second.capped, key);
			}
		}

		// Before (the plain lowering): 1 point a Legend left unused
		const plain = [1, 2].map((pid) => ({
			pid,
			t: assignTiers(star, ovr, cutoffs).t,
			scores: scoresOf(first),
		}));
		enforceLegendLimit(plain);
		assert.strictEqual(badgePoints(plain[1]!.t), cap - legends.length);
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
	test("tokens round trip, sorted by tier (then the stored order: furthest into the tier first)", () => {
		const parsed = parseBadgeToken(badgeToken("catchShoot", 4));
		assert.strictEqual(parsed?.def.name, "Catch & Shoot");
		assert.strictEqual(parsed?.tier, 4);
		assert.isUndefined(parseBadgeToken("Cs"));
		assert.isUndefined(parseBadgeToken("2k:nope:3"));
		assert.deepEqual(
			sortedBadges({ glove: 1, clamps: 3, dimer: 3 }).map((b) => b.key),
			["clamps", "dimer", "glove"],
		);
	});

	test("a player keeps his best MAX_BADGES: highest tier, then badges with a sim effect, then furthest into it", () => {
		const t: Record<string, Tier> = {
			glove: 1,
			clamps: 3,
			dimer: 3,
			handles: 2,
			acrobat: 4,
			riseUp: 1,
			pogoStick: 2,
			postLockdown: 2,
			brickWall: 5,
		};
		const progress = new Map([
			["clamps", 0.2],
			["dimer", 0.7],
			["handles", 0.1],
			["postLockdown", 0.05],
			["pogoStick", 0.9],
		]);
		const kept = keepBest(t, progress);
		assert.strictEqual(MAX_BADGES, 6);
		// Pogo Stick (no sim effect) is the furthest into Silver, but Handles and Post Lockdown (sim effects) take the last two slots
		assert.deepEqual(Object.keys(kept), [
			"brickWall",
			"acrobat",
			"dimer",
			"clamps",
			"handles",
			"postLockdown",
		]);
		assert.strictEqual(simRelevant("pogoStick"), 0);
		assert.strictEqual(simRelevant("handles"), 1);
		assert.deepEqual(
			sortedBadges(kept).map((b) => b.key),
			Object.keys(kept),
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
