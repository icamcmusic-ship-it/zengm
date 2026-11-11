import { featureOn } from "../../util/nativeFeatures.ts";
import { PLAYER } from "../../../common/constants.ts";
import {
	ARCHETYPES,
	DEFAULT_NORMS,
	DEFAULT_NORMS_EXPANDED,
	buildNorms,
	classify,
	currentEntry,
	explain,
	toStored,
	viewOf,
	withEntry,
	type ArchetypeRatings,
	type ArchetypeView,
	type Classification,
	type Norms,
	type StoredArchetype,
} from "../../../common/archetypes/index.ts";
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
import { TWO_K_NAMES } from "../../../common/archetypes/twoK/twoK.data.ts";

// The archetype a player has is DERIVED from his ratings (src/common/archetypes), but it is STORED on him (p.archetypes) at
// the start of every preseason, so what the UI shows stays fixed between preseasons. Prospects, and players who have no entry
// yet (an older league, a custom file without one), fall back to a live classification until they get one.

const MIN_LEAGUE_FOR_NORMS = 120;

// Ratings as the user's scouts see them: scouting fuzz on everything but height, like the skills and positions shown
export const ratingsForArchetype = (
	p: Player,
): ArchetypeRatings | undefined => {
	if (__SPORT !== "basketball") {
		return undefined;
	}
	const row = last(p.ratings) as any;
	if (!row || row.hgt === undefined) {
		return undefined;
	}
	const fuzz = getFuzz(row.fuzz ?? 0);
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
	return out;
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
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(all)) {
		if (
			TRAIT_DEFINITIONS[k as keyof typeof TRAIT_DEFINITIONS]?.visibility ===
				"visible" &&
			typeof v === "number"
		) {
			out[k] = v;
		}
	}
	return out;
};

// The settings a stored label depends on: one that needs player traits or expanded ratings is replaced once that is off
const viewContext = () => ({
	traits: traitsEnabled(),
	expanded: expandedRatingsOn(),
});

// His position as the game shows it now
const posNow = (p: Player): unknown => (last(p.ratings) as any)?.pos;

let normsCache: { key: string; norms: Norms } | undefined;

export const resetArchetypeNorms = () => {
	normsCache = undefined;
};

// The league's own distribution (everyone on a roster or in free agency), rebuilt when the season or phase moves on, or when
// asked. A tiny league falls back to the built-in reference league.
export const getLeagueNorms = async (force = false): Promise<Norms> => {
	const expanded = expandedRatingsOn();
	const key = `${g.get("lid")}:${g.get("season")}:${g.get("phase")}:${expanded}`;
	if (!force && normsCache?.key === key) {
		return normsCache.norms;
	}
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.FREE_AGENT,
		Infinity,
	]);
	const rows: { ratings: ArchetypeRatings; ovr: number; pos?: string }[] = [];
	for (const p of players) {
		const ratings = ratingsForArchetype(p);
		if (ratings) {
			rows.push({
				ratings,
				ovr: (last(p.ratings) as any).ovr ?? ovr(last(p.ratings) as any),
				pos: (last(p.ratings) as any).pos,
			});
		}
	}
	// The reference league (and its calibration) for the ratings the league has: with Expanded Ratings on, the one generated
	// with the setting on
	const reference = expanded ? DEFAULT_NORMS_EXPANDED : DEFAULT_NORMS;
	const norms =
		rows.length >= MIN_LEAGUE_FOR_NORMS
			? {
					...buildNorms(rows, ARCHETYPES, reference),
					bias: reference.bias,
				}
			: reference;
	normsCache = { key, norms };
	return norms;
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
	// His position comes from the true ratings, as the game shows it
	return classify(shown, { norms, pos: posFn(ratings as any) }).label;
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
	// His position as the game shows it is the prior, so the fuzzed ratings scouts see cannot push him into a group his
	// listed position rules out
	// His age picks out veterans (and keeps a 30 year old from reading as a raw prospect)
	const age =
		typeof row.season === "number" && typeof p.born?.year === "number"
			? row.season - p.born.year
			: undefined;
	return classify(ratings, {
		norms,
		ovr: row.ovr,
		previousId,
		pos: row.pos,
		age,
		traits:
			typeof row.season === "number"
				? archetypeTraits(p, row.season)
				: undefined,
	});
};

// Write this season's entry (replacing one for the same season). Returns true if the primary archetype changed.
export const storeArchetype = (p: Player, norms: Norms): boolean => {
	if (!featureOn("archetypes")) {
		return false;
	}
	const c = classifyPlayer(p, norms, currentEntry(p.archetypes)?.id);
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
	const live = viewOf(toStored(season, c));
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
			viewContext(),
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
	secondaryName?: string;
	label: string;
	desc: string;
	group: ArchetypeView["group"];
	tier?: ArchetypeView["tier"];
	conf?: number;
	// Season the label was set (the preseason it belongs to); undefined when it is a live reading
	season?: number;
	live: boolean;
	why: { label: string; z: number; want: number }[];
	// NBA 2K builds that read as this archetype (twoK/convert2k.script.test.ts)
	twoK?: string[];
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
	const why = ratings
		? explain(found.view.id, ratings, norms).map((w) => ({
				label: w.label,
				z: w.z,
				want: w.want,
			}))
		: [];
	const v = found.view;
	return {
		id: v.id,
		name: v.name,
		secondaryName: v.secondaryName,
		label: v.label,
		desc: v.desc,
		group: v.group,
		tier: v.tier,
		conf: v.conf,
		season: found.stored ? v.season : undefined,
		live: !found.stored,
		why,
		twoK: TWO_K_NAMES[v.id],
	};
};

export type { StoredArchetype };
