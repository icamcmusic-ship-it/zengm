import { assert, test } from "vitest";
import {
	BREAKOUT,
	formDraw,
	injuryOpening,
	isCareerNight,
	matchupOpening,
	onHeater,
	roleFactor,
	startersOut,
	usageForm,
	usageRanks,
} from "./breakout.ts";

test("the form draw is seeded by the game and the player", () => {
	assert.deepStrictEqual(formDraw(12, 34), formDraw(12, 34));
	assert.notDeepEqual(formDraw(12, 34), formDraw(13, 34));
	assert.notDeepEqual(formDraw(12, 34), formDraw(12, 35));
});

test("usage form: mean 1, wider for role players, follows the shooting form", () => {
	const n = 20000;
	const stats = (rf: number) => {
		let sum = 0;
		let sumSq = 0;
		let careers = 0;
		for (let i = 0; i < n; i++) {
			const { z, u } = formDraw(i, 7);
			const m = usageForm(rf, undefined, z);
			sum += m;
			sumSq += m * m;
			if (isCareerNight(rf, u)) {
				careers += 1;
			}
		}
		const mean = sum / n;
		return { mean, sd: Math.sqrt(sumSq / n - mean * mean), careers };
	};
	const star = stats(0);
	const role = stats(1);
	assert.closeTo(star.mean, 1, 0.005);
	assert.closeTo(role.mean, 1, 0.01);
	assert.closeTo(star.sd, BREAKOUT.formSdStar, 0.01);
	assert.closeTo(role.sd, BREAKOUT.formSdRole, 0.02);
	assert.strictEqual(star.careers, 0);
	// About 1 in 150
	assert.closeTo(role.careers / n, BREAKOUT.careerProb, 0.002);

	// A hot shooting night is an aggressive one
	assert.isAbove(usageForm(1, 2, 0), 1.1);
	assert.isBelow(usageForm(1, -2, 0), 0.9);
});

test("role factor, ranks, openings", () => {
	assert.strictEqual(roleFactor(0), 0);
	assert.strictEqual(roleFactor(3), 1);
	assert.strictEqual(roleFactor(8), 1);
	const players = [
		{ valueNoPot: 70, injured: false, usage: 0.5 },
		{ valueNoPot: 60, injured: true, usage: 0.6 },
		{ valueNoPot: 55, injured: false, usage: 0.3 },
		{ valueNoPot: 50, injured: false, usage: 0.4 },
	];
	const ranks = usageRanks(players);
	assert.strictEqual(ranks.get(players[0]!), 0);
	assert.strictEqual(ranks.get(players[3]!), 1);
	assert.strictEqual(ranks.get(players[2]!), 2);
	assert.strictEqual(startersOut(players), 1);
	assert.strictEqual(injuryOpening(0, 1), 1);
	assert.isAbove(injuryOpening(1, 1), 1);
	assert.strictEqual(injuryOpening(1, 5), injuryOpening(1, 2));

	// A shooter against a poor perimeter defense, a star never
	const weak = { perim: BREAKOUT.perimRef - 0.1, int: BREAKOUT.intRef };
	assert.isAbove(matchupOpening(1, 0.7, 0.3, weak), 1);
	assert.strictEqual(matchupOpening(0, 0.7, 0.3, weak), 1);
	assert.strictEqual(matchupOpening(1, 0.2, 0.3, weak), 1);
	const strong = { perim: BREAKOUT.perimRef + 0.1, int: BREAKOUT.intRef };
	assert.isBelow(matchupOpening(1, 0.7, 0.3, strong), 1);
});

test("heater", () => {
	assert.isTrue(onHeater({ pts: 14, fga: 8, fta: 2 }));
	assert.isFalse(onHeater({ pts: 14, fga: 14, fta: 2 }));
	assert.isFalse(onHeater({ pts: 8, fga: 4, fta: 0 }));
});
