import { assert, test, vi } from "vitest";

// (whole simulated games: slow when the machine is busy)
vi.setConfig({ testTimeout: 120_000 });
import {
	describeGame,
	makeLiveBoxScore,
	playLive,
	simulateGame,
	type Line,
} from "./simLiveGameForTests.ts";
import {
	TRASH_TALK_RATES,
	TrashTalk,
	rivalryLevelOfTier,
	trashTalkContextMult,
	trashTalkHeat,
	trashTalkTemplatesForTests,
} from "../../../common/pbpFlavor/trashTalk.ts";
import { makeCareer } from "../../../common/pbpFlavor/career.ts";
import { rivalryTier } from "../../../common/rivalries/index.ts";
import { makeSeededRandom } from "../../../common/random.ts";

/*
 * Trash talk in the play-by-play text (common/pbpFlavor/trashTalk.ts), driven by the Temper trait. Cosmetic only: the sim's events are made
 * once, then worded with different tempers; the game itself can't change, and the rest of the wording doesn't either.
 */

const escape = (s: string) =>
	s.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
const TRASH = trashTalkTemplatesForTests().map(
	(t) =>
		new RegExp(
			escape(t).replaceAll("\u0001", "(.+?)").replaceAll("\u0002", "(.+?)"),
		),
);
const trashLines = (lines: Line[]) =>
	lines.flatMap((l) =>
		[l.text, l.note].filter((s) => TRASH.some((re) => re.test(s))),
	);

const games: Awaited<ReturnType<typeof simulateGame>>[] = [];
for (const seed of [21, 22, 23, 24, 25, 26]) {
	games.push(await simulateGame(seed));
}

// Word a game with every player's temper set to this (undefined = traits off)
const word = (
	game: (typeof games)[number],
	temper: number | undefined,
	playoffs = false,
) => {
	const events = structuredClone(game.events);
	for (const team of events[0].boxScore) {
		for (const p of team.player) {
			if (temper !== undefined) {
				p.pbpRatings = { ...p.pbpRatings, temper };
			}
		}
	}
	const box: any = makeLiveBoxScore(game.result, game.seed);
	box.playoffs = playoffs;
	return playLive(events, box);
};

test("only hotheads talk: an even-keeled or average temper reads exactly like no traits", () => {
	assert.strictEqual(trashTalkHeat(50), 0);
	assert.strictEqual(trashTalkHeat(45), 0);
	assert.isAbove(trashTalkHeat(20), trashTalkHeat(40));
	for (const game of games.slice(0, 3)) {
		const off = word(game, undefined);
		assert.deepStrictEqual(word(game, 50), off);
		assert.deepStrictEqual(word(game, 90), off);
		assert.strictEqual(trashLines(off).length, 0);
	}
});

test("it only adds notes and lead-ins: everything else reads the same", () => {
	for (const game of games.slice(0, 3)) {
		const off = word(game, undefined);
		const hot = word(game, 5, true);
		assert.strictEqual(hot.length, off.length);
		for (const [i, line] of hot.entries()) {
			assert.isTrue(
				line.text.endsWith(off[i]!.text),
				`${line.text} / ${off[i]!.text}`,
			);
			assert.isTrue(line.note.startsWith(off[i]!.note));
			assert.deepStrictEqual(line.score, off[i]!.score);
		}
	}
});

test("frequency scales with temper and context, without repeating itself", () => {
	const count = (temper: number, playoffs = false) => {
		let n = 0;
		for (const game of games) {
			const lines = trashLines(word(game, temper, playoffs));
			n += lines.length;
			// No line twice in a game
			assert.strictEqual(new Set(lines).size, lines.length);
		}
		return n;
	};
	const mild = count(38);
	const hot = count(5);
	const hotPlayoffs = count(5, true);
	console.log(
		`trash talk lines in ${games.length} games: temper 38 ${mild}, temper 5 ${hot}, temper 5 in the playoffs ${hotPlayoffs}`,
	);
	assert.isAbove(hot, mild);
	assert.isAbove(hot, games.length);
	assert.isAbove(hotPlayoffs, hot);
	// Occasional, not every play
	assert.isBelow(hotPlayoffs / games.length, 25);
});

