import type { RatingKey } from "../types.basketball.ts";

export type { RatingKey };

// The ratings an archetype is derived from (true or fuzzed, the engine does not care)
export type ArchetypeRatings = Record<RatingKey, number> & {
	// Expanded ratings (the expandedRatings setting), only when it's on: the defense, rebounding, blocking and finishing composites
	// then read wingspan and perimeter/interior defense, like the game sim, perimeter labels are keyed on pdef, interior labels on
	// idef, and length (wingspan relative to height) is a dimension of its own
	wng?: number;
	pdef?: number;
	idef?: number;
	oreb?: number;
	dreb?: number;
	csh?: number;
	dsh?: number;
	bsc?: number;
};

// The dimensions an archetype profile is written over: BBGM's own composite ratings plus a few raw ratings
export type DimKey =
	| "usg"
	| "drb"
	| "pss"
	| "rim"
	| "post"
	| "mid"
	| "three"
	| "ft"
	| "reb"
	| "dint"
	| "dper"
	| "blk"
	| "ath"
	| "end"
	| "stl"
	| "draw"
	| "spd"
	| "jmp"
	| "stre"
	| "oiq"
	| "diq"
	| "hgt"
	// Perimeter and interior defense (the expanded ratings; without them both read as diq) and length: wingspan relative to
	// height (without expanded ratings: ordinary, and never part of a match)
	| "pdef"
	| "idef"
	| "len"
	// Expanded ratings, second step: catch-and-shoot vs off-the-dribble lean (csh - dsh) and offensive vs defensive rebounding
	// lean (oreb - dreb). Like length: styles, only part of a match when an archetype names them and the player has them
	| "cs"
	| "orl"
	// ... and ball security lean: bsc against what his handle, passing and IQ would give (a careful or a loose handler)
	| "sec";

// Player traits (the playerTraits setting) an archetype may read: only the ones the user can see (never hidden traits or the
// aging curve), as the 0-100 score the user sees (a prospect's scouted estimate)
export type ArchetypeTraitKey =
	| "shotDiscipline"
	| "offBall"
	| "screen"
	| "hustle"
	| "foulDiscipline"
	| "handle"
	| "veteranSavvy"
	| "motor"
	| "defensiveVersatility";
export type ArchetypeTraits = Partial<Record<ArchetypeTraitKey, number>>;

export type ArchetypeGroup = "guard" | "wing" | "forward" | "big";

// BBGM basketball positions
export type Pos = "PG" | "G" | "SG" | "GF" | "SF" | "F" | "PF" | "FC" | "C";

// Families are used to avoid pairing an archetype with a near-duplicate as its secondary one
export type ArchetypeFamily =
	| "playmaker"
	| "shooter"
	| "scorer"
	| "slasher"
	| "defender"
	| "athlete"
	| "rebounder"
	| "skilled"
	| "hustle"
	| "balanced"
	| "unicorn";

export type SkillLabel =
	| "3"
	| "A"
	| "B"
	| "Di"
	| "Dp"
	| "Po"
	| "Ps"
	| "R"
	| "V";

export type ArchetypeDef = {
	id: string;
	name: string;
	group: ArchetypeGroup;
	family: ArchetypeFamily;
	desc: string;
	// Profile weights, -3..+3 in "standard deviations / 0.55" (3 = elite, -3 = well below normal)
	w: Partial<Record<DimKey, number>>;
	// Weights that replace or add to `w` for a player who has expanded ratings: the perimeter/interior defense rating a
	// label is really about (when it names one, his defensive IQ, their average, is left out) and his length
	xw?: Partial<Record<DimKey, number>>;
	// Gate on the hgt rating, both inclusive (soft: a smooth penalty outside)
	hgt: [number, number];
	// Skills the player must have (a missing one costs a lot) and skills that help
	req?: SkillLabel[];
	bonus?: SkillLabel[];
	// Floors on the league-wide z of a dimension (his skill in absolute terms): a label must deliver what its name promises
	need?: Partial<Record<DimKey, number>>;
	// Ceilings on the league-wide z of a dimension: a label about what he lacks (short arms)
	cap?: Partial<Record<DimKey, number>>;
	// The same, on the z for his size (rebounding, post scoring and finishing are judged against players his height)
	needFor?: Partial<Record<DimKey, number>>;
	// Gate on his overall level (mean size-adjusted skill z, soft): raw prospects are well below the league
	level?: [number, number];
	// Gate on age, applied when his age is known. When it is not, a veteran archetype (minimum age 30+) is never picked
	age?: [number, number];
	// Rare "unicorn" types are not expected to be filled in every league
	rare?: true;
	// Only for players who have expanded ratings: the label is about his length (wingspan for his height)
	expanded?: true;
	// A trait-flavored label: only with player traits on, and he needs at least this score at the trait (a shortfall costs fit)
	trait?: { key: ArchetypeTraitKey; min: number };
	// Visible traits that break ties toward this label (weight per trait, see TRAIT_TIE_K in classify.ts)
	traitTie?: Partial<Record<ArchetypeTraitKey, number>>;
	// The positions he must play to get this label (a hard gate). All nine for the few universal (role) archetypes.
	positions: Pos[];
	// Position prior overrides on top of the group's (see position.ts): z nudge per position, null = never
	pos?: Partial<Record<Pos, number | null>>;
	tags: string[];
};

export type Archetype = ArchetypeDef & {
	// Calibration prior (see calibration.data.ts), 1 = neutral
	prior: number;
};

export type Norms = {
	// 101 quantile points (0%..100%) of each dimension's raw value across the reference league
	q: Record<DimKey, number[]>;
	// Share of each dimension's variance explained by height, used to read skills "for his size"
	beta: Record<DimKey, number>;
	// Quantiles of ovr, for tiers
	ovr: number[];
	// Per archetype id: how a raw match score is distributed over the reference league's players that fit its height gate,
	// as values at the standard normal quantiles MATCH_Z. A player's pick is the archetype he fits most exceptionally.
	match: Record<string, number[]>;
	// Per archetype id: a small calibrated nudge (in z) that evens out how often each is chosen
	bias?: Record<string, number>;
};

export type Tier =
	| "franchise"
	| "star"
	| "starter"
	| "rotation"
	| "bench"
	| "fringe";

export type Why = {
	dim: DimKey;
	label: string;
	// Standard deviations above (+) or below (-) what is typical for his size
	z: number;
	// The weight the archetype puts on it: > 0 wants high, < 0 wants low
	want: number;
	// The raw ratings behind it
	ratings: RatingKey[];
};

export type Classification = {
	id: string;
	name: string;
	group: ArchetypeGroup;
	family: ArchetypeFamily;
	desc: string;
	tags: string[];
	// null when no second archetype is close enough to call him a hybrid
	secondary: { id: string; name: string; desc: string } | null;
	// 0..1: how well the ratings match the primary profile
	score: number;
	// 0..1: margin of the primary over the runner-up
	confidence: number;
	tier: Tier | null;
	// Top three contributions to the match
	why: Why[];
	// "Slasher / Floor General"
	label: string;
};

// What is stored on a player, compactly
export type StoredArchetype = {
	season: number;
	// Archetype id (see ARCHETYPES), secondary id when he is a hybrid
	id: string;
	secondary?: string;
	// A short code of the tier, kept so the history reads without recomputing
	tier?: Tier;
	// Confidence in percent
	conf?: number;
};
