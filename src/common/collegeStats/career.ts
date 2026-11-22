import {
	ACADEMIES,
	COLLEGES,
	CONFERENCES,
	LOWER_LEVEL_INFO,
	NON_NCAA,
	OVERSEAS_EXTRA,
	PATHWAY_TEAM,
	PREP_SCHOOLS,
	SMALL_COLLEGES,
	type Region,
} from "./colleges.ts";
import {
	getCountry,
	getRegion,
	getSchool,
	homeLeagueFactor,
	type School,
} from "./colleges.helpers.ts";
import {
	getLeagueEnv,
	getLeagueTier,
	isOverseasLeague,
	TIER_NAMES,
	type OverseasTier,
} from "./overseas.ts";
import { planInjuries, type PreDraftInjury } from "./injuries.ts";
import { JUCOS, JUCOS_MORE } from "./juco.ts";
import { getHeadCoach } from "./profile.ts";
import { Rng, clamp } from "./rng.ts";
import type { CollegeProspect } from "./types.ts";
import type { SeasonRole } from "./roles.ts";

const JUCOS_ALL = [...JUCOS, ...JUCOS_MORE];

/**
 * The career model: where a prospect spent each year before the draft, and the handful of prospects per class with a story. Everything here is biography built around the ratings he already has: it decides schools, redshirt years, minutes and how raw he was early on, never his ratings, age or anything else the pro game reads.
 *
 * A plan is drawn from the prospect's own stream (seed, draft year, key), separate from the stream his stats come from, so a prospect with a plain career (one school, no story: most of them) gets exactly the seasons he got before this model existed.
 *
 * - Transfers: a move between two seasons, never during one. Up-transfers (a breakout at a smaller school, then a bigger program), down-transfers (off a big program's bench to play) and lateral ones. The school of the draft year is always the prospect's own, which is the one tied to the simulated college season.
 * - Redshirt: a year at the school with no games. It takes the place of what would have been his first season (his age is fixed), so a redshirt junior is 22, as old as a senior.
 * - Medical redshirt: a season that ended after a few games and did not count against his eligibility.
 * - JUCO: one or two junior college seasons before Division I.
 *
 * More pre-draft paths (preDraftPaths, on unless `paths: false`), each from a stream of its own:
 * - Transfer portal: a coaching change at his school makes a transfer more likely (and the season the new coach arrived the likely one he arrived in), and every transfer records why (`why`).
 * - Pro pathway program: an elite high school prospect picked for it (generate.ts) plays his one season before the draft for a pro development team instead of college (level "pathway").
 * - Overseas tiers: every season abroad has a tier (top, mid, development) from its league; a prospect works his way up, so his earlier, younger seasons are often in lower tier leagues of his region.
 */

// gap: a year away from basketball (preDraftPaths: a gap year, military service, a mission), no team and no games
export type CareerStatus = "redshirt" | "medical" | "injury" | "gap";
// juco/small: from a junior college or a Division II/NAIA program to Division I; prep: from a post-graduate year to college; academy: from
// a youth academy to a pro club or college
export type CareerMove =
	| "up"
	| "down"
	| "lateral"
	| "juco"
	| "small"
	| "prep"
	| "academy";
// prep: a post-graduate year at a prep school; academy: a youth academy; dii/naia: a Division II or NAIA program; gap: a year away from
// basketball (all preDraftPaths)
export type CareerLevel =
	| "ncaa"
	| "juco"
	| "pathway"
	| "other"
	| "prep"
	| "academy"
	| "dii"
	| "naia"
	| "gap";

/**
 * More pre-draft paths: how a prospect got to the draft when it was not the usual way, told in a line on his College/Overseas page.
 * - postgrad: a post-graduate year at a prep school before college (reclassified to a later high school class)
 * - academy: an international prospect's year or two at a youth academy before college
 * - smallCollege: a Division II or NAIA start, then Division I
 * - gap, military, mission: a year away from basketball before college
 * - twoSport: also on the football team, joining the basketball team late in his early seasons
 * - nextStars: an elite prospect's one season in the NBL's Next Stars program instead of college
 * - abroad: an American who turned pro overseas out of high school
 */
export const ROUTE_KINDS = [
	"postgrad",
	"academy",
	"smallCollege",
	"gap",
	"military",
	"mission",
	"twoSport",
	"nextStars",
	"abroad",
] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];
// Why he transferred: a coaching change at either school, playing time (he was buried, or wanted a bigger role) or a breakout year at a smaller school
export type TransferReason = "coach" | "minutes" | "breakout";

export type CareerYear = {
	season: number;
	school: string;
	level: CareerLevel;
	// Class year label of a college or JUCO year, like "Fr." or "RS So."
	cls?: string;
	status?: CareerStatus;
	// He changed schools (or, abroad, moved up a tier) before this season, and how
	move?: CareerMove;
	// An injury that season (injuries.ts)
	injury?: PreDraftInjury;
	// With a transfer between Division I schools: why (preDraftPaths)
	why?: TransferReason;
	// A season abroad: the tier of the league (preDraftPaths). Careers stored before it have none; getLeagueTier gives it from the league
	tier?: OverseasTier;
	// A two-sport athlete's season: he joined the basketball team after the football season (preDraftPaths)
	football?: true;
	// Role changes (roles.ts): a breakout or slump season, or a freshman who moved into the starting lineup during it
	role?: SeasonRole;
	// Class-aware teams (teams.ts): his team's pace that season, possessions per 40 minutes. Careers made before it have none (the
	// average pace)
	pace?: number;
	// Class-aware teams: what his teammates' generation knows about him that season (teams.ts TeamMember): talent (class sd), and minutes
	// per game and usage expected before his teammates. Kept so a class made later sees him exactly as a plan of his class would
	tz?: number;
	xm?: number;
	xu?: number;
};

