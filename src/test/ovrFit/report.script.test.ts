// @ts-nocheck (node-only script, like src/test/ratingInflation/pop.script.test.ts)
/* eslint-disable */
// Report for the Sim-Calibrated Ovr fit (docs/native-features.md): on generated leagues (other seeds than the fit), stock vs v2 ovr with
// Expanded Ratings off and on: the league's ovr distribution, correlation with sim impact (sum of measured slope * rating), the mean
// impact residual given ovr by position (in ovr points), and how much a player's ovr moves when Expanded Ratings is toggled.
//   OVR_REPORT=1 [REPORT_MARGINAL_DIR=dir with marginal-off/on.json of another sim configuration] node_modules/.bin/vitest run --project basketball src/test/ovrFit/report.script.test.ts
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { g } from "../../worker/util/index.ts";
import { withSeededRandom } from "../../worker/core/GameSim.basketball/simLiveGameForTests.ts";
import createRandomPlayers from "../../worker/core/league/create/createRandomPlayers.ts";
import genPlayersWithoutSaving from "../../worker/core/draft/genPlayersWithoutSaving.ts";
import ovr from "../../worker/core/player/ovr.ts";
import { resetCache, resetG } from "../helpers.ts";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import { range } from "../../common/utils.ts";
import { fillExpandedRatings } from "../../common/expandedRatings.ts";

const env = process.env;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const corr = (x: number[], y: number[]) => {
	const mx = mean(x);
	const my = mean(y);
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	for (let i = 0; i < x.length; i++) {
		sxy += (x[i] - mx) * (y[i] - my);
		sxx += (x[i] - mx) ** 2;
		syy += (y[i] - my) ** 2;
	}
	return sxy / Math.sqrt(sxx * syy);
};
const q = (xs: number[], p: number) =>
	xs.toSorted((a, b) => a - b)[Math.floor(p * (xs.length - 1))];

const slopes = (mode: string) => {
	const data = JSON.parse(
		readFileSync(
			`${env.REPORT_MARGINAL_DIR ?? "src/test/ovrFit"}/marginal-${mode}.json`,
			"utf8",
		),
	);
	return Object.fromEntries(
		data.ratings.map((r: any) => [r.key, r.margin / 10]),
	);
};

const ovrWith = (r: any, v2: boolean, expanded: boolean) => {
	g.setWithoutSavingToDB("ovrV2", v2);
	g.setWithoutSavingToDB("expandedRatings", expanded);
	return ovr(r);
};

test.skipIf(!env.OVR_REPORT)(
	"ovr v2 report",
	async () => {
		const rows: any[] = [];
		const prospects: any[] = [];
		for (let i = 0; i < Number(env.REPORT_LEAGUES ?? 8); i++) {
			await withSeededRandom(777 + i * 13, async () => {
				resetG();
				g.setWithoutSavingToDB("expandedRatings", false);
				g.setWithoutSavingToDB("ovrV2", false);
				await resetCache({});
				const players: any[] = await createRandomPlayers({
					activeTids: range(30),
					onlyFreeAgents: false,
					scoutingLevel: DEFAULT_LEVEL,
					teams: range(30).map((tid) => ({ tid })),
				});
				for (const p of players) {
					if (p.tid >= 0) {
						fillExpandedRatings(p);
						rows.push(p.ratings.at(-1));
					}
				}
				const dp = await genPlayersWithoutSaving(
					g.get("season"),
					DEFAULT_LEVEL,
					[],
				);
				for (const p of dp) {
					fillExpandedRatings(p);
					prospects.push(p.ratings.at(-1));
				}
			});
		}
		const out: string[] = [];
		const variants = [
			["stock, expanded off", false, false],
			["v2, expanded off", true, false],
			["stock, expanded on", false, true],
			["v2, expanded on", true, true],
		] as const;
		const ovrs: Record<string, number[]> = {};
		out.push(`players ${rows.length}, prospects ${prospects.length}`);
		out.push(
			"| variant | mean | sd | p10 | p50 | p90 | p99 | top-30 prospects mean | corr(ovr, impact) |",
		);
		const POS = ["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"];
		const resid: string[] = [`| variant | ${POS.join(" | ")} |`];
		for (const [name, v2, expanded] of variants) {
			const o = rows.map((r) => ovrWith(r, v2, expanded));
			ovrs[name] = o;
			const m = slopes(expanded ? "on" : "off");
			const impact = rows.map((r) =>
				Object.keys(m).reduce((s, k) => s + m[k] * r[k], 0),
			);
			const po = prospects
				.map((r) => ovrWith(r, v2, expanded))
				.sort((a, b) => b - a)
				.slice(0, 30 * Number(env.REPORT_LEAGUES ?? 8));
			out.push(
				`| ${name} | ${mean(o).toFixed(1)} | ${sd(o).toFixed(1)} | ${q(o, 0.1)} | ${q(o, 0.5)} | ${q(o, 0.9)} | ${q(o, 0.99)} | ${mean(po).toFixed(1)} | ${corr(o, impact).toFixed(3)} |`,
			);
			// impact ~ a + b ovr, residual by position expressed in ovr points
			const mo = mean(o);
			const mi = mean(impact);
			let sxy = 0;
			let sxx = 0;
			for (let j = 0; j < o.length; j++) {
				sxy += (o[j] - mo) * (impact[j] - mi);
				sxx += (o[j] - mo) ** 2;
			}
			const b = sxy / sxx;
			const byPos: Record<string, number[]> = {};
			rows.forEach((r, j) => {
				(byPos[r.pos] ??= []).push((impact[j] - mi - b * (o[j] - mo)) / b);
			});
			resid.push(
				`| ${name} | ${POS.map((p) => (byPos[p] ? mean(byPos[p]).toFixed(1) : "-")).join(" | ")} |`,
			);
		}
		out.push(
			"",
			"Impact residual given ovr, by position (ovr points; + = underrated):",
			...resid,
		);
		for (const v of ["stock", "v2"]) {
			const off = ovrs[`${v}, expanded off`];
			const on = ovrs[`${v}, expanded on`];
			const d = off.map((x, j) => on[j] - x);
			const byPos: Record<string, number[]> = {};
			rows.forEach((r, j) => (byPos[r.pos] ??= []).push(d[j]));
			out.push(
				`toggle Expanded Ratings (${v}): mean shift ${mean(d).toFixed(2)}, mean |shift| ${mean(d.map(Math.abs)).toFixed(2)}, sd ${sd(d).toFixed(2)}, p5 ${q(d, 0.05)}, p95 ${q(d, 0.95)}, by pos ${POS.map((p) => `${p} ${mean(byPos[p]).toFixed(1)}`).join(", ")}`,
			);
		}
		const sv = ovrs["stock, expanded off"].map(
			(x, j) => ovrs["v2, expanded off"][j] - x,
		);
		const byPos: Record<string, number[]> = {};
		rows.forEach((r, j) => (byPos[r.pos] ??= []).push(sv[j]));
		out.push(
			`stock -> v2 (expanded off): mean |shift| ${mean(sv.map(Math.abs)).toFixed(2)}, by pos ${POS.map((p) => `${p} ${mean(byPos[p]).toFixed(1)}`).join(", ")}`,
		);
		process.stdout.write(out.join("\n") + "\n");
	},
	3600 * 1000,
);
