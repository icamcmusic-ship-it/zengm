// Pure helpers the UI and the worker views share: how an archetype is stored on a player, shown, aggregated and warned about.
import { ARCHETYPES, archetypeById } from "./classify.ts";
import { mergedId } from "./merges.data.ts";
import { isPos } from "./position.ts";
import { nameAt } from "./posNames.ts";
import type {
	ArchetypeFamily,
	ArchetypeGroup,
	Classification,
	StoredArchetype,
	Tier,
} from "./types.ts";

export const GROUP_INFO: Record<
	ArchetypeGroup,
	{ label: string; short: string; color: string; darkColor: string }
> = {
	guard: {
		label: "Guards",
		short: "G",
		color: "#1d6fb8",
		darkColor: "#6db3f2",
	},
	wing: { label: "Wings", short: "W", color: "#3a9d52", darkColor: "#3a9d52" },
	forward: {
		label: "Forwards",
		short: "F",
		color: "#c2680a",
		darkColor: "#ffa94d",
	},
	big: { label: "Bigs", short: "C", color: "#c2456f", darkColor: "#c2456f" },
};

export const GROUPS: ArchetypeGroup[] = ["guard", "wing", "forward", "big"];

// A position's size group, for the roster warnings
const POS_SIZE: Record<string, ArchetypeGroup> = {
	PG: "guard",
	G: "guard",
	SG: "guard",
	GF: "wing",
	SF: "wing",
	F: "forward",
	PF: "forward",
	FC: "big",
	C: "big",
};

// Bumped whenever the reading changes enough that a stored label may no longer be what it would give: an entry stored by
// an older reading (or before versions were stored) is not shown as the current label, the player is read again (and
// stored anew), so a label from an older engine never lingers until the next preseason
// arch14: 12 (the fitted reading, merged builds); arch15: 13 (sub-ratings and play types, more merges, new builds)
export const ARCHETYPE_READING_VERSION = 13;

export const toStored = (
	season: number,
	c: Classification,
): StoredArchetype => {
	const out: StoredArchetype = {
		season,
		id: c.id,
		v: ARCHETYPE_READING_VERSION,
	};
	if (c.tier) {
		out.tier = c.tier;
	}
	out.conf = Math.round(c.confidence * 100);
	return out;
};

export type ArchetypeView = {
	id: string;
	name: string;
	label: string;
	group: ArchetypeGroup;
	family: ArchetypeFamily;
	desc: string;
	tier?: Tier;
	conf?: number;
	season: number;
};

// A stored entry as the UI shows it; null if its archetype no longer exists (an id from an older version), or, given his
// position, if the archetype is no longer allowed there (entries stored before positions were a hard gate). The caller
// then reads him live until his next preseason stores a valid one. The label is one build: a hybrid partner stored by an
// older version is ignored.
// What the league has on now: a label that needs player traits (or expanded ratings) is no longer valid once that setting
// is off (undefined: not checked)
// `current`: the entry is meant as his current label, so one stored by an older reading is not valid
export type ViewContext = {
	traits?: boolean;
	expanded?: boolean;
	current?: boolean;
};
export const isStale = (e: StoredArchetype) =>
	(e.v ?? 0) < ARCHETYPE_READING_VERSION;
const unavailable = (
	a: { trait?: unknown; expanded?: true },
	ctx: ViewContext | undefined,
) =>
	(a.trait !== undefined && ctx?.traits === false) ||
	(a.expanded === true && ctx?.expanded === false);

export const viewOf = (
	e: StoredArchetype | undefined,
	pos?: unknown,
	ctx?: ViewContext,
): ArchetypeView | null => {
	// (a build merged into another reads as the one it was merged into: merges.data.ts)
	const a = e ? archetypeById(mergedId(e.id)) : undefined;
	if (!e || !a) {
		return null;
	}
	if (
		(isPos(pos) && !a.positions.includes(pos)) ||
		unavailable(a, ctx) ||
		(ctx?.current && isStale(e))
	) {
		return null;
	}
	// arch15: the name at his position (posNames.ts)
	const name = nameAt(a, pos);
	return {
		id: a.id,
		name,
		label: name,
		group: a.group,
		family: a.family,
		desc: a.desc,
		tier: e.tier,
		conf: e.conf,
		season: e.season,
	};
};

