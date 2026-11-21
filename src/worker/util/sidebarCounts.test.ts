import { assert, beforeEach, describe, test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../db/index.ts";
import { team } from "../core/index.ts";
import g from "./g.ts";
import helpers from "./helpers.ts";
import {
	countNewIssues,
	getSidebarCounts,
	issueNumber,
} from "./sidebarCounts.ts";

describe("side menu badge counts", () => {
	beforeEach(async () => {
		resetG();
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		g.setWithoutSavingToDB("featureAiTradeOffers" as any, true);
		g.setWithoutSavingToDB("featureNewspaper" as any, true);
		idb.league = mockIDBLeague();
		const teamsDefault = helpers.getTeamsDefault();
		await resetCache({
			teams: teamsDefault.map(team.generate),
			teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
		});
	});

	const addEvent = (score: number, tids: number[]) =>
		idb.cache.events.add({
			type: "info",
			text: "x",
			season: g.get("season"),
			score,
			tids,
		});

	test("news: big events since the last visit, nothing before a baseline", async () => {
		await addEvent(20, [1]);
		const first = await getSidebarCounts({});
		assert.strictEqual(first.news.count, 0);

		const seen = first.news.latest;
		await addEvent(20, [1]);
		await addEvent(5, [1]);
		// The user's team's bonus makes it big
		await addEvent(10, [g.get("userTid")]);
		const counts = await getSidebarCounts({ news: seen });
		assert.strictEqual(counts.news.count, 2);
		assert.isAbove(counts.news.latest, seen);
		assert.strictEqual(
			(await getSidebarCounts({ news: counts.news.latest })).news.count,
			0,
		);
	});

	test("trade offers: offers to the user not seen yet", async () => {
		const offer = (id: number, tid: number) => ({
			id,
			tid,
			season: g.get("season"),
			phase: PHASE.REGULAR_SEASON,
			gp: 3,
			teams: [
				{ tid: g.get("userTid"), pids: [], dpids: [] },
				{ tid, pids: [], dpids: [] },
			],
			reason: "",
		});
		g.setWithoutSavingToDB("aiTradeOffers", [offer(0, 1)] as any);
		const first = await getSidebarCounts({});
		assert.strictEqual(first.tradeOffers!.count, 0);
		g.setWithoutSavingToDB("aiTradeOffers", [offer(1, 2), offer(0, 1)] as any);
		const counts = await getSidebarCounts({
			tradeOffers: first.tradeOffers!.keys,
		});
		assert.strictEqual(counts.tradeOffers!.count, 1);
	});

	test("newspaper issues", () => {
		const a = issueNumber(2025, "midseason", 6);
		const b = issueNumber(2025, "midseason", 19);
		assert.strictEqual(countNewIssues(a, b), 2);
		assert.strictEqual(countNewIssues(b, b), 0);
		assert.strictEqual(countNewIssues(b, issueNumber(2025, "playoffs", 82)), 1);
		assert.isAbove(
			issueNumber(2026, "preseason", 0),
			issueNumber(2025, "final", 82),
		);
	});
});
