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
	// arch15: his sub-ratings (the subRatings setting, common/subRatings.ts SUB_DEFS order), when it's on: the reading reads
	// their shape (subStyle.ts)
	sub?: readonly number[];
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
	| "sec"
	// Finishing: layups and dunks themselves (inside scoring and dunking), without the height BBGM's at-the-rim composite
	// is mostly made of. What a 2K "Slasher", "Finisher" or "Dunker" is about.
	| "fin";

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

// What the build is mostly about (roster composition warnings read it)
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
	// Ceilings on the blended reading of a dimension (needShortfall): a label about what he lacks (no handle, no jumper)
	cap?: Partial<Record<DimKey, number>>;
	// The same, on the z for his size (rebounding, post scoring and finishing are judged against players his height)
	needFor?: Partial<Record<DimKey, number>>;
	// Rare "unicorn" types are not expected to be filled in every league
	rare?: true;
	// Not an NBA 2K build name: a build added for a profile no 2K build covers (customDefs.data.ts)
	custom?: true;
	// Only for players who have expanded ratings: the label is about his length (wingspan for his height)
	expanded?: true;
	// A trait-flavored label: only with player traits on, and he needs at least this score at the trait (a shortfall costs fit)
	trait?: { key: ArchetypeTraitKey; min: number };
	// Visible traits that break ties toward this label (weight per trait, see TRAIT_TIE_K in classify.ts)
	traitTie?: Partial<Record<ArchetypeTraitKey, number>>;
	// arch15: extra sub-rating and play-type wants beyond what the name's concepts say (subStyle.ts buildWants)
	sw?: Partial<Record<string, number>>;
	pw?: Partial<Record<string, number>>;
	// arch15: the name shown at a position group (guard PG/G/SG, wing GF/SF, big F/PF/FC/C), when it differs from `name`:
	// one build, one id, a name that fits where he plays
	posNames?: Partial<Record<"guard" | "wing" | "big", string>>;
	// The positions he must play to get this label (a hard gate). All nine for the few universal (role) archetypes.
	positions: Pos[];
	// Position prior overrides on top of the group's (see position.ts): z nudge per position, null = never
	pos?: Partial<Record<Pos, number | null>>;
	tags: string[];
};

// An archetype as twoK/build2k.script.test.ts writes it (twoK/defs2k.data.ts)
export type TwoKDef = {
	id: string;
	name: string;
	// Other 2K build names that say the same thing, or that the matcher could not tell apart from this one
	aliases: string[];
	group: ArchetypeGroup;
	family: ArchetypeFamily;
	positions: Pos[];
	hgt: [number, number];
	w: Partial<Record<DimKey, number>>;
	xw: Partial<Record<DimKey, number>>;
	need: Partial<Record<DimKey, number>>;
	needFor: Partial<Record<DimKey, number>>;
	// Ceilings (Archetype's `cap`): what the name says he lacks
	cap?: Partial<Record<DimKey, number>>;
	desc: string;
	tags: string[];
	// How many of the 2K builds it stands for
	builds: number;
	// arch15: names at position groups (Archetype's `posNames`)
	posNames?: Partial<Record<"guard" | "wing" | "big", string>>;
	// Not an NBA 2K build name (customDefs.data.ts): no "Same build in 2K" line
	custom?: true;
};

export type Archetype = ArchetypeDef & {
	// Calibration prior (see calibration.data.ts), 1 = neutral
	prior: number;
	// arch15: a scoring profile's build (defs.data.ts SCORING_DEFS): the id it is read as
	out?: string;
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
	// The concentration trim for stars (starBias.data.ts when absent)
	starBias?: Record<string, number>;
	// Quantiles (21 points, 0%..100%) of each dimension's raw value among the reference league's players of each position
	// bucket (PosBucket): his absolute standing among players who play his position
	pq?: Record<PosBucket, Record<DimKey, number[]>>;
	// Draft prospects are read against prospect tables (raw 19-year-olds: their ratings are compressed and their athleticism is
	// ahead of their skills), so their builds spread out the way a league's do. Match tables stay the league's.
	prospect?: Reading;
	// arch15: how the league's sub-ratings sit around their bases (subStyle.ts SubNorms; the built-in generated table when
	// absent)
	sub?: { mean: number[]; sd: number[] };
};

// The tables a player's ratings are read against
export type Reading = Pick<Norms, "q" | "beta" | "pq">;

// Position buckets for absolute (position-relative) readings and stat references: PG/G, SG, GF/SF, F/PF, FC/C
export type PosBucket = "PG" | "SG" | "W" | "F" | "C";

// Box-score stats from a season, as the archetype engine reads them (per-season totals; rates are minute-weighted)
export type ArchetypeStats = {
	min: number;
	fga: number;
	tpa: number;
	fta: number;
	// Shot zones (BBGM's own games only; real stats have none)
	fgaAtRim?: number;
	fgaLowPost?: number;
	fgaMidRange?: number;
	astp: number;
	orbp: number;
	drbp: number;
	blkp: number;
	stlp: number;
	usgp: number;
	// Defensive box plus/minus
	dbpm?: number;
};

// Per position bucket: quantiles (21 points) of each stat feature among players with real minutes
export type StatNorms = Record<PosBucket, Partial<Record<StatKey, number[]>>>;
export type StatKey =
	| "tpar"
	| "tp36"
	| "ftr"
	| "rimr"
	| "postr"
	| "midr"
	| "astp"
	| "trbp"
	| "blkp"
	| "stlp"
	| "dbpm"
	| "usgp";

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
	// The next closest builds ("also close to"), never part of the label
	alternates: { id: string; name: string }[];
	// 0..1: how similar the shape of his ratings is to the build's profile (absolute, see POOR_FIT in classify.ts)
	score: number;
	// How exceptional that fit is among the league's players the build allows, with the name's floors applied (z)
	fit: number;
	// How far he is from what the build's name promises, in z (0 = he has it all)
	shortfall: number;
	// 0..1: margin of the primary over the runner-up
	confidence: number;
	tier: Tier | null;
	// Top three contributions to the match
	why: Why[];
	// The build's name (one name: no hybrids)
	label: string;
	// Not an NBA 2K build name (a custom build)
	custom?: boolean;
	// arch16: why the label is not his very best fit (a generic build he fitted best gave way to a specific one). Data
	// only: the UI shows name, description and why
	fitNote?: string;
	// How much of the reading came from his box-score stats (0 = ratings only), 0..1
	statsWeight?: number;
};

// What is stored on a player, compactly
export type StoredArchetype = {
	season: number;
	// Archetype id (see ARCHETYPES)
	id: string;
	// Entries stored before labels were a single build may carry a hybrid partner: ignored
	secondary?: string;
	// A short code of the tier, kept so the history reads without recomputing
	tier?: Tier;
	// Confidence in percent
	conf?: number;
	// The reading's version (ARCHETYPE_READING_VERSION) when it was stored: an entry from an older reading is read again
	v?: number;
};
