import { assert, test } from "vitest";
import {
	CAREER_RULES,
	makeCareer,
	parseCareer,
	type CareerStat,
} from "../../../common/pbpFlavor/career.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { describeGame, simulateGame } from "./simLiveGameForTests.ts";

/*
 * Career-high and milestone calls in real simulated games (common/pbpFlavor/career.ts): the sim's events are made once, then worded with
 * made-up careers for the players. Every call is checked against the box score at that moment and the career it was given; a game with
 * no career numbers reads the same minus the calls; and nothing is left unfilled.
 */

const games: Awaited<ReturnType<typeof simulateGame>>[] = [];
for (const seed of [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]) {
	games.push(await simulateGame(seed));
}

// The game's events with a career for every player: some well short of their bests, some on the verge of something, some with a past
// that isn't on record, some with no numbers at all
const withCareers = (game: (typeof games)[number], playoffs = false) => {
	const events = structuredClone(game.events);
	const random = makeSeededRandom(game.seed * 977);
	const int = (lo: number, hi: number) =>
		lo + Math.floor(random() * (hi - lo + 1));
	events[0].boxScore[0].pbpRivalry = game.seed % 3;
	for (const team of events[0].boxScore) {
		for (const [i, p] of team.player.entries()) {
			p.pbpRatings = { ...p.pbpRatings, temper: i % 3 === 0 ? 10 : 70 };
			const kind = int(0, 9);
			if (kind === 0) {
				delete p.pbpCareer;
				continue;
			}
			if (kind === 1) {
				// A rookie in his first game
				p.pbpCareer = makeCareer({
					rookie: true,
					gp: 0,
					gpSeason: 0,
					td: 0,
					age: 20,
					high: { pts: 0, trb: 0, ast: 0, tp: 0, blk: 0, stl: 0 },
					seasonHigh: { pts: 0, trb: 0, ast: 0, tp: 0, blk: 0, stl: 0 },
					total: { pts: 0, trb: 0, ast: 0, tp: 0 },
				});
				continue;
			}
			const high = {
				pts: int(8, 30),
				trb: int(4, 14),
				ast: int(3, 12),
				tp: int(1, 6),
				blk: int(1, 5),
				stl: int(1, 5),
			};
			const seasonHigh = Object.fromEntries(
				Object.entries(high).map(([k, v]) => [k, Math.max(0, v - int(0, 6))]),
			);
			p.pbpCareer = makeCareer({
				// (a past that isn't on record)
				complete: kind !== 2,
				gp: kind === 3 ? int(0, 25) : int(100, 900),
				gpSeason: int(0, 60),
				td: int(0, 1),
				age: int(20, 36),
				high: kind === 4 ? {} : high,
				seasonHigh: kind === 4 ? {} : seasonHigh,
				total:
					kind === 5
						? {}
						: {
								pts: 5000 * int(1, 5) - int(1, 25),
								trb: 2500 * int(1, 3) - int(1, 12),
								ast: 2500 * int(1, 3) - int(1, 10),
								tp: 500 * int(1, 4) - int(1, 4),
							},
			});
		}
	}
	return { events, playoffs };
};

const players = (events: any[]) =>
	events[0].boxScore.flatMap((team: any) => team.player) as any[];

