import type { TraitKey } from "../playerTraits/types.ts";

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
	| "traits";

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
	// Player traits badges: these visible trait scores (0-100) must all be at least the cutoff too. Never awarded when traits are off or hidden.
	traitConditions?: { trait: TraitKey; cutoff: number }[];
	// Also awarded (instead of by ratings) when this trait is high enough
	traitAlternative?: { trait: TraitKey; cutoff: number };
};

export type BadgeTraits = Partial<Record<TraitKey, number>>;

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
	traits: "Player traits",
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

	{
		label: "Sb",
		name: "Stretch big",
		group: "shooting",
		meaning: "A big who can space the floor from three.",
		conditions: [
			c(
				[
					["tp", 1],
					["oiq", 0.2],
				],
				0.51,
			),
			c([["hgt", 1]], 0.58),
		],
	},
	{
		label: "Hp",
		name: "High-post shooter",
		group: "shooting",
		meaning: "A tall shooter who is comfortable from the elbows and mid-range.",
		conditions: [
			c(
				[
					["fg", 1],
					["hgt", 0.7],
					["ft", 0.3],
				],
				0.6,
			),
		],
	},
	{
		label: "Cl",
		name: "Poised scorer",
		group: "scoring",
		meaning:
			"Shot-making touch and poise: trusted with the ball late in games.",
		conditions: [
			c(
				[
					["oiq", 1],
					["fg", 0.8],
					["ft", 0.8],
					["tp", 0.4],
				],
				0.64,
			),
		],
	},
	{
		label: "Is",
		name: "Isolation scorer",
		group: "scoring",
		meaning: "Can get a bucket on his own one-on-one.",
		conditions: [
			c(
				[
					["drb", 1],
					["fg", 0.8],
					["ins", 0.6],
					["oiq", 0.8],
					["spd", 0.4],
				],
				0.63,
			),
		],
	},
	{
		label: "Bu",
		name: "Bully",
		group: "scoring",
		meaning: "Uses strength to bully smaller defenders on the way to the rim.",
		conditions: [
			c(
				[
					["stre", 1.5],
					["ins", 1],
					["drb", 0.5],
					["dnk", 0.5],
				],
				0.62,
			),
		],
	},
	{
		label: "Ab",
		name: "Ankle breaker",
		group: "playmaking",
		meaning: "Shifty handle that shakes defenders off the dribble.",
		conditions: [
			c(
				[
					["drb", 1.5],
					["spd", 1],
					["oiq", 0.3],
				],
				0.69,
			),
		],
	},
	{
		label: "Pt",
		name: "Post playmaker",
		group: "playmaking",
		meaning:
			"Passes well out of the post: finds cutters and shooters from the block.",
		conditions: [
			c(
				[
					["pss", 1],
					["ins", 0.8],
					["hgt", 0.8],
					["oiq", 0.6],
				],
				0.58,
			),
		],
	},
	{
		label: "Tw",
		name: "Two-way wing",
		group: "defense",
		meaning: "Defends and shoots: the classic three-and-D wing.",
		conditions: [
			c(
				[
					["tp", 1],
					["diq", 1],
					["spd", 0.6],
					["hgt", 0.3],
				],
				0.6,
			),
		],
	},
	{
		label: "Dr",
		name: "Defensive rebounder",
		group: "rebounding",
		meaning: "Ends possessions by securing the defensive glass.",
		conditions: [
			c(
				[
					["reb", 1.5],
					["hgt", 1],
					["diq", 0.8],
					["stre", 0.4],
				],
				0.64,
			),
		],
	},
	{
		label: "Hu",
		name: "Hustler",
		traitAlternative: { trait: "hustle", cutoff: 61 },
		group: "mental",
		meaning:
			"Plays hard every possession: loose balls, deflections and second efforts.",
		conditions: [
			c(
				[
					["endu", 1],
					["diq", 0.8],
					["reb", 0.6],
					["spd", 0.6],
				],
				0.6,
			),
		],
	},
	{
		label: "Gg",
		name: "Glue guy",
		group: "mental",
		meaning: "Solid at a bit of everything, makes lineups work.",
		conditions: [
			c(
				[
					["oiq", 1],
					["diq", 1],
					["pss", 0.6],
					["reb", 0.6],
					["drb", 0.4],
					["tp", 0.4],
				],
				0.6,
			),
		],
	},

	// Player traits badges (only with the Player traits setting on, from what the user can see of the traits)
	{
		label: "Ch",
		name: "Clutch performer",
		group: "traits",
		meaning: "Rises to the moment in close games late (clutch trait).",
		conditions: [],
		traitConditions: [{ trait: "clutch", cutoff: 54 }],
	},
	{
		label: "Rl",
		name: "Mr. Reliable",
		group: "traits",
		meaning: "Same player every night (consistency trait).",
		conditions: [],
		traitConditions: [{ trait: "consistency", cutoff: 55 }],
	},
	{
		label: "Im",
		name: "Iron man",
		group: "traits",
		meaning: "Durable and tireless: durability trait plus endurance.",
		conditions: [c([["endu", 1]], 0.55)],
		traitConditions: [{ trait: "durability", cutoff: 62 }],
	},
	{
		label: "Sd",
		name: "Smart shooter",
		group: "traits",
		meaning:
			"Takes good shots and can make them: shot discipline trait plus shooting.",
		conditions: [
			c(
				[
					["tp", 1],
					["fg", 1],
					["ft", 0.5],
				],
				0.55,
			),
		],
		traitConditions: [{ trait: "shotDiscipline", cutoff: 48 }],
	},
	{
		label: "Cu",
		name: "Cutter",
		group: "traits",
		meaning:
			"Always moving without the ball, finds easy looks (off-ball trait).",
		conditions: [],
		traitConditions: [{ trait: "offBall", cutoff: 66 }],
	},
	{
		label: "Ss",
		name: "Screen setter",
		group: "traits",
		meaning: "Sets hard, smart screens that free teammates (screen trait).",
		conditions: [],
		traitConditions: [{ trait: "screen", cutoff: 57 }],
	},
	{
		label: "Dd",
		name: "Disciplined defender",
		group: "traits",
		meaning:
			"Defends without fouling: foul discipline trait plus defensive IQ.",
		conditions: [c([["diq", 1]], 0.55)],
		traitConditions: [{ trait: "foulDiscipline", cutoff: 60 }],
	},
	{
		label: "Hh",
		name: "Pressure-proof handler",
		group: "traits",
		meaning:
			"Keeps the ball safe under pressure: handle trait plus ball security.",
		conditions: [
			c(
				[
					["drb", 1],
					["oiq", 1.2],
					["pss", 0.3],
				],
				0.58,
			),
		],
		traitConditions: [{ trait: "handle", cutoff: 50 }],
	},
	{
		label: "Lg",
		name: "Late-game IQ",
		group: "traits",
		meaning:
			"Makes the right decisions at the end of games (late-game IQ trait).",
		conditions: [],
		traitConditions: [{ trait: "lateGameIq", cutoff: 48 }],
	},
	{
		label: "Ld",
		name: "Leader",
		group: "traits",
		meaning:
			"Makes teammates better and keeps the locker room together (leadership trait).",
		conditions: [],
		traitConditions: [{ trait: "leadership", cutoff: 42 }],
	},
	{
		label: "Rc",
		name: "Quick recovery",
		group: "traits",
		meaning: "Bounces back fast from fatigue (recovery trait).",
		conditions: [],
		traitConditions: [{ trait: "recovery", cutoff: 41 }],
	},
];

