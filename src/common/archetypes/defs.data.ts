// The archetype table: every archetype is an NBA 2K build name (twoK/defs2k.data.ts, generated from the 2K build database by
// twoK/build2k.script.test.ts). Each is a weighted profile over normalized rating dimensions (see composites.ts), read
// RELATIVE TO THE PLAYER'S OWN LEVEL: `w` is -3..+3, how far above (+) or below (-) his own average the build wants that
// dimension (3 = far and away his best skill). Dimensions not listed are expected to be ordinary for him. So the same
// build name fits a 45 and an 80 whose ratings have the same shape.

import { CUSTOM_DEFS } from "./customDefs.data.ts";
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
		traitTie: Object.keys(traitTie).length > 0 ? traitTie : undefined,
		tags: [
			d.group,
			d.family,
			...(d.custom ? [] : ["2k"]),
			...(d.positions.length === ALL_POSITIONS ? ["universal"] : []),
			...d.tags,
		],
		prior: 1,
		...(d.custom ? { custom: true as const } : {}),
	};
};

// The 2K builds, then the custom ones (customDefs.data.ts)
export const ARCHETYPE_DEFS: Archetype[] = [...TWO_K_DEFS, ...CUSTOM_DEFS].map(
	toArchetype,
);

// The other 2K build names each archetype stands for (shown in the archetype popover and on League > Archetypes)
export const TWO_K_NAMES: Record<string, string[]> = Object.fromEntries(
	TWO_K_DEFS.filter((d) => d.aliases.length > 0).map((d) => [d.id, d.aliases]),
);
