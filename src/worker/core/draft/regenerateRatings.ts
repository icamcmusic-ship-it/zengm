import { featureOn } from "../../util/nativeFeatures.ts";
import {
	ensureExpandedRatings,
	setDefenseSplit,
	useExpandedRatings,
} from "../player/expandedRatings.ts";
import { PLAYER } from "../../../common/constants.ts";
import {
	ARCHETYPES,
	RATING_KEYS,
	regenerateClass,
	regenerateOne,
	type BuildRatings,
	type BuildSettings,
	type PlayerInput,
	type PlayerLock,
	type PlayerResult,
} from "../../../common/ratingsBuilds/index.ts";
import type { StoredRatingsBuild } from "../../../common/ratingsBuilds/types.ts";
import type { Player } from "../../../common/types.ts";
import type {
	PlayerRatings,
	RatingKey,
} from "../../../common/types.basketball.ts";
import { last } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import {
	ARCHETYPES as ARCHETYPE_LIST,
	currentEntry,
	viewOf,
	type Norms,
} from "../../../common/archetypes/index.ts";
import { fuzzedArchetypeLabel, getLeagueNorms } from "../player/archetype.ts";
import { g, helpers, toUI } from "../../util/index.ts";
import getLevelLastThree from "../finances/getLevelLastThree.ts";
import fuzzRating from "../player/fuzzRating.ts";
import { ratingsBuildFormulas as F } from "../player/ratingsBuildFormulas.ts";
import updateValues from "../player/updateValues.ts";

// "Regenerate ratings": rebuilds draft prospects (and, through Customize Player, any player) into varied, specialized
// builds without changing anyone's overall. The engine is pure (src/common/ratingsBuilds); this is the plumbing that reads
// prospects, previews, writes the ratings back the way the game's own code would, and undoes it.

// Locks as the UI states them. They are all relative to the player (never absolute true values), so the UI never needs a
// rating, ovr or pot it should not be able to see.
export type UiLock = {
	// Leave him exactly as he is
	skip?: boolean;

	// Force this build (advanced)
	build?: string;

	// Aim at this archetype (an id), the default way to ask for a type of player
	archetype?: string;

	// Ratings to keep exactly where they are
	pinKeys?: RatingKey[];

	// Build him to a different overall / pot than he has
	ovrDelta?: number;
	potDelta?: number;

	// "Reroll just him"
	reroll?: number;
};

export type RegenerateParams = {
	draftYear: number;
	settings: Partial<BuildSettings>;

	// By pid
	locks: Record<number, UiLock>;

	// The prospects to change. null = the whole class. The engine always works out the whole class, so one prospect's
	// result never depends on who else is selected.
	pids: number[] | null;
};

export type PreviewRow = {
	pid: number;
	firstName: string;
	lastName: string;
	age: number;
	inScope: boolean;
	skipped: boolean;
	hasBase: boolean;
	pos: [string, string];

	// As the user's scouts would show them (fuzzed unless God Mode), so nothing hidden leaks
	ovr: [number, number];
	pot: [number, number];

	// True ovr and pot, only compared, never shown: the guarantee
	ovrUnchanged: boolean;
	potUnchanged: boolean;
	shortfall: number;
	build: { name: string; tags: string[] };
	prevBuild: string | undefined;

	// The archetype derived from his ratings: now, after, and how the one asked for (if any) came out
	archetype: {
		before: string;
		after: string;
		prevStored: string | undefined;
		target?: { name: string; matched: boolean; inLabel: boolean };
	};
	skills: [string[], string[]];
	hgtInches: [number | undefined, number | undefined];
	ratings: { key: RatingKey; before: number; after: number }[];
	locks: UiLock;

	// The hgt rating, which is never fuzzed, so the UI can list the builds he is eligible for
	hgt: number;
};

export type PreviewResult = {
	flavor: { name: string; label: string; strength: number } | null;
	poolSize: number | null;
	numPlayers: number;
	numInScope: number;
	numChanged: number;
	numOvrChanged: number;
	rows: PreviewRow[];
	canUndo: boolean;
	numWithOriginals: number;
};

