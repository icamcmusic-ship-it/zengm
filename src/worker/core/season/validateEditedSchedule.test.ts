import { assert, test } from "vitest";
import { validateEditedSchedule } from "../../../common/validateEditedSchedule.ts";
import { getEditedScheduleSpread } from "./scheduleDayScale.ts";

const options = {
	activeTids: new Set([0, 1, 2, 3]),
	allStarGameAllowed: true,
	tradeDeadlineAllowed: true,
};

const game = (day: number, homeTid: number, awayTid: number) => ({
	day,
	homeTid,
	awayTid,
	type: "game",
});
const allStarGame = (day: number) => ({
	day,
	homeTid: -1,
	awayTid: -2,
	type: "allStarGame",
});
const tradeDeadline = (day: number) => ({
	day,
	homeTid: -3,
	awayTid: -3,
	type: "tradeDeadline",
});

test("a valid schedule", () => {
	assert.isUndefined(
		validateEditedSchedule(
			[
				{ ...game(1, 0, 1), type: "completed" },
				game(1, 2, 3),
				tradeDeadline(2),
				game(3, 1, 0),
				allStarGame(4),
				{ type: "placeholder", day: 5, homeTid: 0, awayTid: 0 },
			],
			options,
		),
	);
});

test("a team twice on one day, also with a completed game", () => {
	assert.include(
		validateEditedSchedule([game(1, 0, 1), game(1, 1, 2)], options),
		"more than once on day 1",
	);
	assert.include(
		validateEditedSchedule(
			[{ ...game(1, 0, 1), type: "completed" }, game(1, 2, 0)],
			options,
		),
		"more than once on day 1",
	);
});

test("invalid teams", () => {
	assert.include(
		validateEditedSchedule([game(1, 0, 7)], options),
		"Invalid team",
	);
	assert.include(
		validateEditedSchedule([game(1, -1, 2)], options),
		"Invalid team",
	);
	assert.include(
		validateEditedSchedule([game(1, 2, 2)], options),
		"play itself",
	);
});

test("special days alone and at most one of each", () => {
	assert.include(
		validateEditedSchedule([allStarGame(1), game(1, 0, 1)], options),
		"alone on its day",
	);
	assert.include(
		validateEditedSchedule([tradeDeadline(1), game(1, 0, 1)], options),
		"alone on its day",
	);
	assert.include(
		validateEditedSchedule([tradeDeadline(1), allStarGame(1)], options),
		"alone on its day",
	);
	assert.include(
		validateEditedSchedule([allStarGame(1), allStarGame(3)], options),
		"only be one All-Star Game",
	);
	assert.include(
		validateEditedSchedule([tradeDeadline(1), tradeDeadline(3)], options),
		"only be one trade deadline",
	);
});

test("no trade deadline after the deadline, no All-Star Game when not allowed", () => {
	assert.include(
		validateEditedSchedule([tradeDeadline(1)], {
			...options,
			tradeDeadlineAllowed: false,
		}),
		"trade deadline already happened",
	);
	assert.include(
		validateEditedSchedule([allStarGame(1)], {
			...options,
			allStarGameAllowed: false,
		}),
		"All-Star Game can't be added",
	);
	// A completed All-Star Game is not a new one
	assert.isUndefined(
		validateEditedSchedule([{ ...allStarGame(1), type: "completed" }], {
			...options,
			allStarGameAllowed: false,
		}),
	);
});

test("scheduleSpread after a schedule editor save", () => {
	// Realistic schedule length on: spread, also in tiny leagues where the scale is 1 (like newPhaseRegularSeason)
	assert.isTrue(getEditedScheduleSpread(1, true));
	assert.isTrue(getEditedScheduleSpread(0.5, true));
	// Turned off and regenerated (compact schedule): not spread anymore
	assert.isFalse(getEditedScheduleSpread(1, false));
	// Off, but the edited schedule is spread out
	assert.isTrue(getEditedScheduleSpread(0.6, false));
});
