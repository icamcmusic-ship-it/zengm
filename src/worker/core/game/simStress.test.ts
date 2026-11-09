// Not a real test: a long headless sim (fake-indexeddb, all League extras on), played the way the UI plays it (one day,
// one free agency day, one phase at a time), with a watchdog on every step: any step that takes more than
// SIM_STRESS_SLOW_MS (default 2000) of CPU time is logged, and a step that does not finish within SIM_STRESS_STUCK_MS (default
// 300000), a day that does not advance or a lock left set fails the run. Skipped unless SIM_STRESS is set:
//
// SIM_STRESS_VIEWS=1 also reloads some pages every 10 days, as the UI does after each day while they are open.
//
//   SIM_STRESS=1 SIM_STRESS_SEASONS=5 SIM_STRESS_SEED=1 SIM_STRESS_OUT=/tmp/stress.txt \
//     node_modules/.bin/vitest run --project basketball src/worker/core/game/simStress.test.ts
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
import {
	draft,
	freeAgents,
	game,
	league,
	phase,
	player,
	season,
} from "../index.ts";
import { getContractDemand } from "../contract/index.ts";
import { checkLeagueAchievements } from "../../util/leagueAchievements.ts";
import * as views from "../../views/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, local, lock } from "../../util/index.ts";

const env = (globalThis as any).process.env;
const ENABLED = !!env.SIM_STRESS;
const SEASONS = Number(env.SIM_STRESS_SEASONS ?? 3);
const SEED = Number(env.SIM_STRESS_SEED ?? 1);
const SLOW_MS = Number(env.SIM_STRESS_SLOW_MS ?? 2000);
const STUCK_MS = Number(env.SIM_STRESS_STUCK_MS ?? 300000);

const log = (line: string) => {
	console.log(line);
	if (env.SIM_STRESS_OUT) {
		appendFileSync(env.SIM_STRESS_OUT, `${line}\n`);
	}
};

const cpuMs = () => {
	const u = (globalThis as any).process.cpuUsage();
	return (u.user + u.system) / 1000;
};

const where = () => `season ${g.get("season")} phase ${g.get("phase")}`;

const step = async (name: string, f: () => Promise<unknown>) => {
	const label = `${name} (${where()})`;
	const t0 = performance.now();
	const c0 = cpuMs();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const stuck = new Promise((_resolve, reject) => {
		timer = setTimeout(
			() =>
				reject(new Error(`STUCK: ${label} did not finish in ${STUCK_MS} ms`)),
			STUCK_MS,
		);
	});
	try {
		await Promise.race([f(), stuck]);
	} finally {
		clearTimeout(timer);
	}
	const ms = performance.now() - t0;
	const cpu = cpuMs() - c0;
	// CPU time, so other work on the machine does not count
	if (cpu > SLOW_MS) {
		log(`SLOW ${Math.round(cpu)} ms CPU (${Math.round(ms)} ms wall): ${label}`);
	}
	for (const key of ["gameSim", "newPhase", "drafting"] as const) {
		if (lock.get(key)) {
			throw new Error(`STUCK: lock ${key} still set after ${label}`);
		}
	}
};

// What a human would do when the game refuses to play because of the user's roster size: cut the worst players or sign
// the best free agents
const fixUserRoster = async () => {
	const tid = g.get("userTid");
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	players.sort((a, b) => a.value - b.value);
	while (players.length > g.get("maxRosterSize")) {
		await player.release(players.shift()!, false);
	}
	if (players.length < g.get("minRosterSize")) {
		const freeAgentsList = await idb.cache.players.indexGetAll(
			"playersByTid",
			-1,
		);
		freeAgentsList.sort((a, b) => b.value - a.value);
		while (players.length < g.get("minRosterSize")) {
			const p = freeAgentsList.shift() ?? (await player.genRandomFreeAgent());
			await player.sign(p, tid, getContractDemand(p), g.get("phase"));
			await idb.cache.players.put(p);
			players.push(p);
		}
	}
};

