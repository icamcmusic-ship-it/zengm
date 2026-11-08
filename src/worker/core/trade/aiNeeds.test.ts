import { assert, describe, test } from "vitest";
import { PHASE } from "../../../common/constants.ts";
import {
	getBuyerProtected,
	getKindWeights,
	getRationale,
	getSalaryDumpCandidates,
	getSalaryFillerPids,
	getVeteranCandidates,
	isBuyer,
	isDeadlineWindow,
	isSeller,
	pickKind,
	wantsToDumpSalary,
	type NeedContext,
	type TeamNeedInfo,
} from "./aiNeeds.ts";

const ctx = (extra: Partial<NeedContext> = {}): NeedContext => ({
	phase: PHASE.REGULAR_SEASON,
	seasonProgress: 0.5,
	tradeDeadline: 0.6,
	salaryCap: 140000,
	luxuryPayroll: 170000,
	salaryCapType: "soft",
	...extra,
});

const team = (
	tid: number,
	strategy: "contending" | "rebuilding",
	payroll = 130000,
	winp: number | undefined = 0.5,
): TeamNeedInfo => ({ tid, strategy, payroll, winp });

describe("need-driven AI trades", () => {
	test("deadline window", () => {
		assert.isTrue(isDeadlineWindow(ctx({ seasonProgress: 0.4 })));
		assert.isFalse(isDeadlineWindow(ctx({ seasonProgress: 0.2 })));
		assert.isFalse(isDeadlineWindow(ctx({ phase: PHASE.FREE_AGENCY })));
		// No deadline: second half of the season
		assert.isTrue(
			isDeadlineWindow(ctx({ tradeDeadline: 1, seasonProgress: 0.6 })),
		);
	});

	test("buyers and sellers", () => {
		assert.isTrue(isBuyer(team(0, "contending", 130000, 0.6)));
		assert.isFalse(isBuyer(team(0, "contending", 130000, 0.3)));
		assert.isFalse(isBuyer(team(0, "rebuilding")));
		assert.isTrue(isSeller(team(0, "rebuilding"), ctx()));
		// A losing "contender" sells at the deadline, but not early in the season
		assert.isTrue(isSeller(team(0, "contending", 130000, 0.3), ctx()));
		assert.isFalse(
			isSeller(
				team(0, "contending", 130000, 0.3),
				ctx({ seasonProgress: 0.1 }),
			),
		);
	});

	test("salary dumps", () => {
		assert.isTrue(wantsToDumpSalary(team(0, "contending", 180000), ctx()));
		assert.isFalse(wantsToDumpSalary(team(0, "contending", 150000), ctx()));
		assert.isTrue(
			wantsToDumpSalary(
				team(0, "contending", 139000),
				ctx({ salaryCapType: "hard" }),
			),
		);
	});

	test("kind weights: deadline buying only at the deadline, dumps need cap space", () => {
		const teams = [
			team(0, "contending", 180000, 0.7),
			team(1, "rebuilding", 100000, 0.3),
		];
		const atDeadline = getKindWeights(teams, ctx());
		assert.isAbove(atDeadline.deadlineBuy, 0);
		assert.isAbove(atDeadline.salaryDump, 0);
		assert.isAbove(atDeadline.deadlineBuy, atDeadline.rebuildSell);

		const early = getKindWeights(teams, ctx({ seasonProgress: 0.1 }));
		assert.strictEqual(early.deadlineBuy, 0);

		const noCapSpace = getKindWeights(
			[team(0, "contending", 180000), team(1, "contending", 150000)],
			ctx(),
		);
		assert.strictEqual(noCapSpace.salaryDump, 0);
		assert.strictEqual(noCapSpace.rebuildSell, 0);
		assert.isUndefined(pickKind(noCapSpace, 0.5));
	});

	test("pickKind", () => {
		const weights = { deadlineBuy: 1, rebuildSell: 0, salaryDump: 1 };
		assert.strictEqual(pickKind(weights, 0.1), "deadlineBuy");
		assert.strictEqual(pickKind(weights, 0.9), "salaryDump");
	});

	test("candidates", () => {
		const players = [
			{ pid: 0, age: 31, value: 70, contractAmount: 30000, contractExp: 2027 },
			{ pid: 1, age: 22, value: 65, contractAmount: 5000, contractExp: 2027 },
			{ pid: 2, age: 29, value: 45, contractAmount: 25000, contractExp: 2028 },
			{ pid: 3, age: 26, value: 60, contractAmount: 10000, contractExp: 2025 },
			{ pid: 4, age: 33, value: 40, contractAmount: 2000, contractExp: 2025 },
			{ pid: 5, age: 24, value: 50, contractAmount: 2000, contractExp: 2025 },
			{ pid: 6, age: 30, value: 30, contractAmount: 2000, contractExp: 2025 },
		];

		// Veteran and among top 5 on the team
		assert.deepEqual(
			getVeteranCandidates(players).map((p) => p.pid),
			[0, 2],
		);

		// Multi-year, expensive, low value first
		assert.deepEqual(
			getSalaryDumpCandidates(players, 2025, 1000, 40000).map((p) => p.pid),
			[2, 0],
		);
		assert.strictEqual(
			getSalaryDumpCandidates(players, 2025, 1000, 40000)[0]!.pid,
			2,
		);

		// Top 5 plus anyone 30+
		const prot = getBuyerProtected(players);
		assert.isTrue(prot.has(0));
		assert.isTrue(prot.has(4));
		assert.isTrue(prot.has(6));
		assert.isTrue(prot.has(2));
		assert.isFalse(
			getBuyerProtected([
				...players,
				{ pid: 7, age: 23, value: 20, contractAmount: 1000, contractExp: 2025 },
			]).has(7),
		);
	});

	test("rationale text", () => {
		const deadline = getRationale({
			kind: "deadlineBuy",
			mainTeam: "Sellers",
			otherTeam: "Buyers",
			playerNames: ["Old Star"],
			returnTo: { numPlayers: 1, numYoungPlayers: 1, numPicks: 2 },
		});
		assert.include(deadline, "contending Buyers add Old Star");
		assert.include(deadline, "a young player and draft picks");

		const dump = getRationale({
			kind: "salaryDump",
			mainTeam: "Spenders",
			otherTeam: "Savers",
			playerNames: ["Big Contract"],
			returnTo: { numPlayers: 0, numYoungPlayers: 0, numPicks: 1 },
			salary: 25500,
		});
		assert.include(dump, "Salary dump");
		assert.include(dump, "$25.5M a year");
		assert.include(dump, "a draft pick");

		const sell = getRationale({
			kind: "rebuildSell",
			mainTeam: "Rebuilders",
			otherTeam: "Contenders",
			playerNames: ["A", "B"],
			returnTo: { numPlayers: 0, numYoungPlayers: 0, numPicks: 1 },
		});
		assert.include(sell, "rebuilding Rebuilders sell veteran A and B");
	});

	test("salary filler for a buyer over the cap", () => {
		const candidates = [
			{ pid: 1, age: 25, value: 40, contractAmount: 20000, contractExp: 2027 },
			{ pid: 2, age: 25, value: 40, contractAmount: 8000, contractExp: 2027 },
			{ pid: 3, age: 25, value: 40, contractAmount: 5000, contractExp: 2027 },
		];
		const base = {
			candidates,
			salaryCap: 140000,
			salaryCapType: "soft" as const,
			softCapTradeSalaryMatch: 125,
		};

		// Under the cap after the trade, nothing needed
		assert.deepEqual(
			getSalaryFillerPids({ ...base, incoming: 10000, payroll: 100000 }),
			[],
		);

		// Over the cap: outgoing must be at least 80% of incoming
		const pids = getSalaryFillerPids({
			...base,
			incoming: 20000,
			payroll: 150000,
		})!;
		const outgoing = candidates
			.filter((p) => pids.includes(p.pid))
			.reduce((memo, p) => memo + p.contractAmount, 0);
		assert.isAtLeast(outgoing, 16000);

		// Hard cap: payroll can't go up when over the cap
		const hard = getSalaryFillerPids({
			...base,
			salaryCapType: "hard",
			incoming: 12000,
			payroll: 150000,
		})!;
		assert.deepEqual(hard, [1]);

		// Impossible
		assert.isUndefined(
			getSalaryFillerPids({ ...base, incoming: 100000, payroll: 150000 }),
		);
	});
});
