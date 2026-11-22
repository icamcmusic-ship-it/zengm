import { backProject, simulateSeason } from "./season.ts";
import { getHonors, getYouthHonors } from "./honors.ts";
import {
	COLLEGES,
	COLLEGE_ALIASES,
	PATHWAY_TEAM,
	getLowerLevel,
} from "./colleges.ts";
import {
	getRegion,
	getSchool,
	pickBlankDestination,
	unknownSchool,
	type School,
} from "./colleges.helpers.ts";
import { getLeagueEnv } from "./overseas.ts";
import { Rng, clamp } from "./rng.ts";
import {
	getTeamIndex,
	getTeamPostseason,
	getTeamSummary,
	getTourneyHonors,
	type NcaaSeason,
	type ProspectNcaaGame,
} from "./ncaa.ts";
import { expectedRole, gameScore } from "./season.ts";
import { applyRoleArc } from "./roles.ts";
import { strengthOfTeam } from "./production.ts";
import {
	buildRosters,
	getTeamRoles,
	getTeamSeason,
	isTeamSchool,
	teamKey,
	type TeamMember,
	type TeamRole,
} from "./teams.ts";
import {
	isJuco,
	lagRatings,
	pickStory,
	planCareer,
	toCareer,
} from "./career.ts";
import { COLLEGE_AWARD_PREFIX } from "../preDraft.ts";
import type {
	CollegeProspect,
	CollegeResult,
	CollegeSeason,
	GameBox,
} from "./types.ts";

export type GenerateOptions = {
	seed: string;
	// The season of the draft the prospects are for, which is the season of their last college season
	draftYear: number;
	// Seasons before the draft year, for prospects who were not freshmen. Default true
	priorSeasons?: boolean;
	// How much random variation there is, 1 is normal
	noise?: number;
	// Give a prospect with a blank college a destination (pro club, prep school...) to play for. Default true
	fillBlankColleges?: boolean;
	// The college season of the draft year (ncaa.ts). A prospect at one of its schools plays his team's games, conference and NCAA tournament games included, and gets tournament honors
	ncaaSeason?: NcaaSeason;
	// The whole draft class, when only some of it is being generated (prospects missing stats, or a remake of some): where a prospect stands in his class is measured against all of it. Default: the prospects being generated
	classProspects?: CollegeProspect[];
	// Pre-draft injuries (injuries.ts). Default true
	injuries?: boolean;
	// More pre-draft paths (the preDraftPaths League Extra): coaching changes in the transfer portal, the pro pathway program and overseas tiers. Default true; false generates exactly what the model did before them
	paths?: boolean;
	// The context model: strength of schedule (season.ts), class-aware teams (teams.ts) and role changes (roles.ts). Default true; false
	// generates exactly what the model did before it
	context?: boolean;
	// Prospects of other draft classes (their seasons, generated or planned with planClassMembers) who can be teammates of this class's
	teamMembers?: TeamMember[];
	// Games of team seasons another class's college season model already played (their draft year), by teamKey: teammates there played
	// those games
	teamGames?: Map<string, number>;
};

// How many elite high school prospects of a class join the pro pathway program instead of going to college: at most this many, from at most PATHWAY_POOL of the best
// (the user: far too many players went this way; cut by about 75%, from 3.2 a class on average to about 0.8)
const PATHWAY_COUNTS = [0, 1, 2];
const PATHWAY_COUNT_WEIGHTS = [0.38, 0.44, 0.18];
// (the user: "not always top prospects": the program now takes good prospects from the top half of a class, not only the
// best few, picked almost evenly)
const PATHWAY_POOL = 30;
// How much a candidate's draft stock raises his chance of being one who joins (was 1.5, then 0.25)
const PATHWAY_STOCK_LEAN = 0.1;
// Class-relative draft stock (zStock) a prospect needs to be offered a spot: about the top half of a class (was 0.85,
// the top fifth)
const PATHWAY_MIN_STOCK = 0;

// Most games a junior college or lower level team plays in a season (class-aware teams)
const LOWER_MAX_GAMES = 34;

// Game score per 40 minutes a junior college season needs for honors
const JUCO_BARS = { allAmerican: 17.5, allRegion: 14 };

