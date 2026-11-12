// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Calibration of the Load, Fatigue & Venue setting (scheduleLoad, scheduleLoad.ts): league per-team-game averages, home win% and home
// free throw rate, in-game injuries, with the setting off and on (all the other new-league defaults on, coaching systems included), and
// the fatigue and injury distributions its constants are centered on. Run with
// LV_CAL=1 npx vitest --run --project basketball --silent=false <this file>
// (LV_LEAGUES, LV_GAMES to change the size, LV_PLAYOFFS=1 for playoff games, LV_SET='{"baseShare":0.4}' to change constants)
import { test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g, helpers } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { genLeague, boxAverages } from "./coachSystemsMetrics.ts";
import { withSeededRandom } from "./simLiveGameForTests.ts";
import { genTeams } from "./simLiveGameForTests.ts";
import { nativeFeatureNewLeagueDefaults } from "../../../common/nativeFeatures.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { range } from "../../../common/utils.ts";
import { LOAD, loadFatigue } from "./scheduleLoad.ts";

if (process.env.LV_SET) {
	Object.assign(LOAD, JSON.parse(process.env.LV_SET));
}

const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

let diag;
const resetDiag = () => {
	diag = {
		x: 0,
		x2: 0,
		n: 0,
		expK: 0,
		nInj: 0,
		fatigueStock: 0,
		fatigueLoad: 0,
		cx: 0,
		cx2: 0,
		cStock: 0,
		cLoad: 0,
	};
};
resetDiag();
// (the counters are only installed for a calibration run: the other test files share these classes)
if (process.env.LV_CAL) {
	const proto = GameSim.prototype;
	const origInfo = proto.getShotInfo;
	proto.getShotInfo = function (args) {
		const e = Math.min(1, args.p.stat.energy + 0.016);
		const x = 1 - e;
		diag.x += x;
		diag.x2 += x * x;
		diag.n += 1;
		diag.fatigueStock += e;
		diag.fatigueLoad += loadFatigue(e);
		return origInfo.call(this, args);
	};
	const origInj = proto.injuries;
	proto.injuries = function () {
		for (const t of [0, 1]) {
			for (const p of this.playersOnCourt[t]) {
				diag.expK += Math.exp(LOAD.injuryTired * (1 - p.stat.energy));
				const e = Math.min(1, p.stat.energy + 0.016);
				diag.cx += 1 - e;
				diag.cx2 += (1 - e) ** 2;
				diag.cStock += e;
				diag.cLoad += loadFatigue(e);
				diag.nInj += 1;
			}
		}
		return origInj.call(this);
	};
}

const SIM = [
	"realisticPossessions",
	"simFixes",
	"positionalComposites",
	"realisticRotations",
	"expandedRatings",
	"playerTraits",
	"perimeterDefense",
	"technicalFouls",
	"spacingCreation",
	"matchupDefense",
	"coachSystems",
	"smartEndgame",
];

const REGIONS = helpers.getTeamsDefault().map((t) => t.region);

const simLeague = async ({ league, seed, gamesPerPair, settings }) => {
	const rows = [];
	const random = makeSeededRandom(seed);
	for (let pair = 0; pair * 2 < league.length; pair++) {
		const regions = [
			REGIONS[Math.floor(random() * REGIONS.length)],
			REGIONS[Math.floor(random() * REGIONS.length)],
		];
		await withSeededRandom(seed * 7919 + pair * 104729, async () => {
			await genTeams();
			for (const p of await idb.cache.players.getAll()) {
				await idb.cache.players.delete(p.pid);
			}
			for (const tid of [0, 1]) {
				for (const p of league[pair * 2 + tid].players) {
					await idb.cache.players.put(structuredClone(p));
				}
			}
			g.setWithoutSavingToDB("storePlayByPlay", false);
			for (const [key, value] of Object.entries(settings)) {
				g.setWithoutSavingToDB(key, value);
			}
			if (process.env.LV_PLAYOFFS) {
				g.setWithoutSavingToDB("phase", 3);
			}
			for (const i of range(gamesPerPair)) {
				const teams = await loadTeams([0, 1], {});
				for (const tid of [0, 1]) {
					teams[tid].coachSim = { ...league[pair * 2 + tid].sim };
					teams[tid].region = regions[tid];
				}
				const home = i % 2;
				const sim = new GameSim({
					gid: pair * 1000 + i,
					teams: [teams[home], teams[1 - home]],
					baseInjuryRate: g.get("injuryRate"),
					doPlayByPlay: false,
					homeCourtFactor: 1,
					allStarGame: false,
					neutralSite: false,
				});
				const travelKm = sim.travelKm;
				const result = sim.run();
				rows.push({ team: result.team, travelKm });
			}
		});
	}
	return rows;
};

