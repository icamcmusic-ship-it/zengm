// @ts-nocheck (node-only script, like parity.script.test.ts)
/* eslint-disable no-undef */
// Margin per team ovr point, measured directly: new random leagues (new-league defaults), random pairs of teams playing single
// games at a neutral site, game margin regressed on the team ovr difference. Much faster than a full season (parity.script.test.ts)
// and it can switch features in-process. Run with
// RUN_MARGIN=1 npx vitest run --project basketball --maxWorkers=1 src/test/parity/marginSlope.script.test.ts
// Env: MARGIN_SEEDS (comma list, default 1,2,3), MARGIN_GAMES (per seed, default 600), MARGIN_SET (JSON settings on top)
import { test } from "vitest";
import { team } from "../../worker/core/index.ts";
import GameSim from "../../worker/core/GameSim.basketball/index.ts";
import loadTeams from "../../worker/core/game/loadTeams.ts";
import { idb } from "../../worker/db/index.ts";
import { SIM_FIX_STRENGTH_GAP } from "../../worker/core/GameSim.basketball/simSettings.ts";
import {
	ALL_ON,
	createLeague,
	mulberry32,
} from "../ratingInflation/harness.ts";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
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

test.skipIf(!process.env.RUN_MARGIN)(
	"margin slope",
	async () => {
		if (globalThis.IDBRequest === undefined) {
			await import("fake-indexeddb/auto");
		}
		const seeds = (process.env.MARGIN_SEEDS ?? "1,2,3").split(",").map(Number);
		const nGames = Number(process.env.MARGIN_GAMES ?? 600);
		const extra = JSON.parse(process.env.MARGIN_SET ?? "{}");
		const knob = JSON.parse(process.env.MARGIN_KNOB ?? "{}");
		Object.assign(SIM_FIX_STRENGTH_GAP, knob);
		const dOvr = [];
		const margin = [];
		const win = [];
		let pts = 0;
		let fga = 0;
		let fg = 0;
		let poss = 0;
		let tov = 0;
		const origRandom = Math.random;
		for (const seed of seeds) {
			Math.random = mulberry32(seed);
			await createLeague({ ...ALL_ON, ...extra });
			const ovrs = {};
			const tids = (await idb.cache.teams.getAll())
				.filter((t) => !t.disabled)
				.map((t) => t.tid);
			for (const tid of tids) {
				const players = (
					await idb.cache.players.indexGetAll("playersByTid", tid)
				)
					.map((p) => ({
						ratings: { ovr: p.ratings.at(-1).ovr, pos: p.ratings.at(-1).pos },
					}))
					.sort((a, b) => b.ratings.ovr - a.ratings.ovr);
				ovrs[tid] = team.ovr(players);
			}
			for (let i = 0; i < nGames; i++) {
				const a = tids[Math.floor(Math.random() * tids.length)];
				let b = a;
				while (b === a) {
					b = tids[Math.floor(Math.random() * tids.length)];
				}
				const teams = await loadTeams([a, b], {});
				const result = new GameSim({
					gid: i,
					teams: [teams[a], teams[b]],
					baseInjuryRate: 0,
					doPlayByPlay: false,
					homeCourtFactor: 1,
					allStarGame: false,
					neutralSite: true,
				}).run();
				const [t0, t1] = result.team;
				dOvr.push(ovrs[a] - ovrs[b]);
				margin.push(t0.stat.pts - t1.stat.pts);
				win.push(t0.stat.pts > t1.stat.pts ? 1 : 0);
				for (const t of result.team) {
					pts += t.stat.pts;
					fga += t.stat.fga;
					fg += t.stat.fg;
					tov += t.stat.tov;
					poss += t.stat.fga - t.stat.orb + t.stat.tov + 0.44 * t.stat.fta;
				}
			}
		}
		Math.random = origRandom;
		const n = margin.length;
		const s = slope(dOvr, margin);
		const resid = margin.map((m, i) => m - s * dOvr[i]);
		const seSlope =
			Math.sqrt(mean(resid.map((r) => r ** 2))) /
			Math.sqrt(dOvr.reduce((acc, x) => acc + (x - mean(dOvr)) ** 2, 0));
		process.stdout.write(
			`MARGIN ${JSON.stringify({
				extra,
				knob,
				n,
				slope: Math.round(s * 1000) / 1000,
				se: Math.round(seSlope * 1000) / 1000,
				winPerOvr: Math.round(slope(dOvr, win) * 10000) / 10000,
				pts: Math.round((pts / n / 2) * 100) / 100,
				fgPct: Math.round((1000 * fg) / fga) / 10,
				poss: Math.round((poss / n / 2) * 100) / 100,
				tov: Math.round((tov / n / 2) * 100) / 100,
			})}\n`,
		);
	},
	24 * 60 * 60 * 1000,
);
