// Scouting Reports in a mock league: what the reports read (never true prospect ratings or unknown hidden traits), the pages, the
// snapshots and the draft take
import { assert, beforeAll, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import { buildInput, clearScoutingCache, getReportCtx } from "./input.ts";
import {
	getDepartmentPage,
	getDraftPreviewFacts,
	getPlayerScoutingPage,
	getScoutingBlurbs,
	getScoutingSplit,
	gmLensAdjustments,
	recordSnapshots,
} from "./index.ts";
import fuzzRating from "../player/fuzzRating.ts";

const setup = async () => {
	resetG();
	g.setWithoutSavingToDB("featureScoutingReports" as any, true);
	g.setWithoutSavingToDB("playerTraits", true);
	g.setWithoutSavingToDB("playerTraitsSeed", 12345);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ teams });
	const season = g.get("season");
	for (const t of teams) {
		for (let i = 0; i < 10; i++) {
			const p = player.generate(t.tid, 21 + i, season - 2 - i, true, 50);
			p.injury = { type: "Healthy", gamesRemaining: 0 };
			await player.updateValues(p);
			await idb.cache.players.add(p);
		}
	}
	for (let i = 0; i < 70; i++) {
		const p = player.generate(
			PLAYER.UNDRAFTED,
			19 + (i % 4),
			season,
			false,
			50,
		);
		p.ratings[0]!.fuzz = i % 2 === 0 ? 7 : -7;
		await player.updateValues(p);
		await idb.cache.players.add(p);
	}
	clearScoutingCache();
};

describe("scouting reports in a league", () => {
	beforeAll(setup, 60000);

	test("prospects are read through the user's fuzz; unknown hidden traits carry no number", async () => {
		const ctx = await getReportCtx();
		const prospects = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		let differs = 0;
		for (const p of prospects.slice(0, 20)) {
			const r = p.ratings.at(-1)! as any;
			const input = await buildInput(p, ctx);
			for (const key of ["tp", "spd", "oiq", "diq", "ins", "pss"] as const) {
				assert.strictEqual(
					input.ratings![key],
					fuzzRating(r[key], r.fuzz),
					key,
				);
				if (input.ratings![key] !== r[key]) {
					differs += 1;
				}
			}
			assert.strictEqual(input.ratings!.ovr, fuzzRating(r.ovr, r.fuzz));
			assert.strictEqual(input.ratings!.pot, fuzzRating(r.pot, r.fuzz));
			for (const t of input.traits ?? []) {
				if (t.hidden && !t.exact) {
					assert.strictEqual(t.estimate, 50);
					assert.strictEqual(t.low, 0);
					assert.strictEqual(t.high, 100);
				}
			}
		}
		assert.isAbove(differs, 50, "fuzzed values differ from true ones");

		// The page never sends the true ovr/pot of a prospect
		const p = prospects.find(
			(x) =>
				fuzzRating(x.ratings[0]!.ovr, 7) !== x.ratings[0]!.ovr &&
				x.ratings[0]!.fuzz === 7,
		)!;
		const page = (await getPlayerScoutingPage(p.pid))!;
		assert.strictEqual(page.kind, "prospect");
		const json = JSON.stringify(page);
		assert.notInclude(json, "workEthicSeed");
		assert.notInclude(json, "agingCurve");
		assert.isTrue(
			page.report.intangibles
				.filter((x) => !x.known)
				.every((x) => x.text.startsWith("Unknown")),
		);
	});

	test("pages for a star, a bench player and a retired player", async () => {
		const pros = (
			await idb.cache.players.indexGetAll("playersByTid", [0, Infinity])
		).sort(
			(a, b) =>
				player.ovr(b.ratings.at(-1) as any) -
				player.ovr(a.ratings.at(-1) as any),
		);
		const star = (await getPlayerScoutingPage(pros[0]!.pid))!;
		const bench = (await getPlayerScoutingPage(pros.at(-1)!.pid))!;
		assert.strictEqual(star.kind, "pro");
		assert.isDefined(star.report.pro);
		assert.isAbove(star.report.overall.grade, bench.report.overall.grade);
		assert.isDefined(star.comparison);

		const r = pros[5]!;
		r.tid = PLAYER.RETIRED;
		r.retiredYear = g.get("season");
		await idb.cache.players.put(r);
		const retired = (await getPlayerScoutingPage(r.pid))!;
		assert.strictEqual(retired.kind, "retired");
		assert.isString(retired.report.retro);
		r.tid = 0;
		await idb.cache.players.put(r);
	});

	test("deterministic", async () => {
		const pid = (await idb.cache.players.indexGetAll("playersByTid", 3))[0]!
			.pid;
		clearScoutingCache();
		const a = await getPlayerScoutingPage(pid);
		clearScoutingCache();
		const b = await getPlayerScoutingPage(pid);
		assert.deepEqual(a, b);
	});

	test("snapshots, the draft take, the department, blurbs, rumors, preview and the GM lens", { timeout: 30_000 }, async () => {
		await recordSnapshots(PHASE.PLAYOFFS);
		const prospects = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		assert.isTrue(prospects.every((p) => p.scoutSnaps?.length === 1));
		await recordSnapshots(PHASE.DRAFT);
		assert.isTrue(
			prospects.every(
				(p) => p.scoutDraft !== undefined && p.scoutDraft.by.length >= 1,
			),
		);
		const snapSize =
			JSON.stringify(prospects[0]!.scoutSnaps).length +
			JSON.stringify(prospects[0]!.scoutDraft).length;
		assert.isBelow(snapSize, 200);

		const dept = await getDepartmentPage(g.get("userTid"));
		assert.isAtLeast(dept.scouts.length, 2);
		assert.isDefined(dept.scouts[0]!.face);
		assert.isAbove(dept.pending, 0);

		const blurbs = await getScoutingBlurbs(
			prospects.slice(0, 3).map((p) => p.pid),
		);
		assert.lengthOf(Object.keys(blurbs), 3);

		await getScoutingSplit(prospects[0]!.pid);

		const preview = (await getDraftPreviewFacts())!;
		assert.isAtLeast(preview.rows.length, 3);

		const adj = gmLensAdjustments(prospects, 1);
		const mean = adj.reduce((a, b) => a + b, 0) / adj.length;
		assert.isBelow(Math.abs(mean), 0.12, "no inflation");
		assert.isTrue(adj.every((x) => Math.abs(x) <= 0.8));
	});
});
