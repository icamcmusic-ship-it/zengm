import { afterAll, assert, test } from "vitest";
import { Rng } from "../../../common/collegeStats/rng.ts";
import { PHASE } from "../../../common/constants.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { TALENT_CYCLE, talentCycle } from "../../../common/prospectVariety.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import { range } from "../../../common/utils.ts";

/*
 * Talent cycles (prospect variety, common/prospectVariety.ts TALENT_CYCLE): a slow, seeded, bounded league-level cycle of deep and thin
 * draft classes on top of each class's own talent draw.
 */

afterAll(() => {
	resetG();
});

test("talent cycles: seeded per league, slow, bounded, averaging 0", () => {
	const years = range(2000, 2400);
	const a = years.map((y) => talentCycle("1", y));
	// the same league, the same eras; another league, other eras
	assert.deepStrictEqual(
		a,
		years.map((y) => talentCycle("1", y)),
	);
	assert.notDeepEqual(
		a,
		years.map((y) => talentCycle("2", y)),
	);
	for (const x of a) {
		assert.isAtMost(Math.abs(x), TALENT_CYCLE.max);
	}
	const mean = a.reduce((s, x) => s + x, 0) / a.length;
	assert.closeTo(mean, 0, 0.15);
	// deep and thin eras both happen
	assert.isAbove(Math.max(...a), 1);
	assert.isBelow(Math.min(...a), -1);
	// slow: next year is like this year (much more than a class draw would be)
	let diff = 0;
	for (let i = 1; i < a.length; i++) {
		diff += Math.abs(a[i]! - a[i - 1]!);
	}
	assert.isBelow(diff / (a.length - 1), 0.6);
	// eras last: the sign stays for several years at a time on average
	let changes = 0;
	for (let i = 1; i < a.length; i++) {
		if (Math.sign(a[i]!) !== Math.sign(a[i - 1]!)) {
			changes += 1;
		}
	}
	assert.isAbove(a.length / Math.max(1, changes), 4);
});

test("talent cycles: a deep era's class has better top prospects than the same class in a thin era", async () => {
	resetG();
	g.setWithoutSavingToDB("season", 2026);
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	g.setWithoutSavingToDB("generateCollegeStats", false);
	g.setWithoutSavingToDB("rerandomizeDraftClassRatings", false);
	g.setWithoutSavingToDB("lid", 7);
	const years = range(2026, 2080);
	const deep = years.reduce((b, y) =>
		talentCycle("7", y) > talentCycle("7", b) ? y : b,
	);
	const thin = years.reduce((b, y) =>
		talentCycle("7", y) < talentCycle("7", b) ? y : b,
	);
	const topOvr = async (amp: boolean) => {
		const saved = { ...TALENT_CYCLE };
		if (!amp) {
			TALENT_CYCLE.amp = 0;
			TALENT_CYCLE.amp2 = 0;
		}
		const outer = Math.random;
		const rng = new Rng("talentCycles.class");
		Math.random = () => rng.random();
		try {
			const players = await genPlayersWithoutSaving(deep, DEFAULT_LEVEL, []);
			return (
				players
					.map((p) => p.ratings[0]!.ovr)
					.toSorted((x, y) => y - x)
					.slice(0, TALENT_CYCLE.top)
					.reduce((s, x) => s + x, 0) / TALENT_CYCLE.top
			);
		} finally {
			Math.random = outer;
			Object.assign(TALENT_CYCLE, saved);
		}
	};
	assert.isAbove(talentCycle("7", deep), 0.5);
	assert.isBelow(talentCycle("7", thin), -0.5);
	const withCycle = await topOvr(true);
	const without = await topOvr(false);
	assert.isAbove(withCycle, without + 0.3);
});
