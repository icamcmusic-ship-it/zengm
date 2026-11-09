// Not a real test: a headless sweep that plays a league with every League Extra on through every phase for a few seasons,
// turning Expanded ratings on in the middle of season 2 and off again in season 3, and loads every league page (every route in
// routeInfos, the player pages for a prospect, an active player, a free agent and a retired player) at each phase. Logs page
// errors, NaN in page data and the secret aging curve showing up for a player who hasn't retired. Skipped unless NATIVE_SWEEP is
// set:
//
//   NATIVE_SWEEP=1 NATIVE_SWEEP_OUT=/tmp/sweep.txt node_modules/.bin/vitest run --project basketball \
//     src/worker/core/league/nativeSweep.test.ts
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync } from "node:fs";
import { assert, describe, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../../common/constants.ts";
import { NATIVE_FEATURES } from "../../../common/nativeFeatures.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { AGING_CURVE_INFO } from "../../../common/playerTraits/development.ts";
import { routeInfos } from "../../../ui/util/routeInfos.ts";
import { draft, freeAgents, game, league, phase, player } from "../index.ts";
import { getContractDemand } from "../contract/index.ts";
import updateExpandedRatingsForLeague from "../player/updateExpandedRatingsForLeague.ts";
import * as views from "../../views/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, local, lock } from "../../util/index.ts";

const env = (globalThis as any).process.env;
const ENABLED = !!env.NATIVE_SWEEP;
const SEASONS = Number(env.NATIVE_SWEEP_SEASONS ?? 3);

const problems: string[] = [];
const log = (line: string) => {
	console.log(line);
	if (env.NATIVE_SWEEP_OUT) {
		appendFileSync(env.NATIVE_SWEEP_OUT, `${line}\n`);
	}
};
const problem = (line: string) => {
	if (!problems.includes(line)) {
		problems.push(line);
		log(`PROBLEM ${line}`);
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

const fixUserRoster = async () => {
	const tid = g.get("userTid");
	const players = [
		...(await idb.cache.players.indexGetAll("playersByTid", tid)),
	];
	players.sort((a, b) => a.value - b.value);
	while (players.length > g.get("maxRosterSize")) {
		await player.release(players.shift()!, false);
	}
	const fas = [
		...(await idb.cache.players.indexGetAll("playersByTid", PLAYER.FREE_AGENT)),
	];
	fas.sort((a, b) => b.value - a.value);
	while (players.length < g.get("minRosterSize")) {
		const p = fas.shift() ?? (await player.genRandomFreeAgent());
		await player.sign(p, tid, getContractDemand(p), g.get("phase"));
		await idb.cache.players.put(p);
		players.push(p);
	}
};

const agingNames = new Set(Object.values(AGING_CURVE_INFO).map((x) => x.name));

// NaN numbers, and the aging curve (by key or by its names) anywhere in a page's data
const scan = (
	value: unknown,
	path: string,
	label: string,
	retiredPids: Set<number>,
	pid: number | undefined,
	seen = new Set<unknown>(),
) => {
	if (typeof value === "number") {
		if (Number.isNaN(value)) {
			problem(`NaN ${label} ${path}`);
		}
		return;
	}
	if (typeof value === "string") {
		if (agingNames.has(value) && (pid === undefined || !retiredPids.has(pid))) {
			problem(`aging curve name ${label} ${path}`);
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
	const pidHere =
		typeof (value as any).pid === "number" ? (value as any).pid : pid;
	for (const [k, v] of Object.entries(value)) {
		if (
			k === "agingCurve" &&
			v !== undefined &&
			(pidHere === undefined || !retiredPids.has(pidHere))
		) {
			problem(`aging curve ${label} ${path}.${k} pid ${pidHere}`);
		}
		scan(v, `${path}.${k}`, label, retiredPids, pidHere, seen);
	}
};

const loadPage = async (
	id: string,
	params: Record<string, string | undefined>,
	label: string,
	retiredPids: Set<number>,
) => {
	const view = (views as any)[id];
	if (!view) {
		return;
	}
	try {
		const inputs = view.processInputs ? view.processInputs(params, {}) : {};
		if (inputs && inputs.redirectUrl) {
			return;
		}
		const out = await view.load({
			inputs,
			updateEvents: new Set(["firstRun"]),
			prevInputs: inputs,
			prevOutput: {},
			conditions: {},
		});
		scan(out, id, label, retiredPids, undefined);
	} catch (error) {
		problem(
			`ERROR ${label}: ${(error as Error).message} ${((error as Error).stack ?? "").split("\n").slice(1, 4).join(" | ")}`,
		);
	}
};

const loadAllPages = async (phaseLabel: string) => {
	const all = await idb.cache.players.getAll();
	const retiredRows = (await idb.league.getAll("players")).filter(
		(p) => p.tid === PLAYER.RETIRED,
	);
	const retiredPids = new Set(retiredRows.map((p) => p.pid));
	const pick = (f: (p: (typeof all)[number]) => boolean) => all.find(f)?.pid;
	const pids: Record<string, number | undefined> = {
		prospect: pick((p) => p.tid === PLAYER.UNDRAFTED),
		active: pick((p) => p.tid === g.get("userTid")),
		other: pick((p) => p.tid >= 0 && p.tid !== g.get("userTid")),
		freeAgent: pick((p) => p.tid === PLAYER.FREE_AGENT),
		retired: retiredRows.at(-1)?.pid,
	};
	const games = await idb.cache.games.getAll();
	const gid = games.at(-1)?.gid;
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
			const key = `${id}|${JSON.stringify(params)}`;
			if (done.has(key)) {
				continue;
			}
			done.add(key);
			await loadPage(
				id,
				params,
				`${phaseLabel} ${route} ${kind === "-" ? "" : kind}`,
				retiredPids,
			);
		}
	}
};

const setExpanded = async (on: boolean) => {
	await league.setGameAttributes({ expandedRatings: on });
	await updateExpandedRatingsForLeague();
	await idb.cache.flush();
	log(`expandedRatings ${on} (${where()})`);
};

describe.skipIf(!ENABLED)("native sweep", () => {
	test("seasons", { timeout: 6 * 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(Number(env.NATIVE_SWEEP_SEED ?? 5));
		const settings: any = getDefaultSettings();
		for (const f of NATIVE_FEATURES) {
			settings[f.key] = true;
		}
		settings.expandedRatings = false;
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
				name: "sweep",
				setLeagueCreationStatus: () => {},
				settings: {
					...settings,
					numGames: Number(env.NATIVE_SWEEP_GAMES ?? 10),
					numGamesPlayoffSeries: [1, 1, 1],
					numPlayoffByes: 0,
				},
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		await loadAllPages("created");

		for (let i = 0; i < SEASONS; i++) {
			await fixUserRoster();
			await loadAllPages(`preseason ${i}`);
			await step("regular season", () =>
				phase.newPhase(PHASE.REGULAR_SEASON, {}),
			);
			let days = 0;
			while (g.get("phase") <= PHASE.PLAYOFFS) {
				await fixUserRoster();
				await step("day", () => game.play(1, {}));
				days += 1;
				if (days === 3) {
					await loadAllPages(`regular season ${i}`);
					if (i === 1) {
						await setExpanded(true);
						await loadAllPages(`regular season ${i} expanded on`);
					} else if (i === 2) {
						await setExpanded(false);
						await loadAllPages(`regular season ${i} expanded off`);
					}
				}
				if (g.get("phase") === PHASE.PLAYOFFS && days < 1000) {
					await loadAllPages(`playoffs ${i}`);
					days = 1000;
				}
			}
			await loadAllPages(`draft lottery ${i}`);
			await step("draft phase", () => phase.newPhase(PHASE.DRAFT, {}));
			await loadAllPages(`draft ${i}`);
			await step("draft", () => draft.runPicks({ type: "untilEnd" }, {}));
			await loadAllPages(`after draft ${i}`);
			await step("re-signing", () => phase.newPhase(PHASE.RESIGN_PLAYERS, {}));
			await loadAllPages(`re-signing ${i}`);
			await step("free agency", () => phase.newPhase(PHASE.FREE_AGENCY, {}));
			await loadAllPages(`free agency ${i}`);
			while (g.get("phase") === PHASE.FREE_AGENCY) {
				await step("fa day", () => freeAgents.play(1, {}));
			}
		}
		log(`done, ${problems.length} problems`);
	});
});
