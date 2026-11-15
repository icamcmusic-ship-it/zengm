// Not a real test: plays a league headlessly (fake-indexeddb, auto play, new-league defaults, so Advanced Tracking Stats on) and, after
// each season's playoffs, computes the award candidates with the tracking formulas and with the setting off (the stock formulas),
// writing one JSON file per season for the calibration in docs/native-features.md. Skipped unless TRK_AWARDS_OUT (a directory) is set:
//
//   TRK_AWARDS_OUT=/tmp/trk TRK_AWARDS_SEASONS=3 TRK_AWARDS_SEED=1 \
//     node_modules/.bin/vitest run --project basketball src/worker/core/awards/trackingAwards.calibration.test.ts
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { league } from "../index.ts";
import { startAutoPlay } from "../league/autoPlay.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../../util/index.ts";
import { getAwardCandidates } from "./getAwardCandidates.ts";

const nodeProcess = (globalThis as any).process;
const OUT: string | undefined = nodeProcess.env.TRK_AWARDS_OUT;
const N = Number(nodeProcess.env.TRK_AWARDS_SEASONS ?? 3);
const SEED = Number(nodeProcess.env.TRK_AWARDS_SEED ?? 1);

const KEEP = [
	"score",
	"trkImpact",
	"trkClutch",
	"trkDef",
	"trkPtEff",
	"trkImpactPlayoffs",
	"dfgpVsExp",
	"rimDfgpVsExp",
	"rimDeter",
	"con36",
	"onOffNet",
	"onOffDrtg",
	"blk",
	"stl",
	"dws",
	"pts",
	"clMin",
	"clPts",
	"clPm",
	"clFga",
	"clFg",
	"clUsgp",
	"gmsc",
	"won",
];

const summarize = async (season: number) => {
	const { awardCandidates } = await getAwardCandidates(season, g.get("awards"));
	return awardCandidates.flat().map((award) => ({
		shortName: award.shortName,
		rank: award.rank,
		players: award.players.map((p: any) => {
			const out: Record<string, unknown> = {
				pid: p.pid,
				name: p.name,
				pos: p.pos,
			};
			for (const key of KEEP) {
				const value = p.currentStats[key];
				if (typeof value === "number") {
					out[key] = Math.round(value * 1000) / 1000;
				}
			}
			return out;
		}),
	}));
};

describe.skipIf(!OUT)("tracking awards calibration league", () => {
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
				name: `trk${SEED}`,
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
			storePlayByPlay: false,
		});
		const start = g.get("season");
		for (let i = 0; i < N; i++) {
			const t0 = Date.now();
			await startAutoPlay(start + i, PHASE.DRAFT, {});
			const on = await summarize(start + i);
			g.setWithoutSavingToDB("advStats" as any, false);
			const off = await summarize(start + i);
			g.setWithoutSavingToDB("advStats" as any, true);
			writeFileSync(
				`${OUT}/s${SEED}-${start + i}.json`,
				JSON.stringify({ seed: SEED, season: start + i, on, off }),
			);
			console.log(
				`seed ${SEED} season ${start + i}: ${Math.round((Date.now() - t0) / 1000)}s`,
			);
			if (i < N - 1) {
				await startAutoPlay(start + i + 1, PHASE.PRESEASON, {});
			}
		}
	});
});