// Other sports have different ratings, so they get no extended badges
export const SKILL_BADGES: SkillBadgeDef[] =
	__SPORT === "basketball" ? ALL_BASKETBALL_BADGES : [];

export const SKILL_BADGES_BY_LABEL: Record<string, SkillBadgeDef> =
	Object.fromEntries(SKILL_BADGES.map((def) => [def.label, def]));

// The built-in skills from ratings.skills. Combos may consume them at display time only, ratings.skills itself (and the sim) never changes.
export const ORIGINAL_SKILL_LABELS = [
	"3",
	"A",
	"B",
	"Di",
	"Dp",
	"Po",
	"Ps",
	"R",
	"V",
];

export type SkillComboDef = {
	label: string;
	name: string;
	meaning: string;
	// Every one of these is needed...
	all: string[];
	// ...plus at least minAny of these (default 1). Every one present is absorbed too, so minAny 0 means "optional extras".
	any?: string[];
	minAny?: number;
	// Absorbed too when present, but never required
	extra?: string[];
	// Level 2 combos group level 1 combos (and badges) into a broader one. All level 1 combos are tried first.
	level?: 2;
};

// Minimum number of parts a combo needs; within a level, bigger combos are tried first
export const comboSize = (def: SkillComboDef) =>
	def.all.length + (def.any ? (def.minAny ?? 1) : 0);

