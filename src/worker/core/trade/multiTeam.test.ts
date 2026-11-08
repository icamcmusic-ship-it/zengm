import { assert, beforeAll, describe, test } from "vitest";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { PHASE } from "../../../common/constants.ts";
import { beforeTests } from "./testHelpers.ts";
import { resetG } from "../../../test/helpers.ts";
import {
	getLegs,
	getRuleWarnings,
	getTeamFlows,
	processMulti,
	summaryMulti,
	validateAssets,
	type MultiTeamTrade,
	type RuleTeam,
} from "./multiTeam.ts";

const trade: MultiTeamTrade = {
	tids: [0, 1, 2],
	assets: [
		{ type: "player", id: 10, fromTid: 0, toTid: 1 },
		{ type: "player", id: 11, fromTid: 1, toTid: 2 },
		{ type: "pick", id: 5, fromTid: 2, toTid: 0 },
		{ type: "player", id: 12, fromTid: 2, toTid: 0 },
	],
};

const ruleTeam = (extra: Partial<RuleTeam>): RuleTeam => ({
	tid: 0,
	name: "Team",
	payrollBefore: 100000,
	salaryIn: 0,
	salaryOut: 0,
	rosterBefore: 13,
	playersIn: 0,
	playersOut: 0,
	assetsIn: 1,
	assetsOut: 1,
	...extra,
});

const rules = {
	salaryCap: 140000,
	salaryCapType: "soft" as const,
	softCapTradeSalaryMatch: 125,
	maxRosterSize: 15,
	checkRosterSize: true,
};

