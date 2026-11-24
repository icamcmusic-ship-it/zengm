import { afterAll, assert, describe, test } from "vitest";
import { player } from "../index.ts";
import { g } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { addInjuryToDevParts, ovrPointsOf } from "./devParts.ts";

const withSeed = async <T>(seed: number, fn: () => Promise<T> | T) => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		return await fn();
	} finally {
		Math.random = original;
	}
};

const sumParts = (d: Record<string, number>) =>
	Object.values(d).reduce((a, b) => a + b, 0);

afterAll(() => {
	resetG();
});

describe("development breakdown", () => {
	for (const expanded of [false, true]) {
		test(`a season's parts add up to the ovr change, each part its own (expanded ratings ${expanded ? "on" : "off"})`, async () => {
			resetG();
			g.setWithoutSavingToDB("season", 2020);
			g.setWithoutSavingToDB("expandedRatings", expanded);
			await resetCache({});
			await withSeed(5, async () => {
				let seenCoach = 0;
				let seenAging = 0;
				for (const i of range(40)) {
					const p = player.generate(0, 21 + (i % 12), 2020, true, 50);
					await player.develop(p, 0);
					// Development without a breakdown (new player, years 0): nothing stored
					assert.isUndefined((p.ratings[0] as any).devParts);
					const before = p.ratings[0].ovr;
					g.setWithoutSavingToDB("season", 2021);
					player.addRatingsRow(p);
					const aging = { spd: -2, jmp: -2, endu: -1 };
					const minutes = { tp: 1, oiq: 1.5, diq: 1.5, drb: 1 };
					await player.develop(
						p,
						1,
						false,
						i % 2 === 0 ? 90 : 10,
						false,
						{ bonus: 0.9, seed: `t|${i}` },
						{
							baseChangeDelta: i % 3 === 0 ? 1 : -0.5,
							dropScale: 1,
							ratingDelta: { ...aging, ...minutes },
							careerDelta: aging,
							minutesDelta: minutes,
						},
					);
					g.setWithoutSavingToDB("season", 2020);
					const r = p.ratings.at(-1) as any;
					const d = r.devParts;
					assert.isDefined(d);
					// base is the rest, so the parts add up to the change (up to the 0.1 rounding of base)
					assert.closeTo(sumParts(d), r.ovr - before, 0.051);
					// Coaching: a good staff helps a young player's gains (and a bad one hurts them)
					if (d.coach !== undefined) {
						seenCoach += 1;
					}
					assert.isBelow(d.aging, 0);
					seenAging += 1;
					assert.isAbove(d.minutes, 0);
					// The previous season's breakdown isn't copied to a new row
					player.addRatingsRow(p);
					assert.isUndefined((p.ratings.at(-1) as any).devParts);
				}
				assert.isAbove(seenCoach, 20);
				assert.strictEqual(seenAging, 40);
			});
		});
	}

	test("the coaching part matches the same development with a neutral staff", async () => {
		resetG();
		g.setWithoutSavingToDB("season", 2020);
		await resetCache({});
		let predicted = 0;
		let actual = 0;
		for (const i of range(300)) {
			const p = await withSeed(100 + i, async () => {
				const p = player.generate(0, 20 + (i % 4), 2020, true, 50);
				await player.develop(p, 0);
				return p;
			});
			const ovrs: number[] = [];
			for (const level of [100, DEFAULT_LEVEL]) {
				const copy = structuredClone(p);
				g.setWithoutSavingToDB("season", 2021);
				player.addRatingsRow(copy);
				await withSeed(1000 + i, () => player.develop(copy, 1, false, level));
				g.setWithoutSavingToDB("season", 2020);
				const r = copy.ratings.at(-1) as any;
				ovrs.push(r.ovr);
				if (level === 100) {
					predicted += r.devParts.coach ?? 0;
				}
			}
			actual += ovrs[0]! - ovrs[1]!;
		}
		// A top staff is worth about a quarter of a point a season to young players (vs neutral); the breakdown says the same on average
		assert.isAbove(predicted / 300, 0.15);
		assert.closeTo(predicted / 300, actual / 300, 0.1);
	});

	test("ovr points are linear in the ratings, scaled by the fudge factor's slope", () => {
		resetG();
		const r = {
			hgt: 50,
			stre: 50,
			spd: 50,
			jmp: 50,
			endu: 50,
			ins: 50,
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
		const one = ovrPointsOf(r, { spd: 1 });
		assert.isAbove(one, 0);
		assert.closeTo(ovrPointsOf(r, { spd: 2 }), 2 * one, 1e-9);
		assert.strictEqual(ovrPointsOf(r, {}), 0);
	});

	test("injuries add to the season's breakdown, rows without one are left alone", () => {
		const shared = { base: 2 };
		const row: any = { devParts: shared };
		addInjuryToDevParts(row, -3);
		addInjuryToDevParts(row, -1);
		assert.deepEqual(row.devParts, { base: 2, injury: -4 });
		// The row it was copied from keeps its own
		assert.deepEqual(shared, { base: 2 });
		const old: any = {};
		addInjuryToDevParts(old, -3);
		assert.isUndefined(old.devParts);
	});
});
