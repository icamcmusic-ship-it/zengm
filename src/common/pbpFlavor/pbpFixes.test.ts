import { assert, test } from "vitest";
import {
	FlavorSession,
	type FlavorHost,
	type FlavorResult,
	type FlavorStat,
} from "./session.ts";
import { GameFlow } from "./color.ts";
import { Rng } from "./rng.ts";
import { encodePlayByPlay } from "./store.ts";
import { buildPlayByPlayEntries } from "../../ui/components/BoxScorePlayByPlay.basketball.tsx";
import {
	makeLiveBoxScore,
	nodeToText,
	playLive,
	simulateGame,
	type Line,
} from "../../worker/core/GameSim.basketball/simLiveGameForTests.ts";

/*
 * Play-by-play text that contradicted the game it describes, found by simulating many games and checking every line against the game state
 * (each test is one of them): a one-and-one worded as two shots, quarters in a league with another number of periods, a stored playoff game
 * reading differently than it did live, a foul-trouble note on the foul a player fouls out on, "at the buzzer" with time and a timeout still
 * to come, the 24-second shot clock in a league with a longer one, "1 ties", and five-minute overtimes of another length.
 */

const players = [
	{ pid: 1, name: "Aaron Abernathy", pos: "PG", t: 0 as const },
	{ pid: 2, name: "Bennett Blackwood", pos: "C", t: 0 as const },
	{ pid: 3, name: "Calvin Castellano", pos: "SF", t: 0 as const },
	{ pid: 11, name: "Dorian Dunleavy", pos: "PG", t: 1 as const },
	{ pid: 12, name: "Emmett Eastwood", pos: "C", t: 1 as const },
	{ pid: 13, name: "Fletcher Fairbanks", pos: "SF", t: 1 as const },
];

const zero = (): FlavorStat => ({
	pts: 0,
	ast: 0,
	trb: 0,
	stl: 0,
	blk: 0,
	tov: 0,
	pf: 0,
	fg: 0,
	fga: 0,
	tp: 0,
	tpa: 0,
	ft: 0,
	fta: 0,
});

const setup = (
	gid: number,
	opts: { numPeriods?: number; shotClock?: number } = {},
) => {
	const session = new FlavorSession({
		gid,
		numPeriods: opts.numPeriods ?? 4,
		quarterLength: 12,
		shotClock: opts.shotClock,
		female: false,
		noArticle: false,
		teams: [
			{ name: "Celtics", abbrev: "BOS" },
			{ name: "Mavericks", abbrev: "DAL" },
		],
		players,
	});
	const stats = new Map<number, FlavorStat>(
		players.map((p) => [p.pid, zero()]),
	);
	const score: [number, number] = [0, 0];
	const host: FlavorHost = {
		stat: (pid) => stats.get(pid),
		score: () => [score[0], score[1]],
		onCourt: (t) => players.filter((p) => p.t === t).map((p) => p.pid),
	};
	const say = (ev: any, future: any[] = []) => {
		const r = session.describe(ev, host, future);
		return r === "silent" || r === undefined ? undefined : r;
	};
	return { session, stats, score, host, say };
};

const all = (r: FlavorResult | undefined) =>
	r ? `${r.text} ${r.note ?? ""}` : "";

