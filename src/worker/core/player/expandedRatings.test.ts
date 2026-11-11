import { afterAll, assert, describe, test } from "vitest";
import { player } from "../index.ts";
import { g } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	blendDiq,
	blendReb,
	deriveExpandedRatings,
	fillExpandedRatings,
	hasExpandedRatings,
	insertExpandedRatingKeys,
} from "../../../common/expandedRatings.ts";
import { idb } from "../../db/index.ts";
import updateExpandedRatingsForLeague from "./updateExpandedRatingsForLeague.ts";
import { PLAYER } from "../../../common/constants.ts";
import { getSkillBadges } from "../../../common/skillBadges/index.ts";

const withSeed = async <T>(seed: number, fn: () => Promise<T> | T) => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		return await fn();
	} finally {
		Math.random = original;
	}
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

afterAll(() => {
	resetG();
});

const setup = async (expanded: boolean) => {
	resetG();
	g.setWithoutSavingToDB("season", 2020);
	g.setWithoutSavingToDB("expandedRatings", expanded);
	await resetCache({});
};

describe("derivation", () => {
	test("deterministic, and keeps diq as the average of the two defense ratings", () => {
		const r = {
			hgt: 60,
			stre: 55,
			spd: 40,
			jmp: 50,
			reb: 65,
			diq: 52,
			drb: 40,
		};
		const a = deriveExpandedRatings(r, "xr|7");
		const b = deriveExpandedRatings(r, "xr|7");
		assert.deepStrictEqual(a, b);
		assert.strictEqual(blendDiq(a.pdef, a.idef), 52);
		// A slow big leans interior
		assert.isBelow(a.pdef, a.idef + 6);
	});

	test("fills every row, with one wingspan for all of them", () => {
		const p = {
			pid: 3,
			ratings: [
				{ season: 2018, hgt: 50, spd: 60, stre: 40, jmp: 60, reb: 40, diq: 40 },
				{ season: 2019, hgt: 50, spd: 61, stre: 42, jmp: 60, reb: 45, diq: 47 },
			],
		};
		assert.isTrue(fillExpandedRatings(p));
		const rows = p.ratings as any[];
		assert.isTrue(rows.every(hasExpandedRatings));
		assert.strictEqual(rows[0].wng, rows[1].wng);
		for (const row of rows) {
			assert.strictEqual(blendDiq(row.pdef, row.idef), row.diq);
		}
		assert.isFalse(fillExpandedRatings(p));
	});

	test("table keys", () => {
		assert.deepStrictEqual(
			insertExpandedRatingKeys(["hgt", "stre", "diq", "drb"]),
			["hgt", "wng", "stre", "diq", "pdef", "idef", "drb", "bsc"],
		);
	});
});

describe("generation and development", () => {
	test("setting off: no expanded ratings", async () => {
		await withSeed(1, async () => {
			await setup(false);
			const p = player.generate(0, 22, 2020, true, DEFAULT_LEVEL);
			await player.develop(p, 0);
			assert.isFalse(hasExpandedRatings(p.ratings[0]));
		});
	});

	test("setting on: wingspan around height, diq the defense average, league ovr unchanged", async () => {
		const ovrs: Record<string, number[]> = { off: [], on: [] };
		for (const expanded of [false, true]) {
			await withSeed(2, async () => {
				await setup(expanded);
				for (const _i of range(400)) {
					const p = player.generate(0, 24, 2020, true, DEFAULT_LEVEL);
					await player.develop(p, 0, false, DEFAULT_LEVEL, true);
					const r = p.ratings[0] as any;
					ovrs[expanded ? "on" : "off"]!.push(r.ovr);
					if (expanded) {
						assert.isTrue(hasExpandedRatings(r));
						assert.strictEqual(blendDiq(r.pdef, r.idef), r.diq);
						assert.isBelow(Math.abs(r.wng - r.hgt), 40);
					}
				}
			});
		}
		assert.approximately(mean(ovrs.on!), mean(ovrs.off!), 1.2);
	});

	test("development: wingspan fixed for adults, diq stays the defense average, perimeter defense fades first with age", async () => {
		await withSeed(3, async () => {
			await setup(true);
			const splitsYoung: number[] = [];
			const splitsOld: number[] = [];
			for (const _i of range(60)) {
				const p = player.generate(0, 25, 2020, true, DEFAULT_LEVEL);
				await player.develop(p, 0, false, DEFAULT_LEVEL, true);
				const r = p.ratings[0] as any;
				const wng = r.wng;
				const hgt = r.hgt;
				const split0 = r.pdef - r.idef;
				for (let year = 0; year < 9; year++) {
					p.ratings[0].season += 1;
					await player.develop(p, 1, false, DEFAULT_LEVEL, true);
					assert.strictEqual(blendDiq(r.pdef, r.idef), r.diq);
				}
				assert.strictEqual(r.wng - wng, r.hgt - hgt);
				splitsYoung.push(split0);
				splitsOld.push(r.pdef - r.idef);
			}
			assert.isBelow(mean(splitsOld), mean(splitsYoung) - 5);
		});
	});
});

