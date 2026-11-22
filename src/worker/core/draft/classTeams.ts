import { PLAYER } from "../../../common/constants.ts";
import {
	getPreDraftStats,
	hasPreDraftStats,
} from "../../../common/preDraft.ts";
import {
	getClassStats,
	type CollegeProspect,
} from "../../../common/collegeStats/index.ts";
import { planClassMembers } from "../../../common/collegeStats/generate.ts";
import {
	isTeamSchool,
	teamKey,
	type TeamMember,
} from "../../../common/collegeStats/teams.ts";
import { clamp } from "../../../common/collegeStats/rng.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { getCollegeSeason } from "./collegeSeason.ts";

/**
 * Class-aware teams in the game (common/collegeStats/teams.ts): who else was on a prospect's teams. Rosters are never stored. They are
 * rebuilt from the players' careers (p.preDraftCareer, kept on drafted players too), so existing leagues get them with nothing to
 * migrate, and for a class whose stats are not made yet from its plan (the seed the class will get).
 */

// How far apart two classes can be and still share a team season: a fifth-year senior and a freshman
const MAX_CLASS_GAP = 5;

// Ovr in his draft year: the one he was drafted with, otherwise his current one (prospects don't develop before the draft)
const draftOvr = (p: Player) =>
	p.tid === PLAYER.UNDRAFTED || p.draft.ovr === undefined
		? (p.ratings.at(-1)?.ovr ?? 40)
		: p.draft.ovr;

/**
 * A player's team seasons as stored (his career and his stats rows), for another class's generation: his talent that season on the
 * class-relative scale, and the minutes and usage he did play. Empty for a player without a generated career.
 */
export const storedMembers = (
	p: Player,
	classStats: { mean: number; sd: number },
): TeamMember[] => {
	const career = p.preDraftCareer;
	if (!career) {
		return [];
	}
	const rows = getPreDraftStats(p);
	const zClass = clamp(
		(draftOvr(p) - classStats.mean) / classStats.sd,
		-2.5,
		2.5,
	);
	const pos = p.ratings.at(-1)?.pos ?? "F";
	const out: TeamMember[] = [];
	for (const year of career.years) {
		if (!isTeamSchool(year.school)) {
			continue;
		}
		const row = rows.find(
			(r) => r.season === year.season && r.teamName === year.school,
		) as any;
		if (!row || !(row.gp > 0)) {
			continue;
		}
		// As his class's generation saw him; a career made before class-aware teams: from his ovr and what he played
		out.push({
			key: String(p.pid),
			draftYear: p.draft.year,
			school: year.school,
			season: year.season,
			z: year.tz ?? zClass - 0.38 * (p.draft.year - year.season),
			pos,
			mpg: year.xm ?? row.min / row.gp,
			usg: year.xu ?? (row.usgp ?? 20) / 100,
			locked: true,
		});
	}
	return out;
};

/**
 * Everything generating a class's stats needs to know about its prospects' teammates from other classes: their team seasons (stored for a
 * class with stats, planned for one without), and the games of team seasons another class's college season already played.
 * `toProspect` is generateCollegeStats' own conversion, `paths` its preDraftPaths switch.
 */
