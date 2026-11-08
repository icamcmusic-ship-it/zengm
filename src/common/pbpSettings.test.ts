import { assert, test } from "vitest";
import { defaultGameAttributes } from "./defaultGameAttributes.ts";
import {
	getBoxScorePbpView,
	getPbpStoreScope,
	shouldStorePbp,
} from "./pbpSettings.ts";

test("defaults keep the old behaviour", () => {
	assert.strictEqual(defaultGameAttributes.pbpLiveGame, true);
	assert.strictEqual(defaultGameAttributes.pbpBoxScore, "always");
	assert.strictEqual(defaultGameAttributes.pbpStore, "all");
	assert.strictEqual(defaultGameAttributes.storePlayByPlay, true);
});

test("old storePlayByPlay off means no storage", () => {
	assert.strictEqual(
		getPbpStoreScope({ pbpStore: "all", storePlayByPlay: false }),
		"none",
	);
	assert.strictEqual(
		getPbpStoreScope({ pbpStore: undefined, storePlayByPlay: true }),
		"all",
	);
	assert.strictEqual(
		getPbpStoreScope({ pbpStore: "user", storePlayByPlay: true }),
		"user",
	);
});

test("storage scope filter", () => {
	assert.isTrue(shouldStorePbp("all", [3, 4], [0]));
	assert.isFalse(shouldStorePbp("none", [0, 4], [0]));
	assert.isTrue(shouldStorePbp("user", [3, 0], [0]));
	assert.isTrue(shouldStorePbp("user", [3, 5], [0, 5]));
	assert.isFalse(shouldStorePbp("user", [3, 4], [0]));
	// All-Star game
	assert.isFalse(shouldStorePbp("user", [-1, -2], [0]));
});

test("on-demand box score play-by-play", () => {
	assert.strictEqual(
		getBoxScorePbpView({ hasEvents: true, mode: "always", revealed: false }),
		"tab",
	);
	assert.strictEqual(
		getBoxScorePbpView({ hasEvents: false, mode: "always", revealed: false }),
		"none",
	);
	assert.strictEqual(
		getBoxScorePbpView({ hasEvents: true, mode: "button", revealed: false }),
		"button",
	);
	assert.strictEqual(
		getBoxScorePbpView({ hasEvents: true, mode: "button", revealed: true }),
		"tab",
	);
	assert.strictEqual(
		getBoxScorePbpView({ hasEvents: false, mode: "button", revealed: true }),
		"message",
	);
});
