import { assert, beforeEach, describe, test } from "vitest";
import { makeSeededRandom } from "../../../common/random.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { player } from "../index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { getPreDraftStats } from "../../../common/preDraft.ts";
import {
	generateCollegeStats,
	removeCollegeStats,
} from "./generateCollegeStats.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import { getHsClassRanks, getRecruitBasis } from "./recruiting.ts";
import { getScoutedRatings } from "../../views/playerPreDraft.ts";
import { getScoutingReport } from "../../../common/collegeStats/scoutingReport.ts";
import { COLLEGES } from "../../../common/collegeStats/colleges.ts";
import type { Player } from "../../../common/types.ts";

const SEASON = 2026;
const NAMES = Object.keys(COLLEGES);

const makeClass = async (draftYear: number, pidStart: number) => {
	const players = await genPlayersWithoutSaving(draftYear, DEFAULT_LEVEL, []);
	return players.map((p, i) => {
		p.born.loc = i % 7 === 0 ? "Belgrade, Serbia" : "Chicago, IL, USA";
		p.college = i % 7 === 0 ? "" : NAMES[(i * 37 + draftYear) % NAMES.length]!;
		return { ...p, pid: pidStart + i };
	}) as Player[];
};

let prospects: Player[];
beforeEach(async () => {
	resetG();
	g.setWithoutSavingToDB("season", SEASON);
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	g.setWithoutSavingToDB("generateCollegeStats", false);
	// Seeded classes: the counts below (redshirts, stories) are thresholds on a few random prospects
	const originalRandom = Math.random;
	Math.random = makeSeededRandom(SEASON);
	try {
		prospects = [
			...(await makeClass(SEASON, 0)),
			...(await makeClass(SEASON + 1, 1000)),
			...(await makeClass(SEASON + 2, 2000)),
		];
	} finally {
		Math.random = originalRandom;
	}
	await resetCache({ players: prospects });
	for (const p of prospects) {
		await player.updateValues(p);
	}
});

const getProspects = () =>
	idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED);

const generateAll = async () => {
	for (const draftYear of [SEASON, SEASON + 1, SEASON + 2]) {
		await generateCollegeStats({ draftYear, seed: `seed-${draftYear}` });
	}
};

