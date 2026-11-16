// Worker API for archetypes: a team's roster composition and the league landscape. Everything uses the STORED archetype
// of each player (set at the start of each preseason), with a live reading for prospects and players without one yet.
import { featureOn } from "../util/nativeFeatures.ts";
import { PLAYER } from "../../common/constants.ts";
import {
	archetypeById,
	compositionOf,
	landscapeOf,
	type ArchetypeGroup,
	type Composition,
	type Landscape,
	type Rated,
} from "../../common/archetypes/index.ts";
import { last } from "../../common/utils.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import {
	archetypeFor,
	archetypeLabelSource,
	displayArchetypeLabel,
	archetypeTraits,
	classifyPlayer,
	getLeagueNorms,
	ratingsForArchetype,
	readOptionsFor,
	tunedModelFor,
} from "../core/player/archetype.ts";
import {
	getGlobalFeedback,
	leagueFeedback,
	overrideFor,
	refitArchetypeTuning,
	saveGlobalFeedback,
	saveLeagueFeedback,
	scheduleRefit,
	tuningPicks,
} from "../core/player/archetypeFeedback.ts";
import {
	ARCHETYPES,
	ARCHETYPE_READING_VERSION,
	currentEntry,
	scoreAll,
	type Archetype,
} from "../../common/archetypes/index.ts";
import { BLOCKED_Z, modelFor } from "../../common/archetypes/classify.ts";
import { FAMILY_NAMES, familyOf } from "../../common/archetypes/families.ts";
import { nameAt } from "../../common/archetypes/posNames.ts";
import { isPos } from "../../common/archetypes/position.ts";
import type { Pos } from "../../common/archetypes/types.ts";
import { hasExpandedRatings } from "../../common/expandedRatings.ts";
import {
	MIN_PICKS_GLOBAL,
	describeTuning,
	TUNING_FILE_KIND,
	fromPickFile,
	fromTuningFile,
	mergePicks,
	snapshotRows,
	toPickFile,
	toTuningFile,
	type FeedbackPick,
	type PickFile,
	type TuningFile,
} from "../../common/archetypes/tuning.ts";
import { traitsEnabled } from "../core/player/traits.ts";
import { expandedRatingsOn } from "../core/player/expandedRatings.ts";
import { TWO_K_NAMES } from "../../common/archetypes/defs.data.ts";
import { user2kLabel } from "../../common/archetypes/twoK/user2kLookup.ts";

export type ArchetypeRosterPlayer = {
	pid: number;
	name: string;
	pos: string;
	ovr: number;
	label: string;
	group: ArchetypeGroup;
	live: boolean;
};

export type ArchetypeRoster = {
	enabled: boolean;
	composition: Composition;
	players: ArchetypeRosterPlayer[];
};

const EMPTY_COMPOSITION: Composition = {
	counts: [],
	byGroup: { guard: 0, wing: 0, forward: 0, big: 0 },
	byFamily: {},
	warnings: [],
	known: 0,
};

export const archetypeRoster = async ({
	tid,
}: {
	tid: number;
}): Promise<ArchetypeRoster> => {
	if (__SPORT !== "basketball" || !featureOn("archetypes")) {
		return { enabled: false, composition: EMPTY_COMPOSITION, players: [] };
	}
	const norms = await getLeagueNorms();
	const raw = await idb.cache.players.indexGetAll("playersByTid", tid);
	const players: ArchetypeRosterPlayer[] = [];
	const rated: Rated[] = [];
	for (const p of raw) {
		const found = archetypeFor(p, norms);
		const row = last(p.ratings) as any;
		if (!found) {
			continue;
		}
		players.push({
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			pos: row.pos,
			ovr: row.ovr,
			label: displayArchetypeLabel(
				p,
				found.stored ? found.view.season : row.season,
				found.view.label,
			),
			group: found.view.group,
			live: !found.stored,
		});
		rated.push({
			pid: p.pid,
			ovr: row.ovr,
			archetypeId: found.view.id,
		});
	}
	players.sort((a, b) => b.ovr - a.ovr || a.pid - b.pid);
	return { enabled: true, composition: compositionOf(rated), players };
};