// The entry currently in force: the latest one at or before `season` (or the latest of all)
export const currentEntry = (
	list: StoredArchetype[] | undefined,
	season?: number,
): StoredArchetype | undefined => {
	let best: StoredArchetype | undefined;
	for (const e of list ?? []) {
		if (season !== undefined && e.season > season) {
			continue;
		}
		if (!best || e.season >= best.season) {
			best = e;
		}
	}
	return best;
};

// Add or replace the entry for a season, keeping the list sorted by season
export const withEntry = (
	list: StoredArchetype[] | undefined,
	entry: StoredArchetype,
): StoredArchetype[] => {
	const out = (list ?? []).filter((e) => e.season !== entry.season);
	out.push(entry);
	out.sort((a, b) => a.season - b.season);
	return out;
};

export type HistoryStep = {
	season: number;
	id: string;
	label: string;
	// The season he changed from another archetype, undefined for the first entry
	from?: string;
	// Seasons held (until the next change)
	through: number;
};

// A career as stretches of the same archetype: "2024 Slasher, 2027 Stretch Wing"
export const historyOf = (
	list: StoredArchetype[] | undefined,
	lastSeason?: number,
): HistoryStep[] => {
	const sorted = [...(list ?? [])].sort((a, b) => a.season - b.season);
	const steps: HistoryStep[] = [];
	for (const e of sorted) {
		const v = viewOf(e);
		if (!v) {
			continue;
		}
		const prev = steps.at(-1);
		if (prev && prev.id === v.id) {
			prev.through = e.season;
			continue;
		}
		steps.push({
			season: e.season,
			id: v.id,
			label: v.label,
			from: prev?.label,
			through: e.season,
		});
	}
	if (lastSeason !== undefined && steps.length > 0) {
		steps.at(-1)!.through = Math.max(steps.at(-1)!.through, lastSeason);
	}
	return steps;
};

export type Rated = {
	pid: number;
	ovr: number;
	archetypeId: string | undefined;
	name?: string;
	pos?: string;
};

export type Landscape = {
	total: number;
	byArchetype: {
		id: string;
		name: string;
		group: ArchetypeGroup;
		count: number;
		share: number;
		top: Rated[];
	}[];
	byGroup: Record<ArchetypeGroup, number>;
};

export const landscapeOf = (rows: Rated[], topN = 3): Landscape => {
	const by = new Map<string, Rated[]>();
	for (const r of rows) {
		if (!r.archetypeId || !archetypeById(r.archetypeId)) {
			continue;
		}
		const l = by.get(r.archetypeId) ?? [];
		l.push(r);
		by.set(r.archetypeId, l);
	}
	const total = [...by.values()].reduce((s, l) => s + l.length, 0);
	const byGroup = { guard: 0, wing: 0, forward: 0, big: 0 } as Record<
		ArchetypeGroup,
		number
	>;
	const byArchetype = ARCHETYPES.map((a) => {
		const l = by.get(a.id) ?? [];
		byGroup[a.group] += l.length;
		return {
			id: a.id,
			name: a.name,
			group: a.group,
			count: l.length,
			share: total > 0 ? l.length / total : 0,
			top: [...l].sort((x, y) => y.ovr - x.ovr || x.pid - y.pid).slice(0, topN),
		};
	});
	byArchetype.sort((x, y) => y.count - x.count || (x.name < y.name ? -1 : 1));
	return { total, byArchetype, byGroup };
};

export type Warning = { kind: string; text: string };

