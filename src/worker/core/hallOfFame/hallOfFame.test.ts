import { afterEach, assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { COACH_RETIRED } from "../../../common/staff.ts";
import {
	HOF_INDUCT_PCT,
	HOF_MAX_YEARS,
	ballotCareer,
	ballotChance,
	ballotResult,
	votePct,
	voterLean,
	yearNoise,
} from "../../../common/hofBallot.ts";
import type { Coach, Player } from "../../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { HOF_AWARD, coachHofCase, runHallOfFame } from "./index.ts";
import { hofWatchFor, projectHofScore } from "./watch.ts";
import retire from "../player/retire.ts";
import { hofScoreBasketball } from "../player/madeHof.basketball.ts";

// A retired player with `n` seasons of the same value (value = (dws + ows + ewa) / 2)
const makePlayer = (
	pid: number,
	value: number,
	n: number,
	retiredYear = 2016,
): Player =>
	({
		pid,
		tid: PLAYER.RETIRED,
		firstName: "Player",
		lastName: `${pid}`,
		stats: Array.from({ length: n }, (_, i) => ({
			season: retiredYear - n + 1 + i,
			tid: pid % 3,
			playoffs: false,
			gp: 82,
			dws: value / 2,
			ows: value / 2,
			ewa: value,
		})),
		statsTids: [pid % 3],
		ratings: [],
		awards: [],
		draft: {
			year: retiredYear - n - 1,
			round: 1,
			pick: 1,
			tid: 0,
			originalTid: 0,
		},
		retiredYear,
		born: { year: retiredYear - n - 22, loc: "" },
		college: "",
		hgt: 78,
		injury: { type: "Healthy", gamesRemaining: 0 },
		contract: { amount: 1000, exp: retiredYear },
		contracts: [],
	}) as unknown as Player;

const awardsRow = (season: number) => ({
	season,
	bestRecord: 0,
	bestRecordConfs: {},
	bestRecordDivs: {},
	awards: [],
});

let league: unknown;

beforeEach(() => {
	resetG();
	league = idb.league;
	idb.league = mockIDBLeague();
	g.setWithoutSavingToDB("lid", 1);
	g.setWithoutSavingToDB("season", 2019);
	g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
	g.setWithoutSavingToDB("featureHofBallot", true);
	g.setWithoutSavingToDB("hofBallotWait", 3);
	g.setWithoutSavingToDB("hofVeteransCommittee", false);
});

afterEach(() => {
	idb.league = league as any;
});

describe("vote model", () => {
	test("seeded: the same player and season always get the same share", () => {
		assert.strictEqual(voterLean(5), voterLean(5));
		assert.strictEqual(yearNoise(5, 2030), yearNoise(5, 2030));
		assert.notStrictEqual(yearNoise(5, 2030), yearNoise(5, 2031));
		assert.deepEqual(ballotCareer(7, 1.02, 2030), ballotCareer(7, 1.02, 2030));
	});

	test("a better case gets more votes, and support grows on the ballot", () => {
		const at = (ratio: number, year: number) =>
			votePct({ ratio, year, lean: 0, noise: 0 });
		assert.isBelow(at(0.8, 1), at(1, 1));
		assert.isBelow(at(1, 1), at(1.3, 1));
		assert.isBelow(at(1, 1), at(1, 5));
		assert.isAtLeast(at(1.5, 1), 98);
		assert.isBelow(at(0.6, 1), 5);
	});

	test("results: 75% in, under 5% out, 10 years at most", () => {
		assert.strictEqual(ballotResult(HOF_INDUCT_PCT, 1), "inducted");
		assert.strictEqual(ballotResult(4.75, 2), "dropped");
		assert.strictEqual(ballotResult(50, HOF_MAX_YEARS), "expired");
		assert.strictEqual(ballotResult(50, 3), undefined);
	});

	test("chance is 0-1 and rises with the score", () => {
		const low = ballotChance({ pid: 1, ratio: 0.9, year: 1 });
		const mid = ballotChance({ pid: 1, ratio: 1, year: 1 });
		const high = ballotChance({ pid: 1, ratio: 1.3, year: 1 });
		assert.isAtLeast(low, 0);
		assert.isAtMost(high, 1);
		assert.isBelow(low, mid);
		assert.isBelow(mid, high);
		assert.isAbove(high, 0.95);
	});
});

describe("ballot", () => {
	test("screens, votes, inducts and records the class; running twice changes nothing", async () => {
		const great = makePlayer(1, 15, 12);
		const borderline = makePlayer(2, 9, 12);
		const role = makePlayer(3, 2, 10);
		// Retired too recently: not eligible until 2020
		const recent = makePlayer(4, 15, 12, 2017);
		await resetCache({
			players: [great, borderline, role, recent],
		});
		await idb.cache.awards.put(awardsRow(2019));

		await runHallOfFame({});

		const p1 = (await idb.cache.players.get(1))!;
		assert.strictEqual(p1.hof, 1);
		assert.strictEqual(p1.hofBallot?.status, "inducted");
		assert.strictEqual(p1.hofBallot?.votes.length, 1);
		assert.isAtLeast(p1.hofBallot!.votes[0]!, HOF_INDUCT_PCT);
		assert.isTrue(
			p1.awards.some((a) => a.type === HOF_AWARD && a.season === 2019),
		);

		const p2 = (await idb.cache.players.get(2))!;
		assert.isUndefined(p2.hof);
		assert.strictEqual(p2.hofBallot?.first, 2019);
		assert.isUndefined(p2.hofBallot?.status);

		assert.isUndefined((await idb.cache.players.get(3))!.hofBallot);
		assert.isUndefined((await idb.cache.players.get(4))!.hofBallot);

		const awards = (await idb.cache.awards.get(2019))!;
		assert.deepEqual(
			awards.hof?.ballot?.map((row) => [row.pid, row.year, row.result]),
			[
				[1, 1, "inducted"],
				[2, 1, undefined],
			],
		);

		// Same season again: no second vote
		await runHallOfFame({});
		assert.strictEqual(
			(await idb.cache.players.get(2))!.hofBallot?.votes.length,
			1,
		);

		// Next season: the borderline player's second year
		g.setWithoutSavingToDB("season", 2020);
		await idb.cache.awards.put(awardsRow(2020));
		await runHallOfFame({});
		const p2b = (await idb.cache.players.get(2))!;
		assert.strictEqual(p2b.hofBallot?.votes.length, 2);
		assert.strictEqual(
			(await idb.cache.players.get(4))!.hofBallot?.first,
			2020,
		);
	});

	test("retirement: inducted at once with the ballot off, not with it on", async () => {
		const ballotOn = makePlayer(10, 15, 12, 2019);
		const ballotOff = makePlayer(11, 15, 12, 2019);
		for (const p of [ballotOn, ballotOff]) {
			p.tid = 0;
			p.retiredYear = Infinity;
		}
		await resetCache({ players: [ballotOn, ballotOff], awards: [] });

		await retire(ballotOn, {});
		assert.isUndefined(ballotOn.hof);

		g.setWithoutSavingToDB("featureHofBallot", false);
		await retire(ballotOff, {});
		assert.strictEqual(ballotOff.hof, 1);
	});
});

describe("coaches wing", () => {
	test("a retired coach with a big record is inducted, an ordinary one is not", async () => {
		const coach = (cid: number, won: number, titles: number): Coach =>
			({
				cid,
				firstName: "Coach",
				lastName: `${cid}`,
				tid: COACH_RETIRED,
				role: "head",
				retiredYear: 2019,
				stats: Array.from({ length: 15 }, (_, i) => ({
					season: 2004 + i,
					tid: 0,
					role: "head",
					won,
					lost: 82 - won,
					tied: 0,
					otl: 0,
					playoffRoundsWon: i < titles ? 4 : 0,
				})),
				awards: [],
				transactions: [],
			}) as unknown as Coach;
		const great = coach(1, 58, 3);
		const ordinary = coach(2, 38, 0);
		assert.isAbove(coachHofCase(great).score, coachHofCase(ordinary).score);
		g.setWithoutSavingToDB("featureHofBallot", false);
		await resetCache({
			players: [],
		});
		await idb.cache.coaches.put(great);
		await idb.cache.coaches.put(ordinary);
		await idb.cache.awards.put(awardsRow(2019));
		await runHallOfFame({});
		assert.strictEqual((await idb.cache.coaches.get(1))!.hof, 2019);
		assert.isUndefined((await idb.cache.coaches.get(2))!.hof);
		assert.strictEqual(
			(await idb.cache.awards.get(2019))!.hof?.wing?.[0]?.id,
			1,
		);
	});
});

describe("watch", () => {
	test("projection adds the rest of a young player's career", () => {
		const p = makePlayer(20, 10, 4, 2019);
		p.tid = 0;
		p.born.year = 2019 - 24;
		const { score, threshold, seasons, fudgeSeasons } = hofScoreBasketball(p);
		const projection = projectHofScore({
			seasons,
			fudgeSeasons,
			score,
			threshold,
			age: 24,
			season: 2019,
			frac: 1,
		});
		assert.isAbove(projection.projected, score);
		assert.isAbove(projection.yearsLeft, 5);

		// An old player has little left
		const old = projectHofScore({
			seasons,
			fudgeSeasons,
			score,
			threshold,
			age: 37,
			season: 2019,
			frac: 1,
		});
		assert.isBelow(old.projected, projection.projected);
	});

	test("statuses", async () => {
		await resetCache({ players: [], awards: [] });
		const fracs = { fracs: new Map<number, number>(), default: 1 };
		const waiting = makePlayer(30, 15, 12, 2018);
		assert.strictEqual(hofWatchFor(waiting, fracs)?.status, "waiting");
		assert.strictEqual(hofWatchFor(waiting, fracs)?.eligible, 2021);

		const active = makePlayer(31, 12, 6, 2019);
		active.tid = 0;
		const w = hofWatchFor(active, fracs)!;
		assert.strictEqual(w.status, "active");
		assert.isAtLeast(w.chance, 0);
		assert.isAtMost(w.chance, 1);
		// Deterministic
		assert.deepEqual(hofWatchFor(active, fracs), w);
	});
});
