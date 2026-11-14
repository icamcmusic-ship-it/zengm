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
import { setWeeklyFits } from "../staff/systems.ts";
import { setWeeklyTraitEffects } from "../player/traits.ts";

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
		// SIM_BENCH_PROF=file.cpuprofile: CPU profile of the whole run (open in Chrome DevTools or speedscope). Only some phases:
		// SIM_BENCH_PROF_FROM=<phase> starts after that phase, SIM_BENCH_PROF_TO=<phase> stops after that one (names as in times)
		let session: any;
		const startProf = async () => {
			session = new Session();
			session.connect();
			await session.post("Profiler.enable");
			await session.post("Profiler.setSamplingInterval", { interval: 200 });
			await session.post("Profiler.start");
		};
		const stopProf = async () => {
			if (session) {
				const { profile } = await session.post("Profiler.stop");
				writeFileSync(env.SIM_BENCH_PROF, JSON.stringify(profile));
				session = undefined;
			}
		};
		if (env.SIM_BENCH_PROF && !env.SIM_BENCH_PROF_FROM) {
			await startProf();
		}
		// SIM_BENCH_HEAP=file.heapprofile: sampled allocations of the whole run, garbage included (what drives GC time)
		let heapSession: any;
		if (env.SIM_BENCH_HEAP) {
			heapSession = new Session();
			heapSession.connect();
			await heapSession.post("HeapProfiler.startSampling", {
				samplingInterval: 256 * 1024,
				includeObjectsCollectedByMajorGC: true,
				includeObjectsCollectedByMinorGC: true,
			});
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
			if (env.SIM_BENCH_PROF) {
				if (name === env.SIM_BENCH_PROF_TO) {
					await stopProf();
				} else if (name === env.SIM_BENCH_PROF_FROM) {
					await startProf();
				}
			}
		};

		// perf3: SIM_BENCH_PERF3_OFF=weekly works out coaching system fits every day and trait effects every game, as before
		const perf3Off = new Set((env.SIM_BENCH_PERF3_OFF ?? "").split(","));
		// (or only one of them: fits, traits)
		setWeeklyFits(!perf3Off.has("weekly") && !perf3Off.has("fits"));
		setWeeklyTraitEffects(!perf3Off.has("weekly") && !perf3Off.has("traits"));

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
		const hashOf = (str: string) => {
			let h = 0;
			for (let i = 0; i < str.length; i++) {
				h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
			}
			return h;
		};
		const hash = hashOf(state);
		// A wider hash of the native features' stored state (archetypes, scouting snapshots, deaths, events, box scores),
		// for optimizations that could change what is stored without moving the league itself
		await idb.cache.flush();
		const allPlayers = await idb.league.getAll("players");
		const games = await idb.league.getAll("games");
		const events = await idb.league.getAll("events");
		const hash2 = hashOf(
			JSON.stringify([
				allPlayers
					.map((p) => [
						p.pid,
						(p as any).archetypes,
						(p as any).scoutSnaps,
						(p as any).scoutDraft,
						p.diedYear,
						p.ratings,
					])
					.sort((a, b) => (a[0] as number) - (b[0] as number)),
				games
					.map((game) => [game.gid, game.teams, (game as any).pbp])
					.sort((a, b) => (a[0] as number) - (b[0] as number)),
				events.map((e) => [e.eid, e.type, e.text]),
			]),
		);
		// Advanced Tracking Stats: every stats row's
		const teamStatsAll = await idb.league.getAll("teamStats");
		const hash3 = hashOf(
			JSON.stringify([
				allPlayers
					.map((p) => [
						p.pid,
						p.stats.map((r: any) => [r.season, r.tid, r.playoffs, r.adv]),
					])
					.sort((a, b) => (a[0] as number) - (b[0] as number)),
				teamStatsAll
					.map((ts: any) => [ts.tid, ts.season, ts.playoffs, ts.adv])
					.sort((a, b) =>
						a[0] !== b[0]
							? a[0] - b[0]
							: a[1] !== b[1]
								? a[1] - b[1]
								: Number(a[2]) - Number(b[2]),
					),
			]),
		);
		// League totals of the first regular season, per team game (perf3: to check that changed sim inputs stay within noise)
		const totals: Record<string, number> = {};
		const regular = teamStatsAll.filter(
			(ts: any) => ts.season === g.get("season") - 1 && !ts.playoffs,
		);
		const gp = regular.reduce((a: number, ts: any) => a + ts.gp, 0);
		for (const key of [
			"pts",
			"fga",
			"fg",
			"tpa",
			"tp",
			"fta",
			"ast",
			"tov",
			"orb",
			"drb",
			"stl",
			"blk",
			"pf",
		]) {
			totals[key] =
				Math.round(
					(1000 *
						regular.reduce((a: number, ts: any) => a + (ts[key] ?? 0), 0)) /
						Math.max(1, gp),
				) / 1000;
		}
		const line = `SIM_BENCH_RESULT ${JSON.stringify({ mode: MODE, feature: FEATURE, seed: SEED, phase: g.get("phase"), numGames, hash, hash2, perf3Off: env.SIM_BENCH_PERF3_OFF, hash3, totals, times, cpu })}`;
		console.log(line);
		await stopProf();
		if (heapSession) {
			const { profile } = await heapSession.post("HeapProfiler.stopSampling");
			writeFileSync(env.SIM_BENCH_HEAP, JSON.stringify(profile));
		}
		if (env.SIM_BENCH_OUT) {
			appendFileSync(env.SIM_BENCH_OUT, `${line}\n`);
		}
	});
});
