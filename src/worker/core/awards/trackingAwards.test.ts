import { beforeEach, describe, expect, test } from "vitest";
import {
	defaultAwards,
	defaultAwardsBasketball,
	defaultGameAttributes,
} from "../../../common/defaultGameAttributes.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { FormulaEvaluator } from "../../util/FormulaEvaluator.ts";
import {
	AWARD_STATS_ALL,
	PLAYOFF_SERIES_AWARD_STATS_ALL,
} from "./getPlayers.ts";
import { defenseAwardFormula } from "./perimeterDefense.ts";
import { FormulaEvaluators } from "./processAwards.ts";
import {
	addDerived,
	addPlayoffVariants,
	awardActive,
	leagueContext,
	TRACKING_AWARD_VARS,
	trackingAwardFormula,
	trackingNeeds,
	trackingVariableDocs,
} from "./trackingAwards.ts";
import { getVariables } from "../../api/awardSettings.ts";
import {
	awardSettingToEditingState,
	editingStatesToAwards,
} from "../../../ui/views/AwardSettings/EditSettings.tsx";

const setAdvStats = (on: boolean) => {
	g.setWithoutSavingToDB("advStats" as any, on);
};

const stockRow = () => ({
	ewa: 12,
	vorp: 5,
	ws: 11,
	teamWs: 45,
	seasonFraction: 1,
	winp: 0.6,
	dws: 3.5,
	gp: 80,
	blk: 2.1,
	stl: 1.3,
	drb: 8,
	pts: 22,
	gmsc: 20,
	won: 1,
	min: 34,
});

// A tracked row: a rim protector who allows 6 points under the league at the rim
const trackedRow = (overrides: Record<string, number> = {}) => ({
	...stockRow(),
	ptPoss: 900,
	dfga: 700,
	dfga2: 550,
	dfga3: 150,
	dfgp: 42,
	dfgp2: 46,
	dfgp3: 27.3,
	rimDfga: 600,
	rimDfgp: 57,
	con2: 450,
	con3: 120,
	rimDeter: -2,
	onPoss: 5500,
	onOffNet: 9,
	onOffDrtg: -5,
	clMin: 60,
	clPm: 18,
	ptSpotPoss: 300,
	ptSpotPpp: 1.15,
	ptCutPoss: 200,
	ptCutPpp: 1.3,
	...overrides,
});

const leagueRow = {
	dfga2: 100000,
	dfga3: 40000,
	dfgp2: 51,
	dfgp3: 35,
	rimDfga: 50000,
	rimDfgp: 63,
	con2: 1000,
	con3: 300,
	dfga: 140000,
	min: 30,
	gp: 80,
	ptSpotPoss: 10000,
	ptSpotPpp: 1.02,
	ptCutPoss: 5000,
	ptCutPpp: 1.2,
};

beforeEach(() => {
	resetG();
	g.setWithoutSavingToDB("leagueType" as any, "standard");
});

describe("derived variables", () => {
	test("composites are 0 and the rest NaN without tracking data", () => {
		const row: Record<string, any> = stockRow();
		addDerived(row, leagueContext([row]));
		for (const key of ["trkImpact", "trkClutch", "trkDef", "trkPtEff"]) {
			expect(row[key]).toBe(0);
		}
		for (const key of ["dfgpVsExp", "rimDfgpVsExp", "con36"]) {
			expect(row[key]).toBeNaN();
		}
		addPlayoffVariants(row, undefined);
		expect(row.trkImpactPlayoffs).toBe(0);
		expect(row.dfgpPlayoffs).toBeNaN();
	});

	test("values with tracking data", () => {
		const row: Record<string, any> = trackedRow();
		const L = leagueContext([leagueRow]);
		expect(L.dfgp2).toBeCloseTo(51);
		addDerived(row, L);
		// Expected: (51 * 550 + 35 * 150) / 700 = 47.57, his 42
		expect(row.dfgpVsExp).toBeCloseTo(5.571, 2);
		expect(row.dfgp2VsExp).toBeCloseTo(5);
		expect(row.rimDfgpVsExp).toBeCloseTo(6);
		expect(row.con36).toBeCloseTo((36 * 570) / (34 * 80));
		// 9 / 12, x 5500 / 7500
		expect(row.trkImpact).toBeCloseTo(0.75 * (5500 / 7500));
		// (0.5 x 18 / 40 + 0.5 x (0 - 30) / 30) x 60 / 90
		expect(row.trkClutch).toBeCloseTo((0.5 * 0.45 - 0.5) * (60 / 90));
		expect(row.trkDef).toBeGreaterThan(0.4);
		expect(row.trkDef).toBeLessThanOrEqual(1);
		// (300 * 0.13 + 200 * 0.1) / 500 * 100 = 11.8 per 100, / 20 = 0.59, x 500 / 900 (the possessions of the types with a league PPP)
		expect(row.trkPtEff).toBeCloseTo(0.59 * (500 / 900));

		const reg: Record<string, any> = { ...row };
		addPlayoffVariants(reg, row);
		expect(reg.dfgpPlayoffs).toBe(42);
		expect(reg.trkImpactPlayoffs).toBeCloseTo(row.trkImpact);
	});

	test("a bad defender scores negative, bounded", () => {
		const row: Record<string, any> = trackedRow({
			dfgp: 60,
			dfgp2: 62,
			dfgp3: 50,
			rimDfgp: 75,
			rimDeter: 5,
			onOffDrtg: 10,
			con2: 50,
			con3: 10,
		});
		addDerived(row, leagueContext([leagueRow]));
		expect(row.trkDef).toBeLessThan(-0.5);
		expect(row.trkDef).toBeGreaterThanOrEqual(-1);
	});
});

