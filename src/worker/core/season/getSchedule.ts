import { idb } from "../../db/index.ts";
import type { ScheduleGame } from "../../../common/types.ts";

/**
 * Get an array of games from the schedule.
 *
 * @param {(IDBObjectStore|IDBTransaction|null)} options.ot An IndexedDB object store or transaction on schedule; if null is passed, then a new transaction will be used.
 * @param {boolean} options.oneDay Return just one day (true) or all days (false). Default false.
 * @return {Promise} Resolves to the requested schedule array.
 */
const getSchedule = async (
	oneDay: boolean = false,
): Promise<ScheduleGame[]> => {
	const schedule = await idb.cache.schedule.getAll();

	if (oneDay && schedule[0]) {
		return schedule.slice(0, getScheduleBatchEnd(schedule, 0));
	}

	return schedule;
};

// The games game.play plays as one day, starting at index start of the schedule (getSchedule(true) is the first one): the games
// of start's day until a team would play twice, and the All-Star Game and trade deadline by themselves. Returns the index after
// the last one. getDaysLeftSchedule counts days the same way.
export const getScheduleBatchEnd = (
	schedule: readonly { day: number; homeTid: number; awayTid: number }[],
	start: number,
) => {
	const first = schedule[start];
	if (!first) {
		return start;
	}
	const tids = new Set<number>();
	let i = start;
	for (; i < schedule.length; i++) {
		const game = schedule[i]!;
		if (game.day !== first.day) {
			// Only keep games from same day
			break;
		}
		if (tids.has(game.homeTid) || tids.has(game.awayTid)) {
			// Only keep games from unique teams, no 2 games in 1 day
			break;
		}

		// For ASG and trade deadline, make absolutely sure they are alone. This shouldn't be necessary because addDaysToSchedule should handle it, but just in case...
		if ((game.homeTid < 0 || game.awayTid < 0) && tids.size > 0) {
			break;
		}

		tids.add(game.homeTid);
		tids.add(game.awayTid);

		// For ASG and trade deadline, make absolutely sure they are alone. This shouldn't be necessary because addDaysToSchedule should handle it, but just in case...
		if (game.homeTid < 0 || game.awayTid < 0) {
			i += 1;
			break;
		}
	}
	return i;
};

// Number of days game.play can take without reaching the game at index end (all of them by default): the batches that end before it
export const countScheduleBatches = (
	schedule: readonly { day: number; homeTid: number; awayTid: number }[],
	end: number = schedule.length,
) => {
	let count = 0;
	let start = 0;
	while (start < end) {
		const next = getScheduleBatchEnd(schedule, start);
		if (next > end) {
			break;
		}
		start = next;
		count += 1;
	}
	return count;
};

export default getSchedule;
