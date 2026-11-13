// The archetype table: every archetype is an NBA 2K build name (twoK/defs2k.data.ts, generated from the 2K build database by
// twoK/build2k.script.test.ts). Each is a weighted profile over normalized rating dimensions (see composites.ts), read
// RELATIVE TO THE PLAYER'S OWN LEVEL: `w` is -3..+3, how far above (+) or below (-) his own average the build wants that
// dimension (3 = far and away his best skill). Dimensions not listed are expected to be ordinary for him. So the same
// build name fits a 45 and an 80 whose ratings have the same shape.

import { CUSTOM_DEFS } from "./customDefs.data.ts";
import {
	MERGED_ARCH14,
	MERGED_ARCH15,
	MERGED_UNION,
	mergedId,
} from "./merges.data.ts";
import { POS_NAMES } from "./posNames.data.ts";
import { POS_GROUP } from "./posNames.ts";
import { HARD_BLOCK, nameContradictsPosition } from "./position.ts";
import { TWO_K_DEFS } from "./twoK/defs2k.data.ts";
import type { Archetype, ArchetypeDef, Pos, TwoKDef } from "./types.ts";

const ALL_POSITIONS = 9;

// Player traits (the playerTraits setting, visible traits only) that break ties toward a build whose name has the word: a
// strong trait is worth a little fit (TRAIT_TIE_K in classify.ts), never enough to beat a clearly better fit by the ratings,
// and never required
const TRAIT_TIE: [RegExp, NonNullable<ArchetypeDef["traitTie"]>][] = [
	[/Off-Screen|Catch & Shoot|Wing[ -]Run/, { offBall: 1 }],
	[/Pick & Pop|Pick-Diving|Popper/, { screen: 1 }],
	[/Gritty|Grinder|Crash|Board[ -]Hunt|Putback/, { hustle: 1 }],
	[/Rim[ -]Run|Tempo|Floor-Sweeping/, { motor: 1 }],
	[
		/Versatile Defender|Switch-Defending|Both Ends|Two Way/,
		{ defensiveVersatility: 1 },
	],
	[/Ankle|Shifty|Iso/, { handle: 1 }],
	[/Automatic|Sharpshoot|Maestro/, { shotDiscipline: 0.5 }],
];

export const toArchetype = (d: TwoKDef): Archetype => {
	const traitTie: NonNullable<ArchetypeDef["traitTie"]> = {};
	for (const [re, tie] of TRAIT_TIE) {
		if (re.test(d.name)) {
			Object.assign(traitTie, tie);
		}
	}
	return {
		id: d.id,
		name: d.name,
		group: d.group,
		family: d.family,
		desc: d.desc,
		positions: d.positions,
		// The 2K positions are the whole position rule: no softer nudge inside them
		pos: Object.fromEntries(d.positions.map((ps) => [ps, 0])) as Partial<
			Record<Pos, number>
		>,
		w: d.w,
		xw: Object.keys(d.xw).length > 0 ? d.xw : undefined,
		hgt: d.hgt,
		need: Object.keys(d.need).length > 0 ? d.need : undefined,
		needFor: Object.keys(d.needFor).length > 0 ? d.needFor : undefined,
		cap: d.cap,
		traitTie: Object.keys(traitTie).length > 0 ? traitTie : undefined,
		...(d.posNames ? { posNames: d.posNames } : {}),
		tags: [
			d.group,
			d.family,
			...(d.custom ? [] : ["2k"]),
			...(d.positions.length === ALL_POSITIONS ? ["universal"] : []),
			...d.tags,
		],
		prior: 1,
		...(d.custom ? { custom: true as const } : {}),
		// (arch13: the all-around star build is rare by design, and never aimed at by the class archetype pool)
		...(d.tags.includes("allAround") ? { rare: true as const } : {}),
	};
};

