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
	HS_ALL_STAR_GAMES,
	adjustRecruitRank,
	compositeForRank,
	getRecruitingExtras,
	resolveClassRanks,
	starsForRank,
	type RankEntry,
} from "./profile.ts";
import { COLLEGES } from "./colleges.ts";
import { getSchool } from "./colleges.helpers.ts";

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

describe("recruiting ranks within a high school class", () => {
	const makeEntries = (n: number, priority: 0 | 1 | 2, idStart = 0) =>
		Array.from({ length: n }, (_, i): RankEntry => {
			const pid = idStart + i;
			const r = getRecruiting({
				pid,
				pot: 40 + ((pid * 7) % 36),
				ovr: 32 + ((pid * 5) % 26),
				pos: ["PG", "SG", "SF", "PF", "C"][pid % 5]!,
				firstCollegeSeason: 2027,
			});
			return {
				id: pid,
				rank: r.nationalRank,
				pos: r.pos,
				posRank: r.posRank,
				priority,
			};
		});

	const check = (
		entries: RankEntry[],
		ranks: ReturnType<typeof resolveClassRanks>,
	) => {
		const national = new Set<number>();
		const byPos = new Map<string, { national: number; pos: number }[]>();
		for (const e of entries) {
			const mine = ranks.get(e.id)!;
			if (e.rank === undefined) {
				assert.isUndefined(mine.nationalRank);
				assert.isUndefined(mine.posRank);
				continue;
			}
			assert(!national.has(mine.nationalRank!), "national rank is unique");
			national.add(mine.nationalRank!);
			assert.isAtLeast(mine.nationalRank!, 1);
			assert.isAtLeast(mine.posRank!, 1);
			byPos.set(e.pos, [
				...(byPos.get(e.pos) ?? []),
				{ national: mine.nationalRank!, pos: mine.posRank! },
			]);
		}
		for (const list of byPos.values()) {
			assert.strictEqual(
				new Set(list.map((x) => x.pos)).size,
				list.length,
				"position rank is unique",
			);
		}
		return byPos;
	};

	test("the plain ranking alone gives players of a class the same rank", () => {
		const entries = makeEntries(300, 1);
		assert.isBelow(new Set(entries.map((e) => e.rank)).size, entries.length);
	});

	test("unique national and position ranks, in the same order at a position", () => {
		const entries = makeEntries(100, 1);
		const ranks = resolveClassRanks(entries);
		const byPos = check(entries, ranks);
		for (const list of byPos.values()) {
			list.sort((a, b) => a.national - b.national);
			for (let i = 1; i < list.length; i++) {
				assert.isAbove(list[i]!.pos, list[i - 1]!.pos);
			}
			for (const x of list) {
				assert.isAtMost(x.pos, x.national);
			}
		}
		// Most players keep the rank they had on their own
		const kept = entries.filter(
			(e) => ranks.get(e.id)!.nationalRank === e.rank,
		).length;
		assert.isAbove(kept / entries.length, 0.5);
		// And nobody moves far
		for (const e of entries) {
			assert.isAtMost(ranks.get(e.id)!.nationalRank! - e.rank!, 25);
		}
		// Same input in another order, same ranks
		assert.deepStrictEqual(
			resolveClassRanks([...entries].reverse()),
			new Map([...ranks].reverse()),
		);
	});

	test("stable: players ranked later fit around the ones ranked before", () => {
		const shown = makeEntries(120, 1);
		const before = resolveClassRanks(shown);
		// Another draft class with players of the same high school class is generated: its players are ranked now
		const added = makeEntries(80, 2, 1000);
		const after = resolveClassRanks([...added, ...shown]);
		for (const e of shown) {
			assert.deepStrictEqual(after.get(e.id), before.get(e.id));
		}
		check([...shown, ...added], after);

		// Once set (stored), ranks never move, whoever is ranked later
		const stored = [...shown, ...added].map(
			(e): RankEntry => ({
				...e,
				rank: after.get(e.id)!.nationalRank,
				posRank: after.get(e.id)!.posRank,
				priority: 0,
			}),
		);
		const later = makeEntries(60, 2, 5000);
		const final = resolveClassRanks([...later, ...stored]);
		for (const e of stored) {
			assert.deepStrictEqual(final.get(e.id), after.get(e.id));
		}
		check([...stored, ...later], final);
	});

	test("an unranked recruit has no ranks and takes none", () => {
		const entries: RankEntry[] = [
			{ id: 1, rank: undefined, pos: "PG", posRank: undefined, priority: 2 },
			{ id: 2, rank: 5, pos: "PG", posRank: 1, priority: 2 },
			{ id: 3, rank: 5, pos: "PG", posRank: 1, priority: 2 },
		];
		const ranks = resolveClassRanks(entries);
		assert.deepStrictEqual(ranks.get(1), {
			nationalRank: undefined,
			posRank: undefined,
		});
		assert.deepStrictEqual(ranks.get(2), { nationalRank: 5, posRank: 1 });
		assert.deepStrictEqual(ranks.get(3), { nationalRank: 6, posRank: 2 });
	});

	test("a story sets what the recruiting services said", () => {
		for (let pid = 0; pid < 200; pid++) {
			const bust = adjustRecruitRank({
				pid,
				nationalRank: 400,
				story: "bust",
				jucoStart: false,
			})!;
			assert.isAtMost(bust, 25);
			assert.strictEqual(starsForRank(bust), 5);
			assert.isUndefined(
				adjustRecruitRank({
					pid,
					nationalRank: 3,
					story: "unranked",
					jucoStart: false,
				}),
			);
			const juco = adjustRecruitRank({
				pid,
				nationalRank: 60,
				story: undefined,
				jucoStart: true,
			});
			assert(juco === undefined || juco > 200);
			assert.strictEqual(
				adjustRecruitRank({
					pid,
					nationalRank: 60,
					story: undefined,
					jucoStart: false,
				}),
				60,
			);
		}
	});
});

