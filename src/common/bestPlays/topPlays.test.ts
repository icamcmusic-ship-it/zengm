import { assert, test } from "vitest";
import { simulateGame } from "../../worker/core/GameSim.basketball/simLiveGameForTests.ts";
import {
	decodePlayByPlay,
	encodePlayByPlay,
	storedInitEvent,
} from "../pbpFlavor/store.ts";
import {
	pickTopPlays,
	playsFromClutch,
	playsFromPbp,
	type GameForPlays,
} from "./topPlays.ts";

const game = (result: any, seed: number): GameForPlays => ({
	gid: seed,
	season: 2025,
	teams: [0, 1].map((i) => ({
		name: `Team ${i}`,
		abbrev: `T${i}`,
		pts: result.team[i].stat.pts,
		players: result.team[i].player.map((p: any) => ({
			pid: p.id,
			name: p.name,
			pos: p.pos,
		})),
	})) as GameForPlays["teams"],
});

test("plays from stored play-by-play", async () => {
	let n = 0;
	for (const seed of [1, 2, 3]) {
		const { events, result } = await simulateGame(seed);
		const { players, events: decoded } = decodePlayByPlay(
			encodePlayByPlay(events),
		);
		const gm = game(result, seed);
		const init = storedInitEvent(players, gm.teams);
		const plays = playsFromPbp(gm, init, decoded);
		n += plays.length;
		for (const p of plays) {
			assert.isAbove(p.score, 0);
			assert.strictEqual(p.source, "pbp");
			assert.isString(p.text);
		}
		// Final score of the last scoring play matches the box score
		const last = plays.filter((p) => p.after).at(-1);
		if (last) {
			assert.isAtMost(last.after![0], gm.teams[0].pts);
		}
		// Same game, same plays
		assert.deepStrictEqual(playsFromPbp(gm, init, decoded), plays);
	}
	assert.isAbove(n, 0);
});

test("clutch plays when there is no play-by-play", () => {
	const plays = playsFromClutch({
		gid: 1,
		season: 2025,
		teams: [
			{ name: "A", abbrev: "A", pts: 100, players: [] },
			{ name: "B", abbrev: "B", pts: 99, players: [] },
		],
		clutchPlays: [
			'<a href="/l/1/player/5">Joe Smith</a> buries a step-back three at the buzzer to win the game.',
			'<a href="/l/1/player/6">Bob Jones</a> blocks <a href="/l/1/player/7">Al Fox</a>\'s layup to seal the win.',
		],
	});
	assert.strictEqual(plays.length, 2);
	assert.strictEqual(plays[0]!.kind, "buzzer");
	assert.strictEqual(plays[0]!.pid, 5);
	assert.strictEqual(plays[1]!.kind, "stop");
	assert.include(plays[0]!.text, "[[p:5|Joe Smith]]");
	assert.strictEqual(pickTopPlays(plays, { limit: 1 })[0]!.kind, "buzzer");
});
