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
import * as staff from "../staff/index.ts";
import archetypesApi from "../../api/archetypes.ts";
import { archetypeById } from "../../../common/archetypes/classify.ts";
import { getContractDemand } from "../contract/index.ts";
import updateExpandedRatingsForLeague from "../player/updateExpandedRatingsForLeague.ts";
import * as views from "../../views/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, local, lock } from "../../util/index.ts";
import api from "../../api/index.ts";

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
		const t0 = performance.now();
		const out = await view.load({
			inputs,
			updateEvents: new Set(["firstRun"]),
			prevInputs: inputs,
			prevOutput: {},
			conditions: {},
		});
		// NATIVE_SWEEP_SLOW_MS=500: log the worker's time for pages slower than that
		const ms = performance.now() - t0;
		if (env.NATIVE_SWEEP_SLOW_MS && ms > Number(env.NATIVE_SWEEP_SLOW_MS)) {
			log(`SLOW ${Math.round(ms)} ms ${label}`);
		}
		scan(out, id, label, retiredPids, undefined);
	} catch (error) {
		problem(
			`ERROR ${label}: ${(error as Error).message} ${((error as Error).stack ?? "").split("\n").slice(1, 4).join(" | ")}`,
		);
	}
};

const loadAllPages = async (phaseLabel: string) => {
	if (env.NATIVE_SWEEP_PAGES === "0") {
		return;
	}
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

// ---- Box score sanity, realism numbers and setting toggles ----

const checkedGids = new Set<number>();
type Agg = {
	games: number;
	pts: number;
	fga: number;
	fg: number;
	tpa: number;
	tp: number;
	fta: number;
	ft: number;
	ast: number;
	tov: number;
	orb: number;
	drb: number;
	stl: number;
	blk: number;
	pf: number;
	poss: number;
	foulOuts: number;
	min48: number;
	injured: number;
	ot: number;
	minPaceLow: number;
	minPaceHigh: number;
};
const newAgg = (): Agg => ({
	games: 0,
	pts: 0,
	fga: 0,
	fg: 0,
	tpa: 0,
	tp: 0,
	fta: 0,
	ft: 0,
	ast: 0,
	tov: 0,
	orb: 0,
	drb: 0,
	stl: 0,
	blk: 0,
	pf: 0,
	poss: 0,
	foulOuts: 0,
	min48: 0,
	injured: 0,
	ot: 0,
	minPaceLow: 0,
	minPaceHigh: 0,
});
let agg = newAgg();
// Regular season minutes and usage by team and player
let playerAgg = new Map<
	string,
	{ tid: number; gp: number; min: number; use: number }
>();

const checkNewGames = async () => {
	for (const game of await idb.cache.games.getAll()) {
		if (checkedGids.has(game.gid)) {
			continue;
		}
		checkedGids.add(game.gid);
		if (game.teams[0].tid < 0) {
			// All-Star game
			continue;
		}
		const numPeriods = game.numPeriods ?? 4;
		const quarterLength = game.quarterLength ?? 12;
		const expectedMin = 5 * (numPeriods * quarterLength + game.overtimes * 5);
		const label = `game ${game.gid} (${where()})`;
		// Realism numbers are for the regular season
		const target = game.playoffs ? newAgg() : agg;
		target.ot += game.overtimes > 0 ? 1 : 0;
		for (const t of game.teams as any[]) {
			let min = 0;
			for (const p of t.players) {
				for (const [k, v] of Object.entries(p)) {
					if (typeof v === "number" && !Number.isFinite(v)) {
						problem(`box score ${k}=${v} ${label}`);
					}
				}
				min += p.min ?? 0;
				if (!game.playoffs && p.min > 0) {
					const key = `${t.tid}-${p.pid}`;
					const row = playerAgg.get(key) ?? {
						tid: t.tid,
						gp: 0,
						min: 0,
						use: 0,
					};
					row.gp += 1;
					row.min += p.min;
					row.use += p.fga + 0.44 * p.fta + p.tov;
					playerAgg.set(key, row);
				}
				if (p.min > numPeriods * quarterLength + game.overtimes * 5 + 1e-6) {
					problem(`player min ${p.min} > game length ${label}`);
				}
				if (p.min < 0) {
					problem(`player min ${p.min} < 0 ${label}`);
				}
				if (p.pf > 6 || (game.overtimes === 0 && p.min >= 46)) {
					// Who was available: roster size, injured, how many played
					const played = t.players.filter((x: any) => x.min > 0).length;
					const injured = t.players.filter(
						(x: any) => x.injury?.gamesRemaining > 0,
					).length;
					const fouledOut = t.players.filter((x: any) => x.pf >= 6).length;
					problem(
						`player pf ${p.pf} min ${r1(p.min)} pid ${p.pid} tid ${t.tid} ${label}: roster ${t.players.length} played ${played} injured ${injured} fouledOut ${fouledOut}${t.tid === g.get("userTid") ? " (user team: the sweep keeps it at the minimum roster and never signs injury replacements)" : ""}`,
					);
				}
				if (p.pf >= 6) {
					target.foulOuts += 1;
				}
				if (game.overtimes === 0 && p.min >= 46) {
					target.min48 += 1;
				}
			}
			if (Math.abs(min - expectedMin) > 0.5) {
				problem(`team minutes ${min.toFixed(2)} != ${expectedMin} ${label}`);
			}
			target.games += 1;
			target.injured += t.players.filter(
				(x: any) => x.injury?.gamesRemaining > 0,
			).length;
			for (const key of [
				"pts",
				"fga",
				"fg",
				"tpa",
				"tp",
				"fta",
				"ft",
				"ast",
				"tov",
				"orb",
				"drb",
				"stl",
				"blk",
				"pf",
			] as const) {
				const v = t[key];
				if (typeof v !== "number" || !Number.isFinite(v)) {
					problem(`team ${key}=${v} ${label}`);
				} else {
					agg[key] += v;
				}
			}
			const poss = t.fga - t.orb + t.tov + 0.44 * t.fta;
			target.poss += poss;
			const scale = 48 / (numPeriods * quarterLength + game.overtimes * 5);
			if (poss * scale < 80) {
				target.minPaceLow += 1;
			}
			if (poss * scale > 120) {
				target.minPaceHigh += 1;
			}
		}
	}
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

const logRealism = async (label: string) => {
	const a = agg;
	const n = Math.max(1, a.games);
	log(
		`REALISM ${label}: team-games ${a.games} pts ${r1(a.pts / n)} fg% ${r3(a.fg / a.fga)} 3pa/fga ${r3(a.tpa / a.fga)} 3p% ${r3(a.tp / a.tpa)} fta ${r1(a.fta / n)} ft% ${r3(a.ft / a.fta)} ast ${r1(a.ast / n)} tov ${r1(a.tov / n)} orb ${r1(a.orb / n)} drb ${r1(a.drb / n)} stl ${r1(a.stl / n)} blk ${r1(a.blk / n)} pf ${r1(a.pf / n)} poss ${r1(a.poss / n)} | pace<80 ${a.minPaceLow} pace>120 ${a.minPaceHigh} foulOuts/team-game ${r3(a.foulOuts / n)} 46+min(reg) ${a.min48} OT games ${a.ot / 2} injured/team-game ${r1(a.injured / n)}`,
	);

	// Minutes distribution and star usage, from the regular season player stats
	const season = g.get("season");
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const topMpg: number[] = [];
	const rotation: number[] = [];
	let over36 = 0;
	const topUsg: number[] = [];
	const byTid = Map.groupBy(playerAgg.values(), (row) => row.tid);
	for (const t of teams) {
		const rows = byTid.get(t.tid) ?? [];
		const mpg = rows.map((r) => r.min / r.gp).sort((x, y) => y - x);
		topMpg.push(mpg[0] ?? 0);
		rotation.push(mpg.filter((m) => m >= 10).length);
		over36 += mpg.filter((m) => m > 36).length;
		const usg = rows
			.filter((r) => r.min / r.gp >= 20)
			.map((r) => r.use / r.min)
			.sort((x, y) => y - x);
		topUsg.push(usg[0] ?? 0);
	}
	playerAgg = new Map();
	const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
	log(
		`REALISM ${label}: top mpg mean ${r1(mean(topMpg))} max ${r1(Math.max(...topMpg))} | players >=10 mpg per team ${r1(mean(rotation))} | >36 mpg league ${over36} | top player shots+TO per min ${r3(mean(topUsg))}`,
	);

	// Parity
	const tss = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[season], [season, "Z"]],
	);
	const pcts = tss
		.filter((ts) => ts.won + ts.lost > 0)
		.map((ts) => ts.won / (ts.won + ts.lost));
	if (pcts.length > 0) {
		const m = mean(pcts);
		const sdPct = Math.sqrt(mean(pcts.map((x) => (x - m) ** 2)));
		log(
			`REALISM ${label}: win% sd ${r3(sdPct)} best ${r3(Math.max(...pcts))} worst ${r3(Math.min(...pcts))}`,
		);
	}
	agg = newAgg();
};