export const STORY_KINDS = [
	"bust",
	"unranked",
	"lateBloomer",
	"project",
	"smallSchoolScorer",
	"olderIntl",
	"reclass",
	"injury",
] as const;
export type StoryKind = (typeof STORY_KINDS)[number];

export type PreDraftCareer = {
	// Every year from his first one after high school to the draft year, oldest first, redshirt years included
	years: CareerYear[];
	story?: StoryKind;
	// How he got to the draft, when it was not the usual way (preDraftPaths)
	route?: RouteKind;
	// The high school class he was recruited in, for a prospect with a US high school path (an NCAA or JUCO first stop)
	hsClass?: number;
};

// What generation needs for one year
export type PlannedYear = CareerYear & {
	yearsBack: number;
	played: boolean;
	// Eligibility year, 0 = freshman ... 3 = senior
	classIndex: number;
	strength: number;
	conference: string | undefined;
	gameMinutes: number;
	mpgShift: number;
	usageShift: number;
	zShift: number;
	// Rating points he was further behind than a typical player his age (a late bloomer's early years)
	lag: number;
	gamesCap?: number;
	teamGames?: number;
	// Games missed with an injury in the middle of the season (injuries.ts)
	injuryGames?: number;
	// Minutes his role grew by during the season (roles.ts, a freshman who moved into the starting lineup)
	ramp?: number;
};

// What is kept on the player (p.preDraftCareer): his years, his story and, once it has been set against the rest of his high school class, his recruiting ranking (null: unranked)
export type StoredPreDraftCareer = PreDraftCareer & {
	recruit?: { rank: number | null; posRank: number | null };
	// p.college as generation read it, when p.college was then set to a different school (his draft year one, like the pro pathway program
	// for a prospect headed to a Division I school). Generation reads this again while p.college is still that school, so remaking his
	// stats with the same seed gives the same path
	collegeInput?: string;
};

export type CareerPlan = {
	years: PlannedYear[];
	story?: StoryKind;
	route?: RouteKind;
	hsClass?: number;
};

export { JUCOS, JUCOS_MORE, isJuco } from "./juco.ts";
export const JUCO_STRENGTH = 40;
export const JUCO_LEAGUE = "NJCAA";

const CLASS_NAMES = ["Fr.", "So.", "Jr.", "Sr.", "Gr."];
const classLabel = (elig: number, redshirted: boolean) =>
	`${redshirted ? "RS " : ""}${CLASS_NAMES[clamp(elig, 0, 4)]}`;

type Tier = "high" | "mid" | "low";
const tierOf = (school: string): Tier | undefined =>
	COLLEGES[school]
		? ((CONFERENCES[COLLEGES[school][1]]?.tier ?? "mid") as Tier)
		: undefined;

let schoolsByTier: Record<Tier, { names: string[]; weights: number[] }>;
const getSchoolsByTier = () => {
	if (!schoolsByTier) {
		schoolsByTier = {
			high: { names: [], weights: [] },
			mid: { names: [], weights: [] },
			low: { names: [], weights: [] },
		};
		for (const name of Object.keys(COLLEGES)) {
			const t = schoolsByTier[tierOf(name)!];
			t.names.push(name);
			// Bigger programs lose (and send on) more players, but not in proportion to how many pros they produce
			t.weights.push((COLLEGES[name]![0] + 0.5) ** 0.5);
		}
	}
	return schoolsByTier;
};

const pickSchoolOfTier = (tier: Tier, rng: Rng, exclude: Set<string>) => {
	const { names, weights } = getSchoolsByTier()[tier];
	for (let i = 0; i < 20; i++) {
		const name = rng.weighted(names, weights);
		if (!exclude.has(name)) {
			return name;
		}
	}
	return names.find((name) => !exclude.has(name))!;
};

// Where a player who ends up at a school of this tier transferred from: [tier he came from, weight]
const TRANSFER_FROM: Record<Tier, [Tier, CareerMove, number][]> = {
	high: [
		["mid", "up", 0.38],
		["low", "up", 0.2],
		["high", "lateral", 0.42],
	],
	mid: [
		["low", "up", 0.3],
		["high", "down", 0.45],
		["mid", "lateral", 0.25],
	],
	low: [
		["high", "down", 0.25],
		["mid", "down", 0.4],
		["low", "lateral", 0.35],
	],
};

// Chance a player transferred at least once, by how many years he has been in Division I
const P_TRANSFER = [0, 0, 0.13, 0.25, 0.34, 0.38];
// Transfer portal (preDraftPaths): P_TRANSFER is scaled by these, with and without a coaching change at his draft year school during his years there. About a quarter of multi-year careers have one, so the share who transferred stays about where it was (about a fifth of players with two or more Division I seasons)
const COACH_CHANGE_TRANSFER = 1.8;
const NO_COACH_CHANGE_TRANSFER = 0.62;
// How much likelier the season a new coach arrived is as the one he transferred in
const COACH_SEASON_WEIGHT = 3;

// Height in inches for a hgt rating (genRatings), when his listed height is not known
export const heightFromRating = (hgt: number) => Math.round(66 + 0.27 * hgt);

// Share of prospects who roll for one of the general stories, and for one their build or path makes them the rare candidate for
const STORY_RATE = 0.12;
const RARE_STORY_RATE = 0.55;

// How often a prospect the injury-riddled class marked has the injury story
const SHAPE_INJURY_RATE = 0.85;

type StoryContext = {
	z: number;
	classIndex: number;
	isNcaa: boolean;
	school: School | undefined;
};

/**
 * The story a prospect has, if any. A prospect is a candidate with a fixed chance from his own stream; which story fits depends on what he already is (his talent in his class, class year, height, school, where he was born), so nothing about him has to change for it to be true.
 */
