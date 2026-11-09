import {
	getClassStats,
	getNcaaSchools,
	getProspectBoost,
	getTeamIndex,
	getTeamSummary,
	simulateNcaaSeason,
	type CollegeProspect,
	type CollegeResult,
	type GenerateOptions,
	type NcaaContribution,
	type NcaaSeason,
} from "../../../common/collegeStats/index.ts";
import { COLLEGES } from "../../../common/collegeStats/colleges.ts";
import { clamp } from "../../../common/collegeStats/rng.ts";
import { idb } from "../../db/index.ts";
import { toCollegeProspect } from "./generateCollegeStats.ts";
import type { Player } from "../../../common/types.ts";

/**
 * The college season (conference tournaments, AP Top 25, March Madness) of a draft class's draft year. Nothing about it is stored except on the prospects: each prospect at an NCAA school gets p.collegeSeason with the season's seed, his school and how much he adds to his team (boost), so the whole season can be rebuilt exactly from the class (getCollegeSeason), plus a summary of his team's season for his player page.
 */

export type ClassNcaaSeason = {
	season: NcaaSeason;
	seed: string;
	// pid -> what he adds to his team
	boosts: Map<number, number>;
	// Prospects whose stats are not being generated but who are on a team (an imported class with real stats), to get a marker too
	others: Player[];
};

/**
 * reuse: when only some prospects get stats (onlyMissing), keep the class's existing season if there is one, so prospects who already have stats stay consistent with it. New prospects join their school's team without changing it.
 */
export const buildNcaaSeasonForClass = async ({
	draftYear,
	seed,
	classPlayers,
	targets,
	targetProspects,
	options,
	reuse,
}: {
	draftYear: number;
	seed: string;
	classPlayers: Player[];
	targets: Player[];
	targetProspects: CollegeProspect[];
	options: GenerateOptions;
	reuse: boolean;
}): Promise<ClassNcaaSeason> => {
	const targetPids = new Set(targets.map((p) => p.pid));
	const schools = getNcaaSchools(targetProspects, options);
	const contributions: NcaaContribution[] = [];
	const boosts = new Map<number, number>();
	const others: Player[] = [];

	const marked = reuse
		? (await idb.merged.players.getAll({ draftYear })).filter(
				(p) => !targetPids.has(p.pid) && p.collegeSeason?.season === draftYear,
			)
		: [];

	let seasonSeed = seed;
	if (marked.length > 0) {
		seasonSeed = marked[0]!.collegeSeason!.seed;
		for (const p of marked) {
			contributions.push({
				key: String(p.pid),
				school: p.collegeSeason!.school,
				boost: p.collegeSeason!.boost,
			});
		}
		for (const p of targets) {
			boosts.set(p.pid, 0);
		}
	} else {
		const classStats = getClassStats(
			classPlayers.map((p) => toCollegeProspect(p, draftYear)),
		);
		const boostFor = (p: Player) =>
			getProspectBoost(
				clamp(
					(toCollegeProspect(p, draftYear).ovr - classStats.mean) /
						classStats.sd,
					-2.5,
					2.5,
				),
			);
		for (const p of targets) {
			const school = schools.get(String(p.pid));
			if (school !== undefined && COLLEGES[school]) {
				const boost = boostFor(p);
				boosts.set(p.pid, boost);
				contributions.push({ key: String(p.pid), school, boost });
			}
		}
		for (const p of classPlayers) {
			if (!targetPids.has(p.pid) && p.college && COLLEGES[p.college]) {
				const boost = boostFor(p);
				boosts.set(p.pid, boost);
				contributions.push({ key: String(p.pid), school: p.college, boost });
				others.push(p);
			}
		}
	}

	return {
		season: simulateNcaaSeason({
			seed: seasonSeed,
			season: draftYear,
			contributions,
		}),
		seed: seasonSeed,
		boosts,
		others,
	};
};

export const storeCollegeSeasonMarkers = async ({
	draftYear,
	ncaa,
	targets,
	results,
}: {
	draftYear: number;
	ncaa: ClassNcaaSeason | undefined;
	targets: Player[];
	results: Map<string, CollegeResult>;
}) => {
	for (const p of targets) {
		const summary = results.get(String(p.pid))?.ncaa;
		if (ncaa && summary) {
			p.collegeSeason = {
				season: draftYear,
				seed: ncaa.seed,
				school: summary.school,
				boost: ncaa.boosts.get(p.pid) ?? 0,
				summary,
			};
		} else if (p.collegeSeason) {
			delete p.collegeSeason;
		} else {
			continue;
		}
		await idb.cache.players.put(p);
	}

	if (ncaa) {
		for (const p of ncaa.others) {
			const team = getTeamIndex(ncaa.season, p.college);
			if (team < 0) {
				continue;
			}
			p.collegeSeason = {
				season: draftYear,
				seed: ncaa.seed,
				school: p.college,
				boost: ncaa.boosts.get(p.pid) ?? 0,
				summary: getTeamSummary(ncaa.season, team),
			};
			await idb.cache.players.put(p);
		}
	}
};

/**
 * Rebuild the college season of a draft year from the prospects who carry it (drafted or not). undefined if there is none.
 */
export const getCollegeSeason = async (draftYear: number) => {
	const players = (await idb.merged.players.getAll({ draftYear })).filter(
		(p) => p.collegeSeason?.season === draftYear,
	);
	if (players.length === 0) {
		return undefined;
	}
	// Every prospect of a class carries the same seed. If not (a class put together from several), go with the most common one
	const counts = new Map<string, number>();
	for (const p of players) {
		const seed = p.collegeSeason!.seed;
		counts.set(seed, (counts.get(seed) ?? 0) + 1);
	}
	const seed = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
	const members = players.filter((p) => p.collegeSeason!.seed === seed);
	return {
		season: simulateNcaaSeason({
			seed,
			season: draftYear,
			contributions: members.map((p) => ({
				key: String(p.pid),
				school: p.collegeSeason!.school,
				boost: p.collegeSeason!.boost,
			})),
		}),
		players: members,
	};
};