export type Composition = {
	counts: { id: string; name: string; group: ArchetypeGroup; count: number }[];
	byGroup: Record<ArchetypeGroup, number>;
	byFamily: Partial<Record<ArchetypeFamily, number>>;
	warnings: Warning[];
	known: number;
};

// What a roster is made of, and where it is thin or redundant. Only the top `rotation` players by ovr count toward the
// balance warnings (the rest of the bench rarely plays).
export const compositionOf = (rows: Rated[], rotation = 9): Composition => {
	const known = rows.filter(
		(r) => r.archetypeId && archetypeById(r.archetypeId),
	);
	const countMap = new Map<string, number>();
	const byGroup = { guard: 0, wing: 0, forward: 0, big: 0 } as Record<
		ArchetypeGroup,
		number
	>;
	const byFamily: Composition["byFamily"] = {};
	for (const r of known) {
		const a = archetypeById(r.archetypeId!)!;
		countMap.set(a.id, (countMap.get(a.id) ?? 0) + 1);
		byGroup[a.group]++;
		byFamily[a.family] = (byFamily[a.family] ?? 0) + 1;
	}
	const counts = [...countMap.entries()]
		.map(([id, count]) => {
			const a = archetypeById(id)!;
			return { id, name: a.name, group: a.group, count };
		})
		.sort((x, y) => y.count - x.count || (x.name < y.name ? -1 : 1));

	const top = [...known]
		.sort((x, y) => y.ovr - x.ovr || x.pid - y.pid)
		.slice(0, rotation);
	const warnings: Warning[] = [];
	if (top.length >= 5) {
		const has = (
			f: (a: NonNullable<ReturnType<typeof archetypeById>>) => boolean,
		) => top.some((r) => f(archetypeById(r.archetypeId!)!));
		if (!has((a) => a.family === "playmaker")) {
			warnings.push({
				kind: "playmaking",
				text: "No real playmaker in the rotation.",
			});
		}
		if (!has((a) => a.family === "shooter" || a.tags.includes("shooting"))) {
			warnings.push({
				kind: "spacing",
				text: "No dedicated shooter in the rotation: spacing may suffer.",
			});
		}
		if (
			!has(
				(a) =>
					a.group === "big" &&
					(a.family === "defender" || a.family === "rebounder"),
			)
		) {
			warnings.push({
				kind: "rim",
				text: "No rim protector or glass cleaner among the bigs.",
			});
		}
		if (!has((a) => a.family === "defender")) {
			warnings.push({
				kind: "defense",
				text: "No defensive specialist in the rotation.",
			});
		}
		const topGroups = { guard: 0, wing: 0, forward: 0, big: 0 } as Record<
			ArchetypeGroup,
			number
		>;
		// (arch15: by his position when it is known: a build open at several position groups names no size)
		for (const r of top) {
			const g = isPos(r.pos)
				? POS_SIZE[r.pos as string]!
				: archetypeById(r.archetypeId!)!.group;
			topGroups[g]++;
		}
		if (topGroups.big === 0) {
			warnings.push({ kind: "size", text: "No big man in the rotation." });
		}
		if (topGroups.guard === 0) {
			warnings.push({
				kind: "ballhandling",
				text: "No guard in the rotation.",
			});
		}
		const dup = counts.find((c) => c.count >= 3);
		if (dup) {
			warnings.push({
				kind: "duplicates",
				text: `${dup.count} players share the ${dup.name} archetype.`,
			});
		}
	}
	return { counts, byGroup, byFamily, warnings, known: known.length };
};

// Archetypes grouped by group, for pickers
export const archetypesByGroup = () =>
	GROUPS.map((g) => ({
		group: g,
		...GROUP_INFO[g],
		items: ARCHETYPES.filter((a) => a.group === g).map((a) => ({
			id: a.id,
			name: a.name,
			desc: a.desc,
			rare: !!a.rare,
		})),
	}));
