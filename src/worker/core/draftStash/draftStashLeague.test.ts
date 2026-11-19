// Draft-and-stash in a real (headless) league with generated college/overseas stats: AI teams stash some late overseas picks
// after the draft, the stashed players are off every roster, the pages that show them load (player, roster, trade), their
// season abroad is added after the next playoffs and they develop in the preseason; then the user's team trades for one.
import "fake-indexeddb/auto";
import { afterAll, assert, describe, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { getProStats } from "../../../common/preDraft.ts";
import { last } from "../../../common/utils.ts";
import { draft, game, league, phase, player, trade } from "../index.ts";
import * as views from "../../views/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../../util/index.ts";
import { getStashedPlayers } from "./index.ts";

const realRandom = Math.random;
afterAll(() => {
	Math.random = realRandom;
});

const loadView = (id: string, params: Record<string, unknown> = {}) => {
	const view = (views as any)[id];
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	return view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: inputs,
		prevOutput: {},
		conditions: {},
	});
};

const fixUserRoster = async () => {
	const tid = g.get("userTid");
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	players.sort((a, b) => a.value - b.value);
	while (players.length > g.get("maxRosterSize")) {
		await player.release(players.shift()!, false);
	}
};

describe("draft-and-stash league", () => {
	test(
		"AI stash, pages, a season abroad, development, a trade",
		{ timeout: 20 * 60 * 1000 },
		async () => {
			Math.random = makeSeededRandom(7);
			const settings: any = getDefaultSettings();
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
					name: "stash",
					setLeagueCreationStatus: () => {},
					settings: {
						...settings,
						generateCollegeStats: true,
						numGames: 4,
						numGamesPlayoffSeries: [1],
						numPlayoffByes: 0,
					},
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			assert.isTrue(g.get("featureDraftStash"));

			const playSeason = async () => {
				await fixUserRoster();
				await phase.newPhase(PHASE.REGULAR_SEASON, {});
				let days = 0;
				while (g.get("phase") <= PHASE.PLAYOFFS) {
					await fixUserRoster();
					await game.play(1, {});
					days += 1;
					assert.isBelow(days, 100);
				}
			};

			// First season, then the draft: AI teams stash some of their late overseas picks
			await playSeason();
			await phase.newPhase(PHASE.DRAFT, {});
			await draft.runPicks({ type: "untilEnd" }, {});
			assert.strictEqual(g.get("phase"), PHASE.AFTER_DRAFT);
			const draftYear = g.get("season");
			const stashed = await getStashedPlayers();
			assert.isAbove(stashed.length, 0, "some picks stashed");
			for (const p of stashed) {
				assert.strictEqual(p.draft.year, draftYear);
				assert.isAbove(p.stash!.tid, -1);
				assert.notStrictEqual(p.stash!.tid, g.get("userTid"));
				assert.isUndefined(p.contractDemand);
				assert.strictEqual(getProStats(p).length, 0);
			}

			// The pages that show him
			const p0 = stashed[0]!;
			const playerView = await loadView("player", { pid: String(p0.pid) });
			assert.strictEqual(playerView.stashInfo?.type, "stashed");
			assert.include(playerView.teamName, "Stashed overseas");
			const rosterView = await loadView("roster", {
				team: `${g.get("teamInfoCache")[p0.stash!.tid]!.abbrev}_${p0.stash!.tid}`,
			});
			assert.isTrue(
				rosterView.stash.stashed.some((p: any) => p.pid === p0.pid),
			);
			assert.isFalse(rosterView.players.some((p: any) => p.pid === p0.pid));

			// The user trades for his rights
			await trade.create([
				{ tid: 0, pids: [], dpids: [], pidsExcluded: [], dpidsExcluded: [] },
				{
					tid: p0.stash!.tid,
					pids: [p0.pid],
					dpids: [],
					pidsExcluded: [],
					dpidsExcluded: [],
				},
			]);
			const tradeView = await loadView("trade", {});
			assert.isTrue(
				tradeView.otherRoster.some((p: any) => p.pid === p0.pid && p.stashed),
			);
			assert.deepEqual(
				tradeView.summary.teams[1].trade.map((p: any) => p.pid),
				[p0.pid],
			);
			await trade.processTrade(
				[
					{ tid: 0, pids: [], dpids: [], pidsExcluded: [], dpidsExcluded: [] },
					{
						tid: p0.stash!.tid,
						pids: [p0.pid],
						dpids: [],
						pidsExcluded: [],
						dpidsExcluded: [],
					},
				],
				undefined,
			);
			const traded = (await idb.cache.players.get(p0.pid))!;
			assert.strictEqual(traded.tid, PLAYER.STASHED);
			assert.strictEqual(traded.stash!.tid, 0);
			const userView = await loadView("player", { pid: String(p0.pid) });
			assert.isTrue(userView.stashInfo.userCanAct);

			// Through the offseason into the next season: development, then a season abroad after the playoffs
			await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
			await phase.newPhase(PHASE.FREE_AGENCY, {});
			await phase.newPhase(PHASE.PRESEASON, {});
			const stillStashed = await getStashedPlayers();
			for (const p of stillStashed) {
				assert.strictEqual(p.ratings.at(-1)!.season, g.get("season"));
			}
			await playSeason();
			for (const p of await getStashedPlayers()) {
				const rows = p.stats.filter((row) => row.stash);
				assert.deepEqual(
					rows.map((row) => row.season),
					[draftYear + 1],
				);
				assert.strictEqual(rows[0]!.teamName, p.stash!.league);
				assert.strictEqual(getProStats(p).length, 0);
			}
		},
	);
});
