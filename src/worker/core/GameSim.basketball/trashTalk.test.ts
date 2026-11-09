import { assert, test } from "vitest";
import {
	makeLiveBoxScore,
	playLive,
	simulateGame,
	type Line,
} from "./simLiveGameForTests.ts";
import {
	TrashTalk,
	trashTalkHeat,
	trashTalkTemplatesForTests,
} from "../../../common/pbpFlavor/trashTalk.ts";

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
