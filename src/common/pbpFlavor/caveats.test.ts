import { assert, test } from "vitest";
import { FlavorSession, shootoutShotText } from "./session.ts";
import { Rng } from "./rng.ts";

const init = (quarterLength: number) =>
	new FlavorSession({
		gid: 5,
		numPeriods: 4,
		quarterLength,
		female: false,
		noArticle: false,
		teams: [
			{ name: "Celtics", abbrev: "BOS" },
			{ name: "Mavericks", abbrev: "DAL" },
		],
		players: [],
	});

test("the session takes the league's quarter length", () => {
	assert.strictEqual((init(12) as any).periodLens[1], 720);
	assert.strictEqual((init(5) as any).periodLens[1], 300);
});

test("shootout lines are seeded: same game and event, same words, never Math.random", () => {
	const orig = Math.random;
	Math.random = () => {
		throw new Error("Math.random used");
	};
	try {
		const seen = new Set<string>();
		for (let i = 0; i < 200; i++) {
			const a = shootoutShotText(new Rng(9, i), i % 2 === 0, false);
			const b = shootoutShotText(new Rng(9, i), i % 2 === 0, false);
			assert.strictEqual(a, b);
			seen.add(a);
		}
		assert.isAbove(seen.size, 3);
		const s1 = init(12);
		const s2 = init(12);
		const host = {
			stat: () => undefined,
			score: () => [0, 0] as [number, number],
			onCourt: () => [],
		};
		for (let i = 0; i < 20; i++) {
			const ev: any = {
				type: "shootoutShot",
				t: i % 2,
				pid: 1,
				made: i % 3 === 0,
			};
			const r1: any = s1.describe(ev, host as any);
			const r2: any = s2.describe(ev, host as any);
			assert.strictEqual(r1.text, r2.text);
			assert.isFalse(!!r1.keepText);
		}
	} finally {
		Math.random = orig;
	}
});
