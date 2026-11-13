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
import { setRedshirt } from "./redshirt.ts";
import { getClassYear } from "./offseason.ts";
import { getCollegeTournamentSize } from "../../../common/college/teams.ts";
import { getNitSize } from "./postseason.ts";
import {
	advanceOffseasonWeek,
	getPortalPlayers,
	getRecruitingState,
	userAction,
} from "./recruiting.ts";
import {
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";

const env = (globalThis as any).process.env;
const LEVEL = (env.COLLEGE_LEVEL ?? "power") as CollegeLevel;
const SEASONS = Number(env.COLLEGE_SEASONS ?? 3);
// File to append one JSON line per season to (seconds per regular season, stats per team game)
const BENCH: string | undefined = env.COLLEGE_BENCH;
// COLLEGE_QUICK=1/0: the quick sim on or off all along. Default: the level's default, and on from the second season (so both paths run)
const QUICK: string | undefined = env.COLLEGE_QUICK;
// File to append one JSON line per season to: players by class year in the preseason, the portal's yield (share of entrants who moved)
const LOG: string | undefined = env.COLLEGE_LOG;
const logLine = (x: Record<string, unknown>) => {
	if (LOG) {
		appendFileSync(LOG, `${JSON.stringify(x)}\n`);
	}
};

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

// The user's recruiting during the season: a few top recruits worked on every week
const userRecruitingWeek = async () => {
	const recruits = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
	)
		.filter((p: any) => p.draft.year === g.get("season") && p.recruit)
		.sort((a: any, b: any) => a.recruit.rank - b.recruit.rank);
	const userTid = g.get("userTid");
	// Recruits a school like the user's can get: past the first few dozen
	const pool = recruits.slice(30, 60);
	for (const p of pool.slice(0, 6)) {
		const box = (p as any).recruit;
		if (box.commit !== undefined && box.commit !== userTid) {
			continue;
		}
		const si = box.schools?.find((s: any) => s.tid === userTid);
		if (!si?.o) {
			await userAction({ pid: p.pid, action: "offer" });
		}
		if ((box.scout ?? 0) === 0) {
			await userAction({ pid: p.pid, action: "scout" });
		}
		await userAction({ pid: p.pid, action: "homeVisit", pitch: "prestige" });
	}
	const state = g.get("collegeRecruiting");
	if (state && state.officialVisits > 0) {
		const p = pool.find((p: any) => p.recruit.commit === undefined);
		if (p) {
			await userAction({ pid: p.pid, action: "officialVisit", pitch: "coach" });
		}
	}
};

