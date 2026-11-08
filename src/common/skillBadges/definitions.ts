// Extended skill badges (basketball only). These are DISPLAY-ONLY: they are never stored in ratings.skills and never feed the game sim unless a later layer opts in. Everything here is pure data so it can be reused from the worker, the sim or the UI.

export type BadgeRatingKey =
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
	| "reb";

export type BadgeRatings = Record<BadgeRatingKey, number>;

export type BadgeGroup =
	| "shooting"
	| "scoring"
	| "playmaking"
	| "defense"
	| "rebounding"
	| "physical"
	| "mental"
	| "flag";

// A composite is a weighted average of ratings on a 0-1 scale (same maths as compositeRating, without fuzz).
export type BadgeComposite = {
	ratings: (BadgeRatingKey | 50)[];
	weights: number[];
};

export type BadgeCondition = BadgeComposite & {
	// "above": composite >= cutoff, "below": composite <= cutoff
	dir?: "above" | "below";
	cutoff: number;
};

export type SkillBadgeDef = {
	label: string;
	name: string;
	group: BadgeGroup;
	meaning: string;
	// All conditions must hold. The first one is the "main" composite, used for ranking leaders.
	conditions: BadgeCondition[];
	flag?: boolean;
};

const c = (
	pairs: [BadgeRatingKey | 50, number][],
	cutoff: number,
	dir: "above" | "below" = "above",
): BadgeCondition => ({
	ratings: pairs.map((x) => x[0]),
	weights: pairs.map((x) => x[1]),
	cutoff,
	dir,
});

export const BADGE_GROUP_NAMES: Record<BadgeGroup, string> = {
	shooting: "Shooting",
	scoring: "Scoring",
	playmaking: "Playmaking",
	defense: "Defense",
	rebounding: "Rebounding",
	physical: "Physical",
	mental: "Mental",
	flag: "Warning flags",
};

