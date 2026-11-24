import { afterAll, assert, beforeEach, describe, test, vi } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { game, season } from "../core/index.ts";
import { getNumGameDaysInCalendarDays } from "../core/season/getDaysLeftSchedule.ts";
import {
	getNextHolidaySlate,
	getRoadTripEndDay,
} from "../core/season/getPlayUntilDays.ts";
import { formatDaysLeft } from "../core/trade/aiOffers.ts";
import playMenu from "./playMenu.ts";

const conditions = {};

// Games on the given days between teams 0 and 1, plus extra [day, homeTid, awayTid] games, in day order like the real schedule
const setSchedule = async (days: number[], extra: number[][] = []) => {
	await resetCache({});
	const games = [
		...days.map((day) => ({ day, homeTid: 0, awayTid: 1 })),
		...extra.map(([day, homeTid, awayTid]) => ({
			day: day!,
			homeTid: homeTid!,
			awayTid: awayTid!,
		})),
	].sort((a, b) => a.day - b.day);
	await idb.cache.schedule.addAll(games.map((game, gid) => ({ ...game, gid })));
};

describe("play menu", () => {
	let playSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetG();
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		idb.league = mockIDBLeague();
		playSpy = vi.spyOn(game, "play").mockResolvedValue(undefined as any);
	});

	afterAll(() => {
		vi.restoreAllMocks();
		resetG();
		// @ts-expect-error
		idb.league = undefined;
	});

	test("one week near the end of a spread schedule plays every game day in the next 7 calendar days", async () => {
		// 4 days with games left, every third day: 3 of them in the next 7 calendar days (capping at 4 first and then reading 4
		// as calendar days gave 2)
		await setSchedule([10, 13, 16, 19]);
		await playMenu.week(undefined, conditions as any);
		assert.strictEqual(playSpy.mock.calls[0]![0], 3);
	});

	test("one month is capped by the days with games left", async () => {
		await setSchedule([10, 12, 14, 16]);
		await playMenu.month(undefined, conditions as any);
		assert.strictEqual(playSpy.mock.calls[0]![0], 4);
	});

	test("until trade deadline does nothing after the deadline, and waits for the games", async () => {
		await setSchedule([10, 12]);
		await playMenu.untilTradeDeadline(undefined, conditions as any);
		assert.strictEqual(playSpy.mock.calls.length, 0);

		await setSchedule([10, 12, 15], [[13, -3, -3]]);
		let resolved = false;
		playSpy.mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			resolved = true;
		});
		await playMenu.untilTradeDeadline(undefined, conditions as any);
		assert.strictEqual(playSpy.mock.calls[0]![0], 2);
		assert.isTrue(resolved);
	});

	test("until day N plays the days with games before it", async () => {
		await setSchedule([10, 12, 16, 20]);
		await playMenu.untilDay(16, conditions as any);
		assert.strictEqual(playSpy.mock.calls[0]![0], 2);

		// Today or earlier: nothing
		await playMenu.untilDay(10, conditions as any);
		assert.strictEqual(playSpy.mock.calls.length, 1);

		// Past the end: the rest of the season
		await playMenu.untilDay(100, conditions as any);
		assert.strictEqual(playSpy.mock.calls[1]![0], 4);
	});

	test("until the next holiday slate", async () => {
		await setSchedule([10, 12, 16, 20]);
		await idb.cache.schedule.put({
			gid: 100,
			day: 16,
			homeTid: 2,
			awayTid: 3,
			marquee: "christmas",
		});
		await playMenu.untilHoliday(undefined, conditions as any);
		assert.strictEqual(playSpy.mock.calls[0]![0], 2);
	});

	test("until the end of the user's road trip, not in spectator mode", async () => {
		g.setWithoutSavingToDB("userTid", 1);
		// Team 1 is away on days 10 and 12, home on day 16
		await setSchedule([10, 12], [[16, 1, 0]]);
		await playMenu.untilEndOfRoadTrip(undefined, conditions as any);
		assert.strictEqual(playSpy.mock.calls[0]![0], 2);

		g.setWithoutSavingToDB("spectator", true);
		await playMenu.untilEndOfRoadTrip(undefined, conditions as any);
		assert.strictEqual(playSpy.mock.calls.length, 1);
		g.setWithoutSavingToDB("spectator", false);
	});

	test("days left count the batches game.play plays (a team twice on a day is 2 batches)", async () => {
		await setSchedule([10, 12], [[12, 0, 2]]);
		assert.strictEqual(await season.getDaysLeftSchedule(), 3);
		assert.strictEqual(await getNumGameDaysInCalendarDays(3), 3);
		assert.strictEqual(await getNumGameDaysInCalendarDays(2), 1);
	});

	test("not in the playoffs", async () => {
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		await setSchedule([10, 12]);
		await playMenu.untilDay(12, conditions as any);
		assert.strictEqual(playSpy.mock.calls.length, 0);
	});

	test("trade deadline notice text", () => {
		assert.strictEqual(formatDaysLeft(5, 5), "5 days");
		assert.strictEqual(formatDaysLeft(7, 4), "7 days (4 game days)");
		assert.strictEqual(formatDaysLeft(3, 1), "3 days (1 game day)");
	});
});

describe("play until helpers", () => {
	test("road trip end: only when the next game is on the road", () => {
		const schedule = [
			{ day: 1, homeTid: 0, awayTid: 1 },
			{ day: 3, homeTid: 2, awayTid: 1 },
			{ day: 5, homeTid: 1, awayTid: 2 },
		];
		assert.strictEqual(getRoadTripEndDay(schedule, 1), 5);
		assert.strictEqual(getRoadTripEndDay(schedule, 0), undefined);
		assert.strictEqual(getRoadTripEndDay(schedule, 2), undefined);
	});

	test("holiday slate: after today, not national TV", () => {
		const schedule = [
			{ day: 1, homeTid: 0, awayTid: 1, marquee: "christmas" as const },
			{ day: 3, homeTid: 2, awayTid: 1, marquee: "nationalTv" as const },
			{ day: 5, homeTid: 1, awayTid: 2, marquee: "mlk" as const },
		];
		assert.deepStrictEqual(getNextHolidaySlate(schedule), {
			day: 5,
			marquee: "mlk",
		});
	});
});
