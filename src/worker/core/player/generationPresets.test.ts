// Generation presets: an era tilts the builds of new players (type mix within each height band, ratings toward the era's style) with
// every player's ovr kept, so the league's talent level is unchanged. Balanced is the generator exactly as without presets.
// GEN_PRESET_REPORT=1 prints the measurement table (docs/native-features.md, Generation presets).
import { afterEach, assert, describe, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import {
	GENERATION_PRESET_NAMES,
	presetTypeShares,
	type GenerationPreset,
} from "../../../common/prospectVariety.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import genRatings from "./genRatings.basketball.ts";
import { ovrRaw } from "./ovr.basketball.ts";
import pos from "./pos.basketball.ts";

const realRandom = Math.random;
afterEach(() => {
	Math.random = realRandom;
});

const N = 1500;

const sample = (preset: GenerationPreset, on = true) => {
	resetG();
	// (new leagues' positions: the scorer type)
	g.setWithoutSavingToDB("improvedPositions" as any, true);
	g.setWithoutSavingToDB("featureGenerationPresets" as any, on);
	g.setWithoutSavingToDB("generationPreset" as any, preset);
	const rng = new Rng("genPresets");
	Math.random = () => rng.random();
	const rows = [];
	for (let i = 0; i < N; i++) {
		const { ratings, build } = genRatings(2026, DEFAULT_LEVEL);
		rows.push({ ratings, build });
	}
	return rows;
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const summarize = (rows: ReturnType<typeof sample>) => {
	const positions = rows.map((r) => pos(r.ratings as any));
	const share = (set: string[]) =>
		positions.filter((p) => set.includes(p)).length / rows.length;
	const typeShare = (t: string) =>
		rows.filter((r) => r.build === t).length / rows.length;
	const avg = (key: string) => mean(rows.map((r) => (r.ratings as any)[key]));
	return {
		ovr: mean(rows.map((r) => ovrRaw(r.ratings as any))),
		guards: share(["PG", "G", "SG"]),
		bigs: share(["PF", "FC", "C"]),
		point: typeShare("point"),
		scorer: typeShare("scorer"),
		big: typeShare("big"),
		tp: avg("tp"),
		ins: avg("ins"),
		reb: avg("reb"),
		drb: avg("drb"),
		jmp: avg("jmp"),
		spd: avg("spd"),
	};
};

describe("generation presets", () => {
	test("type shares stay a distribution and follow the weights", () => {
		const base = { point: 0.05, scorer: 0.75, big: 0.02, wing: 0.18 };
		assert.strictEqual(presetTypeShares(base, "balanced"), base);
		for (const preset of ["guard", "big", "shooting", "athletic"] as const) {
			const s = presetTypeShares(base, preset);
			assert.closeTo(s.point + s.scorer + s.big + s.wing, 1, 1e-9);
		}
		assert.isAbove(presetTypeShares(base, "guard").point, base.point);
		assert.isAbove(presetTypeShares(base, "big").big, base.big);
	});

	test("balanced (or the switch off) is the generator as before; each era tilts builds at the same ovr", () => {
		const balanced = sample("balanced");
		const off = sample("guard", false);
		assert.deepEqual(
			balanced.map((r) => r.ratings),
			off.map((r) => r.ratings),
		);
		const b = summarize(balanced);
		const results: Record<string, ReturnType<typeof summarize>> = {
			balanced: b,
		};
		for (const preset of ["guard", "big", "shooting", "athletic"] as const) {
			results[preset] = summarize(sample(preset));
		}
		if ((globalThis as any).process?.env?.GEN_PRESET_REPORT) {
			const f = (x: number) => x.toFixed(1);
			const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
			console.log(
				"preset | ovr raw | guards (PG/G/SG) | bigs (PF/FC/C) | point / scorer / big type | tp | ins | reb | drb | jmp | spd",
			);
			for (const [key, s] of Object.entries(results)) {
				console.log(
					[
						GENERATION_PRESET_NAMES[key as GenerationPreset],
						f(s.ovr),
						pct(s.guards),
						pct(s.bigs),
						`${pct(s.point)} / ${pct(s.scorer)} / ${pct(s.big)}`,
						f(s.tp),
						f(s.ins),
						f(s.reb),
						f(s.drb),
						f(s.jmp),
						f(s.spd),
					].join(" | "),
				);
			}
		}
		for (const preset of ["guard", "big", "shooting", "athletic"] as const) {
			// Talent unchanged: mean raw ovr within a quarter of a point
			assert.closeTo(results[preset]!.ovr, b.ovr, 0.25, preset);
		}
		assert.isAbove(results.guard!.guards, b.guards + 0.04);
		assert.isAbove(results.guard!.drb, b.drb + 2);
		assert.isAbove(results.big!.bigs, b.bigs + 0.04);
		assert.isAbove(results.big!.ins, b.ins + 2);
		assert.isAbove(results.shooting!.tp, b.tp + 3);
		assert.isAbove(results.athletic!.jmp, b.jmp + 2);
	}, 120_000);
});
