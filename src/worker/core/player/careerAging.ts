// Career Aging (the careerAging League Extra, basketball): wear and tear, style-dependent aging, late-career reinvention and a bounded,
// seeded athleticism loss from major injuries. See docs/native-features.md, Career aging. Retirement and free agency parts are in
// shouldRetire.ts and freeAgents/autoSign.ts.
//
// Everything here is deterministic (seeded per player and season), so no number is drawn from the game's random stream. With the setting
// off nothing here runs.

import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import { isValidSubArray, SUB_INDEX } from "../../../common/subRatings.ts";
import {
	agingCurveForPlayer,
	type TraitDevelopment,
} from "../../../common/playerTraits/development.ts";
import { g } from "../../util/index.ts";
import { defaultInjuries } from "../../util/defaultInjuries.ts";
import { injuryBodyPart } from "../../../common/injuryBodyPart.ts";
import {
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";

export const careerAgingOn = (): boolean =>
	__SPORT === "basketball" &&
	Object.hasOwn(g, "careerAging") &&
	(g.get as any)("careerAging") === true;

type StatRow = {
	season: number;
	playoffs?: boolean;
	tid?: number;
	min?: number;
	pts?: number;
	gp?: number;
};

export type CareerAgingPlayer = {
	pid: number;
	born: { year: number };
	ratings: any[];
	stats?: unknown;
	injuries?: { season: number; type: string; games: number }[];
};

// --- Tuning ---

export const CAREER_AGING = {
	// Wear and tear: playoff minutes count this much more than regular season minutes
	playoffMileage: 1.5,
	// A typical rotation player's mileage per season since 21 (the reference his mileage is compared with)
	mileagePerYear: 1600,
	// Mileage over the reference, in these units, is one unit of excess (bounded to [-1, 1.5])
	mileageUnit: 14000,
	// Yearly change at one unit of excess, after the ramp (27 -> 31): athletic ratings, everything else
	mileageAthletic: -0.7,
	mileageOther: -0.15,
	// Style: yearly change at one unit of athletic reliance (bounded to [-1.5, 1.5]), ramped in from 29 to 32
	styleAthletic: -1.1,
	styleOther: -0.35,
	// Reinvention: yearly gain of his specialty at full strength (athleticism faded 12+ from its best, high IQ), and of his IQ
	reinventSpecialty: 1,
	reinventIq: 0.4,
	// Sub-rating points moved onto the specialist subs inside their bases, per year at full strength
	reinventTilt: 1.5,
} as const;

const ATHLETIC_KEYS = ["spd", "jmp", "endu"] as const;
const DEVELOPED_KEYS = [
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
] as const;

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));
const ramp = (age: number, from: number, to: number) =>
	clamp((age - from) / (to - from), 0, 1);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const statRows = (p: CareerAgingPlayer) =>
	Array.isArray(p.stats) ? (p.stats as StatRow[]) : [];

// Career minutes before this season, playoffs weighted more
export const careerMileage = (p: CareerAgingPlayer, beforeSeason: number) => {
	let miles = 0;
	for (const row of statRows(p)) {
		if (row.season < beforeSeason && (row.tid ?? 0) >= 0) {
			miles +=
				(row.min ?? 0) * (row.playoffs ? CAREER_AGING.playoffMileage : 1);
		}
	}
	return miles;
};

// Mileage over what a rotation player of his age has, in units (bounded)
export const mileageExcess = (miles: number, age: number) => {
	const ref = CAREER_AGING.mileagePerYear * Math.max(1, age - 21);
	return clamp((miles - ref) / CAREER_AGING.mileageUnit, -1, 1.5);
};

const subVal = (r: any, keys: string[]) => {
	if (!isValidSubArray(r.sub)) {
		return undefined;
	}
	return mean(keys.map((k) => r.sub[SUB_INDEX[k]!] as number));
};

// How much his game leans on athleticism rather than skill, from his shape: positive for high flyers, slashers and rim runners, negative for
// shooters, passers and post players. Bounded to [-1.5, 1.5]
export const athleticReliance = (r: any) => {
	const ath = mean([r.spd, r.jmp, r.dnk]);
	const skill = Math.max(
		mean([r.tp, r.fg, r.ft]),
		mean([r.pss, r.oiq]),
		mean([r.ins, r.oiq]),
	);
	let x = (ath - skill) / 18;
	const subAth = subVal(r, ["mxv", "sls", "con"]);
	const subSkill = subVal(r, ["tcs", "spu", "vis", "acc", "pst"]);
	if (subAth !== undefined && subSkill !== undefined) {
		x += (subAth - subSkill) / 40;
	}
	return clamp(x, -1.5, 1.5);
};

