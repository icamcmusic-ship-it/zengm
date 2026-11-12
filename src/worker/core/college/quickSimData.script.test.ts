// Not a real test: dumps the full game sim's results of a college regular season, to calibrate the quick sim (quickSim.ts).
//   QS_OUT=/tmp/qs QS_LEVEL=full vitest run --project basketball src/worker/core/college/quickSimData.script.test.ts
// writes QS_OUT.games.jsonl (one box score per line, with the teams' strengths that day) and QS_OUT.players.jsonl (composites).
// QS_QUICK=1 plays with the quick sim instead (for comparison).
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync, writeFileSync } from "node:fs";
import { describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { getCollegeLeagueTeams } from "../../../common/college/teams.ts";
import { getCollegeSettings } from "../../../common/college/settings.ts";
import { game, league, phase } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g } from "../../util/index.ts";
import { getQuickComposites, teamStrength } from "./quickSim.ts";

const env = (globalThis as any).process.env;
const OUT: string | undefined = env.QS_OUT;

describe.skipIf(!OUT)("college quick sim data", () => {
	test("dump", { timeout: 3 * 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(Number(env.QS_SEED ?? 11));
		const level = env.QS_LEVEL ?? "full";
		const { teams, confs, divs } = getCollegeLeagueTeams(level);
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
				name: "qs",
				setLeagueCreationStatus: () => {},
				settings: {
					...getDefaultSettings(),
					...getCollegeSettings(level),
					collegeQuickSim: env.QS_QUICK === "1",
				} as any,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: teams.map((t) => ({ ...t, popRank: 1 })) as any,
				// Spectator-like: the user's team is a weak school whose games barely matter
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		await phase.newPhase(PHASE.REGULAR_SEASON, {});
		writeFileSync(`${OUT}.games.jsonl`, "");
		// QS_PROF=1: CPU profile of the regular season (QS_OUT.cpuprofile)
		let post: ((m: string, a?: unknown) => Promise<any>) | undefined;
		if (env.QS_PROF) {
			// @ts-expect-error node types are not in the web tsconfig
			const inspector = await import("node:inspector");
			const session = new inspector.Session();
			session.connect();
			post = (m, a) =>
				new Promise((resolve, reject) =>
					session.post(m, a, (e: unknown, r: unknown) =>
						e ? reject(e) : resolve(r),
					),
				);
			await post("Profiler.enable");
			await post("Profiler.start");
		}
		const t0 = performance.now();
		let simSeconds = 0;
		const maxDays = Number(env.QS_DAYS ?? 999);
		let days = 0;
		while (g.get("phase") === PHASE.REGULAR_SEASON && days < maxDays) {
			const strengths: Record<number, number> = {};
			for (const t of teams) {
				const players = await idb.cache.players.indexGetAll(
					"playersByTid",
					t.tid,
				);
				strengths[t.tid] = teamStrength(players);
			}
			const sched = await idb.cache.schedule.getAll();
			const day = Math.min(...sched.map((s) => s.day));
			const ts = performance.now();
			await game.play(1, {});
			simSeconds += (performance.now() - ts) / 1000;
			days += 1;
			const games = (await idb.cache.games.getAll()).filter(
				(gm) => gm.day === day && gm.season === g.get("season"),
			);
			let lines = "";
			for (const gm of games) {
				lines += `${JSON.stringify({
					day,
					neutral: !!gm.neutralSite,
					ot: gm.overtimes,
					s: gm.teams.map((t: any) => strengths[t.tid]),
					teams: gm.teams.map((t: any) => ({
						tid: t.tid,
						stat: Object.fromEntries(
							[
								"pts",
								"fg",
								"fga",
								"tp",
								"tpa",
								"ft",
								"fta",
								"orb",
								"drb",
								"ast",
								"tov",
								"stl",
								"blk",
								"pf",
								"min",
								"ba",
								"fgAtRim",
								"fgaAtRim",
								"fgLowPost",
								"fgaLowPost",
								"fgMidRange",
								"fgaMidRange",
							].map((k) => [k, t[k]]),
						),
						players: t.players.map((p: any) => [
							p.pid,
							p.min,
							p.gs,
							p.pts,
							p.fg,
							p.fga,
							p.tp,
							p.tpa,
							p.ft,
							p.fta,
							p.orb,
							p.drb,
							p.ast,
							p.tov,
							p.stl,
							p.blk,
							p.pf,
							p.fgaAtRim,
							p.fgaLowPost,
							p.fgaMidRange,
							p.fgAtRim,
							p.fgLowPost,
							p.fgMidRange,
							p.ba,
							p.pm,
						]),
					})),
				})}\n`;
			}
			appendFileSync(`${OUT}.games.jsonl`, lines);
		}
		if (post) {
			const { profile } = await post("Profiler.stop");
			writeFileSync(`${OUT}.cpuprofile`, JSON.stringify(profile));
		}
		let lines = "";
		for (const t of teams) {
			const players = await idb.cache.players.indexGetAll(
				"playersByTid",
				t.tid,
			);
			for (const p of players) {
				lines += `${JSON.stringify({
					pid: p.pid,
					tid: p.tid,
					ovr: last(p.ratings).ovr,
					c: getQuickComposites(p),
				})}\n`;
			}
		}
		writeFileSync(`${OUT}.players.jsonl`, lines);
		writeFileSync(
			`${OUT}.time.json`,
			JSON.stringify({
				level,
				days,
				total: (performance.now() - t0) / 1000,
				simSeconds,
			}),
		);
	});
});
