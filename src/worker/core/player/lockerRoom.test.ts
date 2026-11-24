// Locker room mood: weighted by value share (a star's ego counts more than the 15th man's), cached per team and never stale, and the
// worst egos named only when the user knows them
import { afterEach, assert, describe, test } from "vitest";
import {
	lockerRoomMood,
	lockerRoomWeight,
} from "../../../common/playerTraits/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import {
	getLockerRoomMood,
	getLockerRoomWorstEgos,
	setLockerRoomCache,
	setTraitScores,
} from "./traits.ts";

const mk = (pid: number, ego: number, valueNoPot: number) => {
	const p: any = {
		pid,
		tid: 0,
		born: { year: 1995 },
		draft: { year: 2015 },
		ratings: [{ season: 2025 }],
		valueNoPot,
	};
	setTraitScores(p, { ego }, 2025);
	return p;
};

const setup = () => {
	resetG();
	g.setWithoutSavingToDB("season", 2025);
	g.setWithoutSavingToDB("playerTraits", true);
	g.setWithoutSavingToDB("playerTraitsSeed", 777);
};

afterEach(() => {
	setLockerRoomCache(true);
});

describe("locker room", () => {
	test("equal values: exactly the head-count sum; a diva star counts more than a diva benchwarmer", () => {
		assert.closeTo(
			lockerRoomMood([20, 50, 80, 30], [55, 55, 55, 55]),
			lockerRoomMood([20, 50, 80, 30]),
			1e-12,
		);
		const roster = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
		const values = [72, 65, 60, 58, 55, 52, 50, 48, 47, 46, 45, 44, 42];
		const divaStar = lockerRoomMood([10, ...roster.slice(1)], values);
		const divaBench = lockerRoomMood(
			[...roster.slice(1), 10],
			[...values.slice(1), values[0]!],
		);
		const divaLast = lockerRoomMood([...roster.slice(0, -1), 10], values);
		assert.isBelow(divaStar, divaLast);
		assert.closeTo(divaBench, divaStar, 1e-12);
		assert.isBelow(divaStar, lockerRoomMood([10, ...roster.slice(1)]));
		assert.isAbove(divaLast, lockerRoomMood([...roster.slice(0, -1), 10]));
		// Bounded as before
		assert.isAtLeast(lockerRoomMood([0, 0], [90, 41]), -2.5);
		assert.isAtMost(lockerRoomMood([100, 100], [90, 41]), 1.5);
		assert.strictEqual(lockerRoomWeight(Number.NaN), 2);
	});

	test("league mean stays where head-count weighting had it (about 0, apart from the asymmetric bounds)", () => {
		let sum = 0;
		let sumHeadCount = 0;
		const N = 2000;
		let seed = 1;
		const rand = () => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		for (let i = 0; i < N; i++) {
			const egos = Array.from({ length: 13 }, () => 10 + 80 * rand());
			const values = Array.from({ length: 13 }, () => 40 + 35 * rand());
			sum += lockerRoomMood(egos, values);
			sumHeadCount += lockerRoomMood(egos);
		}
		assert.closeTo(sum / N, sumHeadCount / N, 0.05);
		assert.closeTo(sum / N, 0, 0.15);
	});

	test("cached per team, always the same answer as working it out, and fresh after any roster change", () => {
		setup();
		const roster = [mk(0, 20, 70), mk(1, 60, 60), mk(2, 50, 50), mk(3, 80, 45)];
		const fresh = (p: any, players: any[]) => {
			setLockerRoomCache(false);
			const x = getLockerRoomMood(p, players, 0);
			setLockerRoomCache(true);
			return x;
		};
		for (const p of [...roster, mk(9, 50, 55)]) {
			assert.strictEqual(getLockerRoomMood(p, roster, 0), fresh(p, roster));
		}
		// Roster change, value change, ego change (God Mode), season change
		const signed = [...roster, mk(4, 5, 65)];
		assert.strictEqual(
			getLockerRoomMood(roster[1], signed, 0),
			fresh(roster[1], signed),
		);
		signed[0].valueNoPot = 45;
		assert.strictEqual(
			getLockerRoomMood(roster[1], signed, 0),
			fresh(roster[1], signed),
		);
		setTraitScores(signed[3], { ego: 5 }, 2025);
		assert.strictEqual(
			getLockerRoomMood(roster[1], signed, 0),
			fresh(roster[1], signed),
		);
		signed[4].traits.egoSeed = 3;
		assert.strictEqual(
			getLockerRoomMood(roster[1], signed, 0),
			fresh(roster[1], signed),
		);
	});

	test("the worst egos are named only if visible, worst first", () => {
		setup();
		const roster = [mk(0, 10, 70), mk(1, 15, 45), mk(2, 30, 60), mk(3, 90, 60)];
		const all = getLockerRoomWorstEgos(roster[3], roster, 0, () => true);
		assert.deepStrictEqual(
			all.map((p) => p.pid),
			[0, 2],
		);
		const hidden = getLockerRoomWorstEgos(
			roster[3],
			roster,
			0,
			(p) => p.pid !== 0,
		);
		assert.deepStrictEqual(
			hidden.map((p) => p.pid),
			[2, 1],
		);
		// Never himself
		assert.notInclude(
			getLockerRoomWorstEgos(roster[0], roster, 0, () => true).map(
				(p) => p.pid,
			),
			0,
		);
	});

	test("benchmark: free agency loop (every free agent with every team)", () => {
		setup();
		const teams = Array.from({ length: 30 }, (_, tid) =>
			Array.from({ length: 15 }, (_, i) =>
				mk(tid * 15 + i, 10 + ((tid * 37 + i * 11) % 80), 42 + i * 2),
			),
		);
		const freeAgents = Array.from({ length: 150 }, (_, i) =>
			mk(1000 + i, 50, 50),
		);
		const run = () => {
			let total = 0;
			const start = performance.now();
			for (let day = 0; day < 3; day++) {
				for (const p of freeAgents) {
					for (const [tid, roster] of teams.entries()) {
						total += getLockerRoomMood(p, roster.slice(), tid);
					}
				}
			}
			return { total, ms: performance.now() - start };
		};
		setLockerRoomCache(false);
		const off = run();
		setLockerRoomCache(true);
		const on = run();
		assert.closeTo(on.total, off.total, 1e-6);
		console.log(
			`locker room, 3 days x 150 free agents x 30 teams: uncached ${off.ms.toFixed(0)} ms, cached ${on.ms.toFixed(0)} ms (${(off.ms / on.ms).toFixed(1)}x)`,
		);
	});
});