// getClassStats has an ovr prior; pot runs about this much higher
const POT_PRIOR_SHIFT = -10;

const isCollegeSchool = (school: School | undefined) =>
	!!school && !school.nonCollege && !school.idle;

// Class year (0 = freshman ... 3 = senior) from age during the draft year season
export const getClassIndex = (age: number) => {
	if (age <= 19) {
		return 0;
	}
	if (age === 20) {
		return 1;
	}
	if (age === 21) {
		return 2;
	}
	return 3;
};

/**
 * Class year from age and draft stock. Age at the draft (season minus birth year) spans two class years in real life (a freshman who turns 20 before the draft is "20"), so an age maps to one of two class years, and which one follows from how high his stock is: a top prospect leaves as early as he can (an older one-and-done is 20, a sophomore with lottery stock 21), and the four-year senior is usually a prospect who was never a lottery pick.
 * zStock is his class-relative draft stock (pot weighted, like the value teams draft by); u a uniform draw from his own stream.
 */
export const getClassIndexForStock = (
	age: number,
	zStock: number,
	u: number,
) => {
	const base = getClassIndex(age);
	if (base === 0 || age >= 23) {
		return base;
	}
	// Chance he is a year younger in school than his age says: rare for an average prospect, the norm for lottery stock
	const pYounger =
		1 /
		(1 + Math.exp(-3 * (zStock - (base === 1 ? 1 : base === 2 ? 1.2 : 1.4))));
	return u < pYounger ? base - 1 : base;
};

// How far above the class average (in class standard deviations) a prospect's stock can be in a season he came back after: higher, and he would have declared then
export const STAY_CAP = 0.55;

export const getClassStats = (prospects: CollegeProspect[]) => {
	// A small class can't tell what's typical, so it leans on a prior
	const PRIOR = { mean: 41, sd: 8.5, n: 12 };
	const n = prospects.length;
	let sum = 0;
	for (const p of prospects) {
		sum += p.ovr;
	}
	const sampleMean = n > 0 ? sum / n : PRIOR.mean;
	let sumSq = 0;
	for (const p of prospects) {
		sumSq += (p.ovr - sampleMean) ** 2;
	}
	const sampleSd = n > 1 ? Math.sqrt(sumSq / (n - 1)) : PRIOR.sd;
	const w = n / (n + PRIOR.n);
	return {
		mean: w * sampleMean + (1 - w) * PRIOR.mean,
		sd: Math.max(4, w * sampleSd + (1 - w) * PRIOR.sd),
	};
};

type ClassContext = {
	classStats: { mean: number; sd: number };
	potStats: { mean: number; sd: number };
	pathwayKeys: Set<string>;
	classRoutes: Map<string, ClassRoute>;
};

const getClassContext = (
	prospects: CollegeProspect[],
	options: GenerateOptions,
): ClassContext => {
	const classProspects = options.classProspects ?? prospects;
	const pathwayKeys = getPathwayKeys(classProspects, options);
	return {
		classStats: getClassStats(classProspects),
		potStats: getClassStats(
			classProspects.map((p) => ({ ...p, ovr: p.pot + POT_PRIOR_SHIFT })),
		),
		pathwayKeys,
		classRoutes: getClassRoutes(classProspects, options, pathwayKeys),
	};
};

/**
 * Where each prospect plays, year by year (his career plan, role changes included), with his talent and ratings each season he played and
 * his place on a team those seasons (teams.ts). No seasons are simulated: this is all a team needs to know about him.
 */