const NO_FUZZ_HGT = new Set<RatingKey>(["hgt"]);

const toBuildRatings = (r: Record<string, any>): BuildRatings => {
	const out = {} as BuildRatings;
	for (const key of RATING_KEYS) {
		out[key] = Number(r[key]);
	}
	return out;
};

const sameRatings = (a: BuildRatings, b: BuildRatings) =>
	RATING_KEYS.every((key) => a[key] === b[key]);

export const isProspect = (p: Player) =>
	p.tid === PLAYER.UNDRAFTED || p.tid === PLAYER.UNDRAFTED_FANTASY_TEMP;

// A pseudo class year from age, only used by the few builds that have a biography (a fifth-year senior is never a
// freshman)
const classYearFromAge = (age: number) =>
	age <= 19
		? "Freshman"
		: age === 20
			? "Sophomore"
			: age === 21
				? "Junior"
				: age === 22
					? "Senior"
					: "Graduate";

type Resolved = {
	ratings: BuildRatings;
	fuzz: number;
	pot: number;
	hgtInches: number;
	// True when the base is the one stored by an earlier regeneration
	fromStored: boolean;
};

// Regeneration always starts from the player's ratings before the first regeneration, so rerolling never compounds. If he
// has developed or been edited since, his current ratings are the new base.
export const resolveBase = (
	p: Pick<Player, "hgt" | "ratingsBuild">,
	row: PlayerRatings,
): Resolved => {
	const current = toBuildRatings(row);
	const stored = p.ratingsBuild;
	if (stored && sameRatings(stored.applied, current)) {
		return {
			ratings: { ...stored.base },
			fuzz: stored.baseFuzz,
			pot: stored.basePot,
			hgtInches: stored.baseHgtInches,
			fromStored: true,
		};
	}
	return {
		ratings: current,
		fuzz: row.fuzz,
		pot: row.pot,
		hgtInches: p.hgt,
		fromStored: false,
	};
};

const toEngineLock = (
	lock: UiLock | undefined,
	base: BuildRatings,
	ovr: number,
	pot: number,
): PlayerLock | undefined => {
	if (!lock) {
		return undefined;
	}
	const out: PlayerLock = {};
	if (lock.skip) {
		out.skip = true;
	}
	if (lock.build) {
		out.build = lock.build;
	}
	if (lock.archetype) {
		out.archetype = lock.archetype;
	}
	if (lock.pinKeys && lock.pinKeys.length > 0) {
		out.ratings = {};
		for (const key of lock.pinKeys) {
			out.ratings[key] = base[key];
		}
	}
	if (lock.ovrDelta) {
		out.ovr = Math.min(100, Math.max(0, ovr + lock.ovrDelta));
	}
	if (lock.potDelta) {
		out.pot = Math.min(100, Math.max(0, pot + lock.potDelta));
	}
	if (lock.reroll) {
		out.reroll = lock.reroll;
	}
	return out;
};

const makeInput = (
	p: Player,
	lock: UiLock | undefined,
): { input: PlayerInput; resolved: Resolved } => {
	const row = last(p.ratings) as PlayerRatings;
	const resolved = resolveBase(p, row);
	const age = row.season - p.born.year;
	return {
		resolved,
		input: {
			key: String(p.pid),
			ratings: resolved.ratings,
			fuzz: resolved.fuzz,
			ovr: F.ovr(resolved.ratings),
			pot: resolved.pot,
			age,
			hgtInches: resolved.hgtInches,
			bio: {
				classYear: classYearFromAge(age),
				nonNcaa: p.college === "",
			},
			lock: toEngineLock(
				lock,
				resolved.ratings,
				F.ovr(resolved.ratings),
				resolved.pot,
			),
		},
	};
};

