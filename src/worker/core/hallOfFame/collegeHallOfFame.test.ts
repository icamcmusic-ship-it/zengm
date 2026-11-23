// College Hall of Fame (docs/native-features.md, College Hall of Fame): the score, the seeded class and the committee's season, and a
// pro league left alone. A whole headless college league is in collegeHallOfFame.league.test.ts
import { afterEach, assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { COACH_RETIRED } from "../../../common/staff.ts";
import {
	COLLEGE_COACH_HOF_THRESHOLD,
	COLLEGE_HOF_AWARD,
	COLLEGE_HOF_MIN,
	COLLEGE_HOF_WAIT,
	collegeCoachHofCase,
	collegeHofCase,
	collegeHofClassSize,
	collegeHofVote,
} from "../../../common/college/hallOfFame.ts";
import type { Coach, Player, TeamSeason } from "../../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { runHallOfFame } from "./index.ts";

// A player who left school in `exit` after `n` seasons at school `tid`, with `ws` win shares a season and some awards
const makeCollegePlayer = (
	pid: number,
	{
		exit,
		n = 4,
		ws,
		tid = pid % 4,
		awards = [],
	}: {
		exit: number;
		n?: number;
		ws: number;
		tid?: number;
		awards?: Player["awards"];
	},
): Player =>
	({
		pid,
		tid: PLAYER.RETIRED,
		firstName: "Player",
		lastName: `${pid}`,
		stats: Array.from({ length: n }, (_, i) => ({
			season: exit - n + 1 + i,
			tid,
			playoffs: false,
			gp: 30,
			ws,
			pts: 450,
			trb: 150,
			ast: 90,
		})),
		statsTids: [tid],
		ratings: [{ season: exit, pos: "G", ovr: 50, pot: 50 }],
		awards,
		draft: { year: exit - n, round: 0, pick: 0, tid: -1, originalTid: -1 },
		retiredYear: exit,
		collegeExit: { season: exit, type: "graduated", tid },
		born: { year: exit - 22, loc: "" },
		college: "",
		hgt: 78,
		injury: { type: "Healthy", gamesRemaining: 0 },
		contract: { amount: 0, exp: exit },
		contracts: [],
	}) as unknown as Player;

const poy = (season: number) =>
	({
		season,
		name: "Player of the Year",
		shortName: "POY",
		index: 0,
		rank: 1,
		actAs: "mvp",
	}) as unknown as Player["awards"][number];

const allAmerican = (season: number, rank: number) =>
	({
		season,
		name: "All-American",
		shortName: "AA",
		index: 5,
		rank,
		numTeams: 3,
	}) as unknown as Player["awards"][number];

const awardsRow = (season: number) => ({
	season,
	bestRecord: 0,
	bestRecordConfs: {},
	bestRecordDivs: {},
	awards: [],
});

const teamSeason = (tid: number, season: number, playoffRoundsWon: number) =>
	({
		tid,
		season,
		playoffRoundsWon,
		won: 20,
		lost: 10,
	}) as unknown as TeamSeason;

const SEASON = 2030;

let league: unknown;

beforeEach(() => {
	resetG();
	league = idb.league;
	idb.league = mockIDBLeague();
	g.setWithoutSavingToDB("lid", 1);
	g.setWithoutSavingToDB("startingSeason", 2015);
	g.setWithoutSavingToDB("season", SEASON);
	g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
	g.setWithoutSavingToDB("leagueType", "college");
});

afterEach(() => {
	idb.league = league as any;
});

describe("score", () => {
	const none = () => undefined;

	test("awards, production, team success and seasons add up", () => {
		const p = makeCollegePlayer(1, {
			exit: 2020,
			ws: 2,
			awards: [poy(2020), allAmerican(2019, 2), allAmerican(2020, 1)],
		});
		const plain = collegeHofCase({ ...p, awards: [] } as any, none);
		// 8 WS × 0.5 and 4 seasons × 0.5
		assert.closeTo(plain.score, 6, 1e-9);
		const decorated = collegeHofCase(p as any, none);
		assert.closeTo(decorated.score - plain.score, 10 + 3 + 5, 1e-9);
		assert.strictEqual(decorated.poy, 1);
		assert.strictEqual(decorated.allAmerican, 2);
		assert.strictEqual(decorated.firstTeamAllAmerican, 1);
		assert.include(decorated.line, "Player of the Year");
		assert.include(decorated.line, "2× All-American (1 first team)");

		// His team won it all in 2019 (4 rounds) and reached the tournament in 2020
		const withTitle = collegeHofCase(p as any, (tid, season) =>
			season === 2019
				? { roundsWon: 4, numRounds: 4 }
				: season === 2020
					? { roundsWon: 0, numRounds: 4 }
					: undefined,
		);
		assert.closeTo(withTitle.score - decorated.score, 4 + 1.5 + 2 * 0.4, 1e-9);
		assert.strictEqual(withTitle.titles, 1);
		assert.include(withTitle.line, "national champion");
	});

	test("a transfer's schools are both listed, in order", () => {
		const p = makeCollegePlayer(2, { exit: 2020, ws: 1 });
		p.stats[2]!.tid = 7;
		p.stats[3]!.tid = 7;
		assert.deepEqual(collegeHofCase(p as any, none).tids, [2, 7]);
	});

	test("seeded class size and committee view", () => {
		const sizes = new Map<number, number>();
		for (let season = 2000; season < 2400; season++) {
			const size = collegeHofClassSize(season);
			assert.strictEqual(size, collegeHofClassSize(season));
			sizes.set(size, (sizes.get(size) ?? 0) + 1);
		}
		assert.deepEqual([...sizes.keys()].sort(), [2, 3, 4]);
		const mean = [...sizes].reduce((sum, [size, n]) => sum + size * n, 0) / 400;
		assert.isAbove(mean, 2.5);
		assert.isBelow(mean, 3.1);
		assert.strictEqual(
			collegeHofVote(5, 2030, 20),
			collegeHofVote(5, 2030, 20),
		);
		assert.notStrictEqual(
			collegeHofVote(5, 2030, 20),
			collegeHofVote(5, 2031, 20),
		);
	});

	test("coach case", () => {
		const rows = Array.from({ length: 20 }, (_, i) => ({
			role: "head",
			season: 2000 + i,
			won: 24,
			lost: 8,
			playoffRoundsWon: i % 5 === 0 ? 4 : i % 2 === 0 ? 1 : -1,
		}));
		const c = collegeCoachHofCase(rows, 2, () => 4);
		assert.strictEqual(c.titles, 4);
		assert.strictEqual(c.finalFours, 4);
		assert.isAbove(c.score, COLLEGE_COACH_HOF_THRESHOLD);
		assert.include(c.line, "480-160");
	});
});

describe("committee season", () => {
	test("inducts a class of the best eligible candidates, once", async () => {
		const big = [poy(2025), allAmerican(2025, 1), allAmerican(2024, 1)];
		const players = [
			// Eligible (left 2025-2027), in order of their case
			makeCollegePlayer(1, { exit: 2027, ws: 3, awards: big }),
			makeCollegePlayer(2, { exit: 2026, ws: 5, awards: big }),
			makeCollegePlayer(3, {
				exit: 2025,
				ws: 9.5,
				tid: 0,
				awards: big.slice(2),
			}),
			makeCollegePlayer(4, {
				exit: 2027,
				ws: 9.5,
				tid: 0,
				awards: big.slice(2),
			}),
			makeCollegePlayer(5, {
				exit: 2026,
				ws: 9.5,
				tid: 0,
				awards: big.slice(2),
			}),
			// Below the bar
			makeCollegePlayer(6, { exit: 2027, ws: 1 }),
			// Left too recently (eligible 2031)
			makeCollegePlayer(7, { exit: 2028, ws: 6, awards: big }),
		];
		// Still in school
		const active = makeCollegePlayer(8, { exit: 2030, ws: 4, awards: big });
		active.tid = 0;
		active.retiredYear = Infinity;
		delete active.collegeExit;
		players.push(active);

		await resetCache({
			players,
			teamSeasons: [teamSeason(1, 2025, 4)],
		});
		await idb.cache.awards.put(awardsRow(SEASON));

		await runHallOfFame({});

		const classSize = collegeHofClassSize(SEASON);
		const record = (await idb.cache.awards.get(SEASON))!.collegeHof!;
		assert.strictEqual(record.classSize, classSize);
		assert.strictEqual(record.candidates, 5);
		assert.lengthOf(record.players, classSize);
		const inducted = record.players.map((row) => row.pid);
		// The two best cases are far ahead of the rest: always in
		assert.includeMembers(inducted, [1, 2]);
		for (const row of record.players) {
			assert.isAtLeast(row.score, COLLEGE_HOF_MIN);
			const p = (await idb.cache.players.get(row.pid))!;
			assert.strictEqual(p.collegeHof, SEASON);
			assert.isTrue(
				p.awards.some(
					(a) => a.type === COLLEGE_HOF_AWARD && a.season === SEASON,
				),
			);
		}
		for (const pid of [6, 7, 8]) {
			assert.isUndefined((await idb.cache.players.get(pid))!.collegeHof);
		}
		const news = (await idb.cache.events.getAll()).filter(
			(e) => e.type === "hallOfFame",
		);
		assert.isTrue(news.some((e) => e.text?.includes(`Class of ${SEASON}`)));

		// Next season the rest of the pool and the player who has now waited long enough are candidates; nobody goes in twice
		g.setWithoutSavingToDB("season", SEASON + 1);
		await idb.cache.awards.put(awardsRow(SEASON + 1));
		await runHallOfFame({});
		const next = (await idb.cache.awards.get(SEASON + 1))!.collegeHof!;
		assert.strictEqual(next.candidates, 5 - classSize + 1);
		assert.include(
			next.players.map((row) => row.pid),
			7,
		);
		for (const row of next.players) {
			assert.notInclude(inducted, row.pid);
		}
		assert.isFalse(next.players.some((row) => row.pid === 8));
	});

	test("a retired college coach with a big case, after the wait", async () => {
		const coach = (cid: number, retiredYear: number, won: number) =>
			({
				cid,
				tid: COACH_RETIRED,
				role: "head",
				firstName: "Coach",
				lastName: `${cid}`,
				retiredYear,
				awards: [],
				stats: Array.from({ length: 25 }, (_, i) => ({
					season: retiredYear - 25 + i,
					tid: 3,
					role: "head",
					won,
					lost: 30 - won,
					playoffRoundsWon: won >= 24 && i % 4 === 0 ? 4 : won >= 24 ? 1 : -1,
				})),
			}) as unknown as Coach;
		await resetCache({ players: [] });
		for (const c of [
			coach(1, SEASON - COLLEGE_HOF_WAIT, 25),
			coach(2, SEASON - 1, 25),
			coach(3, SEASON - COLLEGE_HOF_WAIT, 14),
		]) {
			await idb.cache.coaches.put(c);
		}
		await idb.cache.awards.put(awardsRow(SEASON));
		await runHallOfFame({});
		assert.strictEqual((await idb.cache.coaches.get(1))!.hof, SEASON);
		assert.isUndefined((await idb.cache.coaches.get(2))!.hof);
		assert.isUndefined((await idb.cache.coaches.get(3))!.hof);
		const record = (await idb.cache.awards.get(SEASON))!.collegeHof!;
		assert.deepEqual(
			record.coaches.map((row) => row.cid),
			[1],
		);
	});
});

describe("pro league", () => {
	test("unchanged: no college inductions, no college record", async () => {
		g.setWithoutSavingToDB("leagueType", "pro");
		g.setWithoutSavingToDB("featureHofBallot", true);
		g.setWithoutSavingToDB("hofBallotWait", 3);
		g.setWithoutSavingToDB("hofVeteransCommittee", false);
		const big = [poy(2025), allAmerican(2025, 1)];
		await resetCache({
			players: [makeCollegePlayer(1, { exit: 2026, ws: 4, awards: big })],
		});
		await idb.cache.awards.put(awardsRow(SEASON));
		await runHallOfFame({});
		const p = (await idb.cache.players.get(1))!;
		assert.isUndefined(p.collegeHof);
		assert.isFalse(p.awards.some((a) => a.type === COLLEGE_HOF_AWARD));
		assert.isUndefined((await idb.cache.awards.get(SEASON))!.collegeHof);
	});
});
