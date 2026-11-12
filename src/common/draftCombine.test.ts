// Draft Lottery Night & Combine setting, pure parts: the combine (deterministic, no game random numbers, skip rates, the AI
// nudge), the lottery night (reveal order, jumps and falls, recap, reactions) and the combine's effect on scouting grade ranges.
import { afterEach, assert, describe, test } from "vitest";
import {
	COMBINE_NUDGE_MAX,
	combineNudges,
	combineRanks,
	combineScoutNotes,
	generateDraftCombine,
	numCombineInvites,
	skipDrillsChance,
	type DraftCombineInput,
	type DraftCombineResult,
} from "./draftCombine.ts";
import {
	getLotteryNightRows,
	lotteryReaction,
	lotteryRecap,
	lotteryRevealOrder,
	moveText,
} from "./lotteryNight.ts";
import { Rng } from "./collegeStats/rng.ts";
import {
	buildPeerTable,
	buildReport,
	categoryScores,
	getDepartment,
	type ScoutInput,
	type ScoutRatings,
} from "./scoutingReports/index.ts";

const realRandom = Math.random;
afterEach(() => {
	Math.random = realRandom;
});

const prospect = (pid: number, rng: Rng, rank = 40): DraftCombineInput => {
	const hgt = Math.round(47 + 14 * rng.normal());
	return {
		pid,
		season: 2030,
		heightInches: Math.round(66 + (hgt * 27) / 100 + rng.normal(0, 0.6)),
		weight: Math.round(215 + 6.5 * ((hgt - 47) * 0.27) + rng.normal(0, 14)),
		rank,
		injured: false,
		ratings: {
			hgt,
			stre: Math.round(42 + 9 * rng.normal()),
			spd: Math.round(52 + 15 * rng.normal()),
			jmp: Math.round(52 + 15 * rng.normal()),
			endu: Math.round(25 + 9 * rng.normal()),
			tp: Math.round(36 + 11 * rng.normal()),
			ft: Math.round(36 + 11 * rng.normal()),
			fg: Math.round(36 + 11 * rng.normal()),
		},
	};
};

