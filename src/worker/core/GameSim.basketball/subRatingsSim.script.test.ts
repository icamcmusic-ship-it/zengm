// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Calibration of Sub-Ratings in Sim (docs/native-features.md, Sub-ratings, step 3): plays whole regular seasons of new leagues
// (new-league defaults, Sub-Ratings on) with the subRatingsSim setting as given, and writes one JSON line per league with the league
// totals, and one per player (500+ minutes) with his sub-rating offsets, bases and season stats, plus his jump shots by assisted or not
// (counted in the sim), and the season leaders. Run with
//   SRS_CAL=1 SRS_SIM=0|1 SRS_SEEDS=8 SRS_OUT=/tmp/x.jsonl npx vitest run --maxWorkers=1 --project basketball <this file>
// (SRS_SETTINGS='{"expandedRatings":false}' adds settings on top of the defaults). The correlations and the totals table are computed from that file.
import "fake-indexeddb/auto";
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { SUB_DEFS, isValidSubArray } from "../../../common/subRatings.ts";
import { game, league, phase, realRosters, season } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import GameSim from "./index.ts";
import { SUB_SIM, SUB_SIM_CAL } from "./subRatingsSim.ts";

if (process.env.SRS_CAL_CONST) {
	Object.assign(SUB_SIM_CAL, JSON.parse(process.env.SRS_CAL_CONST));
}
if (process.env.SRS_CONST) {
	Object.assign(SUB_SIM, JSON.parse(process.env.SRS_CONST));
}

// Jump shots by assisted or not: [attempts, makes] per pid, type
const shots = new Map();
const key = (pid, type, assisted) => `${pid}|${type}|${assisted ? 1 : 0}`;
const bump = (k, i) => {
	let v = shots.get(k);
	if (!v) {
		v = [0, 0];
		shots.set(k, v);
	}
	v[i] += 1;
};
const origGetShotInfo = GameSim.prototype.getShotInfo;
GameSim.prototype.getShotInfo = function (args) {
	const out = origGetShotInfo.call(this, args);
	bump(key(args.p.id, out.type, out.passer !== undefined), 0);
	return out;
};
const origDoFg = GameSim.prototype.doFg;
GameSim.prototype.doFg = function (p, passer, type, andOne) {
	bump(key(p.id, type, passer !== undefined), 1);
	return origDoFg.call(this, p, passer, type, andOne);
};

const out = (obj) => {
	appendFileSync(process.env.SRS_OUT, `${JSON.stringify(obj)}\n`);
};