export type ArchetypeTopPlayer = {
	pid: number;
	name: string;
	ovr: number;
	abbrev: string;
	// arch2kfix: NBA 2K's archetype for him (a real player in the user's 2K list), with Archetype Label Source not "Game
	// archetypes"
	twoK?: string;
};

export type ArchetypeLandscape = {
	enabled: boolean;
	season: number;
	total: number;
	byGroup: Landscape["byGroup"];
	rows: {
		id: string;
		name: string;
		group: ArchetypeGroup;
		desc: string;
		count: number;
		share: number;
		top: ArchetypeTopPlayer[];
		// Other names for the same archetype (never shown: the table's search finds them)
		aliases: string[];
		// arch2kfix: NBA 2K's archetypes of the real players who hold it (in the user's 2K list, this season): never shown,
		// the table's search finds them
		twoK: string[];
	}[];
};

export const archetypeLandscape = async (): Promise<ArchetypeLandscape> => {
	const season = g.get("season");
	if (__SPORT !== "basketball" || !featureOn("archetypes")) {
		return {
			enabled: false,
			season,
			total: 0,
			byGroup: { guard: 0, wing: 0, forward: 0, big: 0 },
			rows: [],
		};
	}
	const norms = await getLeagueNorms();
	const raw = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.FREE_AGENT,
		Infinity,
	]);
	const abbrevs = new Map<number, string>();
	for (const t of await idb.cache.teams.getAll()) {
		abbrevs.set(t.tid, t.abbrev);
	}
	const rated: (Rated & { name: string; tid: number; twoK?: string })[] = [];
	// (the search finds a build by its holders' 2K archetypes whatever the setting; they are shown only when it asks)
	const showTwoK = archetypeLabelSource() !== "game";
	const twoKById = new Map<string, Set<string>>();
	for (const p of raw) {
		const found = archetypeFor(p, norms);
		if (!found) {
			continue;
		}
		const tk = user2kLabel(p, season);
		if (tk) {
			const set = twoKById.get(found.view.id) ?? new Set<string>();
			set.add(tk);
			twoKById.set(found.view.id, set);
		}
		rated.push({
			pid: p.pid,
			ovr: (last(p.ratings) as any).ovr,
			archetypeId: found.view.id,
			name: `${p.firstName} ${p.lastName}`,
			tid: p.tid,
			...(tk && showTwoK ? { twoK: tk } : {}),
		});
	}
	const landscape = landscapeOf(rated, 3);
	const byPid = new Map(rated.map((r) => [r.pid, r]));

	return {
		enabled: true,
		season,
		total: landscape.total,
		byGroup: landscape.byGroup,
		rows: landscape.byArchetype
			// Labels the league's settings rule out (they need player traits or expanded ratings) are left out
			.filter((r) => {
				const a = archetypeById(r.id)!;
				return (
					r.count > 0 ||
					!(
						(a.trait && !traitsEnabled()) ||
						(a.expanded && !expandedRatingsOn())
					)
				);
			})
			.map((r) => ({
				id: r.id,
				name: r.name,
				group: r.group,
				desc: archetypeById(r.id)!.desc,
				aliases: TWO_K_NAMES[r.id] ?? [],
				twoK: [...(twoKById.get(r.id) ?? [])].sort(),
				count: r.count,
				share: r.share,
				top: r.top.map((t) => {
					const x = byPid.get(t.pid)!;
					return {
						pid: t.pid,
						name: x.name,
						ovr: t.ovr,
						abbrev: x.tid >= 0 ? (abbrevs.get(x.tid) ?? "") : "FA",
						...(x.twoK ? { twoK: x.twoK } : {}),
					};
				}),
			})),
	};
};

