import { assert, describe, test } from "vitest";
import { PHASE, PLAYER } from "./constants.ts";
import {
	STASH_MAX_AGE,
	STASH_MAX_SEASONS,
	aiShouldBringOver,
	aiShouldStash,
	bringOverBlockedReason,
	getOverseasLeague,
	getStashBuyout,
	getStashContract,
	getStashLapseSeason,
	rotationOvr,
	simulateStashSeason,
	stashBlockedReason,
	stashRightsLapse,
} from "./draftStash.ts";
import {
	getPreDraftStats,
	getProStats,
	isPreDraftStatsRow,
} from "./preDraft.ts";
import { RATING_KEYS, type Ratings } from "./collegeStats/types.ts";

const ratings = Object.fromEntries(
	RATING_KEYS.map((key) => [key, 50]),
) as unknown as Ratings;

describe("draft-and-stash rules", () => {
	test("overseas league comes from his last pre-draft row, then his career or college", () => {
		const p = {
			draft: { year: 2025 },
			college: "",
			stats: [
				{ tid: PLAYER.DOES_NOT_EXIST, season: 2024, teamName: "Duke" },
				{ tid: PLAYER.DOES_NOT_EXIST, season: 2025, teamName: "Liga ACB" },
			],
		};
		assert.strictEqual(getOverseasLeague(p), "Liga ACB");
		// College last: not overseas
		p.stats.reverse();
		p.stats[1]!.season = 2023;
		assert.strictEqual(getOverseasLeague(p), "Liga ACB");
		p.stats[0]!.season = 2025;
		p.stats[0]!.teamName = "Duke";
		assert.isUndefined(getOverseasLeague(p));
		// The G League is not overseas
		assert.isUndefined(
			getOverseasLeague({
				draft: { year: 2025 },
				stats: [],
				college: "NBA G League",
			}),
		);
		assert.strictEqual(
			getOverseasLeague({
				draft: { year: 2025 },
				stats: [],
				college: "EuroLeague",
			}),
			"EuroLeague",
		);
		// A stash row after the draft year counts
		assert.strictEqual(
			getOverseasLeague({
				draft: { year: 2025 },
				college: "",
				stats: [
					{ tid: PLAYER.DOES_NOT_EXIST, season: 2025, teamName: "Duke" },
					{
						tid: PLAYER.DOES_NOT_EXIST,
						season: 2026,
						teamName: "Turkish BSL",
						stash: true,
					},
					{ tid: 3, season: 2027 },
				],
			}),
			"Turkish BSL",
		);
	});

	test("stash rows are pre-draft (overseas), never pro", () => {
		const p = {
			draft: { year: 2025 },
			stats: [
				{ tid: PLAYER.DOES_NOT_EXIST, season: 2025 },
				{ tid: PLAYER.DOES_NOT_EXIST, season: 2026, stash: true as const },
				// An old pro row of a team that no longer exists stays pro
				{ tid: PLAYER.DOES_NOT_EXIST, season: 2027 },
				{ tid: 2, season: 2028 },
			],
		};
		assert.isTrue(isPreDraftStatsRow(p.stats[1]!, 2025));
		assert.deepEqual(
			getPreDraftStats(p).map((row) => row.season),
			[2025, 2026],
		);
		assert.deepEqual(
			getProStats(p).map((row) => row.season),
			[2027, 2028],
		);
	});

	test("rights lapse 4 seasons after the draft or at 27", () => {
		const young = { draft: { year: 2025 }, born: { year: 2006 } };
		assert.strictEqual(getStashLapseSeason(young), 2025 + STASH_MAX_SEASONS);
		assert.isFalse(stashRightsLapse(young, 2028));
		assert.isTrue(stashRightsLapse(young, 2029));
		const old = { draft: { year: 2025 }, born: { year: 2000 } };
		assert.strictEqual(getStashLapseSeason(old), 2000 + STASH_MAX_AGE);
		assert.isTrue(stashRightsLapse(old, 2027));
	});

	test("who can be stashed, and when", () => {
		const p = { tid: 4, draft: { year: 2025, round: 2 } };
		const base = {
			p,
			season: 2025,
			phase: PHASE.AFTER_DRAFT,
			hasProStats: false,
			overseasLeague: "EuroLeague",
		};
		assert.isUndefined(stashBlockedReason(base));
		for (const phase of [
			PHASE.DRAFT,
			PHASE.RESIGN_PLAYERS,
			PHASE.FREE_AGENCY,
		]) {
			assert.isUndefined(stashBlockedReason({ ...base, phase }));
		}
		assert.isString(stashBlockedReason({ ...base, phase: PHASE.PRESEASON }));
		assert.isString(stashBlockedReason({ ...base, overseasLeague: undefined }));
		assert.isString(stashBlockedReason({ ...base, season: 2026 }));
		assert.isString(stashBlockedReason({ ...base, hasProStats: true }));
		assert.isString(
			stashBlockedReason({ ...base, p: { ...p, tid: PLAYER.FREE_AGENT } }),
		);

		assert.isUndefined(
			bringOverBlockedReason({
				phase: PHASE.RESIGN_PLAYERS,
				rosterSize: 14,
				maxRosterSize: 15,
			}),
		);
		assert.isString(
			bringOverBlockedReason({
				phase: PHASE.RESIGN_PLAYERS,
				rosterSize: 15,
				maxRosterSize: 15,
			}),
		);
		assert.isString(
			bringOverBlockedReason({
				phase: PHASE.REGULAR_SEASON,
				rosterSize: 10,
				maxRosterSize: 15,
			}),
		);
	});

	test("contract: rookie scale inside the window, market value after", () => {
		const base = {
			draftYear: 2025,
			rookieAmount: 2000,
			rookieLength: 2,
			marketAmount: 3500,
			minContract: 1000,
		};
		assert.deepEqual(getStashContract({ ...base, season: 2025 }), {
			amount: 2000,
			exp: 2027,
			rookie: true,
		});
		assert.deepEqual(getStashContract({ ...base, season: 2026 }), {
			amount: 2000,
			exp: 2028,
			rookie: true,
		});
		assert.deepEqual(getStashContract({ ...base, season: 2027 }), {
			amount: 3500,
			exp: 2030,
			rookie: false,
		});
		// No rookie scale: market value, never below the minimum
		assert.deepEqual(
			getStashContract({
				...base,
				season: 2025,
				rookieAmount: undefined,
				marketAmount: 500,
			}),
			{ amount: 1000, exp: 2028, rookie: false },
		);
	});

	test("buyout: none the offseason he was stashed, more for stronger leagues", () => {
		const minContract = 1000;
		assert.strictEqual(
			getStashBuyout({ league: "EuroLeague", seasonsAbroad: 0, minContract }),
			0,
		);
		const top = getStashBuyout({
			league: "EuroLeague",
			seasonsAbroad: 2,
			minContract,
		});
		const lower = getStashBuyout({
			league: "Polish PLK",
			seasonsAbroad: 2,
			minContract,
		});
		assert.isAbove(top, 0);
		assert.isAtMost(top, minContract);
		assert.isAbove(top, lower);
		assert.isAbove(lower, 0);
	});

	test("AI rules", () => {
		assert.strictEqual(rotationOvr([50, 60, 40], 2), 50);
		assert.strictEqual(rotationOvr([50], 10), 0);
		const stash = {
			pickNum: 40,
			ovr: 40,
			teamRotationOvr: 48,
			rosterSize: 14,
			maxRosterSize: 15,
		};
		assert.isTrue(aiShouldStash(stash));
		// Lottery picks are never stashed by the AI
		assert.isFalse(aiShouldStash({ ...stash, pickNum: 5 }));
		// Ready enough, room on the roster
		assert.isFalse(aiShouldStash({ ...stash, ovr: 46 }));
		// A late first-round pick comes over unless he is far from playing
		assert.isFalse(aiShouldStash({ ...stash, pickNum: 25 }));
		assert.isTrue(aiShouldStash({ ...stash, pickNum: 25, ovr: 36 }));
		// Ready enough, but no room
		assert.isTrue(aiShouldStash({ ...stash, ovr: 46, rosterSize: 16 }));

		const bring = {
			ovr: 47,
			teamRotationOvr: 48,
			rosterSize: 13,
			maxRosterSize: 15,
			lastChance: false,
		};
		assert.isTrue(aiShouldBringOver(bring));
		assert.isFalse(aiShouldBringOver({ ...bring, ovr: 45 }));
		assert.isTrue(aiShouldBringOver({ ...bring, ovr: 45, lastChance: true }));
		assert.isFalse(aiShouldBringOver({ ...bring, rosterSize: 15 }));
	});

	test("overseas season: deterministic, a pro club line", () => {
		const input = {
			pid: 12,
			season: 2027,
			league: "EuroLeague",
			ratings,
			ovr: 45,
			age: 22,
			pos: "SF",
		};
		const a = simulateStashSeason(input);
		const b = simulateStashSeason(input);
		assert.deepEqual(a, b);
		const c = simulateStashSeason({ ...input, season: 2028 });
		assert.notDeepEqual(a.stats, c.stats);
		assert.strictEqual(a.season, 2027);
		assert.strictEqual(a.school, "EuroLeague");
		const gp = a.stats.gp!;
		assert.isAbove(gp, 10);
		assert.isAtMost(gp, 44);
		// EuroLeague minutes are capped well below a college star's
		assert.isAtMost(a.stats.min! / gp, 30.5);
		// A better player plays a bigger role
		const better = simulateStashSeason({ ...input, ovr: 60 });
		assert.isAbove(
			better.stats.min! / better.stats.gp!,
			(a.stats.min! / gp) * 0.95,
		);
	});
});