export const pickStory = (
	p: CollegeProspect,
	ctx: StoryContext,
	seedBase: string,
): StoryKind | undefined => {
	const { z, classIndex: c, isNcaa, school } = ctx;
	if (!school || school.idle) {
		return undefined;
	}
	// Marked by his draft class's shape: usually the story, from a stream of its own so nobody else's story changes
	if (
		p.injuryHistory &&
		new Rng(`${seedBase}|shapeInjury`).random() < SHAPE_INJURY_RATE
	) {
		return "injury";
	}
	const rng = new Rng(`${seedBase}|story`);
	const u = rng.random();
	const height = p.heightInches ?? heightFromRating(p.ratings.hgt);
	const region = getRegion(p.bornLoc);
	const tier = tierOf(school.name);

	// Stories only a few prospects could have: when one fits, it is likely his
	const rare: StoryKind[] = [];
	if (height >= 87 && (p.ratings.oiq < 50 || z < 1)) {
		rare.push("project");
	}
	if (height <= 73 && isNcaa && tier === "low" && z >= -0.6) {
		rare.push("smallSchoolScorer");
	}
	if (
		!isNcaa &&
		isOverseasLeague(school.name) &&
		region !== "usa" &&
		region !== "canada" &&
		p.age >= 22
	) {
		rare.push("olderIntl");
	}
	if (rare.length > 0 && u < RARE_STORY_RATE) {
		return rare[Math.floor(rng.random() * rare.length)];
	}
	if (rng.random() >= STORY_RATE) {
		return undefined;
	}

	// Not every candidate has a story that fits: the fewer that do, the more often he has none
	const kinds: (StoryKind | undefined)[] = [undefined];
	const weights: number[] = [1.2];
	const add = (kind: StoryKind, w: number) => {
		kinds.push(kind);
		weights.push(w);
	};
	if (isNcaa && c >= 1 && z <= -0.2) {
		add("bust", 2.2);
	}
	if (isNcaa && c >= 1 && z >= 0.7) {
		add("unranked", 3);
	}
	if (isNcaa && c === 3 && z >= -0.3) {
		// His hidden trajectory (playerTraits/development.ts): only a late bloomer by it is likely to tell this story, an early one never.
		// Averages out to the old weight over a class
		const w = 2.4 * Math.max(0, 1 + 1.5 * (p.lateness ?? 0));
		if (w > 0) {
			add("lateBloomer", w);
		}
	}
	// Reclassified up a year: a young freshman, not an older one
	if (isNcaa && c === 0 && p.age <= 19) {
		add("reclass", 1.6);
	}
	add("injury", 0.6);
	return rng.weighted(kinds, weights);
};

const TIER_BELOW: Record<OverseasTier, OverseasTier | undefined> = {
	top: "mid",
	mid: "dev",
	dev: undefined,
};

// Chance the season before was a tier lower, by his age that season: a teenager's first pro seasons are mostly in a lower tier, a 22-year-old has usually been where he is for a while
export const tierDropChance = (age: number, z: number) => {
	const base =
		age <= 17
			? 0.55
			: age === 18
				? 0.45
				: age === 19
					? 0.36
					: age === 20
						? 0.27
						: age === 21
							? 0.2
							: 0.12;
	// The best prospects of a class get to the top sooner, the rawest later
	const talent = z >= 1.2 ? 0.5 : z >= 0.4 ? 0.75 : z < -0.5 ? 1.25 : 1;
	return Math.min(0.8, base * talent);
};

let leaguesByTier: Record<OverseasTier, string[]> | undefined;
const getLeaguesByTier = () => {
	if (!leaguesByTier) {
		leaguesByTier = { top: [], mid: [], dev: [] };
		for (const name of [
			...Object.keys(NON_NCAA),
			...Object.keys(OVERSEAS_EXTRA),
		]) {
			const tier = getLeagueTier(name);
			if (tier) {
				leaguesByTier[tier].push(name);
			}
		}
	}
	return leaguesByTier;
};

// A league of this tier, likely one where players from his part of the world go (with `country`, preDraftPaths: most likely his own
// country's domestic league)
export const pickLeagueOfTier = (
	tier: OverseasTier,
	region: Region,
	rng: Rng,
	country?: string,
) => {
	const names = getLeaguesByTier()[tier];
	const weights = names.map((name) => {
		const info = NON_NCAA[name] ?? OVERSEAS_EXTRA[name]!;
		return (
			info.w *
			(info.regions[region] ?? 1) *
			(country !== undefined ? homeLeagueFactor(name, country) : 1)
		);
	});
	return rng.weighted(names, weights);
};

// Chance the first season of a teenager abroad (17 or 18 that season) in the development tier was at a youth academy instead
const ACADEMY_START_CHANCE = 0.4;

// The youth academy for prospects born in a region
export const academyFor = (region: Region) =>
	Object.keys(ACADEMIES).find((name) => ACADEMIES[name]!.includes(region)) ??
	"NBA Academy";

/**
 * Overseas tiers for a prospect abroad (preDraftPaths). His draft year is in his own league, at its tier. Going back a season at a time, he may have been a tier lower (likelier the younger he was), in a league of that tier in his part of the world (most likely his own country's); once lower, never higher further back. A season in a lower tier league is a different league, with its own level of competition, minutes and pace. A first season at 17 or 18 in the development tier may have been at a youth academy instead. Drawn from streams of their own, so nothing else about him changes.
 */