describe("three-team trades", () => {
	beforeAll(() => {
		resetG();
	});

	test("asset routing: flows per team", () => {
		const flows = getTeamFlows(trade);
		assert.deepEqual(flows[0], {
			tid: 0,
			pidsIn: [12],
			pidsOut: [10],
			dpidsIn: [5],
			dpidsOut: [],
		});
		assert.deepEqual(flows[1]!.pidsIn, [10]);
		assert.deepEqual(flows[1]!.pidsOut, [11]);
		assert.deepEqual(flows[2]!.pidsIn, [11]);
		assert.deepEqual(flows[2]!.pidsOut, [12]);
		assert.deepEqual(flows[2]!.dpidsOut, [5]);
	});

	test("asset routing: one leg per pair of teams", () => {
		const legs = getLegs(trade);
		assert.strictEqual(legs.length, 3);

		// 0 <-> 1: 0 sends 10, 1 sends nothing
		assert.deepEqual(
			legs[0]!.map((t) => [t.tid, t.pids, t.dpids]),
			[
				[0, [10], []],
				[1, [], []],
			],
		);
		// 0 <-> 2: 2 sends 12 and pick 5
		assert.deepEqual(
			legs[1]!.map((t) => [t.tid, t.pids, t.dpids]),
			[
				[0, [], []],
				[2, [12], [5]],
			],
		);
		// 1 <-> 2
		assert.deepEqual(
			legs[2]!.map((t) => [t.tid, t.pids, t.dpids]),
			[
				[1, [11], []],
				[2, [], []],
			],
		);

		// Pairs that exchange nothing are skipped
		assert.strictEqual(
			getLegs({ tids: [0, 1, 2], assets: [trade.assets[0]!] }).length,
			1,
		);
	});

	test("salary rules per team", () => {
		// Under the cap after: fine
		assert.deepEqual(
			getRuleWarnings([ruleTeam({ salaryIn: 20000, salaryOut: 0 })], rules),
			[],
		);

		// Over the soft cap and taking back more than 125%
		const soft = getRuleWarnings(
			[ruleTeam({ payrollBefore: 150000, salaryIn: 20000, salaryOut: 10000 })],
			rules,
		);
		assert.strictEqual(soft.length, 1);
		assert.include(soft[0]!, "200%");

		// Within 125%: fine
		assert.deepEqual(
			getRuleWarnings(
				[
					ruleTeam({
						payrollBefore: 150000,
						salaryIn: 12000,
						salaryOut: 10000,
					}),
				],
				rules,
			),
			[],
		);

		// Hard cap: over and increasing
		assert.strictEqual(
			getRuleWarnings(
				[ruleTeam({ payrollBefore: 139000, salaryIn: 5000, salaryOut: 1000 })],
				{ ...rules, salaryCapType: "hard" },
			).length,
			1,
		);
	});

	test("roster rules and teams left out", () => {
		const roster = getRuleWarnings(
			[ruleTeam({ rosterBefore: 15, playersIn: 2, playersOut: 1 })],
			rules,
		);
		assert.include(roster[0]!, "16 players");
		assert.deepEqual(
			getRuleWarnings(
				[ruleTeam({ rosterBefore: 15, playersIn: 2, playersOut: 1 })],
				{ ...rules, checkRosterSize: false },
			),
			[],
		);
		assert.include(
			getRuleWarnings([ruleTeam({ assetsIn: 0, assetsOut: 0 })], rules)[0]!,
			"not part of this trade",
		);
	});

	describe("with a league", () => {
		beforeAll(beforeTests);

		test("validates, summarizes and processes a 3-team trade", async () => {
			g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);

			const players = await idb.cache.players.getAll();
			const byTid = (tid: number) =>
				players.filter((p) => p.tid === tid).map((p) => p.pid);
			const [a0] = byTid(0);
			const [b0] = byTid(1);
			const [c0] = byTid(2);

			const multi: MultiTeamTrade = {
				tids: [0, 1, 2],
				assets: [
					{ type: "player", id: a0!, fromTid: 0, toTid: 1 },
					{ type: "player", id: b0!, fromTid: 1, toTid: 2 },
					{ type: "player", id: c0!, fromTid: 2, toTid: 0 },
				],
			};

			assert.isUndefined(await validateAssets(multi));
			assert.strictEqual(
				await validateAssets({
					...multi,
					assets: [{ type: "player", id: a0!, fromTid: 1, toTid: 2 }],
				}),
				"Invalid player",
			);

			const s = await summaryMulti(multi);
			assert.strictEqual(s.teams.length, 3);
			assert.deepEqual(
				s.teams[0]!.receive.map((x) => [x.id, x.otherTid]),
				[[c0, 2]],
			);
			assert.deepEqual(
				s.teams[0]!.give.map((x) => [x.id, x.otherTid]),
				[[a0, 1]],
			);

			const numEventsBefore = (await idb.cache.events.getAll()).length;
			const undo = await processMulti(multi);

			assert.strictEqual((await idb.cache.players.get(a0!))!.tid, 1);
			assert.strictEqual((await idb.cache.players.get(b0!))!.tid, 2);
			assert.strictEqual((await idb.cache.players.get(c0!))!.tid, 0);

			// One trade event per leg, with the 3-team note
			const events = (await idb.cache.events.getAll()).slice(numEventsBefore);
			assert.strictEqual(events.length, 3);
			for (const event of events) {
				assert.strictEqual(event.type, "trade");
				if (event.type === "trade") {
					assert.include(event.note!, "3-team trade");
				}
			}

			// Transactions point at the right teams
			const pc = await idb.cache.players.get(c0!);
			const tx = pc!.transactions!.at(-1)!;
			assert.strictEqual(tx.type, "trade");
			if (tx.type === "trade") {
				assert.strictEqual(tx.fromTid, 2);
				assert.strictEqual(tx.tid, 0);
			}

			assert.isTrue(await undo());
			assert.strictEqual((await idb.cache.players.get(a0!))!.tid, 0);
			assert.strictEqual((await idb.cache.players.get(b0!))!.tid, 1);
			assert.strictEqual((await idb.cache.players.get(c0!))!.tid, 2);
		});
	});
});
