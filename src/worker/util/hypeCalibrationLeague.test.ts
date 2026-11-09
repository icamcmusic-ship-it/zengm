// Not a real test: plays a real league headlessly (fake-indexeddb, auto play, default settings) and saves every season's hype snapshot (bbgm.hypeCalibrationDump) for tools/hypeCalibration/calibrate.ts. Skipped unless HYPE_LEAGUE_OUT (a directory) is set:
//
//   HYPE_LEAGUE_OUT=/tmp/hypeLeague HYPE_LEAGUE_SEASONS=2 HYPE_LEAGUE_SEED=1 \
//     node_modules/.bin/vitest run --project basketball src/worker/util/hypeCalibrationLeague.test.ts
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import { league } from "../core/index.ts";
import { startAutoPlay } from "../core/league/autoPlay.ts";
import { getDefaultSettings } from "../views/newLeague.ts";
import { hypeCalibrationDump } from "./hypeData.ts";
import { g, helpers } from "./index.ts";

const nodeProcess = (globalThis as any).process;
const OUT: string | undefined = nodeProcess.env.HYPE_LEAGUE_OUT;
const N = Number(nodeProcess.env.HYPE_LEAGUE_SEASONS ?? 2);
const SEED = Number(nodeProcess.env.HYPE_LEAGUE_SEED ?? 1);

describe.skipIf(!OUT)("hype calibration real league", () => {
	test("sim", { timeout: 24 * 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(SEED);
		mkdirSync(OUT!, { recursive: true });
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
				name: `hype${SEED}`,
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
			storePlayByPlay: false,
		});
		const start = g.get("season");
		for (let i = 0; i < N; i++) {
			const t0 = Date.now();
			// through the playoffs to the draft
			await startAutoPlay(start + i, PHASE.DRAFT, {});
			const raw = await hypeCalibrationDump(start + i);
			writeFileSync(`${OUT}/s${SEED}-${start + i}.json`, JSON.stringify(raw));
			console.log(
				`seed ${SEED} season ${start + i}: ${raw.games.length} games, ${Math.round((Date.now() - t0) / 1000)}s, heap ${Math.round(nodeProcess.memoryUsage().heapUsed / 1e6)}MB`,
			);
			if (i < N - 1) {
				await startAutoPlay(start + i + 1, PHASE.PRESEASON, {});
			}
		}
	});
});
