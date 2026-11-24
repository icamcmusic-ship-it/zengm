// 2K Badges (basketball, always on: the only badges players show): the worker side. Cutoffs are computed from the rotation players and
// saved per season (game attribute tieredBadgeCutoffs), and every player's tiers are stored per season in p.badges2k, at each preseason
// after development (and once in a league that has none for the season, e.g. an old league). Only the game sim effects are a League
// Extra (twoKBadges, "2K Badge Effects in Sim"). Nothing here draws a random number. See common/tieredBadges.
import { PLAYER } from "../../../common/constants.ts";
import {
	CATEGORY_NAMES,
	BADGE_TRAIT_KEYS,
	CUTOFF_HISTORY,
	MAX_BADGES,
	NUM_TIERED_BADGES,
	ROTATION_SIZE,
	TIERED_BADGES,
	TIERED_BADGES_BY_KEY,
	TIERED_BADGE_INDEX,
	TIER_NAMES,
	TRAIT_PREFIX,
	assignTiers,
	badgeDrivers,
	badgePointCap,
	badgePoints,
	computeCutoffs,
	displayTiersOf,
	enforceLegendLimit,
	gatesMet,
	entryForSeason,
	progressToNext,
	recenterHeldTiers,
	sortedBadges,
	tbValue,
	tierCandidates,
	tieredBadgeScore,
	withTierEntry,
	type Tier,
	type TieredBadgeCutoffs,
	type TieredBadgeEntry,
} from "../../../common/tieredBadges/index.ts";
import { SUB_DEFS, SUB_INDEX } from "../../../common/subRatings.ts";
import type { Player } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import setGameAttributes from "../league/setGameAttributes.ts";
import { fuzzedSkillRow } from "./skills.ts";
import {
	getBadgeTraits,
	getPlayerTraitScores,
	getTraitExperience,
	traitsEnabled,
} from "./traits.ts";
import {
	SEASONS_TO_REVEAL,
	TRAIT_DEFINITIONS,
	type TraitKey,
} from "../../../common/playerTraits/index.ts";

// Badges themselves: every basketball league
export const tieredBadgesOn = () => __SPORT === "basketball";

// Their game sim effects: the League Extra (off in existing leagues, so they play exactly as before)
export const tieredBadgeSimOn = () =>
	__SPORT === "basketball" && featureOn("twoKBadges");

/**
 * The row a badge score reads: his ratings row plus his known traits ("tr_<key>", with Player Traits on). Known means the same for
 * every user: visible traits, and hidden ones once he has played SEASONS_TO_REVEAL seasons (their scouting uncertainty is gone then).
 * A trait left out reads a rating-based stand-in (common/tieredBadges TRAIT_FALLBACK).
 */
export const badgeRowOf = (
	p: Player,
	r: Record<string, any> = last(p.ratings) as Record<string, any>,
	season: number = r.season ?? g.get("season"),
): Record<string, any> => {
	if (!traitsEnabled() || p.tid === PLAYER.UNDRAFTED) {
		return r;
	}
	const scores = getPlayerTraitScores(p as any, season);
	const revealed = getTraitExperience(p as any, season) >= SEASONS_TO_REVEAL;
	const out: Record<string, any> = { ...r };
	for (const key of BADGE_TRAIT_KEYS) {
		const k = key as TraitKey;
		if (TRAIT_DEFINITIONS[k].visibility === "visible" || revealed) {
			out[`${TRAIT_PREFIX}${key}`] = scores[k];
		}
	}
	return out;
};

// The row as the user sees it (fuzzed ratings, traits as scouted), for the player page's progress
const shownBadgeRow = (p: Player, pr: Record<string, any>, season: number) =>
	withShownTraits(p, fuzzedSkillRow(pr as any, false, p), season);

// A ratings row as shown plus his traits as scouted (the badge row of the player page and of the table pills)
const withShownTraits = (
	p: Player,
	row: Record<string, any>,
	season: number,
) => {
	const shown: Record<string, any> = { ...row };
	const traits = traitsEnabled() ? getBadgeTraits(p as any, season) : undefined;
	if (traits) {
		for (const key of BADGE_TRAIT_KEYS) {
			const v = traits[key as TraitKey];
			if (v !== undefined) {
				shown[`${TRAIT_PREFIX}${key}`] = v;
			}
		}
	}
	return shown;
};

