import { TRAIT_DEFINITIONS } from "./definitions.ts";
import type { ScoutedTrait } from "./scouting.ts";
import { TRAIT_KEYS, type TraitKey } from "./types.ts";

// Every trait belongs to exactly one category (see categories test). Used to group the Traits page, badges, the legend and editors.
export const TRAIT_CATEGORIES = [
	{
		key: "mental",
		name: "Mental",
		traits: [
			"clutch",
			"lateGameIq",
			"bigGame",
			"consistency",
			"shotDiscipline",
			"foulDiscipline",
			"handle",
		],
	},
	{
		key: "personality",
		name: "Personality",
		traits: [
			"leadership",
			"ego",
			"temper",
			"workEthic",
			"veteranSavvy",
			"loyalty",
			"roleAcceptance",
			"moneyVsWinning",
		],
	},
	{
		// The secret aging curve is shown here too, but only after retirement
		key: "physical",
		name: "Physical",
		traits: ["durability", "recovery", "motor"],
	},
	{
		key: "playstyle",
		name: "Playstyle",
		traits: ["offBall", "screen", "hustle", "defensiveVersatility"],
	},
] as const satisfies readonly {
	key: string;
	name: string;
	traits: readonly TraitKey[];
}[];

export type TraitCategoryKey = (typeof TRAIT_CATEGORIES)[number]["key"];

export const TRAIT_CATEGORY_BY_KEY = Object.fromEntries(
	TRAIT_CATEGORIES.flatMap((c) => c.traits.map((key) => [key, c.key])),
) as Record<TraitKey, TraitCategoryKey>;

// TRAIT_KEYS in category order
export const TRAIT_KEYS_BY_CATEGORY: readonly TraitKey[] =
	TRAIT_CATEGORIES.flatMap((c) => c.traits as readonly TraitKey[]);

// One line about where a player stands right now, by level. Each starts with a verb (third person), so it also reads after "Scouts think he".
// Never the general description (that is for the legend).
export const TRAIT_STATUS: Record<
	TraitKey,
	{ high: string; average: string; low: string }
> = {
	clutch: {
		high: "Rises in the final minutes of close games",
		average: "Plays neither better nor worse late in close games",
		low: "Tends to shrink late in close games",
	},
	lateGameIq: {
		high: "Makes the smart call at the end of games",
		average: "Makes end-of-game decisions like a typical player",
		low: "Loses track of the clock and the fouls late in games",
	},
	bigGame: {
		high: "Raises his game in the playoffs",
		average: "Plays the same in the playoffs as in the regular season",
		low: "Shrinks when the playoffs come",
	},
	consistency: {
		high: "Plays close to his level night after night",
		average: "Has the usual mix of good and bad nights",
		low: "Swings between hot and cold nights",
	},
	shotDiscipline: {
		high: "Takes good shots for his role",
		average: "Picks his shots about as well as most",
		low: "Forces too many shots",
	},
	foulDiscipline: {
		high: "Stays home and defends without fouling",
		average: "Fouls and gambles about as often as most",
		low: "Gambles for steals and picks up fouls",
	},
	handle: {
		high: "Keeps the ball safe against pressure",
		average: "Handles pressure about as well as most",
		low: "Coughs the ball up against pressure",
	},
	leadership: {
		high: "Holds the locker room together",
		average: "Plays a quiet part in the locker room",
		low: "Withdraws from the group when things go wrong",
	},
	ego: {
		high: "Puts the team first and lifts his teammates",
		average: "Gets along with teammates without stirring things up",
		low: "Needs the spotlight and wears on his teammates",
	},
	temper: {
		high: "Keeps his cool with refs and opponents",
		average: "Loses his temper about as often as most",
		low: "Loses his cool with refs and opponents",
	},
	workEthic: {
		high: "Puts in long hours on his game every offseason",
		average: "Works on his game a normal amount",
		low: "Takes it easy in the offseason",
	},
	veteranSavvy: {
		high: "Knows every trick in the book and passes them on",
		average: "Knows the usual tricks of the trade",
		low: "Is still learning the tricks of the trade",
	},
	loyalty: {
		high: "Wants to stay put and gives his team a break to re-sign",
		average: "Weighs staying and leaving like a typical player",
		low: "Likes to test free agency rather than re-sign",
	},
	roleAcceptance: {
		high: "Accepts whatever role he is given",
		average: "Gets as frustrated by a smaller role as most",
		low: "Gets unhappy fast when his minutes drop",
	},
	moneyVsWinning: {
		high: "Chases rings and takes less to join a winner",
		average: "Weighs money and winning about equally",
		low: "Follows the money over the chance to win",
	},
	durability: {
		high: "Holds up physically and rarely gets hurt",
		average: "Gets hurt about as often as a typical player",
		low: "Gets hurt more often than most",
	},
	recovery: {
		high: "Gets his wind back quickly on the bench",
		average: "Recovers on the bench at a normal pace",
		low: "Needs a long rest to get his wind back",
	},
	motor: {
		high: "Keeps going through heavy minutes and back-to-backs",
		average: "Tires like a typical player in heavy minutes",
		low: "Wears down in heavy minutes and on back-to-backs",
	},
	offBall: {
		high: "Keeps moving and opens up easy looks for teammates",
		average: "Moves without the ball about as much as most",
		low: "Tends to stand around when he doesn't have the ball",
	},
	screen: {
		high: "Sets hard screens and finishes the roll or pop",
		average: "Screens about as well as a typical player",
		low: "Sets soft screens",
	},
	hustle: {
		high: "Chases every loose ball and deflection",
		average: "Hustles about as hard as most",
		low: "Coasts when the ball isn't near him",
	},
	defensiveVersatility: {
		high: "Holds up when switched onto bigger or smaller players",
		average: "Defends mismatches about as well as most",
		low: "Gets exposed when switched onto a mismatch",
	},
};

export const TRAIT_STATUS_UNKNOWN = "Unknown: the scouts can't read this yet";

const statusLevel = (score: number) =>
	score >= 65 ? "high" : score <= 35 ? "low" : "average";

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// His current status, one line, respecting scouting uncertainty: exact readings say it plainly, estimates say what the scouts think, and a
// range too wide to tell (from below average to above average) is unknown
export const traitStatusText = (
	t: Pick<ScoutedTrait, "key" | "estimate" | "low" | "high" | "exact">,
): string => {
	const phrases = TRAIT_STATUS[t.key];
	if (t.exact) {
		return phrases[statusLevel(t.estimate)];
	}
	if (t.low <= 35 && t.high >= 65) {
		return TRAIT_STATUS_UNKNOWN;
	}
	return `Scouts think he ${lowerFirst(phrases[statusLevel(t.estimate)])}`;
};

// Sanity: every key has a definition (compile time) and a category (checked in tests)
export const traitKeysMissingCategory = () =>
	TRAIT_KEYS.filter((key) => !(key in TRAIT_CATEGORY_BY_KEY)).concat(
		TRAIT_KEYS.filter((key) => !TRAIT_DEFINITIONS[key]),
	);
