import { afterAll, assert, beforeAll, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { player } from "../index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	COLLEGE_STATS_VERSION,
	COLLEGE_STATS_VERSION_BASE,
} from "../../../common/collegeStats/index.ts";
import { isOverseasLeague } from "../../../common/collegeStats/overseas.ts";
import {
	generateCollegeStats,
	upgradeCollegeStats,
} from "./generateCollegeStats.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import type { Player } from "../../../common/types.ts";

// What a user sees in a new league: seven draft classes made in the preseason of the first season (the current class and six
// years away), each given its stats by the automatic path (generateCollegeStats with the class's auto seed), read back off the
// stored prospects the way the player pages read them. The classes years away used to be projected forward as if prospects
// developed before the draft (they don't), which inflated their lines and made everyone a high-assist three-point shooter

const SEASON = 2026;
const NUM_CLASSES = 7;

type Line = {
	p: Player;
	year: number;
	r: Record<string, number>;
	mpg: number;
	ppg: number;
	rpg: number;
	apg: number;
	bpg: number;
	spg: number;
	tpa: number;
	tpar: number;
	s: Record<string, number>;
};

const quantile = (xs: number[], q: number) => {
	const sorted = [...xs].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};
const sd = (xs: number[]) => {
	const m = xs.reduce((a, b) => a + b, 0) / xs.length;
	return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
// Share of the class below him in a rating
const pct = (set: Line[], x: Line, key: string) =>
	set.filter((y) => y.r[key]! < x.r[key]!).length / (set.length - 1);

let lines: Line[] = [];

const readLines = async () => {
	const out: Line[] = [];
	for (const p of await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	)) {
		const row = p.stats.findLast((s) => s.season === p.draft.year) as any;
		// Division I seasons (pro clubs, the G League and prep programs are on their own scales)
		if (
			!row ||
			row.gp < 10 ||
			isOverseasLeague(row.teamName) ||
			p.preDraftCareer?.years.at(-1)?.level !== "ncaa"
		) {
			continue;
		}
		const r = p.ratings.at(-1) as any;
		const gp = row.gp;
		out.push({
			p,
			year: p.draft.year,
			r: { ...r, idef: r.idef ?? r.diq, pdef: r.pdef ?? r.diq },
			mpg: row.min / gp,
			ppg: row.pts / gp,
			rpg: (row.orb + row.drb) / gp,
			apg: row.ast / gp,
			bpg: row.blk / gp,
			spg: row.stl / gp,
			tpa: row.tpa / gp,
			tpar: row.tpa / Math.max(1, row.fga),
			s: row,
		});
	}
	return out;
};

