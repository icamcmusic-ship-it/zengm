import { assert, test } from "vitest";
import {
	decodePlayByPlay,
	encodePlayByPlay,
	storedInitEvent,
} from "../../../common/pbpFlavor/store.ts";
import { CAREER_LENGTH, makeCareer } from "../../../common/pbpFlavor/career.ts";
import { STORED_STATS } from "./PlayByPlayLogger.ts";
import {
	makeLiveBoxScore,
	playLive,
	simulateGame,
} from "./simLiveGameForTests.ts";

// The play-by-play stored with a box score (game.pbp): the events come back exactly, and the text made from them is the live text

const norm = (x: unknown) =>
	JSON.parse(JSON.stringify(x, (_key, v) => (v === Infinity ? "Infinity" : v)));

test("stored events come back exactly, and read exactly as they did live", async () => {
	let bytes = 0;
	const seeds = [1, 2, 3, 4, 5, 6];
	for (const seed of seeds) {
		const { events, result } = await simulateGame(seed);
		const stored = encodePlayByPlay(events);
		bytes += stored.length;
		assert.match(stored, /^[\w-]+$/);

		const { players, events: decoded, rivalry } = decodePlayByPlay(stored);
		const expected = events.filter(
			(e) =>
				e.type !== "init" && !(e.type === "stat" && !STORED_STATS.has(e.s)),
		);
		assert.deepStrictEqual(norm(decoded), norm(expected), `seed ${seed}`);

		const live = playLive(events.slice(), makeLiveBoxScore(result, seed));
		const box = makeLiveBoxScore(result, seed);
		const replay = playLive(
			[storedInitEvent(players, box.teams, rivalry), ...decoded],
			box,
		);
		assert.deepStrictEqual(replay, live, `seed ${seed}`);
	}
	const perGame = bytes / seeds.length;
	console.log(`stored play-by-play: ${Math.round(perGame)} bytes a game`);
	assert.isTrue(perGame < 10_000, `${perGame} bytes a game`);
});

test("events the schema can't hold exactly are kept as JSON", () => {
	const events = [
		{
			type: "init",
			boxScore: [
				{ player: [{ id: 5, pbpRatings: { hgt: 50 } }] },
				{ player: [] },
			],
		},
		{ type: "drb", t: 0, pid: 5, clock: 700.123456 },
		{ type: "someNewEvent", t: 1, foo: "bar" },
		{ type: "stat", t: 1, pid: undefined, s: "pts", amt: 2 },
		{ type: "stat", t: 0, pid: 5, s: "min", amt: 0.5 },
		{ type: "period", clock: 720, period: 2 },
		{ type: "timeouts", timeouts: [7, 6] },
	];
	const { players, events: out } = decodePlayByPlay(encodePlayByPlay(events));
	assert.deepStrictEqual(players, [{ pid: 5, t: 0, ratings: { hgt: 50 } }]);
	assert.deepStrictEqual(norm(out), [
		{ type: "drb", t: 0, pid: 5, clock: 700.123456 },
		{ type: "someNewEvent", t: 1, foo: "bar" },
		{ type: "stat", t: 1, s: "pts", amt: 2 },
		{ type: "period", clock: 720, period: 2 },
		{ type: "timeouts", timeouts: [7, 6] },
	]);
});

