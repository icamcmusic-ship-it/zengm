import { assert, describe, test } from "vitest";
import { makeFixture } from "./fixture.ts";
import { buildPaper, paperText } from "./index.ts";
import { COLUMNISTS } from "./columnists.ts";
import { moveText } from "./desk.ts";
import type { Article, Paper } from "./types.ts";

const articles = (paper: Paper): Article[] =>
	paper.sections.flatMap((s) => s.articles);

describe("award race tracker", () => {
	test("movement arrows", () => {
		assert.strictEqual(moveText(1, 3), "▲2");
		assert.strictEqual(moveText(3, 1), "▼2");
		assert.strictEqual(moveText(2, 2), "–");
		assert.strictEqual(moveText(1, 0), "new");
		assert.strictEqual(moveText(1, undefined), "");
	});

	test("runs in the Awards section in season, with a table per race and arrows once there is a snapshot", () => {
		const paper = buildPaper(makeFixture("midseason", 2026));
		const awards = paper.sections.find((s) => s.id === "awards");
		const tracker = awards?.articles.find((a) => a.id === "award-tracker");
		assert.ok(tracker);
		const tables = tracker.body.filter((b) => b.type === "table");
		assert.strictEqual(tables.length, 3);
		const text = paperText(paper);
		assert.match(text, /▲|▼|new/);
		// Odd season in the fixture: no earlier snapshot
		const first = buildPaper(makeFixture("midseason", 2025));
		assert.include(paperText(first), "first check of the 2025 season");
		// Not once the awards are given
		const final = buildPaper(makeFixture("final", 2026));
		assert.isUndefined(articles(final).find((a) => a.id === "award-tracker"));
	});
});

describe("columnists", () => {
	test("two columns by two different named columnists, each in their own column", () => {
		const names = new Set(COLUMNISTS.map((x) => x.name));
		const seen = new Set<string>();
		for (let season = 2020; season < 2030; season++) {
			const paper = buildPaper(makeFixture("midseason", season));
			const opinion = paper.sections.find((s) => s.id === "opinion")!;
			assert.strictEqual(opinion.articles.length, 2);
			const [a, b] = opinion.articles;
			assert.notStrictEqual(a!.byline!.name, b!.byline!.name);
			assert.notStrictEqual(a!.head, b!.head);
			for (const x of [a!, b!]) {
				assert.isTrue(names.has(x.byline!.name));
				const writer = COLUMNISTS.find((w) => w.name === x.byline!.name)!;
				assert.strictEqual(x.kicker, writer.column);
				seen.add(writer.name);
			}
		}
		// A league keeps four columnists on staff
		assert.strictEqual(seen.size, 4);
	});
});

describe("medical desk", () => {
	test("out, day to day, returns and durability notes", () => {
		const paper = buildPaper(makeFixture("midseason", 2026));
		const desk = articles(paper).find((a) => a.id === "medical-desk");
		assert.ok(desk);
		const text = paperText({
			...paper,
			sections: [{ ...paper.sections[0]!, articles: [desk], sidebars: [] }],
		});
		assert.include(text, "Back in the lineup");
		assert.include(text, "cleared after missing");
		assert.include(text, "never on the injury report");
		assert.include(text, "man-games");
		assert.notMatch(text, /undefined|NaN/);
		// Not in the season preview or after the season
		assert.isUndefined(
			articles(buildPaper(makeFixture("final", 2026))).find(
				(a) => a.id === "medical-desk",
			),
		);
	});
});
