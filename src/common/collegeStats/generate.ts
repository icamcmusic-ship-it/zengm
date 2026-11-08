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
import type { CollegeProspect, CollegeResult, CollegeSeason } from "./types.ts";

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

const getClassStats = (prospects: CollegeProspect[]) => {
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
	const fillBlank = options.fillBlankColleges ?? true;
	const classStats = getClassStats(prospects);

	const results: (CollegeResult & { pos: string })[] = [];

	for (const p of prospects) {
		// Each player has his own stream, so what he gets doesn't depend on who else is in the class
		// The school is drawn from its own stream, so a school that was filled in earlier (and saved as his college) gives the same seasons as drawing it again
		const schoolRng = new Rng(`${seed}|${draftYear}|${p.key}|school`);
		const rng = new Rng(`${seed}|${draftYear}|${p.key}`);

		let school: School | undefined;
		if (p.college !== "") {
			school = getSchool(p.college) ?? unknownSchool(p.college);
		} else if (fillBlank) {
			const name = pickBlankDestination(
				p.bornLoc,
				schoolRng,
				clamp((p.ovr - classStats.mean) / classStats.sd, -2.5, 2.5),
			);
			school = getSchool(name);
		}

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
					}),
				);
			}
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
	return results.map(({ pos: _pos, ...result }) => ({
		...result,
		honors: honors.get(result.key) ?? [],
	}));
};
