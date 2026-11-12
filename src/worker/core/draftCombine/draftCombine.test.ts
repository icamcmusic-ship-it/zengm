// Draft Lottery Night & Combine setting in a mock league: combine results of generated draft classes against real NBA combine
// ranges, the AI nudge over a class, and the lottery itself unchanged (same picks, same random numbers drawn) with the setting on.
import { afterAll, assert, describe, test } from "vitest";
import { Rng } from "../../../common/collegeStats/rng.ts";
import { PHASE } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import {
	COMBINE_COLUMNS,
	COMBINE_REAL_RANGES,
	SHOOTING_ATTEMPTS,
	combineValue,
} from "../../../common/draftCombine.ts";
import type { Player } from "../../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { draft } from "../index.ts";
import genPlayersWithoutSaving from "../draft/genPlayersWithoutSaving.ts";
import { loadTeamSeasons } from "../draft/testHelpers.ts";
import { getClassCombine, getDraftCombineNudges } from "./index.ts";

const realRandom = Math.random;
afterAll(() => {
	Math.random = realRandom;
	// @ts-expect-error
	idb.league = undefined;
});

const genClasses = async (n: number) => {
	const rng = new Rng("draftCombine.test");
	Math.random = () => rng.random();
	resetG();
	await resetCache({});
	const classes: Player[][] = [];
	let pid = 0;
	for (let i = 0; i < n; i++) {
		const players = (await genPlayersWithoutSaving(
			2026,
			DEFAULT_LEVEL,
			[],
		)) as Player[];
		for (const p of players) {
			p.pid = pid++;
		}
		classes.push(players);
	}
	Math.random = realRandom;
	return classes;
};

describe("draft combine", () => {
	test("generated classes land in real NBA combine ranges", async () => {
		const classes = await genClasses(8);
		g.setWithoutSavingToDB("featureLotteryNight", true);
		g.setWithoutSavingToDB("season", 2026);
		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);

		const values: Record<string, number[]> = {};
		let invited = 0;
		let skipped = 0;
		for (const players of classes) {
			const c = await getClassCombine(2026, players);
			assert.strictEqual(c.results.size, Math.min(75, players.length));
			invited += c.results.size;
			for (const res of c.results.values()) {
				if (!res.drills) {
					skipped += 1;
				}
				for (const col of COMBINE_COLUMNS) {
					let v = combineValue(res, col.key);
					if (v === undefined) {
						continue;
					}
					if (col.group === "shooting") {
						v /= SHOOTING_ATTEMPTS[col.key as keyof typeof SHOOTING_ATTEMPTS];
					}
					(values[col.key] ??= []).push(v);
				}
			}
		}

		const lines: string[] = [];
		for (const col of COMBINE_COLUMNS) {
			const xs = values[col.key]!.toSorted((a, b) => a - b);
			const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
			const sd = Math.sqrt(
				xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length,
			);
			const p2 = xs[Math.floor(0.02 * xs.length)]!;
			const p98 = xs[Math.floor(0.98 * xs.length)]!;
			const real = COMBINE_REAL_RANGES[col.key];
			lines.push(
				`${col.name}: mean ${mean.toFixed(2)} sd ${sd.toFixed(2)} [2%: ${p2.toFixed(2)}, 98%: ${p98.toFixed(2)}] | real ${real.mean} sd ${real.sd} [${real.min}, ${real.max}]`,
			);
			assert.isBelow(
				Math.abs(mean - real.mean),
				0.5 * real.sd,
				`${col.key} mean`,
			);
			assert.isAbove(sd, 0.55 * real.sd, `${col.key} sd`);
			assert.isBelow(sd, 1.6 * real.sd, `${col.key} sd`);
			assert.isAtLeast(p2, real.min - 0.5 * real.sd, `${col.key} low`);
			assert.isAtMost(p98, real.max + 0.5 * real.sd, `${col.key} high`);
		}
		console.log(
			`Combine vs real (${invited} prospects, ${skipped} skipped drills):\n${lines.join("\n")}`,
		);
		assert.isBelow(skipped / invited, 0.2);
		assert.isAbove(skipped, 0);
	});

	test("AI draft nudge averages zero over the class", async () => {
		const [players] = await genClasses(1);
		g.setWithoutSavingToDB("featureLotteryNight", true);
		g.setWithoutSavingToDB("season", 2026);
		g.setWithoutSavingToDB("phase", PHASE.DRAFT);
		const nudges = await getDraftCombineNudges(players!);
		assert.strictEqual(nudges.size, players!.length);
		const sum = [...nudges.values()].reduce((a, b) => a + b, 0);
		assert.isBelow(Math.abs(sum), 1e-9);
		assert.isTrue([...nudges.values()].some((x) => Math.abs(x) > 0.05));

		// Off: no nudge at all
		g.setWithoutSavingToDB("featureLotteryNight", false);
		assert.strictEqual((await getDraftCombineNudges(players!)).size, 0);
		// Before the combine (not the draft phase): none either
		g.setWithoutSavingToDB("featureLotteryNight", true);
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		assert.strictEqual((await getDraftCombineNudges(players!)).size, 0);
	});
});

describe("lottery night", () => {
	const runLottery = async (on: boolean) => {
		idb.league = mockIDBLeague();
		await loadTeamSeasons();
		g.setWithoutSavingToDB("featureLotteryNight", on);
		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
		const rng = new Rng("lottery night");
		let calls = 0;
		Math.random = () => {
			calls += 1;
			return rng.random();
		};
		const { draftLotteryResult } = await draft.genOrder(
			false,
			undefined,
			"nba2019",
		);
		const next = Math.random();
		Math.random = realRandom;
		const events = (await idb.cache.events.getAll()).filter((e) =>
			e.text?.includes("Lottery winners and losers"),
		);
		return {
			picks: draftLotteryResult!.result.map((r) => [r.tid, r.pick]),
			calls,
			next,
			events: events.length,
		};
	};

	test("the real lottery runs once, the same with the setting on: same picks, same random draws, plus a recap news item", async () => {
		const off = await runLottery(false);
		const on = await runLottery(true);
		assert.deepEqual(on.picks, off.picks);
		assert.strictEqual(on.calls, off.calls);
		assert.strictEqual(on.next, off.next);
		assert.strictEqual(off.events, 0);
		assert.strictEqual(on.events, 1);
	});
});
