import { assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { g, helpers } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { player } from "../index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import {
	DRAFT_CLASS_SHAPES,
	SHAPE_POOL,
	drawDraftClassShape,
	planDraftClassShape,
	type DraftClassShape,
} from "../../../common/draftClassShape.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import {
	applyPendingShape,
	getClassShape,
	PENDING_SHAPE,
} from "./classShape.ts";
import { processNewDraftClasses } from "./generateCollegeStats.ts";
import type { Player } from "../../../common/types.ts";

const SEASON = 2026;
const SHAPES = Object.keys(DRAFT_CLASS_SHAPES) as DraftClassShape[];

const getClass = async () =>
	(await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED))
		.filter((p) => p.draft.year === SEASON)
		.sort((a, b) => b.value - a.value || a.pid - b.pid);

const bases: Player[][] = [];
const NUM_BASES = 10;

const load = async (base: number, on = true) => {
	resetG();
	g.setWithoutSavingToDB("season", SEASON);
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	g.setWithoutSavingToDB("generateCollegeStats", false);
	g.setWithoutSavingToDB("rerandomizeDraftClassRatings", false);
	g.setWithoutSavingToDB("featureDraftClassShapes" as any, on);
	while (bases.length <= base) {
		const players = await genPlayersWithoutSaving(SEASON, DEFAULT_LEVEL, []);
		bases.push(
			players.map((p, pid) => {
				// Half of them from the US (the test names are all international)
				if (pid % 2 === 0) {
					p.born.loc = "Chicago, IL";
					p.college = "Duke";
				}
				return { ...p, pid } as Player;
			}),
		);
	}
	const all = structuredClone(bases[base]!);
	await resetCache({ players: all });
	for (const p of all) {
		await player.updateValues(p);
	}
};

beforeEach(() => load(0));

const summary = (players: Player[]) => {
	const top = players.slice(0, SHAPE_POOL);
	const mean = (f: (p: Player) => number) =>
		top.reduce((sum, p) => sum + f(p), 0) / top.length;
	const r = (p: Player) => p.ratings.at(-1)!;
	return {
		ovr: mean((p) => r(p).ovr),
		pot: mean((p) => r(p).pot),
		age: mean((p) => SEASON - p.born.year),
		guards: top.filter((p) => ["PG", "SG", "G"].includes(r(p).pos)).length,
		bigs: top.filter((p) => ["C", "FC", "PF"].includes(r(p).pos)).length,
		wings: top.filter((p) => ["GF", "SF", "F"].includes(r(p).pos)).length,
		intl: top.filter(
			(p) => !helpers.isAmerican(p.born.loc) && !p.born.loc.endsWith("Canada"),
		).length,
		first: r(top[0]!).ovr,
		gap: r(top[0]!).ovr - r(top[3]!).ovr,
	};
};

