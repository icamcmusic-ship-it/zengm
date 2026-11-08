import { test } from "vitest";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import fs from "node:fs";
import { simGames, summarize } from "./possessionMetrics.ts";

/*
 * Before/after table for the possession model, ~1000 games each (about a minute or two). Not part of the normal test run:
 *   POSS_METRICS=1 node_modules/.bin/vitest --run --project basketball src/worker/core/GameSim.basketball/possessionMetrics.test.ts
 * POSS_METRICS_GAMES sets the number of games per model, POSS_METRICS_OUT a file to write the table to.
 */

const env = (globalThis as any).process?.env ?? {};

// Approximate modern NBA values (2022-25 regular seasons: basketball-reference league averages, NBA.com tracking "shooting by shot
// clock", pbpstats.com possession lengths), for comparison
const NBA: Record<string, string> = {
	pts: "~114",
	fgp: "~0.47",
	tpaRate: "~0.39",
	ftr: "~0.26",
	tovPct: "~0.13",
	orbPct: "~0.25",
	pace: "~99-100",
	paceSd: "~3-4 (teams)",
	min: "240",
	possLength: "~14-15 s",
	transLength: "~5-8 s",
	halfCourtLength: "~16-18 s",
	endTov: "~0.13",
	scMedian: "~10 s left",
	sc24_22: "~0.06",
	sc22_18: "~0.15",
	sc18_15: "~0.16",
	sc15_7: "~0.38",
	sc7_4: "~0.15",
	sc4_0: "~0.09",
	orbToShot: "putbacks 0-3 s",
	secondChancePts: "~13-14",
	violationsPerTeamGame: "~0.5-1",
	lastShotUnder3: "most",
	twoForOneShotTime: "~5-15 s (start 34-50 s left)",
};

test.skipIf(!env.POSS_METRICS)(
	"prints before/after possession metrics",
	{ timeout: 30 * 60 * 1000 },
	async () => {
		const numGames = Number(env.POSS_METRICS_GAMES ?? 1000);
		const before = summarize(await simGames({ realistic: false, numGames }));
		const after = summarize(await simGames({ realistic: true, numGames }));
		const rows: string[] = [];
		const fmt = (x: unknown) =>
			typeof x === "number"
				? Math.abs(x) < 1
					? x.toFixed(3)
					: x.toFixed(2)
				: String(x);
		rows.push(
			`${"metric".padEnd(24)}${"old".padStart(10)}${"new".padStart(10)}   NBA`,
		);
		for (const key of Object.keys(before) as (keyof typeof before)[]) {
			if (key === "paceByTeamRating") {
				continue;
			}
			rows.push(
				`${key.padEnd(24)}${fmt(before[key]).padStart(10)}${fmt(after[key]).padStart(10)}   ${NBA[key] ?? ""}`,
			);
		}
		// pace vs the teams' pace ratings (new model)
		const pr = after.paceByTeamRating.toSorted((a, b) => a[0] - b[0]);
		const third = Math.floor(pr.length / 3);
		const avg = (xs: [number, number][]) =>
			xs.reduce((a, x) => a + x[1], 0) / xs.length;
		rows.push(
			`pace, slowest third of matchups ${avg(pr.slice(0, third)).toFixed(1)}, fastest third ${avg(pr.slice(-third)).toFixed(1)}`,
		);
		const text = `\n${rows.join("\n")}\n`;
		// (the test setup may silence the console, so it can also go to a file)
		if (env.POSS_METRICS_OUT) {
			fs.writeFileSync(env.POSS_METRICS_OUT, text);
		}
		console.log(text);
	},
);
