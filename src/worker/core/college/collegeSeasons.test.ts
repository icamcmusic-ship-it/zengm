// Headless multi-season college league (docs/college-mode.md): created, then played through every phase the way the play menu does it, for
// three seasons. Checks the calendar, rosters, the national tournament, recruiting and departures. COLLEGE_LEVEL picks the size (default
// power); COLLEGE_SEASONS the number of seasons; COLLEGE_BENCH=<file> appends seconds per regular season and the stat line per team game.
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync } from "node:fs";
import { assert, describe, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	getCollegeLeagueTeams,
	type CollegeLevel,
} from "../../../common/college/teams.ts";
import { getCollegeSettings } from "../../../common/college/settings.ts";
import { game, league, phase, team } from "../index.ts";
import * as views from "../../views/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, local, lock } from "../../util/index.ts";
import { getCollegeArchive } from "./archive.ts";

const env = (globalThis as any).process.env;
const LEVEL = (env.COLLEGE_LEVEL ?? "power") as CollegeLevel;
const SEASONS = Number(env.COLLEGE_SEASONS ?? 3);
// File to append one JSON line per season to (seconds per regular season, stats per team game)
const BENCH: string | undefined = env.COLLEGE_BENCH;

const where = () => `season ${g.get("season")} phase ${g.get("phase")}`;

const step = async (name: string, f: () => Promise<unknown>) => {
	await f();
	for (const key of ["gameSim", "newPhase", "drafting"] as const) {
		assert.isFalse(
			lock.get(key),
			`lock ${key} still set after ${name} (${where()})`,
		);
	}
	assert.isUndefined(local.autoPlayUntil);
};

const loadView = async (id: string, params: Record<string, unknown> = {}) => {
	const view = (views as any)[id];
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	const out = await view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: inputs,
		prevOutput: {},
		conditions: {},
	});
	assert.isUndefined(
		(out as any)?.errorMessage,
		`${id}: ${(out as any)?.errorMessage}`,
	);
	return out;
};

