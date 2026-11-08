import { assert, describe, test } from "vitest";
import { getDraftAdjustment, getTeamNeeds, getNeedLabels } from "./draftNeeds.ts";
import { getDraftBoardPick } from "./runPicks.ts";

// Deterministic pseudo random numbers
const makeRandom = (seed: number) => () => {
	seed = (seed * 16807) % 2147483647;
	return (seed - 1) / 2147483646;
};

const POSITIONS = ["PG", "SG", "SF", "PF", "C", "G", "GF", "F", "FC"];

const makePlayer = (random: () => number, pos?: string, value?: number) => {
	const ovr = 35 + Math.round(random() * 20);
	return {
		value: value ?? 45 + random() * 25,
		ratings: [
			{
				pos: pos ?? POSITIONS[Math.floor(random() * POSITIONS.length)]!,
				ovr,
				pot: ovr + Math.round(random() * 25),
			},
		],
	};
};

// Greedy draft: each team takes the best adjusted score, like runPicks without the randomness
const simulateDraft = (useNeeds: boolean, seed: number) => {
	const random = makeRandom(seed);
	const teams = Array.from({ length: 30 }, (_, i) => ({
		strategy: (i % 2 === 0 ? "contending" : "rebuilding") as
			| "contending"
			| "rebuilding",
		players: Array.from({ length: 12 }, () => makePlayer(random)),
	}));
	const prospects = Array.from({ length: 70 }, () => makePlayer(random));
	let available = [...prospects];
	let valueBestPicks = 0;
	let rankSlip = 0;
	let needFilled = 0;
	let numPicks = 0;
	for (let round = 0; round < 2; round++) {
		for (const t of teams) {
			const needs = getTeamNeeds(t.players);
			const sortedByValue = [...available].sort((a, b) => b.value - a.value);
			let best = sortedByValue[0]!;
			let bestScore = -Infinity;
			for (const p of available) {
				const score =
					p.value + (useNeeds ? getDraftAdjustment(p, needs, t.strategy) : 0);
				if (score > bestScore) {
					bestScore = score;
					best = p;
				}
			}
			if (best === sortedByValue[0]) {
				valueBestPicks += 1;
			}
			rankSlip += sortedByValue.indexOf(best);
			if (getDraftAdjustment(best, needs, undefined) > 0) {
				needFilled += 1;
			}
			numPicks += 1;
			t.players.push(best);
			available = available.filter((p) => p !== best);
		}
	}
	return {
		valueBest: valueBestPicks / numPicks,
		rankSlip: rankSlip / numPicks,
		needFilled: needFilled / numPicks,
	};
};

describe("draft by need", () => {
	test("a team without bigs needs a big", () => {
		const random = makeRandom(1);
		const guards = Array.from({ length: 10 }, () => makePlayer(random, "PG"));
		const needs = getTeamNeeds(guards);
		assert.isAbove(needs.C, 0.1);
		assert.isBelow(needs.G, 0);
		assert.include(getNeedLabels(needs), "Big");
		const c = makePlayer(random, "C", 50);
		const pg = makePlayer(random, "PG", 50);
		assert.isAbove(
			getDraftAdjustment(c, needs, undefined),
			getDraftAdjustment(pg, needs, undefined),
		);
	});

	test("contending prefers ready now, rebuilding prefers ceiling", () => {
		const needs = { G: 0, F: 0, C: 0 };
		const ready = { value: 50, ratings: [{ pos: "SF", ovr: 50, pot: 52 }] };
		const raw = { value: 50, ratings: [{ pos: "SF", ovr: 38, pot: 64 }] };
		assert.isAbove(
			getDraftAdjustment(ready, needs, "contending"),
			getDraftAdjustment(raw, needs, "contending"),
		);
		assert.isAbove(
			getDraftAdjustment(raw, needs, "rebuilding"),
			getDraftAdjustment(ready, needs, "rebuilding"),
		);
	});

	test("measured over many drafts: more needs filled, value still dominates", () => {
		const base = { valueBest: 0, rankSlip: 0, needFilled: 0 };
		const withNeeds = { valueBest: 0, rankSlip: 0, needFilled: 0 };
		const N = 40;
		for (let seed = 1; seed <= N; seed++) {
			const a = simulateDraft(false, seed);
			const b = simulateDraft(true, seed);
			for (const key of ["valueBest", "rankSlip", "needFilled"] as const) {
				base[key] += a[key] / N;
				withNeeds[key] += b[key] / N;
			}
		}
		// Value still decides most picks, and the pick is on average less than one spot off the best available
		assert.isAbove(withNeeds.valueBest, 0.55);
		assert.isBelow(withNeeds.rankSlip, 1);
		// But more picks fill a need than when drafting purely by value
		assert.isAbove(withNeeds.needFilled, base.needFilled + 0.05);
	});

	test("draft board pick: top ranked available, else nothing", () => {
		const players: { pid: number; draftBoard?: { rank?: number; note?: string } }[] = [
			{ pid: 1 },
			{ pid: 2, draftBoard: { rank: 3 } },
			{ pid: 3, draftBoard: { rank: 1, note: "x" } },
			{ pid: 4, draftBoard: { note: "unranked" } },
		];
		assert.strictEqual(getDraftBoardPick(players)?.pid, 3);
		assert.strictEqual(getDraftBoardPick(players.slice(0, 1)), undefined);
	});
});
