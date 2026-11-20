import { assert, test } from "vitest";
import {
	COY_VARIABLES,
	COACH_EXEC_VARIABLE_DOCS,
	DEFAULT_COY_FORMULA,
	DEFAULT_COY_FORMULA_COLLEGE,
	DEFAULT_EOY_FORMULA,
	EOY_VARIABLES,
	compareCandidates,
	defaultCoachExecFormula,
	projectedWinps,
} from "./coachExecAwards.ts";

test("projected win% is against the league average", () => {
	const winps = projectedWinps(
		new Map([
			[0, 40],
			[1, 50],
			[2, 60],
		]),
	);
	assert.closeTo(winps.get(1)!, 0.5, 1e-9);
	assert.isAbove(winps.get(2)!, 0.5);
	assert.isBelow(winps.get(0)!, 0.5);
	assert.closeTo(winps.get(0)! + winps.get(2)!, 1, 1e-9);
	assert.strictEqual(projectedWinps(new Map()).size, 0);
});

test("candidates sort by score, then win%, then id, with invalid scores last", () => {
	const rows = [
		{ id: 3, score: 1, winp: 0.5 },
		{ id: 1, score: Number.NaN, winp: 0.9 },
		{ id: 2, score: 1, winp: 0.6 },
		{ id: 0, score: 1, winp: 0.6 },
		{ id: 4, score: 2, winp: 0.1 },
	];
	assert.deepStrictEqual(
		rows.toSorted(compareCandidates).map((row) => row.id),
		[4, 0, 2, 3, 1],
	);
});

test("default formulas only use their award's variables, all documented", () => {
	const words = (formula: string) =>
		new Set(formula.match(/[A-Za-z]+/g)!.filter((w) => w !== "max"));
	for (const [formula, variables] of [
		[DEFAULT_COY_FORMULA, COY_VARIABLES],
		[DEFAULT_COY_FORMULA_COLLEGE, COY_VARIABLES],
		[DEFAULT_EOY_FORMULA, EOY_VARIABLES],
	] as const) {
		for (const word of words(formula)) {
			assert.include(variables as readonly string[], word, formula);
		}
	}
	for (const variable of [...COY_VARIABLES, ...EOY_VARIABLES]) {
		assert.isString(COACH_EXEC_VARIABLE_DOCS[variable]);
	}
	assert.strictEqual(
		defaultCoachExecFormula("coy", true),
		DEFAULT_COY_FORMULA_COLLEGE,
	);
	assert.strictEqual(
		defaultCoachExecFormula("coy", false),
		DEFAULT_COY_FORMULA,
	);
	assert.strictEqual(defaultCoachExecFormula("eoy", true), DEFAULT_EOY_FORMULA);
});
