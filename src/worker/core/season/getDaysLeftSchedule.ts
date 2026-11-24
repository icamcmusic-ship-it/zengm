import getSchedule, { countScheduleBatches } from "./getSchedule.ts";

/**
 * Get the number of days left in the regular season schedule.
 *
 * @memberOf core.season
 * @return {Promise} The number of days left in the schedule.
 */
const getDaysLeftSchedule = async (
	target?: number | "allStarGame" | "tradeDeadline",
) => {
	const schedule = await getSchedule();

	if (target !== undefined) {
		let index = -1;
		if (typeof target === "number") {
			index = schedule.findIndex((game) => game.gid === target);
		} else if (target === "allStarGame") {
			index = schedule.findIndex(
				(game) => game.awayTid === -2 && game.homeTid === -1,
			);
		} else if (target === "tradeDeadline") {
			index = schedule.findIndex(
				(game) => game.awayTid === -3 && game.homeTid === -3,
			);
		}

		if (index >= 0) {
			// Days game.play takes before the target (getSchedule(true) batches: the days with games, unless a day has a team
			// twice). Day numbers would count the All-Star break's empty days too (realistic schedule length).
			return countScheduleBatches(schedule, index);
		}

		throw new Error(`getDaysLeftSchedule did not find target "${target}"`);
	}

	return countScheduleBatches(schedule);
};

export default getDaysLeftSchedule;

// Number of days with games in the next numCalendarDays calendar days (starting today), for "play one week" etc., counted
// like game.play plays them (getSchedule(true)). The same as numCalendarDays (if the schedule is that long) unless some days
// have no games, like the All-Star break with realistic schedule length.
export const getNumGameDaysInCalendarDays = async (numCalendarDays: number) => {
	const schedule = await getSchedule();
	if (!schedule[0]) {
		return 0;
	}
	const today = schedule[0].day;
	const end = schedule.findIndex((game) => game.day >= today + numCalendarDays);
	return countScheduleBatches(schedule, end < 0 ? schedule.length : end);
};
