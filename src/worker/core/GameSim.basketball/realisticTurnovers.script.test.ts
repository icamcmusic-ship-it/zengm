// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Calibration of Realistic Turnovers (realisticTurnovers.ts) over whole regular seasons of new leagues (the default league with the
// new-league settings, so every League Extra at its new-league default): league per-team-game averages with the setting off and on.
// Run with
// RT_CAL=1 npx vitest run --maxWorkers=2 --project basketball --silent=false <this file>
// (RT_SEEDS=8 leagues per config, RT_SEED0 the first seed, RT_CONFIGS='[{"realisticTurnovers":false},{"realisticTurnovers":true}]'
// settings on top of the new-league defaults, RT_SET='{"tovMult":0.9}' to change the constants)
import "fake-indexeddb/auto";
import { test } from "vitest";
import GameSim from "./index.ts";
import { TURNOVERS } from "./realisticTurnovers.ts";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { game, league, phase, season } from "../index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { helpers, lock } from "../../util/index.ts";

if (process.env.RT_SET) {
	Object.assign(TURNOVERS, JSON.parse(process.env.RT_SET));
}

const KEYS = [
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
];

let acc;
const reset = () => {
	acc = { games: 0, min: 0, scv: 0 };
	for (const key of KEYS) {
		acc[key] = 0;
	}
};
if (process.env.RT_CAL) {
	const proto = GameSim.prototype;
	const origRun = proto.run;
	proto.run = function () {
		const out = origRun.call(this);
		if (!this.allStarGame) {
			acc.games += 1;
			for (const i of [0, 1]) {
				for (const key of KEYS) {
					acc[key] += out.team[i].stat[key];
				}
				acc.scv += this.shotClockViolations?.[i] ?? 0;
			}
			acc.min += 48 + 5 * out.overtimes;
		}
		return out;
	};
}

test.skipIf(!process.env.RT_CAL)(
	"seasons",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seeds = Number(process.env.RT_SEEDS ?? 8);
		const seed0 = Number(process.env.RT_SEED0 ?? 1);
		const configs = JSON.parse(
			process.env.RT_CONFIGS ??
				'[{"realisticTurnovers":false},{"realisticTurnovers":true}]',
		);
		const rows = [];
		let lid = 0;
		for (const config of configs) {
			reset();
			for (let seed = seed0; seed < seed0 + seeds; seed++) {
				Math.random = makeSeededRandom(seed);
				const settings: any = { ...getDefaultSettings(), ...config };
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
						name: `rt${seed}`,
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
			const n = 2 * acc.games;
			const per = (key) => acc[key] / n;
			const poss = per("fga") - per("orb") + per("tov") + 0.44 * per("fta");
			const row = {
				config: JSON.stringify(config),
				games: acc.games,
				pts: per("pts").toFixed(1),
				pace: ((poss * 48) / (acc.min / acc.games)).toFixed(1),
				fgPct: (acc.fg / acc.fga).toFixed(3),
				fga: per("fga").toFixed(1),
				tpaRate: (acc.tpa / acc.fga).toFixed(3),
				tpPct: (acc.tp / acc.tpa).toFixed(3),
				fta: per("fta").toFixed(1),
				ast: per("ast").toFixed(2),
				tov: per("tov").toFixed(2),
				stl: per("stl").toFixed(2),
				scv: per("scv").toFixed(2),
				blk: per("blk").toFixed(2),
				orb: per("orb").toFixed(2),
				drb: per("drb").toFixed(2),
				pf: per("pf").toFixed(2),
				ortg: ((100 * per("pts")) / poss).toFixed(1),
			};
			rows.push(row);
			console.log("ROW", JSON.stringify(row));
		}
		console.table(rows);
	},
);
