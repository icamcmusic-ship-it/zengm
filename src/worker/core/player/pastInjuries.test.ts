import { assert, beforeEach, test } from "vitest";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { pastInjuryLoss } from "./pastInjuries.ts";

beforeEach(() => {
	resetG();
});

const ages = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, i) => from + i);

const meanLoss = (key: string, careerAging: boolean) => {
	g.setWithoutSavingToDB("careerAging" as any, careerAging);
	let total = 0;
	const n = 400;
	for (let i = 0; i < n; i++) {
		total += pastInjuryLoss(`test|${i}`, ages(20, 29), 2030)[key] ?? 0;
	}
	return total / n;
};

test("no seasons played, no loss", () => {
	assert.deepEqual(pastInjuryLoss("x", [], 2030), {});
});

test("deterministic, and doesn't touch Math.random", () => {
	g.setWithoutSavingToDB("careerAging" as any, true);
	const random = Math.random;
	let calls = 0;
	Math.random = () => {
		calls += 1;
		return random();
	};
	try {
		const a = pastInjuryLoss("seed|1", ages(20, 33), 2030);
		const b = pastInjuryLoss("seed|1", ages(20, 33), 2030);
		assert.deepEqual(a, b);
	} finally {
		Math.random = random;
	}
	assert.strictEqual(calls, 0);
});

test("a ten-season career loses a little athleticism, only athletic ratings", () => {
	for (const careerAging of [true, false]) {
		const spd = meanLoss("spd", careerAging);
		// Career Aging: about 0.2-0.3 points a season; the stock rule is harsher (1-20 points from a 25+ game injury)
		assert.isAbove(spd, 0.5, `careerAging ${careerAging}`);
		assert.isBelow(spd, careerAging ? 6 : 12, `careerAging ${careerAging}`);
		g.setWithoutSavingToDB("careerAging" as any, careerAging);
		for (let i = 0; i < 50; i++) {
			for (const key of Object.keys(
				pastInjuryLoss(`k|${i}`, ages(20, 34), 2030),
			)) {
				assert.include(["spd", "jmp", "endu", "dnk"], key);
			}
		}
	}
});
