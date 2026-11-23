// 2K Badges: league cutoffs, tiers with the badge-point cap, hysteresis and the one-tier-a-season drop. Pure (no worker imports, no
// randomness), shared by the worker and the UI.
import {
	MAX_BADGES,
	MEDIAN_GATE_KEYS,
	TIERED_BADGES,
	TIERED_BADGES_BY_KEY,
	TIERED_BADGE_INDEX,
	TIER_NAMES,
	TIER_PERCENTILES,
	TIER_POINTS,
	tbValue,
	tieredBadgeScore,
	type TieredBadgeDef,
	type Tier,
} from "./definitions.ts";

type Row = Record<string, any>;

// Saved each season (game attribute tieredBadgeCutoffs, by season): per badge the scores where Bronze, Silver, Gold, Hall of Fame and
// Legend start, and the medians of the median-gated inputs
export type TieredBadgeCutoffs = {
	season: number;
	// Number of rotation players they were computed from
	n: number;
	c: Record<string, number[]>;
	med: Record<string, number>;
};

// A player's badges for one season (p.badges2k, oldest first): tier by badge key (only badges he has), and the badges the point cap
// lowered or removed
export type TieredBadgeEntry = {
	season: number;
	// The sim's tiers, from his true ratings (never shown)
	t: Record<string, Tier>;
	// The shown tiers, from his ratings as scouted (fuzz), when they differ from t
	d?: Record<string, Tier>;
	capped?: string[];
};

// Rotation players per team the cutoffs are computed from
export const ROTATION_SIZE = 10;
// Seasons of cutoffs kept
export const CUTOFF_HISTORY = 40;

