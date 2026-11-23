// @ts-nocheck (diagnostic script)
// Multi-season calibration of superstar seasons (PER, BPM) and clutch time (docs/native-features.md, Star & Clutch Calibration).
// Plays SCAL_SEASONS whole seasons (regular season, playoffs, offseason) of new leagues with the new-league defaults and writes one
// JSON line per regular season to SCAL_OUT: every player with 500+ minutes (box score, PER, BPM, win shares, usage, clutch
// tracking stats), every team (pace, ratings, shot profile, clutch games won and lost) and the league totals. Run with
// SCAL=1 SCAL_SEEDS=1,2,3 SCAL_SEASONS=3 SCAL_OUT=/tmp/x.jsonl npx vitest run --maxWorkers=2 --project basketball <this file>
// (SCAL_SETTINGS='{"starClutchCal":false}' settings on top of the new-league defaults; SCAL_CONST='{"star":{...},"clutch":{...}}'
// changes the constants in starClutch.ts)
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { ADV, TEAM_ADV } from "../../../common/advStats.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import GameSim from "./index.ts";
import { CLUTCH, STAR } from "./starClutch.ts";

const env = (globalThis as any).process.env;
if (env.SCAL_CONST) {
	const c = JSON.parse(env.SCAL_CONST);
	for (const [k, v] of Object.entries(c)) {
		Object.assign({ star: STAR, clutch: CLUTCH }[k], v);
	}
}

// Per game: which teams had clutch time, who won, final margin
let gameLog = [];
const origRun = GameSim.prototype.run;
GameSim.prototype.run = function (...args) {
	const out = origRun.apply(this, args);
	const t0 = out.team[0];
	const t1 = out.team[1];
	gameLog.push({
		tids: [t0.id, t1.id],
		pts: [t0.stat.pts, t1.stat.pts],
		ot: out.overtimes,
		cl: (t0.adv?.t?.[TEAM_ADV.clSec] ?? 0) > 0,
		clPm: t0.adv
			? t0.adv.t[TEAM_ADV.clPtsFor] - t0.adv.t[TEAM_ADV.clPtsAgainst]
			: 0,
		clPoss: t0.adv
			? t0.adv.t[TEAM_ADV.clPossFor] + t0.adv.t[TEAM_ADV.clPossAgainst]
			: 0,
		allStar: t0.id < 0,
	});
	return out;
};

