// Regression test for rating inflation (docs/rating-inflation.md): a new-league-defaults league (every League extra that
// touches ratings turned on) simulated for a few seasons with the population model keeps league ratings where an
// existing league's are. The full audit is pop.script.test.ts.
import { afterAll, assert, test } from "vitest";
import { resetG } from "../../test/helpers.ts";
import { idb } from "../../worker/db/index.ts";
import { OFF } from "./harness.ts";
import { runPopModel } from "./popModel.ts";
import { TOGGLES } from "./toggles.ts";

// Tests share one worker (isolate: false), so put back what the simulation replaced
const { cache, league } = idb;
afterAll(() => {
	idb.cache = cache;
	idb.league = league;
	resetG();
});

test("league mean ovr/pot stay in the normal band with every rating-related feature on", async () => {
	// Two leagues, averaged season by season: one league's mean ovr moves by up to about ±0.8 with any change in how random numbers
	// are drawn (seed 7 alone went from 51.9 to 52.54 in its first season with arch13's small-guard prospects, while seed 1 went down
	// 0.85), so a single league sat on the edge of the band
	const runs: Awaited<ReturnType<typeof runPopModel>>[] = [];
	for (const seed of [7, 1]) {
		runs.push(
			await runPopModel({
				config: "allOn",
				settings: { ...OFF, ...TOGGLES.allOn },
				seed,
				seasons: 4,
			}),
		);
	}
	const mean = (values: number[]) =>
		values.reduce((a, b) => a + b, 0) / values.length;
	const seasons = runs[0]!.map((_, i) => ({
		ovrMean: mean(runs.map((run) => run[i]!.ovrMean as number)),
		potMean: mean(runs.map((run) => run[i]!.potMean as number)),
		coachingEffectMean: mean(
			runs.map((run) => run[i]!.coachingEffectMean as number),
		),
	}));
	assert.strictEqual(seasons.length, 4);
	for (const s of seasons) {
		// Existing-league baseline over 30 seasons and 3 seeds: ovr 49.5-50.6, pot 56-57.5
		assert.isAbove(s.ovrMean as number, 48);
		assert.isBelow(s.ovrMean as number, 52.5);
		assert.isAbove(s.potMean as number, 54.5);
		assert.isBelow(s.potMean as number, 59.5);
		// The coaching staff's development effect (coachingEffect, a fraction of yearly rating changes) is centered on the
		// league average staff. With the old fixed reference it was -0.02 in a new league.
		assert.isBelow(Math.abs(s.coachingEffectMean as number), 0.005);
	}
}, 900_000);
