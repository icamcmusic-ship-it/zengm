import { assert, describe, test } from "vitest";
import { makeSeededRandom } from "../random.ts";
import {
	RUMOR_CALIBRATION,
	calibrationKey,
	fitCalibration,
	fitIsotonic,
	interpolate,
	recalibrate,
} from "./calibration.ts";
import { RUMOR_TYPES } from "./types.ts";

describe("rumor calibration", () => {
	test("interpolation between knots, flat beyond the ends", () => {
		const curve: [number, number][] = [
			[0.1, 0.05],
			[0.5, 0.3],
			[0.9, 0.7],
		];
		assert.strictEqual(interpolate(curve, 0), 0.05);
		assert.strictEqual(interpolate(curve, 0.1), 0.05);
		assert.closeTo(interpolate(curve, 0.3), 0.175, 1e-9);
		assert.closeTo(interpolate(curve, 0.7), 0.5, 1e-9);
		assert.strictEqual(interpolate(curve, 1), 0.7);
		assert.strictEqual(interpolate([], 0.42), 0.42);
	});

	test("isotonic fit recovers a monotone curve and pools violators", () => {
		// True chance 0.6 * score, scores 0 to 1
		const random = makeSeededRandom(5);
		const points = [];
		for (let i = 0; i < 20000; i++) {
			const x = Math.round(random() * 20) / 20;
			points.push({ x, y: random() < 0.6 * x ? 1 : 0 });
		}
		const curve = fitIsotonic(points, 200);
		for (let i = 1; i < curve.length; i++) {
			assert.isAbove(curve[i]![0], curve[i - 1]![0]);
			assert.isAtLeast(curve[i]![1], curve[i - 1]![1]);
		}
		for (const x of [0.2, 0.5, 0.8]) {
			assert.closeTo(interpolate(curve, x), 0.6 * x, 0.06);
		}

		// A higher score that comes true less often is pooled with its neighbor
		const pooled = fitIsotonic([
			{ x: 0.1, y: 1 },
			{ x: 0.1, y: 0 },
			{ x: 0.2, y: 0 },
			{ x: 0.2, y: 0 },
		]);
		assert.deepStrictEqual(pooled, [[0.15, 0.25]]);

		// Small blocks are merged
		const merged = fitIsotonic(
			[
				{ x: 0.1, y: 0 },
				{ x: 0.1, y: 0 },
				{ x: 0.5, y: 1 },
			],
			3,
		);
		assert.strictEqual(merged.length, 1);
	});

	test("fit: a curve per type, and per kind with enough rumors", () => {
		const rumors = [];
		for (let i = 0; i < 300; i++) {
			rumors.push({
				type: "shopping" as const,
				kind: "request",
				raw: 0.7,
				status: i % 2 === 0 ? ("confirmed" as const) : ("busted" as const),
			});
		}
		// Too few for a curve of their own
		for (let i = 0; i < 100; i++) {
			rumors.push({
				type: "shopping" as const,
				kind: "rare",
				raw: 0.05,
				status: "busted" as const,
			});
		}
		const table = fitCalibration(rumors, { minBlock: 10, minKind: 150 });
		assert.deepStrictEqual(Object.keys(table).sort(), [
			"shopping",
			"shopping/request",
		]);
		assert.closeTo(table["shopping/request"]![0]![1], 0.5, 0.02);
		assert.strictEqual(
			calibrationKey("shopping", "request", table),
			"shopping/request",
		);
		assert.strictEqual(calibrationKey("shopping", "other", table), "shopping");
		assert.strictEqual(calibrationKey("coach", undefined, table), undefined);
		assert.strictEqual(recalibrate("coach", undefined, 0.33, table), 0.33);
	});

	test("the shipped table is monotone, within 0 to 1, and covers every type", () => {
		for (const type of RUMOR_TYPES) {
			assert.isDefined(
				calibrationKey(type, undefined, RUMOR_CALIBRATION) ??
					Object.keys(RUMOR_CALIBRATION).find((key) =>
						key.startsWith(`${type}/`),
					),
				type,
			);
		}
		for (const [key, curve] of Object.entries(RUMOR_CALIBRATION)) {
			assert.isAbove(curve.length, 0, key);
			for (const [i, [x, y]] of curve.entries()) {
				assert.isAtLeast(y, 0, key);
				assert.isAtMost(y, 1, key);
				if (i > 0) {
					assert.isAbove(x, curve[i - 1]![0], key);
					assert.isAtLeast(y, curve[i - 1]![1], key);
				}
			}
		}
	});
});
