// @ts-nocheck (diagnostic script)
// Jump shot skill gradient: plays seasons of a new random league (new-league defaults plus the 2026 preset) and prints, over all of
// its seasons, the league totals, 3P% and volume by three-point rating (players with 100+ 3PA) and its correlation with the rating,
// mid-range share and FG% by mid-range rating, and the top scorers. THREE_GRAD_OUT also writes one JSON line per player season and one
// per season's league totals (to pool several seeds). It also prints the game flow counters (gameFlow.ts FLOW_DIAG: contest levels by shot
// type, timeouts, coaching adjustments, garbage time, minutes by value rank) and writes them as a "flow" line. THREE_GRAD_CONST can change
// any constant object of simSettings.ts too (and ENDGAME: '{"ENDGAME":{"isoSeconds":-1}}' turns the late-game isolations off).
//   THREE_GRAD=1 [THREE_GRAD_SEED=1] [THREE_GRAD_SEASONS=3] [THREE_GRAD_SETTINGS='{}'] [THREE_GRAD_OUT=/tmp/x.jsonl]
//   [THREE_GRAD_CONST='{"STAR":{"makeJumper":0.3}}'] npx vitest run --project basketball --silent=false <this file>
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import gameSimPresets from "../../../ui/views/Settings/gameSimPresets.ts";
import { ATTENTION } from "./matchupDefense.ts";
import { STAR } from "./starClutch.ts";
import { SHOT_SHARE } from "./shotShare.ts";
import { ENDGAME } from "./endgame.ts";
import * as simSettings from "./simSettings.ts";
import { SIM_FIX_SHOT_CHOICE, SIM_FIX_THREE } from "./simSettings.ts";
import { FLOW_DIAG } from "./gameFlow.ts";
import { BADGE_DIAG } from "./tieredBadgesSim.ts";
import {
	badgePointCap,
	badgePoints,
	displayTiersOf,
	entryForSeason,
} from "../../../common/tieredBadges/index.ts";
import { badgeRowOf } from "../player/tieredBadges.ts";