describe("careers and recruiting ranks on generated prospects", () => {
	test("the stored career matches the stats rows, pro ratings and value are untouched", async () => {
		const before = structuredClone(
			(await getProspects()).map((p) => ({
				pid: p.pid,
				ratings: p.ratings,
				value: p.value,
				valueFuzz: p.valueFuzz,
				born: p.born,
				hgt: p.hgt,
				weight: p.weight,
				draft: p.draft,
				traits: p.traits,
			})),
		);
		await generateAll();
		const after = await getProspects();
		assert.deepStrictEqual(
			after.map((p) => ({
				pid: p.pid,
				ratings: p.ratings,
				value: p.value,
				valueFuzz: p.valueFuzz,
				born: p.born,
				hgt: p.hgt,
				weight: p.weight,
				draft: p.draft,
				traits: p.traits,
			})),
			before,
		);

		let numMulti = 0;
		let numRedshirt = 0;
		let numStory = 0;
		for (const p of after) {
			const rows = getPreDraftStats(p);
			const career = p.preDraftCareer;
			if (rows.length === 0) {
				assert.isUndefined(career);
				continue;
			}
			assert(career);
			const played = career.years.filter((y) => y.status !== "redshirt");
			assert.deepStrictEqual(
				rows.map((row) => [row.season, row.teamName]),
				played.map((y) => [y.season, y.school]),
			);
			assert.strictEqual(career.years.at(-1)!.season, p.draft.year);
			assert.strictEqual(career.years.at(-1)!.school, p.college);
			if (p.collegeSeason) {
				assert.strictEqual(p.collegeSeason.school, p.college);
			}
			for (const row of rows) {
				assert.isAtMost(row.gs!, row.gp!);
				assert.isAbove(row.gp!, 0);
			}
			numMulti += new Set(rows.map((row) => row.teamName)).size > 1 ? 1 : 0;
			numRedshirt += career.years.some((y) => y.status === "redshirt") ? 1 : 0;
			numStory += career.story ? 1 : 0;

			// Career totals are the sum of his rows, whatever schools they were at
			const pf: any = await player.format(p, {
				stats: ["season", "gp", "pts", "min"],
				statType: "totals",
				preDraftStats: "only",
				mergeStats: "none",
			} as any);
			assert.strictEqual(pf.stats.length, rows.length);
			assert.strictEqual(
				pf.careerStats.gp,
				rows.reduce((sum, row) => sum + row.gp!, 0),
			);
			assert.strictEqual(
				pf.careerStats.pts,
				rows.reduce((sum, row) => sum + row.pts!, 0),
			);
		}
		assert.isAbove(numMulti, 5);
		assert.isAbove(numRedshirt, 0);
		assert.isAbove(numStory, 3);
		assert.isBelow(numStory, 0.2 * after.length);
	});

	test("recruiting ranks are unique within a high school class, across draft classes", async () => {
		await generateAll();
		const players = await getProspects();
		const byClass = new Map<number, Player[]>();
		for (const p of players) {
			const career = p.preDraftCareer;
			if (career?.hsClass === undefined) {
				assert.isUndefined(career?.recruit);
				continue;
			}
			assert(career.recruit, "ranking is stored when stats are generated");
			byClass.set(career.hsClass, [...(byClass.get(career.hsClass) ?? []), p]);
		}
		// High school classes are shared by draft classes
		let shared = 0;
		let numPairs = 0;
		let numOutOfOrder = 0;
		for (const [classOf, members] of byClass) {
			shared += new Set(members.map((p) => p.draft.year)).size > 1 ? 1 : 0;
			const ranks = members
				.map((p) => p.preDraftCareer!.recruit!.rank)
				.filter((x) => x !== null);
			assert.strictEqual(new Set(ranks).size, ranks.length, `${classOf}`);
			const byPos = Map.groupBy(
				members.filter((p) => p.preDraftCareer!.recruit!.rank !== null),
				(p) => getRecruitBasis(p)!.pos,
			);
			for (const list of byPos.values()) {
				const posRanks = list.map((p) => p.preDraftCareer!.recruit!.posRank);
				assert.strictEqual(new Set(posRanks).size, posRanks.length);
				list.sort(
					(a, b) =>
						a.preDraftCareer!.recruit!.rank! - b.preDraftCareer!.recruit!.rank!,
				);
				// In national order, except where a player ranked later (another draft class) had no room left between two ranks that were already set
				for (let i = 1; i < list.length; i++) {
					numPairs += 1;
					numOutOfOrder +=
						list[i]!.preDraftCareer!.recruit!.posRank! <
						list[i - 1]!.preDraftCareer!.recruit!.posRank!
							? 1
							: 0;
				}
			}
			// What the page shows is what is stored
			const shown = await getHsClassRanks(classOf);
			for (const p of members) {
				assert.deepStrictEqual(shown.get(p.pid), {
					nationalRank: p.preDraftCareer!.recruit!.rank ?? undefined,
					posRank: p.preDraftCareer!.recruit!.posRank ?? undefined,
				});
			}
		}
		assert.isAbove(shared, 1);
		assert.isAbove(numPairs, 50);
		assert.isBelow(numOutOfOrder / numPairs, 0.08);

		// A five-star bust was a five-star, an unranked riser was not ranked
		for (const p of players) {
			const career = p.preDraftCareer;
			if (career?.story === "bust") {
				assert.isAtMost(career.recruit!.rank!, 25);
			} else if (career?.story === "unranked") {
				assert.isNull(career.recruit!.rank);
			}
		}
	});

	test("stable: ranks do not move when another class is generated, or when ratings change", async () => {
		await generateCollegeStats({ draftYear: SEASON, seed: "a" });
		const first = new Map(
			(await getProspects())
				.filter((p) => p.preDraftCareer)
				.map((p) => [p.pid, structuredClone(p.preDraftCareer!.recruit)]),
		);
		assert.isAbove(first.size, 30);
		await generateCollegeStats({ draftYear: SEASON + 1, seed: "b" });
		await generateCollegeStats({ draftYear: SEASON + 2, seed: "c" });
		for (const p of await getProspects()) {
			if (first.has(p.pid)) {
				// Ratings develop before the draft; the ranking was when he was in high school
				const r = p.ratings.at(-1)!;
				r.ovr += 9;
				r.pot += 9;
				assert.deepStrictEqual(p.preDraftCareer!.recruit, first.get(p.pid));
				const basis = getRecruitBasis(p);
				if (basis) {
					const shown = (await getHsClassRanks(basis.classOf)).get(p.pid)!;
					assert.strictEqual(
						shown.nationalRank ?? null,
						first.get(p.pid)!.rank,
					);
				}
			}
		}
	}, 30_000);

	test("prospects from before the career model: nothing stored, plain ranks made unique", async () => {
		await generateCollegeStats({ draftYear: SEASON, seed: "a" });
		// As if generated by the previous version
		const old = (await getProspects()).filter(
			(p) => p.draft.year === SEASON && p.stats.length > 0,
		);
		const rowsBefore = structuredClone(old.map((p) => p.stats));
		for (const p of old) {
			delete p.preDraftCareer;
			await idb.cache.players.put(p);
		}
		const classes = new Set<number>();
		for (const p of old) {
			const basis = getRecruitBasis(p);
			if (basis) {
				assert.strictEqual(basis.priority, 1);
				classes.add(basis.classOf);
			}
		}
		assert.isAbove(classes.size, 1);
		const before = new Map<number, unknown>();
		for (const classOf of classes) {
			const ranks = await getHsClassRanks(classOf);
			const national = [...ranks.values()].map((x) => x.nationalRank);
			assert.strictEqual(new Set(national).size, national.length);
			for (const [pid, value] of ranks) {
				before.set(pid, value);
			}
		}
		// Newer classes are generated with the career model: the old class's rows and ranks stay
		await generateCollegeStats({ draftYear: SEASON + 1, seed: "b" });
		assert.deepStrictEqual(
			old.map((p) => p.stats),
			rowsBefore,
		);
		for (const classOf of classes) {
			const ranks = await getHsClassRanks(classOf);
			const national = [...ranks.values()]
				.map((x) => x.nationalRank)
				.filter((x) => x !== undefined);
			assert.strictEqual(new Set(national).size, national.length);
			for (const p of old) {
				if (getRecruitBasis(p)?.classOf === classOf) {
					assert.deepStrictEqual(ranks.get(p.pid), before.get(p.pid));
				}
			}
		}
	});

	test("removeCollegeStats takes the career off too", async () => {
		await generateCollegeStats({ draftYear: SEASON, seed: "a" });
		await removeCollegeStats(SEASON);
		for (const p of await getProspects()) {
			if (p.draft.year === SEASON) {
				assert.isUndefined(p.preDraftCareer);
			}
		}
	});
});

