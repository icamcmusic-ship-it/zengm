import { afterAll, assert, beforeEach, describe, test } from "vitest";
import { Rng } from "../../../common/collegeStats/rng.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { g, helpers } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { player } from "../index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import {
	DRAFT_CLASS_SHAPES,
	SHAPE_POOL,
	SPIKE_COUNTRIES,
	drawDraftClassShape,
	planDraftClassShape,
	type DraftClassShape,
} from "../../../common/draftClassShape.ts";
import {
	COLLEGES,
	CONFERENCES,
} from "../../../common/collegeStats/colleges.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import {
	applyPendingShape,
	getClassShape,
	PENDING_SHAPE,
} from "./classShape.ts";
import {
	processNewDraftClasses,
	toCollegeProspect,
} from "./generateCollegeStats.ts";
import { getClassShapeInfo } from "./classShape.ts";
import { pickStory } from "../../../common/collegeStats/career.ts";
import {
	clampSeed,
	generateTraitSeeds,
} from "../../../common/playerTraits/index.ts";
import { getLeagueTraitSeed } from "../player/traits.ts";
import { getSchool } from "../../../common/collegeStats/colleges.helpers.ts";
import type { Player } from "../../../common/types.ts";
import { fillExpandedRatings } from "../../../common/expandedRatings.ts";

const SEASON = 2026;
const SHAPES = Object.keys(DRAFT_CLASS_SHAPES) as DraftClassShape[];

const getClass = async () =>
	(await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED))
		.filter((p) => p.draft.year === SEASON)
		.sort((a, b) => b.value - a.value || a.pid - b.pid);

const bases: Player[][] = [];
const NUM_BASES = 10;

const load = async (
	base: number,
	on = true,
	expanded = false,
	afterDraft = false,
) => {
	resetG();
	g.setWithoutSavingToDB("expandedRatings", expanded);
	g.setWithoutSavingToDB("season", SEASON);
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	// Past the draft, so the views do not compare with earlier classes (no database here)
	if (afterDraft) {
		g.setWithoutSavingToDB("phase", PHASE.AFTER_DRAFT);
	}
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
	if (expanded) {
		for (const p of all) {
			fillExpandedRatings(p);
		}
	}
	await resetCache({ players: all });
	for (const p of all) {
		await player.updateValues(p);
	}
};

// The generated classes (and the little randomness in development) from a fixed stream, so the averages below are the same every run
// (a fresh stream for every test, so a test's numbers don't depend on which tests ran before it, e.g. with -t)
const realRandom = Math.random;
afterAll(() => {
	Math.random = realRandom;
});

beforeEach(() => {
	const rng = new Rng("classShape.test");
	Math.random = () => rng.random();
	return load(0);
});

