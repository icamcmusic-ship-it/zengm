// Not a real test: a headless college sweep (docs/college-mode.md). Plays a college league with every League Extra on through every
// phase, loads every league page at each phase (a page reload), sends the user's whole roster into the portal, turns the new
// features off in the middle of the second season, and round-trips the league through an export and an import. Logs problems.
// Skipped unless COLLEGE_SWEEP is set:
//
//   COLLEGE_SWEEP=1 COLLEGE_LEVEL=power COLLEGE_QUICK=0 node_modules/.bin/vitest run --project basketball \
//     src/worker/core/college/collegeSweep.test.ts
import "fake-indexeddb/auto";
import { assert, describe, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../../common/constants.ts";
import { NATIVE_FEATURES } from "../../../common/nativeFeatures.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	getCollegeLeagueTeams,
	type CollegeLevel,
} from "../../../common/college/teams.ts";
import { getCollegeSettings } from "../../../common/college/settings.ts";
import { routeInfos } from "../../../ui/util/routeInfos.ts";
import { game, league, phase } from "../index.ts";
import * as views from "../../views/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, local, lock } from "../../util/index.ts";
import { getContractSummary } from "../contract/index.ts";
import { finishOffseasonWeeks, getPortalPlayers } from "./recruiting.ts";

const env = (globalThis as any).process.env;
const ENABLED = !!env.COLLEGE_SWEEP;
const LEVEL = (env.COLLEGE_LEVEL ?? "power") as CollegeLevel;
const SEASONS = Number(env.COLLEGE_SEASONS ?? 3);
const QUICK: string | undefined = env.COLLEGE_QUICK;

const problems: string[] = [];
const problem = (line: string) => {
	if (!problems.includes(line)) {
		problems.push(line);
		console.log(`PROBLEM ${line}`);
	}
};
const where = () => `season ${g.get("season")} phase ${g.get("phase")}`;

const step = async (name: string, f: () => Promise<unknown>) => {
	await f();
	for (const key of ["gameSim", "newPhase", "drafting"] as const) {
		assert.isFalse(lock.get(key), `lock ${key} after ${name} (${where()})`);
	}
	assert.isUndefined(local.autoPlayUntil);
};

const scanNaN = (value: unknown, path: string, seen = new Set<unknown>()) => {
	if (typeof value === "number") {
		if (Number.isNaN(value)) {
			problem(`NaN ${path}`);
		}
		return;
	}
	if (value === null || typeof value !== "object" || seen.has(value)) {
		return;
	}
	seen.add(value);
	if (value instanceof Map || value instanceof Set) {
		return;
	}
	for (const [k, v] of Object.entries(value)) {
		// Text columns averaged as numbers by the stats tables, and attendance on the (pro-only) finances page
		if (["imgURL", "imgURLSmall", "name", "region", "att"].includes(k)) {
			continue;
		}
		scanNaN(v, `${path}.${k}`, seen);
	}
};

const loadAllPages = async (label: string) => {
	const all = await idb.cache.players.getAll();
	const pick = (f: (p: (typeof all)[number]) => boolean) => all.find(f)?.pid;
	const pids: Record<string, number | undefined> = {
		prospect: pick((p) => p.tid === PLAYER.UNDRAFTED),
		active: pick((p) => p.tid === g.get("userTid")),
		portal: pick((p) => p.tid === PLAYER.FREE_AGENT),
	};
	const gid = (await idb.cache.games.getAll()).at(-1)?.gid;
	const abbrev = g.get("teamInfoCache")[g.get("userTid")]!.abbrev;
	const done = new Set<string>();
	for (const [route, id] of Object.entries(routeInfos)) {
		if (!route.startsWith("/l/:lid")) {
			continue;
		}
		const names = [...route.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);
		const kinds = names.includes("pid") ? Object.keys(pids) : ["-"];
		for (const kind of kinds) {
			const params: Record<string, string | undefined> = { lid: "0" };
			for (const name of names) {
				if (name === "pid") {
					const pid = pids[kind];
					params.pid = pid === undefined ? undefined : String(pid);
				} else if (name === "team") {
					params.team = `${abbrev}_${g.get("userTid")}`;
				} else if (name === "season") {
					params.season = String(g.get("season"));
				} else if (name === "gid") {
					params.gid = gid === undefined ? undefined : String(gid);
				}
			}
			if (names.includes("pid") && params.pid === undefined) {
				continue;
			}
			// Routes this harness cannot fill in (a type or an event id), and the football depth chart
			if (
				names.includes("type") ||
				names.includes("eid") ||
				route.includes("/depth")
			) {
				continue;
			}
			const key = `${id}|${JSON.stringify(params)}`;
			if (done.has(key)) {
				continue;
			}
			done.add(key);
			const view = (views as any)[id];
			if (!view) {
				continue;
			}
			try {
				const inputs = view.processInputs ? view.processInputs(params, {}) : {};
				if (inputs && inputs.redirectUrl) {
					continue;
				}
				const out = await view.load({
					inputs,
					updateEvents: new Set(["firstRun"]),
					prevInputs: inputs,
					prevOutput: {},
					conditions: {},
				});
				scanNaN(out, `${label} ${route} ${kind}`);
				if (
					kind === "portal" &&
					id === "player" &&
					(out as any)?.teamName !== "Transfer Portal"
				) {
					problem(`portal player shown as a free agent (${label})`);
				}
			} catch (error) {
				problem(
					`ERROR ${label} ${route} ${kind}: ${(error as Error).message} ${((error as Error).stack ?? "").split("\n").slice(1, 4).join(" | ")}`,
				);
			}
		}
	}
};