test.skipIf(!process.env.LV_CAL)(
	"load, fatigue & venue calibration",
	async () => {
		const numLeagues = Number(process.env.LV_LEAGUES ?? 2);
		const gamesPerPair = Number(process.env.LV_GAMES ?? 20);
		const base = Object.fromEntries(
			Object.entries(nativeFeatureNewLeagueDefaults()).filter(([k]) =>
				SIM.includes(k),
			),
		);
		const out = {};
		for (const on of [false, true]) {
			const settings = {
				...base,
				scheduleLoad: on,
				scheduleLoadRefVariance: true,
			};
			resetDiag();
			const rows = [];
			for (const L of range(numLeagues)) {
				const league = await genLeague({
					numPairs: 15,
					seed: 100 + L,
					settings,
				});
				rows.push(
					...(await simLeague({
						league,
						seed: 200 + L,
						gamesPerPair,
						settings,
					})),
				);
			}
			let home = 0;
			let homeMargin = 0;
			let ftaHome = 0;
			let ftaAway = 0;
			let fgaHome = 0;
			let fgaAway = 0;
			let inj = 0;
			let min = 0;
			for (const row of rows) {
				const [h, a] = row.team;
				home += h.stat.pts > a.stat.pts ? 1 : 0;
				homeMargin += h.stat.pts - a.stat.pts;
				ftaHome += h.stat.fta;
				ftaAway += a.stat.fta;
				fgaHome += h.stat.fga;
				fgaAway += a.stat.fga;
				for (const t of row.team) {
					for (const p of t.player) {
						inj += p.newInjury ? 1 : 0;
						min += p.stat.min;
					}
				}
			}
			const n = rows.length;
			out[on ? "on" : "off"] = {
				box: boxAverages(rows),
				homeWin: home / n,
				homeMargin: homeMargin / n,
				homeFtr: ftaHome / fgaHome,
				awayFtr: ftaAway / fgaAway,
				injPerGame: inj / n,
				min: min / (2 * n),
				x: diag.x / diag.n,
				x0: diag.x2 / diag.x,
				fatigueStock: diag.fatigueStock / diag.n,
				fatigueLoad: diag.fatigueLoad / diag.n,
				courtX0: diag.cx2 / diag.cx,
				courtStock: diag.cStock / diag.nInj,
				courtLoad: diag.cLoad / diag.nInj,
				travel:
					rows
						.filter((r) => r.travelKm !== undefined)
						.reduce((s, r) => s + r.travelKm, 0) /
					Math.max(1, rows.filter((r) => r.travelKm !== undefined).length),
				n,
			};
		}
		const names = Object.keys(out);
		console.log(`games per config: ${out.off.n}`);
		console.log(`stat | ${names.join(" | ")}`);
		for (const key of [
			"pts",
			"fgp",
			"tpaRate",
			"tpp",
			"ast",
			"tov",
			"orb",
			"fta",
			"stl",
			"blk",
			"pf",
			"poss",
		]) {
			console.log(
				`${key} | ${names.map((x) => f(out[x].box[key], key === "fgp" || key === "tpaRate" || key === "tpp" ? 4 : 2)).join(" | ")}`,
			);
		}
		for (const key of [
			"min",
			"homeWin",
			"homeMargin",
			"homeFtr",
			"awayFtr",
			"injPerGame",
			"x",
			"x0",
			"fatigueStock",
			"fatigueLoad",
			"courtX0",
			"courtStock",
			"courtLoad",
			"travel",
		]) {
			console.log(
				`${key} | ${names.map((x) => f(out[x][key], 4)).join(" | ")}`,
			);
		}
	},
	7_200_000,
);
