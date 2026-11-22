// @ts-nocheck
/* eslint-disable no-undef */
// Position shares of generated players (ratings only), for tuning POSITION_BIAS. RUN_POS_SHARES=1.
import { test } from "vitest";
import { writeFileSync } from "node:fs";
import genRatings from "../../worker/core/player/genRatings.basketball.ts";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { resetG } from "../../test/helpers.ts";
import { positionFor, POSITION_BIAS } from "./position.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import { vi } from "vitest";

test.skipIf(!process.env.RUN_POS_SHARES)(
	"position shares",
	() => {
		resetG();
		const rng = new Rng("posShares");
		vi.spyOn(Math, "random").mockImplementation(() => rng.random());
		const bias = process.env.POS_BIAS ? JSON.parse(process.env.POS_BIAS) : {};
		Object.assign(POSITION_BIAS, bias);
		const c: Record<string, number> = {};
		const N = 6000;
		for (let i = 0; i < N; i++) {
			const { ratings } = genRatings(2025, DEFAULT_LEVEL);
			const p = positionFor(ratings, true);
			c[p] = (c[p] ?? 0) + 1;
		}
		const pct = (ks: string[]) =>
			Math.round((1000 * ks.reduce((s, k) => s + (c[k] ?? 0), 0)) / N) / 10;
		writeFileSync(
			process.env.POS_OUT ?? "/tmp/posShares.json",
			JSON.stringify({
				G: pct(["PG", "G", "SG"]),
				W: pct(["GF", "SF"]),
				F: pct(["F", "PF"]),
				B: pct(["FC", "C"]),
				each: Object.fromEntries(
					Object.entries(c).map(([k, v]) => [
						k,
						Math.round((1000 * v) / N) / 10,
					]),
				),
			}),
		);
	},
	600000,
);
