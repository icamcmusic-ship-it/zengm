// @ts-nocheck
/* eslint-disable no-undef */
// Front Office Budget off = unchanged: RUN_FO_IDENTITY=1 FO_IDENTITY_OUT=<file> writes the simFingerprint hash and the next random
// number of two seeded headless leagues (a season and the next preseason, the setting off, every other new-league default on). Run it
// here and in a master checkout and compare the files (docs/native-features.md, "Front office budget").
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import {
	ALL_ON,
	createLeague,
	mulberry32,
	simFingerprint,
} from "../ratingInflation/harness.ts";
import { g, local } from "../../worker/util/index.ts";
import { startAutoPlay } from "../../worker/core/league/autoPlay.ts";

test.skipIf(!process.env.RUN_FO_IDENTITY)(
	"fo identity",
	async () => {
		if ((globalThis as any).IDBRequest === undefined) {
			await import("fake-indexeddb/auto");
		}
		const out = [];
		for (const seed of [11, 12]) {
			const orig = Math.random;
			Math.random = mulberry32(seed);
			try {
				await createLeague({ ...ALL_ON, featureFrontOffice: false });
				await startAutoPlay(g.get("season"), PHASE.DRAFT_LOTTERY, {});
				await startAutoPlay(g.get("season") + 1, PHASE.REGULAR_SEASON, {});
				const fp = await simFingerprint();
				out.push(
					createHash("sha256").update(JSON.stringify(fp)).digest("hex") +
						" r=" +
						Math.random(),
				);
			} finally {
				Math.random = orig;
				local.autoPlayUntil = undefined;
			}
		}
		writeFileSync(process.env.FO_IDENTITY_OUT, out.join("\n") + "\n");
	},
	3600000,
);