const rowOf = (p: Player) => badgeRowOf(p);

// The same row as his scouts see it (the row's fuzz always applied, like the stored skills), with the same known traits (known traits
// are exact for every user, so they are not fuzzed). Display tiers are computed from it
const scoutedRowOf = (p: Player) => {
	const r = last(p.ratings) as Record<string, any>;
	const fuzzed = fuzzedSkillRow(r, true, p);
	const withTraits = badgeRowOf(p, r);
	for (const key of Object.keys(withTraits)) {
		if (key.startsWith(TRAIT_PREFIX)) {
			fuzzed[key] = withTraits[key];
		}
	}
	return fuzzed;
};

/** The rotation players' rows: the top ROTATION_SIZE by ovr on each team. */
export const rotationRows = (players: readonly Player[]) => {
	const byTid = new Map<number, Record<string, any>[]>();
	for (const p of players) {
		if (p.tid < 0) {
			continue;
		}
		const list = byTid.get(p.tid) ?? [];
		list.push(rowOf(p));
		byTid.set(p.tid, list);
	}
	const out: Record<string, any>[] = [];
	for (const list of byTid.values()) {
		list.sort((a, b) => (b.ovr ?? 0) - (a.ovr ?? 0));
		out.push(...list.slice(0, ROTATION_SIZE));
	}
	return out;
};

export const getTieredBadgeCutoffs = (
	season: number = g.get("season"),
): TieredBadgeCutoffs | undefined => g.get("tieredBadgeCutoffs")?.[season];

// The latest saved cutoffs at or before a season (a player page for a past season, or a league that skipped a recompute)
export const cutoffsAtOrBefore = (season: number) => {
	const all = g.get("tieredBadgeCutoffs");
	if (!all) {
		return undefined;
	}
	let best: TieredBadgeCutoffs | undefined;
	for (const c of Object.values(all)) {
		if (c.season <= season && (!best || c.season > best.season)) {
			best = c;
		}
	}
	return best;
};

const saveCutoffs = async (cutoffs: TieredBadgeCutoffs) => {
	const all = { ...g.get("tieredBadgeCutoffs") };
	all[cutoffs.season] = cutoffs;
	for (const key of Object.keys(all)) {
		if (Number(key) <= cutoffs.season - CUTOFF_HISTORY) {
			delete all[Number(key)];
		}
	}
	await setGameAttributes({ tieredBadgeCutoffs: all });
};

// Last season's tiers (only an entry of the season before: an older one says nothing about now), for hysteresis and the one-tier
// drop. display: the tiers shown (from the scouted ratings) instead of the sim's
const prevTiers = (p: Player, season: number, display = false) => {
	const e = entryForSeason(p.badges2k, season - 1);
	return e ? (display ? displayTiersOf(e) : e.t) : undefined;
};

/**
 * Live shown tiers for a row with no stored badges (a draft prospect, a stashed player, the draft histories' "at the draft" row): his
 * ratings row as shown (player format's, fuzzed as the view asks) with his traits as scouted, the same reading as his player page's
 * (tieredBadgesForPlayer), so the pills in tables and on his page agree.
 */
export const liveShownTiers = (
	p: Player,
	row: Record<string, any>,
	season: number,
	cutoffs: TieredBadgeCutoffs,
) => {
	const r = withShownTraits(p, row, season);
	return assignTiers(r, r.ovr ?? 0, cutoffs, prevTiers(p, season, true)).t;
};

/**
 * Recompute everyone's tiers for the current season (preseason after development, a new league, or the first use in an existing
 * league): new cutoffs from the rotation players, then each player's tiers, at most one Legend per badge.
 */