const planProspects = (
	prospects: CollegeProspect[],
	options: GenerateOptions,
	{ classStats, potStats, pathwayKeys, classRoutes }: ClassContext,
) => {
	const { seed, draftYear } = options;
	const priorSeasons = options.priorSeasons ?? true;
	const paths = options.paths ?? true;
	const teams = options.context ?? true;
	return prospects.map((p) => {
		const school = pickSchool(p, options, classStats, pathwayKeys, classRoutes);
		const zClass = clamp((p.ovr - classStats.mean) / classStats.sd, -2.5, 2.5);
		const zPot = clamp((p.pot - potStats.mean) / potStats.sd, -2.5, 2.5);
		const zStock = 0.4 * zClass + 0.6 * zPot;
		const classRng = new Rng(`${seed}|${draftYear}|${p.key}|class`);
		const plan = planCareer(p, school, {
			seed,
			draftYear,
			priorSeasons,
			z: zClass,
			injuries: options.injuries ?? true,
			classIndex: isCollegeSchool(school)
				? getClassIndexForStock(p.age, zStock, classRng.random())
				: getClassIndex(p.age),
			paths,
			route: classRoutes.get(p.key)?.route,
		});
		// Role changes, from a stream of their own
		if (teams && plan.years.length > 0) {
			applyRoleArc(plan, {
				seedBase: `${seed}|${draftYear}|${p.key}`,
				lateness: p.lateness ?? 0,
				z: zClass,
			});
		}
		const years = [];
		const members: TeamMember[] = [];
		for (const year of plan.years) {
			if (!year.played) {
				continue;
			}
			const k = year.yearsBack;
			// A season he came back after was not a declare-worthy one: a prospect whose stock is high now was well short of it then, and grew more since (a steeper development curve)
			let zTalent = zClass - 0.38 * k + year.zShift;
			let stayLag = 0;
			if (k > 0 && year.level === "ncaa" && zTalent > STAY_CAP) {
				const excess = zTalent - STAY_CAP;
				zTalent = STAY_CAP + 0.25 * excess;
				stayLag = Math.min(8, 3 * excess);
			}
			const ratings = lagRatings(
				backProject(p.ratings, k, p.age),
				year.lag + stayLag,
			);
			years.push({ year, zTalent, ratings });
			if (teams && !p.linked && isTeamSchool(year.school)) {
				const expected = expectedRole({
					ratings,
					zTalent,
					classIndex: year.classIndex,
					gameMinutes: year.gameMinutes,
					mpgShift: year.mpgShift,
					usageShift: year.usageShift,
				});
				// Rounded as they are stored (career.ts tz, xm, xu), so a stored season and a planned one are the same teammate
				year.tz = Math.round(100 * zTalent) / 100;
				year.xm = Math.round(10 * expected.mpg) / 10;
				year.xu = Math.round(1000 * expected.usg) / 1000;
				members.push({
					key: p.key,
					draftYear,
					school: year.school,
					season: year.season,
					z: year.tz,
					pos: p.pos,
					mpg: year.xm,
					usg: year.xu,
				});
			}
		}
		return { p, school, plan, years, members };
	});
};

/**
 * A class's prospects on teams, season by season (class-aware teams), as generateCollegeClass with the same options would place them,
 * without simulating anything: for another class's generation to see who its prospects' teammates are.
 */
export const planClassMembers = (
	prospects: CollegeProspect[],
	options: GenerateOptions,
): TeamMember[] =>
	planProspects(
		prospects,
		{ ...options, context: true },
		getClassContext(prospects, options),
	).flatMap((x) => x.members.map((m) => ({ ...m, locked: true })));

/**
 * College seasons and honors for a draft class. Pure and deterministic: the same prospects, seed and options always give the same output. Nothing about a prospect's pro ratings is read back or changed.
 */
