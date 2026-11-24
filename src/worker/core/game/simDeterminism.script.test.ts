// Not a real test: a before/after check that a speed change did not change any result. Simulates a new default league
// (every core feature on) with a seeded Math.random through a regular season, the playoffs, the whole offseason
// (draft, re-signings, free agency, preseason development and archetypes) and the first week of the next season,
// and at each stage hashes the full contents of every database object store (box scores with play-by-play, player
// stats and ratings, injuries, transactions/events, awards, team stats, schedule, ...). Skipped unless SIM_DET is set:
//
//   SIM_DET=1 SIM_DET_SEEDS=1,2,3 SIM_DET_OUT=/tmp/after.jsonl [SIM_DET_BASE=/tmp/before.jsonl] \
//     node_modules/.bin/vitest run --project basketball src/worker/core/game/simDeterminism.script.test.ts
//
// Writes one JSON line per seed and stage ("SIM_DET {...}") to SIM_DET_OUT. With SIM_DET_BASE (the lines written by
// the untouched code), the test fails on any store whose hash differs and names it. SIM_DET_SEASONS (default 1) plays
// more seasons.
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { assert, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { recordsCheckNow } from "../../util/recordsBookData.ts";
import {
	cancelLeagueAchievementsCheck,
	checkLeagueAchievements,
} from "../../util/leagueAchievements.ts";

const env = (globalThis as any).process.env;
const SEEDS: number[] = String(env.SIM_DET_SEEDS ?? "1")
	.split(",")
	.map(Number);
const SEASONS = Number(env.SIM_DET_SEASONS ?? 1);

// The Records Book is updated by a debounced background check (1.2 s after a day of games, later while the sim is busy), so when
// it runs depends on the wall clock (its state remembers the season it last ran in). Running it at the end of every step makes
// the stored state a function of the seed; the timer then finds nothing new
const drain = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	await recordsCheckNow();
	// League achievements are checked the same way (a debounced timer, 1.5 s after games and phase changes, later while the sim is busy,
	// so with a faster sim it could land in another stage): checked here instead
	cancelLeagueAchievementsCheck();
	await checkLeagueAchievements();
};

const hashOf = (str: string) => {
	let h = 0;
	let h2 = 7;
	for (let i = 0; i < str.length; i++) {
		const c = str.charCodeAt(i);
		h = (Math.imul(h, 31) + c) | 0;
		h2 = (Math.imul(h2, 16777619) ^ c) | 0;
	}
	return `${(h >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
};

// NaN/Infinity survive (JSON.stringify would turn both into null)
const replacer = (_key: string, value: unknown) => {
	if (typeof value === "number" && !Number.isFinite(value)) {
		return `#${value}`;
	}
	if (value instanceof Map) {
		return ["#Map", ...value];
	}
	if (value instanceof Set) {
		return ["#Set", ...value];
	}
	return value;
};

const fingerprint = async () => {
	await idb.cache.flush();
	const out: Record<string, string> = {};
	const names = [...(idb.league as any).objectStoreNames].sort();
	for (const name of names) {
		const rows = await idb.league.getAll(name as any);
		if (name === "gameAttributes") {
			// One hash per attribute, so a difference names it
			for (const row of rows as any[]) {
				out[`gameAttributes.${row.key}`] = hashOf(
					JSON.stringify(row.value, replacer) ?? "undefined",
				);
			}
			continue;
		}
		out[name] = `${rows.length}:${hashOf(JSON.stringify(rows, replacer))}`;
	}
	return out;
};

describe.skipIf(!env.SIM_DET)("sim determinism", () => {
	test("fingerprints", { timeout: 24 * 60 * 60 * 1000 }, async () => {
		const lines: any[] = [];
		// The clock seeds the rumors and times out two short-lived caches (scouting report context 15 s, league coaching
		// fits 3 s), so with the real clock a faster sim could legitimately differ there. A frozen clock makes the whole
		// run a function of the seed. SIM_DET_REAL_CLOCK=1 keeps the real one.
		const realNow = Date.now;
		if (!env.SIM_DET_REAL_CLOCK) {
			Date.now = () => 1_700_000_000_000;
		}
		for (const seed of SEEDS) {
			Math.random = makeSeededRandom(seed);
			await league.createStream(
				{},
				{
					confs: last(defaultGameAttributes.confs).value,
					divs: last(defaultGameAttributes.divs).value,
					fromFile: {
						gameAttributes: undefined,
						hasRookieContracts: true,
						maxGid: undefined,
						startingSeason: undefined,
						teams: undefined,
						version: LEAGUE_DATABASE_VERSION,
					},
					getLeagueOptions: undefined,
					keptKeys: new Set(),
					lid: seed,
					name: `det${seed}`,
					setLeagueCreationStatus: () => {},
					settings: getDefaultSettings() as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			const play = async (numDays: number) => {
				await lock.set("gameSim", false);
				await game.play(numDays, {});
				await drain();
			};
			const record = async (stage: string) => {
				await drain();
				const stores = await fingerprint();
				const line = { seed, stage, season: g.get("season"), stores };
				lines.push(line);
				if (env.SIM_DET_OUT) {
					appendFileSync(env.SIM_DET_OUT, `SIM_DET ${JSON.stringify(line)}\n`);
				}
				console.log(`SIM_DET seed ${seed} ${stage} done`);
			};
			await record("created");
			for (let s = 0; s < SEASONS; s++) {
				await phase.newPhase(PHASE.REGULAR_SEASON, {});
				await drain();
				await play(7);
				await record(`s${s}-week1`);
				await play(await season.getDaysLeftSchedule());
				await record(`s${s}-regularSeason`);
				await play(100);
				await record(`s${s}-playoffs`);
				await phase.newPhase(PHASE.DRAFT, {});
				await drain();
				await draft.runPicks({ type: "untilEnd" }, {});
				await drain();
				await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
				await record(`s${s}-resign`);
				await phase.newPhase(PHASE.FREE_AGENCY, {});
				await drain();
				await freeAgents.play(g.get("daysLeft"), {});
				await drain();
				if (g.get("phase") !== PHASE.PRESEASON) {
					await phase.newPhase(PHASE.PRESEASON, {});
				}
				await record(`s${s}-preseason`);
			}
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await play(7);
			await record(`s${SEASONS}-week1`);
		}
		Date.now = realNow;

		if (env.SIM_DET_BASE && existsSync(env.SIM_DET_BASE)) {
			const base = new Map<string, Record<string, string>>();
			for (const l of readFileSync(env.SIM_DET_BASE, "utf8").split("\n")) {
				if (l.startsWith("SIM_DET ")) {
					const x = JSON.parse(l.slice(8));
					base.set(`${x.seed} ${x.stage}`, x.stores);
				}
			}
			const diffs: string[] = [];
			let compared = 0;
			for (const line of lines) {
				const b = base.get(`${line.seed} ${line.stage}`);
				if (!b) {
					continue;
				}
				compared += 1;
				for (const name of new Set([
					...Object.keys(b),
					...Object.keys(line.stores),
				])) {
					if (b[name] !== line.stores[name]) {
						diffs.push(`seed ${line.seed} ${line.stage} ${name}`);
					}
				}
			}
			console.log(
				`SIM_DET compared ${compared} stages, ${diffs.length} differences`,
			);
			assert(compared > 0, "nothing to compare");
			assert.deepStrictEqual(diffs, []);
		}
	});
});
