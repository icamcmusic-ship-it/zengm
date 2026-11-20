import { assert, test } from "vitest";
import { resetG } from "../../../test/helpers.ts";
import { g, helpers } from "../../util/index.ts";
import defaultBudgetLevel from "./defaultBudgetLevel.ts";

test("a one-team league gets a valid budget level and ticket price, not NaN", () => {
	resetG();
	g.setWithoutSavingToDB("numTeams", 1);
	g.setWithoutSavingToDB("numActiveTeams", 1);
	const level = defaultBudgetLevel(1);
	assert.isTrue(Number.isFinite(level));
	assert.isAtLeast(level, 1);
	assert.isTrue(Number.isFinite(helpers.defaultTicketPrice(1)));
});