export const generateCollegeClass = (
	prospects: CollegeProspect[],
	options: GenerateOptions,
): CollegeResult[] => {
	const { seed, draftYear } = options;
	const noise = clamp(options.noise ?? 1, 0, 3);
	const paths = options.paths ?? true;
	const results: (CollegeResult & { pos: string })[] = [];

	const teamIndexes = new Map<string, number>();
	const ncaaSeason = options.ncaaSeason;
	const ncaaEntries: {
		key: string;
		school: string;
		games: ProspectNcaaGame[];
	}[] = [];
	const summaries = new Map<string, CollegeResult["ncaa"]>();

	// Pass 1: every prospect's school and years, so the teams (class-aware teams) are known before any season is played
	const planned = planProspects(
		prospects,
		options,
		getClassContext(prospects, options),
	);

	// Pass 2: teams. His teammates are the class's other prospects and other classes' (options.teamMembers) on the same team that season
	const teams = options.context ?? true;
	const roles = teams
		? getTeamRoles(
				buildRosters([
					...planned.flatMap((x) => x.members),
					...(options.teamMembers ?? []),
				]),
				strengthOfTeam,
			)
		: new Map<string, TeamRole>();

	// Pass 3: the seasons
	for (const { p, school, plan, years: plannedYears } of planned) {
		// Each player has his own stream, so what he gets doesn't depend on who else is in the class
		const rng = new Rng(`${seed}|${draftYear}|${p.key}`);

		// His team in the college season, if it has one
		let team = -1;
		if (ncaaSeason && school && !school.nonCollege) {
			if (!teamIndexes.has(school.name)) {
				teamIndexes.set(school.name, getTeamIndex(ncaaSeason, school.name));
			}
			team = teamIndexes.get(school.name)!;
		}
		const postseason =
			ncaaSeason && team >= 0 ? getTeamPostseason(ncaaSeason, team) : [];

		const seasons: CollegeSeason[] = [];
		// His draft year season ended early: he missed the postseason
		let missedPostseason = false;
		// Oldest first
		for (const { year, zTalent, ratings } of plannedYears) {
			const k = year.yearsBack;
			const draftYearTeam = k === 0 && ncaaSeason && team >= 0;
			if (draftYearTeam && year.gamesCap !== undefined) {
				missedPostseason = true;
			}
			// Class-aware teams: the team season he played in (a team, not a league of clubs), its games and pace shared with his teammates
			const proEnv = getLeagueEnv(year.school);
			const role = roles.get(`${p.key}|${year.season}`);
			let teamGames = year.teamGames;
			let pace: number | undefined;
			if (teams && !p.linked && !proEnv && isTeamSchool(year.school)) {
				const teamSeason = getTeamSeason(year.school, year.season);
				pace = teamSeason.pace;
				year.pace = pace;
				// Below Division I, seasons run a few games shorter
				teamGames =
					options.teamGames?.get(teamKey(year.school, year.season)) ??
					(COLLEGES[year.school]
						? teamSeason.games
						: Math.min(LOWER_MAX_GAMES, teamSeason.games));
			}
			const mpgShift = year.mpgShift + (role?.mpgShift ?? 0);
			const usageShift = year.usageShift + (role?.usageShift ?? 0);
			seasons.push(
				simulateSeason({
					season: draftYear - k,
					rng,
					ratings,
					zTalent,
					classIndex: year.classIndex,
					school: year.school,
					conference: year.conference,
					strength: year.strength,
					gameMinutes: year.gameMinutes,
					noise,
					pos: p.pos,
					proEnv,
					age: p.age - k,
					...(teams ? { sos: true } : {}),
					...(mpgShift !== 0 ? { mpgShift } : {}),
					...(usageShift !== 0 ? { usageShift } : {}),
					...(year.gamesCap !== undefined ? { gamesCap: year.gamesCap } : {}),
					...(year.injuryGames !== undefined
						? { injuryGames: year.injuryGames }
						: {}),
					...(teamGames !== undefined ? { teamGames } : {}),
					...(pace !== undefined ? { pace } : {}),
					...(year.ramp !== undefined ? { ramp: year.ramp } : {}),
					...(draftYearTeam
						? {
								teamGames:
									ncaaSeason.teams[team]!.w + ncaaSeason.teams[team]!.l,
								postseasonGames: postseason.length,
								confGames:
									ncaaSeason.teams[team]!.confW + ncaaSeason.teams[team]!.confL,
							}
						: {}),
				}),
			);
			// The games a mid-season injury actually cost him (a season-ending one keeps 0: the rest of the season, which depends on how
			// many games his team played)
			if (year.injury && !year.injury.ended) {
				const sim = seasons.at(-1)!;
				year.injury.games = Math.min(
					year.injury.games,
					Math.max(0, sim.teamGames - (sim.stats.gp ?? 0)),
				);
				if (year.injury.games === 0) {
					delete year.injury;
				}
			}
		}

		if (ncaaSeason && team >= 0 && school) {
			const last = seasons.at(-1);
			const boxes = last?.postseasonBoxes ?? [];
			const games = missedPostseason
				? []
				: postseason.map(({ event, round, game }, i) =>
						toGameLine(ncaaSeason, team, event, round, game, boxes[i]),
					);
			const splits = last?.splits;
			if (last) {
				delete last.postseasonBoxes;
				delete last.splits;
			}
			summaries.set(p.key, {
				...getTeamSummary(ncaaSeason, team, games),
				...(splits ? { splits } : {}),
			});
			if (!missedPostseason) {
				ncaaEntries.push({ key: p.key, school: school.name, games });
			}
		}

		results.push({
			key: p.key,
			school: school && !school.idle ? school.name : p.college,
			seasons,
			honors: [],
			pos: p.pos,
			...(plan.years.length > 0 ? { career: toCareer(plan) } : {}),
		});
	}

	// One stream for the class level honors (electorates), seeded so it doesn't depend on class order
	const honorsRng = new Rng(`${seed}|${draftYear}|honors`);
	const honors = getHonors(results, honorsRng);
	// Junior college honors, against fixed bars like the college ones
	for (const result of results) {
		for (const season of result.seasons) {
			// Division II and NAIA seasons (preDraftPaths) the same way
			const lower = getLowerLevel(season.school);
			const small =
				lower === "dii" || lower === "naia"
					? lower === "dii"
						? "Division II"
						: "NAIA"
					: undefined;
			if (
				!(isJuco(season.school) || (paths && small)) ||
				(season.stats.gp ?? 0) < 14
			) {
				continue;
			}
			const org = small ?? "NJCAA";
			const type =
				season.score >= JUCO_BARS.allAmerican
					? `${org} All-American`
					: season.score >= JUCO_BARS.allRegion
						? `${org} All-Region`
						: undefined;
			if (type) {
				const list = honors.get(result.key) ?? [];
				list.push({
					season: season.season,
					type: `${COLLEGE_AWARD_PREFIX}${type}`,
				});
				list.sort((a, b) => a.season - b.season);
				honors.set(result.key, list);
			}
		}
	}
	// Youth national team honors (preDraftPaths), each from his own stream
	if (paths) {
		const bornLocs = new Map(prospects.map((p) => [p.key, p.bornLoc]));
		for (const result of results) {
			const youth = getYouthHonors(
				result.seasons,
				getRegion(bornLocs.get(result.key) ?? ""),
				new Rng(`${seed}|${draftYear}|${result.key}|youth`),
			);
			if (youth.length > 0) {
				const list = honors.get(result.key) ?? [];
				list.push(...youth);
				list.sort((a, b) => a.season - b.season);
				honors.set(result.key, list);
			}
		}
	}
	if (ncaaSeason) {
		for (const [key, types] of getTourneyHonors(ncaaSeason, ncaaEntries)) {
			const list = honors.get(key) ?? [];
			for (const type of types) {
				list.push({
					season: draftYear,
					type: `${COLLEGE_AWARD_PREFIX}${type}`,
				});
			}
			honors.set(key, list);
		}
	}
	return results.map(({ pos: _pos, ...result }) => {
		const ncaa = summaries.get(result.key);
		return {
			...result,
			honors: honors.get(result.key) ?? [],
			...(ncaa ? { ncaa } : {}),
		};
	});
};

