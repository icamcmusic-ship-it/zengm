import { assert, test } from "vitest";
import { archetypeById, classify, defaultNorms, explain } from "./classify.ts";
import { realData, realNorms, realPlayer } from "./real.testutil.ts";
import { topDriver, whyDrivers, whyLine } from "./whyText.ts";

const SLUGS = ["wembavi01", "goberru01", "curryst01", "jokicni01", "carusal01"];

const readFor = (slug: string, subs: boolean) => {
	const d = realData();
	const row = d.d.ratings.find((r) => r.slug === slug && r.season === 2025);
	assert.ok(row, slug);
	const p = realPlayer(d, row);
	if (!subs) {
		delete p.ratings.sub;
	}
	const norms = realNorms(defaultNorms(false), false);
	const read = { pos: p.pos, age: p.age, stats: p.stats };
	const c = classify(p.ratings, { norms, ...read });
	const a = archetypeById(c.id)!;
	const rows = explain(c.id, p.ratings, norms, read);
	return { p, a, norms, read, rows };
};

test("the why names the feature that contributed most", () => {
	for (const slug of SLUGS) {
		for (const subs of [true, false]) {
			const { p, a, norms, read, rows } = readFor(slug, subs);
			const drivers = whyDrivers({ a, ratings: p.ratings, norms, read, rows });
			const top = topDriver(drivers);
			assert.ok(top, `${slug} has a driver`);
			const line = whyLine(drivers);
			// (the line is capitalised)
			assert.include(line.toLowerCase(), top!.text.toLowerCase(), slug);
			if (!subs) {
				assert.ok(
					drivers.every((x) => x.kind !== "sub"),
					"no sub-ratings with the setting off",
				);
			}
		}
	}
});

test("sub-ratings are cited by name when the build wants them", () => {
	const { p, a, norms, read, rows } = readFor("wembavi01", true);
	const drivers = whyDrivers({ a, ratings: p.ratings, norms, read, rows });
	// (with Sub-Ratings on, the line leads with a sub-rating when one counted)
	if (drivers.some((x) => x.kind === "sub")) {
		assert.strictEqual(topDriver(drivers)!.kind, "sub");
	}
});

test("no numbers under the no-visible-ratings challenge, and the shown (fuzzed) values otherwise", () => {
	const { p, a, norms, read, rows } = readFor("goberru01", true);
	const hidden = whyLine(
		whyDrivers({ a, ratings: p.ratings, norms, read, rows, hideNumbers: true }),
	);
	assert.ok(hidden.length > 0);
	assert.notMatch(hidden, /\d/);
	// Shown ratings 10 lower: every number cited is the shown one
	const shown = { ...p.ratings };
	for (const k of Object.keys(shown) as (keyof typeof shown)[]) {
		if (typeof shown[k] === "number" && k !== "hgt") {
			(shown as any)[k] = (shown[k] as number) - 10;
		}
	}
	if (shown.sub) {
		shown.sub = shown.sub.map((x) => x - 10);
	}
	const a1 = whyDrivers({ a, ratings: p.ratings, norms, read, rows });
	const a2 = whyDrivers({ a, ratings: p.ratings, norms, read, rows, shown });
	for (const [i, d] of a1.entries()) {
		const n1 = d.text.match(/\d+/);
		const n2 = a2[i]!.text.match(/\d+/);
		if (n1 && n2) {
			assert.ok(Math.abs(Number(n1[0]) - 10 - Number(n2[0])) <= 1, d.text);
		}
	}
});

test("a play type is cited with his share of possessions", () => {
	const { p, a, norms, read, rows } = readFor("goberru01", true);
	const f = {
		iso: 0,
		prb: 0,
		spot: 0,
		post: 0,
		cut: 2,
		prr: 3,
		tr: 0,
		pb: 2,
		offs: 0,
	};
	const pt = {
		poss: 900,
		freq: {
			iso: 0,
			prb: 0,
			spot: 0,
			post: 0.05,
			cut: 0.3,
			prr: 0.28,
			tr: 0.1,
			pb: 0.15,
			offs: 0,
		},
		ppp: {
			iso: 0,
			prb: 0,
			spot: 0,
			post: 0.8,
			cut: 1.3,
			prr: 1.3,
			tr: 1.1,
			pb: 1.2,
			offs: 0,
		},
	};
	const drivers = whyDrivers({
		a,
		ratings: p.ratings,
		norms,
		read: { ...read, pt: { f, w: 0.75 } },
		rows,
		pt: pt as any,
	});
	const ptd = drivers.find((x) => x.kind === "playType");
	if (ptd) {
		assert.match(ptd.text, /^\d+% of his possessions/);
		assert.include(whyLine(drivers), ptd.text);
	}
});