const awardPositions: Record<string, Record<string, number>> = {};
const logAwards = async () => {
	const season = g.get("season");
	const players = [...(await idb.cache.players.getAll())];
	for (const p of players) {
		for (const a of p.awards) {
			// Major awards are stored with a name (and a rank for the runners-up), the rest with a type
			const type = (a as any).name ?? a.type;
			if (
				a.season !== season ||
				type === undefined ||
				((a as any).rank ?? 1) !== 1
			) {
				continue;
			}
			if (
				![
					"Most Valuable Player",
					"Defensive Player of the Year",
					"Rookie of the Year",
					"Sixth Man of the Year",
					"Most Improved Player",
					"First Team All-League",
					"First Team All-Defensive",
				].includes(type)
			) {
				continue;
			}
			const pos =
				(p.ratings.findLast((r) => r.season <= season) ?? last(p.ratings))
					.pos ?? "?";
			const byPos = (awardPositions[type] ??= {});
			byPos[pos] = (byPos[pos] ?? 0) + 1;
		}
	}
};

const ovrSnapshot = async () => {
	const m = new Map<number, { ovr: number; pot: number; value: number }>();
	for (const p of await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.FREE_AGENT,
		Infinity,
	])) {
		const r = last(p.ratings);
		m.set(p.pid, { ovr: r.ovr, pot: r.pot, value: p.value });
	}
	return m;
};