export const getProspects = async (draftYear: number) => {
	const players = await idb.cache.players.indexGetAll(
		"playersByDraftYearRetiredYear",
		[[draftYear], [draftYear, Infinity]],
	);
	return players.filter(isProspect);
};

const defaultSettings = async (settings: Partial<BuildSettings>) => {
	if (settings.scoutingLevel !== undefined || settings.fuzz !== "regenerate") {
		return settings;
	}
	// Needed only for regenerating fuzz
	return {
		...settings,
		scoutingLevel: await getLevelLastThree("scouting", {
			tid: g.get("userTid"),
		}),
	};
};

type Computed = {
	players: Player[];
	inputs: { input: PlayerInput; resolved: Resolved }[];
	result: ReturnType<typeof regenerateClass>;
	norms: Norms;
	inScope: Set<number>;
};

const compute = async (params: RegenerateParams): Promise<Computed> => {
	if (__SPORT !== "basketball") {
		throw new Error("Regenerate ratings is only available in basketball");
	}
	const players = await getProspects(params.draftYear);
	const inputs = players.map((p) => makeInput(p, params.locks[p.pid]));
	const settings = await defaultSettings(params.settings);
	const norms = await getLeagueNorms();
	const result = regenerateClass(
		F,
		inputs.map((x) => x.input),
		settings,
		{ norms },
	);
	const inScope = new Set(
		params.pids === null ? players.map((p) => p.pid) : params.pids,
	);
	return { players, inputs, result, inScope, norms };
};

const display = (value: number, fuzz: number) => fuzzRating(value, fuzz);

const makeRow = (
	p: Player,
	r: PlayerResult,
	inScope: boolean,
	hasBase: boolean,
	locks: UiLock,
	hgt: number,
	norms: Norms,
): PreviewRow => {
	// "Before" is what the player has right now (not the original he was built from), so a regeneration that has already
	// been applied previews as no change
	const row = last(p.ratings) as PlayerRatings;
	const current = toBuildRatings(row);
	const currentOvr = F.ovr(current);
	const after = r.skipped
		? {
				ratings: current,
				fuzz: row.fuzz,
				ovr: currentOvr,
				pot: row.pot,
				pos: row.pos,
				skills: row.skills,
				hgtInches: p.hgt,
			}
		: r.after;
	const ratings = RATING_KEYS.map((key) => ({
		key,
		before: NO_FUZZ_HGT.has(key)
			? current[key]
			: display(current[key], row.fuzz),
		after: NO_FUZZ_HGT.has(key)
			? after.ratings[key]
			: display(after.ratings[key], after.fuzz),
	}));
	return {
		pid: p.pid,
		firstName: p.firstName,
		lastName: p.lastName,
		age: row.season - p.born.year,
		inScope,
		skipped: r.skipped,
		hasBase,
		pos: [row.pos, after.pos],
		ovr: [display(currentOvr, row.fuzz), display(after.ovr, after.fuzz)],
		pot: [display(row.pot, row.fuzz), display(after.pot, after.fuzz)],
		ovrUnchanged: after.ovr === currentOvr,
		potUnchanged: after.pot === row.pot,
		shortfall: r.ovrShortfall,
		build: r.build,
		prevBuild: p.ratingsBuild?.name,
		archetype: {
			before: fuzzedArchetypeLabel(current, row.fuzz, norms),
			after: r.skipped
				? fuzzedArchetypeLabel(current, row.fuzz, norms)
				: fuzzedArchetypeLabel(after.ratings, after.fuzz, norms),
			prevStored: viewOf(currentEntry(p.archetypes))?.label,
			target: r.target
				? {
						name: r.target.name,
						matched: r.target.matched,
						inLabel: r.target.inLabel,
					}
				: undefined,
		},
		skills: [row.skills, after.skills],
		hgtInches: [p.hgt, after.hgtInches],
		ratings,
		locks,
		hgt,
	};
};

const canUndo = () => undoStack !== undefined && undoStack.lid === g.get("lid");

