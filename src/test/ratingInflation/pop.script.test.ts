// @ts-nocheck (node-only script, like src/common/archetypes/report.script.test.ts)
/* eslint-disable no-undef */
// Run with RUN_RATING_INFLATION=1 (see docs/rating-inflation.md). Env: RI_CONFIGS, RI_SEEDS, RI_SEASONS, RI_OUT
import { appendFileSync, mkdirSync } from "node:fs";
import { test } from "vitest";
import { OFF } from "./harness.ts";
import { TOGGLES } from "./toggles.ts";
import { runPopModel } from "./popModel.ts";

test.skipIf(!process.env.RUN_RATING_INFLATION)(
	"rating inflation population model",
	async () => {
		const configs = (process.env.RI_CONFIGS ?? "off,allOn").split(",");
		const seeds = (process.env.RI_SEEDS ?? "1").split(",").map(Number);
		const seasons = Number(process.env.RI_SEASONS ?? 3);
		const outDir = process.env.RI_OUT ?? "/tmp/ratingInflation/pop";
		mkdirSync(outDir, { recursive: true });
		for (const seed of seeds) {
			for (const config of configs) {
				const file = `${outDir}/${config}-${seed}.jsonl`;
				const t0 = Date.now();
				await runPopModel({
					config,
					settings: { ...OFF, ...TOGGLES[config] },
					seed,
					seasons,
					onSeason: (s) => {
						appendFileSync(file, JSON.stringify(s) + "\n");
						console.log(
							config,
							seed,
							s.season,
							s.ovrMean,
							s.top10,
							s.coachingMean,
							`${Math.round((Date.now() - t0) / 1000)}s`,
						);
					},
				});
			}
		}
	},
	24 * 3600 * 1000,
);
