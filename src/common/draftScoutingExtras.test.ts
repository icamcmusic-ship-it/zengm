// Combine stories (effort, listed vs measured, history percentiles), the draft outlets' big boards, projection cones and scout track
// records (slot calls and flags): the pure parts, deterministic and without the game's random numbers.
import { afterEach, assert, describe, test } from "vitest";
import {
	COAST_CHANCE,
	buildCombineHistory,
	combineLooksMult,
	drillEffort,
	generateDraftCombine,
	historyPercentile,
	listedMeasurements,
	measurementStories,
	MIN_HISTORY,
	type DraftCombineInput,
} from "./draftCombine.ts";
import {
	OUTLETS,
	consensusBoard,
	draftAccuracy,
	editionOf,
	FINAL_EDITION,
	outcomeAccuracy,
	outcomeRanks,
	outletBoards,
	productionSignal,
	type OutletProspect,
} from "./draftOutlets.ts";
import { Rng } from "./collegeStats/rng.ts";
import {
	buildCone,
	coneNumbers,
	trajectoryOf,
} from "./scoutingReports/cone.ts";
import {
	classFinishRanks,
	decodeFlag,
	encodeFlag,
	flagAccuracy,
	flagHit,
	judgeable,
	slotAccuracy,
	slotHit,
	TRACK_SEASONS,
} from "./scoutingReports/history.ts";

const realRandom = Math.random;
afterEach(() => {
	Math.random = realRandom;
});
const noMathRandom = () => {
	Math.random = () => {
		throw new Error("Math.random used");
	};
};

const prospect = (pid: number, rng: Rng, rank = 40): DraftCombineInput => ({
	pid,
	season: 2030,
	heightInches: Math.round(78 + 3.3 * rng.normal()),
	weight: Math.round(215 + 20 * rng.normal()),
	rank,
	injured: false,
	ratings: {
		hgt: 47,
		stre: Math.round(42 + 9 * rng.normal()),
		spd: Math.round(52 + 15 * rng.normal()),
		jmp: Math.round(52 + 15 * rng.normal()),
		endu: 25,
		tp: 36,
		ft: 40,
		fg: 40,
	},
});

