// Basketball player traits. Everything in this folder is pure (no worker, DB or `g` access), so the game sim, the UI and the tests can all use it.

export const TRAIT_KEYS = [
	"clutch",
	"consistency",
	"durability",
	"shotDiscipline",
	"offBall",
	"screen",
	"hustle",
	"foulDiscipline",
	"recovery",
	"handle",
	"lateGameIq",
	"leadership",
] as const;

export type TraitKey = (typeof TRAIT_KEYS)[number];

export type TraitSeedKey = `${TraitKey}Seed`;

// What is stored on the player (p.traits): one small random component per trait, roughly standard normal (random draws are within +-3, the God Mode editor may push it to +-8), two decimals. The 0-100 scores are NOT stored, they are derived from ratings + these seeds + age/experience, so ratings changes flow through and existing leagues need no migration.
export type PlayerTraits = Partial<Record<TraitSeedKey, number>>;

export type TraitScores = Record<TraitKey, number>;

// The subset of basketball ratings the traits read. Missing ratings count as 50.
export type TraitRatings = Partial<
	Record<
		| "hgt"
		| "stre"
		| "spd"
		| "jmp"
		| "endu"
		| "ins"
		| "dnk"
		| "ft"
		| "fg"
		| "tp"
		| "oiq"
		| "diq"
		| "drb"
		| "pss"
		| "reb",
		number
	>
>;

export type TraitContext = {
	// Age in years. Default 26 (neutral).
	age?: number;
	// Seasons played in the pros. Default 3 (neutral).
	experience?: number;
};

// A game situation, used by the situational hooks. timeLeft is seconds left in the current period.
export type TraitSituation = {
	// Offense minus defense, from the point of view of the team that has the ball (or that the hook is asking about)
	scoreDiff: number;
	// Seconds left in the current period
	timeLeft: number;
	// 1-based period number (5+ is overtime)
	period: number;
	// Number of regulation periods, default 4
	numPeriods?: number;
};