describe("draft combine", () => {
	test("deterministic per prospect and season, never touches Math.random", () => {
		let calls = 0;
		Math.random = () => {
			calls += 1;
			return realRandom();
		};
		const input = prospect(12, new Rng("x"));
		const a = generateDraftCombine(input);
		const b = generateDraftCombine(structuredClone(input));
		assert.deepEqual(a, b);
		// Another season (a prospect who went back to school) is another combine
		const c = generateDraftCombine({ ...input, season: 2031 });
		assert.notDeepEqual(a.measurements, c.measurements);
		// Another pid too
		const d = generateDraftCombine({ ...input, pid: 13 });
		assert.notDeepEqual(a.measurements, d.measurements);
		assert.strictEqual(calls, 0);
	});

	test("skipping the drills doesn't change the measurements", () => {
		const input = prospect(5, new Rng("y"));
		const healthy = generateDraftCombine({ ...input, rank: 100 });
		const injured = generateDraftCombine({ ...input, injured: true });
		assert.deepEqual(healthy.measurements, injured.measurements);
	});

	test("top prospects and injured players skip the drills more often", () => {
		assert.isAbove(skipDrillsChance(1, false), skipDrillsChance(10, false));
		assert.isAbove(skipDrillsChance(10, false), skipDrillsChance(50, false));
		assert.isAbove(skipDrillsChance(50, true), skipDrillsChance(1, false));
		const rng = new Rng("skip");
		let topSkips = 0;
		let restSkips = 0;
		let injuredSkips = 0;
		for (let pid = 0; pid < 3000; pid++) {
			const input = prospect(pid, rng);
			if (!generateDraftCombine({ ...input, rank: 2 }).drills) {
				topSkips += 1;
			}
			if (!generateDraftCombine({ ...input, rank: 50 }).drills) {
				restSkips += 1;
			}
			const inj = generateDraftCombine({ ...input, injured: true });
			if (!inj.drills) {
				injuredSkips += 1;
				assert.strictEqual(inj.skipped, "injured");
			}
		}
		assert.isAbove(topSkips, 3 * restSkips);
		assert.isAbove(injuredSkips, topSkips);
		assert.strictEqual(numCombineInvites(60), 75);
	});

	test("ranks and percentiles, lower is better for timed drills", () => {
		const rng = new Rng("ranks");
		const results = Array.from({ length: 40 }, (_, pid) =>
			generateDraftCombine({ ...prospect(pid, rng), rank: 100 }),
		);
		const ranks = combineRanks(results);
		const fastest = results.reduce((a, b) =>
			a.drills!.laneAgility <= b.drills!.laneAgility ? a : b,
		);
		assert.strictEqual(ranks.get(fastest.pid)!.laneAgility!.rank, 1);
		assert.isAtLeast(ranks.get(fastest.pid)!.laneAgility!.pct, 95);
		const notes = combineScoutNotes(fastest, ranks.get(fastest.pid));
		assert.match(notes[0]!, /^Measured .* wingspan/);
		assert.isTrue(notes.some((x) => /lane agility/i.test(x)));
	});

	test("performance is about N(0, 1) and the AI nudge averages zero over the class, bounded", () => {
		const rng = new Rng("nudge");
		const results = new Map<number, DraftCombineResult>();
		const pids: number[] = [];
		const perfs: number[] = [];
		for (let pid = 0; pid < 2000; pid++) {
			pids.push(pid);
			// Some uninvited (no result) and some skippers
			if (pid % 10 === 0) {
				continue;
			}
			const res = generateDraftCombine({ ...prospect(pid, rng), rank: 60 });
			results.set(pid, res);
			if (res.drills) {
				perfs.push(res.performance);
			}
		}
		const mean = perfs.reduce((a, b) => a + b, 0) / perfs.length;
		const sd = Math.sqrt(
			perfs.reduce((a, b) => a + (b - mean) ** 2, 0) / perfs.length,
		);
		assert.isBelow(Math.abs(mean), 0.1);
		assert.isAbove(sd, 0.8);
		assert.isBelow(sd, 1.2);

		// Classes of 75: the nudge sums to zero in each
		for (let start = 0; start < 2000; start += 75) {
			const cls = pids.slice(start, start + 75);
			const nudges = combineNudges(cls, results);
			let sum = 0;
			let moved = 0;
			for (const x of nudges.values()) {
				sum += x;
				assert.isAtMost(Math.abs(x), COMBINE_NUDGE_MAX + 0.2);
				if (Math.abs(x) > 0.05) {
					moved += 1;
				}
			}
			assert.isBelow(Math.abs(sum), 1e-9);
			// Only the big over/under-performers move noticeably
			assert.isBelow(moved, cls.length / 2);
		}
	});
});

describe("lottery night", () => {
	// Pre-lottery order: index 0 is the worst team
	const result = [
		{ tid: 10, originalTid: 10, pick: 3 },
		{ tid: 11, originalTid: 11, pick: 1 },
		{ tid: 12, originalTid: 12, pick: 4 },
		{ tid: 13, originalTid: 13, pick: 2 },
		{ tid: 14, originalTid: 14, pick: 5 },
	];
	const probs = result.map((_, i) =>
		result.map((_, j) => (i === j ? 0.4 : 0.15)),
	);

	test("reveal order: last lottery pick first, No. 1 last", () => {
		const order = lotteryRevealOrder(result);
		assert.deepEqual(
			order.map((i) => result[i]!.pick),
			[5, 4, 3, 2, 1],
		);
		assert.deepEqual(order, [4, 2, 0, 3, 1]);
		// The order doesn't depend on anything but the saved picks, and draws nothing
		let calls = 0;
		Math.random = () => {
			calls += 1;
			return realRandom();
		};
		lotteryRevealOrder(result);
		const rows = getLotteryNightRows(result, probs);
		lotteryRecap(rows, (tid) => `T${tid}`);
		for (const row of rows) {
			lotteryReaction({ row, team: { hype: 0.7 }, season: 2030, user: false });
		}
		assert.strictEqual(calls, 0);
	});

	test("jumps, falls and odds going in", () => {
		const rows = getLotteryNightRows(result, probs);
		const byTid = new Map(rows.map((r) => [r.tid, r]));
		assert.strictEqual(byTid.get(11)!.move, 1);
		assert.strictEqual(moveText(byTid.get(13)!), "Moved up from 4th!");
		assert.strictEqual(moveText(byTid.get(10)!), "Fell from 1st");
		assert.strictEqual(moveText(byTid.get(14)!), "Stayed at 5th");
		assert.strictEqual(byTid.get(13)!.oddsPick, 0.15);
		assert.strictEqual(byTid.get(13)!.oddsFirst, 0.15);
		assert.strictEqual(byTid.get(10)!.oddsFirst, 0.4);

		const recap = lotteryRecap(rows, (tid) => `T${tid}`);
		assert.deepEqual(
			recap.winners.map((r) => r.tid),
			[13, 11],
		);
		assert.deepEqual(
			recap.losers.map((r) => r.tid),
			[10, 12],
		);
		assert.match(recap.summary, /T11 jumped from 2nd to win the No. 1 pick/);
		assert.match(recap.summary, /T10 had the worst night/);
	});

	test("reactions are deterministic and use the GM when there is one", () => {
		const rows = getLotteryNightRows(result, probs);
		const first = rows.find((r) => r.pick === 1)!;
		const a = lotteryReaction({
			row: first,
			team: { hype: 0.2 },
			season: 2030,
			user: false,
		});
		const b = lotteryReaction({
			row: first,
			team: { hype: 0.2 },
			season: 2030,
			user: false,
		});
		assert.strictEqual(a, b);
		const gm = lotteryReaction({
			row: first,
			team: { gm: { name: "Pat Riley", patience: 0.8, draftUpside: 0 } },
			season: 2030,
			user: false,
		});
		assert.include(gm, "Pat Riley");
	});
});

