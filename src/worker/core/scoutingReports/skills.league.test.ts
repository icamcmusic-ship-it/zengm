// Strengths & weaknesses in a league with a generated draft class and its pre-draft stats: every prospect's full report has 3-4
// strengths, 2-3 weaknesses and a swing skill, stable across loads, and under the no visible ratings challenge nothing reads ratings.
// Sample reports from a played league: src/test/scoutingSkills/samples.script.test.ts.
import { assert, beforeAll, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import type { Player } from "../../../common/types.ts";
import type { SkillReport } from "../../../common/scoutingReports/index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import { generateCollegeStats } from "../draft/generateCollegeStats.ts";
import genPlayersWithoutSaving from "../draft/genPlayersWithoutSaving.ts";
import { buildInput, clearScoutingCache, getReportCtx } from "./input.ts";
import { getPlayerScoutingPage, getScoutingHover } from "./index.ts";

const SEASON = 2026;

const setup = async () => {
	resetG();
	g.setWithoutSavingToDB("season", SEASON);
	g.setWithoutSavingToDB("startingSeason", SEASON - 3);
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	g.setWithoutSavingToDB("featureScoutingReports" as any, true);
	g.setWithoutSavingToDB("playerTraits", true);
	g.setWithoutSavingToDB("playerTraitsSeed", 777);
	g.setWithoutSavingToDB("generateCollegeStats", false);
	idb.league = mockIDBLeague();
	const teams = helpers.getTeamsDefault().map(team.generate);
	const players = await genPlayersWithoutSaving(SEASON, DEFAULT_LEVEL, []);
	const prospects = players.map((p, i) => {
		p.college =
			i % 5 === 0 ? "" : ["Duke", "Kansas", "Gonzaga", "Iowa"][i % 4]!;
		return { ...p, pid: 1000 + i };
	}) as Player[];
	await resetCache({ teams, players: prospects });
	for (const t of teams) {
		for (let i = 0; i < 10; i++) {
			const p = player.generate(t.tid, 21 + i, SEASON - 2 - i, true, 50);
			p.injury = { type: "Healthy", gamesRemaining: 0 };
			await player.updateValues(p);
			await idb.cache.players.add(p);
		}
	}
	for (const p of prospects) {
		await player.updateValues(p);
	}
	await generateCollegeStats({ draftYear: SEASON, seed: "skills" });
	clearScoutingCache();
};

const classByValue = async () =>
	(await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED))
		.filter((p) => p.draft.year === SEASON)
		.sort((a, b) => b.valueFuzz - a.valueFuzz);

describe("strengths & weaknesses in a league", () => {
	beforeAll(setup, 120000);

	test("every prospect: 3-4 strengths, 2-3 weaknesses, a swing skill, no item twice", async () => {
		const prospects = await classByValue();
		assert.isAbove(prospects.length, 40);
		let withStats = 0;
		for (const p of prospects) {
			const page = (await getPlayerScoutingPage(p.pid))!;
			const k = page.report.skills!;
			assert.isDefined(k, `${p.pid}`);
			assert.isAtLeast(k.strengths.length, 3);
			assert.isAtMost(k.strengths.length, 4);
			assert.isAtLeast(k.weaknesses.length, 2);
			assert.isAtMost(k.weaknesses.length, 3);
			const keys = [...k.strengths, ...k.weaknesses].map((x) => x.key);
			assert.strictEqual(new Set(keys).size, keys.length);
			assert.isAbove(k.swing.text.length, 10);
			for (const x of k.weaknesses) {
				assert.isDefined(x.fix);
			}
			if (page.report.skills!.strengths.some((x) => x.family !== "skill")) {
				withStats += 1;
			}
		}
		// Most prospects get specific (not just grade-based) items
		assert.isAbove(withStats, prospects.length * 0.6);
	}, 120000);

	test("stable across loads, and the hover card carries the swing skill", async () => {
		const [top] = await classByValue();
		const a = (await getPlayerScoutingPage(top!.pid))!.report.skills;
		clearScoutingCache();
		const b = (await getPlayerScoutingPage(top!.pid))!.report.skills;
		assert.deepStrictEqual(a, b);
		const hover = await getScoutingHover(top!.pid);
		assert.strictEqual(hover?.swing, a!.swing.skill);
	});

	test("light inputs (snapshots, lists) skip the signals", async () => {
		const [top] = await classByValue();
		const ctx = await getReportCtx();
		const input = await buildInput(top!, ctx, { light: true });
		assert.isUndefined(input.skills);
	});

	test("the top, middle and bottom of the class read differently", async () => {
		const list = await classByValue();
		const picks = [list[0]!, list[Math.floor(list.length / 2)]!, list.at(-1)!];
		const reports = [];
		for (const p of picks) {
			reports.push((await getPlayerScoutingPage(p.pid))!.report.skills!);
		}
		const tierScore = (k: SkillReport) =>
			k.strengths.filter((x) => x.tier === "elite" || x.tier === "plus")
				.length -
			k.weaknesses.filter((x) => x.tier === "major" || x.tier === "minus")
				.length;
		assert.isAtLeast(tierScore(reports[0]!), tierScore(reports[2]!));
	});

	test("no visible ratings: no film evidence, no contradictions, hedged", async () => {
		g.setWithoutSavingToDB("challengeNoRatings", true);
		clearScoutingCache();
		try {
			for (const p of (await classByValue()).slice(0, 20)) {
				const page = (await getPlayerScoutingPage(p.pid))!;
				const k = page.report.skills!;
				assert.strictEqual(k.certainty, "hedged");
				assert.deepStrictEqual(k.contradictions, []);
				for (const x of [...k.strengths, ...k.weaknesses]) {
					for (const e of x.evidence) {
						assert.notStrictEqual(e.src, "film", `${x.key}: ${e.text}`);
					}
				}
				assert.isUndefined(page.report.skills!.anchor?.match(/Real-world/));
			}
		} finally {
			g.setWithoutSavingToDB("challengeNoRatings", false);
			clearScoutingCache();
		}
	});
});
