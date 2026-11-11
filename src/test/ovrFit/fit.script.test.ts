// @ts-nocheck (node-only script, like src/test/ratingInflation/pop.script.test.ts)
/* eslint-disable */
// Fits the Sim-Calibrated Ovr weights (ovrV2 setting) and writes src/worker/core/player/ovrWeights.basketball.ts. See
// docs/native-features.md. Re-run it after the game sim changes how ratings are used:
//   1. RA_MODE=off and RA_MODE=on with marginal.script.test.ts (updates marginal-off.json / marginal-on.json here)
//   2. FIT_OVR=1 node_modules/.bin/vitest run --project basketball src/test/ovrFit/fit.script.test.ts
//
// Method. marginal-*.json has, for every rating, the scoring margin per game of one 36-minute player getting +10 in it (both teams'
// players perturbed at random every game, OLS). That is the rating's value per point, so a player's sim impact is linear in his ratings
// with those slopes: impact = sum_k m_k * rating_k. Ovr v2 is that impact, rescaled so that over a reference population (the rostered
// players of freshly generated random-players leagues) its pre-fudge value has the same mean and standard deviation as the stock
// formula's. The stock fudge factor and rounding are then applied as before, so the league's ovr scale, mean and spread stay put.
// - A negative (noise or truly useless) slope gets weight 0.
// - Expanded Ratings on: the split ratings replace their compat value where the sim stopped reading it (diq = pdef/idef, reb =
//   oreb/dreb get weight 0, so nothing is counted twice); wng and bsc are measured on their own (hgt and drb are still read too); csh/dsh
//   are measured on their own next to fg/tp (fg/tp are still the sim's range ratings, csh/dsh only refine assisted vs self-created jumpers).
// - Both variants are anchored on the same population (expanded ratings derived from the stock ones), so toggling Expanded Ratings
//   doesn't move the league's ovr.
import { test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { g } from "../../worker/util/index.ts";
import { withSeededRandom } from "../../worker/core/GameSim.basketball/simLiveGameForTests.ts";
import createRandomPlayers from "../../worker/core/league/create/createRandomPlayers.ts";
import { resetCache, resetG } from "../helpers.ts";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import { range } from "../../common/utils.ts";
import { fillExpandedRatings } from "../../common/expandedRatings.ts";

const env = process.env;

const STOCK_WEIGHTS = {
	hgt: 0.159,
	stre: 0.0777,
	spd: 0.123,
	jmp: 0.051,
	endu: 0.0632,
	ins: 0.0126,
	dnk: 0.0286,
	ft: 0.0202,
	tp: 0.0726,
	oiq: 0.133,
	diq: 0.159,
	drb: 0.059,
	pss: 0.062,
	fg: 0.01,
	reb: 0.01,
};
const STOCK_KEYS = Object.keys(STOCK_WEIGHTS);
const EXPANDED_KEYS = [
	...STOCK_KEYS,
	"wng",
	"pdef",
	"idef",
	"oreb",
	"dreb",
	"csh",
	"dsh",
	"bsc",
];
// Compat values the sim no longer reads with Expanded Ratings on (their split ratings carry them)
const REPLACED_WHEN_EXPANDED = ["diq", "reb"];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

// Stock formula before the fudge factor, expanded off (the scale both variants are anchored to)
export const stockRaw = (r: Record<string, number>) =>
	48.5 +
	STOCK_KEYS.reduce((s, k) => s + STOCK_WEIGHTS[k] * r[k], 0) -
	(0.159 * 47.5 +
		0.0777 * 50.2 +
		0.123 * 50.8 +
		0.051 * 48.7 +
		0.0632 * 39.9 +
		0.0126 * 42.4 +
		0.0286 * 49.5 +
		0.0202 * 47.0 +
		0.0726 * 47.1 +
		0.133 * 46.8 +
		0.159 * 46.7 +
		0.059 * 54.8 +
		0.062 * 51.3 +
		0.01 * 47.0 +
		0.01 * 51.4);

const slopes = (file: string, keys: string[], replaced: string[]) => {
	const data = JSON.parse(readFileSync(file, "utf8"));
	const out: Record<string, number> = {};
	for (const k of keys) {
		const row = data.ratings.find((r: any) => r.key === k);
		if (!row) {
			throw new Error(`${file}: no ${k}`);
		}
		out[k] = replaced.includes(k) ? 0 : Math.max(0, row.margin / 10);
	}
	return out;
};

const genPopulation = async (numLeagues: number) => {
	const rows: Record<string, number>[] = [];
	for (let i = 0; i < numLeagues; i++) {
		await withSeededRandom(31337 + i * 101, async () => {
			resetG();
			// Generated with the stock ratings only, expanded ones derived like turning the setting on in an existing league
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
				if (p.tid < 0) {
					continue;
				}
				fillExpandedRatings(p);
				rows.push({ ...p.ratings.at(-1) });
			}
		});
	}
	return rows;
};