export type Specialty = "shooter" | "passer" | "post";

const SPECIALTY: Record<Specialty, { bases: string[]; subs: string[] }> = {
	shooter: { bases: ["tp", "ft"], subs: ["tcs", "spu"] },
	passer: { bases: ["pss", "oiq"], subs: ["vis", "acc", "sec"] },
	post: { bases: ["ins", "oiq"], subs: ["pst", "cls"] },
};

export const specialtyOf = (r: any): Specialty => {
	const shoot = mean([r.tp, r.ft]);
	const pass = r.pss;
	const post = r.ins + (r.hgt - 50) / 4;
	if (shoot >= pass && shoot >= post) {
		return "shooter";
	}
	return pass >= post ? "passer" : "post";
};

// Reinvention strength: his athleticism has faded from its best, he's 28-36 and has the IQ to adapt
export const reinventionStrength = (p: CareerAgingPlayer, age: number) => {
	// Called before this season's ratings row is added: his last season's
	const r = p.ratings.at(-1);
	if (age < 28 || age > 36 || !r) {
		return 0;
	}
	let peak = 0;
	for (const row of p.ratings) {
		peak = Math.max(peak, (row.spd + row.jmp) / 2);
	}
	const faded = clamp((peak - (r.spd + r.jmp) / 2) / 12, 0, 1);
	const iq = clamp((r.oiq - 35) / 30, 0.3, 1.2);
	const ageFade = age <= 33 ? 1 : age === 34 ? 0.8 : age === 35 ? 0.5 : 0.25;
	return faded * iq * ageFade;
};

// --- Past 39 ---

export const OLD_AGE = {
	// From this age, speed, jumping, endurance and dunking decline faster
	from: 39,
	// Extra yearly loss at 39, plus this much a year after, up to the max (rating points, before the per-player factor)
	athletic: 1.5,
	athleticPerYear: 1,
	athleticMax: 4,
	// Endurance loses this much more than the other athletic ratings
	enduranceMult: 1.5,
	// Per-player factor, seeded, uniform in this range
	spread: [0.7, 1.3] as const,
	// Graceful agers (Player Traits) lose this share of it
	graceful: 0.6,
} as const;

/** The extra athletic decline (negative rating points) of a player this age this season, seeded per player and bounded. */
export const oldAgeAthleticDelta = (pid: number, age: number) => {
	if (age < OLD_AGE.from) {
		return 0;
	}
	const base = Math.min(
		OLD_AGE.athleticMax,
		OLD_AGE.athletic + OLD_AGE.athleticPerYear * (age - OLD_AGE.from),
	);
	const u = new Rng(`careerOldAge|${pid}`).uniform(...OLD_AGE.spread);
	let graceful = 1;
	if (
		Object.hasOwn(g, "playerTraits") &&
		(g.get as any)("playerTraits") &&
		agingCurveForPlayer((g.get as any)("playerTraitsSeed") ?? 0, pid) ===
			"graceful"
	) {
		graceful = OLD_AGE.graceful;
	}
	return -base * u * graceful;
};

// AI coaches' minutes cap for a player this old (minutes per regulation game, before the Realistic Rotations planner's other limits): stars
// keep more of a role. undefined = no cap
export const oldAgeMinutesCap = (age: number, rank: number) => {
	if (age < OLD_AGE.from) {
		return undefined;
	}
	const base = age === 39 ? 18 : age === 40 ? 12 : 9;
	return base + (rank < 3 ? 6 : rank < 5 ? 3 : 0);
};

export type CareerAgingDev = {
	ratingDelta: Record<string, number>;
	tilt?: { keys: string[]; amount: number };
};

/**
 * The yearly development shift of every player developing this preseason. Wear and tear and style are centered over the players 27 and
 * older, rating by rating, so they move who declines, not how much the league declines. Reinvention is on top (its gains are small and
 * only for faded veterans).
 */