export const previewRegenerate = async (
	params: RegenerateParams,
): Promise<PreviewResult> => {
	const { players, inputs, result, inScope, norms } = await compute(params);
	const rows = players.map((p, i) =>
		makeRow(
			p,
			result.results[i]!,
			inScope.has(p.pid),
			p.ratingsBuild !== undefined,
			params.locks[p.pid] ?? {},
			inputs[i]!.input.ratings.hgt,
			norms,
		),
	);
	let numChanged = 0;
	let numOvrChanged = 0;
	for (const row of rows) {
		if (!row.inScope || row.skipped) {
			continue;
		}
		if (row.ratings.some((x) => x.before !== x.after)) {
			numChanged++;
		}
		if (!row.ovrUnchanged) {
			numOvrChanged++;
		}
	}
	return {
		flavor: result.flavor,
		poolSize: result.poolSize,
		numPlayers: rows.length,
		numInScope: rows.filter((row) => row.inScope).length,
		numChanged,
		numOvrChanged,
		rows,
		canUndo: canUndo(),
		numWithOriginals: inputs.filter((x) => x.resolved.fromStored).length,
	};
};

type UndoEntry = {
	pid: number;
	ratings: PlayerRatings;
	hgt: number;
	pos: string | undefined;
	draft: Player["draft"];
	ratingsBuild: StoredRatingsBuild | undefined;
	value: number;
	valueNoPot: number;
	valueFuzz: number;
	valueNoPotFuzz: number;
};

let undoStack:
	| { lid: number | undefined; draftYear: number; entries: UndoEntry[] }
	| undefined;

const snapshot = (p: Player): UndoEntry => ({
	pid: p.pid,
	ratings: helpers.deepCopy(last(p.ratings) as PlayerRatings),
	hgt: p.hgt,
	pos: p.pos,
	draft: helpers.deepCopy(p.draft),
	ratingsBuild: p.ratingsBuild ? helpers.deepCopy(p.ratingsBuild) : undefined,
	value: p.value,
	valueNoPot: p.valueNoPot,
	valueFuzz: p.valueFuzz,
	valueNoPotFuzz: p.valueNoPotFuzz,
});

// Write a result into a player the way the game's own code would keep it consistent: the ratings row, ovr/pot/skills/pos,
// the draft-time copies, the listed height, and the values
export const writeResult = async (
	p: Player,
	r: PlayerResult,
	resolved: Resolved,
	seed: string,
) => {
	const row = last(p.ratings) as PlayerRatings;
	// Expanded ratings: he keeps his wingspan relative to his height and his perimeter/interior defense split
	ensureExpandedRatings(p);
	const expanded = useExpandedRatings(row);
	const wngOffset = expanded ? row.wng! - row.hgt : 0;
	const defenseSplit = expanded ? row.pdef! - row.idef! : 0;
	for (const key of RATING_KEYS) {
		row[key] = r.after.ratings[key];
	}
	row.fuzz = r.after.fuzz;
	row.ovr = r.after.ovr;
	row.pot = r.after.pot;
	row.pos = r.after.pos;
	row.skills = r.after.skills;
	if (expanded) {
		row.wng = helpers.bound(Math.round(row.hgt + wngOffset), 0, 100);
		setDefenseSplit(row, defenseSplit);
		row.ovr = F.ovr(row as any);
		row.pot = Math.max(row.pot, row.ovr);
		row.skills = F.skills(row as any);
	}
	if (r.after.hgtInches !== undefined) {
		p.hgt = r.after.hgtInches;
	}
	// Players from custom league files carry their own pos, which develop() would otherwise keep writing back
	if (typeof p.pos === "string") {
		p.pos = r.after.pos;
	}
	if (isProspect(p)) {
		p.draft.ovr = row.ovr;
		p.draft.pot = row.pot;
		p.draft.skills = row.skills;
	}
	p.ratingsBuild = {
		name: r.build.name,
		tags: r.build.tags,
		seed,
		base: resolved.ratings,
		baseFuzz: resolved.fuzz,
		basePot: resolved.pot,
		baseHgtInches: resolved.hgtInches,
		applied: toBuildRatings(row),
	};
	await updateValues(p);
	await idb.cache.players.put(p);
};