test("technicals get a lead-in for players who have been talking, never for calm players", () => {
	const mk = (pid: number, t: 0 | 1) => ({
		pid,
		name: `Player ${pid}`,
		pos: "G",
		t,
		R: {} as any,
	});
	const tt = new TrashTalk(
		5,
		new Map([
			[1, 5],
			[2, 70],
			[3, 35],
		]),
	);
	assert.isUndefined(tt.techLeadIn(1, mk(2, 1)));
	// A mild hothead who hasn't said anything: nothing
	assert.isUndefined(tt.techLeadIn(2, mk(3, 0)));
	// A real hothead: always something
	assert.include(tt.techLeadIn(3, mk(1, 0)) ?? "", "Player 1");
	// Once he has been talking, the lead-in says so
	let said: string | undefined;
	for (let idx = 100; idx < 1000 && !said; idx += 10) {
		said = tt.bigPlay(idx, "three", mk(3, 0), mk(2, 1), { playoffs: true });
	}
	assert.isDefined(said);
	assert.include(tt.techLeadIn(2000, mk(3, 0)) ?? "", "Player 3");
	// Calm players never talk, whatever the context
	for (let idx = 3000; idx < 4000; idx += 10) {
		assert.isUndefined(
			tt.bigPlay(idx, "dunk", mk(2, 1), mk(3, 0), {
				playoffs: true,
				rivalry: true,
				close: true,
				late: true,
				run: 12,
			}),
		);
	}
});

// The game's events with a few hotheads on each team (every third player), the rest calm, and a rivalry level
const mixed = (
	game: (typeof games)[number],
	rivalry: number,
	temper: (i: number) => number = (i) => (i % 3 === 0 ? 12 : 70),
) => {
	const events = structuredClone(game.events);
	const tempers = new Map<number, number>();
	if (rivalry > 0) {
		events[0].boxScore[0].pbpRivalry = rivalry;
	}
	for (const team of events[0].boxScore) {
		for (const [i, p] of team.player.entries()) {
			p.pbpRatings = { ...p.pbpRatings, temper: temper(i) };
			p.pbpCareer = makeCareer({ complete: false, age: 22 + ((i * 5) % 14) });
			tempers.set(p.id, temper(i));
		}
	}
	return { events, tempers };
};

test("a heated rivalry means more trash talk, a bitter one more still; in an ordinary game it is rare", () => {
	assert.strictEqual(rivalryLevelOfTier(rivalryTier(45)), 2);
	assert.strictEqual(rivalryLevelOfTier(rivalryTier(25)), 1);
	assert.strictEqual(rivalryLevelOfTier(rivalryTier(15)), 0);
	assert.strictEqual(rivalryLevelOfTier(rivalryTier(0)), 0);
	assert.isAbove(
		trashTalkContextMult({ rivalry: 2 }),
		trashTalkContextMult({ rivalry: 1 }),
	);
	assert.strictEqual(
		trashTalkContextMult({ rivalry: 1 }),
		trashTalkContextMult({ rivalry: true }),
	);
	assert.isAbove(trashTalkContextMult({ rivalry: true }), 1);
	assert.strictEqual(trashTalkContextMult({ rivalry: 0 }), 1);

	const count = (
		rivalry: number,
		playoffs = false,
		temper?: (i: number) => number,
	) => {
		let n = 0;
		for (const game of games) {
			const { events } = mixed(game, rivalry, temper);
			const { session } = describeGame(game.seed, events[0], events, {
				playoffs,
			});
			n += session.debugLog().trash.length;
		}
		return n;
	};
	const none = count(0);
	const heated = count(1);
	const bitter = count(2);
	const bitterPlayoffs = count(2, true);
	// A league-like spread of tempers (bell-shaped around 50: about a third of the players are hotheads of some degree, few of them real ones)
	const bell = (i: number) => {
		const r = makeSeededRandom(1000 + i);
		return Math.round(50 + 15 * (r() + r() + r() + r() - 2) * 1.73);
	};
	const ordinary = count(0, false, bell);
	const ordinaryBitter = count(2, false, bell);
	console.log(
		`trash talk moments in ${games.length} games, four hotheads a team: no rivalry ${none}, heated ${heated}, bitter ${bitter}, bitter in the playoffs ${bitterPlayoffs}; a league-like spread of tempers: ${ordinary}, in a bitter rivalry ${ordinaryBitter}`,
	);
	assert.isAbove(heated, none);
	assert.isAbove(bitter, heated);
	assert.isAbove(bitterPlayoffs, bitter);
	// Rare in an ordinary game: a couple of moments at most on average
	assert.isBelow(ordinary / games.length, 3);
	assert.isAbove(ordinaryBitter, ordinary);
	// And never a flood, even at its worst
	assert.isAtMost(
		bitterPlayoffs / games.length,
		TRASH_TALK_RATES.perGame + 4 + 6 + 6,
	);
});

