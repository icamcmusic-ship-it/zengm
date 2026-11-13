import { assert, describe, test } from "vitest";
import { resetG } from "../../../test/helpers.ts";
import { helpers } from "../../util/index.ts";
import generate from "./generate.ts";

describe("team.generate", () => {
	test("keeps the fork's team fields from a league file", () => {
		resetG();
		const base = helpers.getTeamsDefault()[0]!;
		const capExceptions = {
			uses: [
				{ season: 2025, type: "nonTaxpayerMle" as const, pid: 3, amount: 9000 },
			],
			capSpaceSeason: 2024,
		};
		const t = generate({
			...base,
			popRank: 1,
			capExceptions,
			loadManagement: false,
			collegePrestige: 71,
			collegePrestigeBase: 68,
			staffDevCarry: { season: 2025, score: 0.42 },
			frontOffice: { analytics: 80, travel: 20 },
		});
		assert.deepStrictEqual(t.capExceptions, capExceptions);
		assert.strictEqual(t.loadManagement, false);
		assert.strictEqual((t as any).collegePrestige, 71);
		assert.strictEqual((t as any).collegePrestigeBase, 68);
		assert.deepStrictEqual(t.staffDevCarry, { season: 2025, score: 0.42 });
		assert.deepStrictEqual(t.frontOffice, { analytics: 80, travel: 20 });

		// A new team has none of them
		const t2 = generate({ ...base, popRank: 1 });
		assert.isUndefined(t2.capExceptions);
		assert.isUndefined(t2.loadManagement);
		assert.isUndefined((t2 as any).collegePrestige);
		assert.isUndefined(t2.frontOffice);
	});
});
