import { assert, test } from "vitest";
import { simulateVote, type VoteCandidate } from "./index.ts";

const cands: VoteCandidate[] = Array.from({ length: 10 }, (_, i) => ({
	pid: i,
	tid: i,
	name: `P${i}`,
	score: 10 - i * 0.5,
	teamWinp: 0.4 + (i % 3) * 0.1,
	pts: 30 - i,
	gpFrac: 1,
	defending: i === 0,
}));

test("ballots add up to NBA points and are deterministic", () => {
	const a = simulateVote(
		{ shortName: "MVP", name: "MVP", kind: "mvp", candidates: cands },
		{ seed: 2030 },
	)!;
	const b = simulateVote(
		{ shortName: "MVP", name: "MVP", kind: "mvp", candidates: cands },
		{ seed: 2030 },
	)!;
	assert.deepStrictEqual(a, b);
	assert.strictEqual(a.voters, 100);
	const total = a.rows.reduce((s, r) => s + r.pts, 0);
	assert.strictEqual(total, 100 * (10 + 7 + 5 + 3 + 1));
	assert.strictEqual(
		a.rows.reduce((s, r) => s + r.first, 0),
		100,
	);
	for (const r of a.rows) {
		assert.isAtMost(r.share, 1);
	}
	// Order follows points
	for (let i = 1; i < a.rows.length; i++) {
		assert.isAtLeast(a.rows[i - 1]!.pts, a.rows[i]!.pts);
	}
});

test("respecting a winner nudges the vote until he wins", () => {
	const v = simulateVote(
		{
			shortName: "DPOY",
			name: "DPOY",
			kind: "player",
			candidates: cands,
			respect: [4],
		},
		{ seed: 1 },
	)!;
	assert.strictEqual(v.rows[0]!.pid, 4);
});

test("team awards fill numTeams teams of five", () => {
	const many = Array.from({ length: 20 }, (_, i) => ({
		...cands[0]!,
		pid: i,
		score: 20 - i,
	}));
	const respect = [
		[0, 1, 2, 3, 4],
		[5, 6, 7, 8, 9],
		[10, 11, 12, 13, 14],
	];
	const v = simulateVote(
		{
			shortName: "ALL",
			name: "All-League",
			kind: "team",
			numTeams: 3,
			teamSize: 5,
			candidates: many,
			respect,
		},
		{ seed: 3 },
	)!;
	assert.deepStrictEqual(v.points, [5, 3, 1]);
	const total = v.rows.reduce((s, r) => s + r.pts, 0);
	assert.strictEqual(total, 100 * 5 * (5 + 3 + 1));
	for (const [t, team] of respect.entries()) {
		for (const pid of team) {
			assert.strictEqual(
				v.rows.find((r) => r.pid === pid)?.tm,
				t + 1,
				`pid ${pid}`,
			);
		}
	}
});