export const getClassTeamContext = async ({
	draftYear,
	targets,
	toProspect,
	paths,
}: {
	draftYear: number;
	// The prospects whose stats are being made: the rest of their class with stats already are their teammates as they are
	targets: Set<number>;
	toProspect: (p: Player, draftYear: number) => CollegeProspect;
	paths: boolean;
}) => {
	const byYear = new Map<number, Player[]>();
	const cached = await idb.cache.players.getAll();
	for (const p of cached) {
		const year = p.draft.year;
		if (
			Math.abs(year - draftYear) > MAX_CLASS_GAP ||
			(year === draftYear && targets.has(p.pid))
		) {
			continue;
		}
		let list = byYear.get(year);
		if (!list) {
			list = [];
			byYear.set(year, list);
		}
		list.push(p);
	}

	const teamMembers: TeamMember[] = [];
	for (const [year, players] of byYear) {
		const prospects = players.filter((p) => p.tid === PLAYER.UNDRAFTED);
		const classStats = getClassStats(
			players.map((p) => ({ ovr: draftOvr(p) }) as CollegeProspect),
		);
		const unstored: Player[] = [];
		for (const p of players) {
			if (p.preDraftCareer) {
				teamMembers.push(...storedMembers(p, classStats));
			} else if (
				p.tid === PLAYER.UNDRAFTED &&
				p.ratings.length > 0 &&
				// Imported stats (a linked college league's, a real class's) are his teams: no plan
				!p.linkedCollege &&
				!hasPreDraftStats(p)
			) {
				unstored.push(p);
			}
		}
		// A class whose stats are not made yet: where its prospects will be, with the seed new classes get
		if (unstored.length > 0 && year !== draftYear) {
			const all = prospects
				.filter((p) => p.ratings.length > 0)
				.map((p) => toProspect(p, year));
			const unstoredKeys = new Set(unstored.map((p) => String(p.pid)));
			const members = planClassMembers(
				all.filter((x) => unstoredKeys.has(x.key)),
				{
					seed: `${g.get("lid")}-${year}-auto`,
					draftYear: year,
					paths,
					fillBlankColleges: true,
					injuries: featureOn("preDraftMedicals"),
					classProspects: all,
				},
			);
			teamMembers.push(...members);
		}
	}

	// Team seasons another class's college season played (its draft year, in the window this class's prospects played in)
	const teamGames = new Map<string, number>();
	if (featureOn("collegeSeason")) {
		for (let season = draftYear - MAX_CLASS_GAP; season < draftYear; season++) {
			// From the players in the cache: a class whose players have all retired is too long ago to matter
			const built = await getCollegeSeason(
				season,
				cached.filter((p) => p.draft.year === season),
			);
			if (!built) {
				continue;
			}
			for (const t of built.season.teams) {
				teamGames.set(teamKey(t.school, season), t.w + t.l);
			}
		}
	}

	return { teamMembers, teamGames };
};

export type Teammate = {
	pid: number;
	name: string;
	draftYear: number;
	// Drafted: his pick; otherwise undefined (an upcoming prospect, or undrafted)
	draft?: { round: number; pick: number; abbrev: string };
	prospect: boolean;
	pos: string;
	ppg: number;
	mpg: number;
	gp: number;
};

/**
 * His teammates from every draft class (other prospects, drafted or upcoming, on the same team in the same season), season by season,
 * read off the players' stored careers. Players in the cache only (not retired ones).
 */
export const getTeammates = async (pRaw: Player) => {
	const career = pRaw.preDraftCareer;
	const out = new Map<number, Teammate[]>();
	if (!career) {
		return out;
	}
	const wanted = new Map<string, number>();
	for (const year of career.years) {
		if (
			year.status !== "redshirt" &&
			year.status !== "gap" &&
			isTeamSchool(year.school)
		) {
			wanted.set(teamKey(year.school, year.season), year.season);
		}
	}
	if (wanted.size === 0) {
		return out;
	}
	const teamInfoCache = g.get("teamInfoCache");
	for (const p of await idb.cache.players.getAll()) {
		if (p.pid === pRaw.pid || !p.preDraftCareer) {
			continue;
		}
		for (const year of p.preDraftCareer.years) {
			const season = wanted.get(teamKey(year.school, year.season));
			if (
				season === undefined ||
				year.status === "redshirt" ||
				year.status === "gap"
			) {
				continue;
			}
			const row = getPreDraftStats(p).find(
				(r) => r.season === season && r.teamName === year.school,
			) as any;
			const gp = row?.gp ?? 0;
			const drafted = p.tid !== PLAYER.UNDRAFTED && p.draft.round > 0;
			const list = out.get(season) ?? [];
			list.push({
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				draftYear: p.draft.year,
				draft: drafted
					? {
							round: p.draft.round,
							pick: p.draft.pick,
							abbrev: teamInfoCache[p.draft.tid]?.abbrev ?? "",
						}
					: undefined,
				prospect: p.tid === PLAYER.UNDRAFTED,
				pos: p.ratings.at(-1)?.pos ?? "",
				ppg: gp > 0 ? row.pts / gp : 0,
				mpg: gp > 0 ? row.min / gp : 0,
				gp,
			});
			out.set(season, list);
		}
	}
	for (const list of out.values()) {
		list.sort((a, b) => b.ppg - a.ppg);
	}
	return out;
};
