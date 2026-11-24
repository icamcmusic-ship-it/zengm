// archv2: compositional archetype names, like NBA 2K's. A name is a core ROLE (what he is first of all: Playmaker, Slasher,
// Stretch, Board Enforcer, Perimeter Lock, ...) with up to two DESCRIPTORS in front of it (2-Way, Crafty, Mid-Paint,
// Glass-Cleaning, Shot-Erasing, ...). Every word is a yes/no test against players at his position (v2/tests.ts, the
// rulebook's bars: rulebook.data.ts), so a name only says what he has: promises are kept by construction.
//
// Adding a word is one entry: a role (ROLES) or a descriptor (DESCRIPTORS) naming the rulebook concept its test reads (or a
// custom test in tests.ts), its display words and, for a descriptor, its slot. The archgaps proposals (Glue, Game Manager,
// Energy) go in that way once approved.
//
// A composed name that is one of our builds' names (or a 2K alias of one) IS that build (its id, description, colours and
// family); any other composed name is shown as it is, with a generated description, under a composed id ("v2:" + role +
// ":" + descriptors) that archetypeById resolves (composedArchetype).
import { conceptsOf, CONCEPTS } from "../twoK/concepts.ts";
import type { Family } from "../families.ts";
import type {
	Archetype,
	ArchetypeFamily,
	ArchetypeGroup,
	Pos,
} from "../types.ts";

