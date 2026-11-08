// Read-only coaching staff data for other features (newspaper, storylines, wrapped, team strategy, game sim). Everything returns plain objects and never throws when the feature is off; it just returns empty results.

import { COACH_ROLE_NAMES } from "../../../common/staff.ts";
import type {
	Coach,
	CoachRole,
	CoachStyle,
	CoachTransactionType,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";

const enabled = () => __SPORT === "basketball" && !!g.get("coachingStaff");

// Head coach's style for a team, or undefined if no staff. A later strategy/game sim change can use this, for example pace -> possessions, threes -> shot selection, rotation -> minutes distribution.
export const getTeamCoachStyle = async (
	tid: number,
): Promise<CoachStyle | undefined> => {
	if (!enabled()) {
		return;
	}
	const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
	return coaches.find((c) => c.role === "head")?.style;
};

export type CarouselMove = {
	cid: number;
	name: string;
	role: CoachRole;
	roleName: string;
	tid: number;
	type: CoachTransactionType;
	season: number;
	phase: number;
};

// All coaching moves from a season (hires, firings, departures, retirements), head coaches first
export const getCoachingCarousel = async (
	season: number,
): Promise<CarouselMove[]> => {
	if (!enabled()) {
		return [];
	}
	const coaches = await idb.cache.coaches.getAll();
	const moves: CarouselMove[] = [];
	for (const c of coaches) {
		for (const tx of c.transactions) {
			if (tx.season === season) {
				moves.push({
					cid: c.cid,
					name: `${c.firstName} ${c.lastName}`,
					role: tx.role,
					roleName: COACH_ROLE_NAMES[tx.role],
					tid: tx.tid,
					type: tx.type,
					season: tx.season,
					phase: tx.phase,
				});
			}
		}
	}
	return moves.sort(
		(a, b) =>
			Number(b.role === "head") - Number(a.role === "head") ||
			a.phase - b.phase,
	);
};

// Head coach of a team in a past or current season (the one who finished the season)
export const getHeadCoachForSeason = async (
	tid: number,
	season: number,
): Promise<Coach | undefined> => {
	if (!enabled()) {
		return;
	}
	const coaches = await idb.cache.coaches.getAll();
	return (
		coaches.find((c) =>
			c.stats.some(
				(r) => r.season === season && r.tid === tid && r.role === "head",
			),
		) ??
		(season === g.get("season")
			? coaches.find((c) => c.tid === tid && c.role === "head")
			: undefined)
	);
};

export const getCoachAwards = async (type?: string) => {
	if (!enabled()) {
		return [];
	}
	const coaches = await idb.cache.coaches.getAll();
	const out: {
		season: number;
		type: string;
		cid: number;
		name: string;
		tid: number;
	}[] = [];
	for (const c of coaches) {
		for (const a of c.awards) {
			if (type === undefined || a.type === type) {
				const row = c.stats.find((r) => r.season === a.season);
				out.push({
					season: a.season,
					type: a.type,
					cid: c.cid,
					name: `${c.firstName} ${c.lastName}`,
					tid: row?.tid ?? c.tid,
				});
			}
		}
	}
	return out.sort((a, b) => b.season - a.season);
};
