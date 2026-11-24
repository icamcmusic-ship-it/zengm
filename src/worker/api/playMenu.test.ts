import { afterAll, assert, beforeEach, describe, test, vi } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { game } from "../core/index.ts";
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
});
