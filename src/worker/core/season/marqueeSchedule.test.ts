import { assert, beforeEach, describe, test } from "vitest";
import { g, helpers } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	marqueeCrowdBoost,
	marqueeHypePoints,
	marqueeLine,
	MARQUEE_CROWD,
} from "../../../common/marquee.ts";
import newScheduleGood from "./newScheduleGood.ts";
import groupScheduleRealistic, {
	getExpectedSeasonLength,
	getScheduleRestStats,
} from "./groupScheduleRealistic.ts";
import marqueeSchedule, {
	getHolidaySlates,
	getRivalPairs,
	getSlateCaps,
	pairKey,
	type MarqueeInput,
} from "./marqueeSchedule.ts";
import { newScheduleWithDays } from "./newSchedule.ts";

const options = { timeout: 120_000 } as const;

const defaultTeams = () => helpers.getTeamsDefault().slice(0, 30);

const getTeams = () =>
	defaultTeams().map((t) => ({
		tid: t.tid,
		seasonAttrs: { cid: t.cid, did: t.did },
	}));

// A league's marquee input: draw by tid (a few clear stars), division rivals, one heated rivalry, a champion
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
	rivalries.push({ a: 2, b: 20, score: 30 });
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

// The schedule as newScheduleWithDays builds it with the setting on
const build = (
	seed: number,
	input = getInput(),
	events = { allStarGame: 0.7, tradeDeadline: 0.6 },
) => {
	Math.random = makeSeededRandom(seed);
	const { tids } = newScheduleGood(getTeams());
	const slates = getHolidaySlates(82, getExpectedSeasonLength(82));
	const realistic = groupScheduleRealistic(
		tids,
		{
			...events,
			slates: getSlateCaps(slates, tids, input),
			rivals: new Set(getRivalPairs(input).keys()),
		},
		makeSeededRandom(seed + 100),
	);
	return {
		input,
		tids,
		realistic,
		output: marqueeSchedule(realistic.tids, realistic.days, input, slates),
	};
};

const gamesOn = (
	output: ReturnType<typeof marqueeSchedule>,
	day: number | undefined,
) =>
	output.tids
		.map((matchup, i) => ({ matchup, i }))
		.filter(({ matchup, i }) => output.days[i] === day && matchup[0] >= 0);