const setSetting = async (key: string, value: boolean) => {
	const before = await ovrSnapshot();
	const changesRatings =
		(key === "ovrV2" || key === "expandedRatings") &&
		!!g.get(key as any) !== value;
	await league.setGameAttributes({ [key]: value });
	if (changesRatings) {
		await updateExpandedRatingsForLeague();
	}
	if (key === "coachingStaff" || key === "coachSystems") {
		await staff.ensureStaff();
	}
	await idb.cache.flush();
	const after = await ovrSnapshot();
	const diffs = {
		ovr: [] as number[],
		pot: [] as number[],
		value: [] as number[],
	};
	for (const [pid, b] of before) {
		const a = after.get(pid);
		if (!a) {
			continue;
		}
		for (const k of ["ovr", "pot", "value"] as const) {
			if (!Number.isFinite(a[k])) {
				problem(`${k} not finite after ${key}=${value} pid ${pid}`);
			}
			diffs[k].push(a[k] - b[k]);
		}
	}
	const stat = (xs: number[]) => {
		const meanAbs =
			xs.reduce((x, y) => x + Math.abs(y), 0) / Math.max(1, xs.length);
		const mean = xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length);
		return `mean ${r1(mean)} |mean| ${r1(meanAbs)} max ${r1(Math.max(...xs.map(Math.abs)))}`;
	};
	log(
		`${key} ${value} (${where()}): ovr ${stat(diffs.ovr)}; pot ${stat(diffs.pot)}; value ${stat(diffs.value)}`,
	);
};

