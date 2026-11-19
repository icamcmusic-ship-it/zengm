import { beforeEach, describe, expect, test } from "vitest";
import {
	defaultAwards,
	defaultAwardsBasketball,
} from "../../../common/defaultGameAttributes.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import {
	effectiveAwardFormula,
	formulaVariables,
	getAwardKeyStats,
	pickerStats,
	rankFormulaVariables,
	suggestKeyStats,
} from "./keyStats.ts";

const setAdvStats = (on: boolean) => {
	g.setWithoutSavingToDB("advStats" as any, on);
};

beforeEach(() => {
	resetG();
	setAdvStats(false);
});

describe("formulaVariables", () => {
	test("lists the variables a formula reads, in order", () => {
		expect(formulaVariables("pts / 25 + 2 * trb - min(ast, 3)", false)).toEqual(
			["pts", "trb", "ast"],
		);
	});

	test("an invalid formula has no variables", () => {
		expect(formulaVariables("pts + notAStat", false)).toEqual([]);
		expect(formulaVariables("(pts", false)).toEqual([]);
	});

	test("playoff series formulas can read won", () => {
		expect(formulaVariables("gmsc * (1 + 0.75*won)", true)).toEqual([
			"gmsc",
			"won",
		]);
	});
});

describe("rankFormulaVariables", () => {
	test("ranks by weight times spread among the rows", () => {
		const formula = "pts + 10 * blk";
		const terms = rankFormulaVariables({
			playoffSeries: false,
			formulas: [formula],
			rows: [
				// pts spread 10, blk spread 0.2 (x10 = 2)
				{ formula, stats: { pts: 20, blk: 1 } },
				{ formula, stats: { pts: 30, blk: 1.2 } },
			],
		});
		expect(terms.map((term) => term.stat)).toEqual(["pts", "blk"]);
		expect(terms[0]!.share).toBeCloseTo(5 / 6);
		expect(terms[1]!.share).toBeCloseTo(1 / 6);
	});

	test("a big weight on a stat with a small spread can still win", () => {
		const formula = "pts / 25 + 5 * stl";
		const terms = rankFormulaVariables({
			playoffSeries: false,
			formulas: [formula],
			rows: [
				{ formula, stats: { pts: 20, stl: 1 } },
				{ formula, stats: { pts: 30, stl: 2.5 } },
			],
		});
		expect(terms[0]!.stat).toBe("stl");
	});

	test("works through products and min/max (custom formulas)", () => {
		const formula = "min(1, gp / 60) * per";
		const terms = rankFormulaVariables({
			playoffSeries: false,
			formulas: [formula],
			rows: [
				// Everyone played enough games, so gp does not move the score at all
				{ formula, stats: { gp: 70, per: 15 } },
				{ formula, stats: { gp: 80, per: 25 } },
			],
		});
		expect(terms.map((term) => term.stat)).toEqual(["per", "gp"]);
		expect(terms[1]!.share).toBe(0);
	});

	test("MIP: ranks by change from last season", () => {
		const formula = defaultAwardsBasketball.mip.formula;
		const terms = rankFormulaVariables({
			playoffSeries: false,
			formulas: [formula],
			rows: [
				{
					formula,
					stats: { pts: 25, trb: 5, ast: 4, per: 18 },
					baseline: { pts: 12, trb: 5, ast: 4, per: 16 },
				},
				{
					formula,
					stats: { pts: 8, trb: 12, ast: 2, per: 20 },
					baseline: { pts: 6, trb: 11, ast: 2, per: 17 },
				},
			],
		});
		expect(terms[0]!.stat).toBe("pts");
		expect(terms.find((term) => term.stat === "ast")!.share).toBe(0);
	});

	test("no rows: formula order, no shares", () => {
		const terms = rankFormulaVariables({
			playoffSeries: false,
			formulas: [defaultAwardsBasketball.dpoy.formula],
			rows: [],
		});
		expect(terms.map((term) => term.stat)).toEqual([
			"dws",
			"seasonFraction",
			"winp",
			"gp",
			"blk",
			"stl",
		]);
		expect(terms.every((term) => term.share === 0)).toBe(true);
	});

	test("nested variables are left out", () => {
		const formula = "per + numWon.MVP";
		const terms = rankFormulaVariables({
			playoffSeries: false,
			formulas: [formula],
			rows: [
				{ formula, stats: { per: 20, numWon: { MVP: 1 } } },
				{ formula, stats: { per: 25, numWon: {} } },
			],
		});
		expect(terms.map((term) => term.stat)).toEqual(["per"]);
	});

	test("rows can use different formulas (by position)", () => {
		const terms = rankFormulaVariables({
			playoffSeries: false,
			formulas: ["blk / 2 + stl / 2 + dws", "0"],
			rows: [
				{
					formula: "blk / 2 + stl / 2 + dws",
					stats: { blk: 1, stl: 4, dws: 3 },
				},
				{
					formula: "blk / 2 + stl / 2 + dws",
					stats: { blk: 1.2, stl: 1, dws: 2.8 },
				},
				{ formula: "0", stats: { blk: 10, stl: 5, dws: 0 } },
			],
		});
		expect(terms[0]!.stat).toBe("stl");
		const total = terms.reduce((sum, term) => sum + term.share, 0);
		expect(total).toBeCloseTo(1);
	});
});

