import { assert, test } from "vitest";
import {
	decodePlayByPlay,
	encodePlayByPlay,
	storedInitEvent,
} from "../../../common/pbpFlavor/store.ts";
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

		const { players, events: decoded } = decodePlayByPlay(stored);
		const expected = events.filter(
			(e) =>
				e.type !== "init" && !(e.type === "stat" && !STORED_STATS.has(e.s)),
		);
		assert.deepStrictEqual(norm(decoded), norm(expected), `seed ${seed}`);

		const live = playLive(events.slice(), makeLiveBoxScore(result, seed));
		const box = makeLiveBoxScore(result, seed);
		const replay = playLive(
			[storedInitEvent(players, box.teams), ...decoded],
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

// A version 1 string (before player traits: no temper in the header) made from a version 2 one, by rewriting the header
const toVersion1 = (s: string) => {
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
	assert.strictEqual(version.v, 2);
	let out = "1";
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
		token(); // temper, not in version 1
	}
	return out + s.slice(i);
};

test("games stored before player traits (version 1) still decode and read", async () => {
	const { events, result } = await simulateGame(3);
	const stored = encodePlayByPlay(events);
	const v1 = toVersion1(stored);
	const v2 = decodePlayByPlay(stored);
	const old = decodePlayByPlay(v1);
	assert.deepStrictEqual(norm(old.events), norm(v2.events));
	assert.strictEqual(old.players.length, v2.players.length);
	for (const [i, p] of old.players.entries()) {
		assert.strictEqual(p.pid, v2.players[i]!.pid);
		assert.isUndefined(p.ratings?.temper);
	}
	const box = makeLiveBoxScore(result, 3);
	const replay = playLive(
		[storedInitEvent(old.players, box.teams), ...old.events],
		makeLiveBoxScore(result, 3),
	);
	assert.isAbove(replay.length, 100);
	assert.notMatch(replay.join("\n"), /undefined|NaN/);
});
