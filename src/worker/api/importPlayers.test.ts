import { assert, beforeEach, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { g } from "../util/index.ts";
import { idb } from "../db/index.ts";
import { player } from "../core/index.ts";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import api from "./index.ts";

beforeEach(async () => {
	resetG();
	g.setWithoutSavingToDB("season", 2030);
	g.setWithoutSavingToDB("startingSeason", 2030);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("budget", false);
	await resetCache({});
	idb.league = mockIDBLeague();
});

// A player as Export Players writes him, from a league 4 seasons behind this one
const exportedPlayer = () => {
	const p: any = structuredClone({
		...player.generate(PLAYER.FREE_AGENT, 24, 2026, false, DEFAULT_LEVEL),
		pid: 77,
	});
	p.ratings = [
		{ ...p.ratings[0], season: 2025 },
		{ ...p.ratings[0], season: 2026 },
	];
	p.traits = { clutchSeed: 1.25, hustleSeed: -0.5, leadershipSeed: 0.75 };
	p.archetypes = [
		{ season: 2025, id: "slasher", v: 1 },
		{ season: 2026, id: "stretchBig", v: 1 },
	];
	p.exportedSeason = 2026;
	return p;
};

test("Import Players keeps the player's traits and archetype history (shifted like his ratings)", async () => {
	const p = exportedPlayer();
	await api.main.importPlayers({
		includeStats: false,
		leagueFileVersion: LEAGUE_DATABASE_VERSION,
		players: [
			{
				p,
				contractAmount: "1",
				contractExp: "2031",
				draftYear: "",
				season: 2026,
				seasonOffset: 0,
				tid: PLAYER.FREE_AGENT,
			},
		],
	});
	const imported: any[] = await idb.cache.players.getAll();
	assert.strictEqual(imported.length, 1);
	const p2 = imported[0];
	assert.deepStrictEqual(p2.traits, {
		clutchSeed: 1.25,
		hustleSeed: -0.5,
		leadershipSeed: 0.75,
	});
	assert.deepStrictEqual(
		p2.ratings.map((r: any) => r.season),
		[2029, 2030],
	);
	assert.deepStrictEqual(
		p2.archetypes.map((r: any) => [r.season, r.id]),
		[
			[2029, "slasher"],
			[2030, "stretchBig"],
		],
	);
});

test("Import Players as a draft prospect drops the archetype history, keeps the traits", async () => {
	const p = exportedPlayer();
	await api.main.importPlayers({
		includeStats: false,
		leagueFileVersion: LEAGUE_DATABASE_VERSION,
		players: [
			{
				p,
				contractAmount: "1",
				contractExp: "2031",
				draftYear: "2031",
				season: 2026,
				seasonOffset: 0,
				tid: PLAYER.UNDRAFTED,
			},
		],
	});
	const [p2]: any[] = await idb.cache.players.getAll();
	assert.isUndefined(p2.archetypes);
	assert.strictEqual(p2.traits.clutchSeed, 1.25);
});