// ---- archfb: "Doesn't fit?" feedback and the user's tuning ----

export type FeedbackBuild = {
	id: string;
	name: string;
	desc: string;
	aliases: string[];
	family: string;
};
export type FeedbackOptions = {
	enabled: boolean;
	pid: number;
	shown?: { id: string; name: string };
	// The user's current pick for him, if any
	userPick?: string;
	suggestions: FeedbackBuild[];
	// Every build his position allows (the search)
	all: FeedbackBuild[];
};

const SUGGESTIONS = 8;
const SAME_FAMILY = 4;

// The reading of one player with everything the picker and the snapshot need
const readingOf = async (pid: number) => {
	const p = await idb.cache.players.get(pid);
	if (!p) {
		return undefined;
	}
	const norms = await getLeagueNorms();
	const ratings = ratingsForArchetype(p);
	if (!ratings) {
		return undefined;
	}
	const row = last(p.ratings) as any;
	const season =
		typeof row.season === "number" ? (row.season as number) : g.get("season");
	const pos: Pos = isPos(row.pos) ? row.pos : "F";
	const read = readOptionsFor(p, pos, season);
	const traits = archetypeTraits(p, season);
	const found = archetypeFor(p, norms);
	return { p, norms, ratings, row, season, pos, read, traits, found };
};

const buildOf = (a: Archetype, pos: Pos): FeedbackBuild => ({
	id: a.id,
	name: nameAt(a, pos),
	desc: a.desc,
	aliases: (TWO_K_NAMES[a.id] ?? []).filter((n) => n !== nameAt(a, pos)),
	family: FAMILY_NAMES[familyOf(a)],
});

export const feedbackOptions = async ({
	pid,
}: {
	pid: number;
}): Promise<FeedbackOptions> => {
	const off = { enabled: false, pid, suggestions: [], all: [] };
	if (__SPORT !== "basketball" || !featureOn("archetypes")) {
		return off;
	}
	const r = await readingOf(pid);
	if (!r || !r.found) {
		return off;
	}
	const { scored } = scoreAll(
		r.ratings,
		r.norms,
		ARCHETYPES,
		r.pos,
		r.traits,
		r.read,
		tunedModelFor(r.ratings),
	);
	const shownId = r.found.user
		? (r.found.classification?.id ?? modelLabelOf(r))
		: r.found.view.id;
	const shownA = archetypeById(shownId);
	const open = scored.filter(
		(s) =>
			s.z > BLOCKED_Z &&
			s.a.id !== shownId &&
			!(s.a.trait && !traitsEnabled()) &&
			!(s.a.expanded && !expandedRatingsOn()),
	);
	const fam = shownA ? familyOf(shownA) : undefined;
	const same = open.filter((s) => familyOf(s.a) === fam).slice(0, SAME_FAMILY);
	const rest = open
		.filter((s) => !same.includes(s))
		.slice(0, SUGGESTIONS - same.length);
	// (best first, whatever the family)
	const suggestions = [...same, ...rest]
		.sort((a, b) => b.z - a.z || (a.a.id < b.a.id ? -1 : 1))
		.map((s) => buildOf(s.a, r.pos));
	const all = open
		.map((s) => buildOf(s.a, r.pos))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return {
		enabled: true,
		pid,
		shown: shownA ? { id: shownA.id, name: nameAt(shownA, r.pos) } : undefined,
		userPick: overrideFor(pid),
		suggestions,
		all,
	};
};

// The reading's own label for him (not the user's pick): his stored entry, else a live reading
const modelLabelOf = (r: NonNullable<Awaited<ReturnType<typeof readingOf>>>) =>
	currentEntry(r.p.archetypes)?.id ??
	classifyPlayer(r.p, r.norms)?.id ??
	r.found!.view.id;

