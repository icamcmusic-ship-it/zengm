// @ts-nocheck (node-only script, like ratingInflation/run.script.test.ts)
/* eslint-disable no-undef */
// Parity measurement: seeded multi-season headless sim with new-league defaults, recording the spread of win% and how fast
// a team's average margin rises per team ovr point. Run with
// RUN_PARITY=1 npx vitest run --project basketball src/test/parity/parity.script.test.ts
// Env: PARITY_SEEDS (comma list, default 1,2), PARITY_SEASONS (default 3), PARITY_OUT (file to append the rows to)
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { idb } from "../../worker/db/index.ts";
import { g } from "../../worker/util/index.ts";
import { team } from "../../worker/core/index.ts";
import { ALL_ON, runLeague } from "../ratingInflation/harness.ts";

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
		const rows = [];
		for (const seed of seeds) {
			await runLeague({
				config: "parity",
				settings: ALL_ON,
				seed,
				seasons,
				onSeason: async () => {
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
			}),
		);
	},
	24 * 60 * 60 * 1000,
);