// One greedy pass, largest combos first (ties in this order), each skill or badge used at most once
const ALL_BASKETBALL_COMBOS: SkillComboDef[] = [
	{
		label: "PS",
		name: "Pure shooter",
		meaning:
			"Shoots it from everywhere: three point shooter (3), off-dribble (Pu), mid-range (Mr) and free throws (FT); also absorbs Cs and Hp.",
		all: ["3", "Pu", "Mr", "FT"],
		any: ["Cs", "Hp"],
		minAny: 0,
	},
	{
		label: "Mc",
		name: "Maestro",
		meaning:
			"Runs everything: passer (Ps), ball handler (B), plus ball-secure (Sf) and/or ankle breaker (Ab).",
		all: ["Ps", "B"],
		any: ["Sf", "Ab"],
		minAny: 1,
	},
	{
		label: "Ib",
		name: "Interior beast",
		meaning:
			"Owns the paint: post scorer (Po), rim finisher (Fn) and dunker (Dk); also absorbs Bu.",
		all: ["Po", "Fn", "Dk"],
		any: ["Bu"],
		minAny: 0,
	},
	{
		label: "Bm",
		name: "Board master",
		meaning: "Rebounder (R) on both glasses: Or and Dr.",
		all: ["R", "Or", "Dr"],
	},
	{
		label: "Sp",
		name: "Sharpshooter",
		meaning:
			"Three point shooter (3) who is automatic from the line (FT); also absorbs Cs.",
		all: ["3", "FT"],
		any: ["Cs"],
		minAny: 0,
	},
	{
		label: "Sn",
		name: "Spot-up sniper",
		meaning: "Three point shooter (3) and catch-and-shoot specialist (Cs).",
		all: ["3", "Cs"],
	},
	{
		label: "Sm",
		name: "Shot maker",
		meaning: "Off-dribble (Pu) and mid-range (Mr) shot maker; also absorbs Hp.",
		all: ["Pu", "Mr"],
		any: ["Hp"],
		minAny: 0,
	},
	{
		label: "Pk",
		name: "Pick-and-pop big",
		meaning: "Stretch big (Sb) who also shoots from the high post (Hp).",
		all: ["Sb", "Hp"],
	},
	{
		label: "Pf",
		name: "Paint finisher",
		meaning: "Post scorer (Po) and rim finisher (Fn).",
		all: ["Po", "Fn"],
	},
	{
		label: "Pw",
		name: "Power finisher",
		meaning: "Dunker (Dk) who also bullies (Bu) or finishes (Fn) inside.",
		all: ["Dk"],
		any: ["Bu", "Fn"],
		minAny: 1,
	},
	{
		label: "FG",
		name: "Floor general",
		meaning: "Passer (Ps) and ball handler (B).",
		all: ["Ps", "B"],
	},
	{
		label: "Bw",
		name: "Ball wizard",
		meaning: "Ball handler (B) and ankle breaker (Ab); also absorbs Sf.",
		all: ["B", "Ab"],
		any: ["Sf"],
		minAny: 0,
	},
	{
		label: "Fb",
		name: "Facilitating big",
		meaning: "Post playmaker (Pt) who is also a passer (Ps) or connector (Cn).",
		all: ["Pt"],
		any: ["Ps", "Cn"],
		minAny: 1,
	},
	{
		label: "Sw",
		name: "Switchable defender",
		meaning:
			"Both an interior (Di) and a perimeter (Dp) defender, so he can guard anyone after a switch.",
		all: ["Dp", "Di"],
	},
	{
		label: "Rp",
		name: "Rim protector",
		meaning: "Interior defender (Di) and shot blocker (Bk).",
		all: ["Di", "Bk"],
	},
	{
		label: "Pl",
		name: "Perimeter lockdown",
		meaning:
			"Point-of-attack defender (Pa) who is also a pickpocket (St), perimeter defender (Dp), two-way wing (Tw) or disciplined defender (Dd).",
		all: ["Pa"],
		any: ["St", "Dp", "Tw", "Dd"],
		minAny: 1,
	},
	{
		label: "3D",
		name: "3-and-D wing",
		meaning: "Three point shooter (3) who is also a two-way wing (Tw).",
		all: ["3", "Tw"],
	},
	{
		label: "Oc",
		name: "Offensive crasher",
		meaning:
			"Offensive glass (Or) plus rebounder (R) or defensive rebounder (Dr).",
		all: ["Or"],
		any: ["R", "Dr"],
		minAny: 1,
	},
	{
		label: "Gc",
		name: "Glass cleaner",
		meaning: "Rebounder (R) and defensive rebounder (Dr).",
		all: ["R", "Dr"],
	},
	{
		label: "Ex",
		name: "Explosive athlete",
		meaning: "Athlete (A) and athletic freak (Af); also absorbs Tr.",
		all: ["A", "Af"],
		any: ["Tr"],
		minAny: 0,
	},
	{
		label: "Py",
		name: "Physical specialist",
		meaning:
			"Physical presence (Ph) plus iron lungs (Fit), athlete (A), athletic freak (Af) or screen setter (Ss).",
		all: ["Ph"],
		any: ["Fit", "A", "Af", "Ss"],
		minAny: 1,
	},
	{
		label: "Gt",
		name: "Go-to scorer",
		meaning:
			"Any two of volume scorer (V), isolation scorer (Is), closer (Cl) and foul drawer (Fd).",
		all: [],
		any: ["V", "Is", "Cl", "Fd"],
		minAny: 2,
	},
	{
		label: "Gl",
		name: "Glue guy",
		meaning:
			"Any two of high IQ (Hi), glue guy (Gg), hustler (Hu) and connector (Cn).",
		all: [],
		any: ["Hi", "Gg", "Hu", "Cn"],
		minAny: 2,
	},
	{
		label: "Mo",
		name: "Motor",
		meaning:
			"Any two of transition runner (Tr), iron lungs (Fit) and hustler (Hu).",
		all: [],
		any: ["Tr", "Fit", "Hu"],
		minAny: 2,
	},
	{
		label: "Sc",
		name: "Scoring machine",
		meaning:
			"Scores every way: any three scoring combos or badges (PS, Sp, Sn, Sm, Pk, Ib, Pf, Pw, Gt, 3D, Ce and single shooting/finishing/scoring badges); also absorbs V, 3 and Po.",
		all: [],
		any: [
			"PS",
			"Sp",
			"Sn",
			"Sm",
			"Pk",
			"Ib",
			"Pf",
			"Pw",
			"Gt",
			"3D",
			"Ce",
			"Sd",
			"Cu",
			"Mr",
			"Pu",
			"Cs",
			"FT",
			"Hp",
			"Dk",
			"Fn",
			"Bu",
			"Fd",
			"Cl",
			"Is",
		],
		minAny: 3,
		extra: ["V", "3", "Po"],
		level: 2,
	},
	{
		label: "Dm",
		name: "Defensive menace",
		meaning:
			"Any three defensive combos or badges: Rp, Pl, 3D, Dd, Bk, St, Tw, Pa, Di (a Di already in Sw stays there). Never absorbs Sw.",
		all: [],
		any: ["Rp", "Pl", "3D", "Dd", "Bk", "St", "Tw", "Pa", "Di"],
		minAny: 3,
		extra: ["Pa"],
		level: 2,
	},
	{
		label: "Pe",
		name: "Playmaking engine",
		meaning:
			"Any three playmaking combos or badges (Mc, FG, Bw, Fb, Hh, Cn, Pt, Sf, Ab).",
		all: [],
		any: ["Mc", "FG", "Bw", "Fb", "Hh", "Cn", "Pt", "Sf", "Ab"],
		minAny: 3,
		extra: ["Ps", "B"],
		level: 2,
	},
	{
		label: "Pr",
		name: "Physical marvel",
		meaning:
			"Any three physical combos or badges: Ex, Py, Mo, Im, Ih, Fit, A, Af, Ph, Tr, Rc.",
		all: [],
		any: ["Ex", "Py", "Mo", "Im", "Ih", "Fit", "A", "Af", "Ph", "Tr", "Rc"],
		minAny: 3,
		extra: ["Rc", "Ih", "Tr", "Fit", "A", "Af", "Ph", "Hu"],
		level: 2,
	},
	{
		label: "Rg",
		name: "Rebounding giant",
		meaning:
			"Any three rebounding/rim combos or badges: Bm, Oc, Gc, Rp, Bk, Or, Dr, R.",
		all: [],
		any: ["Bm", "Oc", "Gc", "Rp", "Bk", "Or", "Dr", "R"],
		minAny: 3,
		extra: ["Or", "Dr", "R"],
		level: 2,
	},
	{
		label: "Ce",
		name: "Closer",
		meaning:
			"Clutch performer (Ch) with late-game IQ (Lg); also absorbs poised scorer (Cl).",
		all: ["Ch", "Lg"],
		any: ["Cl"],
		minAny: 0,
	},
	{
		label: "Cp",
		name: "Captain",
		meaning:
			"Leader (Ld) who is also a glue guy (Gl), high IQ (Hi), glue guy badge (Gg) or Mr. Reliable (Rl); absorbs those and Hu, Lg.",
		all: ["Ld"],
		any: ["Gl", "Hi", "Gg", "Rl"],
		extra: ["Rl", "Hi", "Gg", "Hu", "Lg"],
		level: 2,
	},
	{
		label: "Ih",
		name: "Iron horse",
		meaning: "Iron man (Im) with quick recovery (Rc) or Mr. Reliable (Rl).",
		all: ["Im"],
		any: ["Rc", "Rl"],
	},
	{
		label: "Sv",
		name: "Savvy pro",
		meaning:
			"Does the little things right: any three of Mr. Reliable (Rl), disciplined defender (Dd), smart shooter (Sd), pressure-proof handler (Hh), cutter (Cu), screen setter (Ss), late-game IQ (Lg) and high IQ (Hi).",
		all: [],
		any: ["Rl", "Dd", "Sd", "Hh", "Cu", "Ss", "Lg", "Hi"],
		minAny: 3,
		level: 2,
	},
];

export const SKILL_COMBOS: SkillComboDef[] =
	__SPORT === "basketball"
		? ALL_BASKETBALL_COMBOS.map((def, i) => ({ def, i }))
				.sort(
					(a, b) =>
						(a.def.level ?? 1) - (b.def.level ?? 1) ||
						comboSize(b.def) - comboSize(a.def) ||
						a.i - b.i,
				)
				.map(({ def }) => def)
		: [];

export const SKILL_COMBOS_BY_LABEL: Record<string, SkillComboDef> =
	Object.fromEntries(SKILL_COMBOS.map((def) => [def.label, def]));
