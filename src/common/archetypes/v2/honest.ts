// archreview2: names that are honest about limited players (the user's review of three leagues, 995 labels, 620
// disagreements: "allow bad players to have decent sounding archetypes without giving them unrealistic or elite ones").
// After the reading picks a label, the player's tier and skills decide what kind of name he may have:
// 1. Tier on ovr (absolute, so a weak league has no elite labels at all): 60+ may have elite words (Sniper, Lockdown,
//    Engine, Force of Nature, ...), 50-59 plain words only, under 50 an honest name below unless two skills clear the bar.
// 2. Skills that clear a real bar (SKILL_BARS, about 60): none -> a Raw / Project name with upside, else a depth name
//    (Rotation Filler, Journeyman, Camp Body, ...); one -> a specialist (Spot-Up Specialist, Pest, Glass-Only Big, ...);
//    two or more -> a combination label, every word of which clears its gate (tests.ts ABS_GATES).
// 3. Upside (22 or under, or a draft prospect, and potential 15+ above ovr): Raw / Project / Developing names.
// 4. Flaws (a real weakness in his ratings) give some names their flavor: Earthbound Big, Slow-Motion Scorer, Glove-Only
//    Guard, Shooter Without a Jumper.
// Synonyms are picked by a stable seed per player, so a player keeps his name while his situation stays the same.
import type { Family } from "../families.ts";
import type { ArchetypeRatings } from "../types.ts";
import { scaleCutoff, type RatingQuantiles } from "./gateScale.ts";

export type PosGroup = "guard" | "wing" | "big";

// ---- tiers ----
export const ELITE_OVR = 60;
export const MID_OVR = 50;
export type Tier = "elite" | "mid" | "low";
export const tierOf = (ovr: number | undefined): Tier =>
	ovr === undefined
		? "elite"
		: ovr >= ELITE_OVR
			? "elite"
			: ovr >= MID_OVR
				? "mid"
				: "low";

// Words only a top player's name may have (the review: "Sniper", "Lockdown", "Engine", "Force of Nature", "Prodigy",
// "Triple-Double Threat" and the like oversell anyone below the top tier)
export const ELITE_RE =
	/Sniper|Sharpshoot|Logo|Deep-Range|Splash|Laser|Automatic|Silk|Big Range|Lockdown|\bLock\b|Clamp|Eliminator|Engine|Force of Nature|Yamming|Prodigy|Phenom|Savant|Maestro|\bKing\b|Apex|Anomaly|Triple-Double|Superstar|Do-It-All|Wizard|Pharaoh|Master|Mr\.|Walking Bucket|Shot Creator|Shot-Creating|Ankle|Eras|Obliterat|Rim Reaper|Rim-Reaping|Terror|Fortress|Glide/;

// ---- skills that clear a real bar ----
export type Skill =
	| "shoot"
	| "mid"
	| "post"
	| "dunk"
	| "pass"
	| "handle"
	| "reb"
	| "perD"
	| "rimD"
	| "jump"
	| "speed"
	| "strength";
type Bar = Partial<Record<keyof ArchetypeRatings, number>>;
// (the first rating of each is the one that decides how far above or below the bar he is)
export const SKILL_BARS: Record<Skill, Bar> = {
	shoot: { tp: 60 },
	mid: { fg: 60 },
	post: { ins: 60 },
	dunk: { dnk: 65 },
	pass: { pss: 60 },
	handle: { drb: 60 },
	reb: { reb: 60 },
	perD: { pdef: 60, diq: 45 },
	rimD: { idef: 60, hgt: 45 },
	jump: { jmp: 65 },
	speed: { spd: 65 },
	strength: { stre: 65 },
};
// How far above (+) or below (-) the bar he is, in rating points (the tightest of its ratings)
export const skillMargin = (
	r: ArchetypeRatings,
	s: Skill,
	rq?: RatingQuantiles,
): number => {
	let m = Infinity;
	for (const [k, min] of Object.entries(SKILL_BARS[s]) as [
		keyof ArchetypeRatings,
		number,
	][]) {
		const v = r[k];
		if (typeof v !== "number") {
			// (no expanded ratings: perimeter / interior D read from defensive IQ)
			const alt = k === "pdef" || k === "idef" ? r.diq : undefined;
			if (typeof alt !== "number") {
				return -Infinity;
			}
			m = Math.min(m, alt - scaleCutoff(min, k as any, rq));
			continue;
		}
		m = Math.min(m, v - scaleCutoff(min, k as any, rq));
	}
	return m;
};
export const skillsOf = (
	r: ArchetypeRatings,
	rq?: RatingQuantiles,
): { skill: Skill; margin: number }[] =>
	(Object.keys(SKILL_BARS) as Skill[])
		.map((skill) => ({ skill, margin: skillMargin(r, skill, rq) }))
		.sort((a, b) => b.margin - a.margin || (a.skill < b.skill ? -1 : 1));

