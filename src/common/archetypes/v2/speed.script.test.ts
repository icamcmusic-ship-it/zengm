/* eslint-disable no-undef */
// @ts-nocheck
// archv3: how long the reading takes per player (RUN_ARCHETYPE_SPEED=1): generated draft prospects and league players,
// the whole reading (classifyV2) and its parts (the classic reading, scoreAll, the neighbours), cold and warm.
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_LEVEL } from "../../budgetLevels.ts";
import { Rng } from "../../ratingsBuilds/rng.ts";
import { RATING_KEYS } from "../../ratingsBuilds/solver.ts";
import { resetG } from "../../../test/helpers.ts";
import generate from "../../../worker/core/player/generate.ts";
import { ensureSubs } from "../../../worker/core/player/subRatings.ts";
import { g } from "../../../worker/util/index.ts";
import { ARCHETYPES, classify, defaultNorms, scoreAll } from "../classify.ts";
import { positionFor } from "../position.ts";
import { classifyV2 } from "./engine.ts";
import { BUCKET_OF, FEAT_FROM_FAMX, knnVotes, standardize } from "./knn.ts";

test.skipIf(!process.env.RUN_ARCHETYPE_SPEED)(
	"archetype reading speed",
	async () => {
		resetG();
		g.setWithoutSavingToDB("subRatings", true);
		const rng = new Rng("speed");
		const orig = Math.random;
		Math.random = () => rng.random();
		const ps = [];
		try {
			for (let i = 0; i < 300; i++) {
				const p = generate(-1, 19, 2025, false, DEFAULT_LEVEL);
				ensureSubs(p);
				const row = p.ratings.at(-1);
				const r = {};
				for (const k of RATING_KEYS) {
					r[k] = row[k];
				}
				r.sub = row.sub;
				ps.push({ ratings: r, pos: positionFor(r, true) });
			}
		} finally {
			Math.random = orig;
		}
		const norms = defaultNorms(false);
		{
			const { shippedRefs } = await import("./knn.ts");
			const t0 = performance.now();
			shippedRefs();
			appendFileSync(
				process.env.ARCH_SPEED_OUT ?? "/tmp/claude-0/arch-speed.txt",
				`kNN index build: ${(performance.now() - t0).toFixed(0)} ms\n`,
			);
		}
		const time = (label, f) => {
			const t0 = performance.now();
			for (const p of ps) {
				f(p);
			}
			const ms = performance.now() - t0;
			appendFileSync(
				process.env.ARCH_SPEED_OUT ?? "/tmp/claude-0/arch-speed.txt",
				`${label}: ${(ms / ps.length).toFixed(2)} ms/player (${ms.toFixed(0)} ms for ${ps.length})\n`,
			);
		};
		time("classifyV2 cold", (p) =>
			classifyV2(p.ratings, { norms, pos: p.pos, prospect: true }),
		);
		time("classifyV2 warm", (p) =>
			classifyV2(p.ratings, { norms, pos: p.pos, prospect: true }),
		);
		time("classify", (p) =>
			classify(p.ratings, { norms, pos: p.pos, prospect: true }),
		);
		time("scoreAll", (p) =>
			scoreAll(p.ratings, norms, ARCHETYPES, p.pos, undefined, {
				prospect: true,
			}),
		);
		const xs = ps.map((p) => {
			const s = scoreAll(p.ratings, norms, ARCHETYPES, p.pos, undefined, {
				prospect: true,
			});
			return [
				standardize(FEAT_FROM_FAMX(s.famX), BUCKET_OF[s.pos]),
				BUCKET_OF[s.pos],
			];
		});
		let i = 0;
		time("knnVotes", () => {
			const [x, b] = xs[i++ % xs.length];
			knnVotes(x, b, { k: 15 });
		});
	},
	600000,
);
