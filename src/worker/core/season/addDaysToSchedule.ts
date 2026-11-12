import type { Game, ScheduleGameWithoutKey } from "../../../common/types.ts";
import { g } from "../../util/index.ts";

const addDaysToSchedule = (
	games: {
		homeTid: number;
		awayTid: number;
	}[],
	existingGames?: Game[],
	// Day of each game, relative to the first day of this schedule (1 is the first day), for a schedule that spells out
	// its days (realistic schedule length). Otherwise the days come from the order of the games: a new day starts
	// whenever a team would play twice.
	explicitDays?: readonly number[],
): ScheduleGameWithoutKey[] => {
	const dayTids = new Set<number>();
	let prevDayAllStarGame = false;
	let prevDayTradeDeadline = false;

	let day = 1;

	// If there are other games in already played this season, start after that day
	if (existingGames) {
		const season = g.get("season");
		for (const game of existingGames) {
			if (
				game.season === season &&
				typeof game.day === "number" &&
				game.day >= day
			) {
				day = game.day + 1;
			}
		}
	}

	if (explicitDays) {
		const offset = day - 1;
		return games.map((game, i) => ({
			...game,
			day: offset + explicitDays[i]!,
		}));
	}

	return games.map((game) => {
		const { awayTid, homeTid } = game;

		const allStarGame = awayTid === -2 && homeTid === -1;
		const tradeDeadline = awayTid === -3 && homeTid === -3;
		if (
			dayTids.has(homeTid) ||
			dayTids.has(awayTid) ||
			allStarGame ||
			prevDayAllStarGame ||
			tradeDeadline ||
			prevDayTradeDeadline
		) {
			day += 1;
			dayTids.clear();
		}

		dayTids.add(homeTid);
		dayTids.add(awayTid);

		prevDayAllStarGame = allStarGame;
		prevDayTradeDeadline = tradeDeadline;

		return {
			...game,
			day,
		};
	});
};

export default addDaysToSchedule;
