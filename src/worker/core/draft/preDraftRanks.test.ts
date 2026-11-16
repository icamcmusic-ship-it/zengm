// Frozen Pre-draft Ranks setting: a prospect's rank is the one he had in his whole class when the draft started, and doesn't move as
// players are picked (it used to be counted among the players left, so the best one left became "#1", even a second-round prospect).
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
import {
	draftedVsPreDraftText,
	rankByScoutGrade,
	rankClass,
	stealOrReach,
} from "../../../common/preDraftRanks.ts";
import { draft, league } from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import draftView from "../../views/draft.ts";
import draftScoutingView from "../../views/draftScouting.ts";
import draftBoardView from "../../views/draftBoard.ts";
import { afterNewPhase, getPreDraftRanks } from "./preDraftRanks.ts";
import { getMockDraft } from "./mockDraftData.ts";

const NUM_PICKS_TO_MAKE = 35;

const loadView = (view: { load: (args: any) => any }, inputs = {}) =>
	view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: undefined,
		prevOutput: {},
		conditions: {},
	});

let lidCounter = 0;
const newLeagueAtDraft = async (frozen: boolean, seed: number) => {
	Math.random = makeSeededRandom(seed);
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
			lid: lidCounter++,
			name: "frozen ranks",
			setLeagueCreationStatus: () => {},
			settings: getDefaultSettings(),
			shuffleRosters: false,
			startingSeasonFromInput: "2025",
			teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
			tid: 0,
		},
	);
	await league.loadGameAttributes();
	g.setWithoutSavingToDB("featureFrozenDraftRanks", frozen);
	g.setWithoutSavingToDB("phase", PHASE.DRAFT);
	await draft.genOrder(false);
	// The newPhase hook at PHASE.DRAFT
	await afterNewPhase(PHASE.DRAFT);
};

const undraftedRows = async () => {
	const data: any = await loadView(draftView);
	return data as {
		frozenRanks: boolean;
		undrafted: { pid: number; rank: number; preDraftRank?: number }[];
		drafted: {
			pid: number;
			preDraftRank?: number;
			overallPick?: number;
		}[];
	};
};

const makePicks = async (n: number) => {
	const order = await draft.getOrder();
	await draft.runPicks({ type: "untilPick", dpid: order[n]!.dpid });
	const drafted = (
		await idb.cache.players.indexGetAll("playersByTid", [0, Infinity])
	).filter((p) => p.draft.year === g.get("season"));
	assert.strictEqual(drafted.length, n);
};

describe("pure helpers", () => {
	test("ranks over the whole class, ties by pid", () => {
		const ranks = rankClass([
			{ pid: 3, value: 50, valueFuzz: 60 },
			{ pid: 1, value: 70, valueFuzz: 55 },
			{ pid: 2, value: 50, valueFuzz: 60 },
		]);
		assert.deepEqual(ranks.get(1), { r: 3, v: 1, n: 3 });
		assert.deepEqual(ranks.get(2), { r: 1, v: 2, n: 3 });
		assert.deepEqual(ranks.get(3), { r: 2, v: 3, n: 3 });
		assert.deepEqual(
			[
				...rankByScoutGrade([
					{ pid: 1, o: 40 },
					{ pid: 2, o: 80 },
				]),
			],
			[
				[2, 1],
				[1, 2],
			],
		);
	});

	test("steals and reaches", () => {
		assert.deepEqual(stealOrReach(12, 34), { diff: -22, kind: "reach" });
		assert.deepEqual(stealOrReach(34, 12), { diff: 22, kind: "steal" });
		assert.strictEqual(stealOrReach(10, 12).kind, undefined);
		assert.strictEqual(
			draftedVsPreDraftText(12, 34),
			"Drafted #12 · Pre-draft #34",
		);
	});
});