/**
 * Where a prospect plays: his college, or for a blank college (with fillBlankColleges) a destination drawn from his own stream, so the same prospect always gets the same school. undefined for no school.
 */
const pickSchool = (
	p: CollegeProspect,
	options: GenerateOptions,
	classStats: { mean: number; sd: number },
	// Prospects of the class in the pro pathway program (getPathwayKeys)
	pathwayKeys?: Set<string>,
	// Prospects of the class with a class route (getClassRoutes)
	classRoutes?: Map<string, ClassRoute>,
): School | undefined => {
	if (pathwayKeys?.has(p.key) && !p.fixedSchool) {
		return getSchool(PATHWAY_TEAM);
	}
	const classRoute = classRoutes?.get(p.key);
	if (classRoute && !p.fixedSchool) {
		return getSchool(classRoute.league);
	}
	const paths = options.paths ?? true;
	// A blank college filled in with the pro pathway program when his stats were made last time is blank again: whether he is in it depends on the seed
	if (p.college !== "" && p.college !== PATHWAY_TEAM) {
		// A BBGM college name for a school known here by another one (preDraftPaths)
		const name = (paths ? COLLEGE_ALIASES[p.college] : undefined) ?? p.college;
		return getSchool(name) ?? unknownSchool(p.college);
	}
	if (options.fillBlankColleges ?? true) {
		// The school is drawn from its own stream, so a school that was filled in earlier (and saved as his college) gives the same seasons as drawing it again
		const schoolRng = new Rng(
			`${options.seed}|${options.draftYear}|${p.key}|school`,
		);
		const name = pickBlankDestination(
			p.bornLoc,
			schoolRng,
			clamp((p.ovr - classStats.mean) / classStats.sd, -2.5, 2.5),
			paths,
		);
		return getSchool(name);
	}
};