const env = (globalThis as any).process.env;
// THREE_GRAD_CONST changes the sim's constants (for tuning)
if (env.THREE_GRAD_CONST) {
	const mods = {
		...simSettings,
		ATTENTION,
		STAR,
		SIM_FIX_SHOT_CHOICE,
		SHOT_SHARE,
		SIM_FIX_THREE,
		ENDGAME,
	};
	for (const [k, v] of Object.entries(JSON.parse(env.THREE_GRAD_CONST))) {
		Object.assign(mods[k], v);
	}
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const corr = (xs: number[], ys: number[]) => {
	const mx = mean(xs);
	const my = mean(ys);
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	for (let i = 0; i < xs.length; i++) {
		sxy += (xs[i] - mx) * (ys[i] - my);
		sxx += (xs[i] - mx) ** 2;
		syy += (ys[i] - my) ** 2;
	}
	return sxy / Math.sqrt(sxx * syy);
};
const f3 = (x: number) => x.toFixed(3);

test.skipIf(!env.THREE_GRAD)(
	"jump shot skill gradient",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seed = Number(env.THREE_GRAD_SEED ?? 1);
		const numSeasons = Number(env.THREE_GRAD_SEASONS ?? 3);
		const extra = JSON.parse(env.THREE_GRAD_SETTINGS ?? "{}");
		const out = env.THREE_GRAD_OUT;
		Math.random = makeSeededRandom(seed);
		FLOW_DIAG.on = true;
		// 2K Badges: the raw badge effects, for their calibration (tieredBadgesSim.ts BADGE_CAL)
		BADGE_DIAG.on = true;
		const settings: any = {
			...getDefaultSettings(),
			...gameSimPresets[2026],
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
				lid: 0,
				name: `threeGrad${seed}`,
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();

		// 2K Badges: the tier distribution of the new league (players on teams), when the setting is on
		{
			const counts = [0, 0, 0, 0, 0, 0];
			const perBadge: Record<string, number[]> = {};
			let holders = 0;
			let onTeams = 0;
			for (const p of await idb.cache.players.getAll()) {
				if (p.tid < 0 || !p.badges2k) {
					continue;
				}
				onTeams++;
				const t = last(p.badges2k).t;
				if (Object.keys(t).length > 0) {
					holders++;
				}
				for (const [k, tier] of Object.entries(t)) {
					counts[tier]++;
					perBadge[k] ??= [0, 0, 0, 0, 0, 0];
					perBadge[k][tier]++;
				}
			}
			if (onTeams > 0) {
				console.log(
					`BADGE TIERS players ${onTeams} with badges ${holders} by tier (B/S/G/HOF/L) ${counts.slice(1).join("/")}\n${Object.entries(
						perBadge,
					)
						.map(([k, c]) => `  ${k} ${c.slice(1).join("/")}`)
						.join("\n")}`,
				);
			}
		}

		const leagues = [];
		const players = [];
		const badgeSeasons = [];
		for (let i = 0; i < numSeasons; i++) {
			const s = g.get("season");
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await lock.set("gameSim", false);
			// 2K Badges by season (tier creep): tier counts of the players on teams (the sim's and the shown tiers), how many are over
			// their badge-point cap or hold more than 6, and the season's mean raw sim effects (calibration)
			const badgeSeason = {
				season: s,
				t: [0, 0, 0, 0, 0, 0],
				d: [0, 0, 0, 0, 0, 0],
				players: 0,
				overCap: 0,
				over6: 0,
				cal: {},
			};
			for (const p of await idb.cache.players.getAll()) {
				const e = p.tid >= 0 ? entryForSeason(p.badges2k, s) : undefined;
				if (!e) {
					continue;
				}
				badgeSeason.players++;
				for (const tier of Object.values(e.t)) {
					badgeSeason.t[tier]++;
				}
				for (const tier of Object.values(displayTiersOf(e))) {
					badgeSeason.d[tier]++;
				}
				if (badgePoints(e.t) > badgePointCap(badgeRowOf(p).ovr ?? 0)) {
					badgeSeason.overCap++;
				}
				if (Object.keys(e.t).length > 6) {
					badgeSeason.over6++;
				}
			}
			const diagBefore = { sum: { ...BADGE_DIAG.sum }, n: { ...BADGE_DIAG.n } };
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
			for (const [k, v] of Object.entries(BADGE_DIAG.sum)) {
				const n = BADGE_DIAG.n[k] - (diagBefore.n[k] ?? 0);
				if (n > 0) {
					badgeSeason.cal[k] = Number(
						((v - (diagBefore.sum[k] ?? 0)) / n).toFixed(5),
					);
				}
			}
			badgeSeasons.push(badgeSeason);
			console.log(`BADGE SEASON ${JSON.stringify(badgeSeason)}`);
			if (out) {
				appendFileSync(
					out,
					`${JSON.stringify({ kind: "badgeSeason", seed, ...badgeSeason })}\n`,
				);
			}

			const sum = {
				gp: 0,
				pts: 0,
				fga: 0,
				fg: 0,
				tpa: 0,
				tp: 0,
				tov: 0,
				fta: 0,
				ast: 0,
				orb: 0,
				pf: 0,
				drb: 0,
				blk: 0,
				stl: 0,
				min: 0,
			};
			for (const ts of await idb.cache.teamStats.getAll()) {
				if (ts.season === s && !ts.playoffs) {
					for (const k of Object.keys(sum)) {
						sum[k] += ts[k];
					}
				}
			}
			const lg = {
				kind: "league",
				seed,
				season: s,
				pts: sum.pts / sum.gp,
				tpp: sum.tp / sum.tpa,
				tpaRate: sum.tpa / sum.fga,
				fgp: sum.fg / sum.fga,
				tov: sum.tov / sum.gp,
				fta: sum.fta / sum.gp,
				ast: sum.ast / sum.gp,
				orb: sum.orb / sum.gp,
				pf: sum.pf / sum.gp,
				poss: (sum.fga + 0.44 * sum.fta - sum.orb + sum.tov) / sum.gp,
				drb: sum.drb / sum.gp,
				blk: sum.blk / sum.gp,
				stl: sum.stl / sum.gp,
				min: sum.min / sum.gp,
				homeWinPct: 0,
				injuries: 0,
				injuryGames: 0,
			};
			{
				let won = 0;
				let lost = 0;
				for (const ts of await idb.cache.teamSeasons.getAll()) {
					if (ts.season === s) {
						won += ts.wonHome;
						lost += ts.lostHome;
					}
				}
				lg.homeWinPct = won / (won + lost);
				for (const p of await idb.cache.players.getAll()) {
					for (const inj of p.injuries) {
						if (inj.season === s) {
							lg.injuries += 1;
							lg.injuryGames += inj.games;
						}
					}
				}
				lg.injuries /= sum.gp / 2;
				lg.injuryGames /= sum.gp / 2;
			}
			leagues.push(lg);
			const rows = [];
			for (const p of await idb.cache.players.getAll()) {
				const r =
					p.ratings.findLast((row) => row.season === s) ?? last(p.ratings);
				for (const row of p.stats) {
					if (row.season !== s || row.playoffs || row.tid < 0 || row.gp === 0) {
						continue;
					}
					rows.push({
						kind: "player",
						seed,
						season: s,
						pid: p.pid,
						r: { tp: r.tp, fg: r.fg, oiq: r.oiq, ovr: r.ovr },
						gp: row.gp,
						min: row.min,
						pts: row.pts,
						fga: row.fga,
						fg: row.fg,
						tpa: row.tpa,
						tp: row.tp,
						fgaMid: row.fgaMidRange,
						fgMid: row.fgMidRange,
						fgaRim: row.fgaAtRim,
						fgRim: row.fgAtRim,
						fgaPost: row.fgaLowPost,
						fgPost: row.fgLowPost,
						zt: r.zt,
					});
				}
			}
			players.push(...rows);
			if (out) {
				appendFileSync(
					out,
					[lg, ...rows].map((l) => JSON.stringify(l)).join("\n") + "\n",
				);
			}

			if (i === numSeasons - 1) {
				break;
			}
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

		const lines = [];
		lines.push(
			`LEAGUE pts ${mean(leagues.map((l) => l.pts)).toFixed(2)} 3P% ${f3(mean(leagues.map((l) => l.tpp)))} 3PA rate ${f3(mean(leagues.map((l) => l.tpaRate)))} FG% ${f3(mean(leagues.map((l) => l.fgp)))} TOV ${mean(leagues.map((l) => l.tov)).toFixed(2)} FTA ${mean(leagues.map((l) => l.fta)).toFixed(2)} AST ${mean(leagues.map((l) => l.ast)).toFixed(2)} ORB ${mean(leagues.map((l) => l.orb)).toFixed(2)} PF ${mean(leagues.map((l) => l.pf)).toFixed(2)} poss ${mean(leagues.map((l) => l.poss)).toFixed(2)} DRB ${mean(leagues.map((l) => l.drb)).toFixed(2)} BLK ${mean(leagues.map((l) => l.blk)).toFixed(2)} STL ${mean(leagues.map((l) => l.stl)).toFixed(2)} homeWin ${f3(mean(leagues.map((l) => l.homeWinPct)))} injuries/game ${f3(mean(leagues.map((l) => l.injuries)))} injuryGames/game ${f3(mean(leagues.map((l) => l.injuryGames)))}`,
		);
		const shooters = players.filter((p) => p.tpa >= 100);
		lines.push(
			`THREES (100+ 3PA, ${shooters.length} player seasons) corr(tp, 3P%) ${f3(
				corr(
					shooters.map((p) => p.r.tp),
					shooters.map((p) => p.tp / p.tpa),
				),
			)}`,
		);
		for (const [lo, hi] of [
			[0, 45],
			[45, 55],
			[55, 65],
			[65, 75],
			[75, 85],
			[85, 101],
		]) {
			const bin = shooters.filter((p) => p.r.tp >= lo && p.r.tp < hi);
			if (bin.length > 0) {
				const tpa = bin.reduce((a, p) => a + p.tpa, 0);
				const tp = bin.reduce((a, p) => a + p.tp, 0);
				lines.push(
					`  tp ${lo}-${hi - 1}: n ${bin.length} 3P% ${f3(tp / tpa)} 3PA/36 ${mean(bin.map((p) => (36 * p.tpa) / p.min)).toFixed(1)}`,
				);
			}
		}
		const regulars = players.filter((p) => p.min >= 500 && p.fga > 0);
		const midShare = (p) => p.fgaMid / p.fga;
		const midShooters = players.filter((p) => p.fgaMid >= 80);
		lines.push(
			`MID-RANGE (500+ min) corr(fg, mid share of FGA) ${f3(
				corr(
					regulars.map((p) => p.r.fg),
					regulars.map(midShare),
				),
			)} corr(fg, mid FGA/36) ${f3(
				corr(
					regulars.map((p) => p.r.fg),
					regulars.map((p) => (36 * p.fgaMid) / p.min),
				),
			)}; (80+ mid FGA) corr(fg, mid FG%) ${f3(
				corr(
					midShooters.map((p) => p.r.fg),
					midShooters.map((p) => p.fgMid / p.fgaMid),
				),
			)}`,
		);
		for (const [lo, hi] of [
			[0, 40],
			[40, 50],
			[50, 60],
			[60, 70],
			[70, 80],
			[80, 101],
		]) {
			const bin = regulars.filter((p) => p.r.fg >= lo && p.r.fg < hi);
			if (bin.length > 0) {
				const fga = bin.reduce((a, p) => a + p.fgaMid, 0);
				const fg = bin.reduce((a, p) => a + p.fgMid, 0);
				lines.push(
					`  fg ${lo}-${hi - 1}: n ${bin.length} mid share ${f3(mean(bin.map(midShare)))} mid FG% ${f3(fg / fga)}`,
				);
			}
		}
		for (const lg of leagues) {
			const ppg = players
				.filter((p) => p.season === lg.season && p.gp >= 40)
				.map((p) => p.pts / p.gp)
				.toSorted((a, b) => b - a);
			lines.push(
				`SCORERS ${lg.season}: leader ${ppg[0].toFixed(1)}, 25+ ppg ${ppg.filter((x) => x >= 25).length}`,
			);
		}
		// Game flow: contest levels (share, FG% by shot type and level; mean z and make change), and the other counters
		const ct = ["three", "mid", "rim", "post"].map((name, ti) => {
			const n = FLOW_DIAG.ctN[ti];
			const m = FLOW_DIAG.ctMake[ti];
			const tot = n[0] + n[1] + n[2];
			return `${name}: share ${n.map((x) => f3(x / tot)).join("/")} FG% ${n.map((x, l) => f3(m[l] / x)).join("/")} z ${f3(FLOW_DIAG.zSum[ti] / FLOW_DIAG.zN[ti])} make ${(FLOW_DIAG.deltaSum[ti] / FLOW_DIAG.zN[ti]).toFixed(4)}`;
		});
		lines.push(`CONTEST ${ct.join(" | ")}`);
		const means = Object.fromEntries(
			Object.entries(FLOW_DIAG.sums).map(([k, v]) => [
				k,
				Number((v / FLOW_DIAG.counts[`n:${k}`]).toFixed(4)),
			]),
		);
		lines.push(
			`FLOW counts ${JSON.stringify(FLOW_DIAG.counts)} means ${JSON.stringify(means)}`,
		);
		const badgeMeans = Object.fromEntries(
			Object.entries(BADGE_DIAG.sum).map(([k, v]) => [
				k,
				Number((v / BADGE_DIAG.n[k]).toFixed(5)),
			]),
		);
		if (Object.keys(badgeMeans).length > 0) {
			lines.push(
				`BADGES mean raw effect ${JSON.stringify(badgeMeans)} n ${JSON.stringify(BADGE_DIAG.n)}`,
			);
		}
		console.log(lines.join("\n"));
		if (out) {
			if (Object.keys(badgeMeans).length > 0) {
				appendFileSync(
					out,
					`${JSON.stringify({ kind: "badges", seed, sum: BADGE_DIAG.sum, n: BADGE_DIAG.n })}\n`,
				);
			}
			appendFileSync(
				out,
				`${JSON.stringify({ kind: "flow", seed, ctN: FLOW_DIAG.ctN, ctMake: FLOW_DIAG.ctMake, zSum: FLOW_DIAG.zSum, zN: FLOW_DIAG.zN, deltaSum: FLOW_DIAG.deltaSum, counts: FLOW_DIAG.counts, sums: FLOW_DIAG.sums })}\n`,
			);
		}
	},
);
