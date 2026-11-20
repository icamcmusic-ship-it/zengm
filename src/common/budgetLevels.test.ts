import { assert, test } from "vitest";
import {
	MAX_LEVEL,
	MIN_TICKET_PRICE,
	boundBudgetLevel,
	boundTicketPrice,
	maxTicketPrice,
} from "./budgetLevels.ts";

test("budget levels are bounded to 1-MAX_LEVEL and rounded", () => {
	assert.strictEqual(boundBudgetLevel(-5), 1);
	assert.strictEqual(boundBudgetLevel(0), 1);
	assert.strictEqual(boundBudgetLevel(33.6), 34);
	assert.strictEqual(boundBudgetLevel(1000), MAX_LEVEL);
});

test("ticket price can't be 0 or negative (a free full arena), or absurdly high", () => {
	const cap = 90000;
	assert.strictEqual(boundTicketPrice(0, cap), MIN_TICKET_PRICE);
	assert.strictEqual(boundTicketPrice(-20, cap), MIN_TICKET_PRICE);
	assert.strictEqual(boundTicketPrice(35.456, cap), 35.46);
	assert.strictEqual(boundTicketPrice(1e9, cap), maxTicketPrice(cap));
	assert.isAbove(maxTicketPrice(cap), 100);
});