/**
 * The class's prospects in the pro pathway program (preDraftPaths), by key: a few elite high school prospects (North Americans young enough to be college freshmen, headed to a Division I school, among the best fifth of the class by draft stock) skip college for one season with a pro development team. 0-2 a class (about 0.8 on average), picked nearly evenly from the elite pool, so most top prospects still go to college. Drawn from a stream of the class's own and read off the whole class, so the same class and seed always give the same players, whichever of them are being generated.
 */
export const getPathwayKeys = (
	classProspects: CollegeProspect[],
	options: GenerateOptions,
): Set<string> => {
	const keys = new Set<string>();
	if (!(options.paths ?? true) || classProspects.length === 0) {
		return keys;
	}
	const classStats = getClassStats(classProspects);
	const potStats = getClassStats(
		classProspects.map((p) => ({ ...p, ovr: p.pot + POT_PRIOR_SHIFT })),
	);
	const candidates: { key: string; zStock: number }[] = [];
	for (const p of classProspects) {
		const region = getRegion(p.bornLoc);
		if (
			getClassIndex(p.age) !== 0 ||
			(region !== "usa" && region !== "canada") ||
			p.injuryHistory ||
			p.fixedSchool
		) {
			continue;
		}
		const school = pickSchool(p, options, classStats);
		if (!school || school.nonCollege || !COLLEGES[school.name]) {
			continue;
		}
		const zClass = clamp((p.ovr - classStats.mean) / classStats.sd, -2.5, 2.5);
		const zPot = clamp(
			(p.pot + POT_PRIOR_SHIFT - potStats.mean) / potStats.sd,
			-2.5,
			2.5,
		);
		const zStock = 0.4 * zClass + 0.6 * zPot;
		if (zStock >= PATHWAY_MIN_STOCK) {
			candidates.push({ key: p.key, zStock });
		}
	}
	candidates.sort((a, b) =>
		b.zStock !== a.zStock ? b.zStock - a.zStock : a.key < b.key ? -1 : 1,
	);
	const pool = candidates.slice(0, PATHWAY_POOL);
	const rng = new Rng(`${options.seed}|${options.draftYear}|pathway`);
	const count = Math.min(
		pool.length,
		rng.weighted(PATHWAY_COUNTS, PATHWAY_COUNT_WEIGHTS),
	);
	// Joining is a choice, not a reward for being the top prospect: the pick is close to even across the elite pool, with only a mild lean
	// toward the best. (Weighted heavily by stock, the class's best freshman joined almost every year, so the top pick nearly always came
	// from the program.) With 0-2 of up to 10 candidates, the class's best joins rarely (under a tenth of the time) when he is eligible.
	for (let i = 0; i < count; i++) {
		const left = pool.filter((x) => !keys.has(x.key));
		const pick = rng.weighted(
			left,
			left.map((x) => Math.exp(PATHWAY_STOCK_LEAN * x.zStock)),
		);
		keys.add(pick.key);
	}
	return keys;
};

export type ClassRoute = { route: "nextStars" | "abroad"; league: string };