// ---- upside ----
export const UPSIDE_POT = 15;
export const UPSIDE_AGE = 22;
export const hasUpside = ({
	age,
	prospect,
	ovr,
	pot,
}: {
	age?: number;
	prospect?: boolean;
	ovr?: number;
	pot?: number;
}) =>
	(prospect === true || (age !== undefined && age <= UPSIDE_AGE)) &&
	(pot === undefined || ovr === undefined
		? prospect === true
		: pot - ovr >= UPSIDE_POT);

// ---- the names ----
// One role per kind of honest name; `names` are its synonyms (a player gets one of those allowed at his size, by a stable
// seed); `desc` and `family` are the name's
export type HonestRole = {
	key: string;
	names: string[];
	// The synonyms at each size group (default: all of names)
	byGroup?: Partial<Record<PosGroup, string[]>>;
	desc: string;
	family: Family;
};
const R = (
	key: string,
	desc: string,
	family: Family,
	all: string[],
	byGroup?: Partial<Record<PosGroup, string[]>>,
): HonestRole => ({
	key,
	names: [...new Set([...all, ...Object.values(byGroup ?? {}).flat()])],
	byGroup: byGroup
		? {
				guard: byGroup.guard ?? all,
				wing: byGroup.wing ?? all,
				big: byGroup.big ?? all,
			}
		: undefined,
	desc,
	family,
});