const planTiers = (
	p: CollegeProspect,
	years: PlannedYear[],
	z: number,
	seedBase: string,
) => {
	const last = years.at(-1)!;
	let tier = getLeagueTier(last.school)!;
	last.tier = tier;
	const rng = new Rng(`${seedBase}|tiers`);
	const region = getRegion(p.bornLoc);
	const country = getCountry(p.bornLoc);
	let league = last.school;
	for (let i = years.length - 2; i >= 0; i--) {
		const year = years[i]!;
		const lower = TIER_BELOW[tier];
		if (lower && rng.random() < tierDropChance(p.age - year.yearsBack, z)) {
			tier = lower;
			league = pickLeagueOfTier(tier, region, rng, country);
			years[i + 1]!.move = "up";
		}
		year.tier = tier;
		if (league !== year.school) {
			const info = getSchool(league)!;
			year.school = league;
			year.strength = info.strength;
			year.gameMinutes = info.gameMinutes;
		}
	}
	const firstYear = years[0]!;
	if (
		years.length >= 2 &&
		firstYear.tier === "dev" &&
		p.age - firstYear.yearsBack <= 18 &&
		region !== "usa" &&
		region !== "canada" &&
		new Rng(`${seedBase}|academy`).random() < ACADEMY_START_CHANCE
	) {
		firstYear.school = academyFor(region);
		firstYear.level = "academy";
		firstYear.strength = LOWER_LEVEL_INFO.academy.strength;
		firstYear.gameMinutes = LOWER_LEVEL_INFO.academy.gameMinutes;
		firstYear.teamGames = 30;
		delete firstYear.tier;
		years[1]!.move = "academy";
	}
};

/**
 * Plan a prospect's years before the draft. `school` is where he plays in his draft year (undefined or idle: no years).
 */