// The NBL's Next Stars program (preDraftPaths): how many of a class's elite young prospects spend their draft year in the NBL instead of
// college or their own league (real classes: 0-2 a year), from at most NEXT_STARS_POOL of the best. Not Australians and New Zealanders,
// for whom the NBL is home anyway
const NEXT_STARS_COUNTS = [0, 1, 2];
const NEXT_STARS_COUNT_WEIGHTS = [0.6, 0.32, 0.08];
const NEXT_STARS_POOL = 20;
const NEXT_STARS_MIN_STOCK = 0.3;
// Americans who turn pro abroad out of high school (a handful a decade make the draft): 0 or 1 a class
const ABROAD_COUNTS = [0, 1];
const ABROAD_COUNT_WEIGHTS = [0.85, 0.15];
const ABROAD_STOCK = [-0.2, 1.4];
// Where they go: leagues that sign American teenagers
const ABROAD_LEAGUES = [
	"Israeli Premier League",
	"Italian LBA",
	"Liga ACB",
	"Turkish BSL",
	"Greek Basket League",
	"Chinese CBA",
	"LNB Pro A",
	"Adriatic League",
];
const ABROAD_LEAGUE_WEIGHTS = [3, 2, 1.5, 1.5, 1.5, 1.5, 1, 1];

/**
 * The class's prospects with a route picked with the rest of the class (preDraftPaths), by key: the NBL's Next Stars (0-2 young prospects with high draft stock, more often internationals) and Americans who turned pro abroad out of high school (0-1, a prospect headed to a mid-level role in college). Like the pro pathway program, read off the whole class from streams of the class's own, so the same class and seed always give the same players, whichever of them are being generated, and none of them is in the pro pathway program.
 */
export const getClassRoutes = (
	classProspects: CollegeProspect[],
	options: GenerateOptions,
	pathwayKeys: Set<string>,
): Map<string, ClassRoute> => {
	const routes = new Map<string, ClassRoute>();
	if (!(options.paths ?? true) || classProspects.length === 0) {
		return routes;
	}
	const classStats = getClassStats(classProspects);
	const potStats = getClassStats(
		classProspects.map((p) => ({ ...p, ovr: p.pot + POT_PRIOR_SHIFT })),
	);
	const nextStars: { key: string; zStock: number; na: boolean }[] = [];
	const abroad: { key: string; zStock: number }[] = [];
	for (const p of classProspects) {
		if (
			getClassIndex(p.age) !== 0 ||
			p.injuryHistory ||
			p.fixedSchool ||
			pathwayKeys.has(p.key)
		) {
			continue;
		}
		const region = getRegion(p.bornLoc);
		const school = pickSchool(p, options, classStats);
		if (!school || school.idle) {
			continue;
		}
		const d1 = !school.nonCollege && !!COLLEGES[school.name];
		const zClass = clamp((p.ovr - classStats.mean) / classStats.sd, -2.5, 2.5);
		const zPot = clamp(
			(p.pot + POT_PRIOR_SHIFT - potStats.mean) / potStats.sd,
			-2.5,
			2.5,
		);
		const zStock = 0.4 * zClass + 0.6 * zPot;
		// A prospect with a story keeps it, and the school it is about (stories also style his sub-ratings): the same story draw
		// generateCollegeClass makes for him
		const seedBase = `${options.seed}|${options.draftYear}|${p.key}`;
		const classIndex = isCollegeSchool(school)
			? getClassIndexForStock(
					p.age,
					0.4 * zClass +
						0.6 * clamp((p.pot - potStats.mean) / potStats.sd, -2.5, 2.5),
					new Rng(`${seedBase}|class`).random(),
				)
			: getClassIndex(p.age);
		if (
			(options.priorSeasons ?? true) &&
			pickStory(p, { z: zClass, classIndex, isNcaa: d1, school }, seedBase)
		) {
			continue;
		}
		const na = region === "usa" || region === "canada";
		if (
			zStock >= NEXT_STARS_MIN_STOCK &&
			region !== "oceania" &&
			school.name !== "NBL" &&
			(d1 || !na)
		) {
			nextStars.push({ key: p.key, zStock, na });
		}
		if (
			region === "usa" &&
			d1 &&
			zStock >= ABROAD_STOCK[0]! &&
			zStock < ABROAD_STOCK[1]!
		) {
			abroad.push({ key: p.key, zStock });
		}
	}
	const byStock = (a: { key: string; zStock: number }, b: typeof a) =>
		b.zStock !== a.zStock ? b.zStock - a.zStock : a.key < b.key ? -1 : 1;

	const rng = new Rng(`${options.seed}|${options.draftYear}|nextStars`);
	const pool = nextStars.sort(byStock).slice(0, NEXT_STARS_POOL);
	const count = Math.min(
		pool.length,
		rng.weighted(NEXT_STARS_COUNTS, NEXT_STARS_COUNT_WEIGHTS),
	);
	for (let i = 0; i < count; i++) {
		const left = pool.filter((x) => !routes.has(x.key));
		// Most Next Stars are internationals
		const pick = rng.weighted(
			left,
			left.map((x) => (x.na ? 0.4 : 1)),
		);
		routes.set(pick.key, { route: "nextStars", league: "NBL" });
	}

	const abroadRng = new Rng(`${options.seed}|${options.draftYear}|abroad`);
	const abroadPool = abroad.filter((x) => !routes.has(x.key)).sort(byStock);
	const numAbroad = Math.min(
		abroadPool.length,
		abroadRng.weighted(ABROAD_COUNTS, ABROAD_COUNT_WEIGHTS),
	);
	for (let i = 0; i < numAbroad; i++) {
		const left = abroadPool.filter((x) => !routes.has(x.key));
		const pick = left[Math.floor(abroadRng.random() * left.length)]!;
		routes.set(pick.key, {
			route: "abroad",
			league: abroadRng.weighted(ABROAD_LEAGUES, ABROAD_LEAGUE_WEIGHTS),
		});
	}
	return routes;
};