// Pages that reload after every simmed day while they are open (the sim waits for the reload before the next day)
const VIEWS = [
	["leagueDashboard", {}],
	["newspaper", { team: "all" }],
	["tradeMarket", {}],
	["hype", {}],
	["standings", {}],
	["schedule", {}],
	["roster", {}],
	["playerRatings", {}],
] as const;
const viewTotals: Record<string, { n: number; ms: number; max: number }> = {};
const loadViews = async () => {
	for (const [id, params] of VIEWS) {
		const view = (views as any)[id];
		if (!view) {
			continue;
		}
		const inputs = view.processInputs ? view.processInputs(params, {}) : {};
		const t0 = performance.now();
		await step(`view ${id}`, () =>
			view.load({
				inputs,
				updateEvents: new Set(["gameSim"]),
				prevInputs: inputs,
				prevOutput: {},
				conditions: {},
			}),
		);
		const ms = performance.now() - t0;
		const total = (viewTotals[id] ??= { n: 0, ms: 0, max: 0 });
		total.n += 1;
		total.ms += ms;
		total.max = Math.max(total.max, ms);
	}
};

describe.skipIf(!ENABLED)("sim stress", () => {
	test("seasons", { timeout: 24 * 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(SEED);
		const settings: any = getDefaultSettings();
		for (const f of NATIVE_FEATURES) {
			settings[f.key] = true;
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
				name: `stress${SEED}`,
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		// SIM_STRESS_SAVE_EVERY_DAY=1: the saveEveryDay setting (save after every play request)
		if (env.SIM_STRESS_SAVE_EVERY_DAY) {
			await league.setGameAttributes({ saveEveryDay: true });
		}
		// Not spectator mode, so everything that involves the user's team (AI trade offers, holdouts, ...) runs too

		// SIM_STRESS_WRITES=1: what each flush writes (records per store, and where player writes come from)
		const flushStats: Record<string, number> = {};
		const putCallers: Record<string, number> = {};
		if (env.SIM_STRESS_WRITES) {
			const cache = idb.cache as any;
			const origFlush = cache.flush.bind(cache);
			cache.flush = async (...args: any[]) => {
				flushStats.flushes = (flushStats.flushes ?? 0) + 1;
				for (const [store, set] of Object.entries(cache._dirtyRecords)) {
					flushStats[store] =
						(flushStats[store] ?? 0) + (set as Set<unknown>).size;
				}
				const c0 = cpuMs();
				try {
					return await origFlush(...args);
				} finally {
					flushStats.cpuMs = Math.round((flushStats.cpuMs ?? 0) + cpuMs() - c0);
				}
			};
			for (const m of ["put", "putAll"]) {
				const orig = cache.players[m].bind(cache.players);
				cache.players[m] = (x: any) => {
					const n = m === "put" ? 1 : [...x].length;
					const frame =
						(new Error().stack ?? "")
							.split("\n")
							.slice(2)
							.find((l: string) => l.includes("/src/") && !l.includes("/db/"))
							?.replace(/.*\/src\//, "")
							.replace(/\)$/, "") ?? "?";
					putCallers[frame] = (putCallers[frame] ?? 0) + n;
					return orig(x);
				};
			}
		}

		const t0 = performance.now();
		const start = g.get("season");
		for (let i = 0; i < SEASONS; i++) {
			// SIM_STRESS_PROF=prefix: CPU profiles of the first and the last season, prefix.<season index>.cpuprofile
			const profile = env.SIM_STRESS_PROF && (i === 0 || i === SEASONS - 1);
			let session: any;
			if (profile) {
				session = new Session();
				session.connect();
				await session.post("Profiler.enable");
				await session.post("Profiler.setSamplingInterval", { interval: 500 });
				await session.post("Profiler.start");
			}
			const ts = performance.now();
			const cs = cpuMs();
			await fixUserRoster();
			await step("newPhase REGULAR_SEASON", () =>
				phase.newPhase(PHASE.REGULAR_SEASON, {}),
			);
			let numDays = 0;
			while (
				g.get("phase") === PHASE.REGULAR_SEASON ||
				g.get("phase") === PHASE.AFTER_TRADE_DEADLINE ||
				g.get("phase") === PHASE.PLAYOFFS
			) {
				const before = `${g.get("phase")}|${await season.getDaysLeftSchedule()}|${local.playingUntilEndOfRound}`;
				const schedule = await season.getSchedule();
				await fixUserRoster();
				// SIM_STRESS_BULK=1: the whole regular season and the whole playoffs in one request each, like "Until end of regular season"
				const numDaysToPlay = env.SIM_STRESS_BULK
					? g.get("phase") === PHASE.PLAYOFFS
						? 100
						: await season.getDaysLeftSchedule()
					: 1;
				await step(`play day ${numDays}`, () => game.play(numDaysToPlay, {}));
				numDays += 1;
				if (env.SIM_STRESS_VIEWS && numDays % 10 === 0) {
					await loadViews();
				}
				const after = `${g.get("phase")}|${await season.getDaysLeftSchedule()}|${local.playingUntilEndOfRound}`;
				if (
					before === after &&
					(await season.getSchedule()).length === schedule.length &&
					g.get("phase") !== PHASE.PLAYOFFS
				) {
					throw new Error(`STUCK: day did not advance (${where()})`);
				}
				if (numDays > 1000) {
					throw new Error(`STUCK: more than 1000 days (${where()})`);
				}
			}
			// What runs in the background once the sim stops (it waits while games are being played)
			await step("league achievements check", () => checkLeagueAchievements());
			await step("newPhase DRAFT", () => phase.newPhase(PHASE.DRAFT, {}));
			await step("draft", () => draft.runPicks({ type: "untilEnd" }, {}));
			await step("newPhase RESIGN_PLAYERS", () =>
				phase.newPhase(PHASE.RESIGN_PLAYERS, {}),
			);
			await step("newPhase FREE_AGENCY", () =>
				phase.newPhase(PHASE.FREE_AGENCY, {}),
			);
			let faDays = 0;
			while (g.get("phase") === PHASE.FREE_AGENCY) {
				await fixUserRoster();
				await step(`free agency day ${faDays}`, () => freeAgents.play(1, {}));
				faDays += 1;
				if (faDays > 100) {
					throw new Error(`STUCK: free agency did not end (${where()})`);
				}
			}
			// What the worker keeps in memory: rows and serialized MB per cache store
			const sizes: string[] = [];
			for (const [store, rows] of Object.entries((idb.cache as any)._data)) {
				const values = Object.values(rows as object);
				const mb = JSON.stringify(values).length / 1e6;
				if (mb > 1) {
					sizes.push(`${store} ${values.length} rows ${mb.toFixed(0)} MB`);
				}
			}
			if (profile) {
				const result = await session.post("Profiler.stop");
				writeFileSync(
					`${env.SIM_STRESS_PROF}.${i}.cpuprofile`,
					JSON.stringify(result.profile),
				);
				session.disconnect();
			}
			if (env.SIM_STRESS_WRITES) {
				log(`  flushed records: ${JSON.stringify(flushStats)}`);
				log(
					`  player writes: ${Object.entries(putCallers)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 12)
						.map(([k, v]) => `${v} ${k}`)
						.join("; ")}`,
				);
				for (const k of Object.keys(flushStats)) {
					delete flushStats[k];
				}
				for (const k of Object.keys(putCallers)) {
					delete putCallers[k];
				}
			}
			log(`  cache: ${sizes.join(", ")}`);
			// Which parts of the player objects are big (all of them are written to the database after almost every day)
			const fieldSizes: Record<string, number> = {};
			for (const p of Object.values(
				(idb.cache as any)._data.players,
			) as any[]) {
				for (const [key, value] of Object.entries(p)) {
					fieldSizes[key] =
						(fieldSizes[key] ?? 0) + (JSON.stringify(value)?.length ?? 0);
				}
			}
			log(
				`  player fields: ${Object.entries(fieldSizes)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 8)
					.map(([key, size]) => `${key} ${(size / 1e6).toFixed(1)} MB`)
					.join(", ")}`,
			);
			log(
				`season ${start + i}: ${numDays} days, ${faDays} free agency days, ${Math.round((performance.now() - ts) / 1000)} s (${Math.round((cpuMs() - cs) / 1000)} s CPU), heap ${Math.round((globalThis as any).process.memoryUsage().heapUsed / 1e6)} MB`,
			);
		}
		// Outcome check, as in simBenchmark.test.ts
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
		log(`hash ${hash}`);
		for (const [id, t] of Object.entries(viewTotals)) {
			log(
				`view ${id} after a simmed day: mean ${Math.round(t.ms / t.n)} ms, max ${Math.round(t.max)} ms (${t.n} loads)`,
			);
		}
		log(
			`done: ${SEASONS} seasons in ${Math.round((performance.now() - t0) / 1000)} s`,
		);
	});
});
