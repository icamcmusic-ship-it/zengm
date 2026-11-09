import { assert, describe, test } from "vitest";
import {
	pickConditionsDryRun,
	runMockDraft,
	type MockProspect,
	type MockTeam,
} from "./mockDraft.ts";
import type { DraftPick } from "../../../common/types.ts";
import { projectProspect, summarizeCareers } from "./proProjection.ts";
import genRatings from "../player/genRatings.ts";
import { resetG } from "../../../test/helpers.ts";

const makeRandom = (seed: number) => () => {
	seed = (seed * 16807) % 2147483647;
	return (seed - 1) / 2147483646;
};

const prospect = (
	pid: number,
	value: number,
	pos: string,
	scoutRank = pid,
): MockProspect => ({
	pid,
	value,
	ratings: [{ pos, ovr: 45, pot: 60 }],
	scoutRank,
});

const slots = (tids: number[]) =>
	tids.map((tid, i) => ({
		dpid: i,
		round: 1,
		pick: i + 1,
		tid,
		originalTid: tid,
	}));

const team = (tid: number, needs: MockTeam["needs"]): MockTeam => ({
	tid,
	needs,
	strategy: undefined,
});

describe("runMockDraft", () => {
	test("each prospect is drafted once, in pick order, and stops when the pool runs out", () => {
		const prospects = [1, 2, 3].map((pid) => prospect(pid, 70 - pid * 5, "SF"));
		const picks = runMockDraft({
			slots: slots([0, 1, 2, 3, 4]),
			prospects,
			teams: new Map(),
			useNeeds: false,
			useTraits: false,
			random: makeRandom(1),
		});
		assert.strictEqual(picks.length, 3);
		assert.deepStrictEqual(
			picks.map((p) => p.overall),
			[1, 2, 3],
		);
		assert.strictEqual(new Set(picks.map((p) => p.pid)).size, 3);
	});

	test("value decides clear gaps; best available is the reason", () => {
		const prospects = [prospect(1, 80, "C"), prospect(2, 60, "PG")];
		const picks = runMockDraft({
			slots: slots([0]),
			prospects,
			teams: new Map([[0, team(0, { G: 0.4, F: 0, C: -0.3 })]]),
			useNeeds: true,
			useTraits: false,
			random: makeRandom(2),
		});
		assert.strictEqual(picks[0]!.pid, 1);
		assert.include(picks[0]!.reasons, "Best available");
	});

	test("need breaks a near tie, with the need as the reason", () => {
		const prospects = [prospect(1, 60.2, "C"), prospect(2, 60, "PG")];
		const teams = new Map([[0, team(0, { G: 0.4, F: 0, C: -0.3 })]]);
		let guardPicks = 0;
		for (let seed = 1; seed <= 50; seed++) {
			const picks = runMockDraft({
				slots: slots([0]),
				prospects,
				teams,
				useNeeds: true,
				useTraits: false,
				random: makeRandom(seed * 100_003),
			});
			if (picks[0]!.pid === 2) {
				guardPicks += 1;
				assert.include(picks[0]!.reasons, "Fills the need at guard");
			}
		}
		assert.isAbove(guardPicks, 40);
	});

	test("reach and steal against the user's board", () => {
		const prospects = [prospect(1, 80, "SF", 12)];
		const picks = runMockDraft({
			slots: slots([0]),
			prospects,
			teams: new Map(),
			useNeeds: false,
			useTraits: false,
		});
		assert.include(picks[0]!.reasons, "Steal: No. 12 on your board");
	});
});