describe("combine: effort, listed vs measured, history", () => {
	test("effort is seeded, mostly full, and coasting hurts the drills", () => {
		noMathRandom();
		let coasted = 0;
		const n = 4000;
		for (let pid = 0; pid < n; pid++) {
			const e = drillEffort(pid, 2030);
			assert.strictEqual(e, drillEffort(pid, 2030));
			if (e < 1) {
				coasted += 1;
				assert.isAtLeast(e, 0.55);
				assert.isAtMost(e, 0.85);
			}
		}
		assert.closeTo(coasted / n, COAST_CHANCE, 0.02);

		// A coaster's drills are worse (same kind of prospects), but his performance (what teams read) is not
		const rng = new Rng("effortTest");
		const sums = {
			coast: { vert: 0, lane: 0, perf: 0, n: 0 },
			full: { vert: 0, lane: 0, perf: 0, n: 0 },
		};
		for (let pid = 0; pid < 4000; pid++) {
			const res = generateDraftCombine({ ...prospect(pid, rng), rank: 60 });
			if (!res.drills) {
				continue;
			}
			const x = sums[res.effort !== undefined ? "coast" : "full"];
			x.vert += res.drills.maxVert;
			x.lane += res.drills.laneAgility;
			x.perf += res.performance;
			x.n += 1;
		}
		assert.isBelow(
			sums.coast.vert / sums.coast.n,
			sums.full.vert / sums.full.n - 0.6,
		);
		assert.isAbove(
			sums.coast.lane / sums.coast.n,
			sums.full.lane / sums.full.n + 0.08,
		);
		assert.closeTo(
			sums.coast.perf / sums.coast.n,
			sums.full.perf / sums.full.n,
			0.3,
		);
	});

	test("listed heights run tall, and big gaps make stories", () => {
		noMathRandom();
		let over = 0;
		let shorter = 0;
		const n = 2000;
		for (let pid = 0; pid < n; pid++) {
			const listed = listedMeasurements({
				pid,
				season: 2030,
				heightInches: 79,
				weight: 220,
			});
			assert.deepEqual(
				listed,
				listedMeasurements({
					pid,
					season: 2030,
					heightInches: 79,
					weight: 220,
				}),
			);
			if (listed.height > 79) {
				over += 1;
			}
			assert.strictEqual(listed.weight % 5, 0);
			const stories = measurementStories(listed, {
				heightShoes: 79,
				heightNoShoes: 77.75,
				weight: 220,
			});
			if (stories.some((s) => s.kind === "shorter")) {
				shorter += 1;
				assert.isAtLeast(listed.height, 81);
			}
		}
		// Most listings are inflated, a few by enough to be a story
		assert.isAbove(over / n, 0.55);
		assert.isAbove(shorter / n, 0.15);
		assert.isBelow(shorter / n, 0.4);
	});

	test("history percentiles: league history when there is enough, real combines before", () => {
		const real = historyPercentile("maxVert", 34.5, {});
		assert.strictEqual(real.source, "real");
		assert.closeTo(real.pct, 50, 2);
		// Lower is better for the lane agility
		assert.isAbove(historyPercentile("laneAgility", 10.6, {}).pct, 90);

		const results = [];
		for (let i = 0; i < MIN_HISTORY + 10; i++) {
			results.push({
				measurements: {
					heightNoShoes: 78,
					heightShoes: 79,
					wingspan: 82,
					standingReach: 104,
					weight: 200 + i,
					bodyFat: 7,
					handLength: 8.75,
					handWidth: 9.5,
				},
			});
		}
		const history = buildCombineHistory(results);
		const heavy = historyPercentile("weight", 300, history);
		assert.strictEqual(heavy.source, "league");
		assert.strictEqual(heavy.pct, 100);
		// No drills in the history: real combines for those
		assert.strictEqual(
			historyPercentile("maxVert", 40, history).source,
			"real",
		);
	});

	test("the combine's looks are worth less when he skipped or coasted", () => {
		assert.strictEqual(combineLooksMult({ drills: undefined }), 0.55);
		assert.strictEqual(
			combineLooksMult({ drills: {} as any, effort: 0.7 }),
			0.8,
		);
		assert.strictEqual(combineLooksMult({ drills: {} as any }), 1);
	});
});

const outletClass = (n: number, seed: string): OutletProspect[] => {
	const rng = new Rng(seed);
	return Array.from({ length: n }, (_, i) => ({
		pid: i,
		value: 75 - 0.4 * i + 2 * rng.normal(),
		age: 19 + Math.floor(4 * rng.random()),
		upside: 10 + 5 * rng.normal(),
		production: i % 9 === 0 ? undefined : 20 + 4 * rng.normal(),
		athletic: 50 + 20 * rng.normal(),
	}));
};

const spearmanVsValue = (
	board: Map<number, number>,
	prospects: OutletProspect[],
) => {
	const byValue = [...prospects].sort((a, b) => b.value - a.value);
	const vRank = new Map(byValue.map((p, i) => [p.pid, i + 1]));
	let d2 = 0;
	for (const p of prospects) {
		d2 += (board.get(p.pid)! - vRank.get(p.pid)!) ** 2;
	}
	const n = prospects.length;
	return 1 - (6 * d2) / (n * (n * n - 1));
};