describe("recruiting extras", () => {
	const programs = Object.keys(COLLEGES).map((name) => ({
		name,
		strength: getSchool(name)!.strength,
	}));
	const extras = (pid: number, nationalRank: number | undefined) =>
		getRecruitingExtras({
			pid,
			nationalRank,
			committed: "Kansas",
			committedStrength: getSchool("Kansas")!.strength,
			programs,
		});

	test("deterministic, with the school he signed with among the offers and finalists", () => {
		for (let pid = 0; pid < 300; pid++) {
			const rank = 1 + ((pid * 37) % 900);
			const a = extras(pid, rank);
			assert.deepStrictEqual(a, extras(pid, rank));
			assert.strictEqual(a.offers[0], "Kansas");
			assert.strictEqual(a.finalists[0], "Kansas");
			assert.strictEqual(new Set(a.offers).size, a.offers.length);
			assert.isAtMost(a.offers.length, 8);
			assert.isAtLeast(a.offerCount, a.offers.length);
			assert.isAtMost(a.finalists.length, 5);
			for (const name of a.finalists) {
				assert.include(a.offers, name);
			}
			for (const name of a.offers) {
				assert(COLLEGES[name], name);
			}
			assert.include(["early", "late"], a.signing);
			assert.isAtLeast(a.composite, 0.7);
			assert.isAtMost(a.composite, 1);
		}
	});

	test("composite agrees with the stars, better recruits get more offers and the all-star games", () => {
		assert.strictEqual(compositeForRank(1), 1);
		let prev = 2;
		for (const rank of [1, 2, 10, 25, 26, 150, 151, 500, 501, 1200]) {
			const c = compositeForRank(rank);
			assert.isBelow(c, prev);
			prev = c;
		}
		assert.isAtLeast(compositeForRank(25), 0.9834);
		assert.isBelow(compositeForRank(26), 0.9834);
		const mean = (rank: number | undefined) => {
			let offers = 0;
			let allStar = 0;
			for (let pid = 0; pid < 300; pid++) {
				const x = extras(pid, rank);
				offers += x.offerCount;
				allStar += x.allStar.includes(HS_ALL_STAR_GAMES[0]!) ? 1 : 0;
			}
			return { offers: offers / 300, allStar: allStar / 300 };
		};
		assert.isAbove(mean(5).offers, mean(100).offers);
		assert.isAbove(mean(100).offers, mean(400).offers);
		assert.isAbove(mean(400).offers, mean(undefined).offers);
		assert.isAbove(mean(5).allStar, 0.7);
		assert.strictEqual(mean(60).allStar, 0);
		assert.strictEqual(mean(undefined).allStar, 0);
		// Generic names only
		for (const name of HS_ALL_STAR_GAMES) {
			assert.notMatch(name, /McDonald|Jordan|Nike|Iverson|Gatorade/);
		}
	});

	test("a junior college start: few offers", () => {
		for (let pid = 0; pid < 50; pid++) {
			const x = getRecruitingExtras({
				pid,
				nationalRank: undefined,
				committed: "Chipola College",
				committedStrength: undefined,
				programs,
				jucoStart: true,
			});
			assert.isAtMost(x.offerCount, 3);
			assert.strictEqual(x.offers[0], "Chipola College");
		}
	});
});