export const planCareer = (
	p: CollegeProspect,
	school: School | undefined,
	{
		seed,
		draftYear,
		priorSeasons,
		z,
		classIndex,
		injuries = true,
		paths = true,
		route: classRoute,
	}: {
		seed: string;
		draftYear: number;
		priorSeasons: boolean;
		// Class-relative talent, clamped
		z: number;
		classIndex: number;
		// Pre-draft injuries (injuries.ts), from a stream of their own. Default true
		injuries?: boolean;
		// More pre-draft paths (preDraftPaths): coaching changes in the transfer portal, the pro pathway program, overseas tiers, routes. Default true
		paths?: boolean;
		// A route picked for him with the rest of his class (generate.ts getClassRoutes: the NBL's Next Stars, an American abroad)
		route?: RouteKind;
	},
): CareerPlan => {
	let route = paths ? classRoute : undefined;
	if (!school || school.idle) {
		return { years: [] };
	}
	const seedBase = `${seed}|${draftYear}|${p.key}`;
	const rng = new Rng(`${seedBase}|career`);
	const isNcaa = !school.nonCollege && !!COLLEGES[school.name];
	const pathway = school.name === PATHWAY_TEAM;
	const c = classIndex;
	// The pro pathway program is his story
	const story =
		priorSeasons && !pathway && !route
			? pickStory(p, { z, classIndex: c, isNcaa, school }, seedBase)
			: undefined;

	let n = priorSeasons ? c + 1 : 1;
	// An older international pro has been at it since he was 17 or 18 (the pre-draft window is six seasons)
	if (story === "olderIntl") {
		n = clamp(p.age - (rng.random() < 0.5 ? 16 : 17), n, 6);
	}

	const base = (yearsBack: number): PlannedYear => ({
		season: draftYear - yearsBack,
		school: school.name,
		level: isNcaa ? "ncaa" : pathway ? "pathway" : "other",
		yearsBack,
		played: true,
		classIndex: c - yearsBack,
		strength: school.strength,
		conference: school.conference,
		gameMinutes: school.gameMinutes,
		mpgShift: 0,
		usageShift: 0,
		zShift: 0,
		lag: 0,
	});
	// Oldest first
	const years: PlannedYear[] = [];
	for (let k = n - 1; k >= 0; k--) {
		years.push(base(k));
	}

	if (isNcaa && priorSeasons) {
		// An old senior spent a fifth year somewhere: usually a redshirt year
		let redshirt = false;
		if (p.age >= 23 && n >= 4 && rng.random() < 0.6) {
			years.unshift(base(n));
			n += 1;
			redshirt = true;
		}

		// More pre-draft paths: a route that was not the usual one (a post-graduate year, an academy, a small college start, a year away),
		// from a stream of its own. A prospect with one gets no junior college or redshirt year
		if (paths && !story && !redshirt && !route) {
			route = pickCollegeRoute(p, n, z, seedBase);
		}
		const lead = route ? applyCollegeRoute(route, p, years, seedBase) : 0;

		// Junior college start
		let numJuco = 0;
		if (
			n >= 3 &&
			!redshirt &&
			!route &&
			story !== "bust" &&
			story !== "lateBloomer" &&
			story !== "reclass" &&
			story !== "smallSchoolScorer"
		) {
			const pJuco =
				story === "unranked"
					? 0.3
					: (n === 3 ? 0.05 : 0.065) * (z < 0 ? 1.4 : 0.7);
			if (rng.random() < pJuco) {
				numJuco =
					n === 3 ? (rng.random() < 0.5 ? 1 : 2) : rng.random() < 0.7 ? 2 : 1;
				const jucos = paths ? JUCOS_ALL : JUCOS;
				const juco = jucos[Math.floor(rng.random() * jucos.length)]!;
				for (let i = 0; i < numJuco; i++) {
					const year = years[i]!;
					year.school = juco;
					year.level = "juco";
					year.strength = JUCO_STRENGTH + rng.normal(0, 2);
					year.conference = undefined;
					year.zShift += 1.3;
					year.mpgShift += 2;
					year.teamGames = 28 + Math.floor(rng.random() * 6);
				}
				years[numJuco]!.move = "juco";
			}
		}

		// Redshirt year: his first year on campus, no games
		if (!redshirt && n >= 2 && numJuco === 0 && story !== "bust" && !route) {
			const pRedshirt =
				story === "lateBloomer" ? 0.3 : story ? 0.03 : z < 0 ? 0.11 : 0.06;
			if (rng.random() < pRedshirt) {
				redshirt = true;
			}
		}
		if (redshirt) {
			years[0]!.played = false;
			years[0]!.status = "redshirt";
		}

		// Where his Division I years start
		const first = numJuco + lead;

		// Medical redshirt: a Division I season before the draft year that ended after a few games
		if (!redshirt && n - first >= 3 && !story && rng.random() < 0.04) {
			const i = first + Math.floor(rng.random() * (n - first - 1));
			years[i]!.status = "medical";
			years[i]!.gamesCap = 3 + Math.floor(rng.random() * 7);
		}

		// Transfers between Division I schools
		const d1 = n - first;
		// Transfer portal (preDraftPaths): seasons his school started with a new head coach (the one the College/Overseas page shows), who brings in transfers of his own. With one in his window a transfer is more likely, without one less, so the overall share stays about the same
		const coachSeasons = new Set<number>();
		if (paths) {
			for (let i = first + 1; i < n; i++) {
				const season = years[i]!.season;
				if (getHeadCoach(school.name, season).since === season) {
					coachSeasons.add(season);
				}
			}
		}
		const coachFactor = paths
			? coachSeasons.size > 0
				? COACH_CHANGE_TRANSFER
				: NO_COACH_CHANGE_TRANSFER
			: 1;
		const pTransfer =
			story === "unranked"
				? numJuco > 0
					? 0
					: 0.6
				: story === "bust"
					? // A five-star signs with a big program: one who is at a smaller school now left one
						tierOf(school.name) === "high"
						? 0.3
						: 0.85
					: story === "smallSchoolScorer" || story === "reclass"
						? 0
						: (P_TRANSFER[clamp(d1, 0, 5)] ?? 0) *
							(numJuco > 0 || route === "smallCollege" ? 0.5 : 1) *
							coachFactor;
		if (d1 >= 2 && rng.random() < pTransfer) {
			const used = new Set([school.name]);
			// He changes schools before the year at index `boundary`. Later is more likely: most transfers are upperclassmen
			const pickBoundary = (hi: number, toDraftSchool = false) => {
				const options = [];
				const weights = [];
				for (let i = first + 1; i <= hi; i++) {
					// Not straight after a redshirt year at the school
					if (years[i - 1]!.status === "redshirt" && i - 1 === first) {
						continue;
					}
					options.push(i);
					// He most likely came in with the new coach
					weights.push(
						(i - first) *
							(toDraftSchool && coachSeasons.has(years[i]!.season)
								? COACH_SEASON_WEIGHT
								: 1),
					);
				}
				return options.length > 0 ? rng.weighted(options, weights) : undefined;
			};
			const move = (boundary: number, toTier: Tier, forced?: CareerMove) => {
				// A story wants one kind of move. Where the school he ends up at rules it out (nobody transfers down to a high-major), a lateral one
				const all = TRANSFER_FROM[toTier];
				const wanted = all.filter((row) => row[1] === forced);
				const table =
					forced === undefined
						? all
						: wanted.length > 0
							? wanted
							: all.filter((row) => row[1] === "lateral");
				const [fromTier, kind] = rng.weighted(
					table,
					table.map((row) => row[2]),
				);
				const from = getSchool(pickSchoolOfTier(fromTier, rng, used))!;
				used.add(from.name);
				for (let i = first; i < boundary; i++) {
					const year = years[i]!;
					// A second (earlier) transfer only rewrites the years before it
					if (year.school !== years[boundary]!.school) {
						continue;
					}
					year.school = from.name;
					year.strength = from.strength;
					year.conference = from.conference;
					if (kind === "down") {
						year.mpgShift -= 6.5;
						year.usageShift -= 0.4;
					} else if (kind === "up") {
						year.mpgShift += 2.5;
					} else {
						year.mpgShift -= 2.5;
					}
				}
				if (kind === "up" && years[boundary - 1]!.played) {
					// The breakout that got him noticed
					years[boundary - 1]!.zShift += 0.3;
					years[boundary - 1]!.usageShift += 0.3;
				}
				years[boundary]!.move = kind;
				if (paths) {
					// No draws: whether either school changed coaches comes from the programs' own streams
					const season = years[boundary]!.season;
					const to = years[boundary]!.school;
					years[boundary]!.why =
						getHeadCoach(to, season).since === season ||
						getHeadCoach(from.name, season).since === season
							? "coach"
							: kind === "up"
								? "breakout"
								: "minutes";
				}
				return fromTier;
			};
			const boundary = pickBoundary(n - 1, true);
			if (boundary !== undefined) {
				const fromTier = move(
					boundary,
					tierOf(school.name) ?? "mid",
					story === "unranked" ? "up" : story === "bust" ? "down" : undefined,
				);
				if (d1 >= 4 && boundary - first >= 2 && rng.random() < 0.18) {
					const earlier = pickBoundary(boundary - 1);
					if (earlier !== undefined) {
						// Temporarily, the years before the first transfer are at the school he left
						move(earlier, fromTier);
					}
				}
			}
		}

		// Class year labels
		let elig = 0;
		let redshirted = false;
		for (const year of years) {
			year.classIndex = clamp(elig, 0, 3);
			// A post-graduate year, an academy or a year away is before college: no class year, no eligibility used
			if (!countsForEligibility(year.level)) {
				continue;
			}
			year.cls = classLabel(elig, redshirted);
			if (year.status === "redshirt" || year.status === "medical") {
				redshirted = true;
			} else {
				elig += 1;
			}
		}
	}

	// Overseas tiers: where he was on his way up
	if (paths && !isNcaa && isOverseasLeague(school.name)) {
		planTiers(p, years, z, seedBase);
	}

	// Stories
	const last = years.at(-1)!;
	const played = years.filter((year) => year.played);
	if (story === "bust") {
		// Handed the keys as a freshman, less every year since
		for (const [i, year] of played.entries()) {
			// Whatever else happened to him
			year.mpgShift = i === 0 ? 4 : -2 - 1.5 * i;
			year.zShift = Math.min(year.zShift, 0);
		}
	} else if (story === "unranked") {
		for (const year of played) {
			if (year.yearsBack >= 1) {
				year.mpgShift -= 1.5 + 2 * year.yearsBack;
				year.lag += 1.5 * year.yearsBack;
			}
		}
		last.zShift += 0.15;
	} else if (story === "lateBloomer") {
		for (const year of played) {
			if (year.yearsBack >= 1) {
				// Whatever else happened to him, he was at the end of the bench
				year.mpgShift = -(11 + 3 * year.yearsBack);
				year.zShift = Math.min(year.zShift, 0) - 0.8;
				year.usageShift -= 0.6;
				year.lag += 2 * year.yearsBack;
			}
		}
		last.mpgShift += 1.5;
		last.zShift += 0.2;
	} else if (story === "project") {
		for (const year of played) {
			year.mpgShift -= 7.5;
			year.usageShift -= 0.4;
		}
	} else if (story === "smallSchoolScorer") {
		for (const year of played) {
			year.mpgShift += 2;
			year.usageShift += 1;
		}
	} else if (story === "reclass") {
		last.mpgShift -= 1.5;
	} else if (story === "injury") {
		last.status = "injury";
		last.gamesCap = 5 + Math.floor(rng.random() * 11);
	}

	if (injuries) {
		planInjuries(years, {
			seedBase,
			durability: p.durability,
			seasonGames: getLeagueEnv(school.name)?.games ?? 32,
		});
	}

	// A two-sport athlete's early seasons: he joined after the football season (games missed, whatever else kept him out)
	if (route === "twoSport") {
		const sportRng = new Rng(`${seedBase}|twoSport`);
		for (const year of years) {
			const games = 7 + Math.floor(sportRng.random() * 6);
			if (year.football && year.played && year.gamesCap === undefined) {
				year.injuryGames = Math.max(year.injuryGames ?? 0, games);
			}
		}
	}

	const firstYear = years[0]!;
	const region = getRegion(p.bornLoc);
	// A US high school path: a college, junior college, prep, or a year away (not an international academy start), or an American who skipped
	// college for a pro club
	const hsPath =
		years.some((year) => year.level !== "other" && year.level !== "academy") ||
		((route === "nextStars" || route === "abroad") &&
			(region === "usa" || region === "canada"));
	return {
		years,
		...(story ? { story } : {}),
		...(route ? { route } : {}),
		...(hsPath ? { hsClass: firstYear.season - 1 } : {}),
	};
};

