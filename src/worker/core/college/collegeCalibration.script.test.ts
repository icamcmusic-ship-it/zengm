// Not a real test: calibration of the game sim tendencies for college mode (COLLEGE_SIM_CALIBRATION in common/college/settings.ts).
// Creates a power conference college league, plays CAL_DAYS days and appends one JSON line of per team game stats to CAL_OUT.
//
//   CAL_OUT=/tmp/cal.jsonl CAL='{"pace":90}' node_modules/.bin/vitest run --project basketball \
//     src/worker/core/college/collegeCalibration.script.test.ts
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync } from "node:fs";
import { describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { getCollegeLeagueTeams } from "../../../common/college/teams.ts";
import { getCollegeSettings } from "../../../common/college/settings.ts";
import { game, league, phase, team } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g } from "../../util/index.ts";

const env = (globalThis as any).process.env;
const OUT: string | undefined = env.CAL_OUT;

describe.skipIf(!OUT)("college calibration", () => {
	test("stats", { timeout: 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(Number(env.CAL_SEED ?? 3));
		const overrides = env.CAL ? JSON.parse(env.CAL) : {};
		const level = env.CAL_LEVEL ?? "power";
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
				name: "cal",
				setLeagueCreationStatus: () => {},
				settings: {
					...getDefaultSettings(),
					...getCollegeSettings(level),
					...overrides,
				} as any,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: teams.map((t) => ({ ...t, popRank: 1 })) as any,
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		await phase.newPhase(PHASE.REGULAR_SEASON, {});
		await game.play(Number(env.CAL_DAYS ?? 12), {});

		const rows = await team.getFormattedAll({
			attrs: ["tid"],
			stats: [
				"gp",
				"pts",
				"fg",
				"fga",
				"tp",
				"tpa",
				"ft",
				"fta",
				"pace",
				"tov",
				"orb",
				"drb",
				"ast",
				"stl",
				"blk",
				"pf",
			],
			season: g.get("season"),
		});
		const sum: Record<string, number> = {};
		let gp = 0;
		for (const t of rows as any[]) {
			gp += t.stats.gp;
			for (const [k, v] of Object.entries(t.stats)) {
				sum[k] = (sum[k] ?? 0) + (v as number) * t.stats.gp;
			}
		}
		const per = (k: string) => Math.round((sum[k]! / gp) * 10) / 10;
		const ovrs: number[] = [];
		for (const t of teams) {
			const players = await idb.cache.players.indexGetAll(
				"playersByTid",
				t.tid,
			);
			ovrs.push(
				...players
					.map((p) => last(p.ratings).ovr)
					.sort((a, b) => b - a)
					.slice(0, 8),
			);
		}
		appendFileSync(
			OUT,
			`${JSON.stringify({
				cal: overrides,
				games: gp / 2,
				pts: per("pts"),
				fgp: Math.round((sum.fg! / sum.fga!) * 1000) / 10,
				fga: per("fga"),
				tpaRate: Math.round((sum.tpa! / sum.fga!) * 1000) / 10,
				tpp: Math.round((sum.tp! / sum.tpa!) * 1000) / 10,
				fta: per("fta"),
				ftp: Math.round((sum.ft! / sum.fta!) * 1000) / 10,
				tov: per("tov"),
				orb: per("orb"),
				drb: per("drb"),
				ast: per("ast"),
				stl: per("stl"),
				blk: per("blk"),
				pf: per("pf"),
				pace: per("pace"),
				top8Ovr:
					Math.round((ovrs.reduce((a, b) => a + b, 0) / ovrs.length) * 10) / 10,
			})}\n`,
		);
	});
});
