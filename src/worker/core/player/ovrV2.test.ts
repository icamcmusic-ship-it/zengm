import { afterEach, assert, describe, test } from "vitest";
import ovr from "./ovr.basketball.ts";
import developSeason from "./developSeason.basketball.ts";
import { OVR_V2_WEIGHTS } from "./ovrWeights.basketball.ts";
import { REALISTIC_AGING_TARGETS } from "./realisticAging.basketball.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { fillExpandedRatings } from "../../../common/expandedRatings.ts";

afterEach(() => {
	resetG();
});

const withSeededRandom = <T>(seed: number, fn: () => T) => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		return fn();
	} finally {
		Math.random = original;
	}
};

const base = {
	hgt: 47,
	stre: 50,
	spd: 50,
	jmp: 50,
	endu: 45,
	ins: 45,
	dnk: 50,
	ft: 50,
	fg: 50,
	tp: 50,
	oiq: 50,
	diq: 50,
	drb: 50,
	pss: 50,
	reb: 50,
};
const center = {
	...base,
	hgt: 75,
	spd: 35,
	tp: 25,
	drb: 30,
	pss: 35,
	reb: 75,
	ins: 70,
	dnk: 70,
};
const pg = {
	...base,
	hgt: 25,
	spd: 75,
	tp: 65,
	drb: 75,
	pss: 75,
	reb: 30,
	ins: 35,
};

describe("Sim-Calibrated Ovr", () => {
	test("off: the stock formula", () => {
		resetG();
		g.setWithoutSavingToDB("ovrV2", false);
		// Stock: 0.159*(47-47.5) + ... + 48.5 then fudge
		assert.strictEqual(ovr(base as any), 53);
	});

	test("weights: compat ratings the expanded sim doesn't read get no weight, nothing negative", () => {
		assert.strictEqual(OVR_V2_WEIGHTS.expanded.weights.diq, 0);
		assert.strictEqual(OVR_V2_WEIGHTS.expanded.weights.reb, 0);
		for (const variant of [OVR_V2_WEIGHTS.stock, OVR_V2_WEIGHTS.expanded]) {
			for (const w of Object.values(variant.weights)) {
				assert.isAtLeast(w, 0);
			}
		}
		for (const key of ["wng", "pdef", "idef", "oreb", "dreb", "bsc"]) {
			assert.isAbove(
				(OVR_V2_WEIGHTS.expanded.weights as Record<string, number>)[key]!,
				0,
				key,
			);
		}
	});

	test("on: same scale for an average player, height and speed count more, basketball IQ less", () => {
		resetG();
		g.setWithoutSavingToDB("ovrV2", false);
		const stockBase = ovr(base as any);
		const stockIq = ovr({ ...base, oiq: 70, diq: 70 } as any) - stockBase;
		const stockHgt = ovr({ ...base, hgt: 67 } as any) - stockBase;
		g.setWithoutSavingToDB("ovrV2", true);
		const v2Base = ovr(base as any);
		assert.isAtMost(Math.abs(v2Base - stockBase), 3);
		const v2Iq = ovr({ ...base, oiq: 70, diq: 70 } as any) - v2Base;
		const v2Hgt = ovr({ ...base, hgt: 67 } as any) - v2Base;
		assert.isBelow(v2Iq, stockIq);
		assert.isAbove(v2Hgt, stockHgt);
	});

	test("on: works with Expanded Ratings on, and toggling it barely moves a player", () => {
		resetG();
		g.setWithoutSavingToDB("ovrV2", true);
		for (const r of [base, center, pg]) {
			const p = { ratings: [{ ...r, season: 2025, pos: "F" }] } as any;
			fillExpandedRatings(p);
			g.setWithoutSavingToDB("expandedRatings", false);
			const off = ovr(p.ratings[0]);
			g.setWithoutSavingToDB("expandedRatings", true);
			const on = ovr(p.ratings[0]);
			assert.isAtMost(Math.abs(on - off), 6);
			// pdef/idef are read (diq isn't)
			const better = ovr({ ...p.ratings[0], idef: p.ratings[0].idef + 20 });
			assert.isAbove(better, on);
			assert.strictEqual(ovr({ ...p.ratings[0], diq: 99 }), on);
		}
	});
});

describe("Realistic Aging", () => {
	const meanChange = (key: string, age: number, realistic: boolean) => {
		resetG();
		g.setWithoutSavingToDB("realisticAging", realistic);
		return withSeededRandom(age * 7 + 1, () => {
			let total = 0;
			const n = 2000;
			for (let i = 0; i < n; i++) {
				const r: any = { ...base, hgt: 50 };
				const before = r[key];
				developSeason(r, age, DEFAULT_LEVEL);
				total += r[key] - before;
			}
			return total / n;
		});
	};

	test("a target for every developed rating, ages 19 to 40", () => {
		for (const target of Object.values(REALISTIC_AGING_TARGETS)) {
			assert.strictEqual(target.byAge.length, 22);
		}
	});

	test("basketball IQ still improves at 28, athleticism declines more gently at 29", () => {
		assert.isAbove(meanChange("oiq", 28, true), meanChange("oiq", 28, false));
		assert.isAbove(meanChange("oiq", 28, true), 0);
		assert.isAbove(meanChange("spd", 29, true), meanChange("spd", 29, false));
		assert.isAbove(meanChange("stre", 29, true), meanChange("stre", 29, false));
	});

	test("young players develop exactly like before", () => {
		const dev = (realistic: boolean) => {
			resetG();
			g.setWithoutSavingToDB("realisticAging", realistic);
			return withSeededRandom(5, () => {
				const r: any = { ...base };
				for (let age = 20; age <= 22; age++) {
					developSeason(r, age, DEFAULT_LEVEL);
				}
				return r;
			});
		};
		assert.deepStrictEqual(dev(true), dev(false));
	});

	test("secret aging curve still shifts development on top", () => {
		resetG();
		g.setWithoutSavingToDB("realisticAging", true);
		const dev = (baseChangeDelta: number) =>
			withSeededRandom(9, () => {
				const r: any = { ...base };
				developSeason(r, 31, DEFAULT_LEVEL, { baseChangeDelta, dropScale: 1 });
				return r.oiq + r.spd + r.tp;
			});
		assert.isAbove(dev(1.5), dev(0));
	});
});
