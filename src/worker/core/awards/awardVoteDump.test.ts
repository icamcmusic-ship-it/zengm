// Not a real test: plays a real league headlessly (fake-indexeddb, auto play, default settings) and saves every season's award
// vote inputs (candidates with formula scores and narratives, the stored winners to respect) for calibrating
// common/awardVote (see awardVote.calibration.test.ts). Skipped unless AWARD_VOTE_OUT (a directory) is set:
//
//   AWARD_VOTE_OUT=/tmp/awardVote AWARD_VOTE_SEASONS=10 AWARD_VOTE_SEED=1 \
//     node_modules/.bin/vitest run --project basketball src/worker/core/awards/awardVoteDump.test.ts
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
import { computeVoteInputs } from "./simVote.ts";

const nodeProcess = (globalThis as any).process;
const OUT: string | undefined = nodeProcess.env.AWARD_VOTE_OUT;
const N = Number(nodeProcess.env.AWARD_VOTE_SEASONS ?? 2);
const SEED = Number(nodeProcess.env.AWARD_VOTE_SEED ?? 1);

describe.skipIf(!OUT)("award vote calibration league", () => {
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
				name: `vote${SEED}`,
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
			// through the playoffs to the draft
			await startAutoPlay(start + i, PHASE.DRAFT, {});
			const inputs = await computeVoteInputs(start + i, true);
			writeFileSync(
				`${OUT}/s${SEED}-${start + i}.json`,
				JSON.stringify(inputs),
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
