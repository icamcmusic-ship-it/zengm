import { beforeEach, expect, test } from "vitest";
import { defaultAwards } from "../../../common/defaultGameAttributes.ts";
import { resetG } from "../../../test/helpers.ts";
import { awardCandidateStats } from "./getAwardCandidates.ts";
import { getAwardKeyStats } from "./keyStats.ts";

beforeEach(() => {
	resetG();
});

test("baseball MVP: a one-stat formula is padded with the usual stats", () => {
	const mvp = defaultAwards.mvp;
	const keyStats = getAwardKeyStats({
		award: mvp,
		fallback: awardCandidateStats[mvp.showStats]!,
		rows: [
			{ formula: mvp.formula, stats: { war: 8 } },
			{ formula: mvp.formula, stats: { war: 5 } },
		],
	});
	expect(keyStats.terms).toEqual([{ stat: "war", share: 1 }]);
	expect(keyStats.suggested).toEqual(["war", "keyStats"]);
	expect(keyStats.available).toContain("hr");
});
