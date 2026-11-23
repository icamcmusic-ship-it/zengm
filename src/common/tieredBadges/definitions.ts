// 2K Badges (basketball, always on; only their game sim effects are behind the twoKBadges League Extra): NBA 2K-style tiered badges
// built on the sub-ratings, the base ratings, the expanded ratings and the player traits. Pure data and pure functions, shared by the
// worker, the game sim and the UI. See docs/native-features.md, 2K Badges.
//
// Each badge has a score: a weighted average of ratings on the 0-100 scale (a sub-rating falls back to its base rating, or to the
// expanded rating it follows, when a row has no sub-ratings). Its tiers come from league-relative cutoffs (quantiles of the score
// among rotation players, saved each season, compute.ts), and some badges also have minimum gates (a rating at or above a number, or
// at or above the league median of that rating).
import { SUB_INDEX, isValidSubArray } from "../subRatings.ts";

export const TIERS = [1, 2, 3, 4, 5] as const;
export type Tier = 0 | 1 | 2 | 3 | 4 | 5;
export const TIER_NAMES = [
	"",
	"Bronze",
	"Silver",
	"Gold",
	"Hall of Fame",
	"Legend",
] as const;
// League percentiles (among rotation players) where each tier starts: Bronze, Silver, Gold, Hall of Fame, Legend
export const TIER_PERCENTILES = [0.85, 0.93, 0.975, 0.993, 0.999] as const;
// Badge points of a tier (Bronze 1 ... Legend 5), capped by ovr (badgePointCap)
export const TIER_POINTS = [0, 1, 2, 3, 4, 5] as const;

export type BadgeCategory =
	| "finishing"
	| "shooting"
	| "playmaking"
	| "defense"
	| "rebounding"
	| "physicals"
	| "mental";

export const CATEGORY_NAMES: Record<BadgeCategory, string> = {
	finishing: "Finishing",
	shooting: "Shooting",
	playmaking: "Playmaking",
	defense: "Defense",
	rebounding: "Rebounding",
	physicals: "Physicals",
	mental: "Mental",
};

// A player keeps at most this many badges a season: his best ones (highest tier, then furthest into it), after the badge-point cap
export const MAX_BADGES = 6;
export const CATEGORIES = Object.keys(CATEGORY_NAMES) as BadgeCategory[];

// What a score reads: a base rating, a sub-rating key (subRatings.ts SUB_DEFS), an expanded rating, a trait ("tr_<trait key>", see
// TRAIT_FALLBACK) or a derived input (DERIVED: ape index, smallness, the weaker of two ratings)
export type TbInput = string;

export type TbGate = {
	key: TbInput;
	// A fixed minimum, or "median": at least the league median of that input among rotation players (saved with the cutoffs)
	min?: number | "median";
	// A fixed maximum (e.g. Giant Slayer is for small finishers)
	max?: number;
};

export type TieredBadgeDef = {
	key: string;
	// Short label for the pills (2-4 characters)
	short: string;
	name: string;
	category: BadgeCategory;
	meaning: string;
	score: [TbInput, number][];
	gates?: TbGate[];
};

// Sub-rating fallbacks for rows without sub-ratings: its base rating, or the expanded rating it follows when the row has one
type Row = Record<string, any>;
const num = (x: unknown): number | undefined =>
	typeof x === "number" && Number.isFinite(x) ? x : undefined;
