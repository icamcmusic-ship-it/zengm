import type { Archetype } from "./types.ts";

// arch16 (user request: "archetypes seem like they are defaulting to Versatile Paint Finisher, Versatile Scorer, etc."): the
// generic builds. Their names promise breadth and nothing in particular (scoring from everywhere, finishing every way), so a
// player who fits nothing well fits them a little, and arch15's merges made several of them catch-alls. Each now needs
// genuine all-around skill on the blended scale (score.ts CATCH_ALL), pays for every standout skill of his it does not name
// (score.ts genericPenalty) and is capped in share (norms bias, shareTrim.script.test.ts); a player who only fits a generic
// build gets the best specific one with a fit note (classify.ts)
export const GENERIC_BUILDS: ReadonlySet<string> = new Set([
	"versatile-scorer",
	"three-level-scorer",
	"crafty-3-level-scorer",
	"gritty-3-level-scorer",
	"physical-3-level-scorer",
	"walking-bucket",
	"crafty-walking-bucket",
	"versatile-paint-finisher",
	"versatile-paint-bully",
	"versatile-scoring-cleaner",
	"inside-out-scorer",
	"inside-out-slasher",
	"crafty-inside-out-scorer",
	"mid-paint-bully",
	"crafty-mid-paint-scorer",
	"mid-range-menace",
	"mid-range-slasher",
	"slashing-dual-finisher",
]);

export const isGenericBuild = (a: Pick<Archetype, "id"> | undefined) =>
	a !== undefined && GENERIC_BUILDS.has(a.id);