describe("draft outlets", () => {
	test("boards are deterministic and never touch Math.random", () => {
		noMathRandom();
		const prospects = outletClass(70, "a");
		const a = outletBoards({
			prospects,
			seed: "s",
			draftYear: 2030,
			edition: 3,
		});
		const b = outletBoards({
			prospects,
			seed: "s",
			draftYear: 2030,
			edition: 3,
		});
		assert.strictEqual(a.size, OUTLETS.length);
		for (const o of OUTLETS) {
			assert.deepEqual([...a.get(o.id)!], [...b.get(o.id)!]);
			assert.strictEqual(a.get(o.id)!.size, 70);
		}
	});

	test("boards get closer to the consensus value as the season goes on, and move between editions", () => {
		const prospects = outletClass(80, "b");
		let early = 0;
		let late = 0;
		let moved = 0;
		for (let s = 0; s < 10; s++) {
			const e0 = outletBoards({
				prospects,
				seed: `x${s}`,
				draftYear: 2030,
				edition: 0,
			});
			const e6 = outletBoards({
				prospects,
				seed: `x${s}`,
				draftYear: 2030,
				edition: FINAL_EDITION,
			});
			early += spearmanVsValue(e0.get(0)!, prospects);
			late += spearmanVsValue(e6.get(0)!, prospects);
			const e1 = outletBoards({
				prospects,
				seed: `x${s}`,
				draftYear: 2030,
				edition: 1,
			});
			for (const p of prospects) {
				if (e1.get(0)!.get(p.pid) !== e0.get(0)!.get(p.pid)) {
					moved += 1;
				}
			}
		}
		assert.isAbove(late, early);
		assert.isAbove(moved, 100);
	});

	test("each lean moves its own kind of prospect", () => {
		// Two otherwise identical prospects, one with the lean's signal high
		const base = outletClass(60, "c").map((p) => ({
			...p,
			upside: 10,
			production: 20,
			athletic: 50,
		}));
		const meanRank = (lean: "upside" | "production" | "athletic") => {
			let sum = 0;
			const reps = 30;
			for (let s = 0; s < reps; s++) {
				const prospects = base.map((p) =>
					p.pid === 30 ? { ...p, [lean]: lean === "athletic" ? 95 : 40 } : p,
				);
				const boards = outletBoards({
					prospects,
					seed: `lean${s}`,
					draftYear: 2030,
					edition: FINAL_EDITION,
				});
				const outlet = OUTLETS.find((o) => o.lean === lean)!;
				sum += boards.get(outlet.id)!.get(30)! - boards.get(0)!.get(30)!;
			}
			return sum / reps;
		};
		for (const lean of ["upside", "production", "athletic"] as const) {
			assert.isBelow(meanRank(lean), -3, lean);
		}
	});

	test("consensus, editions and accuracy", () => {
		const boards = new Map([
			[
				0,
				new Map([
					[1, 1],
					[2, 2],
					[3, 3],
				]),
			],
			[
				1,
				new Map([
					[1, 2],
					[2, 1],
					[3, 3],
				]),
			],
		]);
		const c = consensusBoard(boards);
		assert.strictEqual(c.get(3)!.rank, 3);
		assert.strictEqual(c.get(1)!.spread, 1);

		assert.strictEqual(editionOf("future").label, "Way-too-early");
		assert.strictEqual(editionOf("regularSeason", 0.5).label, "Midseason");
		assert.strictEqual(editionOf("draft").index, FINAL_EDITION);

		const picks = new Map([
			[1, 1],
			[2, 2],
			[3, 31],
		]);
		const acc = draftAccuracy(
			new Map([
				[1, 2],
				[2, 1],
				[3, 3],
			]),
			picks,
			30,
		)!;
		assert.strictEqual(acc.n, 2);
		assert.strictEqual(acc.mae, 1);
		assert.strictEqual(acc.hits, 2);

		const outcome = outcomeRanks([
			{ pid: 1, peak: 50, min: 100 },
			{ pid: 2, peak: 60, min: 0 },
			{ pid: 3, peak: 50, min: 900 },
		]);
		assert.deepEqual(
			[...outcome.entries()],
			[
				[2, 1],
				[3, 2],
				[1, 3],
			],
		);
		const oacc = outcomeAccuracy(
			new Map([
				[2, 1],
				[3, 2],
				[1, 3],
			]),
			outcome,
			30,
		)!;
		assert.strictEqual(oacc.mae, 0);
		assert.strictEqual(oacc.hits, 3);
	});

	test("production signal rewards efficient, young, high-level production", () => {
		const line = {
			gp: 30,
			min: 900,
			pts: 500,
			trb: 200,
			ast: 100,
			stl: 30,
			blk: 20,
			tov: 60,
			fga: 380,
			fta: 120,
			level: "college" as const,
		};
		const young = productionSignal(line, 19)!;
		assert.isAbove(young, productionSignal(line, 22)!);
		assert.isAbove(young, productionSignal({ ...line, level: "juco" }, 19)!);
		assert.isUndefined(productionSignal({ ...line, min: 100 }, 19));
	});
});

