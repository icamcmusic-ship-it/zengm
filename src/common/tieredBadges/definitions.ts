// 2K Badges (the twoKBadges League Extra, basketball): NBA 2K-style tiered badges built on the sub-ratings, the base ratings and the
// expanded ratings. Pure data and pure functions, shared by the worker, the game sim and the UI. See docs/native-features.md, 2K Badges.
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
	| "physicals";

export const CATEGORY_NAMES: Record<BadgeCategory, string> = {
	finishing: "Finishing",
	shooting: "Shooting",
	playmaking: "Playmaking",
	defense: "Defense/Rebounding",
	physicals: "Physicals",
};
export const CATEGORIES = Object.keys(CATEGORY_NAMES) as BadgeCategory[];

// What a score reads: a base rating, a sub-rating key (subRatings.ts SUB_DEFS) or an expanded rating
export type TbInput = string;

export type TbGate = {
	key: TbInput;
	// A fixed minimum, or "median": at least the league median of that input among rotation players (saved with the cutoffs)
	min: number | "median";
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

// Order: by category, as in the design. Never reorder keys' meanings (stored by key); add new badges anywhere.
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
			["acc", 1.4],
			["vis", 0.7],
			["oiq", 0.8],
			["hgt", 0.2],
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
		"defense",
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
		"defense",
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