describe.skipIf(__SPORT !== "basketball")("during the draft", () => {
	test(
		"ranks don't change across picks, and a second-round prospect never shows #1",
		{ timeout: 240_000 },
		async () => {
			await newLeagueAtDraft(true, 7);
			const numTeams = g.get("numActiveTeams");
			const before = await undraftedRows();
			assert.isTrue(before.frozenRanks);
			const preBefore = new Map(
				before.undrafted.map((p) => [p.pid, p.preDraftRank]),
			);
			// Before any pick, the pre-draft rank and the best available order are the same
			for (const p of before.undrafted) {
				assert.strictEqual(p.preDraftRank, p.rank);
			}
			const scoutingBefore: any = await loadView(draftScoutingView);
			const boardBefore: any = await loadView(draftBoardView);

			await makePicks(NUM_PICKS_TO_MAKE);

			const after = await undraftedRows();
			assert.strictEqual(
				after.undrafted.length,
				before.undrafted.length - NUM_PICKS_TO_MAKE,
			);
			for (const p of after.undrafted) {
				assert.strictEqual(p.preDraftRank, preBefore.get(p.pid));
			}
			// Best available still starts at 1, but it is a separate column
			assert.strictEqual(after.undrafted[0]!.rank, 1);
			// Nobody left shows #1 unless he was #1 before the draft, and no second-round prospect ever does
			for (const p of after.undrafted) {
				if (p.preDraftRank === 1) {
					assert.strictEqual(preBefore.get(p.pid), 1);
				}
				if (preBefore.get(p.pid)! > numTeams) {
					assert.isAbove(p.preDraftRank!, numTeams);
				}
			}
			const minLeft = Math.min(...after.undrafted.map((p) => p.preDraftRank!));
			assert.isAbove(minLeft, 1);

			// Drafted players: the pick they went at next to their pre-draft rank
			const drafted = after.drafted.filter((p) => p.pid >= 0);
			assert.strictEqual(drafted.length, NUM_PICKS_TO_MAKE);
			drafted.forEach((p, i) => {
				assert.strictEqual(p.overallPick, i + 1);
				assert.strictEqual(p.preDraftRank, preBefore.get(p.pid));
			});

			// Draft Scouting and the Draft Board: the same frozen ranks
			const scoutingAfter: any = await loadView(draftScoutingView);
			const classBefore = scoutingBefore.seasons[0];
			const classAfter = scoutingAfter.seasons[0];
			assert.strictEqual(classAfter.season, g.get("season"));
			assert.isTrue(classAfter.frozenRanks);
			const scoutRankBefore = new Map(
				classBefore.players.map((p: any) => [p.pid, p.rank]),
			);
			for (const p of classAfter.players) {
				assert.strictEqual(p.rank, scoutRankBefore.get(p.pid));
			}
			const boardAfter: any = await loadView(draftBoardView);
			const boardRankBefore = new Map(
				boardBefore.prospects.map((p: any) => [p.pid, p.valueRank]),
			);
			for (const p of boardAfter.prospects) {
				assert.strictEqual(p.valueRank, boardRankBefore.get(p.pid));
			}

			// Mock draft of the remaining picks: board ranks frozen, picks numbered from the next real pick
			const mock: any = await getMockDraft();
			assert.isTrue(mock.frozenRanks);
			assert.strictEqual(mock.picks[0].overall, NUM_PICKS_TO_MAKE + 1);
			for (const pick of mock.picks) {
				assert.strictEqual(pick.scoutRank, preBefore.get(pick.pid));
			}

			// Old league that reached the draft without a snapshot: the same ranks, counted over the whole class
			const cls = (
				await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
					[g.get("season")],
					[g.get("season"), Infinity],
				])
			).filter((p) => p.draft.year === g.get("season"));
			for (const p of cls) {
				delete p.preDraftRank;
			}
			const fallback = (await getPreDraftRanks(g.get("season")))!;
			assert.isDefined(fallback);
			for (const [pid, rank] of preBefore) {
				assert.strictEqual(fallback.get(pid)!.r, rank);
				assert.strictEqual(fallback.get(pid)!.src, "class");
			}
			// ... and stored when the draft ends
			await afterNewPhase(PHASE.AFTER_DRAFT);
			for (const p of cls) {
				assert.strictEqual(p.preDraftRank?.r, preBefore.get(p.pid));
			}

			// An older class with no snapshot: the scouts' last stored grades
			for (const p of cls) {
				delete p.preDraftRank;
				p.scoutDraft = { s: g.get("season"), t: 0, by: [], v: [], o: p.pid };
			}
			g.setWithoutSavingToDB("season", g.get("season") + 1);
			g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
			const scout = (await getPreDraftRanks(g.get("season") - 1))!;
			const byPid = [...cls].sort((a, b) => b.pid - a.pid);
			assert.strictEqual(scout.get(byPid[0]!.pid)!.r, 1);
			assert.strictEqual(scout.get(byPid[0]!.pid)!.src, "scout");
			g.setWithoutSavingToDB("season", g.get("season") - 1);
			g.setWithoutSavingToDB("phase", PHASE.DRAFT);
		},
	);

	test(
		"off: as before, ranks counted among the players left; the AI picks the same players either way",
		{ timeout: 240_000 },
		async () => {
			await newLeagueAtDraft(false, 7);
			// The league at the start of the draft, to run the same draft again with the setting on
			const playersAtStart = helpers.deepCopy(await idb.cache.players.getAll());
			const picksAtStart = helpers.deepCopy(
				await idb.cache.draftPicks.getAll(),
			);
			const before = await undraftedRows();
			assert.isFalse(before.frozenRanks);
			assert.isTrue(
				before.undrafted.every((p) => p.preDraftRank === undefined),
			);
			const rankBefore = new Map(before.undrafted.map((p) => [p.pid, p.rank]));
			const cls = await idb.cache.players.indexGetAll(
				"playersByTid",
				PLAYER.UNDRAFTED,
			);
			assert.isTrue(cls.every((p) => p.preDraftRank === undefined));

			const draftedPids = async () =>
				(await idb.cache.players.indexGetAll("playersByTid", [0, Infinity]))
					.filter((p) => p.draft.year === g.get("season"))
					.sort(
						(a, b) =>
							a.draft.round - b.draft.round || a.draft.pick - b.draft.pick,
					)
					.map((p) => p.pid);

			Math.random = makeSeededRandom(11);
			await makePicks(NUM_PICKS_TO_MAKE);
			const after = await undraftedRows();
			// The bug this setting fixes: the best player left is "#1", whatever his rank was before the draft
			const top = after.undrafted.find((p) => p.rank === 1)!;
			assert.isAbove(rankBefore.get(top.pid)!, 1);
			const offPicks = await draftedPids();

			// The same draft with the setting on and the same random numbers: the AI drafts by value, not by these ranks
			for (const p of playersAtStart) {
				await idb.cache.players.put(p);
			}
			for (const dp of await idb.cache.draftPicks.getAll()) {
				await idb.cache.draftPicks.delete(dp.dpid);
			}
			for (const dp of picksAtStart) {
				await idb.cache.draftPicks.put(dp);
			}
			g.setWithoutSavingToDB("featureFrozenDraftRanks", true);
			await afterNewPhase(PHASE.DRAFT);
			assert.isTrue((await undraftedRows()).frozenRanks);
			Math.random = makeSeededRandom(11);
			await makePicks(NUM_PICKS_TO_MAKE);
			assert.deepEqual(await draftedPids(), offPicks);
		},
	);
});