describe("projection cones", () => {
	test("wider with uncertainty and youth, leaning with the trajectory", () => {
		const base = { ovr: 45, pot: 60, age: 20, u: 3, optimism: 0 };
		const c = coneNumbers(base);
		assert.isAtMost(c.floor, c.median);
		assert.isAtMost(c.median, c.ceiling);
		const wide = coneNumbers({ ...base, u: 7 });
		assert.isAbove(wide.ceiling - wide.floor, c.ceiling - c.floor);
		const young = coneNumbers({ ...base, age: 19 });
		const old = coneNumbers({ ...base, age: 23 });
		assert.isAbove(young.ceiling - young.floor, old.ceiling - old.floor);
		const up = coneNumbers({ ...base, trajectory: 1 });
		const down = coneNumbers({ ...base, trajectory: -1 });
		assert.isAbove(up.median, down.median);
		assert.isAbove(up.ceiling, c.ceiling);
	});

	test("no numbers when ratings are hidden, roles always", () => {
		const scale = {
			franchise: 70,
			allStar: 64,
			qualityStarter: 57,
			starter: 52,
			rotation: 47,
			bench: 43,
		};
		const numbers = coneNumbers({
			ovr: 45,
			pot: 60,
			age: 20,
			u: 3,
			optimism: 0,
		});
		const hidden = buildCone({
			numbers,
			showNumbers: false,
			scale,
			group: "wing",
			age: 20,
			u: 3,
		});
		assert.isUndefined(hidden.numbers);
		assert.isString(hidden.medianRole);
		const shown = buildCone({
			numbers,
			showNumbers: true,
			scale,
			group: "wing",
			age: 20,
			u: 3,
		});
		assert.deepEqual(shown.numbers, numbers);
	});

	test("trajectory from production per 36 and our grades", () => {
		assert.isUndefined(trajectoryOf({ seasons: [], grades: [] }));
		const t = trajectoryOf({
			seasons: [
				{ season: 2029, min: 600, pts: 150, trb: 80, ast: 30 },
				{ season: 2030, min: 900, pts: 400, trb: 160, ast: 80 },
			],
			grades: [5, 8],
		})!;
		assert.isAbove(t.score, 0.5);
		assert.strictEqual(t.notes.length, 2);
		const down = trajectoryOf({ seasons: [], grades: [9, 6] })!;
		assert.isBelow(down.score, 0);
	});
});

describe("scout track records", () => {
	test("judged three seasons after the draft", () => {
		assert.strictEqual(TRACK_SEASONS, 3);
		assert.isFalse(judgeable(2030, 2032, false));
		assert.isTrue(judgeable(2030, 2033, false));
	});

	test("slot calls and flags", () => {
		assert.isTrue(slotHit(3, 7));
		assert.isFalse(slotHit(3, 12));
		assert.isTrue(slotHit(40, 50));
		const finish = classFinishRanks([
			{ pid: 1, peak: 60, min: 10 },
			{ pid: 2, peak: 50, min: 10 },
		]);
		assert.strictEqual(finish.get(1), 1);
		const acc = slotAccuracy([
			{ scoutId: 1, pid: 1, name: "A", season: 2030, slot: 1, finish: 2 },
			{ scoutId: 1, pid: 2, name: "B", season: 2030, slot: 2, finish: 60 },
		])!;
		assert.strictEqual(acc.hits, 1);
		assert.strictEqual(acc.avgError, (1 + 40) / 2);
		assert.strictEqual(acc.worst?.name, "B");

		const code = encodeFlag("green", "Relentless motor");
		assert.deepEqual(decodeFlag(code), {
			tone: "green",
			text: "Relentless motor",
		});
		assert.isTrue(flagHit({ tone: "green", consensus: 10, finish: 5 }));
		assert.isFalse(flagHit({ tone: "red", consensus: 10, finish: 5 }));
		const f = flagAccuracy([
			{
				scoutId: 1,
				pid: 1,
				name: "A",
				season: 2030,
				text: "x",
				tone: "red",
				consensus: 5,
				finish: 20,
			},
		])!;
		assert.strictEqual(f.hitRate, 1);
	});
});