describe("scouting report input", () => {
	test("ratings as the scouts see them: fuzz applied, true ratings never passed on", () => {
		const p = prospects[5]!;
		const r = p.ratings.at(-1)!;
		r.fuzz = 6;
		const seen = getScoutedRatings(p, r as any)!;
		for (const key of ["stre", "tp", "oiq", "diq", "ovr", "pot"] as const) {
			assert.strictEqual(seen[key], player.fuzzRating((r as any)[key], 6));
		}
		// Height is a measurement
		assert.strictEqual(seen.hgt, r.hgt);

		// Two prospects with different true ratings that the scouts see the same get the same report
		const base = {
			pid: 1,
			pos: r.pos,
			age: 20,
			heightInches: 78,
			pick: 10,
			numPicks: 60,
			drafted: false,
		};
		const a = structuredClone(r) as any;
		const b = structuredClone(r) as any;
		for (const key of [
			"stre",
			"spd",
			"jmp",
			"endu",
			"ins",
			"dnk",
			"ft",
			"fg",
			"tp",
			"oiq",
			"diq",
			"drb",
			"pss",
			"reb",
			"ovr",
			"pot",
		]) {
			a[key] = 40;
			a.fuzz = 5;
			b[key] = 50;
			b.fuzz = -5;
		}
		const seenA = getScoutedRatings(p, a)!;
		const seenB = getScoutedRatings(p, b)!;
		assert.deepStrictEqual(seenA, seenB);
		assert.strictEqual(seenA.tp, 45);
		assert.deepStrictEqual(
			getScoutingReport({ ...base, ratings: seenA }),
			getScoutingReport({ ...base, ratings: seenB }),
		);

		// Ratings hidden (the no visible ratings challenge): nothing from ratings at all
		g.setWithoutSavingToDB("challengeNoRatings", true);
		assert.isUndefined(getScoutedRatings(p, r as any));
		g.setWithoutSavingToDB("challengeNoRatings", false);
	});
});
