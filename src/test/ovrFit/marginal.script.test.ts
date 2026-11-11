// @ts-nocheck (node-only script, like src/test/ratingInflation/pop.script.test.ts)
/* eslint-disable */
// Marginal value of each rating in the real GameSim, the input of the Sim-Calibrated Ovr fit (fit.script.test.ts, docs/native-features.md).
// Every game, every player on both teams gets an independent +-10 (Rademacher) perturbation of every rating (ovr/valueNoPot NOT
// recomputed, so the rotation is unchanged except through endurance/fatigue). Team exposure X_r = sum_p (delta_pr / 10) * (min_p / 36),
// i.e. "one 36-minute player +10". OLS: margin_A ~ home + (X_A - X_B); ptsA ~ X_A (offense) + X_B (defense). Also records ovr vs +/-.
// RA_MODE=off|on  RA_ROSTERS  RA_GAMES (per roster)  RA_OUT (full output with player records)  RA_FIT_OUT (the trimmed file the fit
// reads, default src/test/ovrFit/marginal-<mode>.json). RA_SIM=defaults (default: the new-league game sim extras on) | off (stock sim). Measured with ovrV2 off, so the rotation is the stock one:
//   RA_MODE=off RA_ROSTERS=16 RA_GAMES=1000 node_modules/.bin/vitest run --project basketball src/test/ovrFit/marginal.script.test.ts
import { test } from "vitest";
import { writeFileSync } from "node:fs";
import GameSim from "../../worker/core/GameSim.basketball/index.ts";
import loadTeams from "../../worker/core/game/loadTeams.ts";
import { g, helpers } from "../../worker/util/index.ts";
import { withSeededRandom } from "../../worker/core/GameSim.basketball/simLiveGameForTests.ts";
import { team } from "../../worker/core/index.ts";
import createRandomPlayers from "../../worker/core/league/create/createRandomPlayers.ts";
import { resetCache, resetG } from "../helpers.ts";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import { last, range } from "../../common/utils.ts";
import { idb } from "../../worker/db/index.ts";
import { nativeFeatureNewLeagueDefaults } from "../../common/nativeFeatures.ts";

// League extras that change the game sim (player traits stay off: generated players here have no trait seeds)
const SIM_SETTINGS = [
	"realisticPossessions",
	"technicalFouls",
	"perimeterDefense",
	"simFixes",
	"positionalComposites",
	"realisticRotations",
];
const simDefaults = (env_: any) => (env_.RA_SIM ?? "defaults") === "defaults";

const env = (globalThis as any).process?.env ?? {};
const simDefaultsOn = simDefaults(env);
const NUM_TEAMS = 30;

const STOCK = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
];
const EXP = ["wng", "pdef", "idef", "oreb", "dreb", "csh", "dsh", "bsc"];

const genLeague = async (expandedGen: boolean) => {
	resetG();
	g.setWithoutSavingToDB("expandedRatings", expandedGen);
	await resetCache({});
	const players: any[] = await createRandomPlayers({
		activeTids: range(NUM_TEAMS),
		onlyFreeAgents: false,
		scoutingLevel: DEFAULT_LEVEL,
		teams: range(NUM_TEAMS).map((tid) => ({ tid })),
	});
	for (const p of players) {
		const r = last(p.ratings) as { ovr: number };
		p.valueNoPot = r.ovr;
		p.valueNoPotFuzz = r.ovr;
		p.value = r.ovr;
		p.valueFuzz = r.ovr;
		if (
			p.tid >= 0 &&
			p.contractDemand &&
			!Number.isFinite(p.contractDemand.exp)
		) {
			p.contractDemand = {
				...p.contractDemand,
				exp: g.get("season") + 1,
				temp: undefined,
			};
		}
	}
	for (const tid of range(NUM_TEAMS)) {
		const roster = players
			.filter((p) => p.tid === tid)
			.sort((a, b) => b.valueNoPot - a.valueNoPot);
		for (const [i, p] of roster.entries()) {
			p.rosterOrder = i;
		}
	}
	const teamsDefault = helpers.getTeamsDefault().slice(0, NUM_TEAMS);
	await resetCache({
		players,
		teams: teamsDefault.map(team.generate),
		teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
		teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
	});
};