export const feedbackSubmit = async ({
	pid,
	id,
	better,
}: {
	pid: number;
	// null: "None of these / I'm not sure"
	id: string | null;
	better?: boolean;
}): Promise<{ ok: boolean; label?: string; message: string }> => {
	if (__SPORT !== "basketball" || !featureOn("archetypes")) {
		return { ok: false, message: "Archetypes are off." };
	}
	const r = await readingOf(pid);
	if (!r || !r.found) {
		return { ok: false, message: "No archetype for this player." };
	}
	const shown = r.found.user ? modelLabelOf(r) : r.found.view.id;
	const a = id === null ? undefined : archetypeById(id);
	if (id !== null && (!a || !a.positions.includes(r.pos))) {
		return { ok: false, message: "That build is not played at his position." };
	}
	const expanded = hasExpandedRatings(r.ratings);
	const ids = [shown, ...(a ? [a.id] : [])];
	const rows = snapshotRows(
		r.ratings,
		r.norms,
		modelFor(expanded),
		ids,
		r.pos,
		r.traits,
		r.read,
	);
	const at = Date.now();
	const pick: FeedbackPick = {
		uid: `${g.get("lid")}-${pid}-${at.toString(36)}`,
		at,
		pid,
		name: `${r.p.firstName} ${r.p.lastName}`,
		season: r.season,
		pos: r.pos,
		shown,
		picked: a ? a.id : null,
		...(better ? { better: true } : {}),
		expanded,
		v: ARCHETYPE_READING_VERSION,
		rows,
		input: {
			ratings: r.ratings,
			pos: r.pos,
			ovr: r.row.ovr,
			...r.read,
			...(r.traits ? { traits: r.traits } : {}),
		},
	};
	const lf = leagueFeedback();
	// (a new pick for the same player replaces his earlier one)
	const prevUid = lf.overrides[String(pid)]?.uid;
	const picks = [...lf.picks.filter((x) => x.uid !== prevUid), pick];
	const overrides = { ...lf.overrides };
	if (a) {
		overrides[String(pid)] = { id: a.id, at, uid: pick.uid };
	} else {
		delete overrides[String(pid)];
	}
	await saveLeagueFeedback({ picks, overrides });
	const glob = await getGlobalFeedback();
	if (glob.enabled) {
		await saveGlobalFeedback({
			...glob,
			picks: mergePicks(
				glob.picks.filter((x) => x.uid !== prevUid),
				[pick],
			),
		});
	}
	await scheduleRefit();
	return a
		? {
				ok: true,
				label: nameAt(a, r.pos),
				message: `Thanks: he now reads as ${nameAt(a, r.pos)}. Your picks tune how similar players are read.`,
			}
		: {
				ok: true,
				message: "Thanks: noted. His label stays as it is.",
			};
};

// Undo / clear the user's pick for a player (his label goes back to the reading)
export const feedbackClear = async ({ pid }: { pid: number }) => {
	const lf = leagueFeedback();
	const o = lf.overrides[String(pid)];
	const overrides = { ...lf.overrides };
	delete overrides[String(pid)];
	const picks = lf.picks.filter((x) => !(o && x.uid === o.uid));
	await saveLeagueFeedback({ picks, overrides });
	if (o) {
		const glob = await getGlobalFeedback();
		await saveGlobalFeedback({
			...glob,
			picks: glob.picks.filter((x) => x.uid !== o.uid),
		});
	}
	await scheduleRefit();
	return { ok: true };
};

export type TuningInfo = {
	enabled: boolean;
	leaguePicks: number;
	globalPicks: number;
	usedPicks: number;
	crossLeague: boolean;
	globalWeights: boolean;
	minPicksGlobal: number;
	changes: string[];
};

export const tuningInfo = async (): Promise<TuningInfo> => {
	const glob = await getGlobalFeedback();
	const t = await refitArchetypeTuning();
	return {
		enabled: __SPORT === "basketball" && featureOn("archetypes"),
		leaguePicks: leagueFeedback().picks.length,
		globalPicks: glob.picks.length,
		usedPicks: t.n,
		crossLeague: glob.enabled,
		globalWeights: t.n >= MIN_PICKS_GLOBAL,
		minPicksGlobal: MIN_PICKS_GLOBAL,
		changes: describeTuning(t, (id) => archetypeById(id)?.name),
	};
};