test("calm players never start anything: every instigator is a hothead, and the one who steps in is calm", () => {
	const kinds: Record<string, number> = {};
	for (const game of games) {
		for (const rivalry of [0, 2]) {
			const { events, tempers } = mixed(game, rivalry);
			const { session, out } = describeGame(game.seed, events[0], events, {
				playoffs: rivalry > 0,
			});
			const seen = new Set<string>();
			for (const entry of session.debugLog().trash) {
				kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
				const temper = tempers.get(entry.pid)!;
				if (entry.kind === "calm") {
					assert.isAtLeast(temper, 58, entry.kind);
					// (the man he walks away is the hothead)
					assert.isBelow(tempers.get(entry.other!)!, 45);
				} else if (entry.kind === "answer") {
					// (answering with a shot: the man who talked first was the hothead)
					assert.isBelow(tempers.get(entry.other!)!, 45);
				} else {
					assert.isBelow(temper, 45, entry.kind);
				}
				if (entry.kind === "feud" || entry.kind === "jawingBoth") {
					assert.isBelow(tempers.get(entry.other!)!, 45, entry.kind);
				}
			}
			// No trash talk line twice in a game
			for (const line of trashLines(
				out.map((o) => ({ text: o.r.text, note: o.r.note ?? "" }) as Line),
			)) {
				assert.isFalse(seen.has(line), line);
				seen.add(line);
			}
		}
	}
	console.log("trash talk by kind:", kinds);
	// An all-calm game says nothing at all
	const { events } = mixed(games[0]!, 2, () => 60);
	const { session } = describeGame(games[0]!.seed, events[0], events, {
		playoffs: true,
	});
	assert.strictEqual(session.debugLog().trash.length, 0);
});

const mk = (pid: number, t: 0 | 1) => ({
	pid,
	name: `Player ${pid}`,
	pos: "G",
	t,
	R: {} as any,
});
const HOT = { playoffs: true, rivalry: 2, close: true, late: true, run: 12 };
// Call fn at one position after another until it says something
const until = (fn: (idx: number) => string | undefined, from = 100) => {
	for (let idx = from; idx < from + 20_000; idx += 10) {
		const said = fn(idx);
		if (said) {
			return { said, idx };
		}
	}
	return { said: undefined, idx: from + 20_000 };
};

