// @ts-nocheck (diagnostic script)
// All-Star Game scoring calibration: a new league with the new-league defaults, its All-Stars picked, then ASG_GAMES All-Star Games
// simulated from the same rosters with different seeds. Prints points, pace, threes, free throws and at-rim makes per team, and the
// minutes spread. Run with ASG_CAL=1 npx vitest run --maxWorkers=2 --project basketball <this file>
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { allStar, game, league, phase } from "../index.ts";
import { lock } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../../util/index.ts";
import loadTeams from "../game/loadTeams.ts";
import GameSim from "../GameSim.basketball/index.ts";

const env = (globalThis as any).process.env;

test.skipIf(!env.ASG_CAL)(
	"All-Star Game scoring",
	{ timeout: 60 * 60 * 1000 },
	async () => {
		const numGames = Number(env.ASG_GAMES ?? 40);
		const leagueSeeds = (env.ASG_SEEDS ?? "1").split(",").map(Number);
		const rows = [];
		let lid = 0;
		for (const leagueSeed of leagueSeeds) {
			Math.random = makeSeededRandom(leagueSeed);
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
					lid: lid++,
					name: `asg${leagueSeed}`,
					setLeagueCreationStatus: () => {},
					settings: { ...getDefaultSettings(), spectator: true },
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			if (env.ASG_TYPE) {
				g.setWithoutSavingToDB("allStarType", env.ASG_TYPE);
			}
			const allStars = await allStar.create({});
			await idb.cache.allStars.put(allStars);
			const teams = await loadTeams([-1, -2], {});
			if (env.ASG_WEEKEND) {
				const after = await idb.cache.allStars.get(g.get("season"));
				writeFileSync(env.ASG_WEEKEND, JSON.stringify(after, null, 1));
			}
			for (let i = 0; i < numGames; i++) {
				Math.random = makeSeededRandom(1000 * leagueSeed + i);
				const result = new GameSim({
					gid: i,
					day: 0,
					teams: [helpers.deepCopy(teams[-1]), helpers.deepCopy(teams[-2])],
					doPlayByPlay: false,
					homeCourtFactor: 1,
					allStarGame: true,
					baseInjuryRate: 0,
					neutralSite: true,
				}).run();
				for (const t of result.team) {
					const s = t.stat;
					const mins = t.player.map((p) => p.stat.min).filter((m) => m > 0);
					rows.push({
						pts: s.pts,
						fga: s.fga,
						tpa: s.tpa,
						tp: s.tp,
						fta: s.fta,
						rim: s.fgAtRim,
						rimA: s.fgaAtRim,
						tov: s.tov,
						pf: s.pf,
						ot: result.overtimes,
						maxMin: Math.max(...mins),
						minMin: Math.min(...mins),
						nPlayed: mins.length,
					});
				}
			}
		}
		const avg = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
		const sorted = rows.map((r) => r.pts).sort((a, b) => a - b);
		writeFileSync(
			env.ASG_OUT ?? "/dev/stdout",
			JSON.stringify(
				{
					n: rows.length,
					pts: avg("pts"),
					ptsP10: sorted[Math.floor(rows.length * 0.1)],
					ptsP90: sorted[Math.floor(rows.length * 0.9)],
					ptsMin: sorted[0],
					ptsMax: sorted.at(-1),
					fga: avg("fga"),
					tpa: avg("tpa"),
					tpPct: avg("tp") / avg("tpa"),
					fta: avg("fta"),
					rimMakes: avg("rim"),
					rimA: avg("rimA"),
					tov: avg("tov"),
					pf: avg("pf"),
					maxMin: avg("maxMin"),
					minMin: avg("minMin"),
					nPlayed: avg("nPlayed"),
				},
				null,
				1,
			),
		);
	},
);

// The whole weekend through the real schedule: a short season played to the All-Star break, then the stored results.
// ASG_PLAY=1 (ASG_TYPE=tournament for the tournament), writes the AllStars object and the game's box score to ASG_PLAY_OUT
test.skipIf(!env.ASG_PLAY)(
	"All-Star weekend through the schedule",
	{ timeout: 60 * 60 * 1000 },
	async () => {
		Math.random = makeSeededRandom(3);
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
				lid: 99,
				name: "asgplay",
				setLeagueCreationStatus: () => {},
				settings: {
					...getDefaultSettings(),
					spectator: true,
					numGames: 16,
					...(env.ASG_TYPE ? { allStarType: env.ASG_TYPE } : {}),
				},
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		await phase.newPhase(PHASE.REGULAR_SEASON, {});
		await lock.set("gameSim", false);
		let guard = 0;
		while (
			(await idb.cache.allStars.get(g.get("season")))?.gid === undefined &&
			guard < 40
		) {
			await game.play(1, {});
			guard += 1;
		}
		const allStars = await idb.cache.allStars.get(g.get("season"));
		const box =
			allStars?.gid !== undefined
				? await idb.cache.games.get(allStars.gid)
				: undefined;
		writeFileSync(
			env.ASG_PLAY_OUT ?? "/dev/stdout",
			JSON.stringify({ allStars, box, guard }, null, 1),
		);
	},
);
