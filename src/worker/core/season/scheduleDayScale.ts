import { PHASE } from "../../../common/constants.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";

// Realistic schedule length (the realisticSchedule League Extras setting) spreads the regular season over about twice
// as many days as the old compact schedule. Everything that happens once per day of games (injuries healing, free
// agents lowering their demands, AI signings and trades, holdouts, tragic deaths, ...) is calibrated to the old number
// of days, so it runs on only some of the days: as many as the old schedule had, spread evenly over the season. The
// scheduleDayScale game attribute is old days / new days for the current season's schedule (1 for the old schedule,
// when every day is a "tick").

// Fraction of days that get the daily processes, in the current phase
export const getDayScale = () => {
	const phase = g.get("phase");
	if (
		phase !== PHASE.REGULAR_SEASON &&
		phase !== PHASE.AFTER_TRADE_DEADLINE
	) {
		return 1;
	}
	let scale;
	try {
		scale = g.get("scheduleDayScale");
	} catch {
		return 1;
	}
	return typeof scale === "number" && scale > 0 && scale < 1 ? scale : 1;
};

// How many of the day's daily processes the day that just finished gets: 0 or 1. Call after the day's games are
// removed from the schedule. Counted from the end of the season (the remaining days), so it doesn't depend on day
// numbers, gaps like the All-Star break or how the season started.
export const getDayTicks = async () => {
	const scale = getDayScale();
	if (scale >= 1) {
		return 1;
	}
	const schedule = await idb.cache.schedule.getAll();
	const days = new Set<number>();
	for (const game of schedule) {
		days.add(game.day);
	}
	return getNumTicks(days.size, scale);
};

// 0 or 1. Over a season of N days with games, the days add up to floor(N * scale) ticks, spread evenly
export const getNumTicks = (numDaysLeft: number, scale: number) =>
	scale >= 1
		? 1
		: Math.floor((numDaysLeft + 1) * scale) - Math.floor(numDaysLeft * scale);

// Number of days a set of games would take in the old compact schedule (each team plays at most once a day, games
// packed into the earliest day with room, All-Star Game and trade deadline on their own days)
export const getCompactNumDays = (
	games: readonly { homeTid: number; awayTid: number }[],
) => {
	const days: Set<number>[] = [];
	let numEventDays = 0;
	for (const { homeTid, awayTid } of games) {
		if (homeTid < 0 || awayTid < 0) {
			numEventDays += 1;
			continue;
		}
		let found = false;
		for (const tids of days) {
			if (!tids.has(homeTid) && !tids.has(awayTid)) {
				tids.add(homeTid);
				tids.add(awayTid);
				found = true;
				break;
			}
		}
		if (!found) {
			days.push(new Set([homeTid, awayTid]));
		}
	}
	return days.length + numEventDays;
};

// scheduleDayScale for a whole season's schedule (games with days), e.g. after the schedule editor replaced it
export const getScheduleDayScale = (
	games: readonly { homeTid: number; awayTid: number; day: number }[],
) => {
	const numDays = new Set(games.map((game) => game.day)).size;
	if (numDays === 0) {
		return 1;
	}
	return Math.min(1, getCompactNumDays(games) / numDays);
};
