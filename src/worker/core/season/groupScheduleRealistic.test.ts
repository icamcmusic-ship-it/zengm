import { assert, beforeEach, describe, test } from "vitest";
import { g, helpers } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import newScheduleGood from "./newScheduleGood.ts";
import groupScheduleRealistic, {
	getAllStarBreakLength,
	getScheduleRestStats,
} from "./groupScheduleRealistic.ts";
import { newScheduleWithDays } from "./newSchedule.ts";
import addDaysToSchedule from "./addDaysToSchedule.ts";
import {
	getCompactNumDays,
	getNumTicks,
	getScheduleDayScale,
	scheduleDaysSpread,
} from "./scheduleDayScale.ts";
import { PHASE } from "../../../common/constants.ts";

const options = { timeout: 60_000 } as const;

const getTeams = (numTeams: number) =>
	helpers
		.getTeamsDefault()
		.slice(0, numTeams)
		.map((t) => ({
			// Don't need tid to start at 0, could be disabled teams!
			tid: t.tid + 3,
			seasonAttrs: { cid: t.cid, did: t.did },
		}));

const matchupKey = ([home, away]: readonly [number, number]) =>
	`${home}-${away}`;

const countMatchups = (tids: readonly (readonly [number, number])[]) => {
	const counts = new Map<string, number>();
	for (const matchup of tids) {
		if (matchup[0] < 0) {
			continue;
		}
		const key = matchupKey(matchup);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
};

const summarize = (values: number[]) => ({
	min: Math.min(...values),
	avg: values.reduce((a, b) => a + b, 0) / values.length,
	max: Math.max(...values),
});

// Generate a realistic schedule from the normal matchups and check the invariants that hold for any league
const check = (
	numTeams: number,
	numGames: number,
	events = { allStarGame: 0.7, tradeDeadline: 0.6 } as {
		allStarGame: number | null;
		tradeDeadline: number | null;
	},
) => {
	g.setWithoutSavingToDB("numGames", numGames);
	const { tids: input } = newScheduleGood(getTeams(numTeams));
	const output = groupScheduleRealistic(input, events);

	assert.strictEqual(output.tids.length, output.days.length);

	// Same games, same home/away
	assert.deepStrictEqual(
		[...countMatchups(output.tids)].sort(),
		[...countMatchups(input)].sort(),
	);

	// Days in order, no team twice in a day, events alone on their day
	const tidsByDay = new Map<number, Set<number>>();
	for (const [i, [home, away]] of output.tids.entries()) {
		const day = output.days[i]!;
		if (i > 0) {
			assert.isAtLeast(day, output.days[i - 1]!);
		}
		let set = tidsByDay.get(day);
		if (!set) {
			set = new Set();
			tidsByDay.set(day, set);
		}
		if (home < 0) {
			assert.strictEqual(set.size, 0);
			set.add(home);
			set.add(away);
			continue;
		}
		assert.isFalse(set.has(home), `team ${home} twice on day ${day}`);
		assert.isFalse(set.has(away), `team ${away} twice on day ${day}`);
		assert.isFalse(set.has(-3) || set.has(-1));
		set.add(home);
		set.add(away);
	}

	const numEvents =
		(events.allStarGame !== null ? 1 : 0) +
		(events.tradeDeadline !== null ? 1 : 0);
	assert.strictEqual(output.tids.length, input.length + numEvents);

	const stats = getScheduleRestStats(output.tids, output.days);
	const lastDay = Math.max(...output.days);
	return { output, stats: [...stats.values()], lastDay };
};

describe("realistic schedule length", options, () => {
	beforeEach(() => {
		resetG();
		g.setWithoutSavingToDB("numGamesDiv", null);
		g.setWithoutSavingToDB("numGamesConf", null);
	});

	test("82 games: NBA-like season length and rest", () => {
		// (seeded: an unlucky schedule can have a few more 3-in-4s, see the next test for the average)
		Math.random = makeSeededRandom(11);
		for (let i = 0; i < 3; i++) {
			const { output, stats, lastDay } = check(30, 82);

			// About 2 days per game plus the All-Star break
			assert.isAtLeast(lastDay, 164);
			assert.isAtMost(lastDay, 180);

			for (const s of stats) {
				assert.strictEqual(s.numGames, 82);
				assert.strictEqual(s.sameDay, 0);
				assert.isAtMost(s.maxConsecutive, 2);
			}

			const b2b = summarize(stats.map((s) => s.b2b));
			assert.isAtLeast(b2b.avg, 12);
			assert.isAtMost(b2b.avg, 17);
			assert.isAtLeast(b2b.min, 6);
			assert.isAtMost(b2b.max, 22);

			const threeInFour = summarize(stats.map((s) => s.threeInFour));
			// ~172 days leaves room for almost none (each back-to-back between 2-day breaks): the repair pass removes
			// most of the ones the daily construction leaves at the end of the season (~0.7 per team on average)
			assert.isAtMost(threeInFour.avg, 1.6);
			assert.isAtMost(threeInFour.max, 6);

			// Each team plays on roughly half the days
			const numDays = new Set(output.days).size;
			assert.isAbove(numDays, 145);

			// Some longer breaks during the season (not counting the All-Star break)
			assert.isAtLeast(summarize(stats.map((s) => s.maxDaysOff)).max, 3);
		}
	});

	test("82 games: about one 3-in-4 per team or fewer, over several seeds", () => {
		const threeInFour = [];
		const b2b = [];
		const lastDays = [];
		for (let seed = 1; seed <= 6; seed++) {
			Math.random = makeSeededRandom(seed);
			const { stats, lastDay } = check(30, 82);
			threeInFour.push(summarize(stats.map((s) => s.threeInFour)).avg);
			b2b.push(summarize(stats.map((s) => s.b2b)).avg);
			lastDays.push(lastDay);
		}
		assert.isAtMost(summarize(threeInFour).avg, 1);
		assert.approximately(summarize(b2b).avg, 14, 1);
		// Same season length as before the repair pass (170-172)
		assert.isAtLeast(summarize(lastDays).min, 168);
		assert.isAtMost(summarize(lastDays).max, 173);
	});

	test("All-Star break and trade deadline", () => {
		const { output } = check(30, 82);
		const asgIndex = output.tids.findIndex(([home]) => home === -1);
		const tdIndex = output.tids.findIndex(([home]) => home === -3);
		const asgDay = output.days[asgIndex]!;
		const tdDay = output.days[tdIndex]!;
		const lastDay = Math.max(...output.days);

		// Near the right fraction of the season
		assert.approximately(asgDay / lastDay, 0.7, 0.05);
		assert.approximately(tdDay / lastDay, 0.6, 0.05);

		// No regular season games during the All-Star break
		const breakLength = getAllStarBreakLength(82);
		assert.isAbove(breakLength, 2);
		const days = new Set(output.days);
		for (let day = asgDay - 1; day <= asgDay + 1; day++) {
			if (day === asgDay) {
				continue;
			}
			assert.isFalse(days.has(day), `games on day ${day} during the break`);
		}

		// Event order as in the old schedule: TD before ASG here
		assert.isBelow(tdIndex, asgIndex);
	});

	test("no events", () => {
		const { output } = check(30, 82, {
			allStarGame: null,
			tradeDeadline: null,
		});
		assert.isFalse(output.tids.some(([home]) => home < 0));
	});

	test("scales with the number of games", () => {
		for (const numGames of [10, 20, 40, 100, 162]) {
			const { stats, lastDay } = check(30, numGames);
			const breakLength = getAllStarBreakLength(numGames);
			assert.isAtLeast(lastDay, Math.round(1.8 * numGames), `${numGames}`);
			assert.isAtMost(
				lastDay,
				Math.round(2.05 * numGames) + breakLength + 6,
				`${numGames}`,
			);

			const b2b = summarize(stats.map((s) => s.b2b));
			const expectedB2B = (numGames * 14) / 82;
			assert.isAtLeast(b2b.avg, expectedB2B * 0.6, `${numGames}`);
			assert.isAtMost(b2b.avg, expectedB2B * 1.3 + 1, `${numGames}`);

			const threeInFour = summarize(stats.map((s) => s.threeInFour));
			assert.isAtMost(threeInFour.avg, (2 * numGames) / 82 + 1);

			for (const s of stats) {
				assert.strictEqual(s.numGames, numGames);
				assert.isAtMost(s.maxConsecutive, 3);
			}
		}
	});

	test("odd number of teams, division/conference games", () => {
		g.setWithoutSavingToDB("numGamesDiv", 16);
		g.setWithoutSavingToDB("numGamesConf", 36);
		const { stats, lastDay } = check(29, 82);
		assert.isAtMost(lastDay, 172);
		for (const s of stats) {
			assert.strictEqual(s.numGames, 82);
			assert.isAtMost(s.maxConsecutive, 2);
		}
	});

	test("tiny leagues always finish", () => {
		for (const numTeams of [2, 3, 4, 5]) {
			for (const numGames of [1, 10, 82]) {
				const { stats, lastDay } = check(numTeams, numGames);
				for (const s of stats) {
					assert.isAtLeast(s.numGames, 1);
				}
				// Bounded, even when the schedule can't be NBA-like
				assert.isAtMost(lastDay, 3 * numGames + 20);
			}
		}
	});
});

describe("newSchedule with realistic schedule length", options, () => {
	beforeEach(() => {
		resetG();
	});

	test("off: exactly the old schedule", () => {
		Math.random = makeSeededRandom(1);
		const { tids: expected } = newScheduleGood(getTeams(30));
		const tradeDeadline = g.get("tradeDeadline");
		if (tradeDeadline < 1) {
			expected.splice(Math.round(tradeDeadline * expected.length), 0, [-3, -3]);
		}
		const allStarGame = g.get("allStarGame");
		if (allStarGame !== null && allStarGame >= 0) {
			expected.splice(Math.round(allStarGame * expected.length), 0, [-1, -2]);
		}

		Math.random = makeSeededRandom(1);
		g.setWithoutSavingToDB("realisticSchedule", false);
		const output = newScheduleWithDays(getTeams(30));
		assert.deepStrictEqual(output.tids, expected);
		assert.strictEqual(output.days, undefined);
		assert.strictEqual(output.dayScale, 1);
	});

	test("on: days and day scale", () => {
		g.setWithoutSavingToDB("realisticSchedule", true);
		const output = newScheduleWithDays(getTeams(30));
		assert.ok(output.days);
		assert.strictEqual(output.days.length, output.tids.length);
		// ~90 old days / ~172 new days
		assert.isAbove(output.dayScale, 0.45);
		assert.isBelow(output.dayScale, 0.6);

		const schedule = addDaysToSchedule(
			output.tids.map(([homeTid, awayTid]) => ({ homeTid, awayTid })),
			undefined,
			output.days,
		);
		assert.deepStrictEqual(
			schedule.map((game) => game.day),
			output.days,
		);
		// The same scale can be found from the schedule itself (schedule editor)
		assert.approximately(getScheduleDayScale(schedule), output.dayScale, 0.05);
	});

	test("on, but grouped into series: old schedule", () => {
		g.setWithoutSavingToDB("realisticSchedule", true);
		g.setWithoutSavingToDB("groupScheduleSeries", true);
		const output = newScheduleWithDays(getTeams(30));
		assert.strictEqual(output.days, undefined);
		assert.strictEqual(output.dayScale, 1);
	});
});

describe("daily processes with realistic schedule length", () => {
	test("ticks add up to the old number of days, spread evenly", () => {
		for (const [oldDays, newDays] of [
			[88, 170],
			[13, 24],
			[170, 335],
			[50, 50],
		] as const) {
			const scale = Math.min(1, oldDays / newDays);
			let total = 0;
			let maxGap = 0;
			let gap = 0;
			// The game loop: after each day's games, numDaysLeft days remain
			for (let numDaysLeft = newDays - 1; numDaysLeft >= 0; numDaysLeft--) {
				const ticks = getNumTicks(numDaysLeft, scale);
				assert.include([0, 1], ticks);
				total += ticks;
				gap = ticks ? 0 : gap + 1;
				maxGap = Math.max(maxGap, gap);
			}
			assert.strictEqual(total, Math.floor(newDays * scale));
			assert.isAtMost(total, oldDays);
			assert.isAtLeast(total, oldDays - 1);
			// Never more than 2 days in a row without the daily processes when the scale is about 1/2
			assert.isAtMost(maxGap, Math.ceil(1 / scale));
		}
	});

	test("old schedule: every day", () => {
		assert.strictEqual(getNumTicks(50, 1), 1);
		assert.strictEqual(getNumTicks(0, 1), 1);
	});

	test("spread schedule: also in a 2-team league, where the scale stays 1", () => {
		resetG();
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		g.setWithoutSavingToDB("scheduleDayScale", 1);
		g.setWithoutSavingToDB("scheduleSpread", false);
		assert.isFalse(scheduleDaysSpread());
		g.setWithoutSavingToDB("scheduleSpread", true);
		assert.isTrue(scheduleDaysSpread());
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		assert.isFalse(scheduleDaysSpread());
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		g.setWithoutSavingToDB("scheduleSpread", false);
		g.setWithoutSavingToDB("scheduleDayScale", 0.5);
		assert.isTrue(scheduleDaysSpread());

		// newScheduleWithDays gives days (so the spread flag) for a 2-team league, with a scale of 1
		resetG();
		g.setWithoutSavingToDB("realisticSchedule", true);
		g.setWithoutSavingToDB("numGamesDiv", null);
		g.setWithoutSavingToDB("numGamesConf", null);
		const teams = getTeams(2);
		g.setWithoutSavingToDB("numTeams", 2);
		g.setWithoutSavingToDB("numActiveTeams", 2);
		Math.random = makeSeededRandom(3);
		const out = newScheduleWithDays(teams);
		assert.ok(out.days);
		assert.strictEqual(out.dayScale, 1);
	});

	test("compact number of days", () => {
		assert.strictEqual(
			getCompactNumDays([
				{ homeTid: 0, awayTid: 1 },
				{ homeTid: 2, awayTid: 3 },
				{ homeTid: -3, awayTid: -3 },
				{ homeTid: 1, awayTid: 2 },
			]),
			3,
		);
	});
});