// Years of college eligibility: not a post-graduate year, an academy or a year away
const countsForEligibility = (level: CareerLevel) =>
	level !== "prep" && level !== "academy" && level !== "gap";

// Chances of each route (preDraftPaths) for a prospect at a Division I school, by where he was born
const ROUTE_RATES = {
	// A post-graduate year: Americans sometimes, Canadians often (a year at a US prep school), internationals at a US college often
	postgrad: { usa: 0.028, canada: 0.1, intl: 0.1 },
	// An international prospect's academy years before college
	academy: 0.16,
	// A Division II or NAIA start, more for lesser prospects
	smallCollege: 0.022,
	gap: 0.004,
	military: 0.0012,
	mission: 0.0015,
	twoSport: 0.007,
};

/**
 * The route a Division I prospect took when it was not the usual one (preDraftPaths), if any, from a stream of his own: n is how many years he has had since high school (his draft year included). Most have none.
 */
export const pickCollegeRoute = (
	p: CollegeProspect,
	n: number,
	z: number,
	seedBase: string,
): RouteKind | undefined => {
	if (n < 2) {
		return undefined;
	}
	const u = new Rng(`${seedBase}|routes`).random();
	const region = getRegion(p.bornLoc);
	const na = region === "usa" || region === "canada";
	const options: [RouteKind, number][] = [];
	options.push([
		"postgrad",
		region === "usa"
			? ROUTE_RATES.postgrad.usa
			: region === "canada"
				? ROUTE_RATES.postgrad.canada
				: ROUTE_RATES.postgrad.intl,
	]);
	if (!na) {
		options.push(["academy", ROUTE_RATES.academy]);
	}
	if (n >= 3 && na) {
		options.push([
			"smallCollege",
			ROUTE_RATES.smallCollege * (z < 0 ? 1.4 : 0.6),
		]);
	}
	if (n >= 3) {
		options.push(["gap", ROUTE_RATES.gap]);
		if (region === "usa") {
			options.push(["military", ROUTE_RATES.military]);
			if (p.age >= 21) {
				options.push(["mission", ROUTE_RATES.mission]);
			}
		}
	}
	if (region === "usa") {
		options.push(["twoSport", ROUTE_RATES.twoSport]);
	}
	let acc = 0;
	for (const [kind, rate] of options) {
		acc += rate;
		if (u < acc) {
			return kind;
		}
	}
	return undefined;
};

// What a year away from basketball is called on his record
export const GAP_NAMES = {
	gap: "Gap year",
	military: "Military service",
	mission: "Church mission",
} as const;

// A lower level year: its school, level and level of competition
const setLowerYear = (
	year: PlannedYear,
	school: string,
	level: CareerLevel,
	info: { strength: number; gameMinutes: number },
	rng: Rng,
) => {
	year.school = school;
	year.level = level;
	year.strength = info.strength + rng.normal(0, 2);
	year.conference = undefined;
	year.gameMinutes = info.gameMinutes;
	year.teamGames = 26 + Math.floor(rng.random() * 8);
};

/**
 * Rewrite the first years of a Division I career for its route (preDraftPaths). Returns how many years before his Division I ones it took (0 for a two-sport athlete, whose years are all Division I). Draws from a stream of its own.
 */