test.skipIf(!process.env.SRS_CAL)(
	"seasons",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seeds = Number(process.env.SRS_SEEDS ?? 8);
		const seed0 = Number(process.env.SRS_SEED0 ?? 1);
		const sim = process.env.SRS_SIM === "1";
		const extra = JSON.parse(process.env.SRS_SETTINGS ?? "{}");
		for (let seed = seed0; seed < seed0 + seeds; seed++) {
			shots.clear();
			Math.random = makeSeededRandom(seed);
			const settings: any = {
				...getDefaultSettings(),
				subRatings: true,
				subRatingsSim: sim,
				...extra,
			};
			const t0 = Date.now();
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
					lid: seed,
					name: `srs${seed}`,
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
			const t1 = Date.now();
			await game.play(await season.getDaysLeftSchedule(), {});
			const t2 = Date.now();
			const tot = {
				games: 0,
				homeWins: 0,
				pts: 0,
				fg: 0,
				fga: 0,
				tp: 0,
				tpa: 0,
				ft: 0,
				fta: 0,
				orb: 0,
				drb: 0,
				ast: 0,
				tov: 0,
				stl: 0,
				blk: 0,
				pf: 0,
			};
			for (const gm of await idb.cache.games.getAll()) {
				if (gm.teams[0].tid < 0) {
					continue;
				}
				tot.games += 1;
				// teams[0] is the home team
				if (gm.teams[0].pts > gm.teams[1].pts) {
					tot.homeWins += 1;
				}
				for (const t of gm.teams) {
					for (const k of Object.keys(tot)) {
						if (k !== "games" && k !== "homeWins") {
							tot[k] += t[k] ?? 0;
						}
					}
				}
			}
			out({
				kind: "league",
				seed,
				sim,
				tot,
				ms: { create: t1 - t0, sim: t2 - t1 },
			});
			for (const p of await idb.cache.players.getAll()) {
				const r = last(p.ratings);
				const ps = p.stats.filter((row) => !row.playoffs && row.tid >= 0);
				if (ps.length === 0) {
					continue;
				}
				const st = {};
				for (const row of ps) {
					for (const k of [
						"gp",
						"min",
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
						"fgAtRim",
						"fgaAtRim",
						"fgLowPost",
						"fgaLowPost",
						"fgMidRange",
						"fgaMidRange",
						"ows",
						"dws",
					]) {
						st[k] = (st[k] ?? 0) + (row[k] ?? 0);
					}
					st.per = row.per;
					st.usgp = row.usgp;
				}
				if (st.min < 500) {
					continue;
				}
				const off = {};
				if (isValidSubArray(r.sub)) {
					SUB_DEFS.forEach((d, i) => {
						off[d.key] = r.sub[i] - r[d.base];
					});
				}
				const js = {};
				for (const type of ["threePointer", "midRange", "atRim", "lowPost"]) {
					for (const a of [0, 1]) {
						js[`${type}${a}`] = shots.get(key(p.pid, type, a)) ?? [0, 0];
					}
				}
				const base = {};
				for (const k of [
					"hgt",
					"stre",
					"spd",
					"jmp",
					"ins",
					"dnk",
					"fg",
					"tp",
					"oiq",
					"diq",
					"drb",
					"pss",
					"reb",
					"ovr",
					"pdef",
					"idef",
					"csh",
					"dsh",
					"bsc",
					"oreb",
					"dreb",
					"wng",
				]) {
					base[k] = r[k];
				}
				out({
					kind: "player",
					seed,
					sim,
					pid: p.pid,
					name: `${p.firstName} ${p.lastName}`,
					pos: r.pos,
					base,
					off,
					st,
					js,
				});
			}
		}
	},
);

// A real-players league (SRS_REAL=1, season SRS_REAL_SEASON, default 2026): one regular season with the setting as given, and the
// season of a few players whose shape should show (SRS_REAL_SLUGS, comma-separated)
test.skipIf(!process.env.SRS_REAL)(
	"real players",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const { readFileSync } = await import("node:fs");
		const files = {
			"real-player-data": "data/real-player-data.basketball.json",
			"real-player-stats": "data/real-player-stats.basketball.json",
		};
		globalThis.fetch = (url) => {
			const name = Object.keys(files).find((k) => String(url).includes(k));
			if (!name) {
				return Promise.reject(new Error(`fetch ${url}`));
			}
			const text = readFileSync(files[name], "utf8");
			return Promise.resolve({
				ok: true,
				status: 200,
				json: () => Promise.resolve(JSON.parse(text)),
			});
		};
		const sim = process.env.SRS_SIM === "1";
		const realSeason = Number(process.env.SRS_REAL_SEASON ?? 2026);
		const slugs = (
			process.env.SRS_REAL_SLUGS ?? "goberru01,curryst01,doncilu01,capelca01"
		).split(",");
		const seed = Number(process.env.SRS_SEED0 ?? 1);
		shots.clear();
		Math.random = makeSeededRandom(seed);
		const settings: any = {
			...getDefaultSettings(),
			subRatings: true,
			subRatingsSim: sim,
			// (the user's real roster is over the limit at the preseason: let the AI handle every team)
			spectator: true,
		};
		const getLeagueOptions = {
			type: "real",
			season: realSeason,
			phase: PHASE.PRESEASON,
			randomDebuts: false,
			randomDebutsKeepCurrent: false,
			realDraftRatings: "rookie",
			realStats: "none",
			includePlayers: true,
		};
		const realLeague = await realRosters.getLeague(getLeagueOptions);
		await league.createStream(realLeague, {
			confs: last(defaultGameAttributes.confs).value,
			divs: last(defaultGameAttributes.divs).value,
			fromFile: {
				gameAttributes: realLeague.gameAttributes,
				hasRookieContracts: true,
				maxGid: undefined,
				startingSeason: realLeague.startingSeason,
				teams: realLeague.teams,
				version: LEAGUE_DATABASE_VERSION,
			},
			getLeagueOptions,
			keptKeys: new Set([
				...Object.keys(realLeague),
				"startingSeason",
				"version",
			]),
			lid: 1000 + seed,
			name: `srsreal${seed}`,
			setLeagueCreationStatus: () => {},
			settings,
			shuffleRosters: false,
			startingSeasonFromInput: String(realSeason),
			teamsFromInput: realLeague.teams,
			tid: 0,
		});
		await league.loadGameAttributes();
		await phase.newPhase(PHASE.REGULAR_SEASON, {});
		await lock.set("gameSim", false);
		await game.play(await season.getDaysLeftSchedule(), {});
		const all = await idb.cache.players.getAll();
		for (const p of all) {
			if (!slugs.includes(p.srID)) {
				continue;
			}
			const r = last(p.ratings);
			const row =
				p.stats.find(
					(s) => !s.playoffs && s.gp > 0 && s.season === g.get("season"),
				) ?? {};
			const off = {};
			if (isValidSubArray(r.sub)) {
				SUB_DEFS.forEach((d, i) => {
					off[d.key] = r.sub[i] - r[d.base];
				});
			}
			const js = {};
			for (const type of ["threePointer", "midRange"]) {
				for (const a of [0, 1]) {
					js[`${type}${a}`] = shots.get(key(p.pid, type, a)) ?? [0, 0];
				}
			}
			out({
				kind: "real",
				sim,
				seed,
				slug: p.srID,
				name: `${p.firstName} ${p.lastName}`,
				ovr: r.ovr,
				base: {
					diq: r.diq,
					tp: r.tp,
					pss: r.pss,
					reb: r.reb,
					dnk: r.dnk,
					idef: r.idef,
					oreb: r.oreb,
				},
				off,
				st: Object.fromEntries(
					[
						"gp",
						"min",
						"pts",
						"fga",
						"tp",
						"tpa",
						"fta",
						"orb",
						"drb",
						"ast",
						"tov",
						"stl",
						"blk",
					].map((k) => [k, row[k] ?? 0]),
				),
				js,
			});
		}
	},
);