export const updateTieredBadges = async () => {
	if (!tieredBadgesOn()) {
		return;
	}
	const season = g.get("season");
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.FREE_AGENT,
		Infinity,
	]);
	const rotation = rotationRows(players);
	// From this season's pool whenever there is one (a tiny league's quantiles are noisy, but frozen ones drift away from the
	// league); a copy of the latest saved ones only for a league with no rotation players at all
	const latest = cutoffsAtOrBefore(season);
	const cutoffs =
		rotation.length > 0 || !latest
			? computeCutoffs(rotation, season)
			: { ...latest, season };
	await saveCutoffs(cutoffs);

	const scoresOf = (r: Record<string, any>, t: Record<string, Tier>) => {
		const scores: Record<string, number> = {};
		for (const key of Object.keys(t)) {
			scores[key] = tieredBadgeScore(r, TIERED_BADGES_BY_KEY[key]!);
		}
		return scores;
	};
	// Each set of tiers with last season's (hysteresis, the one-tier floor), re-centered on the tier counts without them
	// (recenterHeldTiers), so held-over badges don't pile up season after season
	const assignAll = (
		rowFor: (p: Player) => Record<string, any>,
		display: boolean,
	) => {
		const out = players.map((p) => {
			const r = rowFor(p);
			const prev = prevTiers(p, season, display);
			const { t, capped } = assignTiers(r, r.ovr ?? 0, cutoffs, prev);
			const fresh = prev ? assignTiers(r, r.ovr ?? 0, cutoffs).t : t;
			return {
				p,
				pid: p.pid,
				t,
				capped,
				fresh,
				scoreOf: (key: string) =>
					tieredBadgeScore(r, TIERED_BADGES_BY_KEY[key]!),
				r,
				scores: {} as Record<string, number>,
			};
		});
		recenterHeldTiers(out);
		for (const x of out) {
			x.scores = scoresOf(x.r, x.t);
		}
		enforceLegendLimit(out);
		return out;
	};
	// The sim's tiers, from the true ratings
	const assigned = assignAll(rowOf, false);
	// The shown tiers, from the ratings as scouted (fuzz), so the pills never give away a true rating
	const shown = assignAll(scoutedRowOf, true);
	for (const [i, { p, t, capped }] of assigned.entries()) {
		const entry: TieredBadgeEntry = { season, t };
		if (capped.length > 0) {
			entry.capped = capped;
		}
		const d = shown[i]!.t;
		if (JSON.stringify(d) !== JSON.stringify(t)) {
			entry.d = d;
		}
		p.badges2k = withTierEntry(p.badges2k, entry);
		await idb.cache.players.put(p);
	}
};

/**
 * One player who entered the league mid-season (imported, created or cloned in God Mode, ratings edited in God Mode): his tiers for the
 * current season against the season's saved cutoffs, like updateTieredBadges gives everyone at the preseason. Without it he had no sim
 * badges and no pills until the next preseason, and his page read live tiers that skipped the one-Legend rule. Legends already held this
 * season stay with their holders: he can't take one mid-season (Hall of Fame instead). Returns whether it stored an entry.
 */
export const refreshTieredBadgesFor = async (p: Player) => {
	if (
		!tieredBadgesOn() ||
		p.tid < PLAYER.FREE_AGENT ||
		p.ratings.length === 0
	) {
		return false;
	}
	const season = g.get("season");
	const cutoffs = getTieredBadgeCutoffs(season);
	if (!cutoffs) {
		// No badges this season yet: ensureTieredBadges computes everyone's, him included
		return false;
	}

	// Legends held by someone else this season (sim and shown tiers separately, as updateTieredBadges enforces them)
	const simLegends = new Set<string>();
	const shownLegends = new Set<string>();
	const others = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.FREE_AGENT,
		Infinity,
	]);
	for (const p2 of others) {
		if (p2.pid === p.pid) {
			continue;
		}
		const e = entryForSeason(p2.badges2k, season);
		if (!e) {
			continue;
		}
		for (const [key, tier] of Object.entries(e.t)) {
			if (tier === 5) {
				simLegends.add(key);
			}
		}
		for (const [key, tier] of Object.entries(displayTiersOf(e))) {
			if (tier === 5) {
				shownLegends.add(key);
			}
		}
	}
	const capLegends = (t: Record<string, Tier>, held: Set<string>) => {
		for (const key of Object.keys(t)) {
			if (t[key] === 5 && held.has(key)) {
				t[key] = 4;
			}
		}
	};

	const r = rowOf(p);
	const { t, capped } = assignTiers(
		r,
		r.ovr ?? 0,
		cutoffs,
		prevTiers(p, season),
	);
	capLegends(t, simLegends);
	const shownRow = scoutedRowOf(p);
	const d = assignTiers(
		shownRow,
		shownRow.ovr ?? 0,
		cutoffs,
		prevTiers(p, season, true),
	).t;
	capLegends(d, shownLegends);

	const entry: TieredBadgeEntry = { season, t };
	if (capped.length > 0) {
		entry.capped = capped;
	}
	if (JSON.stringify(d) !== JSON.stringify(t)) {
		entry.d = d;
	}
	p.badges2k = withTierEntry(p.badges2k, entry);
	await idb.cache.players.put(p);
	return true;
};