describe("combine and scouting reports", () => {
	const ratings = (x: Partial<ScoutRatings> = {}): ScoutRatings => ({
		hgt: 50,
		stre: 50,
		spd: 50,
		jmp: 50,
		endu: 50,
		ins: 50,
		dnk: 50,
		ft: 50,
		fg: 50,
		tp: 50,
		oiq: 50,
		diq: 50,
		drb: 50,
		pss: 50,
		reb: 50,
		ovr: 50,
		pot: 55,
		...x,
	});
	const input = (x: Partial<ScoutInput> = {}): ScoutInput => ({
		pid: 7,
		name: "Test Player",
		kind: "prospect",
		pos: "SF",
		age: 19,
		heightInches: 79,
		weight: 210,
		season: 2030,
		ratings: ratings({ ovr: 46, pot: 60 }),
		proSeasons: 0,
		injuries: [],
		uncertainty: 8,
		draft: { year: 2030, round: 0, pick: 0 },
		numPicks: 60,
		salaryCap: 140000,
		awards: { allStar: 0, allLeague: 0, mvp: 0, dpoy: 0, champ: 0, roy: 0 },
		expandedRatings: false,
		comps: [],
		roleScale: {
			franchise: 70,
			allStar: 62,
			qualityStarter: 57,
			starter: 52,
			rotation: 47,
			bench: 42,
		},
		onUserTeam: false,
		...x,
	});
	const peers = () => {
		const rows = [];
		for (let i = 0; i < 60; i++) {
			const v = 30 + i;
			rows.push(
				categoryScores({
					ratings: ratings({
						tp: v,
						fg: v,
						ft: v,
						spd: v,
						jmp: v,
						hgt: v,
						stre: v,
						endu: v,
					}),
					production: undefined,
					group: "wing",
				}),
			);
		}
		return buildPeerTable("test class", rows, "wing");
	};
	const dept = getDepartment({
		leagueSeed: "seed",
		tid: 0,
		season: 2030,
		level: 50,
		startingSeason: 2025,
	});

	test("measured size and tested athleticism narrow those grade ranges and add Combine lines", () => {
		const width = (r: ReturnType<typeof buildReport>, key: string) => {
			const g = r.grades.find((x) => x.key === key)!;
			return g.hi - g.lo;
		};
		let narrower = 0;
		for (const pid of [1, 2, 3, 4, 5, 6, 7, 8]) {
			const before = buildReport({
				input: input({ pid }),
				peers: peers(),
				dept,
				numTeams: 30,
			});
			const after = buildReport({
				input: input({
					pid,
					combineTested: { size: true, ath: true },
					combineNotes: ["Measured 6'7\" without shoes, 7'1\" wingspan"],
				}),
				peers: peers(),
				dept,
				numTeams: 30,
			});
			for (const key of ["size", "ath"]) {
				assert.isAtMost(width(after, key), width(before, key));
				if (width(after, key) < width(before, key)) {
					narrower += 1;
				}
			}
			// Other grades are untouched
			assert.strictEqual(width(after, "iq"), width(before, "iq"));
			assert.isTrue(
				after.physical.some((x) => x.startsWith("Combine: Measured")),
			);
		}
		assert.isAbove(narrower, 8);
	});
});