describe("college stats on the path a new league uses", () => {
	// The classes are generated with Math.random, so seed it for the same classes every run
	const realRandom = Math.random;
	afterAll(() => {
		Math.random = realRandom;
	});

	beforeAll(async () => {
		Math.random = makeSeededRandom(2026);
		resetG();
		g.setWithoutSavingToDB("season", SEASON);
		g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
		g.setWithoutSavingToDB("expandedRatings" as any, true);
		g.setWithoutSavingToDB("generateCollegeStats", false);
		const all: Player[] = [];
		for (let i = 0; i < NUM_CLASSES; i++) {
			const players = await genPlayersWithoutSaving(
				SEASON + i,
				DEFAULT_LEVEL,
				[],
			);
			all.push(
				...(players.map((p, j) => ({
					...p,
					// The test league has no name/country data, so birthplaces are made up: mostly American, like a new league's
					born: {
						...p.born,
						loc: j % 8 === 0 ? "Belgrade, Serbia" : "Chicago, IL, USA",
					},
					pid: i * 1000 + j,
				})) as Player[]),
			);
		}
		await resetCache({ players: all });
		for (const p of all) {
			await player.updateValues(p);
		}
		for (let i = 0; i < NUM_CLASSES; i++) {
			await generateCollegeStats({
				draftYear: SEASON + i,
				seed: `${g.get("lid")}-${SEASON + i}-auto`,
				onlyMissing: true,
			});
		}
		lines = await readLines();
	}, 240_000);

	test("every class is on the same scale, the ones years away too", () => {
		const medians = [];
		for (let i = 0; i < NUM_CLASSES; i++) {
			const set = lines.filter((x) => x.year === SEASON + i);
			assert.isAbove(set.length, 30);
			const ppg = quantile(
				set.map((x) => x.ppg),
				0.5,
			);
			const apg = quantile(
				set.map((x) => x.apg),
				0.5,
			);
			const tpar = quantile(
				set.map((x) => x.tpar),
				0.5,
			);
			medians.push(ppg);
			assert.isAbove(ppg, 6, `${SEASON + i} ppg`);
			assert.isBelow(ppg, 13, `${SEASON + i} ppg`);
			assert.isBelow(apg, 3, `${SEASON + i} apg`);
			assert.isBelow(tpar, 0.46, `${SEASON + i} 3PA rate`);
		}
		assert.isBelow(Math.max(...medians) - Math.min(...medians), 3);
	});

	test("Division I levels and a wide spread", () => {
		const q = (key: keyof Line, at: number) =>
			quantile(
				lines.map((x) => x[key] as number),
				at,
			);
		assert.isAbove(q("mpg", 0.1), 9);
		assert.isAbove(q("mpg", 0.5), 17);
		assert.isBelow(q("mpg", 0.5), 27);
		assert.isBelow(q("mpg", 0.9), 33);
		assert.isBelow(q("ppg", 0.1), 7);
		assert.isAbove(q("ppg", 0.9), 13);
		assert.isBelow(q("ppg", 0.9), 21);
		assert.isBelow(q("apg", 0.5), 3);
		assert.isBelow(q("bpg", 0.5), 1);
		const sum = (key: string) => lines.reduce((a, x) => a + x.s[key]!, 0);
		const tp = sum("tp") / sum("tpa");
		const ft = sum("ft") / sum("fta");
		assert.isAbove(tp, 0.31);
		assert.isBelow(tp, 0.38);
		assert.isAbove(ft, 0.64);
		assert.isBelow(ft, 0.77);
		for (let i = 0; i < NUM_CLASSES; i++) {
			const set = lines.filter((x) => x.year === SEASON + i);
			// Not everyone looks the same: points, rebounds, assists and threes all spread out within a class
			assert.isAbove(sd(set.map((x) => x.ppg)), 3);
			assert.isAbove(sd(set.map((x) => x.rpg)), 1.4);
			assert.isAbove(sd(set.map((x) => x.apg)), 0.8);
			assert.isAbove(sd(set.map((x) => x.tpar)), 0.13);
		}
		// The best of each class are the stars of their teams, the bottom of it role players
		const byRank = (lo: number, hi: number) =>
			lines.filter((x) => {
				const set = lines
					.filter((y) => y.year === x.year)
					.sort((a, b) => b.r.ovr! - a.r.ovr!);
				const i = set.indexOf(x);
				return i >= lo && i < hi;
			});
		const topPpg = quantile(
			byRank(0, 5).map((x) => x.ppg),
			0.5,
		);
		const restPpg = quantile(
			byRank(20, 100).map((x) => x.ppg),
			0.5,
		);
		assert.isAbove(topPpg, 14);
		assert.isBelow(topPpg, 22);
		assert.isAbove(restPpg, 5);
		assert.isBelow(restPpg, 11);
	});

	test("each stat follows the ratings behind it", () => {
		// Where the class leader in a stat ranks in his class in the rating behind it, averaged over the classes (and never far off in any one)
		const leaders: Record<string, number[]> = {};
		const add = (key: string, value: number) => {
			(leaders[key] ??= []).push(value);
		};
		for (let i = 0; i < NUM_CLASSES; i++) {
			const set = lines.filter((x) => x.year === SEASON + i);
			const top = (key: keyof Line) =>
				set.reduce((a, b) => ((b[key] as number) > (a[key] as number) ? b : a));
			// The class's top passer leads it in assists, its rim protector in blocks, its shooter in threes, its big rebounder on the glass
			add("assists: pss", pct(set, top("apg"), "pss"));
			add("blocks: hgt", pct(set, top("bpg"), "hgt"));
			add("blocks: idef", pct(set, top("bpg"), "idef"));
			// A shot blocker is big, a good interior defender or both (length and leaping help too)
			add(
				"blocks: hgt + idef",
				(pct(set, top("bpg"), "hgt") + pct(set, top("bpg"), "idef")) / 2,
			);
			add("rebounds: hgt", pct(set, top("rpg"), "hgt"));
			add("rebounds: reb", pct(set, top("rpg"), "reb"));
			add("threes: tp", pct(set, top("tpa"), "tp"));
			add("steals: pdef", pct(set, top("spg"), "pdef"));
			// Non-shooters barely shoot threes; bigs who can't shoot none at all
			for (const x of set) {
				if (x.r.tp! < 30) {
					assert.isBelow(x.tpar, 0.35);
				}
				if (x.r.tp! < 25 && x.r.hgt! >= 60) {
					assert.isBelow(x.tpa, 0.6);
				}
			}
		}
		for (const [key, values] of Object.entries(leaders)) {
			const mean = values.reduce((a, b) => a + b, 0) / values.length;
			assert.isAtLeast(mean, key === "blocks: idef" ? 0.6 : 0.7, key);
			if (key !== "blocks: idef" && key !== "blocks: hgt") {
				assert.isAtLeast(Math.min(...values), 0.3, key);
			}
		}
	});

	test("a pass-first guard and a rim protector look nothing alike", () => {
		const passers = lines.filter((x) => x.r.pss! >= 55 && x.r.hgt! < 45);
		const bigs = lines.filter((x) => x.r.hgt! >= 60 && x.r.idef! >= 40);
		assert.isAbove(passers.length, 3);
		assert.isAbove(bigs.length, 3);
		const avg = (set: Line[], f: (x: Line) => number) =>
			set.reduce((a, x) => a + f(x), 0) / set.length;
		const per40 = (x: Line, v: number) => (v / x.mpg) * 40;
		const p = {
			ast: avg(passers, (x) => per40(x, x.apg)),
			blk: avg(passers, (x) => per40(x, x.bpg)),
			reb: avg(passers, (x) => per40(x, x.rpg)),
			tpar: avg(passers, (x) => x.tpar),
		};
		const b = {
			ast: avg(bigs, (x) => per40(x, x.apg)),
			blk: avg(bigs, (x) => per40(x, x.bpg)),
			reb: avg(bigs, (x) => per40(x, x.rpg)),
			tpar: avg(bigs, (x) => x.tpar),
		};
		assert.isAbove(p.ast, 2 * b.ast);
		assert.isAbove(b.blk, 4 * p.blk);
		assert.isAbove(b.reb, 1.8 * p.reb);
		assert.isAbove(p.tpar, 2 * b.tpar);
	});

	test("stats are stamped with the model version", () => {
		for (const x of lines) {
			// Sub-ratings off in this league: the version from before sub-ratings
			assert.strictEqual(x.p.collegeStatsV, COLLEGE_STATS_VERSION_BASE);
		}
	});

	test("upgradeCollegeStats remakes stale classes from their seed and keeps their college season", async () => {
		const year = SEASON + 3;
		const before = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
		).filter((p) => p.draft.year === year);
		const expected = structuredClone(
			before.map((p) => ({
				stats: p.stats,
				collegeSeason: p.collegeSeason,
				career: p.preDraftCareer,
			})),
		);
		// What a league from before this version has: no stamp, and lines that came out of the old model
		for (const p of before) {
			delete p.collegeStatsV;
			for (const row of p.stats) {
				(row as any).pts += 99;
			}
		}
		// A drafted player (from another class) is never touched
		const drafted = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
		).find((p) => p.draft.year === year + 1)!;
		drafted.tid = 0;
		delete drafted.collegeStatsV;
		await idb.cache.players.put(drafted);
		const draftedStats = structuredClone(drafted.stats);

		const years = await upgradeCollegeStats();
		assert.deepStrictEqual(years, [year]);
		assert.deepStrictEqual(drafted.stats, draftedStats);
		assert.strictEqual(drafted.collegeStatsV, undefined);
		for (const [i, p] of before.entries()) {
			assert.strictEqual(p.collegeStatsV, COLLEGE_STATS_VERSION_BASE);
			assert.deepStrictEqual(p.stats, expected[i]!.stats);
			assert.deepStrictEqual(p.collegeSeason, expected[i]!.collegeSeason);
		}
		// Nothing left to do
		assert.deepStrictEqual(await upgradeCollegeStats(), []);
		drafted.tid = PLAYER.UNDRAFTED;
		drafted.collegeStatsV = COLLEGE_STATS_VERSION;
		await idb.cache.players.put(drafted);
	});
});
