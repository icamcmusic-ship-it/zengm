import { PLAYER } from "../../../common/constants.ts";
import { getPreDraftStats } from "../../../common/preDraft.ts";
import { getSchool } from "../../../common/collegeStats/colleges.helpers.ts";
import {
	adjustRecruitRank,
	getRecruitPos,
	getRecruiting,
	resolveClassRanks,
	type RankEntry,
} from "../../../common/collegeStats/profile.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";

/**
 * High school recruiting rankings. A ranking is against the rest of a high school class, and the players of one high school class are spread over several draft classes (the freshman of one draft, the sophomore of the next), so ranks are set class by class here: no two players of a high school class share a national rank or a rank at their position.
 *
 * Prospects whose stats were generated with the career model keep their ranking on the player (p.preDraftCareer.recruit), set once when their stats are generated and never moved after. Older players have nothing stored: theirs is derived as it always was, and only bumped to the next free rank when it collides with a player ranked ahead of them.
 */

// His ratings row in his draft year: the last one from before he became a pro
export const draftRatings = (p: Player) =>
	p.ratings.findLast((r) => r.season <= p.draft.year) ??
	(p.tid === PLAYER.UNDRAFTED ? p.ratings.at(-1) : undefined);

export type RecruitBasis = RankEntry & {
	classOf: number;
	// The first school he signed with
	committed: string;
	jucoStart: boolean;
};

/**
 * What a player's ranking is based on, or undefined for a player with no US high school path (no NCAA or junior college season). `ranking` is for players whose stored ranking is being set now.
 */
export const getRecruitBasis = (
	p: Player,
	ranking = false,
): RecruitBasis | undefined => {
	const r = draftRatings(p);
	if (!r) {
		return undefined;
	}
	const pos = getRecruitPos(r.pos);
	const career = p.preDraftCareer;
	if (career) {
		const first = career.years[0];
		if (career.hsClass === undefined || !first) {
			return undefined;
		}
		const common = {
			id: p.pid,
			pos,
			classOf: career.hsClass,
			committed: first.school,
			jucoStart: first.level === "juco",
		};
		if (career.recruit && !ranking) {
			return {
				...common,
				rank: career.recruit.rank ?? undefined,
				posRank: career.recruit.posRank ?? undefined,
				priority: 0,
			};
		}
		const plain = getRecruiting({
			pid: p.pid,
			pot: r.pot,
			ovr: r.ovr,
			pos: r.pos,
			firstCollegeSeason: career.hsClass + 1,
		});
		const rank = adjustRecruitRank({
			pid: p.pid,
			nationalRank: plain.nationalRank,
			story: career.story,
			jucoStart: common.jucoStart,
		});
		return {
			...common,
			rank,
			posRank: rank === plain.nationalRank ? plain.posRank : undefined,
			priority: 2,
		};
	}

	// No stored career: a recruit if he played at an NCAA school
	const firstNcaa = getPreDraftStats(p).find((row) => {
		if (row.playoffs) {
			return false;
		}
		const school = getSchool(row.teamName ?? p.college ?? "");
		return !!school && !school.nonCollege && school.conference !== undefined;
	});
	if (!firstNcaa) {
		return undefined;
	}
	const plain = getRecruiting({
		pid: p.pid,
		pot: r.pot,
		ovr: r.ovr,
		pos: r.pos,
		firstCollegeSeason: firstNcaa.season,
	});
	return {
		id: p.pid,
		pos,
		classOf: plain.classOf,
		committed: firstNcaa.teamName ?? p.college ?? "",
		jucoStart: false,
		rank: plain.nationalRank,
		posRank: plain.posRank,
		priority: 1,
	};
};

// Everybody with this draft year, retired players included. Without a database (tests), the players in the cache
const getPlayersOfDraftYear = (year: number): Promise<Player[]> =>
	idb.league
		? idb.merged.players.getAll({ draftYear: year })
		: idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
				[year],
				[year, Infinity],
			]);

// A player of a high school class is drafted one to six years after it
const YEARS_AFTER = 6;

/**
 * Everybody's ranking in one high school class, by pid. `ranking` are players whose stored ranking is being set now: they fit around everyone else. They are used as given (they may not be saved yet).
 */
export const getHsClassRanks = async (
	classOf: number,
	ranking: Player[] = [],
	cache?: Map<number, Player[]>,
) => {
	const rankingByPid = new Map(ranking.map((p) => [p.pid, p]));
	const entries: RankEntry[] = [];
	const seen = new Set<number>();
	const add = (p: Player, isRanking: boolean) => {
		if (seen.has(p.pid)) {
			return;
		}
		seen.add(p.pid);
		const basis = getRecruitBasis(p, isRanking);
		if (basis && basis.classOf === classOf) {
			entries.push(basis);
		}
	};
	for (const p of ranking) {
		add(p, true);
	}
	for (let year = classOf + 1; year <= classOf + YEARS_AFTER; year++) {
		let players = cache?.get(year);
		if (!players) {
			players = await getPlayersOfDraftYear(year);
			cache?.set(year, players);
		}
		for (const p of players) {
			if (p.draft.year === year && !rankingByPid.has(p.pid)) {
				add(p, false);
			}
		}
	}
	return resolveClassRanks(entries);
};

/**
 * Set the stored ranking of prospects whose careers were just generated (p.preDraftCareer without a ranking yet, or one to replace). Mutates the players, does not save them.
 */
export const assignRecruitRanks = async (players: Player[]) => {
	const byClass = Map.groupBy(
		players.filter((p) => p.preDraftCareer?.hsClass !== undefined),
		(p) => p.preDraftCareer!.hsClass!,
	);
	const cache = new Map<number, Player[]>();
	for (const [classOf, members] of byClass) {
		const ranks = await getHsClassRanks(classOf, members, cache);
		for (const p of members) {
			const mine = ranks.get(p.pid);
			p.preDraftCareer!.recruit = {
				rank: mine?.nationalRank ?? null,
				posRank: mine?.posRank ?? null,
			};
		}
	}
};
