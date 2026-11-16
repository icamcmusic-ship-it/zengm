import { assert, test } from "vitest";
import { archetypeById, classify, defaultNorms, explain } from "./classify.ts";
import { realData, realNorms, realPlayer } from "./real.testutil.ts";
import {
	strengthWord,
	topDriver,
	whyBullets,
	whyDrivers,
	whyLine,
} from "./whyText.ts";
import { sampleLeague } from "./sample.testutil.ts";

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

test("no digits anywhere, 1-4 bullets, no repeats, and the words read from the shown ratings", async () => {
	const d = realData();
	const norms = realNorms(defaultNorms(false), false);
	const rows2025 = d.d.ratings.filter((r) => r.season === 2025).slice(0, 120);
	let n = 0;
	for (const row of rows2025) {
		const p = realPlayer(d, row);
		const read = { pos: p.pos, age: p.age, stats: p.stats };
		const c = classify(p.ratings, { norms, ...read });
		const a = archetypeById(c.id)!;
		const rows = explain(c.id, p.ratings, norms, read);
		const drivers = whyDrivers({ a, ratings: p.ratings, norms, read, rows });
		const bullets = whyBullets(drivers);
		assert.ok(bullets.length >= 1 && bullets.length <= 4, row.slug);
		assert.strictEqual(new Set(bullets).size, bullets.length, row.slug);
		for (const b of bullets) {
			assert.notMatch(b, /\d|%/, `${row.slug}: ${b}`);
		}
		assert.notMatch(whyLine(drivers), /\d/);
		assert.strictEqual(
			whyLine(drivers),
			bullets.slice(0, 2).join(" · "),
			row.slug,
		);
		// (a sub-rating and its base dimension never both: one bullet per skill)
		const groups = bullets.map((b) => drivers.find((x) => x.text === b)!.group);
		assert.strictEqual(new Set(groups).size, groups.length, row.slug);
		// (never a strength below average: only the fallback, "Relies on" his best wanted dimension, can be)
		for (const x of drivers) {
			if (
				(x.kind === "sub" || x.kind === "rating") &&
				!x.text.startsWith("Relies on")
			) {
				assert.ok(x.s >= 0.4, `${row.slug} ${x.text}`);
			}
		}
		// Stable: the same reading twice gives the same words
		assert.deepEqual(
			whyBullets(whyDrivers({ a, ratings: p.ratings, norms, read, rows })),
			bullets,
		);
		n++;
	}
	assert.ok(n >= 100);
	// Random-league players too (no stats, no subs)
	for (const p of await sampleLeague(150, "why")) {
		const c = classify(p.ratings, { norms, age: p.age });
		const a = archetypeById(c.id)!;
		const rows = explain(c.id, p.ratings, norms, { age: p.age });
		const bullets = whyBullets(
			whyDrivers({
				a,
				ratings: p.ratings,
				norms,
				read: { age: p.age },
				rows,
			}),
		);
		assert.ok(bullets.length >= 1, a.name);
		for (const b of bullets) {
			assert.notMatch(b, /\d/, b);
		}
	}
});

test("the words come from the shown (fuzzed) ratings", () => {
	const { p, a, norms, read, rows } = readFor("goberru01", true);
	// Shown ratings much lower: the words weaken, or the bullet goes
	const shown = { ...p.ratings };
	for (const k of Object.keys(shown) as (keyof typeof shown)[]) {
		if (typeof shown[k] === "number" && k !== "hgt") {
			(shown as any)[k] = (shown[k] as number) - 25;
		}
	}
	if (shown.sub) {
		shown.sub = shown.sub.map((x) => x - 25);
	}
	const rank = (t: string) =>
		["Elite", "Strong", "Above-average", "Relies on"].findIndex((w) =>
			t.startsWith(w),
		);
	const a1 = whyDrivers({ a, ratings: p.ratings, norms, read, rows });
	const a2 = whyDrivers({ a, ratings: p.ratings, norms, read, rows, shown });
	for (const d1 of a1) {
		const d2 = a2.find((x) => x.kind === d1.kind && x.key === d1.key);
		if (d2 && rank(d1.text) >= 0 && rank(d2.text) >= 0) {
			assert.ok(rank(d2.text) >= rank(d1.text), `${d1.text} / ${d2.text}`);
		}
	}
	assert.ok(a2.some((x) => x.kind !== "low"));
	assert.strictEqual(strengthWord(2), "Elite");
	assert.strictEqual(strengthWord(-0.1), undefined);
});

test("a play type is cited in words from how much he runs it", () => {
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
		assert.match(ptd.text, /^(Lives|Runs a lot|Plenty|Gets out)/);
		assert.notMatch(ptd.text, /\d/);
		assert.include(whyBullets(drivers), ptd.text);
	}
});
