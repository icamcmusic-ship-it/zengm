// Draft Scouting reads every prospect's archetype live (several ms each). It hung for seconds on every visit before those
// readings were memoised (worker/core/player/archetype.ts classifyPlayer): a repeat load must be fast and give the same page.
import "fake-indexeddb/auto";
import { assert, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import { league } from "../core/index.ts";
import { getDefaultSettings } from "./newLeague.ts";
import { helpers } from "../util/index.ts";
import draftScouting from "./draftScouting.ts";

const load = async () => {
	const t0 = performance.now();
	const data = await draftScouting.load({
		inputs: {},
		updateEvents: new Set(["firstRun"]),
		prevInputs: undefined,
		prevOutput: undefined,
		conditions: {},
	} as any);
	return { data, ms: performance.now() - t0 };
};

describe.skipIf(__SPORT !== "basketball")("Draft Scouting load time", () => {
	test(
		"a repeat load is fast and unchanged",
		{ timeout: 120_000 },
		async () => {
			Math.random = makeSeededRandom(3);
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
					name: "timing",
					setLeagueCreationStatus: () => {},
					settings: getDefaultSettings(),
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();

			const first = await load();
			const second = await load();
			const players = (second.data as any).seasons.flatMap(
				(s: any) => s.players,
			);
			assert.isAbove(players.length, 100);
			assert.isTrue(players.some((p: any) => p.archetype !== undefined));
			assert.deepEqual(second.data, first.data);
			// Was 1.5-4 s per load; the repeat is ~0.1 s (generous bound for slow CI)
			assert.isBelow(second.ms, Math.max(600, first.ms / 3));
		},
	);
});