describe("draft stock with a story", () => {
	const timeline = (
		pid: number,
		story: string | undefined,
		finalPick: number,
	) =>
		getStockTimeline({
			pid,
			seasons: [2027, 2028, 2029],
			finalPick,
			numPicks: 60,
			recruitRank: story === "unranked" ? undefined : story === "bust" ? 5 : 80,
			drafted: true,
			story,
		});

	test("no story: the same timeline as before stories existed", () => {
		for (let pid = 0; pid < 20; pid++) {
			const { story: _story, ...args } = {
				pid,
				seasons: [2027, 2028],
				finalPick: 20,
				numPicks: 60,
				recruitRank: 40,
				drafted: true,
				story: undefined,
			};
			assert.deepStrictEqual(
				getStockTimeline(args),
				getStockTimeline({ ...args, story: undefined }),
			);
		}
	});

	test("ends where he went, and starts where his story says", () => {
		let bustEarly = 0;
		let riserEarly = 0;
		let lateEarly = 0;
		const N = 100;
		for (let pid = 0; pid < N; pid++) {
			const bust = timeline(pid, "bust", 48);
			assert.strictEqual(bust.at(-1)!.pick, 48);
			bustEarly += (bust[0]!.pick ?? 99) <= 14 ? 1 : 0;
			const riser = timeline(pid, "unranked", 8);
			assert.strictEqual(riser.at(-1)!.pick, 8);
			riserEarly += riser[0]!.pick === undefined ? 1 : 0;
			const late = timeline(pid, "lateBloomer", 25);
			assert.strictEqual(late.at(-1)!.pick, 25);
			lateEarly +=
				late.slice(0, 6).filter((x) => x.pick === undefined).length >= 4
					? 1
					: 0;
			const injury = timeline(pid, "injury", 30);
			assert.strictEqual(injury.at(-1)!.pick, 30);
		}
		assert.isAbove(bustEarly / N, 0.9);
		assert.isAbove(riserEarly / N, 0.9);
		assert.isAbove(lateEarly / N, 0.8);
		// An injury drops him: he was higher before his last season than a player who went at the same pick
		const before = (story: string | undefined) => {
			let sum = 0;
			for (let pid = 0; pid < N; pid++) {
				// Preseason of his last season
				sum += Math.log(timeline(pid, story, 30).at(-5)!.pick ?? 75);
			}
			return sum / N;
		};
		assert.isBelow(before("injury"), before(undefined) - 0.3);
	});
});
