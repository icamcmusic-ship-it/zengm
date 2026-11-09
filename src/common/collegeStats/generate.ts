import { backProject, simulateSeason } from "./season.ts";
import { getHonors } from "./honors.ts";
import {
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
import { gameScore } from "./season.ts";
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
};

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

/**
 * College seasons and honors for a draft class. Pure and deterministic: the same prospects, seed and options always give the same output. Nothing about a prospect's pro ratings is read back or changed.
 */
export const generateCollegeClass = (
	prospects: CollegeProspect[],
	options: GenerateOptions,
): CollegeResult[] => {
	const { seed, draftYear } = options;
	const priorSeasons = options.priorSeasons ?? true;
	const noise = clamp(options.noise ?? 1, 0, 3);
	const classStats = getClassStats(prospects);

	const results: (CollegeResult & { pos: string })[] = [];

	const teamIndexes = new Map<string, number>();
	const ncaaSeason = options.ncaaSeason;
	const ncaaEntries: {
		key: string;
		school: string;
		games: ProspectNcaaGame[];
	}[] = [];
	const summaries = new Map<string, CollegeResult["ncaa"]>();

	for (const p of prospects) {
		// Each player has his own stream, so what he gets doesn't depend on who else is in the class
		const rng = new Rng(`${seed}|${draftYear}|${p.key}`);
		const school = pickSchool(p, options, classStats);

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
		if (school && !school.idle) {
			const classIndex = getClassIndex(p.age);
			const numSeasons = priorSeasons ? classIndex + 1 : 1;
			// Oldest first
			for (let k = numSeasons - 1; k >= 0; k--) {
				const ratings = backProject(p.ratings, k, p.age);
				const zTalent =
					clamp((p.ovr - classStats.mean) / classStats.sd, -2.5, 2.5) -
					0.38 * k;
				seasons.push(
					simulateSeason({
						season: draftYear - k,
						rng,
						ratings,
						zTalent,
						classIndex: classIndex - k,
						school: school.name,
						conference: school.conference,
						strength: school.strength,
						gameMinutes: school.gameMinutes,
						noise,
						pos: p.pos,
						proEnv: getLeagueEnv(school.name),
						age: p.age - k,
						...(k === 0 && ncaaSeason && team >= 0
							? {
									teamGames:
										ncaaSeason.teams[team]!.w + ncaaSeason.teams[team]!.l,
									postseasonGames: postseason.length,
								}
							: {}),
					}),
				);
			}
		}

		if (ncaaSeason && team >= 0 && school) {
			const last = seasons.at(-1);
			const boxes = last?.postseasonBoxes ?? [];
			const games = postseason.map(({ event, round, game }, i) =>
				toGameLine(ncaaSeason, team, event, round, game, boxes[i]),
			);
			if (last) {
				delete last.postseasonBoxes;
			}
			summaries.set(p.key, getTeamSummary(ncaaSeason, team, games));
			ncaaEntries.push({ key: p.key, school: school.name, games });
		}

		results.push({
			key: p.key,
			school: school && !school.idle ? school.name : p.college,
			seasons,
			honors: [],
			pos: p.pos,
		});
	}

	// One stream for the class level honors (electorates), seeded so it doesn't depend on class order
	const honorsRng = new Rng(`${seed}|${draftYear}|honors`);
	const honors = getHonors(results, honorsRng);
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
): School | undefined => {
	if (p.college !== "") {
		return getSchool(p.college) ?? unknownSchool(p.college);
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
		);
		return getSchool(name);
	}
};

/**
 * The schools generateCollegeClass will give these prospects (with the same options), by key, for building the college season before the stats. Only NCAA schools are included.
 */
export const getNcaaSchools = (
	prospects: CollegeProspect[],
	options: GenerateOptions,
) => {
	const classStats = getClassStats(prospects);
	const output = new Map<string, string>();
	for (const p of prospects) {
		const school = pickSchool(p, options, classStats);
		if (school && !school.nonCollege && !school.idle) {
			output.set(p.key, school.name);
		}
	}
	return output;
};

const toGameLine = (
	season: NcaaSeason,
	team: number,
	event: "conf" | "ncaa",
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
		...(event === "ncaa"
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