describe("turning the setting on in an existing league", () => {
	test("derives the new ratings, keeps diq, and ovr barely moves", async () => {
		await withSeed(4, async () => {
			await setup(false);
			const players = range(60).map((i) => {
				const p: any = player.generate(i % 2, 25, 2018, true, DEFAULT_LEVEL);
				p.pid = i;
				return p;
			});
			for (const p of players) {
				await player.develop(p, 0);
			}
			const before = new Map(
				players.map((p) => [p.pid, { ...p.ratings.at(-1) }]),
			);
			await resetCache({ players });
			g.setWithoutSavingToDB("expandedRatings", true);
			await updateExpandedRatingsForLeague();
			const after = await idb.cache.players.getAll();
			const diffs: number[] = [];
			for (const p of after) {
				if (p.tid === PLAYER.RETIRED) {
					continue;
				}
				const r = p.ratings.at(-1) as any;
				const b = before.get(p.pid)!;
				assert.isTrue(hasExpandedRatings(r));
				assert.strictEqual(r.diq, b.diq);
				diffs.push(r.ovr - b.ovr);
			}
			assert.isBelow(Math.abs(mean(diffs)), 0.6);
			assert.isBelow(Math.max(...diffs.map(Math.abs)), 5);
		});
	});
});

describe("turning the setting off and on again", () => {
	test("defense ratings follow diq's development while it was off", async () => {
		await withSeed(5, async () => {
			await setup(true);
			const players = range(20).map((i) => {
				const p: any = player.generate(i % 2, 25, 2018, true, DEFAULT_LEVEL);
				p.pid = i;
				return p;
			});
			for (const p of players) {
				await player.develop(p, 0);
			}
			await resetCache({ players });
			g.setWithoutSavingToDB("expandedRatings", false);
			await updateExpandedRatingsForLeague();
			// A season off: diq develops without them, the next row is a copy of the old one
			const splits = new Map<number, number>();
			for (const p of await idb.cache.players.getAll()) {
				const r = p.ratings.at(-1) as any;
				splits.set(p.pid, r.pdef - r.idef);
				r.diq = Math.min(90, r.diq + 12);
			}
			g.setWithoutSavingToDB("expandedRatings", true);
			await updateExpandedRatingsForLeague();
			for (const p of await idb.cache.players.getAll()) {
				const r = p.ratings.at(-1) as any;
				assert.strictEqual(blendDiq(r.pdef, r.idef), r.diq, `pid ${p.pid}`);
				assert.isAtMost(
					Math.abs(r.pdef - r.idef - splits.get(p.pid)!),
					1,
					`pid ${p.pid}`,
				);
			}
		});
	});
});

describe("skill badges", () => {
	test("perimeter/interior defense and length drive the defensive badges when present", () => {
		const base = {
			hgt: 75,
			stre: 60,
			spd: 40,
			jmp: 55,
			endu: 50,
			ins: 50,
			dnk: 50,
			ft: 50,
			fg: 40,
			tp: 30,
			oiq: 50,
			diq: 55,
			drb: 40,
			pss: 40,
			reb: 60,
		};
		const stock = getSkillBadges(base);
		const longRimProtector = getSkillBadges({
			...base,
			wng: 95,
			pdef: 30,
			idef: 80,
		});
		const shortLeaper = getSkillBadges({
			...base,
			wng: 45,
			pdef: 70,
			idef: 35,
		});
		assert.isFalse(stock.includes("Bk") && !longRimProtector.includes("Bk"));
		assert.isTrue(longRimProtector.includes("Bk"));
		assert.isFalse(shortLeaper.includes("Bk"));
	});
});

