// @ts-nocheck (diagnostic script)
// Jump shot skill gradient: plays seasons of a new random league (new-league defaults plus the 2026 preset) and prints, over all of
// its seasons, the league totals, 3P% and volume by three-point rating (players with 100+ 3PA) and its correlation with the rating,
// mid-range share and FG% by mid-range rating, and the top scorers. THREE_GRAD_OUT also writes one JSON line per player season and one
// per season's league totals (to pool several seeds).
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
import { SIM_FIX_SHOT_CHOICE, SIM_FIX_THREE } from "./simSettings.ts";

const env = (globalThis as any).process.env;
// THREE_GRAD_CONST changes the sim's constants (for tuning)
if (env.THREE_GRAD_CONST) {
	const mods = {
		ATTENTION,
		STAR,
		SIM_FIX_SHOT_CHOICE,
		SHOT_SHARE,
		SIM_FIX_THREE,
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

		const leagues = [];
		const players = [];
		for (let i = 0; i < numSeasons; i++) {
			const s = g.get("season");
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await lock.set("gameSim", false);
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

			const sum = { gp: 0, pts: 0, fga: 0, fg: 0, tpa: 0, tp: 0 };
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
			};
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
			`LEAGUE pts ${mean(leagues.map((l) => l.pts)).toFixed(2)} 3P% ${f3(mean(leagues.map((l) => l.tpp)))} 3PA rate ${f3(mean(leagues.map((l) => l.tpaRate)))} FG% ${f3(mean(leagues.map((l) => l.fgp)))}`,
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
		console.log(lines.join("\n"));
	},
);