import { HONEST_ROLES } from "./honest.ts";
export type PosGroup = "guard" | "wing" | "big";
export const GROUP_OF: Record<Pos, PosGroup> = {
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
const ALL: PosGroup[] = ["guard", "wing", "big"];

// A role: the head of the name
export type RoleDef = {
	key: string;
	// Display: the default name, and alternatives that the labeled neighbours' names may pick (v2/engine.ts word votes)
	names: string[];
	// The rulebook concepts it is tested on: the first at its lead bar (and his head skill must be one of his three best),
	// the rest at their support bar. A custom test (tests.ts CUSTOM_TESTS) may stand in for a concept key.
	concepts: string[];
	groups: PosGroup[];
	// The name when a descriptor is in front (default: names[0]), e.g. "Open-Lane Burner" alone, "2-Way Burner" with one
	withDesc?: string;
	// The display word for a size group, when it differs (Stretch Four / Stretch Five style)
	byGroup?: Partial<Record<PosGroup, string>>;
	// archv3: a role that takes no descriptor (the role players' names: "no standout" has nothing to add)
	bare?: boolean;
	// archreview2: an honest name (honest.ts): never a candidate of the reading, given by the honest rule, with its own
	// description and family
	honest?: true;
	desc?: string;
	family?: Family;
	// archnouns: a word of the noun names only (nouns.ts): never a candidate of the reading, never tested
	nounOnly?: true;
};

// A descriptor: a word in front of the role
export type DescDef = {
	key: string;
	names: string[];
	concept: string;
	// 0: 2-Way; 1: style (Crafty, Physical, High-Flying); 2: skill (Mid-Paint, Glass-Cleaning, Shot-Erasing, ...). A name
	// has at most one word per slot 0 and 1, and its descriptors are written in slot order (2K's order)
	slot: 0 | 1 | 2;
	groups?: PosGroup[];
	// archv3: the word at a size group (the neighbours' variant is not taken over it)
	byGroup?: Partial<Record<PosGroup, string>>;
	// archnouns: a word of the noun names only (nouns.ts): never a candidate of the reading, never tested
	nounOnly?: true;
};

export const ROLES: RoleDef[] = [
	{
		key: "playmaker",
		names: ["Playmaker", "Dimer"],
		concepts: ["pass"],
		groups: ALL,
	},
	{
		key: "engine",
		names: ["Offensive Engine"],
		concepts: ["pass", "creator", "scorer"],
		groups: ["guard", "wing"],
	},
	{
		key: "creator",
		// (archv3: "Creator" alone is not a name; "Shot Creator" is 2K's)
		names: ["Shot Creator"],
		withDesc: "Creator",
		concepts: ["creator"],
		groups: ["guard", "wing"],
	},
	{
		key: "shotHunter",
		names: ["Shot Hunter"],
		concepts: ["shotHunt", "creator"],
		groups: ["guard", "wing"],
	},
	{
		key: "sniper",
		names: ["Sniper"],
		concepts: ["shotHunt"],
		groups: ["guard", "wing"],
	},
	{
		key: "sharpshooter",
		names: ["Sharpshooter"],
		concepts: ["catchShoot"],
		groups: ["guard", "wing"],
	},
	{
		key: "stretch",
		// (archv3: "Stretch" alone read as a half name, "v2:stretch::big" in the user's pick; with a word in front it is
		// 2K's "Board-Crashing Stretch")
		names: ["Stretch Big"],
		withDesc: "Stretch",
		concepts: ["catchShoot"],
		groups: ["big"],
	},
	{
		key: "bucketChaser",
		names: ["Bucket Chaser"],
		concepts: ["chaser", "scorer"],
		groups: ["guard", "wing"],
	},
	{
		key: "maestro",
		names: ["Mid-Range Maestro"],
		withDesc: "Maestro",
		concepts: ["mid"],
		groups: ALL,
	},
	{
		key: "slasher",
		names: ["Slasher"],
		concepts: ["slash"],
		groups: ["guard", "wing"],
	},
	{
		key: "finisher",
		names: ["Finisher", "Interior Finisher"],
		concepts: ["finish"],
		groups: ALL,
		// (archv5: the user's "2-Way Interior Finisher" for a big)
		byGroup: { big: "Interior Finisher" },
	},
	{
		key: "burner",
		names: ["Open-Lane Burner"],
		withDesc: "Burner",
		concepts: ["burner"],
		groups: ["guard", "wing"],
	},
	{
		key: "highFlyer",
		names: ["High Flyer"],
		concepts: ["air"],
		groups: ["guard", "wing"],
	},
	{
		key: "cutter",
		names: ["Off-Ball Cutter"],
		withDesc: "Cutter",
		concepts: ["cutter"],
		groups: ["wing", "big"],
	},
	{
		key: "hammer",
		names: ["Rim Hammer"],
		withDesc: "Hammer",
		concepts: ["hammer"],
		groups: ["big"],
	},
	{
		key: "rimRunner",
		names: ["Rim Runner"],
		concepts: ["run"],
		groups: ["big"],
	},
	{
		key: "lobThreat",
		names: ["Lob Threat"],
		concepts: ["lob"],
		groups: ["big"],
	},
	{
		key: "lock",
		names: ["Lockdown Defender"],
		withDesc: "Lock",
		concepts: ["lockdown"],
		groups: ["guard", "wing"],
	},
	{
		key: "ballHawk",
		names: ["Ball Hawk"],
		concepts: ["steal"],
		groups: ["guard", "wing"],
	},
	{
		key: "rimProtector",
		names: ["Shot Eraser", "Paint Protector", "Rim Protector"],
		concepts: ["rimD"],
		groups: ["wing", "big"],
	},
	{
		key: "boardEnforcer",
		names: ["Board Enforcer", "Glass Cleaner"],
		concepts: ["reb"],
		groups: ["wing", "big"],
	},
	{
		key: "boardHunter",
		names: ["Board Hunter"],
		concepts: ["oreb"],
		groups: ["wing", "big"],
	},
	{
		key: "postBully",
		names: ["Post Bully"],
		withDesc: "Bully",
		concepts: ["post", "strength"],
		groups: ["wing", "big"],
	},
	{
		key: "postPro",
		names: ["Post Pro"],
		concepts: ["post"],
		groups: ["wing", "big"],
	},
	// archgaps (user-approved): the role players' roles (custom tests in tests.ts: breadth, no standout)
	// archv3 (the user's 2K list, batch 4): a defender who guards inside and out (perimeter and rim D both his)
	{
		key: "switchDefender",
		bare: true,
		names: ["Switch Defender"],
		concepts: ["switchD"],
		groups: ["wing", "big"],
	},
	{
		key: "glueWing",
		bare: true,
		names: ["Glue Wing"],
		concepts: ["glueWing"],
		groups: ["wing"],
	},
	{
		key: "glueGuard",
		bare: true,
		names: ["Glue Guard"],
		concepts: ["glueGuard"],
		groups: ["guard"],
	},
	// archv4 gap roles (the archv3 gap dump's weak clusters): a small guard who scores on floaters and touch, and a
	// prospect with the burst and the handle who is still raw on offense
	{
		key: "floaterGuard",
		bare: true,
		names: ["Crafty Floater Guard"],
		concepts: ["floaterRole"],
		groups: ["guard"],
	},
	{
		key: "rawHandler",
		bare: true,
		names: ["Raw Athletic Handler"],
		concepts: ["rawHandlerRole"],
		groups: ["guard", "wing"],
	},
	// archv5 (the user's labels of the archcmp sample): an interior scorer with no jumper, a physical rebounding big with
	// no jumper, a scoring guard who does not defend, and the low-ovr labels (no skill good in absolute terms: young
	// players "Prospect", with the one tool he has; older ones "Depth Piece"). Their tests read his ratings themselves.
	{
		key: "paintBeast",
		names: ["Paint Beast"],
		concepts: ["paintBeastRole"],
		groups: ["wing", "big"],
	},
	{
		key: "interiorForce",
		bare: true,
		names: ["Interior Force"],
		concepts: ["interiorForceRole"],
		groups: ["wing", "big"],
	},
	{
		key: "offGuard",
		bare: true,
		names: ["Offensive-Minded Guard"],
		concepts: ["offGuardRole"],
		groups: ["guard"],
	},
	{
		key: "prospect",
		names: ["Prospect"],
		concepts: ["prospectRole"],
		groups: ALL,
	},
	{
		key: "depthPiece",
		bare: true,
		names: ["Depth Piece"],
		concepts: ["depthPieceRole"],
		groups: ALL,
	},
	{
		key: "gameManager",
		bare: true,
		names: ["Steady Game Manager"],
		concepts: ["gameManagerRole"],
		groups: ["guard"],
	},
	{
		key: "energyBig",
		bare: true,
		names: ["Energy Big"],
		concepts: ["energyRole"],
		groups: ["big"],
	},
];

export const DESCRIPTORS: DescDef[] = [
	{ key: "twoWay", names: ["2-Way"], concept: "twoWay", slot: 0 },
	{ key: "crafty", names: ["Crafty"], concept: "crafty", slot: 1 },
	{
		key: "physical",
		names: ["Physical", "Bruising", "Rugged"],
		concept: "strength",
		slot: 1,
	},
	{
		key: "highFlying",
		names: ["High-Flying", "Bouncy"],
		concept: "air",
		slot: 1,
	},
	{
		key: "ballHawking",
		names: ["Ball-Hawking", "Pesky"],
		concept: "steal",
		slot: 2,
	},
	{ key: "defensive", names: ["Defensive"], concept: "lockdown", slot: 2 },
	{
		key: "shotErasing",
		names: ["Shot-Erasing", "Paint-Protecting", "Backline"],
		concept: "rimD",
		slot: 2,
	},
	{
		key: "glass",
		names: ["Glass-Cleaning", "Board-Enforcing"],
		concept: "reb",
		slot: 2,
	},
	{ key: "boardHunting", names: ["Board-Hunting"], concept: "oreb", slot: 2 },
	{
		key: "playmaking",
		names: ["Playmaking", "Diming"],
		concept: "pass",
		slot: 2,
	},
	{
		key: "iso",
		names: ["Iso", "Shifty"],
		concept: "creator",
		slot: 2,
		groups: ["guard", "wing"],
	},
	{ key: "threeLevel", names: ["3-Level"], concept: "threeLevel", slot: 2 },
	{ key: "insideOut", names: ["Inside-Out"], concept: "insideOut", slot: 2 },
	{ key: "threePt", names: ["3PT"], concept: "shotHunt", slot: 2 },
	// archv5 (the user's "Sharpshooting Slasher"): a catch-and-shoot word for guards and wings (Stretch is the bigs'); it
	// keeps the Sharpshooter's bar (rulebook.data.ts WORD_RULES.sniper) and floor (tests.ts ABS_FLOORS)
	{
		key: "sharpshooting",
		names: ["Sharpshooting"],
		concept: "catchShoot",
		slot: 2,
		groups: ["guard", "wing"],
	},
	{
		key: "stretchy",
		names: ["Stretch"],
		concept: "catchShoot",
		slot: 2,
		// (archv3: a big's word; on a wing "Stretch Cutter" read wrong)
		groups: ["big"],
	},
	{ key: "midPaint", names: ["Mid-Paint"], concept: "midPaint", slot: 2 },
	{
		key: "midPost",
		names: ["Mid-Post"],
		concept: "midPost",
		slot: 2,
		groups: ["wing", "big"],
	},
	{ key: "middy", names: ["Middy", "Hash-Sinking"], concept: "mid", slot: 2 },
	{
		key: "pullUp",
		names: ["Pull-Up"],
		concept: "pullUp",
		slot: 2,
		groups: ["guard", "wing"],
	},
	{
		key: "postScoring",
		names: ["Post-Scoring"],
		concept: "post",
		slot: 2,
		groups: ["wing", "big"],
	},
	{
		key: "slashing",
		names: ["Slashing", "Downhill"],
		concept: "slash",
		slot: 2,
	},
	{
		key: "rimRocking",
		names: ["Rim-Rocking", "Rim-Wrecking"],
		concept: "dunk",
		slot: 2,
	},
	{
		key: "rimRunning",
		names: ["Rim-Running", "Wing-Running"],
		// (archv3: a big runs to the rim, a guard or wing the wings: "2-Way Wing-Running Shot Eraser" read wrong)
		byGroup: {
			big: "Rim-Running",
			guard: "Wing-Running",
			wing: "Wing-Running",
		},
		concept: "run",
		slot: 2,
	},
];

// archnouns: the noun names' own front words (nouns.ts NOUN_DESC) and end words (the position, or a trait name)
DESCRIPTORS.push(
	{
		key: "speedy",
		names: ["Speedy"],
		concept: "speedNoun",
		slot: 1,
		nounOnly: true,
	},
	{
		key: "lockdownD",
		names: ["Lockdown"],
		concept: "lockdown",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "rimProtecting",
		names: ["Rim-Protecting"],
		concept: "rimD",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "ballHandling",
		names: ["Ball-Handling"],
		concept: "handleNoun",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "shotCreating",
		names: ["Shot-Creating"],
		concept: "creator",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "midRange",
		names: ["Mid-Range"],
		concept: "mid",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "postAny",
		names: ["Post-Scoring"],
		concept: "post",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "spotUp",
		names: ["Spot-Up"],
		concept: "catchShoot",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "powerFinishing",
		names: ["Power-Finishing"],
		concept: "finish",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "finesse",
		names: ["Finesse"],
		concept: "finish",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "closeRange",
		names: ["Close-Range"],
		concept: "post",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "floater",
		names: ["Floater"],
		concept: "post",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "shifty",
		names: ["Shifty"],
		concept: "handleNoun",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "steady",
		names: ["Steady"],
		concept: "handleNoun",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "shotBlocking",
		names: ["Shot-Blocking"],
		concept: "rimD",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "postDefending",
		names: ["Post-Defending"],
		concept: "rimD",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "quickFooted",
		names: ["Quick-Footed"],
		concept: "speedNoun",
		slot: 1,
		nounOnly: true,
	},
	{
		key: "highlightReel",
		names: ["Highlight-Reel"],
		concept: "air",
		slot: 1,
		nounOnly: true,
	},
	{
		key: "twitchy",
		names: ["Twitchy"],
		concept: "speedNoun",
		slot: 1,
		nounOnly: true,
	},
	{
		key: "tClutchD",
		names: ["Clutch", "Ice-Cold"],
		concept: "traitWord",
		slot: 0,
		nounOnly: true,
	},
	{
		key: "tSavvyD",
		names: ["Savvy", "Veteran"],
		concept: "traitWord",
		slot: 0,
		nounOnly: true,
	},
	{
		key: "tIronD",
		names: ["Iron-Man", "Durable"],
		concept: "traitWord",
		slot: 0,
		nounOnly: true,
	},
	{
		key: "tVersatileD",
		names: ["Versatile", "Switchable"],
		concept: "traitWord",
		slot: 0,
		nounOnly: true,
	},
	{
		key: "tRollingD",
		names: ["Rolling", "Roll-Man"],
		concept: "traitWord",
		slot: 0,
		nounOnly: true,
	},
	{
		key: "tPopD",
		names: ["Pick-and-Pop", "Popping"],
		concept: "traitWord",
		slot: 0,
		nounOnly: true,
	},
	{
		key: "tDemonD",
		names: ["Relentless"],
		concept: "traitWord",
		slot: 0,
		nounOnly: true,
	},
	{
		key: "tOffBallD",
		names: ["Off-Ball", "Cutting"],
		concept: "traitWord",
		slot: 0,
		nounOnly: true,
	},
	{
		key: "tHustleD",
		names: ["Hustle", "Gritty"],
		concept: "traitWord",
		slot: 0,
		nounOnly: true,
	},
	{
		key: "long",
		names: ["Long"],
		concept: "longNoun",
		slot: 1,
		nounOnly: true,
	},
	{
		key: "rimFinishing",
		names: ["Paint-Finishing"],
		concept: "finish",
		slot: 2,
		nounOnly: true,
	},
	// archskill (reading 29): the new skills' front words
	{
		key: "foulDrawing",
		names: ["Foul-Drawing"],
		concept: "foulDrawNoun",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "backdoor",
		names: ["Backdoor"],
		concept: "cutNoun",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "helpSide",
		names: ["Help-Side"],
		concept: "helpDNoun",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "mistakeFree",
		names: ["Mistake-Free"],
		concept: "secureNoun",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "switchable",
		names: ["Switchable"],
		concept: "switchNoun",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "lobCatching",
		names: ["Lob-Catching"],
		concept: "rimRunNoun",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "screenRolling",
		names: ["Screen-and-Roll"],
		concept: "rollNoun",
		slot: 2,
		nounOnly: true,
	},
	{
		key: "transitionWord",
		names: ["Transition"],
		concept: "transitionNoun",
		slot: 1,
		nounOnly: true,
	},
	{
		key: "highMotor",
		names: ["High-Motor"],
		concept: "motorNoun",
		slot: 1,
		nounOnly: true,
	},
);
ROLES.push(
	{
		key: "posGuard",
		names: ["Guard"],
		concepts: [],
		groups: ["guard"],
		nounOnly: true,
	},
	{
		key: "posWing",
		names: ["Wing"],
		concepts: [],
		groups: ["wing"],
		nounOnly: true,
	},
	{
		key: "posForward",
		names: ["Forward"],
		concepts: [],
		groups: ["wing", "big"],
		nounOnly: true,
	},
	{
		key: "posBig",
		names: ["Big"],
		concepts: [],
		groups: ["big"],
		nounOnly: true,
	},
	{
		key: "bruiser",
		names: ["Bruiser"],
		concepts: [],
		groups: ["guard", "wing"],
		nounOnly: true,
	},
	{
		key: "enigma",
		names: ["Enigma"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
	},
	...(
		[
			[
				"sSwimStopper",
				"Swimming Mid-Range Stopper",
				"A slippery, mobile perimeter stopper who also hits from mid-range.",
				"wingDefender",
			],
			[
				"sPaintSniper",
				"Paint Scoring Sniper",
				"An elite shooter who also scores in the paint with touch.",
				"shooter",
			],
			[
				"sRuthlessBully",
				"Ruthless Bully Big",
				"A relentless, powerful big who punishes defenders in the post.",
				"postBig",
			],
			[
				"sPickPocket",
				"Slashing Pick-Pocket Guard",
				"Takes the ball away and turns it into points at the rim.",
				"wingDefender",
			],
			[
				"sShowtimer",
				"Rim-Rocking Showtimer",
				"Runs the break and finishes above the rim.",
				"slasher",
			],
			[
				"sByTheBook",
				"By-The-Book Guard",
				"A steady, smart guard who takes care of the ball and makes the right play.",
				"playmaker",
			],
			[
				"sPostPilot",
				"Rim-Reaping Post Pilot",
				"An elite rim protector the offense runs through in the post.",
				"postBig",
			],
			[
				"sSlashMiddyF",
				"Slashing Middy Forward",
				"A forward who attacks the basket and pulls up from mid-range.",
				"slasher",
			],
			[
				"sJack",
				"Jack-Of-All-Trades",
				"Good at many things and great at none: he fills every gap.",
				"allAround",
			],
		] as [string, string, string, Family][]
	).map(([key, name, desc, family]): RoleDef => ({
		key,
		names: [name],
		...(key === "sPickPocket"
			? { byGroup: { wing: "Slashing Pick-Pocket Wing" } }
			: {}),
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc,
		family,
	})),
	{
		key: "tCloser",
		names: ["Closer"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Wants the ball with the game on the line, and delivers.",
		family: "scorer",
	},
	{
		key: "tOldHead",
		names: ["Old Head", "Savvy Vet"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A savvy veteran: he knows every trick and where to be.",
		family: "allAround",
	},
	{
		key: "tIronMan",
		names: ["Iron Man"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Never misses a game and never runs out of gas.",
		family: "allAround",
	},
	{
		key: "tVersatile",
		names: ["Versatile Defender"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Guards whoever he is asked to, one through five.",
		family: "wingDefender",
	},
	{
		key: "tRollMan",
		names: ["Roll Man", "Screen-and-Roll Big"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Sets hard screens and rolls to the rim.",
		family: "postBig",
	},
	{
		key: "tPopper",
		names: ["Popper", "Pick-and-Pop Big"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Sets the screen and pops out for the jumper.",
		family: "stretchBig",
	},
	{
		key: "tDemon",
		names: ["Demon", "Motor Demon"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Never stops moving: a nonstop motor on every possession.",
		family: "allAround",
	},
	{
		key: "tOffBall",
		names: ["Off-Ball Mover", "Cutter"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Always moving without the ball: cuts, relocates and finds the open spot.",
		family: "slasher",
	},
	{
		key: "tHustler",
		names: ["Hustler", "Grinder"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Effort over everything: loose balls, charges and dirty work.",
		family: "allAround",
	},
	{
		key: "eMaestro",
		names: ["Maestro"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "A master of the mid-range.",
		family: "scorer",
	},
	{
		key: "eWizard",
		names: ["Wizard"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Works magic with the ball: passing and handling.",
		family: "playmaker",
	},
	{
		key: "eArtist",
		names: ["Artist"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Scores with touch: floaters, finesse finishes and soft hands.",
		family: "slasher",
	},
	{
		key: "eGunner",
		names: ["Gunner"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Shoots often, and not always wisely.",
		family: "shooter",
	},
	{
		key: "eSwingman",
		names: ["Swingman"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Plays guard or forward: scores, handles and defends on the wing.",
		family: "allAround",
	},
	{
		key: "eConnector",
		names: ["Connector"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Keeps the ball moving and makes the smart play.",
		family: "playmaker",
	},
	{
		key: "eFacilitator",
		names: ["Facilitator"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "A pass-first player outside the point guard spot.",
		family: "playmaker",
	},
	{
		key: "eProtector",
		names: ["Protector"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Protects the rim.",
		family: "rimProtector",
	},
	{
		key: "eInterceptor",
		names: ["Interceptor"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Jumps passing lanes for steals.",
		family: "wingDefender",
	},
	{
		key: "eGlider",
		names: ["Glider"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Smooth and fast in the open floor.",
		family: "slasher",
	},
	{
		key: "eMover",
		names: ["Mover"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Always moving without the ball.",
		family: "slasher",
	},
	{
		key: "eTechnician",
		names: ["Technician"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Wins with skill and footwork, not athleticism.",
		family: "scorer",
	},
	{
		key: "eArchitect",
		names: ["Architect"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Designs the offense: an elite passer with a high basketball IQ.",
		family: "playmaker",
	},
	{
		key: "eGeneral",
		names: ["Floor General"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Runs the team: elite passer, high IQ and a leader.",
		family: "playmaker",
	},
	{
		key: "eFour",
		names: ["Four"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "A power forward.",
		family: "postBig",
	},
	{
		key: "eFive",
		names: ["Five"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "A center.",
		family: "postBig",
	},
	{
		key: "eCutter",
		names: ["Cutter"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Scores by cutting to the rim without the ball.",
		family: "slasher",
	},
	{
		key: "eAttacker",
		names: ["Attacker"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Attacks the rim off the dribble.",
		family: "slasher",
	},
	{
		key: "sMidnightHash",
		names: ["Midnight Hash Sniper"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite late-game shooter from mid-range and three.",
		family: "shooter",
	},
	{
		key: "sSwissArmy",
		names: ["Swiss-Army-Knife"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Does a bit of everything, and one thing very well.",
		family: "allAround",
	},
	{
		key: "sSwitchblade",
		names: ["Switchblade Perimeter Creator"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A quick, slippery creator who also defends the perimeter.",
		family: "scorer",
	},
	{
		key: "sFadeawayTech",
		names: ["Two-Way Fadeaway Technician"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A skilled forward who scores on fadeaways and defends.",
		family: "scorer",
	},
	{
		key: "sVelvetStepBack",
		names: ["Velvet Step-Back Wing"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A smooth wing who creates his three off the dribble.",
		family: "shooter",
	},
	{
		key: "sClampCreate",
		names: ["Clamp-and-Create Swingman"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Locks down his man and creates his own shot.",
		family: "wingDefender",
	},
	{
		key: "sArcCatalyst",
		names: ["Two-Way Arc Catalyst"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Spaces the floor, moves the ball and defends.",
		family: "shooter",
	},
	{
		key: "sWingMarksman",
		names: ["All-Court Wing Marksman"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing who scores from three and mid-range, in the half court and on the run.",
		family: "shooter",
	},
	{
		key: "sSwitchProof",
		names: ["Switch-Proof Shot Creator"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A big, strong creator no switch can stop.",
		family: "scorer",
	},
	{
		key: "sBackcourtWing",
		names: ["Backcourt-to-Wing Shotmaker"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A shooter who plays either guard or wing.",
		family: "shooter",
	},
	{
		key: "sTrailThree",
		names: ["Trail-Three Rim Eraser"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite rim protector who trails the break for threes.",
		family: "rimProtector",
	},
	{
		key: "sHighPostStretch",
		names: ["High-Post Stretch Threat"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A big who scores from the high post and from three, and finds cutters.",
		family: "stretchBig",
	},
	{
		key: "sTripleStretch",
		names: ["Triple-Double Stretch Anchor"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A big who rebounds, passes, shoots and protects the rim.",
		family: "allAround",
	},
	{
		key: "sUnicornBig",
		names: ["All-Around Unicorn Big"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A center with a guard's skills: shooting, handling, passing.",
		family: "allAround",
	},
	{
		key: "sPaintWarden",
		names: ["Switch-Everything Paint Warden"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Protects the paint and switches onto anyone.",
		family: "rimProtector",
	},
	{
		key: "sHybridFive",
		names: ["Modern Hybrid Five"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A center who shoots, handles and runs.",
		family: "stretchBig",
	},
	{
		key: "sPutbackJuggernaut",
		names: ["Relentless Putback Juggernaut"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A powerful big who never stops crashing the offensive glass.",
		family: "glass",
	},
	{
		key: "sGlassTitan",
		names: ["Drop-Step Glass Titan"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A dominant post scorer and rebounder with power.",
		family: "postBig",
	},
	{
		key: "sMismatchIso",
		names: ["Mismatch Iso Point-Forward"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A big forward who creates his own shot and runs the offense.",
		family: "playmaker",
	},
	{
		key: "sForwardHub",
		names: ["High-Post Forward Hub"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A forward the offense runs through from the high post.",
		family: "playmaker",
	},
	{
		key: "sHelpDisruptor",
		names: ["Roaming Help-Side Disruptor"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Roams off his man for steals and blocks.",
		family: "wingDefender",
	},
	{
		key: "sBaselineCutter",
		names: ["Baseline-Cutting Rim Attacker"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Lives on baseline cuts and finishes at the rim.",
		family: "slasher",
	},
	{
		key: "sOpenCourtSlasher",
		names: ["Relentless Open-Court Slasher"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Runs the floor nonstop and finishes on the break.",
		family: "slasher",
	},
	{
		key: "sCornerCombo",
		names: ["Corner-Spacing Combo Forward"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A forward who spaces the corner and defends or rebounds.",
		family: "shooter",
	},
	{
		key: "sPositionless",
		names: ["Modern Positionless Forward"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Scores, makes plays and defends: plays any spot.",
		family: "allAround",
	},
	{
		key: "sFourOut",
		names: ["Small-Ball Four-Out Connector"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An undersized four who shoots and moves the ball.",
		family: "stretchBig",
	},
	{
		key: "eAce",
		names: ["Ace"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "The star of his team, great at more than one thing.",
		family: "allAround",
	},
	{
		key: "eWalkingBucket",
		names: ["Walking-Bucket"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Scores from everywhere on the floor.",
		family: "scorer",
	},
	{
		key: "eEngine",
		names: ["Engine"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "The offense runs through him: passing, creating and scoring.",
		family: "playmaker",
	},
	{
		key: "eDeadeye",
		names: ["Deadeye"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "One of the purest shooters in the league.",
		family: "shooter",
	},
	{
		key: "eAcrobat",
		names: ["Acrobat"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Contorts around defenders to finish at the rim.",
		family: "slasher",
	},
	{
		key: "eDriver",
		names: ["Driver"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Gets into the paint off the dribble.",
		family: "slasher",
	},
	{
		key: "ePoint",
		names: ["Point"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "A true point guard: handles and runs the offense.",
		family: "playmaker",
	},
	{
		key: "eDimer",
		names: ["Dimer"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "A pass-first guard.",
		family: "playmaker",
	},
	{
		key: "eSpacer",
		names: ["Spacer"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Spaces the floor with his jumper.",
		family: "shooter",
	},
	{
		key: "eCloser",
		names: ["Closer"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Wants the ball with the game on the line.",
		family: "scorer",
	},
	{
		key: "eWorkhorse",
		names: ["Workhorse"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Logs heavy minutes without wearing down.",
		family: "allAround",
	},
	{
		key: "eSpark",
		names: ["Spark"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Brings energy off the bench.",
		family: "allAround",
	},
	{
		key: "eScorer",
		names: ["Scorer"],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: "Gets buckets.",
		family: "scorer",
	},
	{
		key: "s3OffEngine",
		names: ["High-IQ Offensive Engine"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite, high-IQ passer and creator the offense runs through.",
		family: "playmaker",
	},
	{
		key: "s3OffCatalyst",
		names: ["High-IQ Offense Catalyst"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A smart passer who makes the offense run.",
		family: "playmaker",
	},
	{
		key: "s3DimeWizard",
		names: ["Pick-and-Roll Dime Wizard"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite pick-and-roll passer with a great handle.",
		family: "playmaker",
	},
	{
		key: "s3DimeMaestro",
		names: ["Pick-and-Roll Dime Maestro"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite pick-and-roll passer who also pulls up from mid-range.",
		family: "playmaker",
	},
	{
		key: "s3PaintPlaymaker",
		names: ["Paint-Touching Playmaker"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A guard who gets into the paint and makes plays.",
		family: "playmaker",
	},
	{
		key: "s3TempoConductor",
		names: ["Two-Way Tempo Conductor"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A fast point guard who pushes the pace and defends.",
		family: "playmaker",
	},
	{
		key: "s3PaceSetter",
		names: ["Half-Court Pace Setter"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A careful point guard who runs the half-court offense.",
		family: "playmaker",
	},
	{
		key: "s3LiveDribble",
		names: ["Live-Dribble Passing Connector"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Passes on the move and keeps the ball moving.",
		family: "playmaker",
	},
	{
		key: "s3SecondaryFacilitator",
		names: ["Secondary-Action Facilitator"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Makes the extra pass when the play breaks down.",
		family: "playmaker",
	},
	{
		key: "s3ShortRollHub",
		names: ["Short-Roll Playmaking Hub"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A big who makes plays out of the short roll.",
		family: "postBig",
	},
	{
		key: "s3PointWing",
		names: ["Two-Way Point-Wing Creator"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing who runs the offense and defends.",
		family: "playmaker",
	},
	{
		key: "s3SecondarySwing",
		names: ["Secondary-Creating Swingman"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing who can create when the play breaks down.",
		family: "scorer",
	},
	{
		key: "s3IsoShotmaker",
		names: ["Three-Level Iso Shotmaker"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite creator who scores at all three levels.",
		family: "scorer",
	},
	{
		key: "s3IsoThreat",
		names: ["Three-Level Iso Threat"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Creates his own shot and scores at all three levels.",
		family: "scorer",
	},
	{
		key: "s3TripleThreatWing",
		names: ["Triple-Threat Wing Scorer"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing who scores from three, mid-range and at the rim.",
		family: "scorer",
	},
	{
		key: "s3OffBounce",
		names: ["Off-Bounce Shotmaker"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Makes shots off the dribble.",
		family: "scorer",
	},
	{
		key: "s3PullUpCreator",
		names: ["Two-Way Pull-Up Creator"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Creates pull-ups and defends.",
		family: "scorer",
	},
	{
		key: "s3DeepBag",
		names: ["Deep-Bag Shot Technician"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A skilled shotmaker with a deep bag of moves, not athleticism.",
		family: "scorer",
	},
	{
		key: "s3FadeawayArtist",
		names: ["Mid-Range Fadeaway Artist"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A soft-touch fadeaway shooter.",
		family: "scorer",
	},
	{
		key: "s3PostFadeWing",
		names: ["Post-Fading Perimeter Wing"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing who posts up and fades away.",
		family: "scorer",
	},
	{
		key: "s3StepThrough",
		names: ["Rhythm Step-Through Scorer"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A footwork scorer inside and from mid-range.",
		family: "postBig",
	},
	{
		key: "s3ClutchCloser",
		names: ["Clutch-Time Closer"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite scorer who wants the last shot.",
		family: "scorer",
	},
	{
		key: "s3StepBackSniper",
		names: ["Step-Back Deep Sniper"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite deep shooter off the step-back.",
		family: "shooter",
	},
	{
		key: "s3StepBackGunner",
		names: ["Step-Back Deep-Range Gunner"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Fires step-back threes, and plenty of them.",
		family: "shooter",
	},
	{
		key: "s3HighArcGunner",
		names: ["High-Arc Perimeter Gunner"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A deep-range shooter who never hesitates.",
		family: "shooter",
	},
	{
		key: "s3VolumeSpacer",
		names: ["High-Volume Perimeter Spacer"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A shooter first and foremost.",
		family: "shooter",
	},
	{
		key: "s3OffBallSniper",
		names: ["Off-Ball Movement Sniper"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite shooter who never stops moving.",
		family: "shooter",
	},
	{
		key: "s3OffScreenSniper",
		names: ["Off-Screen Movement Sniper"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite catch-and-shoot shooter coming off screens.",
		family: "shooter",
	},
	{
		key: "s3FloorSpacer",
		names: ["Catch-and-Shoot Floor Spacer"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Spaces the floor and knocks down open threes.",
		family: "shooter",
	},
	{
		key: "s3CornerPocket",
		names: ["Corner-Pocket Three-Point Threat"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Waits in the corner for open threes.",
		family: "shooter",
	},
	{
		key: "s3CompleteTwoWayWing",
		names: ["Complete Two-Way Wing"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing who scores and defends.",
		family: "allAround",
	},
	{
		key: "s3PlaymakingTwoWayWing",
		names: ["Playmaking Two-Way Wing"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing who passes and defends.",
		family: "allAround",
	},
	{
		key: "s3GlueGuyWing",
		names: ["Two-Way Glue-Guy Wing"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A team-first wing who does a bit of everything.",
		family: "allAround",
	},
	{
		key: "s3CornerLockdown",
		names: ["Corner-Camping Lockdown Wing"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite defender who spaces the corner.",
		family: "wingDefender",
	},
	{
		key: "s3LockdownAce",
		names: ["Three-Level Lockdown Ace"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A star who scores at all three levels and locks down.",
		family: "allAround",
	},
	{
		key: "s3UnicornSwingman",
		names: ["Unicorn Two-Way Swingman"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing who does everything, including protecting the rim.",
		family: "allAround",
	},
	{
		key: "s3SmallBallRimWing",
		names: ["Small-Ball Rim-Protecting Wing"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing who protects the rim.",
		family: "rimProtector",
	},
	{
		key: "s3GlassCrashingWing",
		names: ["Glass-Crashing Perimeter Wing"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing who crashes the offensive glass.",
		family: "glass",
	},
	{
		key: "s3HustleWing",
		names: ["High-Motor Hustle Wing"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing who never stops working.",
		family: "allAround",
	},
	{
		key: "s3HustleSpark",
		names: ["High-Motor Hustle Spark"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Energy off the bench.",
		family: "allAround",
	},
	{
		key: "s3SwitchProofHybrid",
		names: ["Switch-Proof Two-Way Hybrid"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Defends the perimeter and the rim and can score.",
		family: "wingDefender",
	},
	{
		key: "s3SwissArmyThreat",
		names: ["Two-Way Swiss-Army Threat"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Good at everything, including defense.",
		family: "allAround",
	},
	{
		key: "s3AllCourtPrototype",
		names: ["Complete All-Court Prototype"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A complete star: elite at nearly everything.",
		family: "allAround",
	},
	{
		key: "s3TwoWayAnomaly",
		names: ["Unicorn Two-Way Anomaly"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A center who shoots, protects the rim and handles.",
		family: "allAround",
	},
	{
		key: "s3TurboGuard",
		names: ["Rim-Pressuring Turbo Guard"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A blur of a guard who attacks the rim.",
		family: "slasher",
	},
	{
		key: "s3LayupArtist",
		names: ["Acrobatic Layup Artist"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Finishes at the rim with acrobatic touch.",
		family: "slasher",
	},
	{
		key: "s3TransitionSlasher",
		names: ["Downhill Transition Slasher"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Runs downhill on the break and finishes through contact.",
		family: "slasher",
	},
	{
		key: "s3BaselineFinisher",
		names: ["Baseline-Cutting Rim Finisher"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A forward who cuts baseline and finishes.",
		family: "slasher",
	},
	{
		key: "s3LobRunner",
		names: ["Lob-Threat Rim Runner"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A big who runs the floor and catches lobs.",
		family: "slasher",
	},
	{
		key: "s3PopFinisher",
		names: ["Pick-and-Pop Stretch Finisher"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A big who pops for threes or rolls to finish.",
		family: "stretchBig",
	},
	{
		key: "s3PressPest",
		names: ["Full-Court Press Pest"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A guard who hounds the ball all over the floor.",
		family: "wingDefender",
	},
	{
		key: "s3ClampLock",
		names: ["Point-of-Attack Clamp Lock"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite on-ball defender.",
		family: "wingDefender",
	},
	{
		key: "s3SwitchAllStopper",
		names: ["Switch-All Perimeter Stopper"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A perimeter stopper who switches onto anyone.",
		family: "wingDefender",
	},
	{
		key: "s3InterceptorLock",
		names: ["Passing-Lane Interceptor Lock"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite defender who jumps passing lanes.",
		family: "wingDefender",
	},
	{
		key: "s3BallHawkMenace",
		names: ["Two-Way Ball-Hawking Menace"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A ball hawk who also scores.",
		family: "wingDefender",
	},
	{
		key: "s3WeakSideEraser",
		names: ["Weak-Side Shot Eraser"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A wing or forward who erases shots from the weak side.",
		family: "rimProtector",
	},
	{
		key: "s3IroncladAnchor",
		names: ["Ironclad Defensive Anchor"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "An elite, durable interior defender.",
		family: "rimProtector",
	},
	{
		key: "s3RelentlessCleaner",
		names: ["Relentless Glass Cleaner"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "A rebounder with a nonstop motor.",
		family: "glass",
	},
	{
		key: "tConnector",
		names: ["Connector"],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc: "Keeps the ball moving and makes the smart play, without a standout skill.",
		family: "playmaker",
	},
);

// archskill (reading 29, the user: "just put the one skill they are good at"): the plain noun of each skill, a name of
// its own ("Rebounder") or after another skill's front word ("Glass-Cleaning Contact Finisher"). Which noun a skill
// takes (its sub-rating lean, an elite standing) is nouns.ts SKILL_NOUNS.
export const SKILL_NOUN_ROLES: {
	key: string;
	name: string;
	desc: string;
	family: Family;
}[] = [
	{
		key: "kSharpshooter",
		name: "Sharpshooter",
		desc: "An elite shooter: his jumper is his game.",
		family: "shooter",
	},
	{
		key: "kSpotUpShooter",
		name: "Spot-Up Shooter",
		desc: "A catch-and-shoot three-point shooter.",
		family: "shooter",
	},
	{
		key: "kPullUpShooter",
		name: "Pull-Up Shooter",
		desc: "A three-point shooter off the dribble.",
		family: "shooter",
	},
	{
		key: "kShooter",
		name: "Shooter",
		desc: "A three-point shooter.",
		family: "shooter",
	},
	{
		key: "kPullUpArtist",
		name: "Pull-Up Artist",
		desc: "A mid-range shooter off the dribble.",
		family: "scorer",
	},
	{
		key: "kMidShooter",
		name: "Mid-Range Shooter",
		desc: "A mid-range shooter.",
		family: "scorer",
	},
	{
		key: "kPostScorer",
		name: "Post Scorer",
		desc: "Scores with his back to the basket.",
		family: "postBig",
	},
	{
		key: "kCloseScorer",
		name: "Close-Range Scorer",
		desc: "Scores on short shots around the basket.",
		family: "scorer",
	},
	{
		key: "kTouchScorer",
		name: "Touch Scorer",
		desc: "Scores in the lane with floaters and touch shots.",
		family: "scorer",
	},
	{
		key: "kBulldozer",
		name: "Bulldozer",
		desc: "A strong finisher who goes through contact.",
		family: "slasher",
	},
	{
		key: "kContactFinisher",
		name: "Contact Finisher",
		desc: "Finishes at the rim through contact.",
		family: "slasher",
	},
	{
		key: "kAcroFinisher",
		name: "Acrobatic Finisher",
		desc: "Finishes at the rim with finesse and body control.",
		family: "slasher",
	},
	{
		key: "kTouchFinisher",
		name: "Touch Finisher",
		desc: "Finishes with soft touch and floaters.",
		family: "slasher",
	},
	{
		key: "kFinisher",
		name: "Finisher",
		desc: "Finishes at the rim.",
		family: "slasher",
	},
	{
		key: "kLobThreat",
		name: "Lob Threat",
		desc: "Runs the floor and catches lobs above the rim.",
		family: "slasher",
	},
	{
		key: "kRimRunner",
		name: "Rim Runner",
		desc: "Runs the floor to the rim for easy finishes.",
		family: "slasher",
	},
	{
		key: "kAndOne",
		name: "And-One Artist",
		desc: "Draws contact at the rim and finishes through it.",
		family: "slasher",
	},
	{
		key: "kFtMerchant",
		name: "Free-Throw Merchant",
		desc: "Gets to the line and makes his free throws.",
		family: "scorer",
	},
	{
		key: "kFoulMagnet",
		name: "Foul Magnet",
		desc: "Draws fouls and gets to the line.",
		family: "scorer",
	},
	{
		key: "kMovementShooter",
		name: "Movement Shooter",
		desc: "Moves without the ball and shoots on the catch.",
		family: "shooter",
	},
	{
		key: "kBackdoorCutter",
		name: "Backdoor Cutter",
		desc: "Cuts without the ball for finishes at the rim.",
		family: "slasher",
	},
	{
		key: "kShotBlocker",
		name: "Shot Blocker",
		desc: "Blocks shots at the rim.",
		family: "rimProtector",
	},
	{
		key: "kRimProtector",
		name: "Rim Protector",
		desc: "Protects the rim.",
		family: "rimProtector",
	},
	{
		key: "kLowPostWall",
		name: "Low-Post Wall",
		desc: "A strong post defender who holds his ground.",
		family: "rimProtector",
	},
	{
		key: "kPostStopper",
		name: "Post Stopper",
		desc: "Defends post scorers.",
		family: "rimProtector",
	},
	{
		key: "kDefQB",
		name: "Defensive Quarterback",
		desc: "Reads the play and runs the team's defense.",
		family: "wingDefender",
	},
	{
		key: "kHelpAnchor",
		name: "Help-Side Anchor",
		desc: "A big who rotates and helps from the weak side.",
		family: "rimProtector",
	},
	{
		key: "kHelpDefender",
		name: "Help Defender",
		desc: "Rotates and helps on defense.",
		family: "wingDefender",
	},
	{
		key: "kLengthDefender",
		name: "Length Defender",
		desc: "A perimeter defender who bothers shots with his length.",
		family: "wingDefender",
	},
	{
		key: "kLockdownDefender",
		name: "Lockdown Defender",
		desc: "Shuts down his man on the perimeter.",
		family: "wingDefender",
	},
	{
		key: "kPerimDefender",
		name: "Perimeter Defender",
		desc: "Guards the perimeter.",
		family: "wingDefender",
	},
	{
		key: "kBallHawk",
		name: "Ball Hawk",
		desc: "Jumps passing lanes and takes the ball away.",
		family: "wingDefender",
	},
	{
		key: "kSwitchDefender",
		name: "Switchable Defender",
		desc: "Switches onto several positions on defense.",
		family: "wingDefender",
	},
	{
		key: "kBallHandler",
		name: "Ball Handler",
		desc: "Handles the ball.",
		family: "playmaker",
	},
	{
		key: "kShotCreator",
		name: "Shot Creator",
		desc: "Creates his own shot.",
		family: "scorer",
	},
	{
		key: "kMistakeFree",
		name: "Mistake-Free Handler",
		desc: "Takes care of the ball and rarely turns it over.",
		family: "playmaker",
	},
	{
		key: "kVisionary",
		name: "Visionary",
		desc: "A passer who sees the whole floor.",
		family: "playmaker",
	},
	{
		key: "kPrecisionPasser",
		name: "Precision Passer",
		desc: "A passer who puts the ball on the spot.",
		family: "playmaker",
	},
	{
		key: "kPasser",
		name: "Passer",
		desc: "Moves the ball and finds teammates.",
		family: "playmaker",
	},
	{
		key: "kRebounder",
		name: "Rebounder",
		desc: "Rebounds the ball.",
		family: "glass",
	},
	{
		key: "kGlassCrasher",
		name: "Glass Crasher",
		desc: "Crashes the offensive glass for second chances.",
		family: "glass",
	},
	{
		key: "kShortRoll",
		name: "Short-Roll Playmaker",
		desc: "Sets the screen, catches on the roll and makes the next pass.",
		family: "playmaker",
	},
	{
		key: "kRollMan",
		name: "Roll Man",
		desc: "Sets screens and rolls to the rim.",
		family: "postBig",
	},
];
for (const k of SKILL_NOUN_ROLES) {
	ROLES.push({
		key: k.key,
		names: [k.name],
		concepts: [],
		groups: ALL,
		nounOnly: true,
		desc: k.desc,
		family: k.family,
	});
}
// archskill (reading 29): catalog names of the new skills (nouns.ts SKILL_SPECIALS)
for (const [key, name, desc, family] of [
	[
		"s4Pterodactyl",
		"Pterodactyl",
		"Extraordinary length that blocks and bothers everything near the rim.",
		"rimProtector",
	],
	[
		"s4TransitionWeapon",
		"Transition Weapon",
		"Gets out on the break and finishes in the open floor.",
		"slasher",
	],
	[
		"s4OpenCourtBlur",
		"Open-Court Blur",
		"A blur with the ball in the open floor.",
		"slasher",
	],
	[
		"s4EnergyBig",
		"Energy Big",
		"A big who outworks everyone on the glass.",
		"glass",
	],
	[
		"s4MotorWing",
		"Motor Wing",
		"A wing who never stops moving on defense.",
		"wingDefender",
	],
	[
		"s4RelocationSniper",
		"Relocation Sniper",
		"An elite shooter who relocates without the ball for open threes.",
		"shooter",
	],
	[
		"s4OneThroughFour",
		"1-through-4 Defender",
		"Guards point guards through power forwards.",
		"wingDefender",
	],
	[
		"s4VerticalSpacer",
		"Vertical Spacer",
		"A big who stretches the defense vertically with lobs.",
		"slasher",
	],
] as [string, string, string, Family][]) {
	ROLES.push({
		key,
		names: [name],
		concepts: [],
		groups: ALL,
		bare: true,
		nounOnly: true,
		desc,
		family,
	});
}
// archreview2: the honest names (honest.ts), as roles a composed id can name
// (archskill, reading 29: never given any more; kept so a label stored by an older reading still reads)
for (const h of HONEST_ROLES) {
	ROLES.push({
		key: h.key,
		names: h.names,
		concepts: ["honest"],
		groups: ALL,
		bare: true,
		honest: true,
		desc: h.desc,
		family: h.family,
	});
}
export const ROLE_BY_KEY = new Map(ROLES.map((r) => [r.key, r]));
export const DESC_BY_KEY = new Map(DESCRIPTORS.map((d) => [d.key, d]));

// Concepts that say the same kind of thing: a name never says one twice (no "Playmaking Playmaker", no "Mid-Paint
// Middy ...", no "Shot-Erasing Shot Eraser")
const CONCEPT_GROUP: Record<string, string> = {
	catchShoot: "shoot",
	shotHunt: "shoot",
	mid: "mid",
	midPaint: "mid",
	midPost: "mid",
	pullUp: "mid",
	chaser: "mid",
	threeLevel: "mid",
	slash: "finish",
	finish: "finish",
	dunk: "finish",
	hammer: "finish",
	paint: "finish",
	scoop: "finish",
	lob: "finish",
	air: "ath",
	run: "ath",
	burner: "ath",
	cutter: "ath",
	lockdown: "perD",
	steal: "perD",
	pressure: "perD",
	twoWay: "def",
	rimD: "rimD",
	reb: "reb",
	oreb: "reb",
	grabGo: "reb",
	pass: "pass",
	wizard: "pass",
	outlet: "pass",
	creator: "handle",
	tempo: "handle",
	post: "post",
	highLow: "post",
	strength: "stre",
	crafty: "style",
	glueWing: "glue",
	glueGuard: "glue",
	switchD: "perD",
	gameManagerRole: "glue",
	energyRole: "finish",
	floaterRole: "finish",
	rawHandlerRole: "handle",
	insideOut: "insideOut",
	paintBeastRole: "finish",
	interiorForceRole: "reb",
	offGuardRole: "offMind",
	prospectRole: "lowOvr",
	depthPieceRole: "lowOvr",
};
// Pairs that may share a group after all (2K says them): a mid-range word with the Maestro role
const ALLOWED_SAME: ReadonlySet<string> = new Set(["mid|maestro"]);
// Groups that overlap another (3-Level is a shot and a mid-range; Inside-Out a shot and a finish)
const ALSO: Record<string, string[]> = {
	// (archv3: "Defensive" after "2-Way" says defense twice)
	lockdown: ["def"],
	threeLevel: ["shoot"],
	insideOut: ["shoot", "finish"],
	chaser: ["shoot"],
	postBully: ["stre"],
};
// (speed, same results: both read only the fixed tables, and compatible asks for them for every word of every reading,
// so each is worked out once; read-only)
const conceptGroupsCache = new Map<string, readonly string[]>();
const groupsOfConcept = (c: string): readonly string[] => {
	let out = conceptGroupsCache.get(c);
	if (!out) {
		out = [CONCEPT_GROUP[c] ?? c, ...(ALSO[c] ?? [])];
		conceptGroupsCache.set(c, out);
	}
	return out;
};
const roleGroupsCache = new WeakMap<RoleDef, readonly string[]>();
const roleGroups = (r: RoleDef): readonly string[] => {
	let out = roleGroupsCache.get(r);
	if (!out) {
		out = [
			...new Set([
				...r.concepts.filter((c) => c !== "scorer").flatMap(groupsOfConcept),
				...(ALSO[r.key] ?? []),
			]),
		];
		roleGroupsCache.set(r, out);
	}
	return out;
};

const DEFENSIVE_ROLES: ReadonlySet<string> = new Set([
	"lock",
	"ballHawk",
	"rimProtector",
]);
// Words that read against a role (the mid-range maestro is no three-point or above-the-rim scorer)
// (the lockdown defender and the ball hawk take defensive, physical and athletic words, not a scorer's; a bully is no
// finesse player; an off-ball cutter does not isolate; a finisher with a three is Inside-Out)
const SCORER_WORDS = [
	"crafty",
	"iso",
	"threePt",
	"stretchy",
	"playmaking",
	"middy",
	"midPaint",
	"midPost",
	"pullUp",
	"postScoring",
	"insideOut",
	"threeLevel",
] as const;
const CLASHES: Partial<Record<string, readonly string[]>> = {
	maestro: ["threePt", "rimRocking", "rimRunning", "highFlying"],
	ballHawk: SCORER_WORDS,
	finisher: ["threePt"],
	lock: SCORER_WORDS,
	postBully: ["crafty"],
	cutter: ["iso"],
};
// Whether a role and descriptors make a valid name: no word group twice (except the allowed pairs), one 2-Way, one style
// word, at most two descriptors, each allowed at his size
export const compatible = (
	role: RoleDef,
	descs: readonly DescDef[],
	group: PosGroup,
): boolean => {
	if (
		descs.length > 2 ||
		!role.groups.includes(group) ||
		(role.bare && descs.length > 0) ||
		// (archv5: a Prospect's one word is his one tool: tests.ts lowOvrTools, engine.ts TOOL_DESC)
		// (a Paint Beast takes one word: "Diming Paint Beast")
		(role.key === "paintBeast" && descs.length > 1) ||
		(role.key === "prospect" &&
			(descs.length > 1 || descs.some((d) => !TOOL_DESC_KEYS.has(d.key)))) ||
		// (archv3: "2-Way" on a defender's role says defense twice: "2-Way Lock", "2-Way Shot Eraser"; a word that reads
		// against the role: "3PT Maestro", "Rim-Rocking Maestro")
		(DEFENSIVE_ROLES.has(role.key) && descs.some((d) => d.key === "twoWay")) ||
		descs.some((d) => CLASHES[role.key]?.includes(d.key))
	) {
		return false;
	}
	const used = new Map<string, string>();
	for (const g of roleGroups(role)) {
		used.set(g, "role");
	}
	const slots = new Set<number>();
	for (const d of descs) {
		if (d.groups && !d.groups.includes(group)) {
			return false;
		}
		if (d.slot < 2) {
			if (slots.has(d.slot)) {
				return false;
			}
			slots.add(d.slot);
		}
		for (const g of groupsOfConcept(d.concept)) {
			const prev = used.get(g);
			if (prev !== undefined) {
				if (!(prev === "role" && ALLOWED_SAME.has(`${g}|${role.key}`))) {
					return false;
				}
			}
			used.set(g, d.key);
		}
	}
	return true;
};

// archv5: the words a Prospect's tool may be (engine.ts TOOL_DESC)
export const TOOL_DESC_KEYS: ReadonlySet<string> = new Set([
	"glass",
	"rimRocking",
	"postScoring",
	"slashing",
	"threePt",
	"stretchy",
	"middy",
	"iso",
	"playmaking",
	"defensive",
	"crafty",
]);

// 2K's order: 2-Way, then the style word, then skill words (defensive and hustle words before scoring words)
const SKILL_ORDER = DESCRIPTORS.map((d) => d.key);
export const orderDescs = (descs: readonly DescDef[]): DescDef[] =>
	[...descs].sort(
		(x, y) =>
			x.slot - y.slot ||
			SKILL_ORDER.indexOf(x.key) - SKILL_ORDER.indexOf(y.key),
	);

// Display choices: the default word, or the variant the neighbours' names use most (engine.ts)
export type WordPick = Partial<Record<string, string>>;

export const roleWord = (
	role: RoleDef,
	group: PosGroup,
	hasDesc: boolean,
	pick?: WordPick,
): string =>
	pick?.[role.key] ??
	role.byGroup?.[group] ??
	(hasDesc ? (role.withDesc ?? role.names[0]!) : role.names[0]!);

export const descWord = (
	d: DescDef,
	pick?: WordPick,
	group?: PosGroup,
): string =>
	(group ? d.byGroup?.[group] : undefined) ?? pick?.[d.key] ?? d.names[0]!;

// archv3: 2K's own name for a role with these descriptors (whatever the display variants), from the user's list
// (archv5: the user's own wording for some of the names he labeled; "@group": at that size only)
const COMBO_NAMES: Record<string, string> = {
	"rimProtector|physical": "Rugged Rim Protector",
	"creator|ballHawking+playmaking": "Pesky Playmaking Creator",
	"finisher|highFlying": "Athletic Finisher",
	"finisher|twoWay+highFlying": "2-Way Athletic Finisher",
	"slasher|iso": "Shot-Creating Slasher",
	"slasher|twoWay+iso": "2-Way Shot-Creating Slasher",
	"slasher|twoWay@wing": "2-Way Slashing Wing",
	"playmaker|postScoring": "Post Playmaker",
	"creator|highFlying": "High-Flying Shot Creator",
	"paintBeast|playmaking": "Diming Paint Beast",
};
const comboKey = (role: RoleDef, descs: readonly DescDef[]) =>
	`${role.key}|${orderDescs(descs)
		.map((d) => d.key)
		.join("+")}`;
const comboName = (
	role: RoleDef,
	descs: readonly DescDef[],
	group: PosGroup,
): string | undefined => {
	const k = comboKey(role, descs);
	return COMBO_NAMES[`${k}@${group}`] ?? COMBO_NAMES[k];
};
export const composeName = (
	role: RoleDef,
	descs: readonly DescDef[],
	group: PosGroup,
	pick?: WordPick,
): string =>
	comboName(role, descs, group) ??
	[
		...orderDescs(descs).map((d) => descWord(d, pick, group)),
		roleWord(role, group, shortForm(role, descs), pick),
	].join(" ");
// The role's short form ("Bully", "Creator") follows a style or skill word; after 2-Way alone the role keeps its whole
// name where the short form is no name of its own ("2-Way Post Bully", not "2-Way Bully": archv3)
const FULL_AFTER_2WAY: ReadonlySet<string> = new Set([
	"postBully",
	"creator",
	"maestro",
	"cutter",
]);
const shortForm = (role: RoleDef, descs: readonly DescDef[]) =>
	descs.length > 0 &&
	!(FULL_AFTER_2WAY.has(role.key) && descs.every((d) => d.slot === 0));

// ---- composed ids ----
// "v2:<role>+<desc>+<desc>:<group>[:<word>=<variant>,...]": the role, the descriptors, his size group, and any display
// variants picked
export const COMPOSED_PREFIX = "v2:";
export const isComposedId = (id: string | undefined): id is string =>
	typeof id === "string" && id.startsWith(COMPOSED_PREFIX);
export const composedId = (
	role: RoleDef,
	descs: readonly DescDef[],
	group: PosGroup,
	pick?: WordPick,
): string => {
	const ds = orderDescs(descs);
	const variants: string[] = [];
	if (comboName(role, ds, group)) {
		pick = undefined;
	}
	const rw = roleWord(role, group, shortForm(role, ds), pick);
	if (rw !== roleWord(role, group, shortForm(role, ds))) {
		variants.push(`${role.key}=${role.names.indexOf(rw)}`);
	}
	for (const d of ds) {
		const w = descWord(d, pick, group);
		if (w !== d.names[0]) {
			variants.push(`${d.key}=${d.names.indexOf(w)}`);
		}
	}
	// (archv3: "v2:<role>[+<desc>...]:<group>[:<variants>]", with no empty part; the reading-17 form
	// "v2:<role>:<desc>+<desc>:<group>[:...]" is still read)
	return `${COMPOSED_PREFIX}${[role.key, ...ds.map((d) => d.key)].join("+")}:${group}${variants.length > 0 ? `:${variants.join(",")}` : ""}`;
};
export const parseComposedId = (
	id: string,
):
	| { role: RoleDef; descs: DescDef[]; group: PosGroup; pick: WordPick }
	| undefined => {
	if (!isComposedId(id)) {
		return undefined;
	}
	const parts = id.slice(COMPOSED_PREFIX.length).split(":");
	// (the current form has the group second; the reading-17 form has the descriptors second, maybe empty)
	const current = ALL.includes(parts[1] as PosGroup);
	const [head, ...descHead] = (parts[0] ?? "").split("+");
	const roleKey = head;
	const descKeys = current ? descHead.join("+") : parts[1];
	const group = current ? parts[1] : parts[2];
	const variants = current ? parts[2] : parts[3];
	const role = ROLE_BY_KEY.get(roleKey ?? "");
	if (!role || !ALL.includes(group as PosGroup)) {
		return undefined;
	}
	const descs: DescDef[] = [];
	for (const k of (descKeys ?? "").split("+").filter(Boolean)) {
		const d = DESC_BY_KEY.get(k);
		if (!d) {
			return undefined;
		}
		descs.push(d);
	}
	const pick: WordPick = {};
	for (const v of (variants ?? "").split(",").filter(Boolean)) {
		const [k, i] = v.split("=");
		const def = ROLE_BY_KEY.get(k!) ?? DESC_BY_KEY.get(k!);
		const w = def?.names[Number(i)];
		if (w) {
			pick[k!] = w;
		}
	}
	return { role, descs, group: group as PosGroup, pick };
};

// ---- families of names ----
// The family of a name at a position: its head word (the last word that is not a modifier), with the size of the player,
// as families.ts reads a build's (and the words the user's 2K list added: Hammer, Burner, Cutter, ...)
// (archv5: "Prospect" too: "Glass-Cleaning Prospect" is a rebounder; a Prospect alone is no family's)
const MODIFIERS = new Set([
	"strength",
	"skill",
	"twoWay",
	"scorer",
	"riser",
	"lowOvr",
]);
const BIG = new Set<Pos>(["F", "PF", "FC", "C"]);
export const familyOfName = (name: string, pos: Pos | undefined): Family => {
	const keys = conceptsOf(name).map((c) => c.key);
	const core = keys.filter((k) => !MODIFIERS.has(k));
	const head = core.at(-1) ?? keys.at(-1);
	const big = pos !== undefined && BIG.has(pos);
	switch (head) {
		case "pass":
		case "outlet":
		case "tripleDouble":
		case "tempo":
		case "wizard":
			return "playmaker";
		case "reb":
		case "oreb":
		case "grabGo":
			return keys.includes("post") && !keys.includes("pass")
				? "postBig"
				: "glass";
		case "rimD":
			return "rimProtector";
		case "lockdown":
		case "steal":
		case "twoWay":
		case "pressure":
			return "wingDefender";
		case "catchShoot":
		case "shotHunt":
			return big ? "stretchBig" : "shooter";
		case "post":
		case "highLow":
			return big ? "postBig" : "scorer";
		case "slash":
		case "finish":
		case "dunk":
		case "lob":
		case "paint":
		case "strength":
		case "hammer":
		case "scoop":
			return big ? "postBig" : "slasher";
		case "air":
		case "run":
		case "burner":
		case "cutter":
			return "slasher";
		case "glue":
			return "wingDefender";
		case "gameManager":
			return "playmaker";
		case "energy":
			return "postBig";
		// archv5
		case "interior":
			return big ? "postBig" : "slasher";
		case "lowOvr":
			return "allAround";
		case "creator":
			return keys.includes("pass")
				? "playmaker"
				: keys.includes("shotHunt")
					? "shooter"
					: "scorer";
		default:
			return "scorer";
	}
};

// The role a name is (its head word), and its descriptors: how the labeled players' names (the user's 2K list, the
// judged builds, the user's picks) are read for the neighbour vote. A word the grammar does not have is skipped.
const CONCEPT_ROLE: Record<string, string> = {
	pass: "playmaker",
	outlet: "playmaker",
	tempo: "playmaker",
	wizard: "playmaker",
	tripleDouble: "playmaker",
	creator: "creator",
	shotHunt: "sniper",
	catchShoot: "sharpshooter",
	chaser: "bucketChaser",
	mid: "maestro",
	midPaint: "maestro",
	midPost: "maestro",
	pullUp: "maestro",
	slash: "slasher",
	finish: "finisher",
	paint: "finisher",
	scoop: "finisher",
	burner: "burner",
	air: "highFlyer",
	cutter: "cutter",
	hammer: "hammer",
	dunk: "hammer",
	run: "rimRunner",
	lob: "lobThreat",
	lockdown: "lock",
	pressure: "lock",
	twoWay: "lock",
	steal: "ballHawk",
	rimD: "rimProtector",
	reb: "boardEnforcer",
	grabGo: "boardEnforcer",
	oreb: "boardHunter",
	post: "postPro",
	highLow: "postPro",
	strength: "postBully",
	glue: "glueWing",
	gameManager: "gameManager",
	energy: "energyBig",
};
const CONCEPT_DESC: Record<string, string> = Object.fromEntries(
	DESCRIPTORS.filter((d) => !d.nounOnly).map((d) => [d.concept, d.key]),
);
export type ParsedName = { role?: string; descs: string[]; words: WordPick };
// archv5: role names that are a whole phrase (the concept the role's own words read as, if any)
const NAME_ROLES: { re: RegExp; role: string; concept?: string }[] = [
	{ re: /Paint Beast/, role: "paintBeast", concept: "interior" },
	{ re: /Interior Force/, role: "interiorForce", concept: "interior" },
	{ re: /Offensive-Minded/, role: "offGuard", concept: "offMind" },
	{ re: /Prospect/, role: "prospect", concept: "lowOvr" },
	{ re: /Depth Piece/, role: "depthPiece", concept: "lowOvr" },
];
export const parseName = (name: string, pos: Pos | undefined): ParsedName => {
	const cs = conceptsOf(name).map((c) => c.key);
	const core = cs.filter((k) => !MODIFIERS.has(k));
	// (archv5: the names whose role is a whole phrase: the role claims its own concept, if any, and every other word is a
	// descriptor)
	const own = NAME_ROLES.find((x) => x.re.test(name));
	const headKey = own ? own.concept : (core.at(-1) ?? cs.at(-1));
	let role = own ? own.role : headKey ? CONCEPT_ROLE[headKey] : undefined;
	const big = pos !== undefined && GROUP_OF[pos] === "big";
	if (role === "sharpshooter" && big) {
		role = "stretch";
	}
	if (role === "sniper" && cs.includes("creator") && /Shot Hunter/.test(name)) {
		role = "shotHunter";
	}
	if (role === "playmaker" && /Engine/.test(name)) {
		role = "engine";
	}
	if (role === "postPro" && cs.includes("strength")) {
		role = "postBully";
	}
	const descs: string[] = [];
	let headSeen = false;
	for (let i = cs.length - 1; i >= 0; i--) {
		const k = cs[i]!;
		if (!headSeen && k === headKey) {
			headSeen = true;
			continue;
		}
		let d = k === "skill" && /Crafty/.test(name) ? "crafty" : CONCEPT_DESC[k];
		// (archv5: a catch-and-shoot word in front is "Stretch" on a big, "Sharpshooting" on a guard or wing)
		if (d === "stretchy" && pos !== undefined && !big) {
			d = "sharpshooting";
		}
		if (d && !descs.includes(d)) {
			descs.push(d);
		}
	}
	// (the words he is called by: which display variant his name uses)
	const words: WordPick = {};
	for (const def of [...ROLES, ...DESCRIPTORS]) {
		for (const w of def.names) {
			if (name.includes(w)) {
				words[def.key] = w;
			}
		}
	}
	return { role, descs, words };
};

// ---- the archetype a composed id stands for ----
const FAMILY_TO_OLD: Record<Family, ArchetypeFamily> = {
	playmaker: "playmaker",
	scorer: "scorer",
	shooter: "shooter",
	slasher: "slasher",
	wingDefender: "defender",
	rimProtector: "defender",
	glass: "rebounder",
	stretchBig: "shooter",
	postBig: "skilled",
	allAround: "balanced",
};
const GROUP_TO_ARCH: Record<PosGroup, ArchetypeGroup> = {
	guard: "guard",
	wing: "wing",
	big: "big",
};
const POSITIONS_OF: Record<PosGroup, Pos[]> = {
	guard: ["PG", "G", "SG"],
	wing: ["GF", "SF", "F"],
	big: ["PF", "FC", "C"],
};
const ROLE_NOUN: Record<string, string> = {
	playmaker: "A playmaker",
	engine: "The engine of the offense",
	creator: "A shot creator",
	shotHunter: "A shot hunter",
	sniper: "A sniper",
	sharpshooter: "A sharpshooter",
	stretch: "A stretch big",
	bucketChaser: "A bucket chaser",
	maestro: "A mid-range scorer",
	slasher: "A slasher",
	finisher: "A finisher",
	burner: "A burner",
	highFlyer: "A high flyer",
	cutter: "A cutter",
	hammer: "A big who hammers it home",
	rimRunner: "A rim-running big",
	lobThreat: "A lob threat",
	lock: "A perimeter stopper",
	ballHawk: "A ball hawk",
	rimProtector: "A rim protector",
	boardEnforcer: "A rebounder",
	boardHunter: "An offensive rebounder",
	postBully: "A post bully",
	postPro: "A post scorer",
	glueWing: "A role-playing wing",
	switchDefender: "A defender",
	glueGuard: "A role-playing guard",
	gameManager: "A steady point guard",
	energyBig: "An energy big",
	floaterGuard: "A small guard",
	rawHandler: "A young ball handler",
	paintBeast: "An interior scorer",
	interiorForce: "A physical big",
	offGuard: "A scoring guard",
	prospect: "A young player",
	depthPiece: "A role player",
	posGuard: "A guard",
	posWing: "A wing",
	posForward: "A forward",
	posBig: "A big",
};
const CONCEPT_PHRASE = new Map(CONCEPTS.map((c) => [c.key, c.phrase]));
const CUSTOM_PHRASE: Record<string, string> = {
	glueWing: "defends, moves the ball and does a bit of everything",
	switchD: "guards on the perimeter and at the rim, so he can switch",
	glueGuard: "defends and keeps the offense moving",
	gameManagerRole: "runs the offense without mistakes",
	energyRole: "runs the floor, finishes at the rim and protects it",
	floaterRole: "scores in the lane with floaters and touch rather than burst",
	rawHandlerRole:
		"has the burst and the handle but is still raw as a shooter and decision-maker",
	crafty: "wins with craft and touch",
	paintBeastRole:
		"finishes inside with size or power and has no jumper to speak of",
	interiorForceRole: "rebounds and plays physical inside, with no jumper",
	offGuardRole: "looks for his shot and gives little on defense",
	prospectRole: "has no skill that is good yet in absolute terms",
	depthPieceRole: "has no skill that is good in absolute terms",
	air: "plays above the rim",
	speedNoun: "plays fast",
	handleNoun: "handles the ball",
};
const joinPhrases = (xs: string[]) =>
	xs.length <= 1
		? (xs[0] ?? "")
		: `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

// A one-line description from the words: "A playmaker who defends his position and scores from mid-range and in the paint."
export const describe = (role: RoleDef, descs: readonly DescDef[]): string => {
	if (role.desc) {
		return role.desc;
	}
	const own = role.concepts
		.filter((c) => c !== "scorer")
		.map((c) => CUSTOM_PHRASE[c] ?? CONCEPT_PHRASE.get(c))
		.filter((x): x is string => !!x);
	const extra = orderDescs(descs)
		.map((d) => CUSTOM_PHRASE[d.concept] ?? CONCEPT_PHRASE.get(d.concept))
		.filter((x): x is string => !!x);
	const phrases = [...new Set([...own.slice(1), ...extra])];
	const head = ROLE_NOUN[role.key] ?? "A player";
	const lead = own[0];
	const body = [lead, ...phrases].filter(Boolean) as string[];
	return `${head} who ${joinPhrases(body)}.`;
};

const composedCache = new Map<string, Archetype | null>();
// The archetype a composed id stands for (name, description, family, group, positions; a profile from its words'
// concepts so the why and the regenerator read it like a build), or undefined
export const composedArchetype = (
	id: string,
	familyOf: (name: string, pos: Pos | undefined) => Family = familyOfName,
): Archetype | undefined => {
	const hit = composedCache.get(id);
	if (hit !== undefined) {
		return hit ?? undefined;
	}
	const parsed = parseComposedId(id);
	let out: Archetype | null = null;
	if (parsed) {
		const { role, descs, group, pick } = parsed;
		const name = composeName(role, descs, group, pick);
		const w: Archetype["w"] = {};
		const tags = new Set<string>();
		for (const c of conceptsOf(name)) {
			for (const [k, v] of Object.entries(c.w)) {
				w[k as keyof typeof w] = Math.max(w[k as keyof typeof w] ?? 0, v!);
			}
			if (c.tag) {
				tags.add(c.tag);
			}
		}
		const positions = POSITIONS_OF[group];
		const fam = role.family ?? familyOf(name, positions[1]);
		out = {
			id,
			name,
			group: GROUP_TO_ARCH[group],
			family: FAMILY_TO_OLD[fam],
			desc: describe(role, descs),
			w,
			hgt: [0, 100],
			positions,
			tags: [...tags, "composed", ...(role.honest ? ["honest"] : [])],
			prior: 1,
			custom: true,
		};
	}
	composedCache.set(id, out);
	return out ?? undefined;
};