describe("college mode", () => {
	test("seasons", { timeout: 6 * 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(7);
		const { teams, confs, divs } = getCollegeLeagueTeams(LEVEL);
		const settings: any = {
			...getDefaultSettings(),
			...getCollegeSettings(LEVEL),
		};
		const userTid = teams.findIndex((t) => t.region === "Duke");
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
				name: "college",
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: teams.map((t) => ({ ...t, popRank: 1 })) as any,
				tid: Math.max(0, userTid),
			},
		);
		await league.loadGameAttributes();
		assert.strictEqual(g.get("leagueType"), "college");
		assert.strictEqual(g.get("numActiveTeams"), teams.length);

		const checkRosters = async (label: string) => {
			for (const t of teams) {
				const players = await idb.cache.players.indexGetAll(
					"playersByTid",
					t.tid,
				);
				assert.isAtMost(players.length, 13, `${label}: ${t.region} roster`);
				assert.isAtLeast(players.length, 9, `${label}: ${t.region} roster`);
				for (const p of players) {
					const age = g.get("season") - p.born.year;
					assert.isAtLeast(age, 17, `${label}: age`);
					assert.isAtMost(age, 25, `${label}: age`);
				}
			}
			assert.lengthOf(
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.FREE_AGENT),
				0,
				"free agents",
			);
		};

		const start = g.get("season");
		for (let i = 0; i < SEASONS; i++) {
			assert.strictEqual(g.get("phase"), PHASE.PRESEASON, where());
			await checkRosters(`preseason ${i}`);
			const recruits = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			).filter((p) => p.draft.year === g.get("season"));
			assert.isAbove(recruits.length, teams.length * 3, "recruiting class");

			await step("regular season", () =>
				phase.newPhase(PHASE.REGULAR_SEASON, {}),
			);
			const t0 = performance.now();
			let days = 0;
			while (g.get("phase") === PHASE.REGULAR_SEASON) {
				await step(`day ${days}`, () => game.play(1, {}));
				days += 1;
				assert.isBelow(days, 80, where());
			}
			const regSeconds = (performance.now() - t0) / 1000;
			assert.strictEqual(
				g.get("phase"),
				PHASE.AFTER_TRADE_DEADLINE,
				"conference tournaments",
			);
			await loadView("collegePolls", {});
			await loadView("collegeConfTournaments", {});
			while (g.get("phase") === PHASE.AFTER_TRADE_DEADLINE) {
				await step(`conf tournament day ${days}`, () => game.play(1, {}));
				days += 1;
				assert.isBelow(days, 100, where());
			}
			assert.strictEqual(g.get("phase"), PHASE.PLAYOFFS);
			// No salaries in college, so no minimum payroll penalty or luxury tax
			const moneyEvents = (await idb.cache.events.getAll()).filter(
				(e) => e.type === "minPayroll" || e.type === "luxuryTax",
			);
			assert.lengthOf(moneyEvents, 0, "payroll penalty events");
			const ps = await idb.cache.playoffSeries.get(g.get("season"));
			assert.isAtLeast(ps!.series[0]!.length * 2, 16);
			await loadView("collegePolls", {});
			while (g.get("phase") === PHASE.PLAYOFFS) {
				await step(`tournament day ${days}`, () => game.play(1, {}));
				days += 1;
				assert.isBelow(days, 120, where());
			}
			assert.strictEqual(g.get("phase"), PHASE.DRAFT_LOTTERY);
			const champion = (
				await idb.cache.teamSeasons.indexGetAll("teamSeasonsBySeasonTid", [
					[g.get("season")],
					[g.get("season"), "Z"],
				])
			).filter(
				(ts) =>
					ts.playoffRoundsWon ===
					g.get("numGamesPlayoffSeries", "current").length,
			);
			assert.lengthOf(champion, 1, "champion");

			await step("departures", () => phase.newPhase(PHASE.DRAFT, {}));
			const archive = await getCollegeArchive(g.get("season"));
			assert.isAbove(archive?.proDraft?.length ?? 0, 0, "pro draft");
			assert.isAbove(archive?.polls?.length ?? 0, 10, "polls");
			await loadView("collegeDepartures", {});
			await step("portal", () => phase.newPhase(PHASE.AFTER_DRAFT, {}));
			await step("recruiting", () => phase.newPhase(PHASE.RESIGN_PLAYERS, {}));
			await loadView("collegeRecruiting", {});
			await step("signing day", () => phase.newPhase(PHASE.FREE_AGENCY, {}));
			await checkRosters(`after signing day ${i}`);
			for (const t of teams) {
				const n = (await idb.cache.players.indexGetAll("playersByTid", t.tid))
					.length;
				assert.strictEqual(n, 13, `${t.region} full after signing day`);
			}
			await step("preseason", () => phase.newPhase(PHASE.PRESEASON, {}));
			assert.strictEqual(g.get("season"), start + i + 1);

			if (BENCH) {
				// Stat line per team game of the regular season just played
				const stats = await team.getFormattedAll({
					attrs: ["tid"],
					stats: [
						"gp",
						"pts",
						"fg",
						"fga",
						"tp",
						"tpa",
						"fta",
						"pace",
						"tov",
						"orb",
						"drb",
					],
					season: g.get("season") - 1,
				});
				const sum: Record<string, number> = {};
				for (const t of stats as any[]) {
					for (const [k, v] of Object.entries(t.stats)) {
						sum[k] = (sum[k] ?? 0) + (v as number) * (t.stats.gp as number);
					}
				}
				const gp =
					sum.gp! > 0
						? (stats as any[]).reduce((a, t) => a + t.stats.gp, 0)
						: 1;
				const per = (k: string) => Math.round((sum[k]! / gp) * 10) / 10;
				appendFileSync(
					BENCH,
					`${JSON.stringify({
						level: LEVEL,
						teams: teams.length,
						regSeasonSeconds: Math.round(regSeconds * 10) / 10,
						days,
						pts: per("pts"),
						fgp: Math.round((sum.fg! / sum.fga!) * 1000) / 10,
						tpaRate: Math.round((sum.tpa! / sum.fga!) * 1000) / 10,
						tpp: Math.round((sum.tp! / sum.tpa!) * 1000) / 10,
						fta: per("fta"),
						tov: per("tov"),
						pace: per("pace"),
						season: i,
					})}\n`,
				);
			}
		}
	});
});
