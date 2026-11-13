import { assert, describe, test } from "vitest";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	COLLEGE_LEVELS,
	getCollegeLeagueTeams,
	getCollegeTournamentSize,
} from "../../../common/college/teams.ts";
import { newCollegeSchedule } from "./schedule.ts";
import { getNitSize } from "./postseason.ts";

describe("college mode teams and schedule", () => {
	test("teams: unique abbrevs, one division per conference, levels nest", () => {
		const sizes = COLLEGE_LEVELS.map((level) => {
			const { teams, confs, divs } = getCollegeLeagueTeams(level);
			assert.strictEqual(
				new Set(teams.map((t) => t.abbrev)).size,
				teams.length,
				level,
			);
			assert.strictEqual(confs.length, divs.length);
			for (const [i, t] of teams.entries()) {
				assert.strictEqual(t.tid, i);
				assert.strictEqual(t.cid, t.did);
				assert.match(t.colors[0], /^#[\da-f]{6}$/);
			}
			return teams.length;
		});
		assert.deepEqual(
			sizes,
			[...sizes].sort((a, b) => a - b),
		);
		assert.strictEqual(getCollegeTournamentSize(sizes[0]!), 32);
		assert.strictEqual(getCollegeTournamentSize(sizes[2]!), 64);
	});

	for (const level of COLLEGE_LEVELS) {
		test(`schedule (${level}): about 30 games each, once per day, conference games first in conference`, () => {
			Math.random = makeSeededRandom(1);
			const { teams } = getCollegeLeagueTeams(level);
			const { rounds, numNonConfRounds } = newCollegeSchedule(
				teams.map((t) => ({ tid: t.tid, cid: t.cid })),
				30,
			);
			const games = new Map(teams.map((t) => [t.tid, 0]));
			const home = new Map(teams.map((t) => [t.tid, 0]));
			const cid = new Map(teams.map((t) => [t.tid, t.cid]));
			for (const [r, round] of rounds.entries()) {
				const seen = new Set<number>();
				for (const [a, b] of round) {
					assert.isFalse(seen.has(a) || seen.has(b), `twice on day ${r}`);
					seen.add(a);
					seen.add(b);
					games.set(a, games.get(a)! + 1);
					games.set(b, games.get(b)! + 1);
					home.set(a, home.get(a)! + 1);
					if (r >= numNonConfRounds) {
						assert.strictEqual(cid.get(a), cid.get(b), "conference play");
					}
				}
			}
			for (const t of teams) {
				assert.isAtLeast(games.get(t.tid)!, 28, t.region);
				assert.isAtMost(games.get(t.tid)!, 31, t.region);
				assert.isAtLeast(home.get(t.tid)!, 11, t.region);
			}
			assert.isBelow(rounds.length, 50);
		});
	}

	test("NIT never has more rounds than the national tournament", () => {
		assert.strictEqual(getNitSize(360, 64), 32);
		assert.strictEqual(getNitSize(100, 32), 16);
		assert.strictEqual(getNitSize(100, 16), 16);
		// A national field cut to 8 in the settings: an 8-team NIT, played with its 3 rounds
		assert.strictEqual(getNitSize(100, 8), 8);
		assert.strictEqual(getNitSize(100, 4), 4);
		assert.strictEqual(getNitSize(30, 16), 0);
		// At least NIT size + 8 teams left out of the national field (68 teams with the First Four)
		assert.strictEqual(getNitSize(104, 64), 32);
		assert.strictEqual(getNitSize(103, 64), 0);
		assert.strictEqual(getNitSize(108, 64, 68), 32);
		assert.strictEqual(getNitSize(107, 64, 68), 0);
	});
});
