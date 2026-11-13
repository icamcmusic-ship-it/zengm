import { featureOn } from "../../util/nativeFeatures.ts";
import { PLAYER } from "../../../common/constants.ts";
import {
	SCORING_ARCHETYPES,
	DEFAULT_NORMS,
	DEFAULT_NORMS_EXPANDED,
	buildNorms,
	classify,
	currentEntry,
	isStale,
	explain,
	archetypeById,
	toStored,
	viewOf,
	withEntry,
	type ArchetypeRatings,
	type ArchetypeView,
	type Classification,
	type Norms,
	type StoredArchetype,
} from "../../../common/archetypes/index.ts";
import { whyDrivers, whyLine } from "../../../common/archetypes/whyText.ts";
import { VISIBLE_TRAITS } from "../../../common/archetypes/classify.ts";
import { RATING_KEYS } from "../../../common/ratingsBuilds/solver.ts";
import type { Player } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { applyFuzz, getFuzz } from "./fuzzRating.ts";
import ovr from "./ovr.ts";
import posFn from "./pos.ts";
import { expandedRatingsOn, expandedRatingsApply } from "./expandedRatings.ts";
import {
	EXPANDED_RATINGS2,
	hasExpandedRatings,
} from "../../../common/expandedRatings.ts";
import {
	getBadgeScoutingLevel,
	getBadgeTraits,
	traitsEnabled,
} from "./traits.ts";
import { TRAIT_DEFINITIONS } from "../../../common/playerTraits/definitions.ts";
import {
	buildStatNorms,
	multiSeasonStats,
	seasonStats,
	statReading,
	type StatReading,
} from "../../../common/archetypes/stats.ts";
import { DEFAULT_STAT_NORMS } from "../../../common/archetypes/statNorms.data.ts";
import type {
	ArchetypeStats,
	Pos,
	StatNorms,
} from "../../../common/archetypes/types.ts";
import { isPos } from "../../../common/archetypes/position.ts";
import { POS_BUCKET } from "../../../common/archetypes/norms.ts";
import {
	buildPtNorms,
	buildSubNorms,
	playTypesOf,
	ptFeatures,
	type PlayTypes,
	type PtNorms,
	combinePlayTypes,
} from "../../../common/archetypes/subStyle.ts";
import { isValidSubArray } from "../../../common/subRatings.ts";
import { fuzzSubs, subRatingsOn } from "./subRatings.ts";
import { playTypeProfile, sumAdv } from "../../../common/advStats.ts";

// The archetype a player has is DERIVED from his ratings (src/common/archetypes), but it is STORED on him (p.archetypes) at
// the start of every preseason, so what the UI shows stays fixed between preseasons. Prospects, and players who have no entry
// yet (an older league, a custom file without one), fall back to a live classification until they get one.

const MIN_LEAGUE_FOR_NORMS = 120;

// The ratings a label is read from. Scouting fuzz in BBGM is one offset added to every rating but height, so it hardly
// changes the shape of a player's game, which is what a build is; read from the fuzzed ratings, a label could still flip
// when a new season's fuzz is drawn. So a player's label is read from his true ratings (fuzz removed), for every team:
// the shape barely depends on it, and the label shows no number, so it gives away little (at most a hint, through the part
// of the reading that is his absolute standing at his position, of which way the fuzz goes). Draft prospects are the
// exception: scouting them is part of the game, and their fuzz is large, so they are read from the ratings as the user's
// scouts see them (`fuzzed`).
export const ratingsForArchetype = (
	p: Player,
	fuzzed = p.tid === PLAYER.UNDRAFTED,
): ArchetypeRatings | undefined => {
	if (__SPORT !== "basketball") {
		return undefined;
	}
	const row = last(p.ratings) as any;
	if (!row || row.hgt === undefined) {
		return undefined;
	}
	const fuzz = fuzzed ? getFuzz(row.fuzz ?? 0) : 0;
	const out = {} as ArchetypeRatings;
	for (const key of RATING_KEYS) {
		out[key] = key === "hgt" ? row[key] : applyFuzz(row[key], fuzz);
	}
	// Expanded ratings, when the setting is on: interior/perimeter defense for the defensive labels, wingspan for rim protection and
	// length (wingspan is a measurement, never fuzzed)
	if (expandedRatingsApply(row)) {
		out.wng = row.wng;
		out.pdef = applyFuzz(row.pdef, fuzz);
		out.idef = applyFuzz(row.idef, fuzz);
		for (const key of EXPANDED_RATINGS2) {
			out[key] = applyFuzz(row[key], fuzz);
		}
	}
	// arch15: his sub-ratings, with the Sub-Ratings setting on (a prospect's as scouted)
	if (subRatingsOn() && isValidSubArray(row.sub)) {
		out.sub = fuzzed ? fuzzSubs(row.sub, row.fuzz, p) : row.sub;
	}
	return out;
};

