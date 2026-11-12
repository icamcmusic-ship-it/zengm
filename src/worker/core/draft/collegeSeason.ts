import {
	NCAA_SEASON_VERSION,
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
import { g } from "../../util/index.ts";
import { toCollegeProspect } from "./generateCollegeStats.ts";
import { getClassShape } from "./classShape.ts";
import type { Player } from "../../../common/types.ts";

/**
 * The college season (conference tournaments, AP Top 25, March Madness) of a draft class's draft year. Nothing about it is stored except on the prospects: each prospect at an NCAA school gets p.collegeSeason with the season's seed, his school and how much he adds to his team (boost), so the whole season can be rebuilt exactly from the class (getCollegeSeason), plus a summary of his team's season for his player page.
 */

export type ClassNcaaSeason = {
	season: NcaaSeason;
	seed: string;
	// Version of the season simulation, stored on the prospects so the season is rebuilt the way it was made
	version: number;
	// The class's shape (Draft Class Shapes), version 4+
	classShape?: string;
	// pid -> what he adds to his team
	boosts: Map<number, number>;
	// Prospects whose stats are not being generated but who are on a team (an imported class with real stats), to get a marker too
	others: Player[];
};

// Age and position, for the seasons that favor one kind of player (only version 3 seasons use them)
const leanInfo = (p: Player, draftYear: number) => ({
	age: draftYear - p.born.year,
	pos: p.collegeSeason?.pos ?? p.ratings.at(-1)?.pos,
});

/**
 * reuse: when only some prospects get stats (onlyMissing), keep the class's existing season if there is one, so prospects who already have stats stay consistent with it. New prospects join their school's team without changing it. "all": the targets' own stored season counts too (they keep their place and boost), for remaking stats without changing the season (upgradeCollegeStats).
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
	reuse: boolean | "all";
}): Promise<ClassNcaaSeason> => {
	const targetPids = new Set(targets.map((p) => p.pid));
	const schools = getNcaaSchools(targetProspects, options);
	const contributions: NcaaContribution[] = [];
	const boosts = new Map<number, number>();
	const others: Player[] = [];

	const marked = reuse
		? (await idb.merged.players.getAll({ draftYear })).filter(
				(p) =>
					(reuse === "all" || !targetPids.has(p.pid)) &&
					p.collegeSeason?.season === draftYear,
			)
		: [];

	let seasonSeed = seed;
	let version = NCAA_SEASON_VERSION;
	let classShape = getClassShape(classPlayers)?.key as string | undefined;
	if (marked.length > 0) {
		seasonSeed = marked[0]!.collegeSeason!.seed;
		version = marked[0]!.collegeSeason!.v ?? 1;
		classShape = marked[0]!.collegeSeason!.cs;
		for (const p of marked) {
			contributions.push({
				key: String(p.pid),
				school: p.collegeSeason!.school,
				boost: p.collegeSeason!.boost,
				...leanInfo(p, draftYear),
			});
		}
		for (const p of targets) {
			boosts.set(
				p.pid,
				reuse === "all" && p.collegeSeason?.season === draftYear
					? p.collegeSeason.boost
					: 0,
			);
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
				contributions.push({
					key: String(p.pid),
					school,
					boost,
					...leanInfo(p, draftYear),
				});
			}
		}
		for (const p of classPlayers) {
			if (!targetPids.has(p.pid) && p.college && COLLEGES[p.college]) {
				const boost = boostFor(p);
				boosts.set(p.pid, boost);
				contributions.push({
					key: String(p.pid),
					school: p.college,
					boost,
					...leanInfo(p, draftYear),
				});
				others.push(p);
			}
		}
	}

	return {
		season: simulateNcaaSeason({
			seed: seasonSeed,
			season: draftYear,
			contributions,
			version,
			classShape: version >= 4 ? classShape : undefined,
		}),
		seed: seasonSeed,
		version,
		...(version >= 4 && classShape !== undefined ? { classShape } : {}),
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
				...(ncaa.version > 1 ? { v: ncaa.version } : {}),
				...(ncaa.version >= 3 ? { pos: leanInfo(p, draftYear).pos } : {}),
				...(ncaa.classShape !== undefined ? { cs: ncaa.classShape } : {}),
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
				...(ncaa.version > 1 ? { v: ncaa.version } : {}),
				...(ncaa.version >= 3 ? { pos: leanInfo(p, draftYear).pos } : {}),
				...(ncaa.classShape !== undefined ? { cs: ncaa.classShape } : {}),
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
	// Seasons stored before versions are version 1, which plays the games exactly as they were played then
	const version = members[0]!.collegeSeason!.v ?? 1;
	const contributions = members.map((p) => ({
		key: String(p.pid),
		school: p.collegeSeason!.school,
		boost: p.collegeSeason!.boost,
		...(version >= 3 ? leanInfo(p, draftYear) : {}),
	}));

	// Rebuilding takes a while (every game, 19 polls, two tournaments) and the pages that show it reload often, so keep the last few. The key is everything the season is made from
	const key = JSON.stringify([
		g.get("lid"),
		draftYear,
		seed,
		version,
		members[0]!.collegeSeason!.cs ?? "",
		contributions
			.map((c) => `${c.key}|${c.school}|${c.boost}|${c.age}|${c.pos}`)
			.sort()
			.join(","),
	]);
	let season = seasonCache.get(key);
	if (season) {
		// Most recently used last
		seasonCache.delete(key);
	} else {
		season = simulateNcaaSeason({
			seed,
			season: draftYear,
			contributions,
			version,
			classShape: version >= 4 ? members[0]!.collegeSeason!.cs : undefined,
		});
	}
	seasonCache.set(key, season);
	if (seasonCache.size > SEASON_CACHE_SIZE) {
		seasonCache.delete(seasonCache.keys().next().value!);
	}
	return { season, players: members };
};

const SEASON_CACHE_SIZE = 8;
const seasonCache = new Map<string, NcaaSeason>();