// OLS via normal equations, returns coef and SE
const ols = (X: number[][], y: number[]) => {
	const n = X.length;
	const k = X[0]!.length;
	const XtX = range(k).map(() => new Array(k).fill(0));
	const Xty = new Array(k).fill(0);
	for (let i = 0; i < n; i++) {
		const xi = X[i]!;
		for (let a = 0; a < k; a++) {
			Xty[a] += xi[a]! * y[i]!;
			for (let b = 0; b < k; b++) {
				XtX[a]![b] += xi[a]! * xi[b]!;
			}
		}
	}
	// invert XtX (Gauss-Jordan)
	const M = XtX.map((row, i) => [
		...row,
		...range(k).map((j) => (i === j ? 1 : 0)),
	]);
	for (let c = 0; c < k; c++) {
		let piv = c;
		for (let r = c + 1; r < k; r++) {
			if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
		}
		[M[c], M[piv]] = [M[piv]!, M[c]!];
		const d = M[c]![c]!;
		for (let j = 0; j < 2 * k; j++) M[c]![j]! /= d;
		for (let r = 0; r < k; r++) {
			if (r !== c) {
				const f = M[r]![c]!;
				for (let j = 0; j < 2 * k; j++) M[r]![j]! -= f * M[c]![j]!;
			}
		}
	}
	const inv = M.map((row) => row.slice(k));
	const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j]!, 0));
	let sse = 0;
	let sst = 0;
	const ybar = y.reduce((s, v) => s + v, 0) / n;
	for (let i = 0; i < n; i++) {
		const pred = X[i]!.reduce((s, v, j) => s + v * beta[j]!, 0);
		sse += (y[i]! - pred) ** 2;
		sst += (y[i]! - ybar) ** 2;
	}
	const s2 = sse / (n - k);
	const se = inv.map((row, i) => Math.sqrt(s2 * row[i]!));
	return { beta, se, r2: 1 - sse / sst };
};

