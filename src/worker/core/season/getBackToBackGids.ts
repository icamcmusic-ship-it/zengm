import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { PHASE } from "../../../common/constants.ts";
import getSchedule from "./getSchedule.ts";

// Upcoming regular season games that are the second night of a back-to-back for a team (gid -> tids). Uses the schedule, plus the
// team's last game day (stored with the injuryDepth setting) for the next game.
export const getBackToBackGids = async (): Promise<Map<number, number[]>> => {
	const output = new Map<number, number[]>();
	if (__SPORT !== "basketball" || g.get("phase") === PHASE.PLAYOFFS) {
		return output;
	}

	const schedule = await getSchedule();
	const lastDayByTid = new Map<number, number>();
	const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[g.get("season")], [g.get("season"), "Z"]],
	);
	for (const ts of teamSeasons) {
		if (ts.lastGameDay !== undefined) {
			lastDayByTid.set(ts.tid, ts.lastGameDay);
		}
	}

	for (const game of schedule) {
		if (game.homeTid < 0 || game.awayTid < 0) {
			continue;
		}
		for (const tid of [game.homeTid, game.awayTid]) {
			const lastDay = lastDayByTid.get(tid);
			if (lastDay !== undefined && lastDay === game.day - 1) {
				const tids = output.get(game.gid) ?? [];
				tids.push(tid);
				output.set(game.gid, tids);
			}
			lastDayByTid.set(tid, game.day);
		}
	}

	return output;
};
