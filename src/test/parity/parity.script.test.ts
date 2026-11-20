// @ts-nocheck (node-only script, like ratingInflation/run.script.test.ts)
/* eslint-disable no-undef */
// Parity measurement: seeded multi-season headless sim with new-league defaults, recording the spread of win% and how fast
// a team's average margin rises per team ovr point. Run with
// RUN_PARITY=1 npx vitest run --project basketball src/test/parity/parity.script.test.ts
// Env: PARITY_SEEDS (comma list, default 1,2), PARITY_SEASONS (default 3), PARITY_OUT (file to append the rows to), PARITY_K
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { idb } from "../../worker/db/index.ts";
import { g } from "../../worker/util/index.ts";
import { team } from "../../worker/core/index.ts";
import { ALL_ON, runLeague } from "../ratingInflation/harness.ts";
import { SIM_FIX_STRENGTH_GAP } from "../../worker/core/GameSim.basketball/simSettings.ts";

const log = (...args: string[]) => {
	const line = args.join(" ");
	if (process.env.PARITY_OUT) {
		appendFileSync(process.env.PARITY_OUT, `${line}\n`);
	}
	process.stdout.write(`${line}\n`);
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const slope = (xs: number[], ys: number[]) => {
	const mx = mean(xs);
	const my = mean(ys);
	let num = 0;
	let den = 0;
	for (let i = 0; i < xs.length; i++) {
		num += (xs[i] - mx) * (ys[i] - my);
		den += (xs[i] - mx) ** 2;
	}
	return num / den;
};

test.skipIf(!process.env.RUN_PARITY)(
	"parity",
	async () => {
		const seeds = (process.env.PARITY_SEEDS ?? "1,2").split(",").map(Number);
		const seasons = Number(process.env.PARITY_SEASONS ?? 3);
		// PARITY_K: the Game Sim Fixes team strength gap constant, to sweep it
		if (process.env.PARITY_K !== undefined) {
			SIM_FIX_STRENGTH_GAP.k = Number(process.env.PARITY_K);
		}
		const rows = [];
		for (const seed of seeds) {
			await runLeague({
				config: "parity",
				settings: ALL_ON,
				seed,
				seasons,
				onSeason: async (summary) => {
					const season = g.get("season");
					const teams = (await idb.cache.teams.getAll()).filter(
						(t) => !t.disabled,
					);
					const allStats = await idb.cache.teamStats.getAll();
					const winp = [];
					const mov = [];
					const ovrs = [];
					const wins = [];
					for (const t of teams) {
						const ts = await idb.cache.teamSeasons.indexGet(
							"teamSeasonsBySeasonTid",
							[season, t.tid],
						);
						const st = allStats.find(
							(r) => r.season === season && r.tid === t.tid && !r.playoffs,
						);
						const gp = ts.won + ts.lost;
						winp.push(ts.won / gp);
						wins.push(ts.won);
						mov.push((st.pts - st.oppPts) / st.gp);
						const players = (
							await idb.cache.players.indexGetAll("playersByTid", t.tid)
						)
							.map((p) => ({
								ratings: {
									ovr: p.ratings.at(-1).ovr,
									pos: p.ratings.at(-1).pos,
								},
							}))
							.sort((a, b) => b.ratings.ovr - a.ratings.ovr);
						ovrs.push(team.ovr(players));
					}
					if (process.env.PARITY_DIAG) {
						const order = ovrs
							.map((o, i) => [o, teams[i].tid])
							.sort((a, b) => b[0] - a[0]);
						const groups = { top: order.slice(0, 8), bot: order.slice(-8) };
						const out = {};
						for (const [name, grp] of Object.entries(groups)) {
							const agg = {};
							for (const [, tid] of grp) {
								const ps = (
									await idb.cache.players.indexGetAll("playersByTid", tid)
								)
									.sort((a, b) => b.ratings.at(-1).ovr - a.ratings.at(-1).ovr)
									.slice(0, 8);
								for (const p of ps) {
									const tr = (p.transactions ?? [])
										.filter((t) => t.tid === tid)
										.at(-1);
									let src = tr ? tr.type : "initial";
									if (src === "draft" && tr.pickNum <= 5) {
										src = "draftTop5";
									}
									agg[src] ??= { n: 0, ovr: 0 };
									agg[src].n += 1;
									agg[src].ovr += p.ratings.at(-1).ovr;
								}
							}
							for (const k of Object.keys(agg)) {
								agg[k] = `${agg[k].n}@${(agg[k].ovr / agg[k].n).toFixed(1)}`;
							}
							out[name] = agg;
						}
						log("DIAG", season, JSON.stringify(out));
					}
					// Star scoring: per-player regular season PPG (min 40 games)
					const ppgs = [];
					for (const p of await idb.cache.players.getAll()) {
						let pts = 0;
						let gp = 0;
						for (const ps of p.stats ?? []) {
							if (ps.season === season && !ps.playoffs) {
								pts += ps.pts;
								gp += ps.gp;
							}
						}
						if (gp >= 40) {
							ppgs.push(pts / gp);
						}
					}
					ppgs.sort((a, b) => b - a);
					const row = {
						seed,
						season,
						winpSd: Math.round(sd(winp) * 1000) / 1000,
						movPerOvr: Math.round(slope(ovrs, mov) * 100) / 100,
						movSd: Math.round(sd(mov) * 100) / 100,
						ovrSd: Math.round(sd(ovrs) * 100) / 100,
						winpPerMov: Math.round(slope(mov, winp) * 10000) / 10000,
						maxWins: Math.max(...wins),
						wins60: wins.filter((w) => w >= 60).length,
						wins20: wins.filter((w) => w <= 20).length,
						ppgMax: Math.round(ppgs[0] * 10) / 10,
						n25: ppgs.filter((x) => x >= 25).length,
						n20: ppgs.filter((x) => x >= 20).length,
						pts: summary.ptsPerGame,
						fgPct: summary.fgPct,
						tpPct: summary.tpPct,
						poss: summary.possPerGame,
						tov: summary.tovPerGame,
						fta: summary.ftaPerGame,
						orb: summary.orbPerGame,
					};
					rows.push(row);
					log("PARITY", JSON.stringify(row));
				},
			});
		}
		log(
			"PARITY MEAN",
			JSON.stringify({
				winpSd: mean(rows.map((r) => r.winpSd)).toFixed(3),
				movPerOvr: mean(rows.map((r) => r.movPerOvr)).toFixed(2),
				movSd: mean(rows.map((r) => r.movSd)).toFixed(2),
				ovrSd: mean(rows.map((r) => r.ovrSd)).toFixed(2),
				winpPerMov: mean(rows.map((r) => r.winpPerMov)).toFixed(4),
				maxWins: mean(rows.map((r) => r.maxWins)).toFixed(1),
				wins60: mean(rows.map((r) => r.wins60)).toFixed(2),
				wins20: mean(rows.map((r) => r.wins20)).toFixed(2),
				ppgMax: mean(rows.map((r) => r.ppgMax)).toFixed(1),
				n25: mean(rows.map((r) => r.n25)).toFixed(2),
				n20: mean(rows.map((r) => r.n20)).toFixed(2),
				pts: mean(rows.map((r) => r.pts)).toFixed(2),
				fgPct: mean(rows.map((r) => r.fgPct)).toFixed(2),
				tpPct: mean(rows.map((r) => r.tpPct)).toFixed(2),
				poss: mean(rows.map((r) => r.poss)).toFixed(2),
				tov: mean(rows.map((r) => r.tov)).toFixed(2),
				fta: mean(rows.map((r) => r.fta)).toFixed(2),
				orb: mean(rows.map((r) => r.orb)).toFixed(2),
			}),
		);
	},
	24 * 60 * 60 * 1000,
);