test("a one-and-one whose front end is missed is not worded as two shots", () => {
	let sawOneAndOne = 0;
	for (let gid = 1; gid <= 40; gid++) {
		const { say, stats } = setup(gid);
		stats.get(12)!.pf = 2;
		const foul = {
			type: "pfBonus",
			t: 1,
			pid: 12,
			pidShooting: 1,
			clock: 400,
		};
		const miss = { type: "missFt", t: 0, pid: 1, clock: 400 };
		const reb = { type: "drb", t: 1, pid: 13, clock: 399 };
		const f = say(foul, [miss, reb]);
		assert.notMatch(f!.text, /\btwo\b/, f!.text);
		if (/one-and-one/.test(f!.text)) {
			sawOneAndOne += 1;
		}
		const ft = say(miss, [reb]);
		assert.match(ft!.text, /front end/, ft!.text);
		assert.notMatch(ft!.text, /\bfirst\b/, ft!.text);
	}
	assert.strictEqual(sawOneAndOne, 40);

	// A two-shot trip still reads as one
	for (let gid = 1; gid <= 20; gid++) {
		const { say } = setup(gid);
		const foul = {
			type: "pfBonus",
			t: 1,
			pid: 12,
			pidShooting: 1,
			clock: 400,
		};
		const miss = { type: "missFt", t: 0, pid: 1, clock: 400 };
		const make = { type: "ft", t: 0, pid: 1, clock: 400 };
		const f = say(foul, [miss, make]);
		assert.notMatch(f!.text, /one-and-one/);
		const ft = say(miss, [make]);
		assert.notMatch(ft!.text, /front end/);
	}
});

test("a league with three periods has periods, not quarters or halves", () => {
	const seen = new Set<string>();
	for (let gid = 1; gid <= 60; gid++) {
		const { say, score } = setup(gid, { numPeriods: 3 });
		score[0] = 30;
		score[1] = 28;
		for (const period of [2, 3]) {
			const r = say({ type: "period", period, clock: 720 });
			const note = r?.note ?? "";
			assert.notMatch(note, /quarter|At the half|After one|After three/);
			const m = /\b(first|second) period\b/.exec(note);
			if (m) {
				seen.add(m[0]);
			}
		}
	}
	assert.deepStrictEqual([...seen].sort(), ["first period", "second period"]);
});

test("no foul-trouble note on the foul a player fouls out on", () => {
	let notes = 0;
	for (let gid = 1; gid <= 60; gid++) {
		for (const foulsOut of [true, false]) {
			const { say, stats } = setup(gid);
			stats.get(12)!.pf = 6;
			const foul = { type: "pfNonShooting", t: 1, pid: 12, clock: 300 };
			const future = foulsOut
				? [
						{ type: "stat", t: 1, pid: 12, s: "pf", amt: 0 },
						{ type: "foulOut", t: 1, pid: 12, clock: 300 },
					]
				: [];
			const r = say(foul, future);
			const trouble = /foul trouble|foul number/.test(r?.note ?? "");
			if (foulsOut) {
				assert.isFalse(trouble, r?.note);
			} else if (trouble) {
				notes += 1;
			}
		}
	}
	// (the note is still made when he stays in the game)
	assert.isAbove(notes, 10);
});

test("a tying shot with a fraction of a second left and a timeout to come is not at the buzzer", () => {
	const finish = (gid: number, future: any[]) => {
		const { say, score } = setup(gid);
		say({ type: "period", period: 4, clock: 720 });
		score[0] = 101;
		score[1] = 104;
		say({
			type: "fgaTp",
			t: 0,
			pid: 1,
			clock: 2.5,
			poss: 6,
			desperation: false,
		});
		score[0] = 104;
		return say({ type: "tp", t: 0, pid: 1, clock: 0.18, period: 4 }, future)!;
	};
	const overtime = [
		{ type: "overtime", period: 5, clock: 300 },
		{ type: "gameOver" },
	];
	for (let gid = 1; gid <= 30; gid++) {
		const withTimeout = finish(gid, [
			{ type: "timeout", t: 1, numLeft: 1, advancesBall: true, clock: 0.18 },
			...overtime,
		]);
		assert.match(withTimeout.note ?? "", /overtime/);
		assert.notMatch(withTimeout.note ?? "", /buzzer/, withTimeout.note);
		assert.match(withTimeout.note ?? "", /with 0\.2 seconds left/);
		const last = finish(gid, overtime);
		assert.match(
			last.note ?? "",
			/overtime at the buzzer|ties it at the buzzer/,
		);
	}
});

