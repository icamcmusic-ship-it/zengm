// @ts-nocheck (node-only script, like src/test/ratingInflation/run.script.test.ts)
/* eslint-disable no-undef */
// Front Office Budget calibration (docs/native-features.md, "Front Office Budget"). Run with RUN_FRONT_OFFICE_CALIBRATION=1.
// Env: FO_SEEDS (comma list, default 1-8), FO_SEASONS (default 2), FO_CONFIGS (default avg,ext,natural), FO_OUT (output directory).
//
// Headless leagues (src/test/ratingInflation/harness.ts) with the new-league defaults, every team run by the AI. Configs:
// - avg: every team at level 34 (the league average) in Scouting, Analytics, Medical, Travel and Facilities (Coaching follows the staff)
// - ext: the same leagues (same seeds) with even tids at level 100 and odd tids at level 1 in those departments
// - natural: the AI's own allocation (GM leanings, market size), for the league-wide levels and neutrality
// Levels are set again every preseason, with initialBudget too, so the 3-season averages are the set levels from the first game.
// One JSON line per team-season: wins, point differential, injuries and games, and the fatigue measurement.
import { appendFileSync, mkdirSync } from "node:fs";
import { test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { ALL_ON, createLeague, mulberry32 } from "../ratingInflation/harness.ts";
import { idb } from "../../worker/db/index.ts";
import { g, helpers, local } from "../../worker/util/index.ts";
import { startAutoPlay } from "../../worker/core/league/autoPlay.ts";
import { getNewDeptLevelLastThree } from "../../worker/core/frontOffice/index.ts";
import { finances } from "../../worker/core/index.ts";

const setLevels = async (config: string) => {
	if (config === "natural") {
		return;
	}
	for (const t of await idb.cache.teams.getAll()) {
		const level = config === "avg" ? 34 : t.tid % 2 === 0 ? 100 : 1;
		for (const key of ["scouting", "health", "facilities"] as const) {
			t.budget[key] = level;
			t.initialBudget[key] = level;
		}
		t.frontOffice = { analytics: level, travel: level };
		await idb.cache.teams.put(t);
	}
};

test.skipIf(!process.env.RUN_FRONT_OFFICE_CALIBRATION)(
	"front office calibration",
	async () => {
		if ((globalThis as any).IDBRequest === undefined) {
			await import("fake-indexeddb/auto");
		}
		const seeds = (process.env.FO_SEEDS ?? "1,2,3,4,5,6,7,8")
			.split(",")
			.map(Number);
		const seasons = Number(process.env.FO_SEASONS ?? 2);
		const configs = (process.env.FO_CONFIGS ?? "avg,ext,natural").split(",");
		const outDir = process.env.FO_OUT ?? "/tmp/frontOffice";
		mkdirSync(outDir, { recursive: true });
		for (const seed of seeds) {
			for (const config of configs) {
				const file = `${outDir}/${config}-${seed}.jsonl`;
				const origRandom = Math.random;
				Math.random = mulberry32(seed);
				const t0 = Date.now();
				try {
					await createLeague({ ...ALL_ON, featureFrontOffice: true });
					for (let i = 0; i < seasons; i++) {
						await setLevels(config);
						const season = g.get("season");
						await startAutoPlay(season, PHASE.DRAFT_LOTTERY, {});
						const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
							"teamSeasonsBySeasonTid",
							[[season], [season, "Z"]],
						);
						const teamStats = (await idb.cache.teamStats.getAll()).filter(
							(ts) => ts.season === season && !ts.playoffs,
						);
						const teams = await idb.cache.teams.getAll();
						for (const ts of teamSeasons) {
							const st = teamStats.find((x) => x.tid === ts.tid);
							const t = teams.find((x) => x.tid === ts.tid);
							const r = ts.frontOffice?.review;
							appendFileSync(
								file,
								JSON.stringify({
									config,
									seed,
									season,
									tid: ts.tid,
									group:
										config === "natural"
											? "natural"
											: config === "avg"
												? "avg"
												: ts.tid % 2 === 0
													? "max"
													: "min",
									won: ts.won,
									lost: ts.lost,
									gp: helpers.getTeamSeasonGp(ts),
									mov: st && st.gp > 0 ? (st.pts - st.oppPts) / st.gp : 0,
									pop: ts.pop,
									injuries: r?.injuries ?? 0,
									injuryGames: r?.injuryGames ?? 0,
									durationGamesSaved: r?.durationGamesSaved ?? 0,
									injuryGamesAvoided: r?.injuryGamesAvoided ?? 0,
									fatigueGames: r?.fatigueGames ?? 0,
									fatiguePenalty: r?.fatiguePenalty ?? 0,
									fatigueSaved: r?.fatigueSaved ?? 0,
									levels: {
										scouting: await finances.getLevelLastThree("scouting", {
											tid: ts.tid,
										}),
										health: await finances.getLevelLastThree("health", {
											tid: ts.tid,
										}),
										facilities: await finances.getLevelLastThree(
											"facilities",
											{ tid: ts.tid },
										),
										coaching: t?.budget.coaching,
										analytics: await getNewDeptLevelLastThree("analytics", {
											tid: ts.tid,
										}),
										travel: await getNewDeptLevelLastThree("travel", {
											tid: ts.tid,
										}),
									},
								}) + "\n",
							);
						}
						console.log(
							config,
							seed,
							season,
							`${Math.round((Date.now() - t0) / 1000)}s`,
						);
						if (i < seasons - 1) {
							await startAutoPlay(season + 1, PHASE.PRESEASON, {});
						}
					}
				} finally {
					Math.random = origRandom;
					local.autoPlayUntil = undefined;
				}
			}
		}
	},
	24 * 3600 * 1000,
);
