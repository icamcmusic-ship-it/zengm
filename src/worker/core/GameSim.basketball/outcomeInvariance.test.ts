import { assert, beforeAll, test } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import GameSim from "./index.ts";
import { player, team } from "../index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g, helpers } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";

/*
 * The play-by-play text ("flavor") layer must never change a game's result. These tests simulate fixed-seed games (Math.random replaced by a
 * seeded generator, for both league generation and the sim) and compare each box score, hashed, with
 * outcomeInvariance.fixture.json, which was recorded from the sim BEFORE any play-by-play work (so any change to what the sim does with its
 * random numbers shows up here). They also check that turning play-by-play logging on changes nothing.
 *
 * To re-record on purpose (only after an intentional change to the sim itself): RECORD_FIXTURE=1 vitest --run --project basketball <this file>
 */

const FIXTURE = new URL("./outcomeInvariance.fixture.json", import.meta.url);
const SEEDS = range(12).map((i) => 1000 + i * 37);

const withSeededRandom = async <T>(seed: number, fn: () => Promise<T> | T) => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		return await fn();
	} finally {
		Math.random = original;
	}
};

const genTwoTeams = async () => {
	resetG();
	g.setWithoutSavingToDB("season", 2013);
	const teamsDefault = helpers.getTeamsDefault().slice(0, 2);
	await resetCache({
		players: [
			...range(50).map(() => player.generate(0, 25, 2010, true, DEFAULT_LEVEL)),
			...range(50).map(() => player.generate(1, 25, 2010, true, DEFAULT_LEVEL)),
		],
		teams: teamsDefault.map(team.generate),
		teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
		teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
	});
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

// The result of one game, as the rest of BBGM sees it: team and player stat lines, minus anything the play-by-play layer may add
const boxScoreOf = (result: ReturnType<GameSim["run"]>) => {
	return {
		overtimes: result.overtimes,
		clutchPlays: result.clutchPlays.map((c) => c.text),
		teams: result.team.map((t) => ({
			id: t.id,
			stat: t.stat,
			players: t.player.map((p) => ({
				id: p.id,
				name: p.name,
				stat: p.stat,
				skills: p.skills,
				injured: p.injured,
				newInjury: p.newInjury,
			})),
		})),
	};
};

const simGame = async (seed: number, doPlayByPlay: boolean) => {
	return withSeededRandom(seed, async () => {
		await genTwoTeams();
		const teams = await loadTeams([0, 1], {});
		const sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: g.get("injuryRate"),
			doPlayByPlay,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		const result = sim.run();
		return { result, box: boxScoreOf(result) };
	});
};

const hashOf = (box: unknown) =>
	createHash("sha256").update(stableStringify(box)).digest("hex");

beforeAll(() => {
	// Pace and other settings come from defaults; nothing else to prepare
});

test("fixed-seed box scores are identical to the recorded ones", async () => {
	const out: { seed: number; pts: [number, number]; hash: string }[] = [];
	for (const seed of SEEDS) {
		const { box } = await simGame(seed, false);
		out.push({
			seed,
			pts: [box.teams[0]!.stat.pts, box.teams[1]!.stat.pts],
			hash: hashOf(box),
		});
	}

	if (process.env["RECORD_FIXTURE"]) {
		fs.writeFileSync(FIXTURE, `${JSON.stringify(out, null, "\t")}\n`);
		return;
	}

	const expected = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
	assert.deepStrictEqual(out, expected);
});

test("play-by-play logging does not change the result", async () => {
	for (const seed of SEEDS.slice(0, 6)) {
		const off = await simGame(seed, false);
		const on = await simGame(seed, true);
		assert.strictEqual(hashOf(on.box), hashOf(off.box), `seed ${seed}`);
		assert.isDefined(on.result.playByPlay);
		assert.isTrue(on.result.playByPlay!.length > 100);
	}
});

test("a game's text events can be produced twice without touching the sim's random numbers", async () => {
	// (the flavor layer's own check lives in src/common/pbpFlavor; here: same seed, same events)
	const a = await simGame(SEEDS[0]!, true);
	const b = await simGame(SEEDS[0]!, true);
	const types = (r: typeof a) =>
		r.result.playByPlay!.map((e: any) => `${e.type}:${e.pid ?? ""}:${e.clock ?? ""}`);
	assert.deepStrictEqual(types(a), types(b));
});