export const HONEST_ROLES: HonestRole[] = [
	// 1. one-skill specialists ("this is all he does")
	R(
		"hShoot",
		"A shooter, and only a shooter: he spaces the floor and waits for the kick-out.",
		"shooter",
		[
			"Spot-Up Specialist",
			"Corner Merchant",
			"One-Trick Shooter",
			"Bench Bomber",
		],
		{
			wing: [
				"Spot-Up Specialist",
				"Corner Merchant",
				"One-Trick Shooter",
				"Bench Bomber",
				"Shot-Only Wing",
			],
		},
	),
	R(
		"hGunner",
		"A low-end shooter who lets it fly when the game is out of reach, makes or misses.",
		"shooter",
		["Garbage-Time Gunner", "Streaky Gunner", "Deep Bench Shooter"],
	),
	R(
		"hPerD",
		"A defender, and only a defender: he hounds his man and gives little back on offense.",
		"wingDefender",
		["Defensive Specialist", "Hound"],
		{ guard: ["Pest", "Gnat", "Hound", "Defensive Specialist"] },
	),
	R("hGlove", "A guard who can defend and do nothing else.", "wingDefender", [
		"Glove-Only Guard",
	]),
	R(
		"hRimD",
		"A shot blocker, and only that: he protects the rim and gives little else.",
		"rimProtector",
		["Shot-Blocking Specialist"],
	),
	R(
		"hReb",
		"A rebounder, and only a rebounder: he cleans up the glass.",
		"glass",
		["Board Specialist", "Garbage Man"],
		{ big: ["Glass-Only Big", "Board Specialist", "Garbage Man"] },
	),
	R(
		"hStrength",
		"Size and strength, not skill: he takes up space and sets screens.",
		"postBig",
		["Bruiser"],
		{ big: ["Big Body", "Wall", "Space Eater", "Human Screen"] },
	),
	R(
		"hJump",
		"A leaper with little game beyond his bounce.",
		"slasher",
		["Pogo Stick"],
		{ wing: ["Pogo Stick", "Bounce-Only Wing"] },
	),
	R("hSpeed", "A runner with little game beyond his speed.", "slasher", [
		"Track Star",
		"All Legs, No Game",
	]),
	R("hAthNoShot", "An athlete who can't shoot.", "slasher", [
		"Shooter Without a Jumper",
	]),
	R(
		"hPass",
		"A passer, and only a passer: he moves the ball and rarely looks for his own shot.",
		"playmaker",
		["Dime Specialist", "Pass-First, Pass-Only"],
		{ guard: ["Dime Specialist", "Pass-First, Pass-Only", "Caretaker Guard"] },
	),
	R(
		"hHandle",
		"A ball handler with little else: he brings it up and gets it to the scorers.",
		"playmaker",
		["Ball-Handling Specialist"],
		{ guard: ["Ball-Handling Specialist", "Caretaker Guard"] },
	),
	R("hMid", "A mid-range shooter and not much else.", "scorer", [
		"Mid-Range Specialist",
	]),
	R("hPost", "A post scorer and not much else.", "postBig", [
		"Post-Up Specialist",
	]),
	R("hDunk", "A finisher above the rim and not much else.", "slasher", [
		"Dunk Specialist",
	]),
	R(
		"hSlowScorer",
		"He can score from his spots, but slowly: no burst to get anywhere else.",
		"scorer",
		["Slow-Motion Scorer"],
	),
	R(
		"hEmptyScorer",
		"He gets his points, and gives them back on defense.",
		"scorer",
		["Empty-Calorie Scorer"],
	),
	R(
		"hEarthbound",
		"A big who plays below the rim: size and one skill, no athleticism.",
		"postBig",
		["Earthbound Big"],
	),
	// effort
	R(
		"hHustle",
		"Effort over talent: he plays hard every minute he gets.",
		"allAround",
		["Hustle Guy", "Junkyard Dog", "Hustle Over Talent"],
		{ big: ["Energy Big", "Junkyard Dog", "Hustle Over Talent"] },
	),
	// 2. developing (upside: young, potential well above his ovr)
	R(
		"hDevShoot",
		"A young shooter still growing into the role.",
		"shooter",
		["Developing Shooter", "Raw Shooter"],
		{ big: ["Project Stretch Big", "Developing Shooter"] },
	),
	R(
		"hDevPerD",
		"A young defender still learning the job.",
		"wingDefender",
		["Developing Defender", "Stopper-in-Training"],
		{ wing: ["Developing Lockdown Wing", "Stopper-in-Training"] },
	),
	R(
		"hDevRimD",
		"A young shot blocker still growing into the job.",
		"rimProtector",
		["Rim Protector in Training"],
	),
	R(
		"hDevPass",
		"A young passer still learning to run an offense.",
		"playmaker",
		["Developing Playmaker"],
	),
	R(
		"hDevHandle",
		"A young ball handler still learning to run an offense.",
		"playmaker",
		["Developing Ball Handler"],
	),
	R(
		"hDevReb",
		"A young rebounder still growing into the role.",
		"glass",
		["Developing Rebounder"],
		{ big: ["Developing Glass Cleaner", "Raw Big"] },
	),
	R("hDevScore", "A young scorer still finding his game.", "scorer", [
		"Developing Scorer",
		"Raw Scorer",
	]),
	R("hDevPost", "A young post scorer still learning his moves.", "postBig", [
		"Developing Post Scorer",
	]),
	R(
		"hDevAth",
		"A young athlete whose skills haven't caught up with his body.",
		"slasher",
		["Raw Athlete"],
		{
			guard: ["Raw Bouncy Guard", "Raw Athlete"],
			wing: ["Raw Bouncy Wing", "Raw Athlete"],
			big: ["Raw Bouncy Big", "Raw Athlete"],
		},
	),
	R(
		"hDevStrength",
		"A young big with size and strength and little skill yet.",
		"postBig",
		["Raw Big"],
		{ guard: ["Raw Bruiser"], wing: ["Raw Bruiser"] },
	),
	R(
		"hTools",
		"The tools are there; the skills aren't yet.",
		"slasher",
		["All Tools, No Toolbox"],
		{
			guard: ["Toolsy Guard", "All Tools, No Toolbox"],
			wing: ["Toolsy Wing", "All Tools, No Toolbox"],
			big: ["Toolsy Big", "All Tools, No Toolbox"],
		},
	),
	R(
		"hProject",
		"A project: nothing in his game is ready yet, but there is room to grow.",
		"allAround",
		["Unfinished Product", "Clay", "Blueprint", "Upside Play"],
		{
			guard: ["Project Guard", "Unfinished Product", "Upside Play", "Sleeper"],
			wing: ["Project Wing", "Unfinished Product", "Clay", "Blueprint"],
			big: ["Project Center", "Unfinished Product", "Clay", "Blueprint"],
		},
	),
	R("hLottery", "A long shot with a high ceiling.", "allAround", [
		"Lottery Ticket",
	]),
	R(
		"hLateBloomer",
		"Older than most prospects and still improving.",
		"allAround",
		["Late Bloomer"],
	),
	// 3. role and depth
	R(
		"hFiller",
		"A depth player: he fills minutes without standing out at anything.",
		"allAround",
		["Rotation Filler", "Two-Way Contract"],
		{
			guard: ["Rotation Filler", "Ten-Day Guard", "Two-Way Contract"],
			big: ["Rotation Filler", "Emergency Big", "Practice Squad Big"],
		},
	),
	R(
		"hJourneyman",
		"A veteran who has been around: he fills a roster spot wherever he's needed.",
		"allAround",
		["Journeyman"],
	),
	R(
		"hCampBody",
		"Training camp depth: he's here to fill out the roster.",
		"allAround",
		["Camp Body"],
		{
			guard: ["Camp Body", "Ten-Day Guard"],
			wing: ["Camp Body", "Ten-Day Wing"],
			big: ["Camp Body", "Practice Squad Big", "Emergency Big"],
		},
	),
];
export const HONEST_BY_KEY = new Map(HONEST_ROLES.map((h) => [h.key, h]));
export const isHonestKey = (key: string | undefined) =>
	key !== undefined && HONEST_BY_KEY.has(key);

