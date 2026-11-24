import { assert, test } from "vitest";
import { repairEditedScheduleThreeInFour } from "./repairEditedSchedule.ts";
import { getScheduleRestStats } from "../../../common/scheduleRestStats.ts";

type Game = {
	day: number;
	type: string;
	homeTid?: number;
	awayTid?: number;
	marquee?: "christmas" | "nationalTv";
};

// 4 teams playing every 4th day (0-1 and 2-3, then 0-2 and 1-3, then 0-3 and 1-2), with teams 0 and 1 playing two extra games
// that make 3 days in a row
const makeSchedule = () => {
	const pairings = [
		[
			[0, 1],
			[2, 3],
		],
		[
			[2, 0],
			[3, 1],
		],
		[
			[0, 3],
			[1, 2],
		],
	] as const;
	const games: Game[] = [];
	for (let i = 0; i < 12; i++) {
		for (const [homeTid, awayTid] of pairings[i % 3]!) {
			games.push({ day: 1 + 4 * i, type: "game", homeTid, awayTid });
		}
	}
	// Days 9, 10, 11 for teams 0 and 1
	games.push(
		{ day: 10, type: "game", homeTid: 1, awayTid: 0 },
		{ day: 11, type: "game", homeTid: 0, awayTid: 1 },
	);
	return games.sort((a, b) => a.day - b.day);
};

const numThreeInFour = (games: readonly Game[]) => {
	const real = games.filter((game) => game.homeTid !== undefined);
	let count = 0;
	for (const s of getScheduleRestStats(
		real.map((game) => [game.homeTid!, game.awayTid!] as const),
		real.map((game) => game.day),
	).values()) {
		count += s.threeInFour;
	}
	return count;
};

test("moves games out of 3-in-4s", () => {
	const schedule = makeSchedule();
	assert.isAbove(numThreeInFour(schedule), 0);
	const { numMoved, schedule: repaired } =
		repairEditedScheduleThreeInFour(schedule);
	assert.isAbove(numMoved, 0);
	assert.isBelow(numThreeInFour(repaired), numThreeInFour(schedule));
	assert.strictEqual(repaired.length, schedule.length);
	for (let i = 1; i < repaired.length; i++) {
		assert.isAtLeast(repaired[i]!.day, repaired[i - 1]!.day);
	}
});

test("completed games, played days and holiday games stay", () => {
	const schedule: Game[] = makeSchedule().map((game) =>
		game.day <= 9 ? { ...game, type: "completed" } : game,
	);
	const extra = schedule.find((game) => game.day === 10 && game.homeTid === 1)!;
	extra.marquee = "christmas";
	const { schedule: repaired } = repairEditedScheduleThreeInFour(schedule);
	for (const game of repaired) {
		if (game.type === "completed" || game.marquee === "christmas") {
			assert.include(schedule, game);
		}
	}
	// Nothing moved onto a day already played
	for (const game of repaired) {
		if (game.type !== "completed") {
			assert.isAbove(game.day, 9);
		}
	}
});

test("placeholders and events are kept", () => {
	const schedule = makeSchedule();
	schedule.push(
		{ day: 25, type: "allStarGame", homeTid: -1, awayTid: -2 },
		{ day: 30, type: "placeholder" },
	);
	const { schedule: repaired } = repairEditedScheduleThreeInFour(schedule);
	assert.deepInclude(repaired, {
		day: 25,
		type: "allStarGame",
		homeTid: -1,
		awayTid: -2,
	});
	assert.deepInclude(repaired, { day: 30, type: "placeholder" });
});