/** A league with no badges for this season (an older league, or a season the preseason skipped): compute its cutoffs and tiers once. Returns whether it did. */
export const ensureTieredBadges = async () => {
	if (tieredBadgesOn() && !getTieredBadgeCutoffs()) {
		await updateTieredBadges();
		return true;
	}
	return false;
};

/** His shown tiers for a season (stored), or undefined. */
export const shownTiersForSeason = (
	p: Pick<Player, "badges2k">,
	season: number,
): TieredBadgeEntry["t"] | undefined => {
	const e = entryForSeason(p.badges2k, season);
	return e ? displayTiersOf(e) : undefined;
};

/** His tiers for a season (stored, the sim's: from true ratings, never shown), or undefined. */
export const tiersForSeason = (
	p: Pick<Player, "badges2k">,
	season: number,
): TieredBadgeEntry["t"] | undefined => entryForSeason(p.badges2k, season)?.t;

/** The game sim's tier array (by TIERED_BADGE_INDEX), or undefined when he has no badges this season. */
export const simTiers = (p: Pick<Player, "badges2k">) => {
	const t = tiersForSeason(p, g.get("season"));
	if (!t) {
		return undefined;
	}
	let any = false;
	const out = new Array<number>(NUM_TIERED_BADGES).fill(0);
	for (const [key, tier] of Object.entries(t)) {
		const i = TIERED_BADGE_INDEX[key];
		if (i !== undefined && tier) {
			out[i] = tier;
			any = true;
		}
	}
	return any ? out : undefined;
};

const INPUT_NAMES: Record<string, string> = {
	hgt: "Height",
	stre: "Strength",
	spd: "Speed",
	jmp: "Jumping",
	endu: "Endurance",
	ins: "Inside Scoring",
	dnk: "Dunks/Layups",
	ft: "Free Throws",
	fg: "Mid Range",
	tp: "Three Pointers",
	oiq: "Offensive IQ",
	diq: "Defensive IQ",
	drb: "Dribbling",
	pss: "Passing",
	reb: "Rebounding",
	wng: "Wingspan",
	pdef: "Perimeter Defense",
	idef: "Interior Defense",
	oreb: "Offensive Rebounding",
	dreb: "Defensive Rebounding",
	bsc: "Ball Security",
};
export const inputName = (key: string) => {
	const i = SUB_INDEX[key];
	return i !== undefined ? SUB_DEFS[i]!.name : (INPUT_NAMES[key] ?? key);
};

export type TieredBadgeView = {
	key: string;
	short: string;
	name: string;
	meaning: string;
	category: string;
	tier: Tier;
	tierName: string;
	// The ratings that drive it (as scouted), with values unless ratings are hidden
	drivers: { name: string; value?: number }[];
	// Progress to the next tier (0-1) and the score (as scouted); undefined at Legend or with ratings hidden
	progress?: number;
	nextTierName?: string;
	score?: number;
	capped?: boolean;
};

export type PlayerTieredBadges = {
	season: number;
	// No stored entry for the season: read live from his ratings and the latest cutoffs
	live: boolean;
	points: number;
	// The ovr cap (undefined with ratings hidden)
	cap?: number;
	max: number;
	// His badges (at most MAX_BADGES), best first
	earned: TieredBadgeView[];
	// Not earned: the badges he is closest to (as scouted), with the tier he is working toward. tier is that target tier
	nextUp: TieredBadgeView[];
	history: {
		season: number;
		badges: { short: string; name: string; tier: Tier }[];
	}[];
};

// "Next up" on the player page
const NUM_NEXT_UP = 3;
// Closer than this to Bronze (progress toward it, see progressToNext) to be listed
const NEXT_UP_MIN_PROGRESS = 0.6;