export const getCareerAgingDevelopment = (
	players: CareerAgingPlayer[],
	newSeason: number,
): Map<number, CareerAgingDev> => {
	const output = new Map<number, CareerAgingDev>();
	if (!careerAgingOn()) {
		return output;
	}
	const C = CAREER_AGING;
	const rows: {
		pid: number;
		age: number;
		delta: Record<string, number>;
		centered: Record<string, number>;
	}[] = [];
	for (const p of players) {
		const age = newSeason - p.born.year;
		// Last season's ratings (called before the new row is added)
		const r = p.ratings.at(-1);
		if (age < 27 || !r || r.locked) {
			continue;
		}
		const delta: Record<string, number> = {};
		const add = (key: string, x: number) => {
			delta[key] = (delta[key] ?? 0) + x;
		};

		// Wear and tear
		const excess = mileageExcess(careerMileage(p, newSeason), age);
		const wear = excess * (0.4 + 0.6 * ramp(age, 27, 31));
		// Style
		const rel = athleticReliance(r) * ramp(age, 29, 32);
		for (const key of DEVELOPED_KEYS) {
			const athletic =
				(ATHLETIC_KEYS as readonly string[]).includes(key) || key === "dnk";
			add(
				key,
				wear * (athletic ? C.mileageAthletic : C.mileageOther) +
					rel * (athletic ? C.styleAthletic : C.styleOther),
			);
		}
		rows.push({ pid: p.pid, age, delta, centered: {} });
	}

	// Center at each age (all 27+ together if an age has fewer than 8 players), so the survivors at an age, who all have high mileage, don't
	// decline faster as a group
	const byAge = new Map<number, typeof rows>();
	for (const row of rows) {
		byAge.getOrInsert(row.age, []).push(row);
	}
	for (const group of byAge.values()) {
		const pool = group.length >= 8 ? group : rows;
		for (const key of DEVELOPED_KEYS) {
			const m = mean(pool.map((row) => row.delta[key] ?? 0));
			for (const row of group) {
				row.centered[key] = (row.delta[key] ?? 0) - m;
			}
		}
	}
	const byPid = new Map(rows.map((row) => [row.pid, row.centered]));

	for (const p of players) {
		const age = newSeason - p.born.year;
		const delta = { ...byPid.get(p.pid) };
		let tilt: CareerAgingDev["tilt"];
		const s = reinventionStrength(p, age);
		if (s > 0) {
			const spec = SPECIALTY[specialtyOf(p.ratings.at(-1))];
			for (const key of spec.bases) {
				delta[key] = (delta[key] ?? 0) + C.reinventSpecialty * s;
			}
			delta.oiq = (delta.oiq ?? 0) + C.reinventIq * s;
			delta.diq = (delta.diq ?? 0) + 0.5 * C.reinventIq * s;
			tilt = { keys: spec.subs, amount: C.reinventTilt * s };
		}
		// Past 39: faster athletic decline (not centered, it's meant to move the league's oldest down)
		const old = oldAgeAthleticDelta(p.pid, age);
		if (old < 0) {
			for (const key of ["spd", "jmp", "dnk"]) {
				delta[key] = (delta[key] ?? 0) + old;
			}
			delta.endu = (delta.endu ?? 0) + old * OLD_AGE.enduranceMult;
		}
		if (Object.keys(delta).length > 0 || tilt) {
			output.set(p.pid, { ratingDelta: delta, tilt });
		}
	}
	return output;
};

// Merge into this season's trait development (Player Traits, Coaching Staff Depth), adding to its rating deltas
export const mergeCareerAging = (
	traitDev: TraitDevelopment | undefined,
	career: CareerAgingDev | undefined,
): TraitDevelopment | undefined => {
	if (!career) {
		return traitDev;
	}
	const base = traitDev ?? { baseChangeDelta: 0, dropScale: 1 };
	const ratingDelta: Record<string, number> = { ...base.ratingDelta };
	for (const [key, d] of Object.entries(career.ratingDelta)) {
		ratingDelta[key] = (ratingDelta[key] ?? 0) + d;
	}
	return { ...base, ratingDelta, careerTilt: career.tilt };
};

// --- Major injuries ---

// Severity of the injuries that take athleticism for good (knees, Achilles, legs, feet, back)
export const MAJOR_INJURIES: Record<string, number> = {
	"Torn Achilles Tendon": 1.4,
	"Torn ACL": 1,
	"Dislocated Knee": 0.9,
	"Fractured Kneecap": 0.9,
	"Fractured Leg": 0.8,
	"Torn PCL": 0.7,
	"Torn MCL": 0.6,
	"Torn Meniscus": 0.6,
	"Herniated Disc": 0.6,
	"Fractured Foot": 0.5,
	"Fractured Ankle": 0.5,
	"Torn Calf": 0.5,
	"Fractured Neck": 0.8,
};

