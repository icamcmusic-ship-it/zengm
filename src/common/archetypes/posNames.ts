// arch15: one build, a name that fits where he plays. A build may have a different display name at a position group (a
// passing hub is a "Floor General" at point guard and a "Point Forward" at forward): the id, the profile and everything the
// metrics count are the same; the name follows his current position, and League > Archetypes' search finds every name.
import type { Archetype, Pos } from "./types.ts";

export type PosGroup = "guard" | "wing" | "big";

// Guards PG/G/SG, wings GF/SF/F, bigs PF/FC/C
export const POS_GROUP: Record<Pos, PosGroup> = {
	PG: "guard",
	G: "guard",
	SG: "guard",
	GF: "wing",
	SF: "wing",
	F: "wing",
	PF: "big",
	FC: "big",
	C: "big",
};

const isPosKey = (x: unknown): x is Pos =>
	typeof x === "string" && Object.hasOwn(POS_GROUP, x);

// The build's name at a position (its own name without a position, or where it has no other name)
export const nameAt = (
	a: Pick<Archetype, "name" | "posNames">,
	pos: unknown,
): string =>
	(isPosKey(pos) ? a.posNames?.[POS_GROUP[pos]] : undefined) ?? a.name;

// Every name the build goes by
export const namesOf = (a: Pick<Archetype, "name" | "posNames">): string[] => [
	...new Set([a.name, ...Object.values(a.posNames ?? {})]),
];