/** Everything the player page's Badges section shows. */
export const tieredBadgesForPlayer = async (
	p: Player,
	hideRatings: boolean,
	season: number = g.get("season"),
): Promise<PlayerTieredBadges | undefined> => {
	if (!tieredBadgesOn()) {
		return undefined;
	}
	await ensureTieredBadges();
	const pr = p.ratings.findLast((r) => r.season === season) ?? last(p.ratings);
	if (!pr) {
		return undefined;
	}
	const cutoffs = cutoffsAtOrBefore(season) ?? getTieredBadgeCutoffs();
	const stored = entryForSeason(p.badges2k, season);
	let t = stored ? displayTiersOf(stored) : undefined;
	let live = false;
	const shown = shownBadgeRow(p, pr as any, season);
	if (!t && cutoffs && p.tid !== PLAYER.RETIRED) {
		// A draft prospect: from his ratings as scouted (as in the tables, player format), never his true ones
		// (always from his ratings as scouted, like the stored shown tiers: a draft prospect's or a stashed player's true ratings
		// never show through)
		t = assignTiers(
			shown,
			shown.ovr ?? 0,
			cutoffs,
			prevTiers(p, season, true),
		).t;
		live = true;
	}
	if (!t) {
		return undefined;
	}
	const capped = new Set(stored?.capped ?? []);
	const view = (
		key: string,
		tier: Tier,
		progressTier: Tier,
	): TieredBadgeView => {
		const def = TIERED_BADGES_BY_KEY[key]!;
		const cuts = cutoffs?.c[def.key];
		const score = tieredBadgeScore(shown, def);
		const progress =
			!hideRatings && cuts
				? progressToNext(score, cuts, progressTier)
				: undefined;
		return {
			key: def.key,
			short: def.short,
			name: def.name,
			meaning: def.meaning,
			category: CATEGORY_NAMES[def.category],
			tier,
			tierName: TIER_NAMES[tier],
			drivers: badgeDrivers(def)
				.slice(0, 3)
				.map((k) => ({
					name: inputName(k),
					value: hideRatings ? undefined : Math.round(tbValue(shown, k)),
				})),
			progress,
			nextTierName: progressTier < 5 ? TIER_NAMES[progressTier + 1] : undefined,
			score: hideRatings ? undefined : Math.round(score),
			capped: capped.has(def.key) || undefined,
		};
	};
	const earned = sortedBadges(t).map(({ key, tier }) => view(key, tier, tier));

	// Next up: from the ratings as scouted, badges he isn't credited with that he qualifies for (left out by the cap or the limit of
	// MAX_BADGES) or is close to Bronze in. Only for the current season, and never for a retired player
	let nextUp: TieredBadgeView[] = [];
	if (cutoffs && p.tid !== PLAYER.RETIRED && season === g.get("season")) {
		const qualified = new Map(
			tierCandidates(shown, cutoffs).map((c) => [c.key, c]),
		);
		const options: { key: string; target: Tier; closeness: number }[] = [];
		for (const def of TIERED_BADGES) {
			if (t[def.key]) {
				continue;
			}
			const c = qualified.get(def.key);
			if (c) {
				options.push({ key: def.key, target: c.tier, closeness: c.depth });
				continue;
			}
			const cuts = cutoffs.c[def.key];
			if (!cuts || !gatesMet(shown, def, cutoffs)) {
				continue;
			}
			const progress = progressToNext(tieredBadgeScore(shown, def), cuts, 0);
			if (progress !== undefined && progress >= NEXT_UP_MIN_PROGRESS) {
				options.push({ key: def.key, target: 1, closeness: progress });
			}
		}
		options.sort((a, b) => b.closeness - a.closeness);
		nextUp = options
			.slice(0, NUM_NEXT_UP)
			// No visible ratings: no order that would rank his hidden ratings
			.sort((a, b) =>
				hideRatings
					? TIERED_BADGE_INDEX[a.key]! - TIERED_BADGE_INDEX[b.key]!
					: 0,
			)
			.map(({ key, target }) => {
				const v = view(key, target, (target - 1) as Tier);
				return { ...v, capped: undefined };
			});
	}

	const history = (p.badges2k ?? []).map((e) => ({
		season: e.season,
		badges: sortedBadges(displayTiersOf(e)).map(({ key, tier }) => {
			const def = TIERED_BADGES_BY_KEY[key]!;
			return { short: def.short, name: def.name, tier };
		}),
	}));
	return {
		season,
		live,
		points: badgePoints(t),
		cap: hideRatings ? undefined : badgePointCap(shown.ovr ?? 0),
		max: MAX_BADGES,
		earned,
		nextUp,
		history,
	};
};