// Custom injury names (a league's own injury list) aren't in MAJOR_INJURIES: one is major when it's a tear, rupture, fracture,
// dislocation or herniation of the knee, ankle, foot, leg or back, or any injury there of 60+ games, with a severity by its length
const MAJOR_BODY_PARTS = new Set(["Knee", "Ankle", "Foot", "Leg", "Back"]);
const MAJOR_KEYWORDS =
	/\b(torn|tear|ruptured?|rupture|fractured?|fracture|broken|dislocated?|herniated?|acl|achilles)\b/i;
let stockNames: Set<string> | undefined;

/**
 * Severity of a major injury (MAJOR_INJURIES), undefined if it isn't one. Stock names come from the table; other names (custom injury
 * lists) by keywords, body part and length.
 */
export const majorInjurySeverity = (
	type: string,
	games: number,
): number | undefined => {
	const sev = MAJOR_INJURIES[type];
	if (sev !== undefined) {
		return sev;
	}
	stockNames ??= new Set(defaultInjuries.map((row) => row.name));
	if (stockNames.has(type)) {
		return;
	}
	if (!MAJOR_BODY_PARTS.has(injuryBodyPart(type))) {
		return;
	}
	if ((MAJOR_KEYWORDS.test(type) && games >= 20) || games >= 60) {
		return clamp(games / 100, 0.5, 1);
	}
	return;
};

// Chance of "never the same" at severity 1, 30 or older (younger players: 2/3 of it)
export const NEVER_THE_SAME = 0.07;

export type InjuryLoss = {
	// Rating points lost (positive)
	loss: Record<string, number>;
	neverSame: boolean;
	// Max vertical drops more than standing reach (sub-rating points moved within jumping)
	jmpTilt: number;
};

/**
 * Permanent loss from an injury, replacing the stock random one (up to 20 points of speed, jumping and endurance from any long injury).
 * Only major injuries (MAJOR_INJURIES) and other injuries of 25+ games take anything; bounded and seeded by player, season and injury.
 */
export const injuryAthleticLoss = ({
	pid,
	type,
	games,
	age,
	season,
	n,
	seed,
}: {
	pid: number;
	type: string;
	games: number;
	age: number;
	season: number;
	// Number of injuries he had before this one (makes the seed unique)
	n: number;
	seed: number | string;
}): InjuryLoss | undefined => {
	const major = majorInjurySeverity(type, games);
	let sev = major;
	if (sev === undefined) {
		if (games <= 25) {
			return;
		}
		sev = clamp((games - 25) / 100, 0.1, 0.6);
	}
	const rng = new Rng(`careerAging|injury|${seed}|${pid}|${season}|${n}`);
	const ageF = 1 + 0.08 * clamp(age - 27, 0, 8);
	const loss: Record<string, number> = {
		spd: sev * ageF * rng.uniform(2, 9),
		jmp: sev * ageF * rng.uniform(2, 10),
		endu: sev * ageF * rng.uniform(1, 7),
	};
	const neverSame =
		major !== undefined &&
		rng.random() < NEVER_THE_SAME * sev * (age >= 30 ? 1 : 2 / 3);
	if (neverSame) {
		loss.spd! += rng.uniform(4, 8);
		loss.jmp! += rng.uniform(4, 9);
		loss.endu! += rng.uniform(2, 5);
		loss.dnk = rng.uniform(1, 4);
	}
	for (const key of Object.keys(loss)) {
		loss[key] = Math.round(loss[key]!);
	}
	return { loss, neverSame, jmpTilt: Math.round(2 * sev) };
};

// --- Retirement ---

// Career points milestones a veteran sticks around for
const POINT_MILESTONES = [10000, 15000, 20000, 25000, 30000, 35000, 40000];

// Extra multiplier on the retirement chance by age (on top of Realistic Aging's), tuned with longRun.script.test.ts toward the NBA's
// 2000-2025 counts by age
export const CAREER_RETIRE_AGE_SCALE: Record<number, number> = {
	34: 0.5,
	35: 0.45,
	36: 0.45,
	37: 0.5,
	38: 0.7,
	39: 1,
	40: 1.4,
};

export type RetireFactors = {
	// Multiplies both retirement chances
	mult: number;
	// Added to the first one (retiring on top after a title, 41+)
	add: number;
};

