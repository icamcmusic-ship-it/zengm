import { expect, test } from "vitest";
import { envForTest, storedGames, targetOfGame } from "./gather.ts";
import { makeRaw } from "./fixture.ts";

test("the environment of a finished game from the per-day prefixes is exactly a full pass's", () => {
	const raw = makeRaw();
	const games = storedGames(raw);
	expect(games.length).toBeGreaterThan(50);
	// with playoff games as targets too
	const targets = [
		...games.map((g) => targetOfGame(g)),
		...games
			.slice(-5)
			.map((g) => ({ ...targetOfGame(g), playoffs: true, gid: g.gid + 1e6 })),
	];
	for (const t of targets) {
		const { fast, full } = envForTest(raw, t);
		expect(fast).toStrictEqual(full);
	}
});