describe("pro projections", () => {
	test("summary percentiles and odds", () => {
		const careers = [
			[{ age: 20, ovr: 70 }],
			...Array.from({ length: 4 }, () =>
				[50, 55, 60, 58].map((ovr, i) => ({ age: 20 + i, ovr })),
			),
			[],
		];
		const s = summarizeCareers(1, 45, 19, careers);
		assert.strictEqual(s.peak, 60);
		assert.closeTo(s.starPct, 1 / 6, 1e-9);
		assert.closeTo(s.starterPct, 5 / 6, 1e-9);
		// Short careers count as busts
		assert.closeTo(s.bustPct, 2 / 6, 1e-9);
		assert.strictEqual(s.verdict, "Starter");
	});

	test("real development: a better prospect projects higher, and it is fast", () => {
		resetG();
		const weak = genRatings(2025, 1).ratings;
		const strong = genRatings(2025, 1).ratings;
		for (const key of Object.keys(strong)) {
			const r = strong as any;
			if (typeof r[key] === "number" && key !== "season" && key !== "hgt") {
				r[key] = Math.min(100, r[key] + 15);
			}
		}
		const start = performance.now();
		const a = projectProspect(1, { ...weak, season: 2025 } as any, 19, 200);
		const b = projectProspect(2, { ...strong, season: 2025 } as any, 19, 200);
		assert.isBelow(performance.now() - start, 2000);
		assert.isAbove(b.peak, a.peak);
		assert.isAtLeast(b.starPct, a.starPct);
		assert.isAtMost(b.bustPct, a.bustPct);
		assert.isAtLeast(a.peakHigh, a.peak);
		assert.isAtMost(a.peakLow, a.peak);
	});
});

describe("pickConditionsDryRun", () => {
	const dp = (x: Partial<DraftPick> & { dpid: number }): DraftPick => ({
		tid: x.originalTid ?? 0,
		originalTid: 0,
		round: 1,
		pick: 0,
		season: 2025,
		...x,
	});
	const shortName = (tid: number) => `T${tid}`;

	test("protection stays or conveys, swap executes, nothing is mutated", () => {
		const draftPicks = [
			// T1 owes T5 a top 3 protected pick, landed #2: stays
			dp({
				dpid: 1,
				originalTid: 1,
				tid: 5,
				pick: 2,
				protection: { tid: 1, top: 3, rollover: [], then: "extinguish" },
			}),
			// T2 owes T6 a top 3 protected pick, landed #4: conveys
			dp({
				dpid: 2,
				originalTid: 2,
				tid: 6,
				pick: 4,
				protection: { tid: 2, top: 3, rollover: [], then: "extinguish" },
			}),
			// T7 can swap with T3; T3's #1 beats T7's #5
			dp({ dpid: 3, originalTid: 3, pick: 1, swap: { tid: 7 } }),
			dp({ dpid: 4, originalTid: 7, pick: 5 }),
			dp({ dpid: 5, originalTid: 8, pick: 3 }),
			dp({ dpid: 6, originalTid: 8, round: 3, pick: 1 }),
		];
		const before = JSON.stringify(draftPicks);
		const slots = pickConditionsDryRun({
			draftPicks,
			futurePicks: [],
			shortName,
			rounds: 2,
		});
		assert.strictEqual(JSON.stringify(draftPicks), before);
		assert.deepStrictEqual(
			slots.map((s) => [s.pick, s.tid]),
			[
				[1, 7],
				[2, 1],
				[3, 8],
				[4, 6],
				[5, 3],
			],
		);
		assert.include(slots[0]!.note, "swapped: T7 get it from T3");
		assert.include(slots[1]!.note, "top 3 protected");
		assert.include(slots[1]!.note, "stays with T1");
		assert.include(slots[3]!.note, "conveyed to T6");
		assert.isUndefined(slots[2]!.note);
		assert.include(slots[4]!.note, "swapped: T3 get it from T7");
	});

	test("rollover goes to a copy of the future pick, not the real one", () => {
		const future = dp({ dpid: 9, originalTid: 1, season: 2026 });
		const slots = pickConditionsDryRun({
			draftPicks: [
				dp({
					dpid: 1,
					originalTid: 1,
					tid: 5,
					pick: 1,
					protection: { tid: 1, top: 5, rollover: [], then: "unprotected" },
				}),
			],
			futurePicks: [future],
			shortName,
			rounds: 2,
		});
		assert.strictEqual(slots[0]!.tid, 1);
		assert.strictEqual(future.tid, 1);
	});
});