describe("second step: rebounding, shooting, ball security", () => {
	const compatOk = (r: any) => {
		assert.strictEqual(blendReb(r.oreb, r.dreb), r.reb);
		assert.strictEqual(r.csh + r.dsh, r.fg + r.tp);
	};

	test("derivation keeps reb the average of oreb/dreb and fg + tp = csh + dsh, and fills rows from before the second step", () => {
		const r = {
			hgt: 40,
			stre: 45,
			spd: 70,
			jmp: 60,
			reb: 41,
			diq: 50,
			drb: 75,
			pss: 65,
			oiq: 60,
			fg: 55,
			tp: 62,
		};
		const a = deriveExpandedRatings(r, "xr|9");
		compatOk({ ...r, ...a });
		// A fast ball handler leans off the dribble
		assert.isBelow(a.csh, a.dsh + 6);

		// A row with only the first step's ratings: those are kept
		const row: any = { ...r, wng: 33, pdef: 55, idef: 45 };
		assert.isFalse(hasExpandedRatings(row));
		assert.isTrue(fillExpandedRatings({ pid: 9, ratings: [row] }));
		assert.isTrue(hasExpandedRatings(row));
		assert.strictEqual(row.wng, 33);
		assert.strictEqual(row.pdef, 55);
		compatOk(row);
	});

	test("generation and development keep the compat values in sync, league ovr unchanged", async () => {
		await withSeed(12, async () => {
			const ovrs: Record<string, number[]> = { off: [], on: [] };
			for (const expanded of [false, true]) {
				await setup(expanded);
				for (const _i of range(300)) {
					const p = player.generate(0, 21, 2020, true, DEFAULT_LEVEL);
					await player.develop(p, 0, false, DEFAULT_LEVEL, true);
					const r = p.ratings[0] as any;
					if (expanded) {
						compatOk(r);
						for (let year = 0; year < 6; year++) {
							r.season += 1;
							await player.develop(p, 1, false, DEFAULT_LEVEL, true);
							compatOk(r);
						}
					} else {
						for (let year = 0; year < 6; year++) {
							r.season += 1;
							await player.develop(p, 1, false, DEFAULT_LEVEL, true);
						}
					}
					ovrs[expanded ? "on" : "off"]!.push(r.ovr);
				}
			}
			assert.approximately(mean(ovrs.on!), mean(ovrs.off!), 1.2);
		});
	});

	test("turning it off and on again: the splits follow reb and fg/tp", async () => {
		await withSeed(7, async () => {
			await setup(true);
			const players = range(20).map((i) => {
				const p: any = player.generate(i % 2, 25, 2018, true, DEFAULT_LEVEL);
				p.pid = i;
				return p;
			});
			for (const p of players) {
				await player.develop(p, 0);
			}
			await resetCache({ players });
			g.setWithoutSavingToDB("expandedRatings", false);
			await updateExpandedRatingsForLeague();
			const splits = new Map<number, [number, number]>();
			for (const p of await idb.cache.players.getAll()) {
				const r = p.ratings.at(-1) as any;
				splits.set(p.pid, [r.oreb - r.dreb, r.csh - r.dsh]);
				r.reb = Math.min(90, r.reb + 9);
				r.tp = Math.min(90, r.tp + 7);
			}
			g.setWithoutSavingToDB("expandedRatings", true);
			await updateExpandedRatingsForLeague();
			for (const p of await idb.cache.players.getAll()) {
				const r = p.ratings.at(-1) as any;
				compatOk(r);
				const [reb, shot] = splits.get(p.pid)!;
				assert.isAtMost(Math.abs(r.oreb - r.dreb - reb), 1);
				assert.isAtMost(Math.abs(r.csh - r.dsh - shot), 1);
			}
		});
	});

	test("badges: catch-and-shoot vs off-dribble shooter, offensive vs defensive rebounder", () => {
		const base: any = {
			hgt: 45,
			stre: 50,
			spd: 55,
			jmp: 55,
			endu: 50,
			ins: 40,
			dnk: 45,
			ft: 70,
			fg: 62,
			tp: 64,
			oiq: 62,
			diq: 45,
			drb: 66,
			pss: 50,
			reb: 45,
			wng: 45,
			pdef: 45,
			idef: 45,
			oreb: 45,
			dreb: 45,
			bsc: 55,
		};
		const spotUp = getSkillBadges({ ...base, csh: 78, dsh: 48 });
		const creator = getSkillBadges({ ...base, csh: 48, dsh: 78 });
		assert.include(spotUp, "Cs");
		assert.notInclude(creator, "Cs");
		assert.include(creator, "Pu");
		assert.notInclude(spotUp, "Pu");
	});
});
