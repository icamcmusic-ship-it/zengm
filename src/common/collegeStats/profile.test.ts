import { assert, describe, test } from "vitest";
import {
	combinePercentiles,
	estimateRecord,
	getClub,
	getCombine,
	getHeadCoach,
	getRecruiting,
	getStockTimeline,
	normCdf,
	prospectDistance,
} from "./profile.ts";

const ratings = { hgt: 50, stre: 50, spd: 50, jmp: 50, endu: 50 };

describe("profile extras", () => {
	test("normCdf", () => {
		assert.closeTo(normCdf(0), 0.5, 1e-6);
		assert.closeTo(normCdf(1.96), 0.975, 1e-3);
		assert.closeTo(normCdf(-1), 0.1587, 1e-3);
	});

	test("recruiting: deterministic, better prospects rank higher on average", () => {
		const a = getRecruiting({
			pid: 1,
			pot: 70,
			ovr: 55,
			pos: "SF",
			firstCollegeSeason: 2026,
		});
		assert.deepStrictEqual(
			a,
			getRecruiting({
				pid: 1,
				pot: 70,
				ovr: 55,
				pos: "SF",
				firstCollegeSeason: 2026,
			}),
		);
		assert.strictEqual(a.classOf, 2025);
		let top = 0;
		let bottom = 0;
		for (let pid = 0; pid < 200; pid++) {
			top += getRecruiting({
				pid,
				pot: 72,
				ovr: 55,
				pos: "PG",
				firstCollegeSeason: 2026,
			}).nationalRank;
			bottom += getRecruiting({
				pid,
				pot: 48,
				ovr: 40,
				pos: "PG",
				firstCollegeSeason: 2026,
			}).nationalRank;
		}
		assert.isBelow(top / 200, 30);
		assert.isAbove(bottom / 200, 200);
		for (let pid = 0; pid < 50; pid++) {
			const r = getRecruiting({
				pid,
				pot: 60,
				ovr: 48,
				pos: "C",
				firstCollegeSeason: 2026,
			});
			assert.isAtLeast(r.nationalRank, 1);
			assert.isAtLeast(r.stars, 2);
			assert.isAtMost(r.stars, 5);
		}
	});

	test("coaches hold a job for a run of seasons, same for everyone", () => {
		const coaches = new Set<string>();
		for (let season = 2000; season < 2030; season++) {
			const c = getHeadCoach("Duke", season);
			assert.deepStrictEqual(c, getHeadCoach("Duke", season));
			assert.isAtMost(c.since, season);
			coaches.add(c.name + c.since);
		}
		assert.isAbove(coaches.size, 1);
		assert.isBelow(coaches.size, 12);
		assert.strictEqual(getClub("EuroLeague", 5), getClub("EuroLeague", 5));
		assert.isUndefined(getClub("Nowhere League", 5));
	});

	test("estimated records cover the games he played", () => {
		for (let gp = 10; gp < 60; gp += 7) {
			const r = estimateRecord({
				team: "X",
				season: 2020,
				strength: 70,
				gp,
				conference: "ACC",
			});
			assert.isAtLeast(r.w + r.l, gp);
			assert.isAtMost(r.confW! + r.confL!, r.w + r.l);
			assert.isAtMost(r.confW!, r.w);
			assert.isAtMost(r.confL!, r.l);
		}
	});

	test("combine: plausible numbers, athletes test better, percentiles", () => {
		const avg = getCombine({ pid: 1, heightInches: 78, weight: 210, ratings });
		assert.isAbove(avg.wingspan, avg.heightNoShoes - 4);
		assert.isBelow(avg.heightNoShoes, avg.heightShoes);
		assert.isAbove(avg.standingReach, 95);
		assert.isBelow(avg.standingVert, avg.maxVert);
		let fast = 0;
		let slow = 0;
		for (let pid = 0; pid < 100; pid++) {
			fast += getCombine({
				pid,
				heightInches: 78,
				weight: 210,
				ratings: { ...ratings, spd: 85, jmp: 85 },
			}).maxVert;
			slow += getCombine({
				pid,
				heightInches: 78,
				weight: 210,
				ratings: { ...ratings, spd: 30, jmp: 30 },
			}).maxVert;
		}
		assert.isAbove(fast, slow + 500);
		const all = [0, 1, 2, 3].map((pid) =>
			getCombine({ pid, heightInches: 70 + 4 * pid, weight: 200, ratings }),
		);
		const p = combinePercentiles(all[3]!, all);
		assert.strictEqual(p.heightNoShoes.rank, 1);
		assert.strictEqual(p.heightNoShoes.pct, 100);
		assert.strictEqual(combinePercentiles(all[0]!, all).heightNoShoes.pct, 0);
	});

	test("combine: wingspan rating is read relative to height (wng is on the hgt scale)", () => {
		// A 7-footer with an average wingspan for his height (wng = hgt) has a normal ape index, not a huge one
		const apes = [];
		for (let pid = 0; pid < 50; pid++) {
			const c = getCombine({
				pid,
				heightInches: 84,
				weight: 250,
				ratings: { ...ratings, hgt: 70, wingspanGap: 0 },
			});
			apes.push(c.wingspan - c.heightNoShoes);
		}
		const mean = apes.reduce((a, b) => a + b, 0) / apes.length;
		assert.isAbove(mean, 2.5);
		assert.isBelow(mean, 4.5);
		const long = getCombine({
			pid: 1,
			heightInches: 78,
			weight: 210,
			ratings: { ...ratings, wingspanGap: 20 },
		});
		const short = getCombine({
			pid: 1,
			heightInches: 78,
			weight: 210,
			ratings: { ...ratings, wingspanGap: -20 },
		});
		assert.isAbove(long.wingspan - short.wingspan, 9);
	});

	test("draft stock ends where he went", () => {
		const points = getStockTimeline({
			pid: 3,
			seasons: [2025, 2026],
			finalPick: 7,
			numPicks: 60,
			recruitRank: 20,
			drafted: true,
		});
		assert.strictEqual(points.length, 2 * 3 + 2);
		assert.strictEqual(points.at(-1)!.pick, 7);
		assert.strictEqual(points.at(-1)!.label, "Draft night");
		const undrafted = getStockTimeline({
			pid: 3,
			seasons: [2026],
			finalPick: 70,
			numPicks: 60,
			recruitRank: undefined,
			drafted: true,
		});
		assert.isUndefined(undrafted.at(-1)!.pick);
		assert.deepStrictEqual(
			getStockTimeline({
				pid: 3,
				seasons: [],
				finalPick: 1,
				numPicks: 60,
				recruitRank: undefined,
				drafted: false,
			}),
			[],
		);
	});

	test("distance", () => {
		const a = { ratings: { hgt: 50, spd: 50 }, age: 19, pos: "PG", ovr: 45 };
		assert.strictEqual(prospectDistance(a, a), 0);
		assert.isAbove(
			prospectDistance(a, { ...a, pos: "C" }),
			prospectDistance(a, { ...a, age: 20 }),
		);
	});
});
