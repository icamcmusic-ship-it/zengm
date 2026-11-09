// @ts-nocheck (node-only script, like src/common/archetypes/report.script.test.ts)
/* eslint-disable no-undef */
// RUN_RATING_INFLATION=1: do re-randomized prospects (Ratings regenerator) develop like the original ones? Same class,
// before and after regeneration, developed for 10 seasons many times over.
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { PLAYER } from "../../common/constants.ts";
import { idb } from "../../worker/db/index.ts";
import { g, helpers } from "../../worker/util/index.ts";
import { player } from "../../worker/core/index.ts";
import { autoRegenerateClass } from "../../worker/core/draft/regenerateRatings.ts";
import { createLeague, OFF } from "./harness.ts";

test.skipIf(!process.env.RUN_RATING_INFLATION)(
	"regenerated prospects develop like the originals",
	async () => {
		const out = process.env.RI_REGEN_OUT ?? "/tmp/regenDev.csv";
		appendFileSync(out, "trial,version,years,ovrMean,potMean\n");
		for (let trial = 0; trial < 4; trial++) {
			await createLeague({ ...OFF });
			const prospects = await idb.cache.players.indexGetAll(
				"playersByTid",
				PLAYER.UNDRAFTED,
			);
			const draftYear = g.get("season");
			const cls = prospects.filter((p) => p.draft.year === draftYear);
			const originals = cls.map((p) => helpers.deepCopy(p));
			await autoRegenerateClass(draftYear, undefined);
			const regenerated = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			)
				.filter((p) => p.draft.year === draftYear)
				.map((p) => helpers.deepCopy(p));
			let changed = 0;
			for (const [i, p] of regenerated.entries()) {
				const a = originals
					.find((o) => o.pid === p.pid)!
					.ratings.at(-1)! as any;
				const b = p.ratings.at(-1)! as any;
				if (
					["spd", "jmp", "ins", "dnk", "tp", "drb", "pss"].some(
						(k) => a[k] !== b[k],
					)
				) {
					changed += 1;
				}
				void i;
			}
			appendFileSync(
				out,
				`# trial ${trial}: ${changed} of ${regenerated.length} prospects have different ratings after regeneration\n`,
			);
			for (const [version, group] of [
				["original", originals],
				["regenerated", regenerated],
			] as const) {
				for (let rep = 0; rep < 5; rep++) {
					const ps = group.map((p) => helpers.deepCopy(p));
					for (let years = 0; years <= 10; years++) {
						if (years > 0) {
							for (const p of ps) {
								p.ratings.at(-1)!.season = draftYear + years;
								await player.develop(p as any, 1, false, 34, true);
							}
						}
						const ovrs = ps.map((p) => p.ratings.at(-1)!.ovr);
						const pots = ps.map((p) => p.ratings.at(-1)!.pot);
						const m = (xs: number[]) =>
							xs.reduce((a, b) => a + b, 0) / xs.length;
						appendFileSync(
							out,
							`${trial * 10 + rep},${version},${years},${m(ovrs).toFixed(2)},${m(pots).toFixed(2)}\n`,
						);
					}
				}
			}
		}
	},
	3600 * 1000,
);
