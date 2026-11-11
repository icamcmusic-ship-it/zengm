import { assert, test } from "vitest";
import { linearRegression } from "./linearRegression.ts";

test("linearRegression has no NaN when every x is the same", () => {
	const { m, b, rSquared } = linearRegression([
		{ x: 0, y: 1 },
		{ x: 0, y: 3 },
		{ x: 0, y: 5 },
	]);
	assert.strictEqual(m, 0);
	assert.strictEqual(b, 3);
	assert.strictEqual(rSquared, 0);
});

test("linearRegression fits a line", () => {
	const { m, b, rSquared } = linearRegression([
		{ x: 0, y: 1 },
		{ x: 1, y: 3 },
		{ x: 2, y: 5 },
	]);
	assert.closeTo(m, 2, 1e-9);
	assert.closeTo(b, 1, 1e-9);
	assert.strictEqual(rSquared, 1);
});