test.skipIf(!env.RA_MODE)(
	"marginal rating values",
	async () => {
		const expanded = env.RA_MODE === "on";
		const keys = expanded ? [...STOCK, ...EXP] : STOCK;
		const GROUPS = env.RA_GROUPS ? ["G", "W", "B"] : [""];
		const grpOf = (h: number) =>
			!env.RA_GROUPS ? "" : h < 40 ? "G" : h < 55 ? "W" : "B";
		const feats = GROUPS.flatMap((gr) => keys.map((k) => [k, gr] as const));
		const numRosters = Number(env.RA_ROSTERS ?? 10);
		const gamesPerRoster = Number(env.RA_GAMES ?? 300);
		const AMP = 10;

		const rowsMargin: number[][] = [];
		const yMargin: number[] = [];
		const yWin: number[] = [];
		const rowsOff: number[][] = [];
		const yPtsPer100: number[] = [];
		// team-level predictors without perturbation info: diff of team ovr (loadTeams) and min-weighted player ovr
		const teamOvrRows: number[][] = [];
		const minOvrRows: number[][] = [];
		// player records: pid key -> ratings, ovr, sum pm, min
		const playerRec = new Map<
			string,
			{
				r: Record<string, number>;
				ovr: number;
				pos: string;
				min: number;
				pm: number;
				gp: number;
			}
		>();
		let possTotal = 0;
		let teamGames = 0;
		const t0 = Date.now();

		for (let ro = 0; ro < numRosters; ro++) {
			await withSeededRandom(
				9001 + ro * 7919 + (expanded ? 1 : 0),
				async () => {
					await genLeague(expanded);
					g.setWithoutSavingToDB("expandedRatings", expanded);
					g.setWithoutSavingToDB("playerTraits", false);
					g.setWithoutSavingToDB("ovrV2", false);
					// Game sim settings: the new-league defaults (RA_SIM=defaults, the default) or the stock sim (RA_SIM=off)
					for (const key of SIM_SETTINGS) {
						g.setWithoutSavingToDB(
							key as any,
							simDefaultsOn
								? (nativeFeatureNewLeagueDefaults() as any)[key] === true
								: false,
						);
					}
					g.setWithoutSavingToDB("storePlayByPlay", false);
					const players = await idb.cache.players.getAll();
					const base = new Map<number, Record<string, number>>();
					for (const p of players) {
						const r = last(p.ratings) as any;
						base.set(p.pid, Object.fromEntries(keys.map((k) => [k, r[k]])));
					}
					for (let i = 0; i < gamesPerRoster; i++) {
						const a = i % NUM_TEAMS;
						const b =
							(a + 1 + (Math.floor(i / NUM_TEAMS) % (NUM_TEAMS - 1))) %
							NUM_TEAMS;
						// perturb
						const deltas = new Map<number, Record<string, number>>();
						for (const p of players) {
							if (p.tid !== a && p.tid !== b) continue;
							const r = last(p.ratings) as any;
							const b0 = base.get(p.pid)!;
							const d: Record<string, number> = {};
							for (const k of keys) {
								const v = helpers.bound(
									b0[k]! + (Math.random() < 0.5 ? -AMP : AMP),
									0,
									100,
								);
								d[k] = v - b0[k]!;
								r[k] = v;
							}
							deltas.set(p.pid, d);
						}
						const teams = await loadTeams([a, b], {});
						const pair: [any, any] =
							i % 2 === 0 ? [teams[a]!, teams[b]!] : [teams[b]!, teams[a]!];
						const ovrDiff = pair[0].ovr - pair[1].ovr;
						const sim = new GameSim({
							gid: ro * 100000 + i,
							teams: pair,
							baseInjuryRate: 0,
							doPlayByPlay: false,
							homeCourtFactor: 1,
							allStarGame: false,
							neutralSite: false,
						});
						const res = sim.run();
						// restore
						for (const p of players) {
							if (!deltas.has(p.pid)) continue;
							const r = last(p.ratings) as any;
							const b0 = base.get(p.pid)!;
							for (const k of keys) r[k] = b0[k];
						}
						const X: number[][] = [[], []];
						const minOvr = [0, 0];
						for (const ti of [0, 1]) {
							const tm = res.team[ti];
							for (const [k, gr] of feats) {
								let s = 0;
								for (const pl of tm.player) {
									const d = deltas.get(pl.id);
									if (d && grpOf(base.get(pl.id)!.hgt!) === gr)
										s += (d[k]! / 10) * (pl.stat.min / 36);
								}
								X[ti]!.push(s);
							}
							let mw = 0;
							for (const pl of tm.player) {
								const p = players.find((pp) => pp.pid === pl.id)!;
								const ovr = (last(p.ratings) as any).ovr;
								mw += ovr * pl.stat.min;
								const key = `${ro}|${pl.id}`;
								let rec = playerRec.get(key);
								if (!rec) {
									rec = {
										r: { ...base.get(pl.id)! },
										ovr,
										pos: (last(p.ratings) as any).pos,
										min: 0,
										pm: 0,
										gp: 0,
									};
									playerRec.set(key, rec);
								}
								rec.min += pl.stat.min;
								rec.pm += pl.stat.pm;
								if (pl.stat.min > 0) rec.gp += 1;
							}
							minOvr[ti] = mw / 240;
						}
						const m = res.team[0].stat.pts - res.team[1].stat.pts;
						rowsMargin.push([1, ...X[0]!.map((v, j) => v - X[1]![j]!)]);
						yMargin.push(m);
						yWin.push(m > 0 ? 1 : 0);
						teamOvrRows.push([1, ovrDiff]);
						minOvrRows.push([1, minOvr[0]! - minOvr[1]!]);
						const poss =
							(res.team[0].stat.fga +
								0.44 * res.team[0].stat.fta -
								res.team[0].stat.orb +
								res.team[0].stat.tov +
								res.team[1].stat.fga +
								0.44 * res.team[1].stat.fta -
								res.team[1].stat.orb +
								res.team[1].stat.tov) /
							2;
						possTotal += poss;
						teamGames += 1;
						for (const ti of [0, 1]) {
							rowsOff.push([1, ti === 0 ? 1 : 0, ...X[ti]!, ...X[1 - ti]!]);
							yPtsPer100.push((100 * res.team[ti].stat.pts) / poss);
						}
					}
				},
			);
			(globalThis as any).process.stdout.write(
				`roster ${ro} done, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`,
			);
		}
		const fit = ols(rowsMargin, yMargin);
		const fitW = ols(rowsMargin, yWin);
		const fitO = ols(rowsOff, yPtsPer100);
		const k = feats.length;
		const out: any = {
			mode: env.RA_MODE,
			games: yMargin.length,
			possPerGame: possTotal / teamGames,
			r2: fit.r2,
			home: fit.beta[0],
			ratings: feats.map(([key0, gr], j) => ({
				key: key0 + (gr ? "_" + gr : ""),
				margin: fit.beta[j + 1],
				marginSE: fit.se[j + 1],
				winp: fitW.beta[j + 1],
				winpSE: fitW.se[j + 1],
				off100: fitO.beta[j + 2],
				off100SE: fitO.se[j + 2],
				def100: -fitO.beta[j + 2 + k]!,
				def100SE: fitO.se[j + 2 + k],
			})),
			teamOvrFit: ols(teamOvrRows, yMargin),
			minOvrFit: ols(minOvrRows, yMargin),
			players: [...playerRec.values()].filter((r) => r.min >= 500),
		};
		if (env.RA_OUT) {
			writeFileSync(env.RA_OUT, JSON.stringify(out));
		}
		const trimmed = {
			mode: out.mode,
			sim: simDefaultsOn ? "new-league defaults" : "stock",
			games: out.games,
			ratings: out.ratings.map((r: any) => ({
				key: r.key,
				margin: Number(r.margin.toFixed(4)),
				marginSE: Number(r.marginSE.toFixed(4)),
			})),
		};
		writeFileSync(
			env.RA_FIT_OUT ?? `src/test/ovrFit/marginal-${env.RA_MODE}.json`,
			JSON.stringify(trimmed, null, "\t") + "\n",
		);
		(globalThis as any).process.stdout.write(
			out.ratings
				.map(
					(r: any) =>
						`${r.key}\t${r.margin.toFixed(3)}±${r.marginSE.toFixed(3)}\tO ${r.off100.toFixed(3)}\tD ${r.def100.toFixed(3)}\tW ${(100 * r.winp).toFixed(2)}%`,
				)
				.join("\n") +
				`\nR2 ${fit.r2.toFixed(3)} teamOvr r2 ${out.teamOvrFit.r2.toFixed(3)} slope ${out.teamOvrFit.beta[1].toFixed(3)}\n`,
		);
	},
	24 * 3600 * 1000,
);
