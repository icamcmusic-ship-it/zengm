import { assert, beforeEach, describe, test } from "vitest";
import { g, helpers } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { newScheduleWithDays } from "./newSchedule.ts";
import { getScheduleRestStats } from "./groupScheduleRealistic.ts";
import type { MarqueeInput } from "./marqueeSchedule.ts";
import { createScheduleEditor, teamRepeatCost } from "./scheduleEditor.ts";

// The same opponent in consecutive games: never 3 in a row, rarely 2 (a planned 2-game set at the same venue). Measured over 50
// seeds of the default 30-team league, 82 games (per season, league-wide; before -> after this fix):
//   realistic schedule: 2-game runs 52.4 -> 2.2 (all same-venue sets, at most 1 per team), 3-game runs 3.0 -> 0 (47 of 50 seeds
//   had one before), median shortest gap between a pair's meetings 8 -> 28 days
//   with Marquee Games: 2-game runs 51.2 -> 2.1, 3-game runs 3.0 -> 0

const options = { timeout: 300_000 } as const;

const defaultTeams = () => helpers.getTeamsDefault().slice(0, 30);
const getTeams = () =>
	defaultTeams().map((t) => ({
		tid: t.tid,
		seasonAttrs: { cid: t.cid, did: t.did },
	}));

// Division rivals, as in a new league
const getInput = (): MarqueeInput => {
	const teams = defaultTeams();
	const rivalries: MarqueeInput["rivalries"] = [];
	for (const a of teams) {
		for (const b of teams) {
			if (a.tid < b.tid && a.did === b.did) {
				rivalries.push({ a: a.tid, b: b.tid, score: 3 });
			}
		}
	}
	return {
		teams: teams.map((t) => ({
			tid: t.tid,
			draw: ((t.tid * 7) % 30) / 29,
			region: t.region,
		})),
		champion: 5,
		rivalries,
	};
};

// Runs of consecutive games against the same opponent, per team
const getRuns = (
	tids: readonly (readonly [number, number])[],
	days: readonly number[],
) => {
	const games = new Map<number, { opp: number; day: number; home: number }[]>();
	for (const [i, [home, away]] of tids.entries()) {
		if (home < 0) {
			continue;
		}
		for (const [tid, opp] of [
			[home, away],
			[away, home],
		] as const) {
			let list = games.get(tid);
			if (!list) {
				list = [];
				games.set(tid, list);
			}
			list.push({ opp, day: days[i]!, home });
		}
	}
	let maxRun = 0;
	let numRepeats = 0;
	let numSets = 0;
	let maxRepeatsPerTeam = 0;
	const minGaps: number[] = [];
	for (const [tid, list] of games) {
		list.sort((a, b) => a.day - b.day);
		let run = 1;
		let repeats = 0;
		for (let i = 1; i < list.length; i++) {
			if (list[i]!.opp === list[i - 1]!.opp) {
				run += 1;
				repeats += 1;
				if (list[i]!.home === list[i - 1]!.home) {
					numSets += 0.5;
				}
			} else {
				run = 1;
			}
			maxRun = Math.max(maxRun, run);
		}
		numRepeats += repeats / 2;
		maxRepeatsPerTeam = Math.max(maxRepeatsPerTeam, repeats);

		const lastDay = new Map<number, number>();
		const minGap = new Map<number, number>();
		for (const { opp, day } of list) {
			const last = lastDay.get(opp);
			if (last !== undefined && opp > tid) {
				minGap.set(opp, Math.min(minGap.get(opp) ?? Infinity, day - last));
			}
			lastDay.set(opp, day);
		}
		minGaps.push(...minGap.values());
	}
	minGaps.sort((a, b) => a - b);
	return {
		maxRun,
		numRepeats,
		numSets,
		maxRepeatsPerTeam,
		medianMinGap: minGaps[Math.floor(minGaps.length / 2)]!,
	};
};

const avg = (values: number[]) =>
	values.reduce((a, b) => a + b, 0) / values.length;

const NUM_SEEDS = 20;

describe("same opponent in consecutive games", options, () => {
	beforeEach(() => {
		resetG();
		g.setWithoutSavingToDB("numGamesDiv", null);
		g.setWithoutSavingToDB("numGamesConf", null);
	});

	for (const marquee of [false, true]) {
		test(`realistic schedule${marquee ? " with Marquee Games" : ""}: never 3 in a row, rare 2-game sets, meetings spread out, rest unchanged`, () => {
			g.setWithoutSavingToDB("realisticSchedule", true);
			g.setWithoutSavingToDB("marqueeGames", marquee);
			const repeats = [];
			const gaps = [];
			const threeInFour = [];
			const b2b = [];
			for (let seed = 1; seed <= NUM_SEEDS; seed++) {
				Math.random = makeSeededRandom(seed);
				const output = newScheduleWithDays(
					getTeams(),
					undefined,
					marquee ? getInput() : undefined,
				);
				const runs = getRuns(output.tids, output.days!);
				assert.isAtMost(runs.maxRun, 2, `seed ${seed}`);
				// At most one 2-game set per team, at the same venue
				assert.isAtMost(runs.maxRepeatsPerTeam, 1, `seed ${seed}`);
				assert.isAtMost(runs.numRepeats, 8, `seed ${seed}`);
				assert.strictEqual(runs.numSets, runs.numRepeats, `seed ${seed}`);
				repeats.push(runs.numRepeats);
				gaps.push(runs.medianMinGap);

				const stats = [
					...getScheduleRestStats(output.tids, output.days!).values(),
				];
				threeInFour.push(avg(stats.map((s) => s.threeInFour)));
				b2b.push(avg(stats.map((s) => s.b2b)));
				const lastDay = Math.max(...output.days!);
				assert.isAtLeast(lastDay, 170);
				assert.isAtMost(lastDay, marquee ? 176 : 174);
				for (const s of stats) {
					assert.strictEqual(s.numGames, 82);
					assert.isAtMost(s.maxConsecutive, 2);
				}
			}
			// About 2 sets a season in the league (before: ~50 repeats and ~3 three-game runs)
			assert.isAtMost(avg(repeats), 4);
			// Shortest gap between a pair's meetings: about 4 weeks for the median pair (before: 8 days)
			assert.isAtLeast(avg(gaps), 20);
			assert.isAtMost(avg(threeInFour), marquee ? 1.1 : 0.9);
			assert.approximately(avg(b2b), 14, 1);
		});
	}

	test("schedule editor: a move or swap that would make 3 in a row costs a lot", () => {
		// Team 0 plays 1, 2, 1, 1 on days 1, 3, 5, 7; moving the day 3 game away from between would make 3 in a row
		const tids: [number, number][] = [
			[0, 1],
			[2, 0],
			[0, 1],
			[1, 0],
			[2, 3],
		];
		const days = [1, 3, 5, 7, 9];
		const editor = createScheduleEditor(tids, days, 12);
		assert.isAbove(editor.moveDelta(1, 8), 500);
		assert.isAbove(
			teamRepeatCost([
				[1, 1, 0],
				[2, 1, 0],
				[3, 1, 1],
			]),
			1000,
		);
		// Same venue within 2 days: a 2-game set costs less than other repeats
		assert.isBelow(
			teamRepeatCost([
				[1, 1, 0],
				[3, 1, 0],
			]),
			teamRepeatCost([
				[1, 1, 0],
				[3, 1, 1],
			]),
		);
	});
});