describe("variables", () => {
	test("every tracking variable is valid in award formulas, playoff variants in series awards", () => {
		for (const key of TRACKING_AWARD_VARS) {
			expect(AWARD_STATS_ALL).toContain(key);
		}
		for (const key of TRACKING_AWARD_VARS.filter((key) =>
			key.endsWith("Playoffs"),
		)) {
			expect(PLAYOFF_SERIES_AWARD_STATS_ALL).toContain(key);
		}
		expect(PLAYOFF_SERIES_AWARD_STATS_ALL).not.toContain("dfgp");
		const required = [
			"ptPrbFreq",
			"ptPrbPpp",
			"ptIsoPpp",
			"dfgp",
			"dfgp2",
			"dfgp3",
			"dfgpVsExp",
			"rimDfgp",
			"rimDeter",
			"con2",
			"con3",
			"con36",
			"onNet",
			"onOffNet",
			"onOffOrtg",
			"onOffDrtg",
			"astRim",
			"unast3",
			"cs3a",
			"cs3p",
			"pu3a",
			"pu3p",
			"clPts",
			"clFgp",
			"clPm",
			"clMin",
			"clUsgp",
		];
		for (const key of required) {
			expect(AWARD_STATS_ALL).toContain(key);
			expect(AWARD_STATS_ALL).toContain(`${key}Playoffs`);
		}
	});

	test("formulas with them evaluate", () => {
		const evaluator = new FormulaEvaluator(
			"dfgpVsExp + 2 * trkDef + onOffNetPlayoffs / 10 + clPts",
			AWARD_STATS_ALL,
			[],
		);
		const row: Record<string, any> = trackedRow({ clPts: 50 });
		addDerived(row, leagueContext([leagueRow]));
		addPlayoffVariants(row, { onOffNet: 5 });
		expect(evaluator.evaluate(row)).toBeCloseTo(
			row.dfgpVsExp + 2 * row.trkDef + 0.5 + 50,
		);
		// No tracking data: NaN, so the player is left out
		const empty: Record<string, any> = stockRow();
		addDerived(empty, leagueContext([empty]));
		addPlayoffVariants(empty, undefined);
		expect(evaluator.evaluate(empty)).toBeNaN();
	});

	test("what getPlayers loads", () => {
		const none = trackingNeeds(["ws", "ewa"]);
		expect(none.any).toBe(false);
		const some = trackingNeeds(["dfgp", "trkImpactPlayoffs"]);
		expect(some.playoffs).toBe(true);
		expect(some.stats.has("dfgp")).toBe(true);
		expect(some.stats.has("onOffNet")).toBe(true);
	});

	test("editor documentation lists them with descriptions", () => {
		setAdvStats(false);
		const variables = getVariables();
		expect(variables.advStatsOn).toBe(false);
		const docs = trackingVariableDocs();
		expect(variables.tracking).toEqual(docs);
		for (const row of docs) {
			expect(row.desc).not.toBe(row.key);
			expect(row.playoffsKey).toBe(`${row.key}Playoffs`);
		}
		// Not repeated in the other lists
		expect(variables.common).not.toContain("dfgp");
		expect(variables.normalOnly).not.toContain("dfgp");
		expect(variables.normalOnly).toContain("ws");
		setAdvStats(true);
		expect(getVariables().advStatsOn).toBe(true);
	});
});