// Cutoffs were calibrated on randomly generated 30-team leagues, see skillBadges.test.ts (calibration report is skipped by default).
const ALL_BASKETBALL_BADGES: SkillBadgeDef[] = [
	{
		label: "Cs",
		name: "Catch-and-shoot specialist",
		group: "shooting",
		meaning:
			"Elite spot-up three point shooter with the shooting touch to knock down open looks.",
		conditions: [
			c(
				[
					["tp", 1.2],
					["ft", 0.4],
					["oiq", 0.4],
				],
				0.65,
			),
		],
	},
	{
		label: "Pu",
		name: "Off-dribble shooter",
		group: "shooting",
		meaning:
			"Can create and hit a jumper off the dribble: good handle plus a good shot.",
		conditions: [
			c(
				[
					["drb", 0.8],
					["tp", 1],
					["fg", 0.5],
					["spd", 0.3],
				],
				0.67,
			),
		],
	},
	{
		label: "Mr",
		name: "Mid-range maestro",
		group: "shooting",
		meaning: "Deadly from the mid-range: strong mid-range shooting touch.",
		conditions: [
			c(
				[
					["fg", 1.3],
					["ft", 0.3],
					["oiq", 0.3],
					["tp", 0.2],
				],
				0.66,
			),
		],
	},
	{
		label: "FT",
		name: "Free-throw ace",
		group: "shooting",
		meaning: "Almost automatic from the line.",
		conditions: [c([["ft", 1]], 0.68)],
	},
	{
		label: "Fn",
		name: "Rim finisher",
		group: "scoring",
		meaning:
			"Converts around the basket: inside scoring touch, size and instincts.",
		conditions: [
			c(
				[
					["ins", 1],
					["dnk", 0.6],
					["hgt", 0.6],
					["oiq", 0.3],
					["stre", 0.3],
				],
				0.6,
			),
		],
	},
	{
		label: "Dk",
		name: "Dunker",
		group: "scoring",
		meaning: "Explosive above the rim: posterizes defenders and finishes lobs.",
		conditions: [
			c(
				[
					["dnk", 1.5],
					["jmp", 1],
					["stre", 0.3],
				],
				0.65,
			),
		],
	},
	{
		label: "Tr",
		name: "Transition runner",
		group: "scoring",
		meaning:
			"Runs the floor and the fast break, with the legs to do it all game.",
		conditions: [
			c(
				[
					["spd", 1.5],
					["endu", 1],
					["jmp", 0.3],
					["dnk", 0.3],
					["drb", 0.3],
				],
				0.64,
			),
		],
	},
	{
		label: "FG",
		name: "Floor general",
		group: "playmaking",
		meaning:
			"Elite passing, handle and court vision: runs the offence like a point guard.",
		conditions: [
			c(
				[
					["pss", 1.2],
					["oiq", 1],
					["drb", 0.6],
				],
				0.68,
			),
		],
	},
	{
		label: "Cn",
		name: "Connector",
		group: "playmaking",
		meaning:
			"A bigger player who passes and reads the game well, a secondary playmaker.",
		conditions: [
			c(
				[
					["pss", 1],
					["oiq", 1],
					["hgt", 0.6],
				],
				0.59,
			),
		],
	},
	{
		label: "Sf",
		name: "Ball-secure",
		group: "playmaking",
		meaning: "Takes care of the ball: handle and instincts keep turnovers low.",
		conditions: [
			c(
				[
					["drb", 1],
					["oiq", 1.2],
					["pss", 0.3],
				],
				0.65,
			),
		],
	},
	{
		label: "Fd",
		name: "Foul drawer",
		group: "scoring",
		meaning: "Attacks the rim and gets to the line, and converts when there.",
		conditions: [
			c(
				[
					["drb", 1],
					["spd", 1],
					["dnk", 1],
					["ins", 0.5],
					["ft", 0.7],
					["oiq", 0.5],
				],
				0.61,
			),
		],
	},
	{
		label: "St",
		name: "Pickpocket",
		group: "defense",
		meaning: "Quick hands and reads: generates steals.",
		conditions: [
			c(
				[
					["diq", 2],
					["spd", 1.2],
					["jmp", 0.3],
				],
				0.61,
			),
		],
	},
	{
		label: "Bk",
		name: "Shot blocker",
		group: "defense",
		meaning:
			"Height and hops to erase shots at the rim (the blocking composite the sim uses).",
		conditions: [
			c(
				[
					["hgt", 2.5],
					["jmp", 1.5],
					["diq", 0.5],
				],
				0.6,
			),
		],
	},
	{
		label: "Sw",
		name: "Switchable defender",
		group: "defense",
		meaning:
			"Good against both perimeter players and bigs, so he can guard anyone after a switch.",
		conditions: [
			c(
				[
					["hgt", 0.5],
					["stre", 0.5],
					["spd", 2],
					["jmp", 0.5],
					["diq", 1],
				],
				0.6,
			),
			c(
				[
					["hgt", 2.5],
					["stre", 1],
					["spd", 0.5],
					["jmp", 0.5],
					["diq", 2],
				],
				0.46,
			),
		],
	},
	{
		label: "Pa",
		name: "Point-of-attack defender",
		group: "defense",
		meaning: "Pressures ball handlers: quick feet and defensive instincts.",
		conditions: [
			c(
				[
					["spd", 2],
					["diq", 1.5],
					["stre", 0.5],
				],
				0.63,
			),
		],
	},
	{
		label: "Or",
		name: "Offensive glass",
		group: "rebounding",
		meaning: "Crashes the offensive boards for second chances.",
		conditions: [
			c(
				[
					["reb", 1.5],
					["hgt", 1.2],
					["jmp", 0.6],
					["stre", 0.5],
					["oiq", 0.5],
				],
				0.6,
			),
		],
	},
	{
		label: "Ph",
		name: "Physical presence",
		group: "physical",
		meaning:
			"Strong and big: sets bruising screens and wins the physical battles.",
		conditions: [
			c(
				[
					["stre", 2],
					["hgt", 1],
					["ins", 0.3],
				],
				0.63,
			),
		],
	},
	{
		label: "Af",
		name: "Athletic freak",
		group: "physical",
		meaning: "Rare combination of speed, leaping, strength and size.",
		conditions: [
			c(
				[
					["spd", 1],
					["jmp", 1],
					["stre", 0.7],
					["hgt", 0.5],
				],
				0.66,
			),
		],
	},
	{
		label: "Fit",
		name: "Iron lungs",
		group: "physical",
		meaning: "Elite endurance: stays effective over long minutes.",
		conditions: [c([["endu", 1]], 0.62)],
	},
	{
		label: "Hi",
		name: "High basketball IQ",
		group: "mental",
		meaning: "Reads the game well on both ends.",
		conditions: [
			c(
				[
					["oiq", 1],
					["diq", 1],
				],
				0.6,
			),
		],
	},

	// Warning flags: useful for decisions, shown in a distinct style
	{
		label: "Ld",
		name: "Liability defender",
		group: "flag",
		meaning:
			"Defensive ratings are well below normal: opponents will target him.",
		flag: true,
		conditions: [
			c(
				[
					["hgt", 1],
					["stre", 1],
					["spd", 1],
					["jmp", 0.5],
					["diq", 2],
				],
				0.39,
				"below",
			),
		],
	},
	{
		label: "Pb",
		name: "Poor-shooting big",
		group: "flag",
		meaning:
			"Tall with little shooting touch: clogs the floor and can be fouled for free.",
		flag: true,
		conditions: [
			c(
				[
					["tp", 1],
					["fg", 1],
					["ft", 1],
				],
				0.3,
				"below",
			),
			c([["hgt", 1]], 0.6),
		],
	},
	{
		label: "To",
		name: "Turnover-prone",
		group: "flag",
		meaning: "Poor handle and instincts: likely to give the ball away.",
		flag: true,
		conditions: [
			c(
				[
					["drb", 1],
					["oiq", 1.2],
					["pss", 0.3],
				],
				0.335,
				"below",
			),
		],
	},
	{
		label: "Fp",
		name: "Foul-prone",
		group: "flag",
		meaning: "Low defensive IQ and mobility: picks up fouls easily.",
		flag: true,
		conditions: [
			c(
				[
					[50, 3],
					["hgt", 1],
					["diq", -1],
					["spd", -1],
				],
				0.705,
			),
		],
	},
	{
		label: "Hk",
		name: "Hack-a target",
		group: "flag",
		meaning: "A very poor free-throw shooter.",
		flag: true,
		conditions: [c([["ft", 1]], 0.25, "below")],
	},
];

// Other sports have different ratings, so they get no extended badges
export const SKILL_BADGES: SkillBadgeDef[] =
	__SPORT === "basketball" ? ALL_BASKETBALL_BADGES : [];

export const SKILL_BADGES_BY_LABEL: Record<string, SkillBadgeDef> =
	Object.fromEntries(SKILL_BADGES.map((def) => [def.label, def]));
