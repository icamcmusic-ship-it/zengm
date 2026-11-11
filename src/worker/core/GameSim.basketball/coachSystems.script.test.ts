// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Coaching systems calibration: league averages with and without coaching systems, the spread of team tendencies, and the win impact of
// scheme fit. Run with COACH_CAL=1 npx vitest --run --project basketball <this file> (COACH_LEAGUES, COACH_GAMES to change the size)
import { test } from "vitest";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import {
	boxAverages,
	genLeague,
	simLeague,
	teamRates,
} from "./coachSystemsMetrics.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import {
	DEFENSE_NAMES,
	NEUTRAL_COACH_SIM,
	DEFENSE_SYSTEMS,
	OFFENSE_NAMES,
	OFFENSE_SYSTEMS,
	playerSchemeFit,
	rosterSchemeFit,
} from "../../../common/coachSystems.ts";
import { fitRatingsOf } from "../staff/systems.ts";
import { range } from "../../../common/utils.ts";

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const f = (x, d = 3) => x.toFixed(d);

const SETTINGS = {
	realisticPossessions: true,
	simFixes: true,
	positionalComposites: true,
	realisticRotations: true,
	expandedRatings: true,
	playerTraits: true,
};

test.skipIf(!process.env.COACH_FIT)("scheme fit baselines", async () => {
	const off = Object.fromEntries(OFFENSE_SYSTEMS.map((s) => [s, []]));
	const def = Object.fromEntries(DEFENSE_SYSTEMS.map((s) => [s, []]));
	const tOff = Object.fromEntries(OFFENSE_SYSTEMS.map((s) => [s, []]));
	const tDef = Object.fromEntries(DEFENSE_SYSTEMS.map((s) => [s, []]));
	for (const seed of range(30)) {
		await withSeededRandom(seed * 13 + 1, async () => {
			await genTeams();
			for (const tid of [0, 1]) {
				const players = (
					await idb.cache.players.indexGetAll("playersByTid", tid)
				).sort((a, b) => b.valueNoPot - a.valueNoPot);
				for (const p of players.slice(0, 9)) {
					const fit = playerSchemeFit(fitRatingsOf(p));
					for (const s of OFFENSE_SYSTEMS) {off[s].push(fit.off[s]);}
					for (const s of DEFENSE_SYSTEMS) {def[s].push(fit.def[s]);}
				}
				const fit = rosterSchemeFit(players.map(fitRatingsOf));
				for (const s of OFFENSE_SYSTEMS) {tOff[s].push(fit.off[s]);}
				for (const s of DEFENSE_SYSTEMS) {tDef[s].push(fit.def[s]);}
			}
		});
	}
	for (const s of OFFENSE_SYSTEMS) {
		console.log(
			`${s}: player mean ${f(mean(off[s]), 4)} sd ${f(sd(off[s]), 4)}, team mean ${f(mean(tOff[s]), 4)} sd ${f(sd(tOff[s]), 4)}`,
		);
	}
	for (const s of DEFENSE_SYSTEMS) {
		console.log(
			`${s}: player mean ${f(mean(def[s]), 4)} sd ${f(sd(def[s]), 4)}, team mean ${f(mean(tDef[s]), 4)} sd ${f(sd(tDef[s]), 4)}`,
		);
	}
});

