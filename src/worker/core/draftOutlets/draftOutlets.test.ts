// Big boards from media outlets, in a league: the boards of the current class (Big Boards page, pre-draft page), the final boards stored
// when the draft starts, the scorecard after the draft, and the scouts' slot calls and flags filed for their track records.
import "fake-indexeddb/auto";
import { assert, describe, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { OUTLETS } from "../../../common/draftOutlets.ts";
import { draft, league } from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import bigBoardsView from "../../views/bigBoards.ts";
import scoutingDepartmentView from "../../views/scoutingDepartment.ts";
import {
	afterNewPhase,
	getClassBoards,
	getOutletHistory,
	getPlayerOutletRanks,
} from "./index.ts";
import { recordSnapshots } from "../scoutingReports/index.ts";
import { clearScoutingCache } from "../scoutingReports/input.ts";

const loadView = (view: { load: (args: any) => any }, inputs = {}) =>
	view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: undefined,
		prevOutput: {},
		conditions: {},
	});

const newLeague = async () => {
	Math.random = makeSeededRandom(7);
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
			name: "outlets",
			setLeagueCreationStatus: () => {},
			settings: getDefaultSettings(),
			shuffleRosters: false,
			startingSeasonFromInput: "2025",
			teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
			tid: 0,
		},
	);
	await league.loadGameAttributes();
};

describe("draft outlets in a league", () => {
	test("boards, the stored final boards, the scorecard and the scouts' filed calls", async () => {
		await newLeague();
		const season = g.get("season");

		// Before the draft: every outlet ranks the class, the same on every load
		const view: any = await loadView(bigBoardsView, { season });
		assert.isUndefined(view.errorMessage);
		assert.isAbove(view.rows.length, 40);
		assert.strictEqual(view.outlets.length, OUTLETS.length);
		assert.isFalse(view.stored);
		const first = view.rows[0];
		assert.strictEqual(first.consensus.rank, 1);
		assert.strictEqual(first.ranks.length, OUTLETS.length);
		const again: any = await loadView(bigBoardsView, { season });
		assert.deepEqual(
			again.rows.map((r: any) => r.ranks),
			view.rows.map((r: any) => r.ranks),
		);
		const pre = await getPlayerOutletRanks(
			(await idb.cache.players.get(first.pid))!,
		);
		assert.strictEqual(pre?.consensus.rank, 1);

		// The draft starts: final boards stored on every prospect of the class, and the scouts file their calls
		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
		await afterNewPhase(PHASE.DRAFT);
		clearScoutingCache();
		await recordSnapshots(PHASE.DRAFT);
		const prospects = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
		).filter((p) => p.draft.year === season);
		for (const p of prospects) {
			assert.strictEqual(p.outletRanks?.s, season);
			assert.strictEqual(p.outletRanks!.r.length, OUTLETS.length);
			assert.isAbove(p.outletRanks!.c, 0);
		}
		const withCalls = prospects.filter((p) => p.scoutDraft?.rk);
		assert.isAbove(withCalls.length, 10);
		for (const p of withCalls) {
			assert.isNumber(p.scoutDraft!.cs);
		}

		// The draft
		g.setWithoutSavingToDB("phase", PHASE.DRAFT);
		await draft.genOrder(false);
		// (the AI makes every pick, the user's too)
		g.setWithoutSavingToDB("spectator", true);
		await draft.runPicks({ type: "untilEnd" });
		g.setWithoutSavingToDB("spectator", false);
		const stored = await getClassBoards(season);
		assert.isTrue(stored?.stored);
		const history = await getOutletHistory(season);
		const card = history.find((h) => h.season === season)!;
		assert.isDefined(card);
		for (const o of OUTLETS) {
			const line = card.draft[`o${o.id}`]!;
			assert.isDefined(line);
			assert.strictEqual(line.n, g.get("numActiveTeams"));
			assert.isAbove(line.hits, g.get("numActiveTeams") / 2);
		}
		// Not judged yet
		assert.isUndefined(card.outcome);

		const after: any = await loadView(bigBoardsView, { season });
		assert.isTrue(after.stored);
		assert.isTrue(after.rows.some((r: any) => r.pick));

		// The Scouting Department shows the pending slot calls
		const dept: any = await loadView(scoutingDepartmentView, {
			tid: g.get("userTid"),
		});
		assert.strictEqual(dept.trackSeasons, 3);
		assert.isAbove(
			dept.scouts.reduce((a: number, s: any) => a + s.slots.pending, 0),
			0,
		);
	}, 120_000);
});
