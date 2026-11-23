// 2K Badges (the twoKBadges League Extra, basketball): the worker side. Cutoffs are computed from the rotation players and saved per
// season (game attribute tieredBadgeCutoffs), and every player's tiers are stored per season in p.badges2k, at each preseason after
// development (and once when the setting is first used in a league). Nothing here draws a random number. See common/tieredBadges.
import { PLAYER } from "../../../common/constants.ts";
import {
	CATEGORIES,
	CATEGORY_NAMES,
	CUTOFF_HISTORY,
	MIN_ROTATION,
	NUM_TIERED_BADGES,
	ROTATION_SIZE,
	TIERED_BADGES,
	TIERED_BADGES_BY_KEY,
	TIERED_BADGE_INDEX,
	TIER_NAMES,
	assignTiers,
	badgeDrivers,
	badgePointCap,
	badgePoints,
	computeCutoffs,
	enforceLegendLimit,
	entryForSeason,
	progressToNext,
	tbValue,
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

export const tieredBadgesOn = () =>
	__SPORT === "basketball" && featureOn("twoKBadges");

const rowOf = (p: Player) => last(p.ratings) as Record<string, any>;

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
const cutoffsAtOrBefore = (season: number) => {
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

// Last season's tiers (the latest entry before this season), for hysteresis and the one-tier drop
const prevTiers = (p: Player, season: number) => {
	const entries = p.badges2k;
	if (!entries) {
		return undefined;
	}
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i]!.season < season) {
			return entries[i]!.t;
		}
	}
	return undefined;
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
	const cutoffs =
		rotation.length >= MIN_ROTATION
			? computeCutoffs(rotation, season)
			: (cutoffsAtOrBefore(season) ?? computeCutoffs(rotation, season));
	if (cutoffs.season !== season) {
		cutoffs.season = season;
	}
	await saveCutoffs(cutoffs);

	const assigned = players.map((p) => {
		const r = rowOf(p);
		const { t, capped } = assignTiers(
			r,
			r.ovr ?? 0,
			cutoffs,
			prevTiers(p, season),
		);
		const scores: Record<string, number> = {};
		for (const key of Object.keys(t)) {
			scores[key] = tieredBadgeScore(r, TIERED_BADGES_BY_KEY[key]!);
		}
		return { p, pid: p.pid, t, capped, scores };
	});
	enforceLegendLimit(assigned);
	for (const { p, t, capped } of assigned) {
		const entry: TieredBadgeEntry = { season, t };
		if (capped.length > 0) {
			entry.capped = capped;
		}
		p.badges2k = withTierEntry(p.badges2k, entry);
		await idb.cache.players.put(p);
	}
};

/** First use of the setting in a league (or a season the preseason skipped): compute this season's cutoffs and tiers once. */
export const ensureTieredBadges = async () => {
	if (tieredBadgesOn() && !getTieredBadgeCutoffs()) {
		await updateTieredBadges();
	}
};

/** His tiers for a season (stored), or undefined. */
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
	categories: { key: string; name: string; badges: TieredBadgeView[] }[];
	history: {
		season: number;
		badges: { short: string; name: string; tier: Tier }[];
	}[];
};

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
	let t = stored?.t;
	let live = false;
	if (!t && cutoffs && p.tid !== PLAYER.RETIRED) {
		t = assignTiers(pr, (pr as any).ovr ?? 0, cutoffs, prevTiers(p, season)).t;
		live = true;
	}
	if (!t) {
		return undefined;
	}
	const shown = fuzzedSkillRow(pr, false, p);
	const capped = new Set(stored?.capped ?? []);
	const categories = CATEGORIES.map((cat) => ({
		key: cat,
		name: CATEGORY_NAMES[cat],
		badges: TIERED_BADGES.filter((def) => def.category === cat && t[def.key])
			.map((def): TieredBadgeView => {
				const tier = t[def.key]!;
				const cuts = cutoffs?.c[def.key];
				const score = tieredBadgeScore(shown, def);
				const progress =
					!hideRatings && cuts ? progressToNext(score, cuts, tier) : undefined;
				return {
					key: def.key,
					short: def.short,
					name: def.name,
					meaning: def.meaning,
					tier,
					tierName: TIER_NAMES[tier],
					drivers: badgeDrivers(def)
						.slice(0, 3)
						.map((key) => ({
							name: inputName(key),
							value: hideRatings ? undefined : Math.round(tbValue(shown, key)),
						})),
					progress,
					nextTierName: tier < 5 ? TIER_NAMES[tier + 1] : undefined,
					score: hideRatings ? undefined : Math.round(score),
					capped: capped.has(def.key) || undefined,
				};
			})
			.sort((a, b) => b.tier - a.tier),
	})).filter((c) => c.badges.length > 0);
	const history = (p.badges2k ?? []).map((e) => ({
		season: e.season,
		badges: TIERED_BADGES.filter((def) => e.t[def.key])
			.map((def) => ({ short: def.short, name: def.name, tier: e.t[def.key]! }))
			.sort((a, b) => b.tier - a.tier),
	}));
	return {
		season,
		live,
		points: badgePoints(t),
		cap: hideRatings ? undefined : badgePointCap((pr as any).ovr ?? 0),
		categories,
		history,
	};
};
