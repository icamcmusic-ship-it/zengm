import { afterEach, assert, describe, test } from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { player } from "../index.ts";
import genRatings from "./genRatings.basketball.ts";
import bonus from "./bonus.ts";
import { ovrRaw } from "./ovr.basketball.ts";
import {
	applyPreDraftTrajectory,
	reshapeKeepingOvr,
	shiftToRawOvr,
} from "./prospectVariety.ts";
import {
	COMPOSITION_SHAPES,
	SECOND_SHAPE_CHANCE,
	STRENGTH_SHAPES,
	drawSecondShape,
	mergeShapePlans,
} from "../../../common/draftClassShape.ts";
import {
	DEV_RATES,
	devRatesOf,
	ratingFactor,
	regionOf,
	squashFactor,
} from "../../../common/prospectVariety.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";

const realRandom = Math.random;
afterEach(() => {
	Math.random = realRandom;
});
const seeded = (seed: string) => {
	const rng = new Rng(seed);
	Math.random = () => rng.random();
};

const corr = (a: number[], b: number[]) => {
	const n = a.length;
	const ma = a.reduce((s, x) => s + x, 0) / n;
	const mb = b.reduce((s, x) => s + x, 0) / n;
	let c = 0;
	let va = 0;
	let vb = 0;
	for (let i = 0; i < n; i++) {
		c += (a[i]! - ma) * (b[i]! - mb);
		va += (a[i]! - ma) ** 2;
		vb += (b[i]! - mb) ** 2;
	}
	return c / Math.sqrt(va * vb);
};

