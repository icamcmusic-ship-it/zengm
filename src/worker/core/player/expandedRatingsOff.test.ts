import { assert, test } from "vitest";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { createHash } from "node:crypto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import fs from "node:fs";
import GameSim from "../GameSim.basketball/index.ts";
import { player, team } from "../index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g, helpers, local } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";

/*
 * Expanded ratings (the expandedRatings setting: wingspan and perimeter/interior defense) must leave a league with the setting OFF exactly
 * as it was: same generated players, same development (ovr/pot/skills/pos), same composite ratings and same game results. These hashes were
 * recorded from the code BEFORE expanded ratings existed (fixed seeds, Math.random replaced by a seeded generator).
 *
 * To re-record on purpose (only after an intentional change to generation, development or the sim): RECORD_FIXTURE=1 vitest --run
 * --project basketball <this file>
 */

const FIXTURE = new URL("./expandedRatingsOff.fixture.json", import.meta.url);
const SEEDS = range(6).map((i) => 4000 + i * 53);

const withSeededRandom = async <T>(seed: number, fn: () => Promise<T> | T) => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		return await fn();
	} finally {
		Math.random = original;
	}
};

const stableStringify = (x: unknown): string =>
	JSON.stringify(x, (_key, value) => {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			return Object.fromEntries(
				Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
			);
		}
		return value;
	});

const hashOf = (x: unknown) =>
	createHash("sha256").update(stableStringify(x)).digest("hex");

const run = (seed: number) =>
	withSeededRandom(seed, async () => {
		resetG();
		g.setWithoutSavingToDB("season", 2013);
		g.setWithoutSavingToDB("expandedRatings" as any, false);
		await resetCache({});
		// Other test files sharing this worker can leave league state behind (player value normalization)
		local.reset();

		// New league players and draft prospects, developed a few seasons
		const players: any[] = [
			...range(13).map(() => player.generate(0, 25, 2010, true, DEFAULT_LEVEL)),
			...range(13).map(() => player.generate(1, 22, 2010, true, DEFAULT_LEVEL)),
		];
		const prospects: any[] = range(6).map(() =>
			player.generate(-2, 19, 2014, false, DEFAULT_LEVEL),
		);
		for (const p of [...players, ...prospects]) {
			await player.develop(p, 0, false, DEFAULT_LEVEL);
		}
		for (const p of prospects) {
			await player.develop(p, 2, true, DEFAULT_LEVEL);
		}
		for (let i = 0; i < 3; i++) {
			for (const p of players) {
				await player.develop(p, 1, false, DEFAULT_LEVEL);
			}
		}
		for (const p of players) {
			await player.updateValues(p);
		}
		players.forEach((p, i) => {
			p.pid = i;
		});

		const ratingsHash = hashOf(
			[...players, ...prospects].map((p) => ({
				ratings: p.ratings,
				draft: p.draft,
				value: p.value,
				valueNoPot: p.valueNoPot,
				born: p.born,
				hgt: p.hgt,
			})),
		);

		const teamsDefault = helpers.getTeamsDefault().slice(0, 2);
		await resetCache({
			players,
			teams: teamsDefault.map(team.generate),
			teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
			teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
		});
		const teams = await loadTeams([0, 1], {});
		const composites = hashOf(
			[teams[0]!, teams[1]!].map((t) =>
				t.player.map((p: any) => p.compositeRating),
			),
		);
		const sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay: false,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		const result = sim.run();
		const box = hashOf(
			result.team.map((t: any) => ({
				stat: t.stat,
				players: t.player.map((p: any) => ({ id: p.id, stat: p.stat })),
			})),
		);

		return {
			seed,
			ratings: ratingsHash,
			composites,
			box,
			pts: [result.team[0].stat.pts, result.team[1].stat.pts],
		};
	});

test("expanded ratings OFF: generation, development and games are identical to before the feature", async () => {
	const out = [];
	for (const seed of SEEDS) {
		out.push(await run(seed));
	}

	if ((globalThis as any).process?.env?.["RECORD_FIXTURE"]) {
		fs.writeFileSync(FIXTURE, `${JSON.stringify(out, null, "\t")}\n`);
		return;
	}

	const expected = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
	assert.deepStrictEqual(out, expected);
}, 120000);

// A league that had the setting on (both steps: wingspan, perimeter/interior defense, offensive/defensive rebounding, catch-and-shoot/
// off-the-dribble, ball security) and turned it off: the stored ratings are ignored, so development and games are exactly those of the
// same players without them
const EXPANDED_KEYS = [
	"wng",
	"pdef",
	"idef",
	"oreb",
	"dreb",
	"csh",
	"dsh",
	"bsc",
] as const;
const strip = (p: any) => {
	for (const r of p.ratings) {
		for (const key of EXPANDED_KEYS) {
			delete r[key];
		}
	}
	return p;
};

const runStale = async (seed: number, keepExpanded: boolean) => {
	const players: any[] = await withSeededRandom(seed, async () => {
		resetG();
		g.setWithoutSavingToDB("season", 2013);
		g.setWithoutSavingToDB("expandedRatings" as any, true);
		await resetCache({});
		local.reset();
		const out = range(26).map((i) =>
			player.generate(i < 13 ? 0 : 1, 24, 2010, true, DEFAULT_LEVEL),
		);
		for (const p of out) {
			await player.develop(p, 0, false, DEFAULT_LEVEL);
		}
		return out;
	});
	assert.isTrue(players.every((p) => typeof p.ratings.at(-1).bsc === "number"));
	if (!keepExpanded) {
		players.forEach(strip);
	}
	return withSeededRandom(seed + 1, async () => {
		g.setWithoutSavingToDB("expandedRatings" as any, false);
		local.reset();
		for (let i = 0; i < 2; i++) {
			for (const p of players) {
				await player.develop(p, 1, false, DEFAULT_LEVEL);
			}
		}
		players.forEach((p, i) => {
			p.pid = i;
		});
		for (const p of players) {
			await player.updateValues(p);
		}
		const teamsDefault = helpers.getTeamsDefault().slice(0, 2);
		await resetCache({
			players,
			teams: teamsDefault.map(team.generate),
			teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
			teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
		});
		const teams = await loadTeams([0, 1], {});
		const result = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay: false,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		}).run();
		return {
			ratings: hashOf(
				players.map((p) => ({
					ratings: strip(structuredClone(p)).ratings,
					value: p.value,
				})),
			),
			box: hashOf(
				result.team.map((t: any) => ({
					stat: t.stat,
					players: t.player.map((p: any) => ({ id: p.id, stat: p.stat })),
				})),
			),
		};
	});
};

test("expanded ratings turned OFF: stored expanded ratings (both steps) change nothing", async () => {
	for (const seed of SEEDS.slice(0, 3)) {
		assert.deepStrictEqual(
			await runStale(seed, true),
			await runStale(seed, false),
		);
	}
}, 120000);