const BAD = /undefined|NaN|\${|\[object|\bnull\b| {2}/;
const PLACEHOLDERS = ["\u0001", "\u0002", "\u0003"];

test("every career call made in a game is true at that moment", () => {
	const counts: Record<string, number> = {};
	for (const game of games) {
		for (const playoffs of [false, true]) {
			const { events } = withCareers(game, playoffs);
			const careers = new Map(
				players(events).map((p) => [p.id, parseCareer(p.pbpCareer)]),
			);
			const names = new Map(players(events).map((p) => [p.id, p.name]));
			const { out, session } = describeGame(game.seed, events[0], events, {
				playoffs,
			});
			const byIdx = new Map(out.map((o) => [o.idx, o]));
			for (const call of session.debugLog().career) {
				counts[call.kind] = (counts[call.kind] ?? 0) + 1;
				const c = careers.get(call.pid)!;
				const o = byIdx.get(call.idx)!;
				const where = `seed ${game.seed} ${call.kind} ${call.stat} ${o?.r.note}`;
				assert.isDefined(c, where);
				assert.isDefined(o, where);
				assert.include(o.r.note, names.get(call.pid)!, where);
				assert.notMatch(`${o.r.text} ${o.r.note}`, BAD);
				const st = o.box.get(call.pid)!;
				const now = (stat: CareerStat) =>
					stat === "tp" ? (st.tp ?? 0) : (st as any)[stat];
				const stat = call.stat!;
				const late = o.period >= 4;
				if (call.kind === "new") {
					assert.isTrue(c.complete && c.gp >= CAREER_RULES.minGp, where);
					assert.strictEqual(now(stat), call.value, where);
					assert.isAbove(now(stat), c.high[stat]!, where);
					assert.include(o.r.note, `${call.value} `, where);
				} else if (call.kind === "tie") {
					assert.isTrue(c.complete && c.gp >= CAREER_RULES.minGp, where);
					assert.strictEqual(now(stat), c.high[stat], where);
					assert.isTrue(late, where);
				} else if (call.kind === "away") {
					assert.isTrue(c.complete && late, where);
					assert.strictEqual(c.high.pts! - st.pts, call.value, where);
					assert.isTrue(call.value! >= 1 && call.value! <= 4, where);
					assert.include(o.r.note, String(c.high.pts), where);
				} else if (call.kind === "seasonNew" || call.kind === "seasonTie") {
					assert.isAtLeast(c.gpSeason, CAREER_RULES.minGpSeason, where);
					assert.strictEqual(now(stat), call.value, where);
					if (call.kind === "seasonNew") {
						assert.isAbove(now(stat), c.seasonHigh[stat]!, where);
					} else {
						assert.strictEqual(now(stat), c.seasonHigh[stat], where);
					}
					// (not also a career high: that would have been the call)
					if (c.complete && c.gp >= CAREER_RULES.minGp) {
						const high = c.high[stat];
						assert.isTrue(high === undefined || now(stat) <= high, where);
					}
					assert.match(o.r.note!, /season/, where);
				} else if (call.kind === "milestone") {
					assert.isFalse(playoffs, where);
					const total = (c.total as any)[stat] + now(stat);
					assert.isAtLeast(total, call.value!, where);
					// (reached on this play: at most a three-pointer ago)
					assert.isBelow(total - 3, call.value!, where);
					assert.include(o.r.note, call.value!.toLocaleString("en-US"), where);
				} else if (call.kind === "first") {
					assert.isTrue(c.complete && (c.gp === 0 || c.high.pts === 0), where);
					assert.isTrue(st.pts >= 1 && st.pts <= 3, where);
				} else if (call.kind === "firstTd") {
					assert.isTrue(c.complete && c.td === 0, where);
					const tens = [st.pts, st.trb, st.ast, st.stl, st.blk].filter(
						(x) => x >= 10,
					).length;
					assert.isAtLeast(tens, 3, where);
				}
			}
		}
	}
	console.log(`career calls in ${games.length * 2} games:`, counts);
	// The constructed careers make each of the common calls happen
	for (const kind of ["new", "seasonNew", "milestone", "first"]) {
		assert.isAbove(counts[kind] ?? 0, 3, kind);
	}
});

test("a game with no career numbers reads the same, minus the calls", () => {
	for (const game of games.slice(0, 4)) {
		const { events } = withCareers(game);
		// (no calm players: who steps in to calm a hothead down, and whether he is called a veteran, depends on the ages that come with the
		// career numbers)
		for (const p of players(events)) {
			p.pbpRatings.temper = 10;
		}
		const bare = structuredClone(events);
		for (const p of players(bare)) {
			delete p.pbpCareer;
		}
		const a = describeGame(game.seed, events[0], events);
		const b = describeGame(game.seed, bare[0], bare);
		assert.isAbove(a.session.debugLog().career.length, 0);
		assert.strictEqual(b.session.debugLog().career.length, 0);
		assert.strictEqual(a.out.length, b.out.length);
		const called = new Set(a.session.debugLog().career.map((c) => c.idx));
		for (const [i, x] of a.out.entries()) {
			const y = b.out[i]!;
			assert.strictEqual(x.r.text, y.r.text);
			if (called.has(x.idx)) {
				assert.isTrue((x.r.note ?? "").startsWith(y.r.note ?? ""));
				assert.isAbove((x.r.note ?? "").length, (y.r.note ?? "").length);
			} else {
				assert.strictEqual(x.r.note, y.r.note);
			}
		}
	}
});

test("the same game reads the same every time, with nothing left unfilled", () => {
	let lines = 0;
	for (const game of games) {
		const { events } = withCareers(game, game.seed % 2 === 0);
		const context = { playoffs: game.seed % 2 === 0 };
		const a = describeGame(game.seed, events[0], events, context);
		const b = describeGame(
			game.seed,
			events[0],
			structuredClone(events),
			context,
		);
		assert.deepStrictEqual(
			a.out.map((o) => o.r),
			b.out.map((o) => o.r),
		);
		assert.deepStrictEqual(a.session.debugLog(), b.session.debugLog());
		for (const o of a.out) {
			lines += 1;
			const line = `${o.r.text} | ${o.r.note ?? ""}`;
			assert.notMatch(line, BAD, `seed ${game.seed}`);
			assert.isFalse(PLACEHOLDERS.some((c) => line.includes(c)));
			assert.isTrue(o.r.text.length > 0 || !!o.r.keepText);
		}
	}
	assert.isAbove(lines, 4000);
});