// ---- the rule ----
export type HonestInput = {
	r: ArchetypeRatings;
	group: PosGroup;
	ovr?: number;
	pot?: number;
	age?: number;
	prospect?: boolean;
	// a stable seed for the synonym (his league and player id when known)
	seed: string;
	rq?: RatingQuantiles;
};

const hash = (s: string) => {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
	}
	return h;
};

// Which honest name he has (role and the synonym), for a player who may not have the reading's label
export const honestName = (x: HonestInput): { key: string; name: string } => {
	const { r, group } = x;
	const skills = skillsOf(r, x.rq);
	const cleared = skills.filter((s) => s.margin >= 0);
	const upside = hasUpside(x);
	const best = cleared[0]?.skill;
	const near = skills.find((s) => s.margin >= -10);
	const ath = Math.max(r.spd ?? 0, r.jmp ?? 0);
	const key = ((): string => {
		if (upside) {
			if (best) {
				switch (best) {
					case "shoot":
						return "hDevShoot";
					case "perD":
						return "hDevPerD";
					case "rimD":
						return "hDevRimD";
					case "pass":
						return "hDevPass";
					case "handle":
						return "hDevHandle";
					case "reb":
						return "hDevReb";
					case "mid":
					case "dunk":
						return "hDevScore";
					case "post":
						return "hDevPost";
					case "jump":
					case "speed":
						return "hDevAth";
					case "strength":
						return "hDevStrength";
				}
			}
			if ((x.pot ?? 0) >= 60 && (x.pot ?? 0) - (x.ovr ?? 99) >= 30) {
				return "hLottery";
			}
			if (ath >= 60) {
				return "hTools";
			}
			if (!x.prospect && (x.age ?? 0) >= 21 && (x.age ?? 0) <= UPSIDE_AGE) {
				return "hLateBloomer";
			}
			return near && near.margin > -6 ? nearKey(near.skill) : "hProject";
		}
		if (cleared.length === 0) {
			if ((r.endu ?? 0) >= 75 && (x.ovr ?? 0) >= 35) {
				return "hHustle";
			}
			if ((x.ovr ?? 99) < 35) {
				return "hCampBody";
			}
			if ((x.age ?? 0) >= 30) {
				return "hJourneyman";
			}
			if (near?.skill === "shoot") {
				return "hGunner";
			}
			return "hFiller";
		}
		// one skill (or the best of several, when he has no other name): flaws first, then the specialist
		const s = best!;
		const slow = (r.spd ?? 0) < 30;
		if (
			group === "big" &&
			(s === "reb" || s === "rimD" || s === "post" || s === "strength") &&
			(r.jmp ?? 0) < 35 &&
			(r.spd ?? 0) < 35
		) {
			return "hEarthbound";
		}
		if (
			(s === "jump" || s === "speed") &&
			(r.tp ?? 0) < 40 &&
			(r.fg ?? 0) < 40
		) {
			return "hAthNoShot";
		}
		if ((s === "mid" || s === "post") && slow) {
			return "hSlowScorer";
		}
		if ((s === "mid" || s === "post" || s === "shoot") && (r.diq ?? 50) < 30) {
			return "hEmptyScorer";
		}
		if (s === "perD" && group === "guard" && (r.oiq ?? 50) < 40) {
			return "hGlove";
		}
		if (s === "shoot" && (x.ovr ?? 99) < 42) {
			return "hGunner";
		}
		switch (s) {
			case "shoot":
				return "hShoot";
			case "mid":
				return "hMid";
			case "post":
				return "hPost";
			case "dunk":
				return "hDunk";
			case "pass":
				return "hPass";
			case "handle":
				return "hHandle";
			case "reb":
				return "hReb";
			case "perD":
				return "hPerD";
			case "rimD":
				return "hRimD";
			case "jump":
				return "hJump";
			case "speed":
				return "hSpeed";
			case "strength":
				return "hStrength";
		}
	})();
	const role = HONEST_BY_KEY.get(key)!;
	const names = role.byGroup?.[group] ?? role.names;
	return {
		key,
		name: names[hash(`${x.seed}|${key}`) % names.length]!,
	};
};
// (a young player whose best tool is close to the bar: Raw ___)
const nearKey = (s: Skill): string => {
	switch (s) {
		case "shoot":
			return "hDevShoot";
		case "jump":
		case "speed":
			return "hDevAth";
		case "strength":
		case "reb":
			return "hDevStrength";
		default:
			return "hProject";
	}
};