describe("marquee games schedule", options, () => {
	beforeEach(() => {
		resetG();
		g.setWithoutSavingToDB("numGamesDiv", null);
		g.setWithoutSavingToDB("numGamesConf", null);
	});

	test("same games, rest rules kept, same season length", () => {
		const threeInFour: number[] = [];
		for (const seed of [1, 2, 3, 4]) {
			const { tids, output } = build(seed);
			const key = ([home, away]: readonly [number, number]) =>
				`${home}-${away}`;
			assert.deepStrictEqual(
				output.tids
					.filter(([home]) => home >= 0)
					.map(key)
					.sort(),
				tids.map(key).sort(),
			);
			assert.strictEqual(output.marquee.length, output.tids.length);
			for (let i = 1; i < output.days.length; i++) {
				assert.isAtLeast(output.days[i]!, output.days[i - 1]!);
			}
			const stats = [
				...getScheduleRestStats(output.tids, output.days).values(),
			];
			for (const s of stats) {
				assert.strictEqual(s.numGames, 82);
				assert.strictEqual(s.sameDay, 0);
				assert.isAtMost(s.maxConsecutive, 2);
			}
			const avg = (f: (s: (typeof stats)[number]) => number) =>
				stats.reduce((sum, s) => sum + f(s), 0) / stats.length;
			assert.approximately(
				avg((s) => s.b2b),
				14,
				1.5,
			);
			threeInFour.push(avg((s) => s.threeInFour));
			assert.isAtMost(threeInFour.at(-1)!, 2);
			const lastDay = Math.max(...output.days);
			// The realistic schedule's 171-172 days, plus about 2 for the light holiday days (opening night, Christmas Eve)
			assert.isAtLeast(lastDay, 170);
			assert.isAtMost(lastDay, 175);
		}
		// About one 3-in-4 per team or fewer (0.8 over 10 seeds)
		assert.isAtMost(
			threeInFour.reduce((sum, x) => sum + x, 0) / threeInFour.length,
			1.2,
		);
	});

	test("holiday slates on their days, with the best matchups", () => {
		const { input, output } = build(1);
		const draw = new Map(input.teams.map((t) => [t.tid, t.draw]));

		// Opening night: 2 games, the champion at home
		assert.strictEqual(output.holidays.openingNight, 1);
		const opening = gamesOn(output, 1);
		assert.strictEqual(opening.length, 2);
		assert.isTrue(opening.some(({ matchup }) => matchup[0] === 5));
		for (const { i } of opening) {
			assert.strictEqual(output.marquee[i]?.marquee, "openingNight");
		}

		// Christmas: day 66 (or next to it), 5 games and nothing else, every team at most once, teams that draw
		const christmasDay = output.holidays.christmas!;
		assert.approximately(christmasDay, 66, 2);
		const christmas = gamesOn(output, christmasDay);
		// Nobody plays Christmas Eve
		assert.strictEqual(gamesOn(output, christmasDay - 1).length, 0);
		assert.strictEqual(christmas.length, 5);
		const tids = christmas.flatMap(({ matchup }) => matchup);
		assert.strictEqual(new Set(tids).size, 10);
		for (const { i } of christmas) {
			assert.strictEqual(output.marquee[i]?.marquee, "christmas");
		}
		const meanDraw =
			tids.reduce((sum, tid) => sum + draw.get(tid)!, 0) / tids.length;
		assert.isAbove(meanDraw, 0.65);

		// MLK Day: 4 tagged games among the day's games
		const mlk = gamesOn(output, output.holidays.mlk);
		assert.strictEqual(
			mlk.filter(({ i }) => output.marquee[i]?.marquee === "mlk").length,
			4,
		);
		assert.isAbove(mlk.length, 4);
	});

	test("Christmas on the All-Star break or the trade deadline: moved a day, still 5 games and nothing else", () => {
		// The All-Star break (days 65-67) or the deadline (day 66) on Christmas
		for (const events of [
			{ allStarGame: 0.38, tradeDeadline: 0.39 },
			{ allStarGame: 0.7, tradeDeadline: 0.385 },
		]) {
			for (const seed of [1, 2]) {
				const { output } = build(seed, getInput(), events);
				const eventDays = output.tids
					.map((matchup, i) => (matchup[0] < 0 ? output.days[i]! : -1))
					.filter((day) => day >= 0);
				const christmasDay = output.holidays.christmas!;
				assert.notInclude(eventDays, christmasDay);
				assert.approximately(christmasDay, 66, 3);
				const christmas = gamesOn(output, christmasDay);
				assert.strictEqual(christmas.length, 5, JSON.stringify(events));
				for (const { i } of christmas) {
					assert.strictEqual(output.marquee[i]?.marquee, "christmas");
				}
			}
		}
	});

	test("national TV: 2-4 games a week, not two on a day, spread over the teams", () => {
		const { output } = build(2);
		const lastDay = Math.max(...output.days);
		const tvCount = new Map<number, number>();
		for (let start = 1; start + 6 <= lastDay; start += 7) {
			const week = output.tids
				.map((matchup, i) => ({ matchup, i }))
				.filter(
					({ i }) =>
						output.days[i]! >= start &&
						output.days[i]! < start + 7 &&
						output.marquee[i]?.marquee !== undefined,
				);
			const tv = week.filter(
				({ i }) => output.marquee[i]?.marquee === "nationalTv",
			);
			if (gamesOn(output, start).length === 0 && week.length === 0) {
				// The All-Star break
				continue;
			}
			assert.isAtLeast(week.length, 2, `week of day ${start}`);
			assert.isAtMost(week.length, 7, `week of day ${start}`);
			assert.isAtMost(tv.length, 4, `week of day ${start}`);
			const days = tv.map(({ i }) => output.days[i]);
			assert.strictEqual(new Set(days).size, days.length);
			for (const { matchup } of tv) {
				for (const tid of matchup) {
					tvCount.set(tid, (tvCount.get(tid) ?? 0) + 1);
				}
			}
		}
		// Not only the same few teams
		assert.isAtLeast(tvCount.size, 20);
		assert.isAtMost(Math.max(...tvCount.values()), 25);
	});

	test("rivalry games: tagged, and spread over the season", () => {
		let spreadOn = 0;
		let spreadOff = 0;
		for (const seed of [1, 2]) {
			const { input, output } = build(seed);
			const rivals = getRivalPairs(input);
			// The heated rivalry and each team's top rival (in a new league, a division rival)
			assert.isTrue(rivals.has(pairKey(2, 20)));
			for (const t of input.teams) {
				assert.isTrue(
					[...rivals.keys()].some((key) =>
						key.split("-").map(Number).includes(t.tid),
					),
				);
			}
			for (const [i, [home, away]] of output.tids.entries()) {
				if (home < 0) {
					continue;
				}
				assert.strictEqual(
					!!output.marquee[i]?.rivalry,
					rivals.has(pairKey(home, away)),
				);
			}

			// The smallest gap between two meetings of a rival pair, on average, against the same league without the setting
			Math.random = makeSeededRandom(seed);
			const { tids } = newScheduleGood(getTeams());
			const plain = groupScheduleRealistic(
				tids,
				{ allStarGame: 0.7, tradeDeadline: 0.6 },
				makeSeededRandom(seed + 100),
			);
			const minGap = (out: { tids: [number, number][]; days: number[] }) => {
				const byPair = new Map<string, number[]>();
				for (const [i, [home, away]] of out.tids.entries()) {
					const key = pairKey(home, away);
					if (home >= 0 && rivals.has(key)) {
						byPair.set(key, [...(byPair.get(key) ?? []), out.days[i]!]);
					}
				}
				let sum = 0;
				for (const days of byPair.values()) {
					days.sort((a, b) => a - b);
					let gap = Infinity;
					for (let k = 1; k < days.length; k++) {
						gap = Math.min(gap, days[k]! - days[k - 1]!);
					}
					sum += gap;
				}
				return sum / byPair.size;
			};
			spreadOn += minGap(output);
			spreadOff += minGap(plain);
		}
		assert.isAbove(spreadOn, spreadOff * 1.3);
		assert.isAbove(spreadOn / 2, 20);
	});

	test("newScheduleWithDays: only with the setting and the realistic schedule", () => {
		g.setWithoutSavingToDB("realisticSchedule", true);
		g.setWithoutSavingToDB("marqueeGames", true);
		const on = newScheduleWithDays(getTeams(), undefined, getInput());
		assert.ok(on.marquee);
		assert.strictEqual(on.marquee.length, on.tids.length);
		assert.isTrue(on.marquee.some((x) => x?.marquee === "christmas"));

		// Off: the same schedule as without the input
		for (const settings of [
			{ realisticSchedule: true, marqueeGames: false },
			{ realisticSchedule: false, marqueeGames: true },
		]) {
			g.setWithoutSavingToDB("realisticSchedule", settings.realisticSchedule);
			g.setWithoutSavingToDB("marqueeGames", settings.marqueeGames);
			Math.random = makeSeededRandom(7);
			const withInput = newScheduleWithDays(getTeams(), undefined, getInput());
			Math.random = makeSeededRandom(7);
			const without = newScheduleWithDays(getTeams());
			assert.strictEqual(withInput.marquee, undefined);
			assert.deepStrictEqual(withInput, without);
		}
	});

	test("tiny leagues: national TV capped per team, the season starts on day 1", () => {
		for (const n of [2, 3, 4]) {
			g.setWithoutSavingToDB("numTeams", n);
			g.setWithoutSavingToDB("numActiveTeams", n);
			const teams = defaultTeams().slice(0, n);
			const input: MarqueeInput = {
				teams: teams.map((t) => ({
					tid: t.tid,
					draw: t.tid / n,
					region: t.region,
				})),
				champion: 0,
				rivalries: [],
			};
			for (const seed of [1, 2, 3, 4, 5]) {
				Math.random = makeSeededRandom(seed);
				const { tids } = newScheduleGood(
					teams.map((t) => ({
						tid: t.tid,
						seasonAttrs: { cid: t.cid, did: t.did },
					})),
				);
				const slates = getHolidaySlates(82, getExpectedSeasonLength(82));
				const realistic = groupScheduleRealistic(
					tids,
					{
						allStarGame: 0.7,
						tradeDeadline: 0.6,
						slates: getSlateCaps(slates, tids, input),
						rivals: new Set(),
					},
					makeSeededRandom(seed + 100),
				);
				const output = marqueeSchedule(
					realistic.tids,
					realistic.days,
					input,
					slates,
				);
				const games = output.tids
					.map((matchup, i) => ({ matchup, i }))
					.filter(({ matchup }) => matchup[0] >= 0);
				assert.strictEqual(
					Math.min(...games.map(({ i }) => output.days[i]!)),
					1,
					`${n} teams, seed ${seed}: first day`,
				);
				const tv = new Map<number, number>();
				const numGames = new Map<number, number>();
				for (const { matchup, i } of games) {
					for (const tid of matchup) {
						numGames.set(tid, (numGames.get(tid) ?? 0) + 1);
						if (output.marquee[i]?.marquee !== undefined) {
							tv.set(tid, (tv.get(tid) ?? 0) + 1);
						}
					}
				}
				for (const [tid, count] of tv) {
					assert.isAtMost(
						count,
						Math.ceil(0.15 * numGames.get(tid)!),
						`${n} teams, seed ${seed}`,
					);
				}
			}
		}
	});
});

describe("marquee game effects", () => {
	test("crowd boost is small and capped", () => {
		assert.strictEqual(marqueeCrowdBoost({}), 0);
		assert.strictEqual(
			marqueeCrowdBoost({ marquee: "nationalTv" }),
			MARQUEE_CROWD.nationalTv,
		);
		assert.strictEqual(
			marqueeCrowdBoost({ marquee: "christmas", rivalry: true }),
			MARQUEE_CROWD.max,
		);
		assert.isAtMost(MARQUEE_CROWD.max, 0.25);
	});

	test("lines and hype", () => {
		assert.strictEqual(marqueeLine({}), undefined);
		assert.strictEqual(
			marqueeLine({ marquee: "christmas", rivalry: true }),
			"Christmas Day showcase, on national TV, a rivalry game",
		);
		assert.strictEqual(marqueeLine({ rivalry: true }), "Rivalry game");
		assert.isAbove(
			marqueeHypePoints({ marquee: "christmas" }),
			marqueeHypePoints({ marquee: "nationalTv" }),
		);
	});
});
