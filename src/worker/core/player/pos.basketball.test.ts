import { assert, beforeEach, describe, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import {
	positionFor,
	positionOf,
} from "../../../common/archetypes/position.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import develop from "./develop.ts";
import generate from "./generate.ts";
import pos from "./pos.ts";

const setImproved = (on: boolean) => {
	g.setWithoutSavingToDB("improvedPositions" as any, on);
};

describe("basketball positions and the Improved positions setting", () => {
	beforeEach(() => {
		resetG();
	});

	test("off (an existing league): the original formula", async () => {
		setImproved(false);
		for (let i = 0; i < 50; i++) {
			const p = generate(-1, 19, 2025, false, DEFAULT_LEVEL);
			await develop(p as any, 3, true);
			const r = p.ratings.at(-1) as any;
			assert.strictEqual(r.pos, positionOf(r));
		}
	});

	test("missing attribute counts as off", () => {
		const r = generate(-1, 19, 2025, false, DEFAULT_LEVEL).ratings[0] as any;
		assert.strictEqual(pos(r), positionOf(r));
	});

	test("on: the two-axis model, sticky to the stored position when developing", async () => {
		setImproved(true);
		for (let i = 0; i < 50; i++) {
			const p = generate(-1, 19, 2025, false, DEFAULT_LEVEL);
			await develop(p as any, 2, true);
			const r = p.ratings.at(-1) as any;
			assert.strictEqual(r.pos, positionFor(r, true));
			// Developing 0 seasons with unchanged ratings never moves him, whatever position he had
			r.pos = "PG";
			const sticky = positionFor(r, true, "PG");
			await develop(p as any, 0);
			assert.strictEqual(r.pos, sticky);
		}
	});

	test("custom string positions are untouched", async () => {
		setImproved(true);
		const p = generate(-1, 19, 2025, false, DEFAULT_LEVEL) as any;
		p.pos = "Wing";
		await develop(p, 1);
		assert.strictEqual(p.ratings.at(-1).pos, "Wing");
	});
});
