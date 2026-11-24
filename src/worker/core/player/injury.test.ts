import { assert, beforeEach, describe, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { injuryBodyPart } from "../../../common/injuryBodyPart.ts";
import {
	getInjurySize,
	getInjurySlopes,
	getWeightedCumSums,
	MAX_SIZE,
} from "./injuryBodyType.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { defaultInjuries } from "../../util/defaultInjuries.ts";
import injury from "./injury.ts";

beforeEach(() => {
	resetG();
});

const defaultNames = new Set(defaultInjuries.map((row) => row.name));

test("an empty injuries list (from a league file) falls back to the default injuries", () => {
	g.setWithoutSavingToDB("injuries", []);
	for (let i = 0; i < 50; i++) {
		const inj = injury(DEFAULT_LEVEL);
		assert.isTrue(defaultNames.has(inj.type), inj.type);
		assert.isAtLeast(inj.gamesRemaining, 1);
	}
});

test("all-zero frequencies fall back to the default injuries instead of always the first", () => {
	g.setWithoutSavingToDB("injuries", [
		{ name: "Custom A", frequency: 0, games: 10 },
		{ name: "Custom B", frequency: 0, games: 10 },
	]);
	const types = new Set<string>();
	for (let i = 0; i < 50; i++) {
		types.add(injury(DEFAULT_LEVEL).type);
	}
	assert.isFalse(types.has("Custom A"));
	assert.isTrue([...types].every((type) => defaultNames.has(type)));
	assert.isAbove(types.size, 1);

	// A usable list is still used
	g.setWithoutSavingToDB("injuries", [
		{ name: "Custom A", frequency: 0, games: 10 },
		{ name: "Custom B", frequency: 1, games: 10 },
	]);
	assert.strictEqual(injury(DEFAULT_LEVEL).type, "Custom B");
});

test("never a 0-game injury", () => {
	g.setWithoutSavingToDB("injuries", [
		{ name: "Tiny", frequency: 1, games: 0.3 },
	]);
	let neutral: number | undefined;
	for (let i = 0; i < 50; i++) {
		const inj = injury(DEFAULT_LEVEL, {
			extraFactor: 1,
			onNeutral: (games) => {
				neutral = games;
			},
		});
		assert.strictEqual(inj.gamesRemaining, 1);
		assert.strictEqual(neutral, 1);
	}
});

describe("injury types by position and body type", () => {
	const center = { hgt: 84, weight: 265, pos: "C" };
	const guard = { hgt: 74, weight: 185, pos: "PG" };
	const average = { hgt: 78.7, weight: 218, pos: "SF" };

	const shares = (size: number) => {
		const slopes = getInjurySlopes(defaultInjuries);
		const sums = getWeightedCumSums(defaultInjuries, slopes, size);
		const byPart = new Map<string, number>();
		let hamstring = 0;
		for (const [i, row] of defaultInjuries.entries()) {
			const w = sums[i]! - (i > 0 ? sums[i - 1]! : 0);
			const part = injuryBodyPart(row.name);
			byPart.set(part, (byPart.get(part) ?? 0) + w / sums.at(-1)!);
			if (/hamstring/i.test(row.name)) {
				hamstring += w / sums.at(-1)!;
			}
		}
		return { byPart, hamstring, total: sums.at(-1)! };
	};

	test("size: bigs positive, guards negative, an average player about 0", () => {
		assert.isAbove(getInjurySize(center), 0.8);
		assert.isBelow(getInjurySize(guard), -0.8);
		assert.closeTo(getInjurySize(average), 0, 0.01);
		assert.isAtMost(getInjurySize({ hgt: 96, weight: 400, pos: "C" }), 1.5);
	});

	test("bigs get more foot, knee and back injuries, guards more ankle and hamstring", () => {
		const big = shares(getInjurySize(center));
		const small = shares(getInjurySize(guard));
		for (const part of ["Foot", "Knee", "Back"]) {
			assert.isAbove(big.byPart.get(part)!, small.byPart.get(part)!, part);
		}
		assert.isAbove(small.byPart.get("Ankle")!, big.byPart.get("Ankle")!);
		assert.isAbove(small.hamstring, big.hamstring * 1.3);
	});

	test("mean-preserving: same total weight for everyone, and a league of average size has the plain shares", () => {
		const slopes = getInjurySlopes(defaultInjuries);
		const plain = shares(0);
		const big = shares(1.2);
		const small = shares(-1.2);
		assert.closeTo(big.total, plain.total, 1e-6);
		assert.closeTo(small.total, plain.total, 1e-6);
		for (const [part, share] of plain.byPart) {
			assert.closeTo(
				(big.byPart.get(part)! + small.byPart.get(part)!) / 2,
				share,
				1e-9,
				part,
			);
		}

		// No weight below 0 at the extremes
		for (const size of [-MAX_SIZE, MAX_SIZE]) {
			for (const slope of slopes) {
				assert.isAbove(1 + slope * size, 0);
			}
		}

		// The mean injury length is the same on average too
		const meanGames = (size: number) => {
			const sums = getWeightedCumSums(defaultInjuries, slopes, size);
			let total = 0;
			for (const [i, row] of defaultInjuries.entries()) {
				total += (sums[i]! - (i > 0 ? sums[i - 1]! : 0)) * row.games;
			}
			return total / sums.at(-1)!;
		};
		assert.closeTo((meanGames(1) + meanGames(-1)) / 2, meanGames(0), 1e-9);
	});

	test("one random number for the type and one for the length, with or without the player", () => {
		g.setWithoutSavingToDB("injuryDepth", true);
		const origRandom = Math.random;
		try {
			for (const opts of [undefined, { player: center }, { player: guard }]) {
				let calls = 0;
				Math.random = () => {
					calls += 1;
					return 0.37;
				};
				injury(DEFAULT_LEVEL, opts);
				assert.strictEqual(calls, 2);
			}
		} finally {
			Math.random = origRandom;
		}
	});

	test("draws follow the weighting, and not without Injury Depth", () => {
		const count = (player: typeof center) => {
			let n = 0;
			for (let i = 0; i < 4000; i++) {
				const part = injuryBodyPart(injury(DEFAULT_LEVEL, { player }).type);
				if (part === "Foot" || part === "Knee" || part === "Back") {
					n += 1;
				}
			}
			return n;
		};
		g.setWithoutSavingToDB("injuryDepth", true);
		assert.isAbove(count(center), count(guard) * 1.15);

		g.setWithoutSavingToDB("injuryDepth", false);
		const origRandom = Math.random;
		try {
			Math.random = () => 0.5;
			const a = injury(DEFAULT_LEVEL, { player: center }).type;
			const b = injury(DEFAULT_LEVEL, { player: guard }).type;
			assert.strictEqual(a, b);
		} finally {
			Math.random = origRandom;
		}
	});
});