describe("suggestKeyStats", () => {
	test("top formula stats, leaving out scaling variables, padded with the usual stats", () => {
		const suggested = suggestKeyStats(
			[
				{ stat: "dws", share: 0.5 },
				{ stat: "seasonFraction", share: 0.2 },
				{ stat: "blk", share: 0.29 },
				{ stat: "stl", share: 0.01 },
			],
			["trb", "blk", "stl", "dws", "score"],
		);
		// stl is under the 3% cutoff, but comes back as padding
		expect(suggested).toEqual(["dws", "blk", "trb", "stl"]);
	});

	test("at most 5 formula stats", () => {
		const terms = ["a", "b", "c", "d", "e", "f", "g"].map((stat) => ({
			stat,
			share: 1 / 7,
		}));
		expect(suggestKeyStats(terms, ["pts"])).toEqual(["a", "b", "c", "d", "e"]);
	});

	test("no formula stats: the usual stats", () => {
		expect(suggestKeyStats([], ["pts", "trb", "ast", "per", "score"])).toEqual([
			"pts",
			"trb",
			"ast",
			"per",
		]);
	});
});

describe("getAwardKeyStats", () => {
	test("DPOY surfaces defensive stats", () => {
		const award = defaultAwardsBasketball.dpoy;
		const formula = award.formula;
		const keyStats = getAwardKeyStats({
			award,
			fallback: ["trb", "blk", "stl", "dws"],
			rows: [
				{
					formula,
					stats: {
						dws: 6,
						winp: 0.7,
						seasonFraction: 1,
						gp: 80,
						blk: 3,
						stl: 1,
					},
				},
				{
					formula,
					stats: {
						dws: 4,
						winp: 0.5,
						seasonFraction: 1,
						gp: 78,
						blk: 1,
						stl: 2,
					},
				},
				{
					formula,
					stats: {
						dws: 5,
						winp: 0.6,
						seasonFraction: 1,
						gp: 82,
						blk: 0.5,
						stl: 1.5,
					},
				},
			],
		});
		expect(keyStats.formula).toBe(formula);
		expect(keyStats.suggested.slice(0, 3).toSorted()).toEqual(
			["blk", "dws", "stl"].toSorted(),
		);
		expect(keyStats.suggested).not.toContain("seasonFraction");
		// Team success is in the Record column already
		expect(keyStats.terms.map((term) => term.stat)).toContain("winp");
		expect(keyStats.suggested).not.toContain("winp");
		expect(keyStats.available).toContain("pts");
		expect(keyStats.available).toContain("winp");
		expect(keyStats.available).not.toContain("seasonFraction");
		expect(keyStats.colInfo.winp?.title).toBe("Win%");
		expect(keyStats.colInfo.pts).toBeUndefined();
	});

	test("an invalid custom formula falls back to the usual stats", () => {
		const keyStats = getAwardKeyStats({
			award: { formula: "pts +* 2" },
			fallback: ["pts", "trb", "ast", "per", "score"],
			rows: [],
		});
		expect(keyStats.terms).toEqual([]);
		expect(keyStats.suggested).toEqual(["pts", "trb", "ast", "per"]);
	});

	test("tracking stats are only offered with Advanced Tracking Stats on", () => {
		expect(pickerStats(false, [])).not.toContain("dfgp");
		setAdvStats(true);
		expect(pickerStats(false, [])).toContain("dfgp");
	});

	test("uses the formula the award is scored with", () => {
		const mvp = defaultAwards.mvp;
		expect(effectiveAwardFormula(mvp, undefined)).toBe(mvp.formula);
		expect(
			effectiveAwardFormula(
				{ formula: "pts", formulaByPos: { C: "trb" } },
				"C",
			),
		).toBe("trb");
		setAdvStats(true);
		expect(effectiveAwardFormula(mvp, undefined)).toContain("trkImpact");
	});
});