// Labels the league's settings rule out (trait or expanded-only) must not be given out
const checkArchetypes = async () => {
	const land = await archetypesApi.landscape();
	if (!land.enabled) {
		return;
	}
	for (const row of land.rows) {
		const a = archetypeById(row.id);
		if (!a) {
			problem(`archetype unknown id ${row.id}`);
			continue;
		}
		if (row.count > 0 && a.trait && !g.get("playerTraits")) {
			problem(`trait archetype ${row.id} with traits off (${where()})`);
		}
		if (row.count > 0 && a.expanded && !g.get("expandedRatings")) {
			problem(
				`expanded archetype ${row.id} with expanded ratings off (${where()})`,
			);
		}
	}
};

const checkStaffsAndGms = async (label: string) => {
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	if (g.get("coachingStaff")) {
		for (const t of teams) {
			// The user's vacancies are filled at the start of the regular season
			if (t.tid === g.get("userTid") && g.get("phase") !== PHASE.PRESEASON) {
				continue;
			}
			const st = await staff.getTeamStaff(t.tid);
			if (!st.head) {
				problem(`no head coach ${t.abbrev} ${label} (${where()})`);
			}
		}
	}
	if (g.get("featureGmPersonalities")) {
		for (const t of teams) {
			if (t.tid !== g.get("userTid") && !(t as any).gm) {
				problem(`no GM ${t.abbrev} ${label} (${where()})`);
			}
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
		// NATIVE_SWEEP_ALL=off: every extra off (a stock baseline for the realism numbers, no setting toggles)
		// NATIVE_SWEEP_WITHOUT=key,key: leave those off; NATIVE_SWEEP_TOGGLES=0: no setting toggles mid-league
		const allOn = env.NATIVE_SWEEP_ALL !== "off";
		const without = new Set(String(env.NATIVE_SWEEP_WITHOUT ?? "").split(","));
		for (const f of NATIVE_FEATURES) {
			settings[f.key] = allOn && !without.has(f.key);
		}
		const toggles = allOn && env.NATIVE_SWEEP_TOGGLES !== "0";
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
				await checkNewGames();
				days += 1;
				// NATIVE_SWEEP_FLIP=1: every League Extra off on day 5 of season 1 (through the League Extras tab's call), on
				// again on day 8, loading every page each time
				if (env.NATIVE_SWEEP_FLIP === "1" && i === 1 && (days === 5 || days === 8)) {
					const on = days === 8;
					const attrs: Record<string, boolean> = {};
					for (const f of NATIVE_FEATURES) {
						if (settings[f.key]) {
							attrs[f.key] = on;
						}
					}
					await step(`flip all ${on}`, () =>
						api.main.updateGameAttributes(attrs as any),
					);
					await loadAllPages(`regular season ${i} all extras ${on ? "on" : "off"}`);
					await checkArchetypes();
				}
				if (days === 4 && toggles) {
					// Sim-Calibrated Ovr off in season 2, back on in season 4; coaching systems off in season 3, on in season 4
					if (i === 1) {
						await setSetting("ovrV2", false);
						await loadAllPages(`regular season ${i} ovrV2 off`);
					} else if (i === 2) {
						await setSetting("coachSystems", false);
						await loadAllPages(`regular season ${i} coachSystems off`);
					} else if (i === 3) {
						await setSetting("ovrV2", true);
						await setSetting("coachSystems", true);
						await loadAllPages(`regular season ${i} ovrV2+coachSystems on`);
					}
					await checkArchetypes();
				}
				if (days === 3 && toggles) {
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
					await logRealism(`season ${i} regular season`);
					await loadAllPages(`playoffs ${i}`);
					days = 1000;
				}
			}
			await checkNewGames();
			agg = newAgg();
			await logAwards();
			await checkStaffsAndGms(`after playoffs ${i}`);
			await checkArchetypes();
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
			await checkStaffsAndGms(`end of offseason ${i}`);
		}
		log(`awards by position ${JSON.stringify(awardPositions)}`);
		log(`done, ${problems.length} problems`);
	});
});