// Long-run correction (pre-fudge units). Rescaling on a fresh league isn't the whole story: ovr also decides who teams keep, draft and
// develop, so a league run with ovr v2 settles at a slightly different mean and spread than the same league with the stock formula.
// Measured with the rating inflation population model under the new-league defaults, 6 seeds x 30 seasons (toggles newDefaults vs
// newDefaultsStockOvr, seasons 6-30), then re-measured after applying it. Re-measure after a re-fit:
//   RUN_RATING_INFLATION=1 RI_CONFIGS=newDefaults,newDefaultsStockOvr RI_SEEDS=1,2,3,4,5,6 RI_SEASONS=30 vitest ... pop.script.test.ts
// spread: v2 spread x SPREAD = stock spread, around CENTER (the pre-fudge value of a league-average ovr); SHIFT is subtracted.
export const LONG_RUN = { SPREAD: 1.063, CENTER: 48.4, SHIFT: 0.19 };

const fitVariant = (
	pop: Record<string, number>[],
	m: Record<string, number>,
) => {
	const keys = Object.keys(m);
	const impact = pop.map((r) => keys.reduce((s, k) => s + m[k] * r[k], 0));
	const stock = pop.map(stockRaw);
	const scale = (LONG_RUN.SPREAD * sd(stock)) / sd(impact);
	// mean(stock) at mean(impact), then the spread around CENTER and the shift
	const intercept =
		LONG_RUN.CENTER +
		LONG_RUN.SPREAD * (mean(stock) - LONG_RUN.CENTER) -
		scale * mean(impact) -
		LONG_RUN.SHIFT;
	const weights = Object.fromEntries(
		keys.map((k) => [k, Number((scale * m[k]).toFixed(5))]),
	);
	return { intercept: Number(intercept.toFixed(4)), weights, scale };
};

test.skipIf(!env.FIT_OVR)(
	"fit ovr v2 weights",
	async () => {
		const dir = "src/test/ovrFit";
		const pop = await genPopulation(Number(env.FIT_LEAGUES ?? 12));
		const stock = fitVariant(
			pop,
			slopes(`${dir}/marginal-off.json`, STOCK_KEYS, []),
		);
		const expanded = fitVariant(
			pop,
			slopes(`${dir}/marginal-on.json`, EXPANDED_KEYS, REPLACED_WHEN_EXPANDED),
		);
		const fmt = (v: { intercept: number; weights: Record<string, number> }) =>
			`{\n\t\tintercept: ${v.intercept},\n\t\tweights: {\n${Object.entries(
				v.weights,
			)
				.map(([k, w]) => `\t\t\t${k}: ${w},`)
				.join("\n")}\n\t\t},\n\t}`;
		const src = `// GENERATED by src/test/ovrFit/fit.script.test.ts from src/test/ovrFit/marginal-off.json and marginal-on.json (the measured
// sim value of every rating). Don't edit by hand, re-run the fit (see that file). Sim-Calibrated Ovr (ovrV2 setting): ovr before the
// stock fudge factor = intercept + sum of weight * rating. Anchored on ${pop.length} rostered players of generated leagues to the stock
// formula's mean and spread, plus the long-run correction (LONG_RUN in the fit script).
export const OVR_V2_WEIGHTS = {
	stock: ${fmt(stock)},
	expanded: ${fmt(expanded)},
} as const;
`;
		writeFileSync("src/worker/core/player/ovrWeights.basketball.ts", src);
		console.log(src);
		console.log(
			"scale stock",
			stock.scale.toFixed(3),
			"expanded",
			expanded.scale.toFixed(3),
		);
	},
	3600 * 1000,
);
