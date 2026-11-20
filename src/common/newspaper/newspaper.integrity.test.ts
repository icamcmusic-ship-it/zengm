// The text checks that guard the raw output: polish no longer hides "undefined"/"NaN", so these fail on bad data. Also missing
// words between a phrase and a link ("who wentHawks"), trades that drop out or run twice, and multi-team trades.
import { assert, describe, test } from "vitest";
import { makeFixture } from "./fixture.ts";
import { buildHeadline, buildPaper, paperText } from "./index.ts";
import { Ctx } from "./ctx.ts";
import { featuredTrade, polish } from "./text.ts";
import type { EditionId, NewsFacts, NPTrade, Paper } from "./types.ts";

const EDITIONS: EditionId[] = ["preseason", "midseason", "playoffs", "final"];
const BAD = /undefined|NaN|\[object|Infinity|\bnull\b/;
// A lowercase word run straight into a capitalized one: "wentHawks", "theCity"
const GLUED = /\b[a-z]{2,}[A-Z][a-z]/;

const check = (paper: Paper, label: string) => {
	const text = paperText(paper);
	assert.notMatch(text, BAD, label);
	const glued = text.split("\n").filter((line) => GLUED.test(line));
	assert.deepEqual(glued, [], label);
};

const tradeIds = (p: Paper) =>
	p.sections.flatMap((s) =>
		s.articles
			.filter((a) => a.id === "feature-trade" || a.id.startsWith("trade-"))
			.map((a) => paperText({ ...p, sections: [{ ...s, articles: [a] }] })),
	);

describe("newspaper text integrity", () => {
	test("polish keeps bad data visible", () => {
		assert.include(polish("averaged undefined points"), "undefined");
		assert.include(polish("NaN wins"), "NaN");
	});

	for (const edition of EDITIONS) {
		test(`${edition}: no undefined/NaN and no glued words, with and without ratings`, () => {
			for (let season = 2018; season < 2030; season++) {
				for (const noRatings of [false, true]) {
					const facts = { ...makeFixture(edition, season), noRatings };
					for (const tid of [undefined, 0, 3, 11]) {
						check(
							buildPaper(facts, tid),
							`${edition} ${season} ${noRatings} ${tid}`,
						);
					}
				}
			}
		});
	}
});

const trade = (
	phase: number,
	tids: [number, number],
	score: number,
	pid: number,
	extra?: Partial<NPTrade>,
): NPTrade => ({
	phase,
	tids,
	score,
	got: [
		[{ kind: "player", pid, name: `Traded Guy ${pid}` }],
		[{ kind: "pick", season: 2030, round: 1, originalTid: tids[0] }],
	],
	...extra,
});

describe("newspaper trades", () => {
	const withTrades = (edition: EditionId, trades: NPTrade[]): NewsFacts => ({
		...makeFixture(edition, 2025),
		trades,
	});

	test("an offseason top trade still runs, and the featured trade runs once", () => {
		for (const edition of ["midseason", "final"] as const) {
			const facts = withTrades(edition, [
				trade(5, [0, 1], 90, 9001), // draft night
				trade(1, [2, 3], 50, 9002), // in season: the feature
				trade(-1, [4, 5], 30, 9003),
			]);
			assert.strictEqual(featuredTrade(facts.trades)!.score, 50);
			const text = paperText(buildPaper(facts));
			// The biggest trade (draft night) is not dropped for the feature's in-season one
			assert.include(text, "Traded Guy 9001", edition);
			// The in-season one runs in exactly one story: the feature, or Transactions when the feature does not run
			const stories = tradeIds(buildPaper(facts));
			assert.strictEqual(
				stories.filter((s) => s.includes("Traded Guy 9002")).length,
				1,
				edition,
			);
			assert.strictEqual(
				stories.filter((s) => s.includes("Traded Guy 9001")).length,
				1,
				edition,
			);
		}
	});

	test("preseason: the top (offseason) trade is not dropped", () => {
		const facts = withTrades("preseason", [
			trade(5, [0, 1], 90, 9001),
			trade(6, [2, 3], 50, 9002),
		]);
		const text = paperText(buildPaper(facts));
		assert.include(text, "Traded Guy 9001");
		assert.include(text, "Traded Guy 9002");
	});

	test("a three-team trade is one story with the note", () => {
		const note = "Three-team deal: a test rationale.";
		const t = trade(1, [0, 1], 60, 9001, {
			note,
			legs: [
				{
					tids: [1, 2],
					got: [
						[{ kind: "player", pid: 9005, name: "Third Leg Guy" }],
						[{ kind: "pick", season: 2031, round: 2, originalTid: 1 }],
					],
				},
			],
		});
		const facts = withTrades("midseason", [t]);
		const stories = tradeIds(buildPaper(facts));
		const mine = stories.filter((s) => s.includes("Traded Guy 9001"));
		assert.strictEqual(mine.length, 1);
		assert.include(mine[0]!, "Third Leg Guy");
		assert.include(mine[0]!, "three-team trade");
		assert.include(mine[0]!, note);
		// The team paper of the third team has it too
		assert.include(paperText(buildPaper(facts, 2)), "Third Leg Guy");
	});
});

describe("newspaper league settings", () => {
	const PRONOUNS = /\b(he|He|his|His|him|Him|himself|Himself)\b/;

	test("a women's league gets she/her, and the men's text did use he/his (the check can fail)", () => {
		let male = 0;
		for (const edition of EDITIONS) {
			for (let season = 2018; season < 2030; season++) {
				const facts = makeFixture(edition, season);
				for (const tid of [undefined, 0, 3]) {
					male += paperText(buildPaper(facts, tid))
						.split("\n")
						.filter((line) => PRONOUNS.test(line)).length;
					const text = paperText(
						buildPaper({ ...facts, gender: "female" }, tid),
					);
					const bad = text.split("\n").filter((line) => PRONOUNS.test(line));
					assert.deepEqual(bad, [], `${edition} ${season} ${tid}`);
				}
			}
		}
		assert.isAbove(male, 10);
	});

	test("the Timeline headline is the full paper's lead headline", () => {
		for (const edition of EDITIONS) {
			for (let season = 2018; season < 2030; season++) {
				const facts = makeFixture(edition, season);
				assert.strictEqual(
					buildHeadline(facts),
					buildPaper(facts).sections[0]?.articles[0]?.head,
					`${edition} ${season}`,
				);
			}
		}
	});

	test("no playoffs: nobody has finals losses", () => {
		for (const edition of EDITIONS) {
			for (let season = 2018; season < 2030; season++) {
				const facts: NewsFacts = {
					...makeFixture(edition, season),
					numRounds: 0,
					series: [],
				};
				const text = paperText(buildPaper(facts));
				assert.notMatch(text, /finals losses/i, `${edition} ${season}`);
			}
		}
	});

	test("a contracted champion is named", () => {
		const facts = makeFixture("final", 2025);
		const c = new Ctx({
			...facts,
			champions: [
				...(facts.champions ?? []),
				{ season: 2024, tid: 99, region: "Gone", name: "Ghosts" },
			],
		});
		assert.strictEqual(c.tn(99), "Ghosts");
		assert.strictEqual(c.tfull(99), "Gone Ghosts");
	});
});
