import getSchedule from "./getSchedule.ts";

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
		if (schedule[0]) {
			const today = schedule[0].day;

			let game;
			if (typeof target === "number") {
				game = schedule.find((game) => game.gid === target);
			} else if (target === "allStarGame") {
				game = schedule.find(
					(game) => game.awayTid === -2 && game.homeTid === -1,
				);
			} else if (target === "tradeDeadline") {
				game = schedule.find(
					(game) => game.awayTid === -3 && game.homeTid === -3,
				);
			}

			if (game) {
				// Days with games before the target, which is what game.play counts. The same as the difference in day
				// numbers, unless some days have no games (the All-Star break with realistic schedule length)
				const days = new Set<number>();
				for (const game2 of schedule) {
					if (game2.day >= today && game2.day < game.day) {
						days.add(game2.day);
					}
				}
				return days.size;
			}
		}

		throw new Error(`getDaysLeftSchedule did not find target "${target}"`);
	}

	if (!schedule[0]) {
		return 0;
	}

	// Days with games (see above)
	return new Set(schedule.map((game) => game.day)).size;
};

export default getDaysLeftSchedule;

// Number of days with games in the next numCalendarDays calendar days (starting today), for "play one week" etc. The
// same as numCalendarDays (if the schedule is that long) unless some days have no games, like the All-Star break with
// realistic schedule length.
export const getNumGameDaysInCalendarDays = async (numCalendarDays: number) => {
	const schedule = await getSchedule();
	if (!schedule[0]) {
		return 0;
	}
	const today = schedule[0].day;
	const days = new Set<number>();
	for (const game of schedule) {
		if (game.day < today + numCalendarDays) {
			days.add(game.day);
		}
	}
	return days.size;
};