/** Linear-interpolation quantile of sorted (ascending) values. */
export const quantileSorted = (sorted: readonly number[], q: number) => {
	if (sorted.length === 0) {
		return 0;
	}
	const pos = q * (sorted.length - 1);
	const lo = Math.floor(pos);
	const hi = Math.min(sorted.length - 1, lo + 1);
	return sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Cutoffs from the ratings rows of the league's rotation players. */
export const computeCutoffs = (
	rows: readonly Row[],
	season: number,
): TieredBadgeCutoffs => {
	const c: Record<string, number[]> = {};
	for (const def of TIERED_BADGES) {
		const scores = rows
			.map((r) => tieredBadgeScore(r, def))
			.sort((a, b) => a - b);
		const cuts = TIER_PERCENTILES.map((q) => round2(quantileSorted(scores, q)));
		// Strictly increasing, so every tier is reachable and progress is well defined
		for (let i = 1; i < cuts.length; i++) {
			if (cuts[i]! <= cuts[i - 1]!) {
				cuts[i] = round2(cuts[i - 1]! + 0.01);
			}
		}
		c[def.key] = cuts;
	}
	const med: Record<string, number> = {};
	for (const key of MEDIAN_GATE_KEYS) {
		const values = rows.map((r) => tbValue(r, key)).sort((a, b) => a - b);
		med[key] = round2(quantileSorted(values, 0.5));
	}
	return { season, n: rows.length, c, med };
};

export const gatesMet = (
	r: Row,
	def: TieredBadgeDef,
	cutoffs: TieredBadgeCutoffs,
) =>
	(def.gates ?? []).every((gate) => {
		const value = tbValue(r, gate.key);
		const min = gate.min === "median" ? (cutoffs.med[gate.key] ?? 0) : gate.min;
		return (
			(min === undefined || value >= min) &&
			(gate.max === undefined || value <= gate.max)
		);
	});

/** The highest tier whose cutoff the score reaches (0 = none). */
export const tierOfScore = (score: number, cuts: readonly number[]): Tier => {
	let tier = 0;
	for (let i = 0; i < cuts.length; i++) {
		if (score >= cuts[i]!) {
			tier = i + 1;
		}
	}
	return tier as Tier;
};

// Hysteresis: a tier he had last season is kept while the score is within this share of the gap to the tier below
export const KEEP_BUFFER = 0.35;
// (and at least this many score points)
export const KEEP_BUFFER_MIN = 0.75;

const keepBuffer = (tier: number, cuts: readonly number[]) => {
	const here = cuts[tier - 1]!;
	const below = tier >= 2 ? cuts[tier - 2]! : here - (cuts[1]! - cuts[0]!);
	return Math.max(KEEP_BUFFER_MIN, KEEP_BUFFER * (here - below));
};

/** Badge points allowed by ovr: about 16 for 70+, 8 for starters, 3 for bench. */
export const badgePointCap = (ovr: number) => {
	if (ovr >= 70) {
		return 16;
	}
	if (ovr >= 60) {
		return Math.floor(8 + (ovr - 60) * 0.7);
	}
	if (ovr >= 50) {
		return Math.floor(3 + (ovr - 50) * 0.5);
	}
	return Math.max(1, Math.floor(3 - (50 - ovr) * 0.2));
};

/** How far a score is into its tier, toward the next one (0-1); undefined at Legend or without a tier's cutoff. */
export const progressToNext = (
	score: number,
	cuts: readonly number[],
	tier: Tier,
): number | undefined => {
	if (tier >= 5) {
		return undefined;
	}
	const next = cuts[tier]!;
	const here = tier === 0 ? next - 2 * (cuts[1]! - cuts[0]!) : cuts[tier - 1]!;
	if (next <= here) {
		return undefined;
	}
	return Math.min(1, Math.max(0, (score - here) / (next - here)));
};

export type TierCandidate = {
	key: string;
	score: number;
	// Tier from the score (with hysteresis), before the cap
	tier: Tier;
	// Where in its tier (tier + progress), to keep the highest-scoring ones under the cap
	depth: number;
};

/** Each badge's tier from the score alone (gates, hysteresis), before the cap. */
export const tierCandidates = (
	r: Row,
	cutoffs: TieredBadgeCutoffs,
	prev?: Partial<Record<string, Tier>>,
): TierCandidate[] => {
	const out: TierCandidate[] = [];
	for (const def of TIERED_BADGES) {
		const cuts = cutoffs.c[def.key];
		if (!cuts) {
			continue;
		}
		const score = tieredBadgeScore(r, def);
		const gated = gatesMet(r, def, cutoffs);
		let tier: Tier = gated ? tierOfScore(score, cuts) : 0;
		const before = prev?.[def.key] ?? 0;
		if (
			gated &&
			before > tier &&
			score >= cuts[before - 1]! - keepBuffer(before, cuts)
		) {
			tier = before;
		}
		if (tier > 0) {
			out.push({
				key: def.key,
				score,
				tier,
				depth: tier + (progressToNext(score, cuts, tier) ?? 0),
			});
		}
	}
	return out;
};

/**
 * A player's tiers for a season: the candidates under the badge-point cap (the deepest ones first; one that doesn't fit at its tier
 * takes what points are left), then no badge drops more than one tier from last season (that can go a little over the cap), then only
 * his best MAX_BADGES are kept (highest tier, then furthest into it; the others are "next up" on the player page, not earned).
 */
export const assignTiers = (
	r: Row,
	ovr: number,
	cutoffs: TieredBadgeCutoffs,
	prev?: Partial<Record<string, Tier>>,
): { t: Record<string, Tier>; capped: string[] } => {
	const candidates = tierCandidates(r, cutoffs, prev).sort(
		(a, b) => b.depth - a.depth || a.key.localeCompare(b.key),
	);
	const progressByKey = new Map(
		candidates.map((c) => [c.key, c.depth - c.tier]),
	);
	let left = badgePointCap(ovr);
	const t: Record<string, Tier> = {};
	const capped: string[] = [];
	for (const c of candidates) {
		const pts = TIER_POINTS[c.tier];
		if (pts <= left) {
			t[c.key] = c.tier;
			left -= pts;
		} else {
			capped.push(c.key);
			if (left >= 1) {
				t[c.key] = left as Tier;
				left = 0;
			}
		}
	}
	if (prev) {
		for (const [key, before] of Object.entries(prev)) {
			if (before && before >= 2 && TIERED_BADGES_BY_KEY[key]) {
				const floor = (before - 1) as Tier;
				if ((t[key] ?? 0) < floor) {
					t[key] = floor;
				}
			}
		}
	}
	const kept = keepBest(t, progressByKey);
	// "Capped": the cap lowered or removed it, and the one-tier floor didn't restore it
	const tierByKey = new Map(candidates.map((c) => [c.key, c.tier]));
	return {
		t: kept,
		capped: capped.filter((key) => (t[key] ?? 0) < (tierByKey.get(key) ?? 0)),
	};
};

/**
 * The best MAX_BADGES of a set of tiers: highest tier, then furthest into it (progress), then definition order. The result's keys are
 * in that order (kept when stored), so displays can show them best first.
 */
export const keepBest = (
	t: Record<string, Tier>,
	progressByKey?: ReadonlyMap<string, number>,
): Record<string, Tier> => {
	const keys = Object.keys(t).filter((key) => t[key]);
	const kept = keys
		.toSorted(
			(a, b) =>
				t[b]! - t[a]! ||
				(progressByKey?.get(b) ?? 0) - (progressByKey?.get(a) ?? 0) ||
				(TIERED_BADGE_INDEX[a] ?? 0) - (TIERED_BADGE_INDEX[b] ?? 0),
		)
		.slice(0, MAX_BADGES);
	return Object.fromEntries(kept.map((key) => [key, t[key]!]));
};

/** Total badge points of a set of tiers. */
export const badgePoints = (t: Partial<Record<string, Tier>>) => {
	let sum = 0;
	for (const tier of Object.values(t)) {
		sum += TIER_POINTS[tier ?? 0];
	}
	return sum;
};

/**
 * Legend is at most one per badge in the league: among everyone given a Legend, the highest score keeps it (ties: the lower pid) and
 * the others are Hall of Fame. Mutates the entries.
 */
export const enforceLegendLimit = (
	players: {
		pid: number;
		t: Record<string, Tier>;
		scores: Record<string, number>;
	}[],
) => {
	for (const def of TIERED_BADGES) {
		let best: (typeof players)[number] | undefined;
		for (const p of players) {
			if (p.t[def.key] === 5) {
				if (
					!best ||
					p.scores[def.key]! > best.scores[def.key]! ||
					(p.scores[def.key] === best.scores[def.key] && p.pid < best.pid)
				) {
					best = p;
				}
			}
		}
		for (const p of players) {
			if (p !== best && p.t[def.key] === 5) {
				p.t[def.key] = 4;
			}
		}
	}
};

/** The entry of a season, or the latest one before it. */
export const entryForSeason = (
	entries: readonly TieredBadgeEntry[] | undefined,
	season: number,
): TieredBadgeEntry | undefined => {
	if (!entries) {
		return undefined;
	}
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i]!.season === season) {
			return entries[i];
		}
	}
	return undefined;
};