export const applyRegenerate = async (params: RegenerateParams) => {
	const { players, inputs, result, inScope } = await compute(params);
	const entries: UndoEntry[] = [];
	let applied = 0;
	for (const [i, p] of players.entries()) {
		const r = result.results[i]!;
		if (!inScope.has(p.pid) || r.skipped) {
			continue;
		}
		entries.push(snapshot(p));
		await writeResult(p, r, inputs[i]!.resolved, params.settings.seed ?? "");
		applied++;
	}
	undoStack = { lid: g.get("lid"), draftYear: params.draftYear, entries };
	await toUI("realtimeUpdate", [["playerMovement"]]);
	return { applied };
};

// Undo the last apply
export const undoRegenerate = async () => {
	if (!undoStack || undoStack.lid !== g.get("lid")) {
		return { restored: 0, skipped: 0 };
	}
	let restored = 0;
	let skipped = 0;
	for (const e of undoStack.entries) {
		const p = await idb.cache.players.get(e.pid);
		// Never undo over a player who has been drafted or removed since
		if (!p || !isProspect(p)) {
			skipped++;
			continue;
		}
		p.ratings[p.ratings.length - 1] = e.ratings;
		p.hgt = e.hgt;
		if (e.pos === undefined) {
			delete p.pos;
		} else {
			p.pos = e.pos;
		}
		p.draft = e.draft;
		if (e.ratingsBuild) {
			p.ratingsBuild = e.ratingsBuild;
		} else {
			delete p.ratingsBuild;
		}
		p.value = e.value;
		p.valueNoPot = e.valueNoPot;
		p.valueFuzz = e.valueFuzz;
		p.valueNoPotFuzz = e.valueNoPotFuzz;
		await idb.cache.players.put(p);
		restored++;
	}
	undoStack = undefined;
	await toUI("realtimeUpdate", [["playerMovement"]]);
	return { restored, skipped };
};

// Put prospects back to their ratings from before they were first regenerated (this survives a reload, unlike Undo)
export const restoreOriginalRatings = async ({
	draftYear,
	pids,
}: {
	draftYear: number;
	pids: number[] | null;
}) => {
	const players = await getProspects(draftYear);
	const which = pids === null ? undefined : new Set(pids);
	let restored = 0;
	for (const p of players) {
		if ((which && !which.has(p.pid)) || !p.ratingsBuild) {
			continue;
		}
		const b = p.ratingsBuild;
		const row = last(p.ratings) as PlayerRatings;
		// If he developed or was edited since, the original is no longer his, leave him
		if (!sameRatings(b.applied, toBuildRatings(row))) {
			delete p.ratingsBuild;
			await idb.cache.players.put(p);
			continue;
		}
		for (const key of RATING_KEYS) {
			row[key] = b.base[key];
		}
		row.fuzz = b.baseFuzz;
		row.ovr = F.ovr(b.base);
		row.pot = Math.max(row.ovr, b.basePot);
		row.pos = F.pos(b.base);
		row.skills = F.skills({ ...b.base, fuzz: b.baseFuzz });
		p.hgt = b.baseHgtInches;
		if (typeof p.pos === "string") {
			p.pos = row.pos;
		}
		p.draft.ovr = row.ovr;
		p.draft.pot = row.pot;
		p.draft.skills = row.skills;
		delete p.ratingsBuild;
		await updateValues(p);
		await idb.cache.players.put(p);
		restored++;
	}
	await toUI("realtimeUpdate", [["playerMovement"]]);
	return { restored };
};

// With the Archetypes switch off the regenerator has no archetype targets (only builds)
export const getArchetypeTargets = () =>
	(featureOn("archetypes") ? ARCHETYPE_LIST : [])
		// Veteran archetypes need an age a prospect does not have
		.filter((a) => !(a.age && a.age[0] >= 30))
		.map((a) => ({
			id: a.id,
			name: a.name,
			group: a.group,
			desc: a.desc,
			min: a.hgt[0],
			max: a.hgt[1],
			rare: !!a.rare,
		}));

