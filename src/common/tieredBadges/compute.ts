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
import { BADGE_EFFECTS } from "./effects.ts";

type Row = Record<string, any>;

// Badges with a game sim effect (effects.ts, the same list as the sim's BADGE_SIM). Within a tier they come before the ones that only
// describe a player's game, when the badge-point cap and the limit of MAX_BADGES choose: an athletic big's Pogo Stick and Fast Twitch
// used to push his Rim Protector out of his 6
export const simRelevant = (key: string) => (BADGE_EFFECTS[key] ? 1 : 0);

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

// Highest tier a badge may take (a badge left out has no limit; 0: none). Used when a duplicate Legend is lowered to Hall of Fame, or a
// refresh must not raise a tier, so the cap is applied to the lowered tiers and the points they free go to the next badges under the
// same rules
export type TierLimits = Partial<Record<string, Tier>>;

/** Each badge's tier from the score alone (gates, hysteresis), before the cap (and within limits, if any). */
export const tierCandidates = (
	r: Row,
	cutoffs: TieredBadgeCutoffs,
	prev?: Partial<Record<string, Tier>>,
	limits?: TierLimits,
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
		const limit = limits?.[def.key];
		if (limit !== undefined && tier > limit) {
			tier = limit;
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
 * A player's tiers for a season: the candidates under the badge-point cap (highest tier first, badges with a sim effect before the others
 * in a tier, then the deepest; one that doesn't fit at its tier takes what points are left), then no badge drops more than one tier from
 * last season as long as the cap has points left for it (the floor used to go over the cap: about 6% of players, every season), then
 * only his best MAX_BADGES are kept (highest tier, sim effect, then furthest into it; the others are "next up" on the player page, not
 * earned).
 */
export const assignTiers = (
	r: Row,
	ovr: number,
	cutoffs: TieredBadgeCutoffs,
	prev?: Partial<Record<string, Tier>>,
	limits?: TierLimits,
): { t: Record<string, Tier>; capped: string[] } => {
	const candidates = tierCandidates(r, cutoffs, prev, limits).sort(
		(a, b) =>
			b.tier - a.tier ||
			simRelevant(b.key) - simRelevant(a.key) ||
			b.depth - a.depth ||
			a.key.localeCompare(b.key),
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
		// Within the cap: the points the candidates left, the highest tiers last season first
		const floors = Object.entries(prev)
			.filter(
				([key, before]) => before && before >= 2 && TIERED_BADGES_BY_KEY[key],
			)
			.sort(
				([ka, a], [kb, b]) =>
					b! - a! || simRelevant(kb) - simRelevant(ka) || ka.localeCompare(kb),
			);
		for (const [key, before] of floors) {
			const now = t[key] ?? 0;
			const floor = Math.min(before! - 1, now + left, limits?.[key] ?? 5);
			if (floor > now) {
				t[key] = floor as Tier;
				left -= floor - now;
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
 * The best MAX_BADGES of a set of tiers: highest tier, then badges with a sim effect, then furthest into it (progress), then definition
 * order. The result's keys are in that order (kept when stored), so displays can show them best first.
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
				simRelevant(b) - simRelevant(a) ||
				(progressByKey?.get(b) ?? 0) - (progressByKey?.get(a) ?? 0) ||
				(TIERED_BADGE_INDEX[a] ?? 0) - (TIERED_BADGE_INDEX[b] ?? 0),
		)
		.slice(0, MAX_BADGES);
	return Object.fromEntries(kept.map((key) => [key, t[key]!]));
};

// Re-centering: a badge's holders at a tier or better may exceed the holders without last season's tiers (no hysteresis, no floor) by at
// most this share (rounded up), so held-over badges don't pile up season after season
export const RECENTER_TOLERANCE = 0.1;

/**
 * Keep the tier counts where the league's percentiles put them. Hysteresis and the one-tier floor keep badges whose score has fallen
 * below their tier, and with players' ratings moving every season the held-over badges added up (in a synthetic run Silver grew about
 * 50% and Bronze 15-20% by the 4th-7th season). For each badge and tier, top down: if more players hold it at that tier or better than
 * would without last season's tiers (fresh) by more than RECENTER_TOLERANCE, the held-over ones at that tier with the lowest scores drop
 * a tier until it fits. Deterministic (score, then pid). Mutates the entries' t; returns the number of demotions.
 */
export const recenterHeldTiers = (
	players: {
		pid: number;
		t: Record<string, Tier>;
		fresh: Partial<Record<string, Tier>>;
		scoreOf: (key: string) => number;
	}[],
) => {
	let demoted = 0;
	for (const def of TIERED_BADGES) {
		const key = def.key;
		for (let tier = 4; tier >= 1; tier--) {
			let count = 0;
			let target = 0;
			for (const p of players) {
				if ((p.t[key] ?? 0) >= tier) {
					count++;
				}
				if ((p.fresh[key] ?? 0) >= tier) {
					target++;
				}
			}
			const excess = count - Math.ceil(target * (1 + RECENTER_TOLERANCE));
			if (excess <= 0) {
				continue;
			}
			const held = players
				.filter((p) => p.t[key] === tier && (p.fresh[key] ?? 0) < tier)
				.map((p) => ({ p, score: p.scoreOf(key) }))
				.sort((a, b) => a.score - b.score || a.p.pid - b.p.pid)
				.slice(0, excess);
			for (const { p } of held) {
				if (tier === 1) {
					delete p.t[key];
				} else {
					p.t[key] = (tier - 1) as Tier;
				}
				demoted++;
			}
		}
	}
	return demoted;
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
 * the others are Hall of Fame. Mutates the entries; returns the ones it lowered (their freed point is given back by legendReassignLimits
 * and assignTiers, see updateTieredBadges).
 */
export const enforceLegendLimit = <
	P extends {
		pid: number;
		t: Record<string, Tier>;
		scores: Record<string, number>;
	},
>(
	players: P[],
): P[] => {
	const lowered = new Set<P>();
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
				lowered.add(p);
			}
		}
	}
	return [...lowered];
};

/**
 * The limits to re-assign a player whose duplicate Legend was lowered to Hall of Fame, so the point it frees goes to his next badge under
 * the same rules (the cap order, the one-tier floor, the best 6) and "capped" is recomputed, as refreshTieredBadgesFor does mid-season:
 * Hall of Fame at most where someone else holds the Legend, and no badge above what it had before the lowering when something other than
 * the cap lowered it (the re-centering: before, his tiers as assigned; after, as they are now). A Legend nobody holds stays open to him.
 */
export const legendReassignLimits = (
	before: Partial<Record<string, Tier>>,
	after: Partial<Record<string, Tier>>,
	heldByOthers: ReadonlySet<string>,
): TierLimits => {
	const limits: TierLimits = {};
	for (const def of TIERED_BADGES) {
		const key = def.key;
		const now = after[key] ?? 0;
		let limit: Tier = heldByOthers.has(key) ? 4 : 5;
		if (now < (before[key] ?? 0) && now < limit) {
			limit = now;
		}
		limits[key] = limit;
	}
	return limits;
};

/**
 * enforceLegendLimit, then each player it lowered re-assigned with legendReassignLimits (in order, so a Legend one of them takes is held
 * for the next). assign: his tiers under limits (assignTiers with his row, cutoffs and last season's tiers). Mutates the entries.
 */
export const enforceLegendLimitAndReassign = <
	P extends {
		pid: number;
		t: Record<string, Tier>;
		capped: string[];
		scores: Record<string, number>;
		// His tiers before the re-centering (as assigned)
		assigned: Partial<Record<string, Tier>>;
	},
>(
	players: P[],
	assign: (
		p: P,
		limits: TierLimits,
	) => { t: Record<string, Tier>; capped: string[] },
	scoresOf: (p: P) => Record<string, number>,
) => {
	const lowered = enforceLegendLimit(players);
	if (lowered.length === 0) {
		return lowered;
	}
	const holder = new Map<string, number>();
	for (const p of players) {
		for (const [key, tier] of Object.entries(p.t)) {
			if (tier === 5) {
				holder.set(key, p.pid);
			}
		}
	}
	for (const p of lowered) {
		const heldByOthers = new Set<string>();
		for (const [key, pid] of holder) {
			if (pid !== p.pid) {
				heldByOthers.add(key);
			}
		}
		const { t, capped } = assign(
			p,
			legendReassignLimits(p.assigned, p.t, heldByOthers),
		);
		for (const [key, pid] of [...holder]) {
			if (pid === p.pid && t[key] !== 5) {
				holder.delete(key);
			}
		}
		for (const [key, tier] of Object.entries(t)) {
			if (tier === 5) {
				holder.set(key, p.pid);
			}
		}
		p.t = t;
		p.capped = capped;
		p.scores = scoresOf(p);
	}
	return lowered;
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