const runLeague = async ({
	level,
	seasons,
	lid,
	quick,
}: {
	level: CollegeLevel;
	seasons: number;
	lid: number;
	quick: string | undefined;
}) => {
	const LEVEL = level;
	const SEASONS = seasons;
	const QUICK = quick;
	{
		Math.random = makeSeededRandom(7);
		const { teams, confs, divs } = getCollegeLeagueTeams(LEVEL);
		const settings: any = {
			...getDefaultSettings(),
			...getCollegeSettings(LEVEL),
			...(QUICK !== undefined ? { collegeQuickSim: QUICK === "1" } : {}),
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
				lid,
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
			if (i === 1 && QUICK === undefined) {
				await league.setGameAttributes({ collegeQuickSim: true });
			}
			await checkRosters(`preseason ${i}`);
			if (LOG) {
				const byYear: Record<string, number> = {};
				for (const p of await idb.cache.players.indexGetAll("playersByTid", [
					0,
					Infinity,
				])) {
					const y = String(getClassYear(p as any));
					byYear[y] = (byYear[y] ?? 0) + 1;
				}
				logLine({ level, season: g.get("season"), byYear });
			}
			const recruits = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			).filter((p: any) => p.draft.year === g.get("season") && p.recruit);
			assert.isAbove(recruits.length, teams.length * 3, "recruiting class");

			await step("regular season", () =>
				phase.newPhase(PHASE.REGULAR_SEASON, {}),
			);
			// The user recruits by hand in the first season, the AI does it after
			await league.setGameAttributes({ collegeAutoRecruit: i > 0 });
			const pointsBefore = (await getRecruitingState()).points;
			if (i === 0) {
				await userRecruitingWeek();
				assert.isBelow(
					(await getRecruitingState()).points,
					pointsBefore,
					"actions cost points",
				);
			}
			// Redshirt one of the user's freshmen: he does not play, and keeps the year
			let redshirtPid: number | undefined;
			let redshirtExp: number | undefined;
			if (i === 0) {
				const fr = (
					await idb.cache.players.indexGetAll("playersByTid", g.get("userTid"))
				).find((p: any) => p.classYear === 1);
				assert.isDefined(fr, "a freshman");
				redshirtExp = getContractExp(getCurrentContract(fr!)!);
				assert.isTrue(await setRedshirt(fr!, true));
				redshirtPid = fr!.pid;
				assert.strictEqual(
					getContractExp(getCurrentContract(fr!)!),
					redshirtExp! + 1,
				);
				redshirtExp = redshirtExp! + 1;
			}
			const t0 = performance.now();
			let days = 0;
			let recruitingWeek = (await getRecruitingState()).week;
			while (g.get("phase") === PHASE.REGULAR_SEASON) {
				await step(`day ${days}`, () => game.play(1, {}));
				days += 1;
				assert.isBelow(days, 80, where());
				const week = g.get("collegeRecruiting")?.week ?? 0;
				if (i === 0 && week > recruitingWeek) {
					recruitingWeek = week;
					await userRecruitingWeek();
				}
			}
			// Recruiting weeks went by and recruits committed during the season, to AI schools and (working on them) the user's
			assert.isAtLeast(
				(await getRecruitingState()).week,
				8,
				"recruiting weeks in the season",
			);
			const inSeason = (
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
			).filter(
				(p: any) =>
					p.draft.year === g.get("season") && p.recruit?.commit !== undefined,
			);
			assert.isAbove(
				inSeason.length,
				teams.length / 4,
				"in-season commitments",
			);
			if (i === 0) {
				assert.isTrue(
					inSeason.some((p: any) => p.recruit.commit === g.get("userTid")),
					"a recruit committed to the user's school",
				);
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
			const tourneySize = getCollegeTournamentSize(teams.length);
			{
				const state = g.get("collegeState")!;
				if (tourneySize === 64) {
					// First Four: four games played before the bracket, losers out of it
					assert.lengthOf(state.firstFour ?? [], 4, "First Four");
					assert.lengthOf(state.selection!.field, 68, "68-team field");
					const losers = state.firstFour!.map((m) => {
						assert.isDefined(m.pts, "First Four game played");
						return m.pts![0] > m.pts![1] ? m.away : m.home;
					});
					const ps0 = await idb.cache.playoffSeries.get(g.get("season"));
					const inBracket = ps0!.series[0]!.flatMap((m) => [
						m.home.tid,
						m.away!.tid,
					]);
					assert.lengthOf(inBracket, 64, "64-team bracket");
					for (const tid of losers) {
						assert.notInclude(inBracket, tid, "First Four loser");
					}
					const autos = state.firstFour!.filter((m) => m.bid === "auto");
					assert.lengthOf(autos, 2, "two First Four games of automatic bids");
				} else {
					assert.isUndefined(state.firstFour);
				}
				// NIT: half the national field, nobody in both
				const nitSize = getNitSize(
					teams.length,
					tourneySize,
					state.selection!.field.length,
				);
				assert.lengthOf(state.nit?.seeds ?? [], nitSize, "NIT field");
				const field = new Set(state.selection!.field.map((t) => t.tid));
				for (const tid of state.nit?.seeds ?? []) {
					assert.isFalse(field.has(tid), "NIT team in the national field");
				}
				for (const tid of state.nit?.autoBids ?? []) {
					assert.include(state.nit!.seeds, tid, "NIT automatic bid");
				}
				await loadView("collegeNit", {});
			}
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
			{
				const state = g.get("collegeState")!;
				assert.isDefined(state.nit?.champion, "NIT champion");
				const nitChampSeason = await idb.cache.teamSeasons.indexGet(
					"teamSeasonsBySeasonTid",
					[g.get("season"), state.nit!.champion!],
				);
				assert.strictEqual(
					nitChampSeason!.playoffRoundsWon,
					-1,
					"NIT champion is not in the national tournament",
				);
				// NIT games: their own stats rows (nitStats), not the postseason stats or the team's postseason stats
				const nitTid = state.nit!.champion!;
				const nitPlayers = await idb.cache.players.indexGetAll(
					"playersByTid",
					nitTid,
				);
				assert.isTrue(
					nitPlayers.some((p) =>
						(p.nitStats ?? []).some(
							(row) => row.season === g.get("season") && (row.gp ?? 0) > 0,
						),
					),
					"NIT stats rows",
				);
				for (const p of nitPlayers) {
					assert.isFalse(
						p.stats.some(
							(row) => row.season === g.get("season") && row.playoffs,
						),
						"no postseason stats from the NIT",
					);
				}
				const teamStats = (await idb.cache.teamStats.getAll()).filter(
					(row) =>
						row.tid === nitTid &&
						row.playoffs &&
						row.season === g.get("season"),
				);
				assert.lengthOf(teamStats, 0, "no postseason team stats from the NIT");
				const nitGames = (await idb.cache.games.getAll()).filter(
					(gm) => gm.season === g.get("season") && gm.nit,
				);
				assert.isAtLeast(nitGames.length, 1, "NIT box scores tagged");
			}

			// College awards
			const awards = await idb.cache.awards.get(g.get("season"));
			const names = new Set((awards?.awards ?? []).map((a: any) => a.name));
			for (const name of [
				"Player of the Year",
				"Freshman of the Year",
				"Defensive Player of the Year",
				"All-American",
				"All-Conference",
			]) {
				assert.isTrue(names.has(name), `award ${name}`);
			}
			const aa = awards!.awards.find((a: any) => a.shortName === "AA") as any;
			assert.lengthOf(aa.winner, 3, "three All-American teams");
			const cpoy = awards!.awards.filter((a: any) => a.shortName === "CPOY");
			assert.isAtLeast(cpoy.length, 2, "conference players of the year");
			const history = (await loadView("history", {
				season: String(g.get("season")),
			})) as any;
			assert.isDefined(history.college.nitChampion, "NIT champion in history");
			assert.isDefined(
				(await getCollegeArchive(g.get("season")))?.nit?.champion,
				"NIT champion archived",
			);
			if (redshirtPid !== undefined) {
				const p = await idb.cache.players.get(redshirtPid);
				if (p && p.tid >= 0) {
					const gp = p.stats
						.filter((row) => row.season === g.get("season"))
						.reduce((a, row) => a + (row.gp ?? 0), 0);
					assert.strictEqual(gp, 0, "redshirt did not play");
				}
			}

			await step("departures", () => phase.newPhase(PHASE.DRAFT, {}));
			const archive = await getCollegeArchive(g.get("season"));
			assert.isAbove(archive?.proDraft?.length ?? 0, 0, "pro draft");
			assert.isAbove(archive?.polls?.length ?? 0, 10, "polls");
			await loadView("collegeDepartures", {});
			await step("portal", () => phase.newPhase(PHASE.AFTER_DRAFT, {}));
			const portal = await getPortalPlayers();
			assert.isAbove(portal.length, 0, "players in the portal");
			{
				// His player page loads (a contract to read for the mood) and says where he is
				const view = (await loadView("player", {
					pid: String(portal[0]!.pid),
				})) as any;
				assert.strictEqual(view.teamName, "Transfer Portal");
			}
			for (const t of teams) {
				const n = (await idb.cache.players.indexGetAll("playersByTid", t.tid))
					.length;
				assert.isAtMost(n, 13, "portal: roster limit");
			}
			await loadView("collegePortal", {});
			if (i === 0) {
				// The user recruits a portal player and makes a retention pitch on his own
				const userTid = g.get("userTid");
				const own = portal.find((p) => p.portal!.from === userTid);
				if (own) {
					assert.isUndefined(
						await userAction({ pid: own.pid, action: "retain", pitch: "pt" }),
					);
				}
				const target = portal.find((p) => p.portal!.from !== userTid);
				const offer = await userAction({ pid: target!.pid, action: "offer" });
				// Verbal commitments of next year's class hold scholarships too
				const userCommits = (
					await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
				).filter(
					(p: any) =>
						p.draft.year === g.get("season") && p.recruit?.commit === userTid,
				).length;
				const spots =
					13 -
					userCommits -
					(await idb.cache.players.indexGetAll("playersByTid", userTid)).length;
				if (spots > 0) {
					assert.isUndefined(offer, "portal offer");
				}
				for (let w = 0; w < 2; w++) {
					assert.isTrue(await advanceOffseasonWeek(), "portal week");
					for (const t of teams) {
						const n = (
							await idb.cache.players.indexGetAll("playersByTid", t.tid)
						).length;
						assert.isAtMost(n, 13, "portal week: roster limit");
					}
				}
			}
			await step("recruiting", () => phase.newPhase(PHASE.RESIGN_PLAYERS, {}));
			assert.lengthOf(await getPortalPlayers(), 0, "portal closed");
			{
				const moved =
					(await getCollegeArchive(g.get("season")))?.transfers?.length ?? 0;
				logLine({
					level,
					season: g.get("season"),
					portal: portal.length,
					moved,
					yield: Math.round((100 * moved) / portal.length) / 100,
				});
			}
			assert.isAbove(
				(await getCollegeArchive(g.get("season")))?.transfers?.length ?? 0,
				0,
				"transfers",
			);
			// Rosters can be short until signing day, never over the limit, and nobody is left in the portal
			for (const t of teams) {
				const n = (await idb.cache.players.indexGetAll("playersByTid", t.tid))
					.length;
				assert.isAtMost(n, 13, `after the portal: ${t.region} roster`);
			}
			assert.lengthOf(
				await idb.cache.players.indexGetAll("playersByTid", PLAYER.FREE_AGENT),
				0,
				"free agents after the portal",
			);
			for (const p of await idb.cache.players.indexGetAll("playersByTid", [
				0,
				Infinity,
			])) {
				assert.isAtMost((p as any).transfers ?? 0, 1, "one transfer");
			}
			await loadView("collegeRecruiting", {});
			const committed = new Map(
				(await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED))
					.filter(
						(p: any) =>
							p.draft.year === g.get("season") &&
							p.recruit?.commit !== undefined,
					)
					.map((p: any) => [p.pid, p.recruit.commit as number]),
			);
			await step("signing day", () => phase.newPhase(PHASE.FREE_AGENCY, {}));
			// Signing day: the commitments hold, and the class rankings are made
			let kept = 0;
			for (const [pid, tid] of committed) {
				const p = await idb.cache.players.get(pid);
				if (p?.tid === tid) {
					kept += 1;
				}
			}
			assert.isAtLeast(kept, committed.size * 0.9, "commitments signed");
			const rankings = (await getCollegeArchive(g.get("season")))
				?.classRankings;
			assert.isAbove(rankings?.length ?? 0, teams.length / 2, "class rankings");
			assert.strictEqual(rankings![0]!.rank, 1);
			await loadView("collegeRecruiting", {});
			await checkRosters(`after signing day ${i}`);
			for (const t of teams) {
				const n = (await idb.cache.players.indexGetAll("playersByTid", t.tid))
					.length;
				assert.strictEqual(n, 13, `${t.region} full after signing day`);
			}
			await step("preseason", () => phase.newPhase(PHASE.PRESEASON, {}));
			if (i === 0 && redshirtPid !== undefined) {
				const p = (await idb.cache.players.get(redshirtPid)) as any;
				if (p && p.tid >= 0) {
					assert.strictEqual(p.classYear, 1, "redshirt keeps his year");
					assert.strictEqual(
						getContractExp(getCurrentContract(p)!),
						redshirtExp,
					);
				}
			}
			assert.strictEqual(g.get("season"), start + i + 1);
			const board = (await loadView("collegeRecruiting", {})) as any;
			assert.isAbove(
				board.recruits.length,
				0,
				"recruiting board in the preseason",
			);
			assert.strictEqual(
				(await getRecruitingState()).week,
				0,
				"recruiting state reset",
			);

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
						quickSim: g.get("collegeQuickSim"),
						season: i,
					})}\n`,
				);
			}
		}
	}
};

describe("college mode", () => {
	test("seasons", { timeout: 6 * 60 * 60 * 1000 }, async () => {
		await runLeague({ level: LEVEL, seasons: SEASONS, lid: 0, quick: QUICK });
	});

	// The 64-team bracket (First Four, 32-team NIT) needs the full size: one season with the quick sim
	test.skipIf(env.COLLEGE_SKIP_FULL === "1" || LEVEL === "full")(
		"full size: First Four and NIT",
		{ timeout: 60 * 60 * 1000 },
		async () => {
			await runLeague({ level: "full", seasons: 1, lid: 1, quick: "1" });
		},
	);
});
