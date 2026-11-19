import { beforeEach, expect, test } from "vitest";
import {
	defaultAwards,
	defaultAwardsFootball,
} from "../../../common/defaultGameAttributes.ts";
import { resetG } from "../../../test/helpers.ts";
import { awardCandidateStats } from "./getAwardCandidates.ts";
import {
	effectiveAwardFormula,
	getAwardKeyStats,
	pickerStats,
} from "./keyStats.ts";

beforeEach(() => {
	resetG();
});

test("football DPOY: defensive stats", () => {
	const award = defaultAwardsFootball.dpoy;
	const formula = award.formula;
	const keyStats = getAwardKeyStats({
		award,
		fallback: awardCandidateStats[award.showStats]!,
		rows: [
			{
				formula,
				stats: { defSk: 14, defTckSolo: 40, defInt: 0, defPssDef: 2 },
			},
			{ formula, stats: { defSk: 2, defTckSolo: 90, defInt: 1, defPssDef: 4 } },
			{
				formula,
				stats: { defSk: 0, defTckSolo: 50, defInt: 7, defPssDef: 15 },
			},
		],
	});
	expect(keyStats.suggested[0]).toBe("defSk");
	expect(keyStats.suggested).toContain("defInt");
	expect(keyStats.suggested).not.toContain("pssYds");
});

test("football MVP: formulas by position, and keyStats in the picker", () => {
	const mvp = defaultAwards.mvp;
	const qbFormula = effectiveAwardFormula(mvp, "QB");
	const rbFormula = effectiveAwardFormula(mvp, "RB");
	expect(qbFormula).toBe(mvp.formulaByPos!.QB);
	expect(rbFormula).toBe(mvp.formula);

	const keyStats = getAwardKeyStats({
		award: mvp,
		fallback: awardCandidateStats[mvp.showStats]!,
		rows: [
			{ formula: qbFormula, stats: { pssYds: 4800, pssTD: 40, pssInt: 8 } },
			{ formula: qbFormula, stats: { pssYds: 3500, pssTD: 22, pssInt: 14 } },
			{ formula: rbFormula, stats: { rusYds: 1800, rusTD: 15, fmbLost: 2 } },
		],
	});
	expect(keyStats.byPos).toBe(true);
	expect(keyStats.suggested.slice(0, 2)).toContain("pssYds");
	expect(pickerStats(false, [])).toContain("keyStats");
});
