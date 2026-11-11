// Not a real test: a headless sim benchmark of the real worker code (fake-indexeddb, default league). Times each phase
// of one season with the League extras all on, all off or at the new league defaults. Skipped unless SIM_BENCH is set:
//
//   SIM_BENCH=on|off|stock SIM_BENCH_SEED=1 node_modules/.bin/vitest run --project basketball \
//     src/worker/core/game/simBenchmark.test.ts
//
// SIM_BENCH_FEATURE=<feature id> with SIM_BENCH=off turns only that feature on (per-feature cost). Prints one JSON line
// "SIM_BENCH_RESULT {...}" with milliseconds per phase (also appended to the file SIM_BENCH_OUT). See tools/perf/sim/run.sh.
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync, writeFileSync } from "node:fs";
// @ts-expect-error
import { Session } from "node:inspector/promises";
import { describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { NATIVE_FEATURES } from "../../../common/nativeFeatures.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import { idb } from "../../db/index.ts";

const env = (globalThis as any).process.env;
const MODE: string | undefined = env.SIM_BENCH;
const SEED = Number(env.SIM_BENCH_SEED ?? 1);
const FEATURE: string | undefined = env.SIM_BENCH_FEATURE;
// With SIM_BENCH=on, a feature to leave off (to measure what one feature costs on top of all the others)
const WITHOUT: string | undefined = env.SIM_BENCH_WITHOUT;

// Let background work scheduled with setTimeout (achievements checks, ...) finish inside the phase it belongs to
const drain = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
};

describe.skipIf(!MODE)("sim benchmark", () => {
	test("season", { timeout: 24 * 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(SEED);
		// SIM_BENCH_PROF=file.cpuprofile: CPU profile of the whole run (open in Chrome DevTools or speedscope)
		let session: any;
		if (env.SIM_BENCH_PROF) {
			session = new Session();
			session.connect();
			await session.post("Profiler.enable");
			await session.post("Profiler.setSamplingInterval", { interval: 200 });
			await session.post("Profiler.start");
		}
		// Wall time, and CPU time of this process (much less sensitive to other work on the machine)
		const times: Record<string, number> = {};
		const cpu: Record<string, number> = {};
		const cpuNow = () => {
			const u = (globalThis as any).process.cpuUsage();
			return (u.user + u.system) / 1000;
		};
		let t0 = performance.now();
		let c0 = cpuNow();
		const mark = async (name: string) => {
			await drain();
			const t = performance.now();
			times[name] = Math.round(t - t0);
			t0 = t;
			const c = cpuNow();
			cpu[name] = Math.round(c - c0);
			c0 = c;
		};

		const settings: any = getDefaultSettings();
		if (MODE !== "stock") {
			for (const f of NATIVE_FEATURES) {
				settings[f.key] =
					(MODE === "on" && f.id !== WITHOUT) || f.id === FEATURE;
			}
		}
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
				lid: 0,
				name: `bench${SEED}`,
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		await mark("create");

		const play = async (numDays: number) => {
			await lock.set("gameSim", false);
			await game.play(numDays, {});
		};

		await phase.newPhase(PHASE.REGULAR_SEASON, {});
		await mark("toRegularSeason");
		await play(1);
		await mark("day1");
		await play(6);
		await mark("week1");
		await play(await season.getDaysLeftSchedule());
		await mark("restOfRegularSeason");
		await play(100);
		await mark("playoffs");
		await phase.newPhase(PHASE.DRAFT, {});
		await mark("toDraft");
		await draft.runPicks({ type: "untilEnd" }, {});
		await mark("draft");
		await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
		await mark("toResignPlayers");
		await phase.newPhase(PHASE.FREE_AGENCY, {});
		await mark("toFreeAgency");
		await freeAgents.play(g.get("daysLeft"), {});
		await mark("freeAgencyDays");
		await phase.newPhase(PHASE.PRESEASON, {});
		await mark("toPreseason");
		await phase.newPhase(PHASE.REGULAR_SEASON, {});
		await mark("toRegularSeason2");
		await play(7);
		await mark("week1Season2");

		const numGames = (
			await idb.league.getAllFromIndex("games", "season", g.get("season") - 1)
		).length;
		// Same seed and same code paths should give the same league: a hash of where everyone is, their contracts and
		// ratings, and team records, to check that an optimization did not change outcomes
		const players = await idb.cache.players.getAll();
		const teamSeasons = await idb.cache.teamSeasons.getAll();
		const state = JSON.stringify([
			players
				.map((p) => [
					p.pid,
					p.tid,
					(p as any).contract?.amount,
					(p as any).contract?.exp,
					p.value,
					last(p.ratings).ovr,
					p.injury.type,
				])
				.sort((a, b) => (a[0] as number) - (b[0] as number)),
			teamSeasons.map((ts) => [ts.tid, ts.season, ts.won, ts.lost]),
		]);
		let hash = 0;
		for (let i = 0; i < state.length; i++) {
			hash = (Math.imul(hash, 31) + state.charCodeAt(i)) | 0;
		}
		const line = `SIM_BENCH_RESULT ${JSON.stringify({ mode: MODE, feature: FEATURE, seed: SEED, phase: g.get("phase"), numGames, hash, times, cpu })}`;
		console.log(line);
		if (session) {
			const { profile } = await session.post("Profiler.stop");
			writeFileSync(env.SIM_BENCH_PROF, JSON.stringify(profile));
		}
		if (env.SIM_BENCH_OUT) {
			appendFileSync(env.SIM_BENCH_OUT, `${line}\n`);
		}
	});
});
