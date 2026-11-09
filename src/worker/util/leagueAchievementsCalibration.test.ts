// Not a real test: the headless (Node, fake-indexeddb) version of tools/leagueAchievementsCalibration/sim.cjs. Skipped unless
// LA_CALIBRATE_OUT is set:
//
//   LA_CALIBRATE_OUT=tools/leagueAchievementsCalibration/data/node1.json LA_CALIBRATE_SEASONS=30 LA_CALIBRATE_LABEL=node1 \
//     node_modules/.bin/vitest run --project basketball src/worker/util/leagueAchievementsCalibration.test.ts
//
// It creates a random-players league (the same path as the smoke test), keeps every season's box scores and records the League
// achievements tally after every completed season, writing the same JSON as sim.cjs (the input of calibrate.ts).
import "fake-indexeddb/auto";
import { writeFileSync } from "node:fs";
import { describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { last } from "../../common/utils.ts";
import { league } from "../core/index.ts";
import { startAutoPlay } from "../core/league/autoPlay.ts";
import { getDefaultSettings } from "../views/newLeague.ts";
import { g, helpers } from "./index.ts";
import { leagueAchievementsTally } from "./leagueAchievements.ts";

// (no Node types in src)
const nodeProcess = (globalThis as any).process;
const OUT = nodeProcess.env.LA_CALIBRATE_OUT;
const N = Number(nodeProcess.env.LA_CALIBRATE_SEASONS ?? 30);
const LABEL = nodeProcess.env.LA_CALIBRATE_LABEL ?? "node";

describe.skipIf(!OUT)("league achievements calibration sim", () => {
	test("sim", { timeout: 24 * 60 * 60 * 1000 }, async () => {
		await league.createStream(
			{},
			{
				confs: last(defaultGameAttributes.confs).value,
				divs: last(defaultGameAttributes.divs).value,
				fromFile: {
					gameAttributes: undefined,
					hasRookieContracts: true,
					maxGid: undefined,
					startingSeason: undefined,
					teams: undefined,
					version: LEAGUE_DATABASE_VERSION,
				},
				getLeagueOptions: undefined,
				keptKeys: new Set(),
				lid: 0,
				name: LABEL,
				setLeagueCreationStatus: () => {},
				settings: getDefaultSettings(),
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		await league.setGameAttributes({
			saveOldBoxScores: {
				pastSeasons: "all",
				pastSeasonsType: "all",
				note: "all",
			},
			// Play-by-play isn't used by the achievements and is most of the memory of a long league in fake-indexeddb
			storePlayByPlay: false,
		});
		const start = g.get("season");
		const seasons = [];
		for (let i = 0; i < N; i++) {
			const t0 = Date.now();
			await startAutoPlay(start + i + 1, PHASE.PRESEASON, {});
			const tally = await leagueAchievementsTally();
			seasons.push({ season: start + i, tally });
			const unlocked = Object.values(tally.tiers).filter(
				(x) => x.s === "u",
			).length;
			console.log(
				`${LABEL} season ${start + i}: ${Math.round((Date.now() - t0) / 1000)}s, ${unlocked} unlocked, heap ${Math.round(nodeProcess.memoryUsage().heapUsed / 1e6)}MB`,
			);
			writeFileSync(OUT!, JSON.stringify({ label: LABEL, start, seasons }));
		}
	});
});
