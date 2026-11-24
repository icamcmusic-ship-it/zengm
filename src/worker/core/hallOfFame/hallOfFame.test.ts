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
import {
	HOF_AWARD,
	ballotLine,
	clearHofBallotOnUnretire,
	coachHofCase,
	runHallOfFame,
} from "./index.ts";
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

	test("the threshold is recomputed every year: a lower Hall of Fame factor applies to candidates already on the ballot", async () => {
		const borderline = makePlayer(30, 9, 12);
		await resetCache({ players: [borderline] });
		await idb.cache.awards.put(awardsRow(2019));
		await runHallOfFame({});
		const first = (await idb.cache.players.get(30))!.hofBallot!;
		assert.isUndefined(first.status);

		g.setWithoutSavingToDB("hofFactor", 0.5);
		g.setWithoutSavingToDB("season", 2020);
		await idb.cache.awards.put(awardsRow(2020));
		await runHallOfFame({});
		g.setWithoutSavingToDB("hofFactor", 1);
		const second = (await idb.cache.players.get(30))!.hofBallot!;
		assert.closeTo(second.threshold, first.threshold / 2, 0.11);
		const row = (await idb.cache.awards.get(2020))!.hof!.ballot![0]!;
		assert.strictEqual(row.threshold, second.threshold);
		// Twice his old ratio: in
		assert.strictEqual(second.status, "inducted");
	});

	test("posthumous: a player who died is screened at the next ballot, the waiting period waived", async () => {
		const died = makePlayer(40, 15, 12, 2018);
		died.diedYear = 2018;
		const alive = makePlayer(41, 15, 12, 2018);
		await resetCache({ players: [died, alive] });
		await idb.cache.awards.put(awardsRow(2019));
		await runHallOfFame({});
		const p = (await idb.cache.players.get(40))!;
		assert.strictEqual(p.hofBallot?.first, 2019);
		assert.isTrue(p.hofBallot?.posthumous);
		assert.strictEqual(p.hof, 1);
		assert.include(p.hofStory?.plaque ?? "", "Inducted posthumously.");
		assert.notInclude(p.hofStory?.speech.join(" ") ?? "", "I'm not much");
		// Still waiting
		assert.isUndefined((await idb.cache.players.get(41))!.hofBallot);
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

	test("the window agrees with the ballot: eligible in the last 10 ballots, the next ballot this season or next", async () => {
		await resetCache({ players: [], awards: [] });
		const fracs = { fracs: new Map<number, number>(), default: 1 };
		// Wait 3, season 2019. After this season's ballot (draft lottery), the next one is 2020: eligible 2011 (retired 2008) is
		// screened then, eligible 2010 (retired 2007) is not
		assert.strictEqual(
			hofWatchFor(makePlayer(40, 15, 12, 2008), fracs)?.status,
			"waiting",
		);
		assert.strictEqual(
			hofWatchFor(makePlayer(41, 15, 12, 2007), fracs)?.status,
			"notWorthy",
		);
		// Before this season's ballot: eligible 2010 is still screened this season, and one eligible now is eligible this season
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		assert.strictEqual(
			hofWatchFor(makePlayer(41, 15, 12, 2007), fracs)?.status,
			"waiting",
		);
		assert.strictEqual(
			hofWatchFor(makePlayer(42, 15, 12, 2006), fracs)?.status,
			"notWorthy",
		);
		assert.strictEqual(
			hofWatchFor(makePlayer(43, 15, 12, 2016), fracs)?.eligible,
			2019,
		);
		// And the ballot itself screens exactly that window
		await resetCache({
			players: [makePlayer(41, 15, 12, 2007), makePlayer(42, 15, 12, 2006)],
		});
		await idb.cache.awards.put(awardsRow(2019));
		g.setWithoutSavingToDB("startingSeason", 2000);
		await runHallOfFame({});
		assert.isDefined((await idb.cache.players.get(41))!.hofBallot);
		assert.isUndefined((await idb.cache.players.get(42))!.hofBallot);
	});
});

describe("un-retirement", () => {
	test("a candidate who comes back loses his ballot and is screened afresh when he retires again; a Hall of Famer keeps his", () => {
		const candidate = makePlayer(50, 9, 12);
		candidate.hofBallot = {
			first: 2010,
			votes: [40, 45],
			score: 1,
			threshold: 1,
		};
		clearHofBallotOnUnretire(candidate);
		assert.isUndefined(candidate.hofBallot);

		const dropped = makePlayer(51, 9, 12);
		dropped.hofBallot = {
			first: 2010,
			votes: [3],
			score: 1,
			threshold: 1,
			status: "dropped",
		};
		clearHofBallotOnUnretire(dropped);
		assert.isUndefined(dropped.hofBallot);

		for (const status of ["inducted", "veterans"] as const) {
			const hof = makePlayer(52, 15, 12);
			const ballot = {
				first: 2010,
				votes: [90],
				score: 1,
				threshold: 1,
				status,
			};
			hof.hofBallot = ballot;
			clearHofBallotOnUnretire(hof);
			assert.strictEqual(hof.hofBallot, ballot);
		}
	});

	test("ballot line: the year as the ballot counts it, also after seasons with the ballot off", () => {
		const hofBallot = {
			first: 2010,
			votes: [60, 80],
			score: 1,
			threshold: 1,
			status: "inducted" as const,
		};
		// Voted in 2010 and (the ballot off in between) 2014: his 5th year, as the ballot's news and rows say
		assert.strictEqual(ballotLine(hofBallot, 2014), "5th year, 80.0%");
		assert.strictEqual(ballotLine(hofBallot, 2011), "2nd year, 80.0%");
		assert.strictEqual(
			ballotLine({ ...hofBallot, votes: [80] }, 2010),
			"first ballot, 80.0%",
		);
	});
});