describe.skipIf(!ENABLED)("college sweep", () => {
	test("seasons", { timeout: 6 * 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(Number(env.COLLEGE_SWEEP_SEED ?? 11));
		const { teams, confs, divs } = getCollegeLeagueTeams(LEVEL);
		const settings: any = {
			...getDefaultSettings(),
			...getCollegeSettings(LEVEL),
			...(QUICK !== undefined ? { collegeQuickSim: QUICK === "1" } : {}),
		};
		for (const f of NATIVE_FEATURES) {
			settings[f.key] = true;
		}
		const userTid = Math.max(
			0,
			teams.findIndex((t) => t.region === "Duke"),
		);
		await league.createStream(
			{},
			{
				confs,
				divs,
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
				name: "college sweep",
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: teams.map((t) => ({ ...t, popRank: 1 })) as any,
				tid: userTid,
			},
		);
		await league.loadGameAttributes();
		await loadAllPages("created");

		const playPhase = async (label: string) => {
			const start = g.get("phase");
			let days = 0;
			while (g.get("phase") === start) {
				await step(`${label} day ${days}`, () => game.play(1, {}));
				days += 1;
				if (days === 3) {
					await loadAllPages(`${label} ${where()}`);
				}
				assert.isBelow(days, 200, where());
			}
		};

		for (let i = 0; i < SEASONS; i++) {
			await loadAllPages(`preseason ${i}`);
			await step("regular season", () =>
				phase.newPhase(PHASE.REGULAR_SEASON, {}),
			);
			if (i === 1) {
				// Everything new off in the middle of the season
				let days = 0;
				while (days < 10) {
					await step("day", () => game.play(1, {}));
					days += 1;
				}
				const off: Record<string, boolean> = {
					collegeNit: false,
					collegeFirstFour: false,
					collegeQuickSim: !g.get("collegeQuickSim"),
				};
				for (const f of NATIVE_FEATURES) {
					off[f.key] = false;
				}
				await league.setGameAttributes(off);
				await loadAllPages(`features off ${i}`);
			}
			if (i === 2) {
				const on: Record<string, boolean> = {
					collegeNit: true,
					collegeFirstFour: true,
				};
				for (const f of NATIVE_FEATURES) {
					on[f.key] = true;
				}
				await league.setGameAttributes(on);
			}
			await playPhase(`regular season ${i}`);
			await playPhase(`conf tournaments ${i}`);
			await playPhase(`national tournament ${i}`);
			await loadAllPages(`after playoffs ${i}`);
			await step("departures", () => phase.newPhase(PHASE.DRAFT, {}));
			await loadAllPages(`departures ${i}`);
			await step("portal", () => phase.newPhase(PHASE.AFTER_DRAFT, {}));
			if (i === 0) {
				// The user's whole roster enters the portal
				for (const p of await idb.cache.players.indexGetAll(
					"playersByTid",
					g.get("userTid"),
				)) {
					(p as any).portal = {
						from: p.tid,
						season: g.get("season"),
						schools: [{ tid: p.tid, i: 25, o: true }],
					};
					p.contractDemand ??= getContractSummary(p);
					p.tid = PLAYER.FREE_AGENT;
					await idb.cache.players.put(p);
				}
			}
			await loadAllPages(`portal ${i}`);
			await finishOffseasonWeeks();
			await step("recruiting", () => phase.newPhase(PHASE.RESIGN_PLAYERS, {}));
			if ((await getPortalPlayers()).length > 0) {
				problem(`portal not empty after it closed ${where()}`);
			}
			await loadAllPages(`recruiting ${i}`);
			await step("signing day", () => phase.newPhase(PHASE.FREE_AGENCY, {}));
			await loadAllPages(`signing day ${i}`);
			for (const t of teams) {
				const n = (await idb.cache.players.indexGetAll("playersByTid", t.tid))
					.length;
				if (n > 13 || n < 9) {
					problem(`${t.region} roster ${n} after signing day ${i}`);
				}
			}
			await step("preseason", () => phase.newPhase(PHASE.PRESEASON, {}));
		}
		console.log(`done, ${problems.length} problems`);
		assert.lengthOf(problems, 0, problems.join("\n"));
	});
});