// "Reset my tuning": forget the picks (this league's, and the browser-wide ones). The players the user picked keep
// their pick until it is cleared on his page.
export const tuningReset = async () => {
	const lf = leagueFeedback();
	await saveLeagueFeedback({ picks: [], overrides: lf.overrides });
	const glob = await getGlobalFeedback();
	await saveGlobalFeedback({ ...glob, picks: [] });
	await refitArchetypeTuning();
	return { ok: true };
};

export const setCrossLeague = async ({ enabled }: { enabled: boolean }) => {
	const glob = await getGlobalFeedback();
	// (turning it on brings this league's picks along)
	await saveGlobalFeedback({
		enabled,
		picks: enabled
			? mergePicks(glob.picks, leagueFeedback().picks)
			: glob.picks,
	});
	await refitArchetypeTuning();
	return { ok: true };
};

// The picks as a file for the developer's offline refit (fit.script.test.ts ARCH_PICKS)
export const tuningExport = async (): Promise<PickFile> =>
	toPickFile(await tuningPicks(), Date.now());

// archuser2k: "Archetype tuning only": the picks (this league's and the browser-wide ones), the per-player overrides,
// the fitted tuning, the reading version and the tuning's hash, and with `snapshots` the reading inputs of every pick
export const tuningExportOnly = async ({
	snapshots = true,
}: { snapshots?: boolean } = {}): Promise<TuningFile> => {
	const lf = leagueFeedback();
	const glob = await getGlobalFeedback();
	const tuning = await refitArchetypeTuning();
	const lid = g.get("lid");
	let name: string | undefined;
	try {
		name = idb.meta ? (await idb.meta.get("leagues", lid))?.name : undefined;
	} catch {}
	return toTuningFile({
		leaguePicks: lf.picks,
		globalPicks: glob.picks,
		overrides: lf.overrides,
		tuning,
		readingVersion: ARCHETYPE_READING_VERSION,
		now: Date.now(),
		snapshots,
		lid,
		leagueName: name,
	});
};

// Import a pick file or a tuning file. A tuning file's league picks join this league's and its browser-wide picks the
// browser-wide store (when that is on); its per-player overrides only apply to the league it was exported from (they are
// per player id), unless `overrides` says otherwise
export const tuningImport = async ({
	file,
	overrides: applyOverrides,
}: {
	file: unknown;
	overrides?: boolean;
}) => {
	const isTuning = (file as any)?.kind === TUNING_FILE_KIND;
	const t = isTuning ? fromTuningFile(file) : undefined;
	const leaguePicks = t ? t.leaguePicks : fromPickFile(file);
	const globalPicks = t ? t.globalPicks : leaguePicks;
	const lf = leagueFeedback();
	const useOverrides =
		t !== undefined && (applyOverrides ?? t.lid === g.get("lid"));
	await saveLeagueFeedback({
		picks: mergePicks(lf.picks, leaguePicks),
		overrides: useOverrides
			? { ...lf.overrides, ...t.overrides }
			: lf.overrides,
	});
	const glob = await getGlobalFeedback();
	if (glob.enabled) {
		await saveGlobalFeedback({
			...glob,
			picks: mergePicks(glob.picks, globalPicks),
		});
	}
	await refitArchetypeTuning();
	return {
		ok: true,
		n: mergePicks(globalPicks, leaguePicks).length,
		overrides: useOverrides ? Object.keys(t.overrides).length : 0,
	};
};

export default {
	landscape: archetypeLandscape,
	roster: archetypeRoster,
	feedbackOptions,
	feedbackSubmit,
	feedbackClear,
	tuningInfo,
	tuningReset,
	setCrossLeague,
	tuningExport,
	tuningExportOnly,
	tuningImport,
};