// arch15: his play types (Advanced Tracking Stats) over the same seasons as his box score (subStyle.ts combinePlayTypes), or
// undefined with the setting off or no tracked possessions
export const archetypePlayTypes = (
	p: Player,
	season: number,
): PlayTypes | undefined => {
	if (
		!featureOn("advStats") ||
		p.tid === PLAYER.UNDRAFTED ||
		!Array.isArray(p.stats)
	) {
		return undefined;
	}
	const rows = (p.stats as any[]).filter((r) => !r.playoffs);
	return combinePlayTypes(
		[1, 2, 3].map((k) =>
			playTypesOf(
				playTypeProfile(sumAdv(rows.filter((r) => r.season === season - k))),
			),
		),
	);
};

// His box-score stats for the reading: the last three regular seasons before `season`, the older ones counting less
// (stats.ts multiSeasonStats; labels are stored at the preseason, from the seasons just played, and a live reading uses the
// same seasons, so the two agree). Shot zones come with the league's own games. None for a prospect.
export const archetypeStats = (
	p: Player,
	season: number,
): ArchetypeStats | undefined => {
	if (p.tid === PLAYER.UNDRAFTED || !Array.isArray(p.stats)) {
		return undefined;
	}
	const rows = (p.stats as any[]).filter((r) => !r.playoffs);
	return multiSeasonStats(
		[1, 2, 3].map((k) => rows.filter((r) => r.season === season - k)),
	);
};

// The last regular season alone (the league's stat references are built from one season)
const lastSeasonStats = (
	p: Player,
	season: number,
): ArchetypeStats | undefined => {
	if (p.tid === PLAYER.UNDRAFTED || !Array.isArray(p.stats)) {
		return undefined;
	}
	return seasonStats(
		(p.stats as any[]).filter((r) => !r.playoffs && r.season === season - 1),
	);
};

// His player traits as the user sees them (the playerTraits setting): only visible traits, as the scouted estimate for a
// prospect (never hidden traits or the aging curve). Undefined with traits off: trait labels are then never picked.
export const archetypeTraits = (
	p: Player,
	season: number,
): Record<string, number> | undefined => {
	if (!traitsEnabled()) {
		return undefined;
	}
	const all = getBadgeTraits(p as any, season, getBadgeScoutingLevel());
	if (!all) {
		return undefined;
	}
	// arch14 (user request): hidden traits too. The trait-flavored labels and tie-breaks still read only the visible ones
	// (classify.ts visibleTraits); the fitted trait terms read every trait (score.ts TRAIT_GROUPS), so a label may hint at a
	// hidden trait, which the user accepted
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(all)) {
		if (k in TRAIT_DEFINITIONS && typeof v === "number") {
			out[k] = v;
		}
	}
	return out;
};

// The settings a stored label depends on: one that needs player traits or expanded ratings is replaced once that is off
// (`current`: as his current label, which an entry from an older reading is not)
const viewContext = (current = true) => ({
	traits: traitsEnabled(),
	expanded: expandedRatingsOn(),
	current,
});

// His position as the game shows it now
const posNow = (p: Player): unknown => (last(p.ratings) as any)?.pos;

let normsCache:
	| {
			key: string;
			norms: Norms;
			statNorms: StatNorms;
			ptNorms: Partial<PtNorms>;
	  }
	| undefined;

export const resetArchetypeNorms = () => {
	normsCache = undefined;
};