describe("draft class shapes", () => {
	test("the shape is drawn from the seed, as often as its weight says", () => {
		assert.strictEqual(drawDraftClassShape("x"), drawDraftClassShape("x"));
		const counts = new Map<string, number>();
		const N = 20000;
		for (let i = 0; i < N; i++) {
			const shape = drawDraftClassShape(`seed${i}`);
			counts.set(shape, (counts.get(shape) ?? 0) + 1);
		}
		const total = SHAPES.reduce((s, k) => s + DRAFT_CLASS_SHAPES[k].weight, 0);
		for (const shape of SHAPES) {
			const expected = DRAFT_CLASS_SHAPES[shape].weight / total;
			const actual = (counts.get(shape) ?? 0) / N;
			assert.approximately(actual, expected, 0.01, shape);
		}
	});

	test("the plan is deterministic", () => {
		const prospects = Array.from({ length: 70 }, (_, i) => ({
			key: String(i),
			ovr: 50 - i / 3,
			age: 19 + (i % 4),
			pos: ["PG", "SF", "C"][i % 3]!,
			international: i % 5 === 0,
		}));
		for (const shape of SHAPES) {
			assert.deepStrictEqual(
				planDraftClassShape(shape, "s", prospects, [19, 22]),
				planDraftClassShape(shape, "s", prospects, [19, 22]),
			);
			for (const c of planDraftClassShape(shape, "s", prospects, [19, 22])) {
				assert.isBelow(Number(c.key), SHAPE_POOL);
			}
		}
	});

	test("each shape does what it says, and the average class is as good as before", async () => {
		const rows: Record<string, Record<string, number>> = {};
		const add = (shape: string, key: string, value: number) => {
			rows[shape] ??= {};
			rows[shape][key] = (rows[shape][key] ?? 0) + value / NUM_BASES;
		};
		for (let base = 0; base < NUM_BASES; base++) {
			await load(base);
			const before = summary(await getClass());
			for (const shape of SHAPES) {
				await load(base);
				assert.strictEqual(await applyPendingShape(SEASON, shape), shape);
				const players = await getClass();
				for (const p of players) {
					assert.strictEqual(p.draftClassShape, shape);
				}
				const after = summary(players);
				for (const key of Object.keys(after) as (keyof typeof after)[]) {
					add(shape, key, after[key] - before[key]);
				}
			}
		}
		console.table(
			Object.fromEntries(
				Object.entries(rows).map(([k, v]) => [
					k,
					Object.fromEntries(
						Object.entries(v).map(([k2, x]) => [k2, Math.round(x * 100) / 100]),
					),
				]),
			),
		);

		// Weighted over how often each shape comes up, the top of the class is as good as before
		const total = SHAPES.reduce((s, k) => s + DRAFT_CLASS_SHAPES[k].weight, 0);
		const weighted = (key: string) =>
			SHAPES.reduce(
				(s, k) => s + (DRAFT_CLASS_SHAPES[k].weight * rows[k]![key]!) / total,
				0,
			);
		assert.isBelow(Math.abs(weighted("ovr")), 0.35);
		assert.isBelow(Math.abs(weighted("pot")), 0.75);

		const get = (shape: string, key: string) => rows[shape]![key]!;
		assert.strictEqual(get("typical", "ovr"), 0);
		assert.isAbove(get("deep", "ovr"), 1);
		assert.isBelow(get("weak", "ovr"), -1);
		assert.isAbove(get("topHeavy", "gap"), 3);
		assert.isAbove(get("generational", "first"), 6);
		assert.isBelow(get("noClearTop", "gap"), -1);
		assert.isAbove(get("guards", "guards"), 3);
		assert.isAbove(get("bigs", "bigs"), 3);
		assert.isAbove(get("wings", "wings"), 3);
		assert.isAbove(get("international", "intl"), 4);
		assert.isAbove(get("seniors", "age"), 0.5);
		assert.isBelow(get("raw", "age"), -0.2);
		assert.isAbove(get("raw", "pot") - get("raw", "ovr"), 0.4);
		assert.isAbove(get("readyNow", "age"), 0.3);
		assert.isBelow(get("readyNow", "pot") - get("readyNow", "ovr"), -1);
		for (const shape of SHAPES) {
			// Within realistic bounds
			assert.isBelow(Math.abs(get(shape, "ovr")), 3.5, shape);
			assert.isBelow(Math.abs(get(shape, "pot")), 4.5, shape);
		}
	}, 600_000);

	test("applied once, the same way every time; never with the setting off or to a class that was not generated from scratch", async () => {
		const shape = await processNewDraftClasses([SEASON]).then(() =>
			getClassShape([...(bases[0] ?? [])]),
		);
		assert.isUndefined(shape);
		const first = await getClass();
		const drawn = first[0]!.draftClassShape;
		assert.isTrue(drawn !== undefined && drawn !== PENDING_SHAPE);
		const snapshot = JSON.stringify(
			first.map((p) => [p.pid, p.ratings, p.born]),
		);

		// Again: nothing pending, nothing changes
		await processNewDraftClasses([SEASON]);
		assert.strictEqual(
			JSON.stringify((await getClass()).map((p) => [p.pid, p.ratings, p.born])),
			snapshot,
		);

		// Same class, same league: same result
		await load(0);
		await processNewDraftClasses([SEASON]);
		const again = await getClass();
		const key = (players: Player[]) =>
			JSON.stringify(
				[...players]
					.sort((a, b) => a.pid - b.pid)
					.map((p) => [p.pid, p.ratings.at(-1)!.ovr, p.born.year, p.hgt]),
			);
		assert.strictEqual(key(again), key(first));
		assert.strictEqual(getClassShape(again)?.key, drawn);

		// Setting off: the mark is dropped, nothing else changes
		await load(0, false);
		const plain = JSON.stringify((await getClass()).map((p) => p.ratings));
		await processNewDraftClasses([SEASON]);
		const off = await getClass();
		assert.strictEqual(JSON.stringify(off.map((p) => p.ratings)), plain);
		for (const p of off) {
			assert.isUndefined(p.draftClassShape);
		}

		// An imported class (no mark) is never reshaped
		await load(0);
		for (const p of await getClass()) {
			delete p.draftClassShape;
			await idb.cache.players.put(p);
		}
		await processNewDraftClasses([SEASON]);
		assert.strictEqual(
			JSON.stringify((await getClass()).map((p) => p.ratings)),
			plain,
		);

		// A class topped off after an import is not marked
		const topped = await genPlayersWithoutSaving(
			SEASON + 1,
			DEFAULT_LEVEL,
			bases[0]!.slice(0, 10),
		);
		for (const p of topped) {
			assert.isUndefined(p.draftClassShape);
		}
	}, 120_000);
});