test("the shot clock is the league's: no late-clock words 23 seconds into a 30-second shot clock", () => {
	const words = (shotClock: number | undefined) => {
		let n = 0;
		for (let gid = 1; gid <= 150; gid++) {
			const { say, score } = setup(gid, { shotClock });
			say({ type: "fgaMidRange", t: 0, pid: 3, clock: 500, poss: 23 });
			score[0] = 2;
			const r = say(
				{ type: "fgMidRange", t: 0, pid: 3, clock: 499, period: 1 },
				[{ type: "drb", t: 1, pid: 12, clock: 480 }],
			);
			// ("winding down" is fine seven seconds from the end)
			if (
				/shot clock|shot-clock/.test(
					all(r).replace("shot clock winding down", ""),
				)
			) {
				n += 1;
			}
			// a turnover 18 seconds in: a violation of a 24-second shot clock, not of a 30-second one
			const tov = say({
				type: "tov",
				t: 1,
				pid: 11,
				outOfBounds: false,
				clock: 470,
				poss: 18,
			});
			if (/shot-clock violation|shot clock expires/.test(all(tov))) {
				n += 100;
			}
		}
		return n;
	};
	assert.strictEqual(words(30), 0);
	assert.isAbove(words(undefined), 100);
});

test("one tie is 1 tie", () => {
	const flow = new GameFlow();
	// six lead changes and one tie
	const steps: [[number, number], 0 | 1][] = [
		[[2, 0], 0],
		[[2, 3], 1],
		[[4, 3], 0],
		[[4, 5], 1],
		[[6, 5], 0],
		[[6, 6], 1],
		[[6, 8], 1],
		[[9, 8], 0],
	];
	for (const [s, t] of steps) {
		flow.update(s, t);
	}
	assert.strictEqual(flow.ties, 1);
	const seen = new Set<string>();
	for (let i = 0; i < 40; i++) {
		seen.add(flow.summary(new Rng(1, i), ["the Celtics", "the Mavericks"]));
	}
	assert.include([...seen], "6 lead changes and 1 tie so far.");
	assert.notInclude([...seen].join(" "), "1 ties");
});

test("overtime notes say the league's overtime length", () => {
	let five = 0;
	for (let gid = 1; gid <= 60; gid++) {
		const { say, score } = setup(gid);
		say({ type: "period", period: 4, clock: 720 });
		score[0] = 100;
		score[1] = 100;
		const three = say({ type: "overtime", period: 5, clock: 180 })!;
		assert.notMatch(three.note ?? "", /five|Five/);
		const { say: say5, score: score5 } = setup(gid);
		say5({ type: "period", period: 4, clock: 720 });
		score5[0] = 100;
		score5[1] = 100;
		const r = say5({ type: "overtime", period: 5, clock: 300 })!;
		if (/Five more minutes/.test(r.note ?? "")) {
			five += 1;
			assert.match(three.note ?? "", /3 more minutes to settle it/);
		}
	}
	assert.isAbove(five, 0);
});

test("a stored playoff game (and a custom shot clock) reads as it did live", async () => {
	const { events, result } = await simulateGame(21);
	// hotheads everywhere: the playoffs make them talk more, so the text depends on the game being a playoff game
	for (const team of events[0].boxScore) {
		for (const p of team.player) {
			p.pbpRatings = { ...p.pbpRatings, temper: 5 };
		}
	}
	const stored = encodePlayByPlay(events);
	const liveBox = (playoffs: boolean) => ({
		...makeLiveBoxScore(result, 21),
		playoffs,
		shotClockLength: 30,
	});
	const text = (lines: Line[]) =>
		lines.map((l) => (l.note ? `${l.text}\n${l.note}` : l.text));
	const live = text(playLive(structuredClone(events), liveBox(true)));
	const regular = text(playLive(structuredClone(events), liveBox(false)));
	assert.notDeepEqual(live, regular);
	const entries = buildPlayByPlayEntries({ ...liveBox(true), pbp: stored });
	assert.deepStrictEqual(
		entries.map((e) => nodeToText(e.text)),
		live,
	);
}, 60_000);