export const applyCollegeRoute = (
	route: RouteKind,
	p: CollegeProspect,
	years: PlannedYear[],
	seedBase: string,
): number => {
	const rng = new Rng(`${seedBase}|route`);
	const n = years.length;
	if (route === "postgrad") {
		const school =
			PREP_SCHOOLS[Math.floor(rng.random() * PREP_SCHOOLS.length)]!;
		setLowerYear(years[0]!, school, "prep", LOWER_LEVEL_INFO.prep, rng);
		// Against high school competition he was one of the best players on the floor
		years[0]!.zShift += 0.8;
		years[0]!.mpgShift += 2;
		years[1]!.move = "prep";
		return 1;
	}
	if (route === "academy") {
		const academy = academyFor(getRegion(p.bornLoc));
		// Two years there for a prospect who went to college at 19 or later
		const k = n >= 4 && rng.random() < 0.4 ? 2 : 1;
		for (let i = 0; i < k; i++) {
			setLowerYear(
				years[i]!,
				academy,
				"academy",
				LOWER_LEVEL_INFO.academy,
				rng,
			);
			years[i]!.zShift += 0.6;
			years[i]!.mpgShift += 1;
		}
		years[k]!.move = "academy";
		return k;
	}
	if (route === "smallCollege") {
		const names = Object.keys(SMALL_COLLEGES);
		const school = names[Math.floor(rng.random() * names.length)]!;
		const level = SMALL_COLLEGES[school]!;
		const k = n === 3 ? 1 : rng.random() < 0.6 ? 2 : 1;
		for (let i = 0; i < k; i++) {
			setLowerYear(years[i]!, school, level, LOWER_LEVEL_INFO[level], rng);
			// Inflated numbers against weak competition, like a junior college star
			years[i]!.zShift += 1.1;
			years[i]!.mpgShift += 2.5;
		}
		years[k]!.move = "small";
		return k;
	}
	if (route === "gap" || route === "military" || route === "mission") {
		const year = years[0]!;
		year.school = GAP_NAMES[route];
		year.level = "gap";
		year.played = false;
		year.status = "gap";
		year.conference = undefined;
		// Rusty in his first season back
		years[1]!.lag += 2;
		years[1]!.mpgShift -= 2;
		return 1;
	}
	// Two sports: every season before his last one
	for (const year of years) {
		if (year.yearsBack >= 1) {
			year.football = true;
			year.mpgShift -= 1.5;
		}
	}
	return 0;
};

export const toCareer = (plan: CareerPlan): PreDraftCareer => ({
	years: plan.years.map((year) => ({
		season: year.season,
		school: year.school,
		level: year.level,
		...(year.cls !== undefined ? { cls: year.cls } : {}),
		...(year.status ? { status: year.status } : {}),
		...(year.move ? { move: year.move } : {}),
		...(year.injury ? { injury: { ...year.injury } } : {}),
		...(year.why ? { why: year.why } : {}),
		...(year.tier ? { tier: year.tier } : {}),
		...(year.football ? { football: true as const } : {}),
		...(year.role ? { role: year.role } : {}),
		...(year.pace !== undefined ? { pace: year.pace } : {}),
		...(year.tz !== undefined ? { tz: year.tz, xm: year.xm, xu: year.xu } : {}),
	})),
	...(plan.story ? { story: plan.story } : {}),
	...(plan.route ? { route: plan.route } : {}),
	...(plan.hsClass !== undefined ? { hsClass: plan.hsClass } : {}),
});

const CLASS_WORDS: Record<string, string> = {
	"Fr.": "freshman",
	"So.": "sophomore",
	"Jr.": "junior",
	"Sr.": "senior",
	"Gr.": "graduate",
};

// "So." -> "sophomore", "RS Fr." -> "redshirt freshman"
export const classWord = (cls: string | undefined) => {
	if (!cls) {
		return undefined;
	}
	const redshirt = cls.startsWith("RS ");
	const word = CLASS_WORDS[redshirt ? cls.slice(3) : cls];
	return word ? `${redshirt ? "redshirt " : ""}${word}` : undefined;
};

/**
 * The note on a season he started somewhere new: a transfer ("Transferred from X to Y after his sophomore season, ..."), a junior college transfer, or a move up a tier abroad. undefined when he did not move. Works for careers stored before preDraftPaths too (no reason, no tier: the tier is read off the league).
 */
export const getMoveNote = (
	prev: CareerYear | undefined,
	year: CareerYear,
): string | undefined => {
	if (!year.move || !prev || prev.school === year.school) {
		return undefined;
	}
	if (year.move === "juco") {
		return `Junior college transfer from ${prev.school}`;
	}
	if (year.move === "small") {
		return `Transferred up from ${prev.school} (${prev.level === "naia" ? "NAIA" : "Division II"})`;
	}
	if (year.move === "prep") {
		return `Enrolled after a post-graduate year at ${prev.school}`;
	}
	if (year.move === "academy") {
		return `${getLeagueTier(year.school) ? "Turned pro" : "Enrolled"} after his time at the ${prev.school}`;
	}
	const prevTier = prev.tier ?? getLeagueTier(prev.school);
	const tier = year.tier ?? getLeagueTier(year.school);
	if (prevTier && tier) {
		return prevTier === tier
			? `Moved from ${prev.school}`
			: `Moved up from ${prev.school} (${TIER_NAMES[prevTier].toLowerCase()})`;
	}
	const word = classWord(prev.cls);
	let text = `Transferred from ${prev.school} to ${year.school} after ${word ? `his ${word} season` : `the ${prev.season} season`}`;
	if (year.why === "coach") {
		text +=
			getHeadCoach(year.school, year.season).since === year.season
				? `, to play for ${year.school}'s new coach`
				: `, after a coaching change at ${prev.school}`;
	} else if (year.why === "minutes") {
		text +=
			year.move === "down"
				? ", looking for more playing time"
				: ", looking for a bigger role";
	} else if (year.why === "breakout") {
		text += ", after a breakout season";
	}
	return text;
};

// Skill ratings a few points lower (physical ratings less), for a year he was further behind than his age says
export const lagRatings = <T extends Record<string, unknown>>(
	ratings: T,
	points: number,
): T => {
	if (points <= 0) {
		return ratings;
	}
	const out: Record<string, unknown> = { ...ratings };
	for (const key of Object.keys(out)) {
		const value = out[key];
		if (key === "hgt" || key === "wng" || typeof value !== "number") {
			continue;
		}
		const factor =
			key === "spd" || key === "jmp" || key === "stre" || key === "endu"
				? 0.4
				: 1;
		out[key] = Math.max(0, value - points * factor);
	}
	return out as T;
};