// The league's own distribution (everyone on a roster or in free agency), rebuilt when the season or phase moves on, or when
// asked. A tiny league falls back to the built-in reference league.
export const getLeagueNorms = async (force = false): Promise<Norms> => {
	const expanded = expandedRatingsOn();
	const key = `${g.get("lid")}:${g.get("season")}:${g.get("phase")}:${expanded}:${subRatingsOn()}:${featureOn("advStats")}`;
	if (!force && normsCache?.key === key) {
		return normsCache.norms;
	}
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.FREE_AGENT,
		Infinity,
	]);
	const rows: {
		ratings: ArchetypeRatings;
		ovr: number;
		pos?: string;
		age?: number;
	}[] = [];
	const statRows: { stats: ArchetypeStats; pos: Pos }[] = [];
	const ptRows: { pt: PlayTypes; bucket: (typeof POS_BUCKET)[Pos] }[] = [];
	const season = g.get("season");
	const advOn = featureOn("advStats");
	for (const p of players) {
		const ratings = ratingsForArchetype(p);
		if (ratings) {
			const pos = (last(p.ratings) as any).pos;
			rows.push({
				ratings,
				ovr: (last(p.ratings) as any).ovr ?? ovr(last(p.ratings) as any),
				pos,
				age: season - p.born.year,
			});
			const st = lastSeasonStats(p, season);
			if (st && isPos(pos)) {
				statRows.push({ stats: st, pos });
			}
			if (advOn && isPos(pos) && Array.isArray(p.stats)) {
				const pt = playTypesOf(
					playTypeProfile(
						sumAdv(
							(p.stats as any[]).filter(
								(r) => !r.playoffs && r.season === season - 1,
							),
						),
					),
				);
				if (pt) {
					ptRows.push({ pt, bucket: POS_BUCKET[pos] });
				}
			}
		}
	}
	// The reference league (and its calibration) for the ratings the league has: with Expanded Ratings on, the one generated
	// with the setting on
	const reference = expanded ? DEFAULT_NORMS_EXPANDED : DEFAULT_NORMS;
	const norms: Norms =
		rows.length >= MIN_LEAGUE_FOR_NORMS
			? {
					// (arch15: a table per scoring profile, classify.ts SCORING_ARCHETYPES)
					...buildNorms(rows, SCORING_ARCHETYPES, reference),
					bias: reference.bias,
					// (a league holds one draft class or two: prospects are read against the reference prospects)
					prospect: reference.prospect,
				}
			: { ...reference };
	// arch15: how the league's sub-ratings sit around their bases (real players' shapes from their stats are smaller than
	// generated ones: each is read against the league it is in)
	const subNorms = subRatingsOn()
		? buildSubNorms(rows.map((r) => r.ratings))
		: undefined;
	if (subNorms) {
		norms.sub = subNorms;
	}
	// Stat references from the league's own last season (with the shot zones its games record), when enough players have
	// real minutes in every position bucket; else the real NBA's
	const own = buildStatNorms(statRows);
	const statNorms: StatNorms = {} as StatNorms;
	for (const b of ["PG", "SG", "W", "F", "C"] as const) {
		const n = statRows.filter(
			(r) => r.stats.min >= 500 && POS_BUCKET[r.pos] === b,
		).length;
		statNorms[b] = n >= 30 ? own[b]! : DEFAULT_STAT_NORMS[b];
	}
	normsCache = { key, norms, statNorms, ptNorms: buildPtNorms(ptRows) };
	return norms;
};

const currentStatNorms = () => normsCache?.statNorms ?? DEFAULT_STAT_NORMS;

// How he is read beyond his ratings: his age, his stats from the last season (StatReading) and whether he is a prospect
export const readOptionsFor = (
	p: Player,
	pos: Pos,
	season: number,
): {
	age?: number;
	stats?: StatReading;
	prospect?: boolean;
	pt?: ReturnType<typeof ptFeatures>;
} => {
	const prospect =
		p.tid === PLAYER.UNDRAFTED || p.tid === PLAYER.UNDRAFTED_FANTASY_TEMP;
	if (prospect) {
		return { prospect: true };
	}
	// arch15: his play types against his position's peers in this league (none without tracking stats or a league table)
	const pt = archetypePlayTypes(p, season);
	const ptRead = pt
		? ptFeatures(pt, normsCache?.ptNorms[POS_BUCKET[pos]])
		: undefined;
	return {
		age: season - p.born.year,
		stats: statReading(archetypeStats(p, season), pos, currentStatNorms()),
		...(ptRead ? { pt: ptRead } : {}),
	};
};

