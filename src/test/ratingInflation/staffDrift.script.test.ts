// @ts-nocheck (node-only script, like src/common/archetypes/report.script.test.ts)
/* eslint-disable no-undef */
// RUN_RATING_INFLATION=1: league-average coaching staff development level and effect over many offseasons
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_LEVEL, coachingEffect } from "../../common/budgetLevels.ts";
import { PHASE } from "../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../../worker/db/index.ts";
import { g, helpers } from "../../worker/util/index.ts";
import { team } from "../../worker/core/index.ts";
import {
	ensureStaff,
	getStaffLevel,
	onPreseason,
	runOffseason,
} from "../../worker/core/staff/index.ts";

test.skipIf(!process.env.RUN_RATING_INFLATION)(
	"staff level drift",
	async () => {
		const out = process.env.RI_STAFF_OUT ?? "/tmp/staffDrift.csv";
		appendFileSync(out, "seed,year,levelMean,levelSd,effectMean\n");
		for (const seed of [1, 2, 3, 4, 5]) {
			resetG();
			g.setWithoutSavingToDB("coachingStaff", true);
			g.setWithoutSavingToDB("userTids", [-1] as any);
			g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
			idb.league = mockIDBLeague();
			const teams = helpers.getTeamsDefault().map(team.generate);
			await resetCache({ teams });
			await ensureStaff();
			for (let year = 0; year <= 40; year++) {
				const levels: number[] = [];
				for (const t of teams) {
					levels.push(await getStaffLevel(t.tid));
				}
				const m = levels.reduce((a, b) => a + b, 0) / levels.length;
				const s = Math.sqrt(
					levels.reduce((a, b) => a + (b - m) ** 2, 0) / levels.length,
				);
				const e =
					levels.reduce((a, b) => a + coachingEffect(b), 0) / levels.length;
				appendFileSync(
					out,
					`${seed},${year},${m.toFixed(2)},${s.toFixed(2)},${e.toFixed(4)}\n`,
				);
				const season = g.get("season");
				for (const t of teams) {
					const won = Math.round(Math.random() * 82);
					const ts = team.genSeasonRow(t, undefined, season);
					ts.won = won;
					ts.lost = 82 - won;
					ts.playoffRoundsWon = won > 45 ? Math.floor(Math.random() * 5) : -1;
					await idb.cache.teamSeasons.add(ts);
				}
				g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
				await runOffseason();
				g.setWithoutSavingToDB("season", season + 1);
				g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
				await onPreseason();
				g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
			}
		}
		console.log("default effect", coachingEffect(DEFAULT_LEVEL));
	},
	3600 * 1000,
);