// A version 1 string (before player traits: no temper in the header) or a version 2 one (before the rivalry and the career numbers) made
// from a version 3 one, by rewriting the header
const toOldVersion = (s: string, target: 1 | 2) => {
	const ALPHABET =
		"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
	let i = 0;
	const token = () => {
		const start = i;
		let v = 0;
		let mult = 1;
		for (;;) {
			const c = ALPHABET.indexOf(s[i]!);
			i += 1;
			if (c < 32) {
				v += c * mult;
				break;
			}
			v += (c - 32) * mult;
			mult *= 32;
		}
		return { v, text: s.slice(start, i) };
	};
	const version = token();
	assert.strictEqual(version.v, 3);
	let out = String(target);
	token(); // rivalry, not in versions 1 and 2
	const numPlayers = token();
	out += numPlayers.text;
	for (let p = 0; p < numPlayers.v; p++) {
		out += token().text; // pid
		out += token().text; // team
		const hasRatings = token();
		out += hasRatings.text;
		if (hasRatings.v === 1) {
			for (let k = 0; k < 14; k++) {
				out += token().text;
			}
		}
		const temper = token(); // not in version 1
		if (target >= 2) {
			out += temper.text;
		}
		// what he had done before the game: not in versions 1 and 2
		if (token().v === 1) {
			for (let k = 0; k < CAREER_LENGTH; k++) {
				token();
			}
		}
	}
	return out + s.slice(i);
};

test("games stored before player traits (version 1) still decode and read", async () => {
	const { events, result } = await simulateGame(3);
	const stored = encodePlayByPlay(events);
	const now = decodePlayByPlay(stored);
	assert.isTrue(now.players.every((p) => p.career?.length === CAREER_LENGTH));
	for (const target of [1, 2] as const) {
		const old = decodePlayByPlay(toOldVersion(stored, target));
		assert.deepStrictEqual(norm(old.events), norm(now.events));
		assert.strictEqual(old.players.length, now.players.length);
		assert.strictEqual(old.rivalry, 0);
		for (const [i, p] of old.players.entries()) {
			assert.strictEqual(p.pid, now.players[i]!.pid);
			assert.isUndefined(p.career);
			if (target === 1) {
				assert.isUndefined(p.ratings?.temper);
			} else {
				assert.deepStrictEqual(p.ratings, now.players[i]!.ratings);
			}
		}
		const box = makeLiveBoxScore(result, 3);
		const replay = playLive(
			[storedInitEvent(old.players, box.teams), ...old.events],
			makeLiveBoxScore(result, 3),
		);
		assert.isAbove(replay.length, 100);
		assert.notMatch(
			replay.map((l) => `${l.text} ${l.note}`).join("\n"),
			/undefined|NaN/,
		);
	}
});

test("the rivalry and what each player had done before the game are stored, so a stored game reads as it did live", async () => {
	const { events, result } = await simulateGame(4);
	// A bitter rivalry, hotheads everywhere, and a few players on the verge of something
	events[0].boxScore[0].pbpRivalry = 2;
	for (const [t, team] of events[0].boxScore.entries()) {
		for (const [i, p] of team.player.entries()) {
			p.pbpRatings = { ...p.pbpRatings, temper: i % 2 === 0 ? 8 : 75 };
			p.pbpCareer = makeCareer({
				gp: 300,
				gpSeason: 40,
				td: 0,
				age: 24 + ((i + t) % 12),
				high: { pts: 9 + i, trb: 6, ast: 5, tp: 2, blk: 2, stl: 2 },
				seasonHigh: { pts: 7 + i, trb: 5, ast: 4, tp: 2, blk: 1, stl: 1 },
				total: { pts: 4990 - i, trb: 996, ast: 998, tp: 498 },
			});
		}
	}
	const stored = encodePlayByPlay(events);
	const { players, events: decoded, rivalry } = decodePlayByPlay(stored);
	assert.strictEqual(rivalry, 2);
	assert.deepStrictEqual(
		players.map((p) => p.career),
		events[0].boxScore.flatMap((team: any) =>
			team.player.map((p: any) => p.pbpCareer),
		),
	);
	const live = playLive(events.slice(), makeLiveBoxScore(result, 4));
	const box = makeLiveBoxScore(result, 4);
	const replay = playLive(
		[storedInitEvent(players, box.teams, rivalry), ...decoded],
		box,
	);
	assert.deepStrictEqual(replay, live);
	const notes = live.map((l) => l.note).join("\n");
	assert.match(notes, /career high/);
	assert.match(notes, /career (points|rebounds|assists|threes)/);
});