// What the setting costs (SRS_PERF=1): one new league (defaults), then blocks of SRS_PERF_GAMES games (loadTeams and the sim, no
// play-by-play, nothing saved) with the setting off and on in turn, CPU time per game
test.skipIf(!process.env.SRS_PERF)(
	"performance",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const { default: loadTeams } = await import("../game/loadTeams.ts");
		const { g } = await import("../../util/index.ts");
		Math.random = makeSeededRandom(1);
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
				lid: 2000,
				name: "srsperf",
				setLeagueCreationStatus: () => {},
				settings: { ...getDefaultSettings(), subRatings: true },
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		await phase.newPhase(PHASE.REGULAR_SEASON, {});
		if (process.env.SRS_PERF_NO_PBP) {
			g.setWithoutSavingToDB("storePlayByPlay", false);
		}
		const n = Number(process.env.SRS_PERF_GAMES ?? 300);
		const cpu = () => {
			const u = process.cpuUsage();
			return (u.user + u.system) / 1000;
		};
		const total = {
			on: 0,
			off: 0,
			onLoad: 0,
			offLoad: 0,
			onPoss: 0,
			offPoss: 0,
		};
		for (
			let round = 0;
			round < Number(process.env.SRS_PERF_ROUNDS ?? 6);
			round++
		) {
			for (const on of round % 2 === 0 ? [false, true] : [true, false]) {
				g.setWithoutSavingToDB("subRatingsSim", on);
				Math.random = makeSeededRandom(100 + round);
				const k = on ? "on" : "off";
				for (let i = 0; i < n; i++) {
					const a = i % 30;
					const b = (a + 1 + (Math.floor(i / 30) % 29)) % 30;
					const c0 = cpu();
					const teams = await loadTeams([a, b], {});
					const c1 = cpu();
					const s = new GameSim({
						gid: i,
						teams: [teams[a], teams[b]],
						baseInjuryRate: g.get("injuryRate"),
						doPlayByPlay: false,
						homeCourtFactor: 1,
						allStarGame: false,
						neutralSite: false,
					});
					const result = s.run();
					total[k] += cpu() - c1;
					total[`${k}Load`] += c1 - c0;
					total[`${k}Poss`] +=
						result.team[0].stat.fga + result.team[1].stat.fga;
				}
			}
		}
		console.log(`SRS_PERF ${JSON.stringify(total)}`);
		out({ kind: "perf", total });
	},
);