test.skipIf(!process.env.COACH_CAL)(
	"coaching systems calibration",
	async () => {
		const numLeagues = Number(process.env.COACH_LEAGUES ?? 2);
		const gamesPerPair = Number(process.env.COACH_GAMES ?? 20);
		const settings = process.env.COACH_STOCK ? {} : SETTINGS;
		const offRows = [];
		const onRows = [];
		const leagues = [];
		for (const L of range(numLeagues)) {
			const league = await genLeague({ numPairs: 15, seed: 100 + L, settings });
			// COACH_ONLY=key,key: only these effects (the rest neutral), to see where a change comes from
			if (process.env.COACH_ONLY) {
				const only = new Set(process.env.COACH_ONLY.split(","));
				for (const t of league) {
					for (const [key, value] of Object.entries(NEUTRAL_COACH_SIM)) {
						if (!only.has(key)) {
							t.sim[key] = value;
						}
					}
				}
			}
			leagues.push(league);
			offRows.push(
				await simLeague({
					league,
					seed: 200 + L,
					gamesPerPair,
					coaches: false,
					settings,
				}),
			);
			onRows.push(
				await simLeague({
					league,
					seed: 200 + L,
					gamesPerPair,
					coaches: true,
					settings,
				}),
			);
		}
		const off = boxAverages(offRows.flat());
		const on = boxAverages(onRows.flat());
		console.log("stat | off | on");
		for (const key of Object.keys(off)) {
			console.log(`${key} | ${f(off[key])} | ${f(on[key])}`);
		}

		// Team spreads
		const spreads = { off: [], on: [] };
		const byOff = {};
		const byDef = {};
		const fitWin = [];
		for (const [L, league] of leagues.entries()) {
			const rOff = teamRates(offRows[L], league.length);
			const rOn = teamRates(onRows[L], league.length);
			spreads.off.push(...rOff);
			spreads.on.push(...rOn);
			for (const [i, t] of league.entries()) {
				(byOff[t.profile.off] ??= []).push({ on: rOn[i], off: rOff[i] });
				(byDef[t.profile.def] ??= []).push({ on: rOn[i], off: rOff[i] });
				fitWin.push({
					fit: 0.6 * t.offFit + 0.4 * t.defFit,
					make: t.sim.make - t.sim.dMake,
					dNet: rOn[i].net - rOff[i].net,
					dWin: rOn[i].winPct - rOff[i].winPct,
				});
			}
		}
		for (const key of ["tpaRate", "pace", "orbp", "tovForced", "net"]) {
			console.log(
				`team SD ${key}: off ${f(sd(spreads.off.map((r) => r[key])))} on ${f(sd(spreads.on.map((r) => r[key])))}; range on ${f(Math.min(...spreads.on.map((r) => r[key])))}-${f(Math.max(...spreads.on.map((r) => r[key])))}`,
			);
		}
		console.log("offense system | n | 3PA rate (on - off) | pace | ORB% | net");
		for (const s of OFFENSE_SYSTEMS) {
			const rows = byOff[s] ?? [];
			if (rows.length === 0) {continue;}
			const d = (k) => mean(rows.map((r) => r.on[k] - r.off[k]));
			console.log(
				`${OFFENSE_NAMES[s]} | ${rows.length} | ${f(d("tpaRate"))} | ${f(d("pace"), 1)} | ${f(d("orbp"))} | ${f(d("net"), 1)}`,
			);
		}
		console.log("defense system | n | TOV forced/100 (on - off) | net");
		for (const s of DEFENSE_SYSTEMS) {
			const rows = byDef[s] ?? [];
			if (rows.length === 0) {continue;}
			const d = (k) => mean(rows.map((r) => r.on[k] - r.off[k]));
			console.log(
				`${DEFENSE_NAMES[s]} | ${rows.length} | ${f(d("tovForced"), 2)} | ${f(d("net"), 1)}`,
			);
		}
		// Win impact of fit: slope of the change in net rating and win% on fit (per 0.01 of fit, about 1 SD)
		const fits = fitWin.map((r) => r.fit);
		const slope = (ys) => {
			const mx = mean(fits);
			const my = mean(ys);
			let num = 0;
			let den = 0;
			for (const [i, x] of fits.entries()) {
				num += (x - mx) * (ys[i] - my);
				den += (x - mx) ** 2;
			}
			return num / den;
		};
		console.log(
			`fit SD ${f(sd(fits), 2)}; per 1 SD of fit: net ${f(slope(fitWin.map((r) => r.dNet)) * sd(fits), 2)} pts/100, win% ${f(slope(fitWin.map((r) => r.dWin)) * sd(fits), 3)}; make delta SD ${f(sd(fitWin.map((r) => r.make)), 4)}`,
		);
		console.log(`g.realisticPossessions ${g.get("realisticPossessions")}`);
	},
	3_600_000,
);
