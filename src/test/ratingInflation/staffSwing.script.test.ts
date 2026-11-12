// @ts-nocheck (node-only script, like staffDrift.script.test.ts)
/* eslint-disable no-undef */
// RUN_STAFF_SWING=1: how much a team's coaching staff development effect and each coach's development rating move from one season to
// the next (docs/rating-inflation.md, "Coaching staff: year-to-year swings"). Real staff market, AI teams, random records.
import { test } from "vitest";
import { coachingEffect } from "../../common/budgetLevels.ts";
import { PHASE } from "../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../../worker/db/index.ts";
import { g, helpers } from "../../worker/util/index.ts";
import { team } from "../../worker/core/index.ts";
import {
	ensureStaff,
	getStaffLevel,
	onPreseason,
	runOffseason,
} from "../../worker/core/staff/index.ts";

const sd = (xs: number[]) => {
	const m = xs.reduce((a, b) => a + b, 0) / xs.length;
	return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const corr = (xs: number[], ys: number[]) => {
	const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
	const my = ys.reduce((a, b) => a + b, 0) / ys.length;
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	for (const [i, x] of xs.entries()) {
		sxy += (x - mx) * (ys[i] - my);
		sxx += (x - mx) ** 2;
		syy += (ys[i] - my) ** 2;
	}
	return sxy / Math.sqrt(sxx * syy);
};

test.skipIf(!process.env.RUN_STAFF_SWING)(
	"staff development swings",
	async () => {
		const seeds = (process.env.SWING_SEEDS ?? "1,2,3,4").split(",").map(Number);
		const years = Number(process.env.SWING_YEARS ?? 25);
		// Per team per season: instantaneous effect, and the 3-season average player development uses (getLevelLastThree)
		const eff: number[] = [];
		const dEff: number[] = [];
		const dEff3: number[] = [];
		const eff3: number[] = [];
		const prevEff: number[] = [];
		const nextEff: number[] = [];
		const dEffSameStaff: number[] = [];
		const dEffChanged: number[] = [];
		const dDev: number[] = [];
		const dDevRole: number[] = [];
		const realRandom = Math.random;
		for (const seed of seeds) {
			let s = seed * 7919;
			Math.random = () => {
				s = (s * 16807) % 2147483647;
				return (s - 1) / 2147483646;
			};
			resetG();
			g.setWithoutSavingToDB("coachingStaff", true);
			g.setWithoutSavingToDB("userTids", [-1] as any);
			g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
			idb.league = mockIDBLeague();
			const teams = helpers.getTeamsDefault().map(team.generate);
			await resetCache({ teams });
			await ensureStaff();
			const hist = new Map<number, number[]>();
			let prevStaff = new Map<number, string>();
			let prevDev = new Map<number, number>();
			for (let year = 0; year <= years; year++) {
				const staffKey = new Map<number, string>();
				for (const t of teams) {
					const level = await getStaffLevel(t.tid);
					const e = coachingEffect(level);
					const h = hist.get(t.tid) ?? [];
					h.push(e);
					hist.set(t.tid, h);
					const cs = await idb.cache.coaches.indexGetAll("coachesByTid", t.tid);
					staffKey.set(
						t.tid,
						cs
							.map((c) => `${c.role}${c.cid}`)
							.sort()
							.join(),
					);
					// Burn-in of 5 seasons: the initial staffs are a special draw
					if (year >= 5) {
						eff.push(e);
						const prev = h.at(-2);
						if (prev !== undefined) {
							dEff.push(e - prev);
							prevEff.push(prev);
							nextEff.push(e);
							(prevStaff.get(t.tid) === staffKey.get(t.tid)
								? dEffSameStaff
								: dEffChanged
							).push(e - prev);
						}
						if (h.length >= 4) {
							const a = (h.at(-1) + h.at(-2) + h.at(-3)) / 3;
							const b = (h.at(-2) + h.at(-3) + h.at(-4)) / 3;
							eff3.push(a);
							dEff3.push(a - b);
						}
					}
				}
				const devNow = new Map<number, number>();
				for (const c of await idb.cache.coaches.getAll()) {
					if (c.tid === -3) {
						continue;
					}
					devNow.set(c.cid, c.ratings.dev);
					const before = prevDev.get(c.cid);
					if (year >= 5 && before !== undefined) {
						dDev.push(c.ratings.dev - before);
						if (c.role === "dev" && c.tid >= 0) {
							dDevRole.push(c.ratings.dev - before);
						}
					}
				}
				prevDev = devNow;
				prevStaff = staffKey;
				const season = g.get("season");
				for (const t of teams) {
					const won = Math.round(Math.random() * 82);
					const ts = team.genSeasonRow(t, undefined, season);
					ts.won = won;
					ts.lost = 82 - won;
					ts.playoffRoundsWon = won > 45 ? Math.floor(Math.random() * 5) : -1;
					await idb.cache.teamSeasons.add(ts);
				}
				g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
				await runOffseason();
				g.setWithoutSavingToDB("season", season + 1);
				g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
				await onPreseason();
				g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
			}
		}
		Math.random = realRandom;
		const f = (x: number) => (100 * x).toFixed(3);
		console.log(
			JSON.stringify(
				{
					n: eff.length,
					"effect mean (%)": f(eff.reduce((a, b) => a + b, 0) / eff.length),
					"effect SD across teams (%)": f(sd(eff)),
					"effect year-to-year change SD (%)": f(sd(dEff)),
					"effect lag-1 correlation": corr(prevEff, nextEff).toFixed(3),
					"same staff: change SD (%)": f(sd(dEffSameStaff)),
					"same staff share": (dEffSameStaff.length / dEff.length).toFixed(3),
					"staff changed: change SD (%)": f(sd(dEffChanged)),
					"3-season avg effect SD (%)": f(sd(eff3)),
					"3-season avg change SD (%)": f(sd(dEff3)),
					"coach dev rating change SD": sd(dDev).toFixed(3),
					"dev coaches' dev rating change SD": sd(dDevRole).toFixed(3),
				},
				null,
				1,
			),
		);
	},
	3600 * 1000,
);