const summary = (players: Player[]) => {
	const top = players.slice(0, SHAPE_POOL);
	const mean = (f: (p: Player) => number, list = top) =>
		list.reduce((sum, p) => sum + f(p), 0) / Math.max(1, list.length);
	const r = (p: Player) => p.ratings.at(-1)! as any;
	const ovrMean = mean((p) => r(p).ovr);
	const isBig = (p: Player) => ["C", "FC", "PF"].includes(r(p).pos);
	const countries = new Map<string, number>();
	for (const p of top) {
		const c = helpers.getCountry(p.born.loc);
		if (SPIKE_COUNTRIES.includes(c)) {
			countries.set(c, (countries.get(c) ?? 0) + 1);
		}
	}
	return {
		ovr: ovrMean,
		pot: mean((p) => r(p).pot),
		age: mean((p) => SEASON - p.born.year),
		guards: top.filter((p) => ["PG", "SG", "G"].includes(r(p).pos)).length,
		pg: top.filter((p) => r(p).pos === "PG").length,
		bigs: top.filter(isBig).length,
		wings: top.filter((p) => ["GF", "SF", "F"].includes(r(p).pos)).length,
		intl: top.filter(
			(p) => !helpers.isAmerican(p.born.loc) && !p.born.loc.endsWith("Canada"),
		).length,
		first: r(top[0]!).ovr,
		gap: r(top[0]!).ovr - r(top[3]!).ovr,
		gap23: r(top[1]!).ovr - r(top[2]!).ovr,
		sd: Math.sqrt(mean((p) => (r(p).ovr - ovrMean) ** 2, top.slice(0, 40))),
		tp: mean((p) => r(p).tp),
		diq: mean((p) => r(p).diq),
		ath: mean((p) => r(p).spd + r(p).jmp),
		oiq: mean((p) => r(p).oiq),
		bigTp: mean((p) => r(p).tp, top.filter(isBig)),
		teens: top.filter((p) => SEASON - p.born.year <= 19).length,
		// Filled in by the caller: the biggest gain of any one country
		spike: 0,
		countries,
		mid: top.filter((p) => {
			const info = COLLEGES[p.college];
			return !!info && CONFERENCES[info[1]]?.tier !== "high";
		}).length,
		injured: top.filter((p) => p.draftClassShapeInjury).length,
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

	const runShapes = async (expanded: boolean) => {
		const rows: Record<string, Record<string, number>> = {};
		const add = (shape: string, key: string, value: number) => {
			rows[shape] ??= {};
			rows[shape][key] = (rows[shape][key] ?? 0) + value / NUM_BASES;
		};
		for (let base = 0; base < NUM_BASES; base++) {
			await load(base, true, expanded);
			const before = summary(await getClass());
			for (const shape of SHAPES) {
				await load(base, true, expanded);
				assert.strictEqual(await applyPendingShape(SEASON, shape), shape);
				const players = await getClass();
				for (const p of players) {
					assert.strictEqual(p.draftClassShape, shape);
				}
				const after = summary(players);
				after.spike = Math.max(
					0,
					...[...after.countries].map(
						([c, n]) => n - (before.countries.get(c) ?? 0),
					),
				);
				for (const key of Object.keys(after) as (keyof typeof after)[]) {
					if (key !== "countries") {
						add(shape, key, after[key] - before[key]);
					}
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
		console.log(
			"weighted ovr",
			weighted("ovr").toFixed(3),
			"pot",
			weighted("pot").toFixed(3),
		);
		assert.isBelow(Math.abs(weighted("ovr")), 0.35);
		assert.isBelow(Math.abs(weighted("pot")), 0.75);

		const get = (shape: string, key: string) => rows[shape]![key]!;
		assert.strictEqual(get("typical", "ovr"), 0);
		assert.isAbove(get("deep", "ovr"), 1);
		assert.isBelow(get("weak", "ovr"), -1);
		assert.isAbove(get("topHeavy", "gap"), 3);
		assert.isAbove(get("generational", "first"), 4);
		assert.isBelow(get("noClearTop", "first"), -2);
		assert.isAbove(get("guards", "guards"), 3);
		assert.isAbove(get("bigs", "bigs"), 3);
		assert.isAbove(get("wings", "wings"), 3);
		assert.isAbove(get("international", "intl"), 4);
		assert.isAbove(get("seniors", "age"), 0.5);
		assert.isBelow(get("raw", "age"), -0.2);
		assert.isAbove(get("raw", "pot") - get("raw", "ovr"), 0.4);
		assert.isAbove(get("readyNow", "age"), 0.3);
		assert.isBelow(get("readyNow", "pot") - get("readyNow", "ovr"), -1);
		assert.isAbove(get("shooters", "tp"), 3);
		assert.isAbove(get("defenders", "diq"), 2);
		assert.isAbove(get("athletes", "ath"), 5);
		assert.isAbove(get("pointGuards", "pg"), 1.5);
		assert.isAbove(get("stretchBigs", "bigTp"), 4);
		assert.isAbove(get("twoWayWings", "wings"), 1.2);
		assert.isAbove(get("twoWayWings", "diq"), 1);
		assert.isAbove(get("oneAndDone", "teens"), 8);
		assert.isAbove(get("lateBloomers", "age"), 0.25);
		assert.isAbove(get("lateBloomers", "first"), 1);
		assert.isAbove(get("intlBigs", "intl"), 5);
		assert.isAbove(get("intlBigs", "bigs"), 1.5);
		assert.isAbove(get("midMajor", "mid"), 6);
		assert.isAbove(get("boomOrBust", "sd"), 0.6);
		assert.isAbove(get("polished", "oiq"), 2);
		assert.isBelow(get("polished", "pot") - get("polished", "ovr"), -0.3);
		assert.isAbove(get("coHeadliners", "gap23"), 3);
		assert.isAbove(get("countrySpike", "spike"), 6);
		assert.isAbove(get("injuryRiddled", "injured"), 8);
		for (const shape of SHAPES) {
			// Within realistic bounds
			assert.isBelow(Math.abs(get(shape, "ovr")), 3.5, shape);
			assert.isBelow(Math.abs(get(shape, "pot")), 4.5, shape);
		}
		return rows;
	};

	test("each shape does what it says, and the average class is as good as before", async () => {
		await runShapes(false);
	}, 600_000);

	test("the same with expanded ratings, which are tilted with the stock ones and stay consistent with them", async () => {
		await runShapes(true);
		// The tilts: catch-and-shoot for shooters, ball security for point guards, wingspan for defenders
		const tilted = async (shape: DraftClassShape, f: (r: any) => number) => {
			let sum = 0;
			for (let base = 0; base < 4; base++) {
				await load(base, true, true);
				const mean = (list: Player[]) =>
					list
						.slice(0, SHAPE_POOL)
						.reduce((t, p) => t + f(p.ratings.at(-1)), 0) / SHAPE_POOL;
				const before = mean(await getClass());
				await applyPendingShape(SEASON, shape);
				sum += (mean(await getClass()) - before) / 4;
			}
			console.log("expanded tilt", shape, sum.toFixed(2));
			return sum;
		};
		assert.isAbove(await tilted("shooters", (r) => r.csh - r.dsh), 0.5);
		assert.isAbove(await tilted("pointGuards", (r) => r.bsc - r.drb), 0.5);
		assert.isAbove(await tilted("defenders", (r) => r.wng - r.hgt), 0.5);
		assert.isAbove(await tilted("athletes", (r) => r.oreb - r.dreb), 0.5);
		for (const shape of [
			"shooters",
			"stretchBigs",
			"pointGuards",
			"defenders",
			"athletes",
		] as const) {
			await load(0, true, true);
			await applyPendingShape(SEASON, shape);
			for (const p of await getClass()) {
				const r = p.ratings.at(-1)! as any;
				// csh + dsh = fg + tp, reb and diq the averages of their splits
				assert.approximately(r.csh + r.dsh, r.fg + r.tp, 1, shape);
				assert.approximately((r.oreb + r.dreb) / 2, r.reb, 1, shape);
				assert.approximately((r.pdef + r.idef) / 2, r.diq, 1, shape);
			}
		}
	}, 900_000);

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

	test("what the views show: the description of its version and storylines read off the class", async () => {
		await load(0, true, false, true);
		await applyPendingShape(SEASON, "guards");
		const players = await getClass();
		const info = (await getClassShapeInfo(players, SEASON))!;
		assert.strictEqual(info.key, "guards");
		assert.include(DRAFT_CLASS_SHAPES.guards.descriptions, info.description);
		assert.isAtLeast(info.storylines.length, 2);
		assert.isAtMost(info.storylines.length, 4);
		assert.include(
			info.storylines[0],
			`${players[0]!.firstName} ${players[0]!.lastName}`,
		);
		assert.deepStrictEqual(await getClassShapeInfo(players, SEASON), info);

		// A class shaped before version 2 keeps the description it always had
		for (const p of players) {
			delete p.draftClassShapeV;
		}
		const v1 = (await getClassShapeInfo(players, SEASON))!;
		assert.strictEqual(
			v1.description,
			DRAFT_CLASS_SHAPES.guards.descriptions[0],
		);

		// Nothing for a class without a shape
		for (const p of players) {
			delete p.draftClassShape;
		}
		assert.isUndefined(await getClassShapeInfo(players, SEASON));
	});

	test("the injury-riddled class: injury stories in college, a little less durable with player traits on", async () => {
		await load(0);
		g.setWithoutSavingToDB("playerTraits" as any, true);
		await applyPendingShape(SEASON, "injuryRiddled");
		const players = await getClass();
		const hurt = players.filter((p) => p.draftClassShapeInjury);
		assert.isAbove(hurt.length, 5);
		assert.isTrue(hurt.every((p) => players.indexOf(p) < SHAPE_POOL));
		const school = getSchool("Duke")!;
		let stories = 0;
		for (const p of hurt) {
			const prospect = toCollegeProspect(p, SEASON);
			assert.isTrue(prospect.injuryHistory);
			const story = pickStory(
				prospect,
				{ z: 0, classIndex: 1, isNcaa: true, school },
				`s|${p.pid}`,
			);
			if (story === "injury") {
				stories += 1;
			}
			assert.strictEqual(
				p.traits!.durabilitySeed,
				clampSeed(
					generateTraitSeeds(getLeagueTraitSeed(), p.pid).durabilitySeed - 0.6,
				),
			);
		}
		assert.isAbove(stories / hurt.length, 0.6);
		// The others are untouched
		for (const p of players.filter((p) => !p.draftClassShapeInjury)) {
			assert.isUndefined(toCollegeProspect(p, SEASON).injuryHistory);
		}
	});
});
