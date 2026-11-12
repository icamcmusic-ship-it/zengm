import { WEBSITE_ROOT } from "../../../common/constants.ts";
import type { Conditions } from "../../../common/types.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import addDaysToSchedule from "./addDaysToSchedule.ts";
import { getRealSchedule } from "./getRealSchedule.football.ts";
import groupScheduleRealistic from "./groupScheduleRealistic.ts";
import newScheduleGood from "./newScheduleGood.ts";

// The realisticSchedule League Extras setting: basketball only, and not with the "group schedule into series" setting
export const realisticScheduleOn = () =>
	__SPORT === "basketball" &&
	featureOn("realisticSchedule") &&
	!g.get("groupScheduleSeries");

export type NewScheduleOutput = {
	tids: [number, number][];
	// Day of each game (relative, the first day is 1), when the schedule spells out its days (realistic schedule).
	// Otherwise the days come from the order of the games (addDaysToSchedule).
	days?: number[];
	// For the scheduleDayScale game attribute: how many days the old compact schedule would take, per day of this one.
	// 1 for the old schedule.
	dayScale: number;
};

export const newScheduleWithDays = (
	teams: {
		seasonAttrs: {
			cid: number;
			did: number;
		};
		tid: number;
	}[],
	conditions?: Conditions,
): NewScheduleOutput => {
	if (__SPORT === "football") {
		const tids = getRealSchedule(teams);
		if (tids) {
			return { tids, dayScale: 1 };
		}
	}

	const { tids, warning } = newScheduleGood(teams);
	const tidsWithoutEvents = [...tids];

	// Add trade deadline
	const tradeDeadline = g.get("tradeDeadline");
	if (tradeDeadline < 1) {
		const ind = Math.round(tradeDeadline * tids.length);
		tids.splice(ind, 0, [-3, -3]);
	}

	// Add an All-Star Game
	const allStarGame = g.get("allStarGame");
	if (allStarGame !== null && allStarGame >= 0) {
		const ind = Math.round(allStarGame * tids.length);
		tids.splice(ind, 0, [-1, -2]);
	}

	if (warning !== undefined) {
		// console.log(g.get("season"), warning);
		logEvent(
			{
				type: "info",
				text: `Your <a href="${helpers.leagueUrl([
					"settings",
				])}">schedule settings (# Games, # Division Games, and # Conference Games)</a> combined with your teams/divs/confs cannot be handled by the schedule generator, so instead it will generate round robin matchups between all your teams. Message from the schedule generator: "${warning}" <a href="https://${WEBSITE_ROOT}/manual/customization/schedule-settings/" target="_blank">More details.</a>`,
				saveToDb: false,
			},
			conditions,
		);
	}

	if (!realisticScheduleOn() || tidsWithoutEvents.length === 0) {
		return { tids, dayScale: 1 };
	}

	// Days the old schedule would take, to keep the daily processes calibrated to it (scheduleDayScale)
	const oldSchedule = addDaysToSchedule(
		tids.map(([homeTid, awayTid]) => ({ homeTid, awayTid })),
	);
	const oldNumDays = oldSchedule.at(-1)?.day ?? 1;

	const realistic = groupScheduleRealistic(tidsWithoutEvents, {
		allStarGame: allStarGame !== null && allStarGame >= 0 ? allStarGame : null,
		tradeDeadline: tradeDeadline < 1 ? tradeDeadline : null,
	});
	const numDays = new Set(realistic.days).size;

	return {
		tids: realistic.tids,
		days: realistic.days,
		dayScale: Math.min(1, oldNumDays / numDays),
	};
};

const newSchedule = (
	teams: Parameters<typeof newScheduleWithDays>[0],
	conditions?: Conditions,
) => newScheduleWithDays(teams, conditions).tids;

export default newSchedule;