/**
 * Career Aging's retirement factors: role and minutes, a contract for next season, a recent title (stars may retire on top), injuries,
 * an upcoming points milestone and mentor value (veteran savvy, with Player Traits).
 */
export const careerRetireFactors = ({
	p,
	age,
	season,
	ovr,
	veteranSavvy,
}: {
	p: CareerAgingPlayer & {
		tid: number;
		contracts: any[];
		awards: { season: number; type?: string }[];
		injury: { type: string; gamesRemaining: number };
	};
	age: number;
	season: number;
	ovr: number;
	// 0-100 trait score, undefined without Player Traits
	veteranSavvy?: number;
}): RetireFactors => {
	let mult = CAREER_RETIRE_AGE_SCALE[age] ?? 1;
	let add = 0;

	let min = 0;
	let pts = 0;
	let seasonPts = 0;
	for (const row of statRows(p)) {
		if (row.playoffs || (row.tid ?? 0) < 0) {
			continue;
		}
		pts += row.pts ?? 0;
		if (row.season === season) {
			min += row.min ?? 0;
			seasonPts += row.pts ?? 0;
		}
	}

	// Role
	if (min >= 1800) {
		mult *= 0.55;
	} else if (min >= 1000) {
		mult *= 0.75;
	} else if (min >= 400) {
		mult *= 0.95;
	} else {
		mult *= p.tid < 0 ? 1.15 : 1.05;
	}

	// Money left on the table: he's under contract next season
	const contract = getCurrentContract(p as any);
	if (contract && getContractExp(contract) > season) {
		mult *= 0.55;
	}

	// A milestone within reach next season
	const reach = Math.max(seasonPts * 1.1, 300);
	if (POINT_MILESTONES.some((m) => m > pts && m - pts <= reach)) {
		mult *= 0.6;
	}

	// Mentor value: teams want savvy veterans around their young players
	if (veteranSavvy !== undefined && veteranSavvy >= 65) {
		mult *= 0.8;
	}

	// Injuries: a major one this season, or still a long way from healthy
	const injured = (p.injuries ?? []).some(
		(x) =>
			x.season === season && majorInjurySeverity(x.type, x.games) !== undefined,
	);
	if (injured && age >= 32) {
		mult *= 1.4;
	}
	if (p.injury.gamesRemaining > 60) {
		mult *= 1.3;
	}

	// Retiring on top: a good player who just won a title
	if (
		age >= 34 &&
		ovr >= 55 &&
		p.awards.some((a) => a.season === season && a.type === "Won Championship")
	) {
		add += 0.15;
	}

	// Past 40 with a shrinking role
	if (age >= 40 && min < 800) {
		mult *= 1.3;
	}

	// No more 41+ year olds piling up
	if (age >= 41) {
		add += 0.4 * (age - 40);
	}

	return { mult, add };
};

// Free agents this old take the minimum to join a contender (freeAgents/autoSign.ts)
export const RING_CHASE_AGE = 33;

// A useful veteran (33-38, ovr 45+) waits up to two seasons as a free agent for a contender's call before retiring (one for everyone else)
export const freeAgentYearsBeforeRetiring = (age: number, ovr: number) =>
	age >= 33 && age <= 38 && ovr >= 45 ? 2 : 1;

// Veteran minimum (roster selection): a free agent or expiring player this old who would be in his team's top 13 by value (ahead of the
// filler at the end of the bench) is kept or signed for the minimum for one season by a team that isn't rebuilding, like NBA teams keep
// useful veterans on minimum deals instead of cutting them for younger players of the same level
export const VET_MINIMUM_AGE = 33;
// Not past this age (players 39+ are kept only by their own merit, otherwise too many play into their 40s)
export const VET_MINIMUM_MAX_AGE = 37;
const VET_MINIMUM_RANK = 13;

export const usefulVeteran = (
	p: {
		born: { year: number };
		value: number;
		injury: { gamesRemaining: number };
	},
	rosterValues: number[],
	strategy: string,
) => {
	if (strategy === "rebuilding" || p.injury.gamesRemaining > 20) {
		return false;
	}
	const age = g.get("season") - p.born.year;
	if (age < VET_MINIMUM_AGE || age > VET_MINIMUM_MAX_AGE) {
		return false;
	}
	const sorted = rosterValues.toSorted((a, b) => b - a);
	if (sorted.length < VET_MINIMUM_RANK) {
		return sorted.length === 0 || p.value >= sorted.at(-1)!;
	}
	return p.value > sorted[VET_MINIMUM_RANK - 1]!;
};