describe("prospect variety", () => {
	test("the soft cap: no hard ceiling at 1.2, never above 1.45, and the mean factor is the stock one", () => {
		assert.strictEqual(squashFactor(0.9), 0.9);
		assert.strictEqual(squashFactor(0.1), 0.2);
		assert.isAbove(squashFactor(1.4), 1.3);
		assert.isBelow(squashFactor(5), 1.45);
		// Stock: N(1, 0.2) clamped to [0.2, 1.2]
		const rng = new Rng("factor");
		let stock = 0;
		let soft = 0;
		const N = 200_000;
		for (let i = 0; i < N; i++) {
			const z = rng.normal(0, 1);
			stock += Math.min(1.2, Math.max(0.2, 1 + 0.2 * z)) / N;
			soft += ratingFactor("ins", z) / N;
		}
		assert.approximately(soft, stock, 0.002);
	});

	test("generation: same draws from the game's random stream as a real player's stock ratings, and deterministic", () => {
		resetG();
		let count = 0;
		const counting = (seed: string) => {
			const rng = new Rng(seed);
			count = 0;
			Math.random = () => {
				count += 1;
				return rng.random();
			};
		};
		for (let i = 0; i < 20; i++) {
			counting(`draws${i}`);
			const a = genRatings(2026, DEFAULT_LEVEL, undefined, {
				country: "Nigeria",
			});
			const withVariety = count;
			assert.isDefined(a.genVar);
			// The same stream, as a real player's random ratings (no variety)
			counting(`draws${i}`);
			const stock = genRatings(2026, DEFAULT_LEVEL, 50);
			assert.isUndefined(stock.genVar);
			assert.strictEqual(withVariety, count);
		}

		seeded("same");
		const b = genRatings(2026, DEFAULT_LEVEL, undefined, { country: "France" });
		seeded("same");
		const c = genRatings(2026, DEFAULT_LEVEL, undefined, { country: "France" });
		assert.deepStrictEqual(b, c);
	});

	test("generation: ratings inside a group are related but not in lockstep, and the top end is no longer clipped", () => {
		resetG();
		seeded("corr");
		const rows: any[] = [];
		for (let i = 0; i < 3000; i++) {
			rows.push(genRatings(2026, DEFAULT_LEVEL).ratings);
		}
		const r = (a: string, b: string) =>
			corr(
				rows.map((x) => x[a]),
				rows.map((x) => x[b]),
			);
		// Stock: 0.90, 0.91, 0.83
		for (const [a, b] of [
			["ft", "tp"],
			["spd", "jmp"],
			["drb", "pss"],
		]) {
			assert.isAbove(r(a!, b!), 0.45, `${a}-${b}`);
			assert.isBelow(r(a!, b!), 0.75, `${a}-${b}`);
		}
		// Stock: the best three-point rating of 20,000 prospects was 75
		assert.isAbove(Math.max(...rows.map((x) => x.tp)), 75);
		// Some bigs shoot: about 0% of the tallest were in the top 10% from three
		const tps = rows.map((x) => x.tp).sort((x, y) => x - y);
		const tp90 = tps[Math.floor(0.9 * tps.length)]!;
		const tall = rows.filter((x) => x.hgt >= 62);
		assert.isAbove(tall.filter((x) => x.tp >= tp90).length, 0);
	});

	test("reshaping keeps ovr; a bonus never changes the height rating", () => {
		resetG();
		seeded("reshape");
		for (let i = 0; i < 50; i++) {
			const r = genRatings(2026, DEFAULT_LEVEL).ratings as any;
			const before = ovrRaw(r);
			reshapeKeepingOvr(r, { tp: 15, oiq: 4 });
			assert.approximately(ovrRaw(r), before, 0.35);
			shiftToRawOvr(r, before + 2);
			assert.approximately(ovrRaw(r), before + 2, 0.35);
		}
		const p = player.generate(PLAYER.UNDRAFTED, 19, 2026, false, 50);
		const hgt = p.ratings[0].hgt;
		bonus(p);
		bonus(p, -20);
		assert.strictEqual(p.ratings[0].hgt, hgt);
	});

	test("regions", () => {
		assert.strictEqual(regionOf("France"), "europe");
		assert.strictEqual(regionOf("Nigeria"), "africa");
		assert.strictEqual(regionOf("Australia"), "oceania");
		assert.isUndefined(regionOf("USA"));
	});

	test("development rates average their center per group, from the player's seed", () => {
		const sums = { ath: 0, shoot: 0, skill: 0, ins: 0 };
		const N = 20_000;
		for (let s = 0; s < N; s++) {
			const rates = devRatesOf({ v: 1, s });
			for (const key of Object.keys(sums) as (keyof typeof sums)[]) {
				sums[key] += rates[key] / N;
				assert.isAtLeast(rates[key], DEV_RATES.min);
				assert.isAtMost(rates[key], DEV_RATES.max);
			}
		}
		for (const v of Object.values(sums)) {
			assert.approximately(v, DEV_RATES.center, 0.01);
		}
		assert.deepStrictEqual(
			devRatesOf({ v: 1, s: 7 }),
			devRatesOf({ v: 1, s: 7 }),
		);
	});

	test("the hidden trajectory before the draft is applied once, centered over players", () => {
		resetG();
		g.setWithoutSavingToDB("playerTraitsSeed", 99);
		seeded("trajectory");
		let sum = 0;
		const N = 400;
		for (let pid = 0; pid < N; pid++) {
			const p = player.generate(PLAYER.UNDRAFTED, 19, 2026, false, 50) as any;
			p.pid = pid;
			p.genVar.pre = [20, 21];
			const r = p.ratings[0];
			const before = ovrRaw(r);
			applyPreDraftTrajectory(p);
			sum += (ovrRaw(r) - before) / N;
			assert.isUndefined(p.genVar.pre);
			const again = ovrRaw(r);
			applyPreDraftTrajectory(p);
			assert.strictEqual(ovrRaw(r), again);
		}
		assert.approximately(sum, 0, 0.3);
	});

	test("two compatible class shapes: one about strength, one about composition", () => {
		let seconds = 0;
		const N = 4000;
		for (let i = 0; i < N; i++) {
			const second = drawSecondShape(`s${i}`, "deep");
			if (second) {
				seconds += 1;
				assert.include(COMPOSITION_SHAPES, second);
			}
			const other = drawSecondShape(`s${i}`, "guards");
			if (other) {
				assert.include(STRENGTH_SHAPES, other);
			}
			assert.isUndefined(drawSecondShape(`s${i}`, "typical"));
			assert.isUndefined(drawSecondShape(`s${i}`, "seniors"));
		}
		assert.approximately(seconds / N, SECOND_SHAPE_CHANCE, 0.03);
		const merged = mergeShapePlans(
			[
				{ key: "1", ovr: 2, age: 0 },
				{ key: "2", ovr: -1, age: 0 },
			],
			[
				{ key: "2", ovr: 0, age: 0, nudges: ["guard"] },
				{ key: "3", ovr: 0, age: 0, international: true },
			],
		);
		assert.deepStrictEqual(merged, [
			{ key: "1", ovr: 2, age: 0 },
			{ key: "2", ovr: -1, age: 0, nudges: ["guard"] },
			{ key: "3", ovr: 0, age: 0, international: true },
		]);
	});
});
