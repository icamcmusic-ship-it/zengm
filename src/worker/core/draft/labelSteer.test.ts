// Label-aware generation: the archetype engine's labels (read-only) of the drafted part of each class, with and without the label steering,
// from the same random numbers. Bounded and ovr-neutral. LABEL_STEER_REPORT=1 prints the per-class measurements; LABEL_STEER_CLASSES sets how
// many classes (default 6).
import { afterEach, assert, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { nativeFeatureNewLeagueDefaults } from "../../../common/nativeFeatures.ts";
import { LABEL_STEER } from "../../../common/prospectVariety.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import type { Player } from "../../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { draft } from "../index.ts";
import { DEFAULT_NORMS } from "../../../common/archetypes/index.ts";
import {
	fuzzedArchetypeLabel,
	resetArchetypeNorms,
} from "../player/archetype.ts";
import { labelSteerOptions } from "../player/prospectVariety.ts";

const realRandom = Math.random;
afterEach(() => {
	Math.random = realRandom;
	labelSteerOptions.enabled = true;
});

const env = (globalThis as any).process?.env ?? {};
const NUM_CLASSES = Number(env.LABEL_STEER_CLASSES ?? 6);

const genClasses = async (steer: boolean) => {
	labelSteerOptions.enabled = steer;
	const classes: Player[][] = [];
	// Each class from its own fresh league and random numbers, so with and without steering are paired class by class
	for (let i = 0; i < NUM_CLASSES; i++) {
		const rng = new Rng(`labelSteer|${i}`);
		Math.random = () => rng.random();
		resetG();
		Object.assign(g, nativeFeatureNewLeagueDefaults(), {
			lid: 0,
			phase: PHASE.DRAFT_LOTTERY,
			playerTraitsSeed: 12345,
			generateCollegeStats: false,
			rerandomizeDraftClassRatings: false,
		});
		idb.league = mockIDBLeague();
		await resetCache({});
		resetArchetypeNorms();
		const season = g.get("season");
		await draft.genPlayers(season, DEFAULT_LEVEL);
		classes.push(
			(
				(await idb.cache.players.indexGetAll(
					"playersByTid",
					PLAYER.UNDRAFTED,
				)) as Player[]
			).filter((p) => p.draft.year === season),
		);
	}
	const norms = DEFAULT_NORMS;
	return classes.map((c) => {
		const top = c
			.toSorted((a, b) => b.ratings.at(-1)!.pot - a.ratings.at(-1)!.pot)
			.slice(0, LABEL_STEER.pool);
		const counts = new Map<string, number>();
		for (const p of top) {
			const r = p.ratings.at(-1) as any;
			const label = fuzzedArchetypeLabel(r, 0, norms, {
				ovr: r.ovr,
				pot: r.pot,
			});
			counts.set(label, (counts.get(label) ?? 0) + 1);
		}
		const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
		return {
			distinct: counts.size,
			topShare: Math.max(...counts.values()) / top.length,
			ovr: mean(c.map((p) => p.ratings.at(-1)!.ovr)),
			pot: mean(c.map((p) => p.ratings.at(-1)!.pot)),
			top10Ovr: mean(
				c
					.map((p) => p.ratings.at(-1)!.ovr)
					.sort((a, b) => b - a)
					.slice(0, 10),
			),
		};
	});
};

test("label steering: more distinct labels and a smaller top label in each class, ovr unchanged", async () => {
	const t0 = Date.now();
	const before = await genClasses(false);
	const t1 = Date.now();
	const after = await genClasses(true);
	const t2 = Date.now();
	const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
	const m = (rows: typeof before, key: keyof (typeof before)[number]) =>
		mean(rows.map((r) => r[key]));
	if (env.LABEL_STEER_REPORT) {
		for (const [i, b] of before.entries()) {
			const a = after[i]!;
			console.log(
				`class ${i}: distinct ${b.distinct} -> ${a.distinct}, top label ${(100 * b.topShare).toFixed(1)}% -> ${(100 * a.topShare).toFixed(1)}%, ovr ${b.ovr.toFixed(2)} -> ${a.ovr.toFixed(2)}, top 10 ovr ${b.top10Ovr.toFixed(2)} -> ${a.top10Ovr.toFixed(2)}`,
			);
		}
		console.log(
			`mean: distinct ${m(before, "distinct").toFixed(1)} -> ${m(after, "distinct").toFixed(1)}, top label ${(100 * m(before, "topShare")).toFixed(1)}% -> ${(100 * m(after, "topShare")).toFixed(1)}%, max top label ${(100 * Math.max(...before.map((r) => r.topShare))).toFixed(1)}% -> ${(100 * Math.max(...after.map((r) => r.topShare))).toFixed(1)}%, ovr ${m(before, "ovr").toFixed(2)} -> ${m(after, "ovr").toFixed(2)}, pot ${m(before, "pot").toFixed(2)} -> ${m(after, "pot").toFixed(2)}; time ${t1 - t0} ms -> ${t2 - t1} ms for ${NUM_CLASSES} classes`,
		);
	}
	assert.isAbove(m(after, "distinct"), m(before, "distinct"));
	assert.isBelow(m(after, "topShare"), m(before, "topShare"));
	assert.closeTo(m(after, "ovr"), m(before, "ovr"), 0.15);
	assert.closeTo(m(after, "top10Ovr"), m(before, "top10Ovr"), 0.3);
}, 300_000);