test("a feud: two hotheads who have had words keep going at each other, and it shows in the wording", () => {
	const tt = new TrashTalk(
		9,
		new Map([
			[1, 5],
			[2, 5],
			[3, 70],
		]),
	);
	const a = mk(1, 0);
	const b = mk(2, 1);
	assert.strictEqual(tt.feudCount(1, 2), 0);
	const first = until((idx) => tt.bigPlay(idx, "dunk", a, b, HOT));
	assert.isDefined(first.said);
	assert.strictEqual(tt.feudCount(1, 2), 1);
	// The next time, with a choice of targets, he goes looking for the same man
	const again = until(
		(idx) => tt.bigPlay(idx, "three", b, [mk(3, 0), a], HOT),
		first.idx + 100,
	);
	assert.include(again.said, "Player 1");
	assert.notInclude(again.said, "Player 3");
	assert.strictEqual(tt.log.at(-1)!.kind, "feud");
	assert.strictEqual(tt.feudCount(1, 2), 2);
	// A calm player is never part of a feud
	const calm = until(
		(idx) => tt.bigPlay(idx, "block", a, mk(3, 1), HOT),
		again.idx + 100,
	);
	assert.isDefined(calm.said);
	assert.strictEqual(tt.feudCount(1, 3), 0);
});

test("the player who was talked at can answer with a shot; nobody else can, and only once", () => {
	const tt = new TrashTalk(
		11,
		new Map([
			[1, 5],
			[2, 80],
			[4, 80],
		]),
	);
	const talker = mk(1, 0);
	const target = mk(2, 1);
	const first = until((idx) => tt.bigPlay(idx, "three", talker, target, HOT));
	assert.include(first.said, "Player 2");
	// Someone else scoring is not an answer
	assert.isUndefined(tt.answer(first.idx + 5, mk(4, 1), HOT));
	// Too long after: no answer
	const late = new TrashTalk(11, new Map([[1, 5]]));
	const l = until((idx) => late.bigPlay(idx, "three", talker, target, HOT));
	assert.isUndefined(
		late.answer(l.idx + TRASH_TALK_RATES.answerWindow + 1, target, HOT),
	);
	// The calm player answers (some of the time: the chance is not 1), and then not again
	let answered: string | undefined;
	for (let seed = 1; seed < 40 && !answered; seed++) {
		const t2 = new TrashTalk(seed, new Map([[1, 5]]));
		const f = until((idx) => t2.bigPlay(idx, "three", talker, target, HOT));
		answered = t2.answer(f.idx + 4, target, HOT);
		if (answered) {
			assert.include(answered, "Player 2");
			assert.include(answered, "Player 1");
			assert.strictEqual(t2.log.at(-1)!.kind, "answer");
			assert.isUndefined(t2.answer(f.idx + 8, target, HOT));
		}
	}
	assert.isDefined(answered);
});

