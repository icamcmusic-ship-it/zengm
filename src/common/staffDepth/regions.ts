// Scouting Director & Regions: where a prospect plays, how the Director spreads his scouts over the regions, and how a prospect's looks
// narrow the fuzz on what the user's scouts see. Pure (seeded streams only, never the game's random numbers).
import { COLLEGES, NON_NCAA } from "../collegeStats/colleges.ts";
import { getRegion } from "../collegeStats/colleges.helpers.ts";
import { isOverseasLeague } from "../collegeStats/overseas.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import type { Scout, Specialty } from "../scoutingReports/types.ts";
import type { ScoutPriority, ScoutRegion } from "./types.ts";

export const SCOUT_REGIONS: ScoutRegion[] = [
	"east",
	"west",
	"midSouth",
	"intl",
	"prep",
];

export const REGION_NAMES: Record<ScoutRegion, string> = {
	east: "East",
	west: "West",
	midSouth: "Midwest/South",
	intl: "International",
	prep: "G League/Prep",
};

export const PRIORITY_NAMES: Record<ScoutPriority, string> = {
	auto: "Auto (the Director decides)",
	bpa: "Best available",
	need: "Positional need",
	guards: "Guards",
	bigs: "Bigs",
	intl: "International",
	upside: "Upside",
	ready: "Ready now",
};

export const PRIORITY_SHORT: Record<ScoutPriority, string> = {
	auto: "Auto",
	bpa: "Best available",
	need: "Positional need",
	guards: "Guards",
	bigs: "Bigs",
	intl: "International",
	upside: "Upside",
	ready: "Ready now",
};

const CONFERENCE_REGION: Record<string, ScoutRegion> = {
	ACC: "east",
	"Big East": "east",
	"Atlantic 10": "east",
	CAA: "east",
	MAAC: "east",
	Ivy: "east",
	"America East": "east",
	NEC: "east",
	Patriot: "east",
	MEAC: "east",
	"Big South": "east",
	"Pac-12": "west",
	WCC: "west",
	"Mountain West": "west",
	"Big West": "west",
	"Big Sky": "west",
	UAC: "west",
	SEC: "midSouth",
	"Big Ten": "midSouth",
	"Big 12": "midSouth",
	American: "midSouth",
	"Missouri Valley": "midSouth",
	"Conference USA": "midSouth",
	MAC: "midSouth",
	"Sun Belt": "midSouth",
	Horizon: "midSouth",
	Southern: "midSouth",
	"Ohio Valley": "midSouth",
	Southland: "midSouth",
	ASUN: "midSouth",
	SWAC: "midSouth",
	Summit: "midSouth",
};

const US_REGIONS: ScoutRegion[] = ["east", "west", "midSouth"];

/**
 * The scouting region of a prospect: his school's conference for NCAA players, International for pro clubs abroad (or no school and born
 * abroad), G League/Prep for the G League, prep, academy, junior college and small-school circuit.
 */
export const prospectRegion = ({
	pid,
	school,
	bornLoc,
}: {
	pid: number;
	school: string | undefined;
	bornLoc: string;
}): ScoutRegion => {
	if (school) {
		const college = COLLEGES[school];
		if (college) {
			return CONFERENCE_REGION[college[1]] ?? US_REGIONS[pid % 3]!;
		}
		if (isOverseasLeague(school)) {
			return "intl";
		}
		if (NON_NCAA[school]) {
			return "prep";
		}
	}
	const born = getRegion(bornLoc);
	if (born !== "usa" && born !== "canada") {
		return "intl";
	}
	return US_REGIONS[pid % 3]!;
};

// How well a scout of a specialty covers a region (1 = a full share of his time is worth his quality there)
export const REGION_AFFINITY: Record<Specialty, Record<ScoutRegion, number>> = {
	college: { east: 1, west: 1, midSouth: 1, intl: 0.35, prep: 0.7 },
	international: {
		east: 0.45,
		west: 0.45,
		midSouth: 0.45,
		intl: 1.3,
		prep: 0.5,
	},
	pro: { east: 0.5, west: 0.5, midSouth: 0.5, intl: 0.6, prep: 1.15 },
	athletes: { east: 0.85, west: 0.85, midSouth: 0.85, intl: 0.6, prep: 0.95 },
	shooters: { east: 0.85, west: 0.85, midSouth: 0.85, intl: 0.75, prep: 0.8 },
};

// Scout careers: years in the business and what that adds. A scout's experience is his years in this job plus part of his years before it
export const scoutExperience = (
	s: Pick<Scout, "since" | "age">,
	season: number,
) => {
	const here = Math.max(0, season - s.since);
	const before = Math.max(0, s.age - here - 28);
	return Math.round(here + 0.4 * before);
};

// Experience sharpens a scout a little (up to +0.1 quality after about 12 years)
export const experienceBonus = (exp: number) => Math.min(0.1, 0.008 * exp);

// After four years in the job a scout picks up a second specialty (fixed per scout)
export const secondSpecialty = (
	s: Pick<Scout, "seed" | "specialty" | "since">,
	season: number,
): Specialty | undefined => {
	if (season - s.since < 4) {
		return undefined;
	}
	const all: Specialty[] = [
		"college",
		"international",
		"pro",
		"athletes",
		"shooters",
	];
	const others = all.filter((x) => x !== s.specialty);
	return others[new Rng(`spec2|${s.seed}`).int(0, others.length - 1)];
};

export const affinityOf = (
	s: Pick<Scout, "specialty" | "seed" | "since">,
	region: ScoutRegion,
	season: number,
) => {
	const a = REGION_AFFINITY[s.specialty][region];
	const second = secondSpecialty(s, season);
	return second ? Math.max(a, 0.85 * REGION_AFFINITY[second][region]) : a;
};