/**
 * The schools generateCollegeClass will give these prospects (with the same options), by key, for building the college season before the stats. Only NCAA schools are included.
 */
export const getNcaaSchools = (
	prospects: CollegeProspect[],
	options: GenerateOptions,
) => {
	const classStats = getClassStats(options.classProspects ?? prospects);
	const pathwayKeys = getPathwayKeys(
		options.classProspects ?? prospects,
		options,
	);
	const classRoutes = getClassRoutes(
		options.classProspects ?? prospects,
		options,
		pathwayKeys,
	);
	const output = new Map<string, string>();
	for (const p of prospects) {
		const school = pickSchool(p, options, classStats, pathwayKeys, classRoutes);
		if (school && !school.nonCollege && !school.idle) {
			output.set(p.key, school.name);
		}
	}
	return output;
};

const toGameLine = (
	season: NcaaSeason,
	team: number,
	event: ProspectNcaaGame["event"],
	round: string,
	game: NcaaSeason["tournament"]["final"],
	box: GameBox | undefined,
): ProspectNcaaGame => {
	const home = game.a === team;
	const opp = home ? game.b : game.a;
	const tm = home ? game.scoreA : game.scoreB;
	const oppScore = home ? game.scoreB : game.scoreA;
	const b = box ?? {
		min: 0,
		pts: 0,
		orb: 0,
		drb: 0,
		ast: 0,
		stl: 0,
		blk: 0,
		tov: 0,
		fg: 0,
		fga: 0,
		tp: 0,
		tpa: 0,
		ft: 0,
		fta: 0,
		pf: 0,
	};
	return {
		event,
		round,
		opp: season.teams[opp]!.school,
		...(event !== "conf"
			? {
					seed: home ? game.seedA : game.seedB,
					oppSeed: home ? game.seedB : game.seedA,
				}
			: {}),
		tm,
		oppScore,
		ot: game.ot,
		won: tm > oppScore,
		min: Math.round(b.min),
		pts: b.pts,
		trb: b.orb + b.drb,
		ast: b.ast,
		stl: b.stl,
		blk: b.blk,
		tov: b.tov,
		fg: b.fg,
		fga: b.fga,
		tp: b.tp,
		tpa: b.tpa,
		ft: b.ft,
		fta: b.fta,
		gmsc: Math.round(gameScore(b) * 10) / 10,
	};
};
