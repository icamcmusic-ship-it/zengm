import { afterEach, assert, beforeEach, test, vi } from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { player } from "../index.ts";
import getBest from "./getBest.ts";

beforeEach(() => {
	resetG();
	g.setWithoutSavingToDB("salaryCapType", "none");
});
afterEach(() => {
	vi.restoreAllMocks();
});

const freeAgent = (amount: number) => {
	const p = player.generate(PLAYER.FREE_AGENT, 27, 2015, true, DEFAULT_LEVEL);
	p.contractDemand = { amount, exp: g.get("season") + 2 };
	return p as any;
};

test("no salary cap: a team that skips the cap check still stays under the luxury tax", () => {
	const amount = 20000;
	const p = freeAgent(amount);
	// The random skip of the cap check always happens
	vi.spyOn(Math, "random").mockReturnValue(0);
	const underTax = g.get("luxuryPayroll") - amount - 1000;
	assert.strictEqual(getBest([], [p], underTax), p);
	assert.isUndefined(getBest([], [p], underTax + 2000));

	// Without a luxury tax, anything goes like before
	g.setWithoutSavingToDB("luxuryTax", 0);
	assert.strictEqual(getBest([], [p], underTax + 2000), p);
});
