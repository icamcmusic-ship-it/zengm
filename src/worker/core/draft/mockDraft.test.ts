import { assert, describe, test } from "vitest";
import { runMockDraft, type MockProspect, type MockTeam } from "./mockDraft.ts";
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