describe("default formulas", () => {
	const awards = defaultGameAttributes.awards;

	test("off: the stock formulas", () => {
		setAdvStats(false);
		for (const award of awards) {
			expect(trackingAwardFormula(award)).toBeUndefined();
			expect(defenseAwardFormula(award)).toBeUndefined();
		}
		expect(awardActive(defaultAwardsBasketball.cpoy)).toBe(false);
		expect(awardActive(defaultAwards.mvp)).toBe(true);
	});

	test("on: the tracking formulas, valid, and the same scores without tracking data", () => {
		setAdvStats(true);
		expect(awardActive(defaultAwardsBasketball.cpoy)).toBe(true);
		const replaced = awards.filter(
			(award) =>
				trackingAwardFormula(award) !== undefined ||
				defenseAwardFormula(award) !== undefined,
		);
		expect(replaced.map((award) => award.shortName).sort()).toEqual(
			["ALL", "DEF", "DPOY", "FMVP", "MVP", "SMOY"].sort(),
		);
		expect(trackingAwardFormula(defaultAwardsBasketball.sfmvp)).toBeUndefined();
		expect(trackingAwardFormula(defaultAwardsBasketball.roy)).toBeUndefined();
		// Edited formulas are left alone
		expect(
			trackingAwardFormula({ ...defaultAwards.mvp, formula: "ws" }),
		).toBeUndefined();

		const evaluators = new FormulaEvaluators(awards, []);
		expect(evaluators.errorMessages).toBeUndefined();

		const row: Record<string, any> = stockRow();
		addDerived(row, leagueContext([row]));
		addPlayoffVariants(row, undefined);
		for (const award of replaced) {
			const formula =
				defenseAwardFormula(award) ?? trackingAwardFormula(award)!;
			const type = typeof award.statRange === "number";
			const vars = type ? PLAYOFF_SERIES_AWARD_STATS_ALL : AWARD_STATS_ALL;
			const stock = new FormulaEvaluator(award.formula, vars, []);
			const tracked = new FormulaEvaluator(formula, vars, []);
			expect(tracked.evaluate(row)).toBe(stock.evaluate(row));
		}
	});

	test("the Clutch Player of the Year formula favors clutch production", () => {
		const evaluator = new FormulaEvaluator(
			defaultAwardsBasketball.cpoy.formula,
			AWARD_STATS_ALL,
			[],
		);
		const star = {
			clMin: 70,
			clPts: 70,
			clPm: 20,
			clFg: 24,
			clFga: 50,
			clUsgp: 32,
		};
		const role = {
			...star,
			clPts: 15,
			clPm: 5,
			clFg: 6,
			clFga: 13,
			clUsgp: 14,
		};
		const few = { ...star, clMin: 10 };
		expect(evaluator.evaluate(star)).toBeGreaterThan(evaluator.evaluate(role));
		expect(evaluator.evaluate(star)).toBeGreaterThan(evaluator.evaluate(few));
	});
});

test("editor round trip keeps the formulas and the Advanced Tracking Stats only flag", () => {
	const states = defaultGameAttributes.awards.map((award) =>
		awardSettingToEditingState(award as any),
	);
	const cpoy = states.find((state) => state.shortName === "CPOY")!;
	expect(cpoy.advStats).toBe(true);
	const custom = {
		...states[0]!,
		shortName: "TRK",
		name: "Tracking",
		formula: "trkDef + dfgpVsExpPlayoffs / 4 + clPts",
	};
	const output = editingStatesToAwards([...states, custom]);
	expect(output.errorMessages).toBeUndefined();
	expect(output.awards).toEqual([
		...defaultGameAttributes.awards,
		{
			...defaultGameAttributes.awards[0],
			shortName: "TRK",
			name: "Tracking",
			formula: custom.formula,
		},
	]);
	const evaluators = new FormulaEvaluators(output.awards!, []);
	expect(evaluators.errorMessages).toBeUndefined();
});
