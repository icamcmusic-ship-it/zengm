import { assert, beforeAll, describe, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { getPreDraftStats } from "../../../common/preDraft.ts";
import { Rng } from "../../../common/collegeStats/rng.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { player } from "../index.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import { generateCollegeStats } from "./generateCollegeStats.ts";
import { getTeammates } from "./classTeams.ts";
import { getDraftProductionNudges, getPlayerProduction } from "./production.ts";
import { PRODUCTION_NUDGE_MAX } from "../../../common/collegeStats/production.ts";
import type { Player } from "../../../common/types.ts";

const YEARS = [2027, 2028];
const SCHOOLS = ["Duke", "Kentucky", "Kansas"];

describe("class-aware teams in the game", () => {
	let players: Player[];
	beforeAll(async () => {
		resetG();
		g.setWithoutSavingToDB("season", 2026);
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		g.setWithoutSavingToDB("featureCollegeSeason", true);
		let all: any[] = [];
		for (const draftYear of YEARS) {
			const rng = new Rng(`classTeamsTest${draftYear}`);
			const orig = Math.random;
			Math.random = () => rng.random();
			try {
				const generated = await genPlayersWithoutSaving(
					draftYear,
					DEFAULT_LEVEL,
					[],
				);
				all = all.concat(
					generated.map((p, i) => ({
						...p,
						pid: all.length + i,
						college: SCHOOLS[i % SCHOOLS.length],
						born: { ...p.born, loc: "Chicago, IL" },
					})),
				);
			} finally {
				Math.random = orig;
			}
		}
		await resetCache({ players: all });
		for (const p of all) {
			await player.updateValues(p);
		}
		for (const draftYear of YEARS) {
			await generateCollegeStats({ draftYear, seed: `t${draftYear}` });
		}
		players = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
	}, 120000);

	test("teammates from two classes play the same team games, and find each other", async () => {
		// Team season -> the team games each prospect's stats row covers (gp + games missed is at most the team's games)
		const bySeason = new Map<string, { pid: number; draftYear: number }[]>();
		for (const p of players) {
			for (const year of p.preDraftCareer?.years ?? []) {
				if (year.status === "redshirt" || !SCHOOLS.includes(year.school)) {
					continue;
				}
				const key = `${year.school}|${year.season}`;
				const list = bySeason.get(key) ?? [];
				list.push({ pid: p.pid, draftYear: p.draft.year });
				bySeason.set(key, list);
			}
		}
		const mixed = [...bySeason.entries()].filter(
			([, list]) => new Set(list.map((x) => x.draftYear)).size > 1,
		);
		assert.isAbove(mixed.length, 0);
		for (const [key, list] of mixed) {
			const season = Number(key.split("|")[1]);
			const paces = new Set<number>();
			for (const { pid } of list) {
				const p = players.find((x) => x.pid === pid)!;
				const year = p.preDraftCareer!.years.find((y) => y.season === season)!;
				if (year.pace !== undefined) {
					paces.add(year.pace);
				}
				const row = getPreDraftStats(p).find((r) => r.season === season) as any;
				if (row) {
					// minAvailable is (team games - games missed) * 40
					assert.isAtMost(row.gp, row.minAvailable / 40);
				}
			}
			assert.isAtMost(paces.size, 1, key);
		}
		const [key, list] = mixed[0]!;
		const season = Number(key.split("|")[1]);
		const p = players.find((x) => x.pid === list[0]!.pid)!;
		const teammates = (await getTeammates(p)).get(season) ?? [];
		for (const other of list.slice(1)) {
			assert.isTrue(teammates.some((t) => t.pid === other.pid));
		}
	});

	test("age-adjusted production and its draft nudge", () => {
		const withProd = players.filter((p) => getPlayerProduction(p));
		assert.isAbove(withProd.length, players.length * 0.8);
		const nudges = getDraftProductionNudges(players);
		assert.isAbove(nudges.size, 0);
		let sum = 0;
		for (const v of nudges.values()) {
			assert.isAtMost(Math.abs(v), PRODUCTION_NUDGE_MAX);
			sum += v;
		}
		// Measured against the class: about zero on average
		assert.isBelow(Math.abs(sum / nudges.size), 0.3);
	});
});
