import type { MarqueeKind } from "../../../common/marquee.ts";

// Targets of the play menu's "Until ..." options that are days of the regular season schedule (play stops before that day, so its
// games are next). The schedule is in day order, today is its first day.
type Game = {
	day: number;
	homeTid: number;
	awayTid: number;
	marquee?: MarqueeKind;
};

// Marquee Games: the next holiday slate (Christmas, MLK Day) after today
export const getNextHolidaySlate = (schedule: readonly Game[]) => {
	const today = schedule[0]?.day;
	for (const game of schedule) {
		if (
			game.day > today! &&
			game.marquee !== undefined &&
			game.marquee !== "nationalTv"
		) {
			return { day: game.day, marquee: game.marquee };
		}
	}
	return undefined;
};

// The end of a team's current road trip: the day of its next home game, if its next game is on the road (and it has a home
// game left)
export const getRoadTripEndDay = (schedule: readonly Game[], tid: number) => {
	let onRoad = false;
	for (const game of schedule) {
		if (game.homeTid === tid) {
			return onRoad ? game.day : undefined;
		}
		if (game.awayTid === tid) {
			onRoad = true;
		}
	}
	return undefined;
};
