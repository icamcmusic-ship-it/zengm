import { assert, beforeEach, test, vi } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { resetG } from "../../test/helpers.ts";
import g from "./g.ts";
import {
	getPbpRivalryLevels,
	pbpRivalryLevel,
	resetPbpRivalryCache,
} from "./pbpRivalry.ts";

// How heated a matchup's rivalry is, for the play-by-play's trash talk (pbpRivalry.ts): the shared rivalry score's top two tiers, loaded
// once per season and phase, and never without the Player Traits setting (nobody talks without the Temper trait)

const loadRivalries = vi.fn();
const getLevels = () => getPbpRivalryLevels(loadRivalries);

const pair = (a: number, b: number, tier: string) => ({
	key: `${a}-${b}`,
	a,
	b,
	score: { score: 0, parts: {}, tier },
});

beforeEach(() => {
	resetG();
	resetPbpRivalryCache();
	loadRivalries.mockReset();
	loadRivalries.mockResolvedValue([
		pair(0, 1, "Bitter"),
		pair(0, 2, "Heated"),
		pair(1, 2, "Simmering"),
		pair(2, 3, "Mild"),
		pair(3, 4, "None"),
	]);
	g.setWithoutSavingToDB("season", 2030);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
});

test("nothing is loaded with player traits off", async () => {
	g.setWithoutSavingToDB("playerTraits", false);
	const levels = await getLevels();
	assert.strictEqual(levels.size, 0);
	assert.strictEqual(loadRivalries.mock.calls.length, 0);
});

test("heated and bitter rivalries get a level, either way round; the rest get none", async () => {
	g.setWithoutSavingToDB("playerTraits", true);
	const levels = await getLevels();
	assert.strictEqual(pbpRivalryLevel(levels, 0, 1), 2);
	assert.strictEqual(pbpRivalryLevel(levels, 1, 0), 2);
	assert.strictEqual(pbpRivalryLevel(levels, 2, 0), 1);
	assert.strictEqual(pbpRivalryLevel(levels, 1, 2), 0);
	assert.strictEqual(pbpRivalryLevel(levels, 2, 3), 0);
	assert.strictEqual(pbpRivalryLevel(levels, 5, 6), 0);
	// The All-Star teams
	assert.strictEqual(pbpRivalryLevel(levels, -1, -2), 0);
	// (the cheap version of the score: no pass over every stored box score)
	assert.deepStrictEqual(loadRivalries.mock.calls[0], [
		2030,
		{ storedGames: false },
	]);
});

test("loaded once a season, and again for the playoffs", async () => {
	g.setWithoutSavingToDB("playerTraits", true);
	await getLevels();
	await getLevels();
	assert.strictEqual(loadRivalries.mock.calls.length, 1);
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	await getLevels();
	await getLevels();
	assert.strictEqual(loadRivalries.mock.calls.length, 2);
	g.setWithoutSavingToDB("season", 2031);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	await getLevels();
	assert.strictEqual(loadRivalries.mock.calls.length, 3);
});

test("a failure to load never stops a game: no rivalries", async () => {
	g.setWithoutSavingToDB("playerTraits", true);
	loadRivalries.mockRejectedValue(new Error("no database"));
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const levels = await getLevels();
	error.mockRestore();
	assert.strictEqual(levels.size, 0);
});
