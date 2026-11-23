// Pure helpers the UI and the worker views share: how an archetype is stored on a player, shown, aggregated and warned about.
import { defenseSentence } from "./v2/defenseLabels.ts";
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
// arch14: 12 (the fitted reading, merged builds); arch15: 13 (sub-ratings and play types, more merges, new builds); arch16:
// 14 (generic builds held to all-around floors and capped, four merges' kept names re-picked); archuser2k: 15 (new builds
// from the user's own 2K archetypes); arch2kfix: 16 (six builds' biases: the season cap and the answer-key guard)
// archv2: 17 (the v2 engine is the only one: compositional names, family vote, gap builds; current labels are read
// again at once, past seasons' stay); archv3: 18 (the neighbours' table read right, the voters weighed by reliability,
// the user's picks as labeled players, Glue roles, Switch Defender and the user's batch-4 names, composed ids without
// empty parts); archv4: 19 (the Crafty Floater Guard and Raw Athletic Handler roles, the calibrated confidence and the
// close runner-up stored for the popover); archv5: 20 (the user's labels of the archcmp sample: absolute floors on shooting
// words, the low-ovr Prospect / Depth Piece label, Paint Beast, Interior Force, Offensive-Minded Guard and his wording);
// archramp: 21 (ramps in place of the cliffs: word bars, absolute floors, the earlier reading's candidates, the family
// vote; last season's label kept by 1.2 and in its own words; no Prospect / Depth Piece label)
// archreview: 22 (the user's reviews of 995 labels: absolute gates on every word of a name, honest names for limited
// players by ovr tier and skills, ratings and traits only: no box score or play types)
// archnouns: 23 (names from nouns: a special name, two nouns and his position, or an honest name; a defensive label; the
// user's verdicts as vetoes)
// archnouns2: 24 (end words, the user's second list of special names, Stalker / Roamer / Interceptor)
// archnouns3: 25 (the third list, and the picker improvements)
// archcov: 27 (the user's 2064 audit: skills read against the league and his position group, athletic nouns as
// modifiers, names chosen by how much of his strengths they cover, end words that fit the front words, stickiness
// re-checked every season, promises from each name's skill list, the defensive tag at the 85th percentile)
// archfam: 28 (the user's 2070 audit: skill families that count once (shooting, creation, perimeter D), no defensive
// tag but a 2-Way prefix, 3-Level, offensive IQ a flavor, special names unlocked and given a bigger edge, last season's
// label kept only while it covers his top two, honest names that say his skill, "Five" only on a center)
export const ARCHETYPE_READING_VERSION = 28;

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
	if (c.also) {
		out.also = c.also.id;
	}
	if (c.defense) {
		out.def = c.defense;
	}
	if (c.reason) {
		out.why = c.reason;
	}
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
	// archv4: the close runner-up's name at his position
	also?: string;
	// archnouns: his defensive label (also in `label`, after the name)
	defense?: string;
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
	const alsoA = e.also ? archetypeById(mergedId(e.also)) : undefined;
	return {
		id: a.id,
		name,
		label: e.def ? `${name} · ${e.def}` : name,
		...(e.def ? { defense: e.def } : {}),
		group: a.group,
		family: a.family,
		// (archnouns: both labels in the description)
		desc: e.def ? `${a.desc} ${defenseSentence(e.def)}` : a.desc,
		tier: e.tier,
		conf: e.conf,
		season: e.season,
		...(alsoA && alsoA.id !== a.id ? { also: nameAt(alsoA, pos) } : {}),
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

// The size group a player counts in: his position's (archreview2: a composed or honest name has three groups, guard,
// wing and big, so counting by the label's group left the forwards at a few percent and put them with the wings), else
// his label's
const groupOfRated = (r: Rated, a: { group: ArchetypeGroup }) =>
	(r.pos ? POS_SIZE[r.pos] : undefined) ?? a.group;

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
	// (archv2: composed names held by someone are listed too)
	const composed = [...by.keys()]
		.filter((id) => id.startsWith("v2:"))
		.map((id) => archetypeById(id)!);
	const byArchetype = [...ARCHETYPES, ...composed].map((a) => {
		const l = by.get(a.id) ?? [];
		for (const r of l) {
			byGroup[groupOfRated(r, a)]++;
		}
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
		byGroup[groupOfRated(r, a)]++;
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