// The label for ratings as scouts see them (fuzzed), used where ratings are not on a stored player yet
export const fuzzedArchetypeLabel = (
	ratings: ArchetypeRatings,
	fuzz: number,
	norms: Norms,
): string => {
	const f = getFuzz(fuzz);
	const shown = {} as ArchetypeRatings;
	for (const key of RATING_KEYS) {
		shown[key] = key === "hgt" ? ratings[key] : applyFuzz(ratings[key], f);
	}
	if (hasExpandedRatings(ratings) && expandedRatingsOn()) {
		shown.wng = ratings.wng;
		shown.pdef = applyFuzz(ratings.pdef!, f);
		shown.idef = applyFuzz(ratings.idef!, f);
		for (const key of EXPANDED_RATINGS2) {
			shown[key] = applyFuzz(ratings[key]!, f);
		}
	}
	// (arch15: his sub-ratings as scouted)
	if (subRatingsOn() && isValidSubArray(ratings.sub)) {
		shown.sub = fuzzSubs(ratings.sub, fuzz);
	}
	// His position comes from the true ratings, as the game shows it; a prospect is read against the prospect tables
	return classify(shown, {
		norms,
		pos: posFn(ratings as any),
		prospect: true,
	}).label;
};

export const classifyPlayer = (
	p: Player,
	norms: Norms,
	previousId?: string,
): Classification | undefined => {
	const ratings = ratingsForArchetype(p);
	if (!ratings) {
		return undefined;
	}
	const row = last(p.ratings) as any;
	const season =
		typeof row.season === "number" ? (row.season as number) : g.get("season");
	const pos: Pos = isPos(row.pos) ? row.pos : "F";
	// His position as the game shows it decides which builds he may have
	return classify(ratings, {
		norms,
		ovr: row.ovr,
		previousId,
		pos: isPos(row.pos) ? row.pos : undefined,
		traits:
			typeof row.season === "number"
				? archetypeTraits(p, row.season)
				: undefined,
		...readOptionsFor(p, pos, season),
	});
};

// Write this season's entry (replacing one for the same season). Returns true if the primary archetype changed.
export const storeArchetype = (p: Player, norms: Norms): boolean => {
	if (!featureOn("archetypes")) {
		return false;
	}
	// (a label from an older reading is not kept by stickiness: he is read afresh)
	const prev = currentEntry(p.archetypes);
	const c = classifyPlayer(
		p,
		norms,
		prev && !isStale(prev) ? prev.id : undefined,
	);
	if (!c) {
		return false;
	}
	const season = (last(p.ratings) as any).season as number;
	const before = currentEntry(p.archetypes)?.id;
	p.archetypes = withEntry(p.archetypes, toStored(season, c));
	return before !== c.id;
};

// Everyone at the start of a preseason (after development): the label that holds until the next one
export const updateArchetypesForPreseason = async (players: Player[]) => {
	if (__SPORT !== "basketball" || !featureOn("archetypes")) {
		return;
	}
	const norms = await getLeagueNorms(true);
	for (const p of players) {
		if (p.tid === PLAYER.RETIRED || p.tid === PLAYER.UNDRAFTED) {
			continue;
		}
		storeArchetype(p, norms);
		await idb.cache.players.put(p);
	}
};

// New league: everyone gets a first entry
export const initArchetypesForNewLeague = async () => {
	if (__SPORT !== "basketball" || !featureOn("archetypes")) {
		return;
	}
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.FREE_AGENT,
		Infinity,
	]);
	const norms = await getLeagueNorms(true);
	for (const p of players) {
		if (!p.archetypes || p.archetypes.length === 0) {
			storeArchetype(p, norms);
			await idb.cache.players.put(p);
		}
	}
};

// What to show for a player: his stored entry, or a live classification when he has none (prospects always, since their
// ratings can still be regenerated). `stored` says which it was.
export const archetypeFor = (
	p: Player,
	norms: Norms,
):
	| { view: ArchetypeView; stored: boolean; classification?: Classification }
	| undefined => {
	if (!featureOn("archetypes")) {
		return undefined;
	}
	const isProspect =
		p.tid === PLAYER.UNDRAFTED || p.tid === PLAYER.UNDRAFTED_FANTASY_TEMP;
	const entry = isProspect ? undefined : currentEntry(p.archetypes);
	// An entry his position no longer allows (stored by an older version) is read live until the next preseason
	const v = viewOf(entry, posNow(p), viewContext());
	if (v) {
		return { view: v, stored: true };
	}
	const c = classifyPlayer(p, norms);
	if (!c) {
		return undefined;
	}
	const season = (last(p.ratings) as any).season as number;
	const live = viewOf(toStored(season, c), posNow(p));
	return live ? { view: live, stored: false, classification: c } : undefined;
};

