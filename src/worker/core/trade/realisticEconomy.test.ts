import { assert, test } from "vitest";
import { salaryMatchOk } from "./realisticEconomy.ts";

test("salary matching only binds teams over the tax taking back more", () => {
	const tax = 100000;
	// Under the tax after the trade: anything goes
	assert.isTrue(
		salaryMatchOk(
			[{ payrollBefore: 50000, salaryOut: 1000, salaryIn: 20000 }],
			tax,
		),
	);
	// Over the tax: 125% + 100k
	assert.isTrue(
		salaryMatchOk(
			[{ payrollBefore: 120000, salaryOut: 10000, salaryIn: 12600 }],
			tax,
		),
	);
	assert.isFalse(
		salaryMatchOk(
			[{ payrollBefore: 120000, salaryOut: 10000, salaryIn: 12700 }],
			tax,
		),
	);
	// Sending out more is always fine
	assert.isTrue(
		salaryMatchOk(
			[{ payrollBefore: 200000, salaryOut: 10000, salaryIn: 5000 }],
			tax,
		),
	);
});