/** Replace (or add) a season's entry, oldest first. */
export const withTierEntry = (
	entries: readonly TieredBadgeEntry[] | undefined,
	entry: TieredBadgeEntry,
): TieredBadgeEntry[] => {
	const out = (entries ?? []).filter((e) => e.season !== entry.season);
	out.push(entry);
	out.sort((a, b) => a.season - b.season);
	return out;
};

/** Badges sorted for display: tier, then the stored order (furthest into the tier first, see keepBest). */
export const sortedBadges = (t: Partial<Record<string, Tier>>) =>
	Object.entries(t)
		.map(([key, tier], i) => ({ key, i, tier: tier ?? 0 }))
		.filter((x) => x.tier > 0 && TIERED_BADGES_BY_KEY[x.key])
		.sort((a, b) => b.tier - a.tier || a.i - b.i)
		.map((x) => ({ key: x.key, tier: x.tier as Tier }));

/** The archetype why line's citation of his best badges (Gold or better, up to 3), or undefined. */
export const badgeWhyLine = (t: Partial<Record<string, Tier>> | undefined) => {
	if (!t) {
		return undefined;
	}
	const best = sortedBadges(t)
		.filter((b) => b.tier >= 3)
		.slice(0, 3)
		.map((b) => `${TIERED_BADGES_BY_KEY[b.key]!.name} (${TIER_NAMES[b.tier]})`);
	if (best.length === 0) {
		return undefined;
	}
	const list =
		best.length === 1
			? best[0]
			: `${best.slice(0, -1).join(", ")} and ${best.at(-1)}`;
	return `Backed by his badges: ${list}.`;
};

// Display tokens (sent in a row's `badges` list, see player format): "2k:<key>:<tier>"
export const TOKEN_PREFIX = "2k:";
export const badgeToken = (key: string, tier: Tier) =>
	`${TOKEN_PREFIX}${key}:${tier}`;
export const parseBadgeToken = (
	token: string,
): { def: TieredBadgeDef; tier: Tier } | undefined => {
	if (!token.startsWith(TOKEN_PREFIX)) {
		return undefined;
	}
	const [key, tierStr] = token.slice(TOKEN_PREFIX.length).split(":");
	const def = TIERED_BADGES_BY_KEY[key!];
	const tier = Number(tierStr);
	if (!def || !(tier >= 1 && tier <= 5)) {
		return undefined;
	}
	return { def, tier: tier as Tier };
};
/** A display token as text ("Catch & Shoot (Gold)"), for exports; anything else as is. */
export const badgeTokenText = (token: string) => {
	const parsed = parseBadgeToken(token);
	return parsed ? `${parsed.def.name} (${TIER_NAMES[parsed.tier]})` : token;
};

// Pills in tables and the player page header: all his badges (at most MAX_BADGES), best first
export const MAX_TOKENS = MAX_BADGES;

/** The tiers to show for an entry: from the ratings as scouted (d), which are the sim's (t) when they agree. */
export const displayTiersOf = (e: TieredBadgeEntry) => e.d ?? e.t;