export const getBuildList = () =>
	ARCHETYPES.map((a) => ({
		name: a.name,
		min: a.min,
		max: a.max,
		tags: a.tags,
	}));

// Customize Player: one player, outside any class, from the ratings currently in the form. Nothing is written.
export type SingleParams = {
	pid: number | undefined;

	// The ratings in the form, true ratings, without fuzz
	ratings: Partial<Record<string, number>>;
	fuzz: number;
	pot: number;
	age: number;
	hgtInches: number;
	college: string;
	settings: Partial<BuildSettings>;
	lock: UiLock;
};

export type SingleResult = {
	ratings: { key: RatingKey; before: number; after: number }[];
	ovr: [number, number];
	pot: [number, number];
	pos: [string, string];
	skills: [string[], string[]];
	build: { name: string; tags: string[] };
	shortfall: number;
	prevBuild: string | undefined;
	archetype: {
		before: string;
		after: string;
		target?: { name: string; matched: boolean; inLabel: boolean };
	};
	// What to save on the player, so the next regeneration starts from the same base
	stored: StoredRatingsBuild;
};

export const previewRegenerateSingle = async (
	params: SingleParams,
): Promise<SingleResult> => {
	if (__SPORT !== "basketball") {
		throw new Error("Regenerate ratings is only available in basketball");
	}
	const current = toBuildRatings(params.ratings);
	let p: Player | undefined;
	if (params.pid !== undefined) {
		p = await idb.cache.players.get(params.pid);
	}

	// A player edited in the form since he was regenerated is compared against what he had when he was saved
	const resolved = resolveBase(
		{ hgt: params.hgtInches, ratingsBuild: p?.ratingsBuild },
		{
			...current,
			fuzz: params.fuzz,
			pot: params.pot,
		} as unknown as PlayerRatings,
	);
	const settings = await defaultSettings(params.settings);
	const input: PlayerInput = {
		key: String(params.pid ?? "new"),
		ratings: resolved.ratings,
		fuzz: resolved.fuzz,
		ovr: F.ovr(resolved.ratings),
		pot: resolved.pot,
		age: params.age,
		hgtInches: resolved.hgtInches,
		bio: {
			classYear: classYearFromAge(params.age),
			nonNcaa: params.college === "",
		},
		lock: toEngineLock(
			params.lock,
			resolved.ratings,
			F.ovr(resolved.ratings),
			resolved.pot,
		),
	};
	const norms = await getLeagueNorms();
	const r = regenerateOne(F, input, { ...settings, pot: "keep" }, { norms });
	return {
		ratings: RATING_KEYS.map((key) => ({
			key,
			before: current[key],
			after: r.after.ratings[key],
		})),
		ovr: [F.ovr(current), r.after.ovr],
		pot: [params.pot, r.after.pot],
		pos: [F.pos(current), r.after.pos],
		skills: [F.skills({ ...current, fuzz: params.fuzz }), r.after.skills],
		build: r.build,
		shortfall: r.ovrShortfall,
		prevBuild: p?.ratingsBuild?.name,
		archetype: {
			before: fuzzedArchetypeLabel(current, params.fuzz, norms),
			after: fuzzedArchetypeLabel(r.after.ratings, r.after.fuzz, norms),
			target: r.target
				? {
						name: r.target.name,
						matched: r.target.matched,
						inLabel: r.target.inLabel,
					}
				: undefined,
		},
		stored: {
			name: r.build.name,
			tags: r.build.tags,
			seed: settings.seed ?? "",
			base: resolved.ratings,
			baseFuzz: resolved.fuzz,
			basePot: resolved.pot,
			baseHgtInches: resolved.hgtInches,
			applied: r.after.ratings,
		},
	};
};