test.skipIf(!env.SCAL)(
	"seasons",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seeds = (env.SCAL_SEEDS ?? "1").split(",").map(Number);
		const numSeasons = Number(env.SCAL_SEASONS ?? 3);
		const extra = JSON.parse(env.SCAL_SETTINGS ?? "{}");
		const out = (obj) =>
			appendFileSync(env.SCAL_OUT, `${JSON.stringify(obj)}\n`);
		let lid = 0;
		for (const seed of seeds) {
			Math.random = makeSeededRandom(seed);
			const settings: any = {
				...getDefaultSettings(),
				spectator: true,
				...extra,
			};
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
					name: `scal${seed}`,
					setLeagueCreationStatus: () => {},
					settings,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			for (let i = 0; i < numSeasons; i++) {
				const s = g.get("season");
				await phase.newPhase(PHASE.REGULAR_SEASON, {});
				await lock.set("gameSim", false);
				gameLog = [];
				let guard = 0;
				while (
					g.get("phase") === PHASE.REGULAR_SEASON ||
					g.get("phase") === PHASE.AFTER_TRADE_DEADLINE
				) {
					await game.play(await season.getDaysLeftSchedule(), {});
					if (++guard > 50) {
						throw new Error("stuck");
					}
				}
				const regGames = gameLog.filter((gm) => !gm.allStar);

				// Teams
				const teamStats = (await idb.cache.teamStats.getAll()).filter(
					(ts) => ts.season === s && !ts.playoffs,
				);
				const teams = [];
				for (const ts of teamStats) {
					const mine = regGames.filter((gm) => gm.tids.includes(ts.tid));
					const rec = (filter) => {
						let w = 0;
						let l = 0;
						for (const gm of mine.filter(filter)) {
							const t = gm.tids[0] === ts.tid ? 0 : 1;
							if (gm.pts[t] > gm.pts[1 - t]) {
								w += 1;
							} else {
								l += 1;
							}
						}
						return [w, l];
					};
					const poss = ts.adv?.t?.[TEAM_ADV.possFor];
					teams.push({
						tid: ts.tid,
						gp: ts.gp,
						rec: rec(() => true),
						clRec: rec((gm) => gm.cl),
						m3Rec: rec((gm) => Math.abs(gm.pts[0] - gm.pts[1]) <= 3),
						otRec: rec((gm) => gm.ot > 0),
						pts: ts.pts,
						oppPts: ts.oppPts,
						poss,
						fga: ts.fga,
						fta: ts.fta,
						tpa: ts.tpa,
						tov: ts.tov,
						orb: ts.orb,
						drb: ts.drb,
						ast: ts.ast,
						clSec: ts.adv?.t?.[TEAM_ADV.clSec],
						clPtsFor: ts.adv?.t?.[TEAM_ADV.clPtsFor],
						clPtsAgainst: ts.adv?.t?.[TEAM_ADV.clPtsAgainst],
						clPossFor: ts.adv?.t?.[TEAM_ADV.clPossFor],
					});
				}

				// Players
				const players = [];
				for (const p of await idb.cache.players.getAll()) {
					const rows = p.stats.filter(
						(row) => row.season === s && !row.playoffs && row.tid >= 0,
					);
					for (const row of rows) {
						if (row.min < 500) {
							continue;
						}
						const a = row.adv ?? [];
						const rt = p.ratings.find((x) => x.season === s) ?? last(p.ratings);
						players.push({
							pid: p.pid,
							tid: row.tid,
							ovr: rt.ovr,
							pos: rt.pos,
							hgt: rt.hgt,
							age: s - p.born.year,
							gp: row.gp,
							min: row.min,
							pts: row.pts,
							fga: row.fga,
							fg: row.fg,
							fta: row.fta,
							ft: row.ft,
							tpa: row.tpa,
							tp: row.tp,
							orb: row.orb,
							drb: row.drb,
							ast: row.ast,
							stl: row.stl,
							blk: row.blk,
							tov: row.tov,
							pf: row.pf,
							usg: row.usgp,
							per: row.per,
							obpm: row.obpm,
							dbpm: row.dbpm,
							ows: row.ows,
							dws: row.dws,
							orbp: row.orbp,
							drbp: row.drbp,
							astp: row.astp,
							pm: row.pm,
							onOff: row.onOff,
							cl: a.length
								? {
										gp: a[ADV.clGp],
										sec: a[ADV.clSec],
										pts: a[ADV.clPts],
										fga: a[ADV.clFga],
										fg: a[ADV.clFg],
										tpa: a[ADV.clTpa],
										fta: a[ADV.clFta],
										ft: a[ADV.clFt],
										tov: a[ADV.clTov],
										pm: a[ADV.clPm],
										tmFga: a[ADV.clTmFga],
										tmFta: a[ADV.clTmFta],
										tmTov: a[ADV.clTmTov],
									}
								: undefined,
						});
					}
				}
				out({
					seed,
					season: s,
					i,
					games: regGames.length,
					clGames: regGames.filter((gm) => gm.cl).length,
					ot: regGames.filter((gm) => gm.ot > 0).length,
					m3: regGames.filter((gm) => Math.abs(gm.pts[0] - gm.pts[1]) <= 3)
						.length,
					m5: regGames.filter((gm) => Math.abs(gm.pts[0] - gm.pts[1]) <= 5)
						.length,
					homeWins: regGames.filter((gm) => gm.pts[0] > gm.pts[1]).length,
					// Clutch games: [final margin, clutch +/-, clutch possessions], from the winner's side
					clGameList: regGames
						.filter((gm) => gm.cl)
						.map((gm) => {
							const s = gm.pts[0] > gm.pts[1] ? 1 : -1;
							return [s * (gm.pts[0] - gm.pts[1]), s * gm.clPm, gm.clPoss];
						}),
					teams,
					players,
				});
				console.log(`seed ${seed} season ${s} done`);

				if (i === numSeasons - 1) {
					break;
				}
				// Playoffs and offseason
				guard = 0;
				while (g.get("phase") === PHASE.PLAYOFFS) {
					await game.play(100, {});
					if (++guard > 50) {
						throw new Error("stuck in playoffs");
					}
				}
				await phase.newPhase(PHASE.DRAFT, {});
				await draft.runPicks({ type: "untilEnd" }, {});
				await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
				await phase.newPhase(PHASE.FREE_AGENCY, {});
				guard = 0;
				while (g.get("phase") === PHASE.FREE_AGENCY) {
					await freeAgents.play(30, {});
					if (++guard > 10) {
						throw new Error("stuck in free agency");
					}
				}
			}
		}
	},
);
