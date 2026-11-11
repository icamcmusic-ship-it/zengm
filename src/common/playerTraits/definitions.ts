import type { TraitKey } from "./types.ts";

export type TraitDefinition = {
	key: TraitKey;
	name: string;
	// One line, plain language
	description: string;
	// What it changes in games
	effect: string;
	// How it is displayed/scouted: "visible" traits show up in play (and are read fairly well on a prospect), "hidden" traits only show up over time (a prospect is a lot less certain)
	visibility: "visible" | "hidden";
	// Adjectives for the low and high end of the scale, used by badges
	low: string;
	high: string;
	// Short badge text for an extreme score
	badgeHigh: string;
	badgeLow: string;
	// Plain language reading of what changes with experience/age
	growth: string;
};

export const TRAIT_DEFINITIONS: Record<TraitKey, TraitDefinition> = {
	clutch: {
		key: "clutch",
		name: "Clutch",
		description:
			"Composure when the game is on the line: shooting, free throws and ball security in close games late.",
		effect:
			"In the last minutes of a close fourth quarter or overtime: better (or worse) shot and free throw percentage and fewer (or more) turnovers. No effect earlier in games.",
		visibility: "hidden",
		low: "Shrinks from the moment",
		high: "Ice in his veins",
		badgeHigh: "Clutch",
		badgeLow: "Tightens up",
		growth: "Grows with experience.",
	},
	consistency: {
		key: "consistency",
		name: "Consistency",
		description: "How steady his play is from one night to the next.",
		effect:
			"Scales the size of his random good and bad nights. Consistent players stay close to their ratings, volatile players have more hot and cold games. The long-run average is the same.",
		visibility: "hidden",
		low: "Streaky",
		high: "Steady",
		badgeHigh: "Steady",
		badgeLow: "Streaky",
		growth: "Veterans settle down a little.",
	},
	durability: {
		key: "durability",
		name: "Durability",
		description: "How well his body holds up.",
		effect:
			"Multiplies his chance of getting hurt in each possession he plays. Durable players miss fewer games, injury-prone players miss more.",
		visibility: "hidden",
		low: "Injury prone",
		high: "Iron man",
		badgeHigh: "Iron man",
		badgeLow: "Injury prone",
		growth: "Declines with age.",
	},
	shotDiscipline: {
		key: "shotDiscipline",
		name: "Shot discipline",
		description: "Takes the right shots for his role.",
		effect:
			"Good shot selection raises his efficiency and keeps his attempts in line with his skill. A high-usage player with poor discipline is a gunner: more attempts, lower percentage.",
		visibility: "visible",
		low: "Gunner",
		high: "Disciplined",
		badgeHigh: "Disciplined",
		badgeLow: "Gunner",
		growth: "Improves a little with experience.",
	},
	offBall: {
		key: "offBall",
		name: "Off-ball movement",
		description: "Cuts, relocates and spaces the floor without the ball.",
		effect:
			"Adds to (or subtracts from) his team's offensive synergy while he is on the court, so teammates get easier looks.",
		visibility: "visible",
		low: "Stands around",
		high: "Always moving",
		badgeHigh: "Mover",
		badgeLow: "Stationary",
		growth: "Little change.",
	},
	screen: {
		key: "screen",
		name: "Screens and roll/pop",
		description: "Sets hard screens and finishes the roll or the pop.",
		effect:
			"Adds to (or subtracts from) team offensive synergy, and slightly changes his own efficiency on shots off screens.",
		visibility: "visible",
		low: "Soft screens",
		high: "Screen specialist",
		badgeHigh: "Screener",
		badgeLow: "Soft screens",
		growth: "Little change.",
	},
	hustle: {
		key: "hustle",
		name: "Hustle",
		description: "Dives for loose balls, deflects passes, takes charges.",
		effect:
			"Scales his share of loose balls, deflections, steals off the ball and charges drawn.",
		visibility: "visible",
		low: "Coasts",
		high: "Relentless",
		badgeHigh: "Hustler",
		badgeLow: "Coasts",
		growth: "Fades slowly late in a career.",
	},
	foulDiscipline: {
		key: "foulDiscipline",
		name: "Foul discipline",
		description: "Stays home and defends clean, or gambles for steals.",
		effect:
			"Disciplined defenders commit fewer fouls but get fewer steals. Gamblers do the opposite.",
		visibility: "visible",
		low: "Gambler",
		high: "Stays home",
		badgeHigh: "Clean",
		badgeLow: "Gambler",
		growth: "Improves with experience.",
	},
	recovery: {
		key: "recovery",
		name: "Recovery",
		description: "How quickly he gets his wind back on the bench.",
		effect:
			"Scales how fast his energy refills while he sits, so he can play more minutes at a high level.",
		visibility: "hidden",
		low: "Slow to recover",
		high: "Quick recovery",
		badgeHigh: "Recovers fast",
		badgeLow: "Slow recovery",
		growth: "Declines with age.",
	},
	handle: {
		key: "handle",
		name: "Handle under pressure",
		description: "Protects the ball against pressure defense.",
		effect:
			"Fewer (or more) turnovers when the defense is pressuring, and when trapped late.",
		visibility: "visible",
		low: "Turnover prone",
		high: "Secure",
		badgeHigh: "Secure handle",
		badgeLow: "Loose handle",
		growth: "Little change.",
	},
	lateGameIq: {
		key: "lateGameIq",
		name: "Late-game IQ",
		description:
			"Makes the right decisions at the end of games: shot clock, fouling, two-for-one.",
		effect:
			"Raises (or lowers) the odds his team makes the correct end-of-game decision when he is running the show.",
		visibility: "hidden",
		low: "Loses track",
		high: "Game manager",
		badgeHigh: "Late-game IQ",
		badgeLow: "Careless late",
		growth: "Grows with experience.",
	},
	leadership: {
		key: "leadership",
		name: "Leadership",
		description: "Holds a locker room together.",
		effect:
			"Adds to (or subtracts from) team chemistry. A bounded bonus on the whole lineup's ratings, bigger with several leaders on the court.",
		visibility: "hidden",
		low: "Withdrawn",
		high: "Natural leader",
		badgeHigh: "Leader",
		badgeLow: "Withdrawn",
		growth: "Grows with experience and age.",
	},
	veteranSavvy: {
		key: "veteranSavvy",
		name: "Veteran savvy",
		description:
			"Knows the tricks of the trade from years in the league, and passes them on.",
		effect:
			"Small boosts to end-of-game decisions, ball security, clutch shooting and foul discipline, and to team chemistry. Young teammates (23 and under) develop a little faster next to savvy veterans, a little slower without them.",
		visibility: "visible",
		low: "Green",
		high: "Savvy veteran",
		badgeHigh: "Vet savvy",
		badgeLow: "Green",
		growth: "Grows with each pro season played, levels off after 8-10.",
	},
	workEthic: {
		key: "workEthic",
		name: "Work ethic",
		description: "How hard he works on his game in the offseason.",
		effect:
			"Each preseason: young players with a strong work ethic improve a little more, and every player's bad development years are smaller. Lazy players improve less and drop more. Centered on the league, so overall ratings do not drift up.",
		visibility: "hidden",
		low: "Coasts in the offseason",
		high: "Gym rat",
		badgeHigh: "Gym rat",
		badgeLow: "Lazy summers",
		growth: "Little change.",
	},
	bigGame: {
		key: "bigGame",
		name: "Big-game",
		description:
			"Rises (or shrinks) when the stakes are highest: the playoffs.",
		effect:
			"In every playoff game, the whole game: better (or worse) shooting and free throws and fewer (or more) turnovers. No effect in the regular season.",
		visibility: "hidden",
		low: "Shrinks in the playoffs",
		high: "Big-game riser",
		badgeHigh: "Big-game",
		badgeLow: "Shrinks",
		growth: "Little change.",
	},
	ego: {
		key: "ego",
		name: "Ego (locker room)",
		description: "Team-first glue guy, or a diva who needs the spotlight.",
		effect:
			"Team-first players lift their teammates' mood and the team's chemistry on the court; divas drag both down and are quicker to ask for a trade when unhappy.",
		visibility: "hidden",
		low: "Diva",
		high: "Team-first",
		badgeHigh: "Glue guy",
		badgeLow: "Diva",
		growth: "Little change.",
	},
	temper: {
		key: "temper",
		name: "Temper",
		description: "Keeps his cool, or loses it with the refs and opponents.",
		effect:
			"Hotheads pick up more technical and flagrant fouls (and ejections) with the Technical Fouls setting on, and lose composure late in close games: worse clutch shooting, free throws and ball security. Even-keeled players the opposite.",
		visibility: "visible",
		low: "Hothead",
		high: "Even-keeled",
		badgeHigh: "Cool head",
		badgeLow: "Hothead",
		growth: "Calms down a little with age.",
	},
	loyalty: {
		key: "loyalty",
		name: "Loyalty",
		description:
			"Wants to stay with his team, or likes to see what else is out there.",
		effect:
			"Loyal players ask for less to re-sign with their own team, are happier staying, and ask for trades less often. Disloyal players want a premium to re-sign and are more likely to test free agency.",
		visibility: "hidden",
		low: "Tests the market",
		high: "Loyal",
		badgeHigh: "Loyal",
		badgeLow: "Tests the market",
		growth: "Grows a little with age.",
	},
	roleAcceptance: {
		key: "roleAcceptance",
		name: "Role acceptance",
		description: "How he takes a bench role or reduced minutes.",
		effect:
			"Scales how much less playing time than he expects hurts his mood, and his chance of asking for a trade over it.",
		visibility: "hidden",
		low: "Wants his minutes",
		high: "Accepts any role",
		badgeHigh: "Accepts role",
		badgeLow: "Wants minutes",
		growth: "Grows a little with age.",
	},
	moneyVsWinning: {
		key: "moneyVsWinning",
		name: "Money vs winning",
		description:
			"In free agency, whether the size of the contract or the chance to win matters more to him. High is winning.",
		effect:
			"Ring chasers care more about how good a team is and ask for less to join a winning team; money-first players care less about winning. The minimum contract is never affected.",
		visibility: "hidden",
		low: "Money first",
		high: "Ring chaser",
		badgeHigh: "Ring chaser",
		badgeLow: "Money first",
		growth: "Veterans past 30 start chasing rings.",
	},
	motor: {
		key: "motor",
		name: "Motor",
		description:
			"How well he holds up through heavy minutes and back-to-backs.",
		effect:
			"Scales how fast he tires on the court (separate from endurance), and how much a back-to-back takes out of him.",
		visibility: "visible",
		low: "Runs out of gas",
		high: "Non-stop motor",
		badgeHigh: "Motor",
		badgeLow: "Low motor",
		growth: "Declines slowly after 30.",
	},
	defensiveVersatility: {
		key: "defensiveVersatility",
		name: "Defensive versatility",
		description:
			"Can switch onto bigger and smaller players without giving up much.",
		effect:
			"A small bonus (or penalty) to his team's defense while he is on the court, bigger when the other lineup mixes big and small players.",
		visibility: "visible",
		low: "Exposed on switches",
		high: "Switchable",
		badgeHigh: "Switchable",
		badgeLow: "Switch target",
		growth: "Follows his speed, strength and defensive IQ.",
	},
};