// All upcoming draft classes BBGM holds prospects for, oldest first
export const getProspectDraftYears = async () => {
	const players = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	return [...new Set(players.map((p) => p.draft.year))].sort((a, b) => a - b);
};

// Each class gets its own seed derived from the chosen one, so a class's result doesn't depend on which other classes exist
export const classSeed = (seed: string, draftYear: number) =>
	`${seed}|${draftYear}`;

export type AllClassesSummary = {
	draftYear: number;
	numPlayers: number;
	numChanged: number;
	numOvrChanged: number;
	flavor: string | undefined;
}[];

// Preview summary for every upcoming class at once
export const previewRegenerateAllClasses = async ({
	settings,
}: {
	settings: Partial<BuildSettings>;
}): Promise<{ classes: AllClassesSummary; canUndo: boolean }> => {
	const classes: AllClassesSummary = [];
	for (const draftYear of await getProspectDraftYears()) {
		const preview = await previewRegenerate({
			draftYear,
			settings: {
				...settings,
				seed: classSeed(settings.seed ?? "regen", draftYear),
			},
			locks: {},
			pids: null,
		});
		classes.push({
			draftYear,
			numPlayers: preview.numPlayers,
			numChanged: preview.numChanged,
			numOvrChanged: preview.numOvrChanged,
			flavor: preview.flavor?.label,
		});
	}
	return { classes, canUndo: canUndo() };
};

const applyToClass = async (
	draftYear: number,
	settings: Partial<BuildSettings>,
	onlyWithoutBuild: boolean,
	entries: UndoEntry[] | undefined,
) => {
	const players = await getProspects(draftYear);
	const pids = onlyWithoutBuild
		? players.filter((p) => !p.ratingsBuild).map((p) => p.pid)
		: null;
	if (pids && pids.length === 0) {
		return 0;
	}
	const seed = classSeed(settings.seed ?? "regen", draftYear);
	const {
		players: all,
		inputs,
		result,
		inScope,
	} = await compute({
		draftYear,
		settings: { ...settings, seed },
		locks: {},
		pids,
	});
	let applied = 0;
	for (const [i, p] of all.entries()) {
		const r = result.results[i]!;
		if (!inScope.has(p.pid) || r.skipped) {
			continue;
		}
		entries?.push(snapshot(p));
		await writeResult(p, r, inputs[i]!.resolved, seed);
		applied++;
	}
	return applied;
};

// Apply the same settings to every upcoming class. One Undo covers all of them
export const applyRegenerateAllClasses = async ({
	settings,
}: {
	settings: Partial<BuildSettings>;
}) => {
	const entries: UndoEntry[] = [];
	const classes: { draftYear: number; applied: number }[] = [];
	for (const draftYear of await getProspectDraftYears()) {
		classes.push({
			draftYear,
			applied: await applyToClass(draftYear, settings, false, entries),
		});
	}
	undoStack = { lid: g.get("lid"), draftYear: -1, entries };
	await toUI("realtimeUpdate", [["playerMovement"]]);
	return { classes };
};

export const restoreOriginalRatingsAllClasses = async () => {
	let restored = 0;
	for (const draftYear of await getProspectDraftYears()) {
		restored += (await restoreOriginalRatings({ draftYear, pids: null }))
			.restored;
	}
	return { restored };
};

/**
 * For the "Re-randomize ratings when a new draft class is created" setting: regenerate the prospects of one class who were never regenerated, with the league's saved regenerator settings (or the defaults), seeded from the league and the class year. Not undoable, no UI update (it runs inside class creation).
 */
export const autoRegenerateClass = (
	draftYear: number,
	saved: Partial<BuildSettings> | undefined,
) => {
	if (__SPORT !== "basketball") {
		return Promise.resolve(0);
	}
	const settings: Partial<BuildSettings> = {
		...saved,
		seed: saved?.seed || `league-${g.get("lid")}`,
	};
	return applyToClass(draftYear, settings, true, undefined);
};
