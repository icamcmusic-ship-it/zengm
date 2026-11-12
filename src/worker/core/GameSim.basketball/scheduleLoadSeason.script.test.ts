// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Load, Fatigue & Venue over whole regular seasons of a real league (the default league with the new-league settings), with the realistic
// schedule length on and off: in-game injuries per team game, home win%, back-to-backs and 3-in-4s per team, with scheduleLoad off and on.
// Run with SL_SEASON=1 npx vitest run --maxWorkers=2 --project basketball --silent=false <this file> (SL_SEEDS=2 seeds per config)
import "fake-indexeddb/auto";
import { test } from "vitest";
import GameSim from "./index.ts";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { game, league, phase, season } from "../index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { helpers, lock } from "../../util/index.ts";

let acc;
// (the counters are only installed for a calibration run: the other test files share these classes)
if (process.env.SL_SEASON) {
	const proto = GameSim.prototype;
	const origRun = proto.run;
	proto.run = function () {
		const b2b = this.team.map((t) => !!t.backToBack);
		const t34 = this.team.map((t) => !!t.threeInFour);
		const out = origRun.call(this);
		if (!this.allStarGame) {
			acc.games += 1;
			acc.home += out.team[0].stat.pts > out.team[1].stat.pts ? 1 : 0;
			for (const i of [0, 1]) {
				acc.b2b += b2b[i] ? 1 : 0;
				acc.t34 += t34[i] ? 1 : 0;
				for (const p of out.team[i].player) {
					acc.inj += p.newInjury ? 1 : 0;
				}
			}
		}
		return out;
	};
}

test.skipIf(!process.env.SL_SEASON)(
	"seasons",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seeds = Number(process.env.SL_SEEDS ?? 2);
		const lines = [];
		let lid = 0;
		for (const realisticSchedule of [true, false]) {
			for (const scheduleLoad of [false, true]) {
				acc = { games: 0, home: 0, inj: 0, b2b: 0, t34: 0 };
				for (let seed = 1; seed <= seeds; seed++) {
					Math.random = makeSeededRandom(seed);
					const settings: any = getDefaultSettings();
					settings.realisticSchedule = realisticSchedule;
					settings.scheduleLoad = scheduleLoad;
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
							name: `sl${seed}`,
							setLeagueCreationStatus: () => {},
							settings,
							shuffleRosters: false,
							startingSeasonFromInput: "2025",
							teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
							tid: 0,
						},
					);
					await league.loadGameAttributes();
					await phase.newPhase(PHASE.REGULAR_SEASON, {});
					await lock.set("gameSim", false);
					await game.play(await season.getDaysLeftSchedule(), {});
				}
				const teamGames = 2 * acc.games;
				lines.push(
					`realisticSchedule ${realisticSchedule} scheduleLoad ${scheduleLoad} | games ${acc.games} | injuries per team game ${(acc.inj / teamGames).toFixed(4)} | home win ${(acc.home / acc.games).toFixed(4)} | b2b per 82 ${((82 * acc.b2b) / teamGames).toFixed(1)} | 3-in-4 per 82 ${((82 * acc.t34) / teamGames).toFixed(1)}`,
				);
				console.log(lines.at(-1));
			}
		}
		console.log(lines.join("\n"));
	},
);