// arch14: near-duplicate builds merged (merges.data.ts): the kept build takes the union of both builds' positions and height
// gates, and the removed build's names become its aliases
const mergeDefs = (
	defs: TwoKDef[],
	merged: Record<string, string>,
	posNames: boolean,
): TwoKDef[] => {
	const byId = new Map(defs.map((d) => [d.id, { ...d }]));
	for (const [from, to] of Object.entries(merged)) {
		const a = byId.get(from);
		const b = byId.get(to);
		if (!a || !b) {
			throw new Error(`Bad archetype merge ${from} -> ${to}`);
		}
		b.aliases = [...b.aliases, a.name, ...a.aliases];
		b.builds += a.builds;
		// arch15: the union of positions and height gates (the removed build's profile is kept: classify.ts); where the kept
		// name does not fit a position (a "Guard" at a wing), one of its other names that does is shown there (below)
		if (MERGED_UNION.has(from)) {
			b.positions = POSITION_ORDER.filter(
				(p) => b.positions.includes(p) || a.positions.includes(p),
			);
			b.hgt = [Math.min(a.hgt[0], b.hgt[0]), Math.max(a.hgt[1], b.hgt[1])];
			// (a group whose hard blocks the union crosses becomes a wing build: wings are allowed everywhere)
			if (b.positions.some((p) => HARD_BLOCK[b.group].includes(p))) {
				b.group = "wing";
			}
		}
		byId.delete(from);
	}
	// arch15: hand-written names at position groups (posNames.data.ts)
	for (const [id, names] of Object.entries(posNames ? POS_NAMES : {})) {
		const d = byId.get(id);
		if (!d) {
			throw new Error(`Bad archetype position name ${id}`);
		}
		d.posNames = { ...d.posNames, ...names };
	}
	// arch15: a name must fit every position of its group the build is open at (position.ts nameContradictsPosition): else
	// the build's own name there, or another of its names that does
	if (posNames) {
		for (const d of byId.values()) {
			for (const g of new Set(d.positions.map((p) => POS_GROUP[p]))) {
				const here = d.positions.filter((p) => POS_GROUP[p] === g);
				const fits = (n: string) =>
					here.every((p) => !nameContradictsPosition(n, p));
				const name = [d.posNames?.[g], d.name, ...d.aliases].find(
					(n) => n !== undefined && fits(n),
				);
				if (d.posNames?.[g] !== undefined || name !== d.name) {
					const rest = { ...d.posNames };
					delete rest[g];
					d.posNames =
						name !== undefined && name !== d.name
							? { ...rest, [g]: name }
							: rest;
				}
			}
			if (d.posNames && Object.keys(d.posNames).length === 0) {
				delete d.posNames;
			}
		}
	}
	return defs.filter((d) => byId.has(d.id)).map((d) => byId.get(d.id)!);
};
const POSITION_ORDER: Pos[] = [
	"PG",
	"G",
	"SG",
	"GF",
	"SF",
	"F",
	"PF",
	"FC",
	"C",
];
// (arch14's merges, then arch15's on top)
const ARCH14_DEFS = mergeDefs(
	[...TWO_K_DEFS, ...CUSTOM_DEFS],
	MERGED_ARCH14,
	false,
);
const ALL_DEFS = mergeDefs(ARCH14_DEFS, MERGED_ARCH15, true);

// The 2K builds, then the custom ones (customDefs.data.ts)
export const ARCHETYPE_DEFS: Archetype[] = ALL_DEFS.map(toArchetype);

// arch15: the profiles the reading scores: every build as it was before arch15's merges, each with the id of the build it
// is now part of (`out`). A build merged in arch15 keeps its own profile, positions, height gate and name promises as one of
// the kept build's profiles; the kept build is read as the best of its profiles (classify.ts)
export const SCORING_DEFS: Archetype[] = ARCH14_DEFS.map((d) => ({
	...toArchetype(d),
	out: MERGED_ARCH15[d.id] ? mergedId(d.id) : d.id,
}));

// The other build names each archetype stands for (League > Archetypes' search finds them): the 2K names that say the same
// thing, and the builds merged into it
// (arch15: and its names at other position groups)
export const TWO_K_NAMES: Record<string, string[]> = Object.fromEntries(
	ALL_DEFS.filter((d) => d.aliases.length > 0 || d.posNames).map((d) => [
		d.id,
		[
			...new Set([
				...Object.values(d.posNames ?? {}).filter((n) => n !== d.name),
				...d.aliases,
			]),
		],
	]),
);