const feetInches = (inches: number) =>
	`${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;

/**
 * His story in a line, for the player page. `facts` are things that are public about him.
 */
export const getStoryText = (
	kind: StoryKind,
	facts: {
		hsClass?: number;
		recruitRank?: number;
		heightInches: number;
		ageAtDraft: number;
		school: string;
		conference?: string;
		firstSeason: number;
		firstAge: number;
		// Games in his draft year season
		lastGp: number;
		lastSeason: number;
	},
): { title: string; text: string } => {
	switch (kind) {
		case "bust":
			return {
				title: "Five-star recruit who never arrived",
				text: `${facts.recruitRank !== undefined ? `The No. ${facts.recruitRank} recruit` : "A five-star recruit"} in the high school class of ${facts.hsClass} and a projected lottery pick when he got to campus. The production never matched the billing, and his role and his draft stock have slipped ever since.`,
			};
		case "unranked":
			return {
				title: "Unranked recruit turned top prospect",
				text: `Not ranked by any recruiting service coming out of high school in ${facts.hsClass}. He played his way from off the radar onto every draft board.`,
			};
		case "lateBloomer":
			return {
				title: "Late bloomer",
				text: `Barely played for most of his college career, then broke out as a ${facts.ageAtDraft}-year-old in his last season, ${facts.lastSeason}. Scouts only started showing up in his last season.`,
			};
		case "project":
			return {
				title: `${feetInches(facts.heightInches)} project`,
				text: `At ${feetInches(facts.heightInches)} he is one of the tallest prospects in years, and still raw: limited minutes and a small role before the draft. Whoever takes him is betting on size that cannot be taught.`,
			};
		case "smallSchoolScorer":
			return {
				title: "Undersized scorer from a small school",
				text: `Only ${feetInches(facts.heightInches)}, and at ${facts.school}${facts.conference ? ` of the ${facts.conference}` : ""} he rarely saw high-major competition, but he carried his team's offense and put up numbers that were hard to ignore.`,
			};
		case "olderIntl":
			return {
				title: "Older international prospect",
				text: `${facts.ageAtDraft} at the draft and a professional since he was ${facts.firstAge}: ${facts.lastSeason - facts.firstSeason + 1} seasons against grown men before entering the draft.`,
			};
		case "reclass":
			return {
				title: "Reclassified to enroll a year early",
				text: `Originally in the high school class of ${(facts.hsClass ?? facts.firstSeason - 1) + 1}, he reclassified to ${facts.hsClass ?? facts.firstSeason - 1} and played his freshman season as one of the youngest players in college basketball.`,
			};
		case "injury":
			return {
				title: "Injury-shortened season",
				text: `His ${facts.lastSeason} season ended after ${facts.lastGp} ${facts.lastGp === 1 ? "game" : "games"} because of an injury, and he missed the postseason. Teams had to judge him on what he showed before it.`,
			};
	}
};

/**
 * His route in a line, for the College/Overseas page (preDraftPaths). `years` is his career, `school` his draft year school or league.
 */
export const getRouteText = (
	kind: RouteKind,
	years: CareerYear[],
	facts: { hsClass?: number; school: string; lastSeason: number },
): { title: string; text: string } => {
	const first = years[0];
	const firstCollege = years.find(
		(year) => countsForEligibility(year.level) && year.level !== "other",
	);
	const enrolledAt = firstCollege?.school ?? facts.school;
	const lower = years.filter(
		(year) => year.level === "dii" || year.level === "naia",
	);
	const hs =
		facts.hsClass !== undefined
			? ` after graduating from high school in ${facts.hsClass}`
			: " out of high school";
	switch (kind) {
		case "postgrad":
			return {
				title: "Post-graduate year",
				text: `Spent a post-graduate year at ${first?.school ?? "a prep school"}${hs}, then enrolled at ${enrolledAt} a year behind his high school class.`,
			};
		case "academy": {
			const academy = years.filter((year) => year.level === "academy");
			return {
				title: "Academy product",
				text: `Developed at the ${first?.school ?? "NBA Academy"}${academy.length > 1 ? ` for ${academy.length} seasons` : ""} before ${firstCollege ? `coming to the United States to play for ${firstCollege.school}` : "turning pro"}.`,
			};
		}
		case "smallCollege": {
			const level = lower[0]?.level === "naia" ? "NAIA" : "Division II";
			return {
				title: `${level} to Division I`,
				text: `Started at ${lower[0]?.school ?? "a small college"} (${level}), put up big numbers for ${lower.length === 1 ? "a season" : `${lower.length} seasons`} and moved up to Division I with ${enrolledAt}.`,
			};
		}
		case "gap":
			return {
				title: "Gap year",
				text: `Took a year away from basketball${hs} before enrolling at ${enrolledAt}.`,
			};
		case "military":
			return {
				title: "Military service",
				text: `Served in the military for a year${hs} before enrolling at ${enrolledAt}.`,
			};
		case "mission":
			return {
				title: "Church mission",
				text: `Spent a year on a church mission${hs} before enrolling at ${enrolledAt}, older than most of his classmates as a result.`,
			};
		case "twoSport":
			return {
				title: "Two-sport athlete",
				text: `Also played football at ${facts.school}, joining the basketball team after the football season, before committing to basketball full time for his last season, ${facts.lastSeason}.`,
			};
		case "nextStars":
			return {
				title: "NBL Next Stars",
				text: `Skipped college${hs} for a season in Australia's NBL through its Next Stars program, playing against grown men before the draft.`,
			};
		case "abroad":
			return {
				title: "Turned pro overseas",
				text: `Skipped college${hs} to sign with a club in the ${facts.school}, one of the few Americans to go straight from high school to a pro league abroad.`,
			};
	}
};