// The label to show for a player in a given season: the entry in force then, else (current season or prospect) a live reading
export const archetypeLabelAt = (
	p: Player,
	season: number,
	norms: Norms,
): string | undefined => {
	if (!featureOn("archetypes")) {
		return undefined;
	}
	const isProspect =
		p.tid === PLAYER.UNDRAFTED || p.tid === PLAYER.UNDRAFTED_FANTASY_TEMP;
	if (!isProspect) {
		const v = viewOf(
			currentEntry(p.archetypes, season),
			(p.ratings as any[]).findLast((r) => r.season <= season)?.pos,
			viewContext(season >= g.get("season")),
		);
		if (v) {
			return v.label;
		}
	}
	if (isProspect || season >= g.get("season")) {
		return archetypeFor(p, norms)?.view.label;
	}
	return undefined;
};

export type PlayerArchetypeInfo = {
	id: string;
	name: string;
	label: string;
	desc: string;
	group: ArchetypeView["group"];
	tier?: ArchetypeView["tier"];
	conf?: number;
	// Season the label was set (the preseason it belongs to); undefined when it is a live reading
	season?: number;
	live: boolean;
	why: { label: string; z: number; want: number }[];
	// arch16: one short line citing what drove the pick (common/archetypes/whyText.ts)
	whyText?: string;
};

// Everything the player page shows. A non-prospect with no entry gets one stored here, once.
export const archetypeInfoForPlayer = async (
	p: Player,
): Promise<PlayerArchetypeInfo | undefined> => {
	if (__SPORT !== "basketball" || !featureOn("archetypes")) {
		return undefined;
	}
	const norms = await getLeagueNorms();
	const isProspect =
		p.tid === PLAYER.UNDRAFTED || p.tid === PLAYER.UNDRAFTED_FANTASY_TEMP;
	// No entry yet, or one that is no longer valid for his position (or an archetype that no longer exists): store a new one
	if (
		!isProspect &&
		p.tid !== PLAYER.RETIRED &&
		!viewOf(currentEntry(p.archetypes), posNow(p), viewContext())
	) {
		const cached = await idb.cache.players.get(p.pid);
		if (cached) {
			storeArchetype(cached, norms);
			await idb.cache.players.put(cached);
			p = cached;
		}
	}
	const found = archetypeFor(p, norms);
	if (!found) {
		return undefined;
	}
	const ratings = ratingsForArchetype(p);
	const row = last(p.ratings) as any;
	const season =
		typeof row.season === "number" ? (row.season as number) : g.get("season");
	const read = readOptionsFor(p, isPos(row.pos) ? row.pos : "F", season);
	const rows = ratings ? explain(found.view.id, ratings, norms, read) : [];
	const why = rows.map((w) => ({
		label: w.label,
		z: w.z,
		want: w.want,
	}));
	// arch16: the short why line, from what drove the pick (sub-ratings, play types, traits, ratings), with the numbers the
	// user sees (scouting fuzz as on the ratings pages; none under the no-visible-ratings challenge)
	const a = archetypeById(found.view.id);
	let whyText: string | undefined;
	if (ratings && a) {
		const traits = archetypeTraits(p, season);
		whyText = whyLine(
			whyDrivers({
				a,
				ratings,
				norms,
				read,
				rows,
				pt: read.pt ? archetypePlayTypes(p, season) : undefined,
				traits: traits
					? Object.fromEntries(
							Object.entries(traits).filter(([k]) => VISIBLE_TRAITS.has(k)),
						)
					: undefined,
				shown: ratingsForArchetype(p, true),
				hideNumbers: g.get("challengeNoRatings") && p.tid !== PLAYER.RETIRED,
			}),
		);
	}
	const v = found.view;
	return {
		id: v.id,
		name: v.name,
		label: v.label,
		desc: v.desc,
		group: v.group,
		tier: v.tier,
		conf: v.conf,
		season: found.stored ? v.season : undefined,
		live: !found.stored,
		why,
		...(whyText ? { whyText } : {}),
	};
};

export type { StoredArchetype };