export const effectiveQuality = (s: Scout, season: number) =>
	Math.min(0.97, s.quality + experienceBonus(scoutExperience(s, season)));

export type RegionPlan = {
	// scout id -> region
	assignments: Record<number, ScoutRegion>;
	// coverage of each region (0 none ... about 1 two good scouts)
	coverage: Record<ScoutRegion, number>;
	// how much each region matters to the Director this season (share of the class, weighted by the priority)
	importance: Record<ScoutRegion, number>;
};

// Coverage one scout adds to his region: his quality times his specialty's affinity, times this (an average scout covers his region about
// 0.35, "Covered"; two good ones make it "Strong")
export const SCOUT_COVERAGE = 0.7;

export const priorityRegionWeight = (
	priority: ScoutPriority,
	region: ScoutRegion,
) => (priority === "intl" && region === "intl" ? 2 : 1);

/**
 * The Director's plan: every scout gets one region, greedily where his specialty and quality add the most to what is still uncovered,
 * weighted by how much of the class (top prospects counting more) plays there. A weaker Director misjudges the regions a little (seeded
 * by team and season). manual: assignments that are kept (Manual delegation or an accepted suggestion).
 */
export const planRegions = ({
	scouts,
	directorQuality,
	classShare,
	priority,
	season,
	seed,
	manual,
}: {
	scouts: Scout[];
	directorQuality: number;
	classShare: Record<ScoutRegion, number>;
	priority: ScoutPriority;
	season: number;
	seed: string;
	manual?: Record<number, ScoutRegion>;
}): RegionPlan => {
	const rng = new Rng(`regions|${seed}|${season}`);
	const importance = {} as Record<ScoutRegion, number>;
	const judged = {} as Record<ScoutRegion, number>;
	for (const r of SCOUT_REGIONS) {
		importance[r] = (classShare[r] ?? 0) * priorityRegionWeight(priority, r);
		// A weak Director's read of where the talent is
		judged[r] =
			importance[r] *
			Math.exp(rng.normal(0, 0.45 * (1 - Math.min(1, directorQuality))));
	}
	const coverage = {} as Record<ScoutRegion, number>;
	for (const r of SCOUT_REGIONS) {
		// The Director himself gets around a little
		coverage[r] = 0.08 + 0.1 * directorQuality;
	}
	const assignments: Record<number, ScoutRegion> = {};
	const ordered = [...scouts].sort(
		(a, b) => effectiveQuality(b, season) - effectiveQuality(a, season),
	);
	for (const s of ordered) {
		const q = effectiveQuality(s, season);
		let region = manual?.[s.id];
		if (!region) {
			let best = -Infinity;
			for (const r of SCOUT_REGIONS) {
				const add = SCOUT_COVERAGE * q * affinityOf(s, r, season);
				// Diminishing returns: the second scout in a region adds less
				const value = (judged[r]! * add) / (0.35 + coverage[r]!);
				if (value > best) {
					best = value;
					region = r;
				}
			}
		}
		assignments[s.id] = region!;
		coverage[region!] += SCOUT_COVERAGE * q * affinityOf(s, region!, season);
	}
	for (const r of SCOUT_REGIONS) {
		coverage[r] = Math.round(coverage[r]! * 1000) / 1000;
	}
	return { assignments, coverage, importance };
};

// Coverage words for the UI
export const coverageLabel = (c: number) =>
	c >= 0.9
		? "Saturated"
		: c >= 0.55
			? "Strong"
			: c >= 0.3
				? "Covered"
				: c >= 0.18
					? "Thin"
					: "Blind spot";

export const BLIND_SPOT = 0.18;

// How visible a prospect is (top of the class gets seen more), from his projected rank in his class by the scouts' value
export const visibilityForRank = (rank: number) =>
	rank <= 14 ? 1.5 : rank <= 30 ? 1.2 : rank <= 60 ? 0.8 : 0.4;

// Looks a prospect gets in a week of the regular season in his region: visibility times coverage. Future classes (drafted after the next
// draft) are seen much less
export const LOOKS_PER_WEEK = 0.6;
export const FUTURE_CLASS_LOOKS = 0.25;

export const weeklyLooks = ({
	coverage,
	visibility,
	priorityMatch,
	future,
}: {
	coverage: number;
	visibility: number;
	priorityMatch: boolean;
	future: boolean;
}) =>
	LOOKS_PER_WEEK *
	coverage *
	visibility *
	(priorityMatch ? 1.3 : 1) *
	(future ? FUTURE_CLASS_LOOKS : 1);

// Big events: the national tournament (prospects whose team made it), a late-season showcase (everyone else in the top of the class) and the
// combine (invited prospects). Each is worth a few weeks of looks, more where the region is covered
export const EVENT_LOOKS = {
	tournament: 3.5,
	showcase: 2.5,
	combine: 4.5,
} as const;

export const eventLooks = (event: keyof typeof EVENT_LOOKS, coverage: number) =>
	EVENT_LOOKS[event] * (0.6 + 0.8 * Math.min(1, coverage));

// The share of a prospect's fuzz left after his looks (1 = no narrowing; never below 35%)
export const LOOKS_FLOOR = 0.35;
export const LOOKS_SCALE = 15;
export const fuzzFactorForLooks = (looks: number) =>
	LOOKS_FLOOR + (1 - LOOKS_FLOOR) * Math.exp(-Math.max(0, looks) / LOOKS_SCALE);

// A new season: half of last season's looks carry over (the staff remembers him, but he changed)
export const LOOKS_CARRY = 0.5;

// Confidence words from the remaining share of fuzz
export const confidenceFromFactor = (f: number) =>
	f <= 0.45 ? "Very high" : f <= 0.6 ? "High" : f <= 0.8 ? "Medium" : "Low";