const bound = (x: number) => (x < 0 ? 0 : x > 100 ? 100 : x);
const lean = (r: Row) => {
	const csh = num(r.csh);
	const dsh = num(r.dsh);
	return csh !== undefined && dsh !== undefined ? (csh - dsh) / 2 : 0;
};
const SUB_FALLBACK: Record<string, (r: Row) => number> = {
	blk: (r) => num(r.idef) ?? r.diq,
	stl: (r) => num(r.pdef) ?? r.diq,
	idf: (r) => num(r.idef) ?? r.diq,
	pdf: (r) => num(r.pdef) ?? r.diq,
	rng: (r) => r.tp,
	tcs: (r) => bound(r.tp + lean(r)),
	tod: (r) => bound(r.tp - lean(r)),
	pst: (r) => r.ins,
	cls: (r) => r.ins,
	flt: (r) => r.ins,
	con: (r) => r.dnk,
	fns: (r) => r.dnk,
	pul: (r) => bound(r.fg - lean(r)),
	spu: (r) => bound(r.fg + lean(r)),
	orb: (r) => num(r.oreb) ?? r.reb,
	drd: (r) => num(r.dreb) ?? r.reb,
	hnd: (r) => r.drb,
	sec: (r) => num(r.bsc) ?? r.drb,
	crt: (r) => r.drb,
	vis: (r) => r.pss,
	acc: (r) => r.pss,
	sls: (r) => r.spd,
	lat: (r) => r.spd,
	stj: (r) => r.jmp,
	mxv: (r) => r.jmp,
};
// Traits on a row: "tr_<key>" (0-100), set by the worker only for traits that are known (visible ones, and hidden ones once a player has
// played long enough for them to be revealed, the same for every user), and only with Player Traits on. Without one, a badge reads a
// rating-based stand-in instead, so every badge still works (and stays in the same league-relative scale) with traits off.
export const TRAIT_PREFIX = "tr_";
const avg = (...xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
const TRAIT_FALLBACK: Record<string, (r: Row) => number> = {
	clutch: (r) => avg(r.oiq, r.ft, r.drb),
	consistency: (r) => avg(r.ft, r.fg, r.tp),
	durability: (r) => avg(r.stre, 50),
	shotDiscipline: (r) => avg(r.oiq, r.ft),
	offBall: (r) => avg(r.spd, r.tp),
	screen: (r) => avg(r.stre, r.stre, r.hgt),
	hustle: (r) => avg(r.reb, r.diq, r.spd),
	foulDiscipline: (r) => avg(r.diq, r.spd),
	handle: (r) => r.drb,
	lateGameIq: (r) => r.oiq,
	leadership: (r) => avg(r.oiq, r.pss),
	veteranSavvy: (r) => avg(r.oiq, r.diq),
	bigGame: (r) => avg(r.oiq, r.diq, r.ins),
	motor: (r) => avg(r.endu, r.spd, r.reb),
	competitiveness: (r) => avg(r.diq, r.reb, r.endu),
	defensiveVersatility: (r) => avg(r.diq, r.diq, r.spd, r.hgt),
};
export const BADGE_TRAIT_KEYS = Object.keys(TRAIT_FALLBACK);

// Derived inputs
const DERIVED: Record<string, (r: Row) => number> = {
	// Ape index: wingspan against height (50 = average; everyone is 50 without expanded ratings, so no one passes a gate above 50)
	ape: (r) => bound(50 + 2.5 * (tbValue(r, "wng") - r.hgt)),
	// Smallness (Giant Slayer, Pick Dodger, Worm)
	small: (r) => bound(100 - r.hgt),
	// The weaker of catch-and-shoot and off-the-dribble threes (Agent 3: a shooter off any action)
	tpBal: (r) => Math.min(tbValue(r, "tcs"), tbValue(r, "tod")),
	// The weaker of perimeter and interior defense (Switchblade)
	swch: (r) => Math.min(tbValue(r, "pdf"), tbValue(r, "idf")),
};

const EXPANDED_FALLBACK: Record<string, (r: Row) => number> = {
	wng: (r) => r.hgt,
	pdef: (r) => r.diq,
	idef: (r) => r.diq,
	oreb: (r) => r.reb,
	dreb: (r) => r.reb,
	bsc: (r) => r.drb,
};

/** One input of a ratings row (0-100). */
export const tbValue = (r: Row, key: TbInput): number => {
	if (key.startsWith(TRAIT_PREFIX)) {
		return num(r[key]) ?? TRAIT_FALLBACK[key.slice(TRAIT_PREFIX.length)]!(r);
	}
	const derived = DERIVED[key];
	if (derived) {
		return derived(r);
	}
	const i = SUB_INDEX[key];
	if (i !== undefined) {
		const sub = r.sub;
		if (isValidSubArray(sub)) {
			return sub[i]!;
		}
		return SUB_FALLBACK[key]!(r);
	}
	const fallback = EXPANDED_FALLBACK[key];
	if (fallback) {
		return num(r[key]) ?? fallback(r);
	}
	return num(r[key]) ?? 0;
};

const b = (
	key: string,
	short: string,
	name: string,
	category: BadgeCategory,
	meaning: string,
	score: [TbInput, number][],
	gates?: TbGate[],
): TieredBadgeDef => ({ key, short, name, category, meaning, score, gates });

// Order: the original 27, then the ones added later. Never reorder keys' meanings (stored by key); add new badges anywhere (the sim's
// tier arrays are indexed by position, rebuilt every game).
export const TIERED_BADGES: readonly TieredBadgeDef[] = [
	// Finishing
	b(
		"acrobat",
		"Acr",
		"Acrobat",
		"finishing",
		"Finesse finishes at the rim: hanging layups, reverses, contorting around the help.",
		[
			["fns", 2],
			["mxv", 0.8],
			["hnd", 0.4],
			["sls", 0.4],
		],
		[{ key: "dnk", min: 50 }],
	),
	b(
		"posterizer",
		"Pstr",
		"Posterizer",
		"finishing",
		"Dunks through contact on whoever is in the way.",
		[
			["con", 1.4],
			["mxv", 1.2],
			["stre", 0.6],
			["dnk", 0.4],
		],
		[
			{ key: "dnk", min: 55 },
			{ key: "jmp", min: 45 },
		],
	),
	b(
		"postControl",
		"PstC",
		"Post Control",
		"finishing",
		"Back-to-the-basket footwork, hooks and drop steps.",
		[
			["pst", 2],
			["stre", 0.7],
			["hgt", 0.5],
			["oiq", 0.4],
		],
		[{ key: "ins", min: 50 }],
	),
	b(
		"fearlessFinisher",
		"Frls",
		"Fearless Finisher",
		"finishing",
		"Finishes through contact and draws the and-one.",
		[
			["con", 2],
			["stre", 0.9],
			["cls", 0.5],
			["endu", 0.2],
		],
		[{ key: "dnk", min: 50 }],
	),
	b(
		"riseUp",
		"RsUp",
		"Rise Up",
		"finishing",
		"Goes straight up in the paint for standing dunks and layups.",
		[
			["stj", 1.4],
			["cls", 1],
			["hgt", 0.8],
			["wng", 0.5],
		],
		[{ key: "hgt", min: 45 }],
	),
	b(
		"putbackBoss",
		"Pbk",
		"Putback Boss",
		"finishing",
		"Turns his own and others' misses into quick putbacks.",
		[
			["orb", 1.5],
			["cls", 1],
			["stj", 0.6],
			["oiq", 0.3],
		],
		[{ key: "reb", min: 50 }],
	),
	// Shooting
	b(
		"catchShoot",
		"C&S",
		"Catch & Shoot",
		"shooting",
		"Lethal spotting up off a pass.",
		[
			["tcs", 2],
			["spu", 0.6],
			["rng", 0.5],
			["ft", 0.3],
		],
		[{ key: "tp", min: 50 }],
	),
	b(
		"deadeye",
		"Dead",
		"Deadeye",
		"shooting",
		"Pull-ups and step-backs off the dribble, unbothered by a hand in his face.",
		[
			["tod", 2],
			["pul", 0.9],
			["crt", 0.4],
		],
		[{ key: "tp", min: 50 }],
	),
	b(
		"limitlessRange",
		"Rng",
		"Limitless Range",
		"shooting",
		"His three holds up from well beyond the line.",
		[
			["rng", 2.5],
			["tp", 0.5],
		],
		[{ key: "rng", min: "median" }],
	),
	b(
		"midRangeMaestro",
		"Mid",
		"Mid-Range Maestro",
		"shooting",
		"Lives in the mid-range, off the catch or the bounce.",
		[
			["pul", 1],
			["spu", 1],
			["fg", 0.4],
			["oiq", 0.3],
		],
		[{ key: "fg", min: 50 }],
	),
	b(
		"freeThrowAce",
		"FT",
		"Free-Throw Ace",
		"shooting",
		"Automatic at the line.",
		[["ft", 1]],
	),
	// Playmaking
	b(
		"dimer",
		"Dime",
		"Dimer",
		"playmaking",
		"Puts the ball where a shooter wants it: his passes turn into better shots.",
		[
			["vis", 1.4],
			["acc", 1.2],
			["oiq", 0.4],
		],
		[{ key: "pss", min: 50 }],
	),
	b(
		"handles",
		"Hndl",
		"Handles",
		"playmaking",
		"Tight handle on the move, hard to pressure.",
		[
			["hnd", 2],
			["sls", 0.5],
			["lat", 0.3],
		],
		[{ key: "drb", min: 50 }],
	),
	b(
		"shotCreator",
		"Crtr",
		"Shot Creator",
		"playmaking",
		"Gets his own shot whenever the offense needs one.",
		[
			["crt", 2],
			["tod", 0.6],
			["pul", 0.6],
			["hnd", 0.5],
		],
		[{ key: "drb", min: 50 }],
	),
	b(
		"bailOut",
		"Bail",
		"Bail Out",
		"playmaking",
		"Finds the outlet when he's trapped or stuck in the air.",
		[
			["acc", 1],
			["sec", 0.8],
			["hgt", 0.6],
			["tr_handle", 0.5],
		],
		[{ key: "pss", min: 45 }],
	),
	b(
		"ballSecurity",
		"Sec",
		"Ball Security",
		"playmaking",
		"Rarely gives the ball away.",
		[
			["sec", 2],
			["oiq", 0.4],
			["hnd", 0.3],
		],
		[{ key: "drb", min: 45 }],
	),
	// Defense/Rebounding
	b(
		"rimProtector",
		"Rim",
		"Rim Protector",
		"defense",
		"Blocks and alters shots at the rim.",
		[
			["blk", 1.5],
			["idf", 1],
			["hgt", 0.7],
			["wng", 0.6],
			["stj", 0.4],
		],
		[{ key: "hgt", min: 45 }],
	),
	b(
		"glove",
		"Glv",
		"Glove",
		"defense",
		"Quick hands: pick-pockets and deflections.",
		[
			["stl", 2],
			["wng", 0.4],
			["lat", 0.3],
		],
	),
	b(
		"clamps",
		"Clmp",
		"Clamps",
		"defense",
		"Locks up the man he guards on the perimeter.",
		[
			["pdf", 2],
			["lat", 1],
			["wng", 0.4],
			["stl", 0.2],
		],
	),
	b(
		"postLockdown",
		"PLck",
		"Post Lockdown",
		"defense",
		"Holds his ground against post-ups.",
		[
			["idf", 1.5],
			["stre", 1],
			["hgt", 0.7],
		],
		[{ key: "hgt", min: 40 }],
	),
	b(
		"boxoutBeast",
		"Box",
		"Boxout Beast",
		"rebounding",
		"Seals his man and owns the defensive glass.",
		[
			["drd", 1.5],
			["stre", 1],
			["hgt", 0.6],
		],
		[{ key: "reb", min: 50 }],
	),
	b(
		"reboundChaser",
		"Chsr",
		"Rebound Chaser",
		"rebounding",
		"Tracks down boards outside his area.",
		[
			["orb", 1],
			["drd", 1],
			["mxv", 0.5],
			["sls", 0.3],
		],
		[{ key: "reb", min: 50 }],
	),
	// Physicals
	b(
		"pogoStick",
		"Pogo",
		"Pogo Stick",
		"physicals",
		"Back up in the air before anyone else.",
		[
			["stj", 1],
			["mxv", 1],
			["endu", 0.3],
		],
	),
	b(
		"brickWall",
		"Wall",
		"Brick Wall",
		"physicals",
		"Bodies up drivers and sets screens that hurt.",
		[
			["stre", 2],
			["hgt", 0.4],
		],
	),
	b(
		"fastTwitch",
		"Twch",
		"Fast Twitch",
		"physicals",
		"Explosive first step and quick bounce.",
		[
			["sls", 1.2],
			["stj", 0.9],
			["spd", 0.4],
		],
	),
	b(
		"lateralQuickness",
		"Lat",
		"Lateral Quickness",
		"physicals",
		"Slides with anyone on the perimeter.",
		[
			["lat", 2],
			["spd", 0.4],
		],
	),
	b("ironLungs", "Lung", "Iron Lungs", "physicals", "Never seems to tire.", [
		["endu", 2],
		["spd", 0.2],
	]),
	// Added with the core 2K Badges (the second set). Finishing
	b(
		"floatGame",
		"Flt",
		"Float Game",
		"finishing",
		"Soft floaters and runners over the first line of defense.",
		[
			["flt", 2],
			["cls", 0.5],
			["oiq", 0.4],
			["hnd", 0.3],
		],
		[{ key: "ins", min: 45 }],
	),
	b(
		"hookSpecialist",
		"Hook",
		"Hook Specialist",
		"finishing",
		"Jump hooks and sky hooks from either block.",
		[
			["flt", 1.2],
			["hgt", 1.2],
			["wng", 0.6],
			["pst", 0.5],
		],
		[{ key: "hgt", min: 50 }],
	),
	b(
		"layupMixmaster",
		"Mix",
		"Layup Mixmaster",
		"finishing",
		"Euro steps, scoops and reverses: a layup package for every angle.",
		[
			["fns", 1.2],
			["flt", 1],
			["hnd", 0.6],
			["oiq", 0.4],
		],
		[{ key: "dnk", min: 45 }],
	),
	b(
		"giantSlayer",
		"Gnt",
		"Giant Slayer",
		"finishing",
		"A small finisher who scores over the bigs at the rim.",
		[
			["fns", 1],
			["flt", 0.8],
			["small", 1.2],
			["mxv", 0.4],
		],
		[
			{ key: "hgt", max: 45 },
			{ key: "dnk", min: 45 },
		],
	),
	b(
		"slithery",
		"Slth",
		"Slithery",
		"finishing",
		"Slips through gaps in traffic and avoids the big collision.",
		[
			["fns", 1.2],
			["lat", 1],
			["flt", 0.4],
		],
		[{ key: "dnk", min: 45 }],
	),
	b(
		"masher",
		"Mash",
		"Masher",
		"finishing",
		"Overpowers smaller defenders on close shots.",
		[
			["cls", 1.5],
			["stre", 1],
			["hgt", 0.6],
		],
		[{ key: "ins", min: 50 }],
	),
	b(
		"transitionThreat",
		"Trns",
		"Transition Threat",
		"finishing",
		"Turns every miss into a run-out at the other end.",
		[
			["sls", 1.2],
			["fns", 0.6],
			["con", 0.6],
			["endu", 0.4],
			["tr_motor", 0.4],
		],
		[{ key: "dnk", min: 50 }],
	),
	// Shooting
	b(
		"cornerSpecialist",
		"Crnr",
		"Corner Specialist",
		"shooting",
		"Finds the corner and knocks down the short three.",
		[
			["tcs", 1],
			["tr_offBall", 1],
			["tr_shotDiscipline", 0.6],
			["small", 0.3],
		],
		[{ key: "tp", min: 50 }],
	),
	b(
		"spotUpSniper",
		"Spot",
		"Spot-Up Sniper",
		"shooting",
		"Mid-range jumpers off the catch, set and in rhythm.",
		[
			["spu", 2],
			["tr_offBall", 0.6],
			["tr_shotDiscipline", 0.5],
		],
		[{ key: "fg", min: 50 }],
	),
	b(
		"pickAndPop",
		"PnP",
		"Pick & Pop",
		"shooting",
		"A big who sets the screen and pops for the jumper.",
		[
			["tcs", 1],
			["spu", 1],
			["hgt", 1],
			["tr_screen", 0.6],
		],
		[
			{ key: "hgt", min: 50 },
			{ key: "tp", min: 40 },
		],
	),
	b(
		"spaceCreator",
		"Spc",
		"Space Creator",
		"shooting",
		"Step-backs and side-steps that open a clean look.",
		[
			["tod", 1],
			["lat", 1],
			["crt", 0.6],
		],
		[{ key: "tp", min: 45 }],
	),
	b(
		"agent3",
		"Ag3",
		"Agent 3",
		"shooting",
		"A three-point threat off any action: the catch, the dribble, the screen.",
		[
			["tpBal", 2],
			["crt", 0.5],
			["tr_offBall", 0.5],
		],
		[{ key: "tp", min: 55 }],
	),
	b(
		"setShotSpecialist",
		"Set",
		"Set Shot Specialist",
		"shooting",
		"Feet set, same release every time: free throws and open looks.",
		[
			["ft", 0.8],
			["spu", 0.6],
			["tcs", 0.6],
			["tr_consistency", 1],
		],
		[{ key: "ft", min: 55 }],
	),
	// Playmaking
	b(
		"ankleBreaker",
		"Ankl",
		"Ankle Breaker",
		"playmaking",
		"Crossovers and hesitations that send defenders to the floor.",
		[
			["hnd", 1],
			["lat", 1],
			["small", 0.6],
			["tr_handle", 0.4],
		],
		[{ key: "drb", min: 55 }],
	),
	b(
		"needleThreader",
		"Ndl",
		"Needle Threader",
		"playmaking",
		"Fits passes through windows no one else sees.",
		[
			["acc", 2],
			["wng", 0.6],
			["tr_shotDiscipline", 0.3],
		],
		[{ key: "pss", min: 50 }],
	),
	b(
		"floorGeneral",
		"FlrG",
		"Floor General",
		"playmaking",
		"Runs the offense and puts teammates in their spots.",
		[
			["oiq", 1.2],
			["vis", 0.6],
			["tr_leadership", 0.8],
			["tr_veteranSavvy", 0.6],
		],
		[{ key: "pss", min: 50 }],
	),
	b(
		"lobCityPasser",
		"Lob",
		"Lob City Passer",
		"playmaking",
		"Collapses the defense and throws it up for the dunk.",
		[
			["vis", 1],
			["sls", 0.8],
			["hnd", 0.5],
			["acc", 0.4],
		],
		[{ key: "pss", min: 55 }],
	),
	b(
		"postPlaymaker",
		"PstP",
		"Post Playmaker",
		"playmaking",
		"Passes out of the post to cutters and shooters.",
		[
			["vis", 1],
			["pst", 0.8],
			["hgt", 1],
			["acc", 0.5],
		],
		[
			{ key: "hgt", min: 50 },
			{ key: "pss", min: 45 },
		],
	),
	b(
		"quickFirstStep",
		"QFS",
		"Quick First Step",
		"playmaking",
		"Blows by his man off the dribble.",
		[
			["sls", 1.2],
			["crt", 0.8],
			["stre", 0.3],
			["oiq", 0.3],
		],
		[{ key: "drb", min: 50 }],
	),
	b(
		"unpluckable",
		"Unpl",
		"Unpluckable",
		"playmaking",
		"Strong with the ball: pickpockets and swipes come up empty.",
		[
			["sec", 1],
			["stre", 1],
			["tr_handle", 0.8],
		],
		[{ key: "drb", min: 45 }],
	),
	// Defense
	b(
		"interceptor",
		"Int",
		"Interceptor",
		"defense",
		"Reads the passing lanes and jumps them.",
		[
			["stl", 1],
			["diq", 1],
			["wng", 0.8],
			["sls", 0.4],
		],
	),
	b(
		"pickDodger",
		"PkD",
		"Pick Dodger",
		"defense",
		"Slips over and under screens to stay attached to his man.",
		[
			["pdf", 1],
			["lat", 0.6],
			["tr_motor", 0.8],
			["endu", 0.5],
		],
	),
	b(
		"challenger",
		"Chal",
		"Challenger",
		"defense",
		"Gets a hand up on every jumper.",
		[
			["pdf", 1],
			["wng", 1],
			["hgt", 0.6],
			["mxv", 0.5],
		],
	),
	b(
		"anchor",
		"Anch",
		"Anchor",
		"defense",
		"Holds the back line of the team defense together.",
		[
			["diq", 1.2],
			["blk", 0.6],
			["idf", 0.6],
			["tr_leadership", 0.6],
			["hgt", 0.4],
		],
		[{ key: "hgt", min: 50 }],
	),
	b(
		"offBallPest",
		"Pest",
		"Off-Ball Pest",
		"defense",
		"Bumps, grabs and chases his man all over the floor.",
		[
			["tr_motor", 1],
			["tr_hustle", 1],
			["pdf", 0.8],
			["endu", 0.4],
		],
	),
	b(
		"paintPatroller",
		"Ptrl",
		"Paint Patroller",
		"defense",
		"Comes from the weak side to block shots.",
		[
			["blk", 1],
			["sls", 0.8],
			["mxv", 0.8],
			["diq", 0.4],
		],
		[{ key: "hgt", min: 45 }],
	),
	b(
		"chargeTaker",
		"Chg",
		"Charge Taker",
		"defense",
		"Beats the driver to the spot and takes the hit.",
		[
			["tr_hustle", 1],
			["diq", 1],
			["tr_foulDiscipline", 0.6],
			["stre", 0.4],
		],
	),
	b(
		"switchblade",
		"Swch",
		"Switchblade",
		"defense",
		"Switches onto guards and bigs alike.",
		[
			["swch", 2],
			["lat", 0.5],
			["tr_defensiveVersatility", 0.6],
		],
	),
	// Rebounding
	b(
		"hustleRebounder",
		"HstR",
		"Hustle Rebounder",
		"rebounding",
		"Outworks everyone for loose balls and second chances.",
		[
			["orb", 1],
			["tr_hustle", 1],
			["tr_motor", 0.6],
		],
		[{ key: "reb", min: 45 }],
	),
	b(
		"tipInSpecialist",
		"Tip",
		"Tip-In Specialist",
		"rebounding",
		"Tips misses back in above the rim.",
		[
			["mxv", 1],
			["wng", 1],
			["orb", 0.8],
			["stj", 0.4],
		],
		[
			{ key: "reb", min: 50 },
			{ key: "hgt", min: 45 },
		],
	),
	b(
		"worm",
		"Worm",
		"Worm",
		"rebounding",
		"Wriggles past box-outs to get to the ball.",
		[
			["orb", 1],
			["lat", 0.8],
			["sls", 0.6],
			["small", 0.5],
		],
		[{ key: "reb", min: 45 }],
	),
	b(
		"outletPasser",
		"Outl",
		"Outlet Passer",
		"rebounding",
		"Grabs the board and starts the break with the outlet.",
		[
			["drd", 1],
			["acc", 1],
			["vis", 0.6],
		],
		[{ key: "reb", min: 50 }],
	),
	// Physicals
	b(
		"bulldozer",
		"Bull",
		"Bulldozer",
		"physicals",
		"Drives through bodies instead of around them.",
		[
			["stre", 1.2],
			["sls", 1],
			["con", 0.6],
		],
		[{ key: "spd", min: 45 }],
	),
	b(
		"workhorse",
		"Wrk",
		"Workhorse",
		"physicals",
		"Shows up every night and handles a heavy load.",
		[
			["tr_durability", 1.5],
			["tr_motor", 0.6],
			["stre", 0.5],
		],
	),
	b(
		"pterodactyl",
		"Ptro",
		"Pterodactyl",
		"physicals",
		"Arms that go on forever for his size.",
		[
			["ape", 2],
			["wng", 0.5],
		],
		[{ key: "ape", min: 56 }],
	),
	// Mental
	b(
		"clutchGene",
		"Clch",
		"Clutch Gene",
		"mental",
		"At his best with the game on the line.",
		[
			["tr_clutch", 1.5],
			["tr_lateGameIq", 0.8],
			["oiq", 0.5],
		],
	),
	b("relentless", "Rlnt", "Relentless", "mental", "Never takes a play off.", [
		["tr_motor", 1.2],
		["tr_competitiveness", 1],
		["endu", 0.4],
	]),
	b(
		"steadyHand",
		"Stdy",
		"Steady Hand",
		"mental",
		"The same player every night.",
		[
			["tr_consistency", 1.5],
			["tr_shotDiscipline", 0.6],
			["oiq", 0.3],
		],
	),
	b(
		"coachOnTheFloor",
		"IQ",
		"Coach on the Floor",
		"mental",
		"Knows where everyone should be on both ends.",
		[
			["oiq", 1],
			["diq", 1],
			["tr_veteranSavvy", 0.8],
		],
	),
	b(
		"bigStage",
		"BigS",
		"Big Stage",
		"mental",
		"Raises his level in the biggest games.",
		[
			["tr_bigGame", 1.5],
			["tr_competitiveness", 0.6],
			["oiq", 0.3],
		],
	),
	b(
		"whistleProof",
		"Whst",
		"Whistle Proof",
		"mental",
		"Defends without fouling.",
		[
			["tr_foulDiscipline", 1.5],
			["diq", 0.6],
			["lat", 0.3],
		],
	),
];

export const NUM_TIERED_BADGES = TIERED_BADGES.length;
export const TIERED_BADGE_INDEX: Record<string, number> = Object.fromEntries(
	TIERED_BADGES.map((d, i) => [d.key, i]),
);
export const TIERED_BADGES_BY_KEY: Record<string, TieredBadgeDef> =
	Object.fromEntries(TIERED_BADGES.map((d) => [d.key, d]));

// The inputs gated at the league median (their medians are saved with the cutoffs)
export const MEDIAN_GATE_KEYS: readonly string[] = [
	...new Set(
		TIERED_BADGES.flatMap((d) =>
			(d.gates ?? []).filter((g) => g.min === "median").map((g) => g.key),
		),
	),
];

/** A badge's score (0-100) for a ratings row. */
export const tieredBadgeScore = (r: Row, def: TieredBadgeDef): number => {
	let num = 0;
	let den = 0;
	for (const [key, w] of def.score) {
		num += w * tbValue(r, key);
		den += w;
	}
	return den > 0 ? num / den : 0;
};

/** The ratings that drive a badge, by weight (for the player page). */
export const badgeDrivers = (def: TieredBadgeDef) =>
	def.score.toSorted((a, b) => b[1] - a[1]).map(([key]) => key);