test("a steal turned into a basket, the bench, the crowd, a calm teammate, technicals on both sides", () => {
	const tempers = new Map([
		[1, 5],
		[2, 5],
		[3, 75],
		[4, 62],
		[5, 50],
	]);
	const ages = new Map([
		[3, 34],
		[4, 23],
	]);
	const hot0 = mk(1, 0);
	const hot1 = mk(2, 1);

	// A steal he scores from, within a few events
	const tt = new TrashTalk(3, tempers, ages);
	tt.noteSteal(50, 1, 2);
	assert.strictEqual(tt.stealVictim(53, 1), 2);
	assert.isUndefined(tt.stealVictim(53, 2));
	assert.isUndefined(tt.stealVictim(50 + TRASH_TALK_RATES.stealWindow + 1, 1));
	const steal = until((idx) => tt.bigPlay(idx, "stealScore", hot0, hot1, HOT));
	assert.include(steal.said, "Player 1");

	// Talking at the other bench: only a hothead on the floor
	assert.isUndefined(
		new TrashTalk(3, tempers).benchTalk(100, [mk(3, 0), mk(4, 0)], HOT),
	);
	const bench = until((idx) =>
		new TrashTalk(3, tempers).benchTalk(idx, [mk(3, 0), hot0], HOT),
	);
	assert.include(bench.said, "Player 1");
	assert.notInclude(bench.said, "Player 3");

	// The crowd: only on a visitor who has been talking
	const c = new TrashTalk(4, tempers);
	assert.isUndefined(until((idx) => c.crowd(idx, hot1, HOT), 100).said);
	const talked = until((idx) => c.bigPlay(idx, "dunk", hot1, hot0, HOT));
	const home = until(
		(idx) => c.bigPlay(idx, "dunk", hot0, hot1, HOT),
		talked.idx + 50,
	);
	// (the home player talked too, but the home crowd doesn't get on him)
	assert.isUndefined(
		until((idx) => c.crowd(idx, hot0, HOT), home.idx + 50).said,
	);
	const crowd = until((idx) => c.crowd(idx, hot1, HOT), home.idx + 50);
	assert.include(crowd.said, "Player 2");
	// Once a player
	assert.isUndefined(
		until((idx) => c.crowd(idx, hot1, HOT), crowd.idx + 50).said,
	);

	// A calm teammate steps in: the veteran when his age says so, never an average or hot-headed teammate
	const v = until((idx) =>
		new TrashTalk(5, tempers, ages).calm(idx, hot0, [
			hot0,
			mk(5, 0),
			mk(4, 0),
			mk(3, 0),
		]),
	);
	assert.match(v.said ?? "", /^(The veteran )?Player 3|veteran Player 3/);
	assert.match(v.said ?? "", /veteran|experience|seen this before/);
	const young = until((idx) =>
		new TrashTalk(5, tempers, ages).calm(idx, hot0, [hot0, mk(5, 0), mk(4, 0)]),
	);
	assert.include(young.said, "Player 4");
	assert.notMatch(young.said ?? "", /veteran|experience|seen this before/);
	// (no ages known: never "the veteran")
	const unknown = until((idx) =>
		new TrashTalk(5, tempers).calm(idx, hot0, [hot0, mk(3, 0)]),
	);
	assert.include(unknown.said, "Player 3");
	assert.notMatch(unknown.said ?? "", /veteran|experience|seen this before/);
	assert.isUndefined(
		until((idx) =>
			new TrashTalk(5, tempers, ages).calm(idx, hot0, [hot0, mk(5, 0)]),
		).said,
	);

	// A technical on each side within a few possessions: the second one reads as the game boiling over. Never for a calm player
	const both = new TrashTalk(6, tempers);
	assert.match(both.techLeadIn(100, hot0) ?? "", /Player 1/);
	const second = both.techLeadIn(120, hot1);
	assert.match(second ?? "", /Player 2/);
	assert.strictEqual(both.log.at(-1)!.kind, "techBoth");
	const far = new TrashTalk(6, tempers);
	far.techLeadIn(100, hot0);
	far.techLeadIn(100 + TRASH_TALK_RATES.techWindow + 50, hot1);
	assert.strictEqual(far.log.at(-1)!.kind, "tech");
	const calm = new TrashTalk(6, tempers);
	calm.techLeadIn(100, hot0);
	assert.isUndefined(calm.techLeadIn(110, mk(3, 1)));
	// Two technicals on the same side are not "both sides"
	const same = new TrashTalk(
		6,
		new Map([
			[1, 5],
			[6, 5],
		]),
	);
	same.techLeadIn(100, hot0);
	same.techLeadIn(110, mk(6, 0));
	assert.strictEqual(same.log.at(-1)!.kind, "tech");
});

test("every line is clean and fills in", () => {
	const all = trashTalkTemplatesForTests();
	assert.isAbove(all.length, 120);
	assert.strictEqual(new Set(all).size, all.length);
	for (const t of all) {
		assert.notMatch(t, /undefined|NaN|\${|null/);
		assert.include(t, "\u0001");
		assert.notMatch(
			t,
			/\b(damn|hell|ass|crap|shit|fuck|bitch|bastard|stupid|idiot|sucks?|trash|bum)\b/i,
		);
	}
});
