import { assert, describe, test } from "vitest";
import { makeFixture } from "./fixture.ts";
import { buildPaper, paperText } from "./index.ts";
import { DEAL_PAGE_IDS } from "./pages-deals.ts";
import { segsText } from "./text.ts";
import type { EditionId, NewsFacts, Paper } from "./types.ts";
import { ruleOf } from "./vary.ts";

const EDITIONS: EditionId[] = ["preseason", "midseason", "playoffs", "final"];
const BAD = /undefined|NaN|\[object|Infinity|\bnull\b/;

const types = (p: Paper) => p.sections.flatMap((s) => s.articles.map((a) => a.type ?? a.id));

// A league in its first preseason: no history, no stats, no transactions
const brandNew = (season = 2005): NewsFacts => {
	const f = makeFixture("preseason", season);
	return {
		...f,
		firstSeason: season,
		teams: f.teams.map((t) => ({ ...t, hist: [], prev: undefined, titles: [], firstSeason: season })),
		players: f.players.map((p) => ({
			...p,
			career: undefined,
			honors: undefined,
			prevLine: undefined,
			prevOvr: undefined,
			prevTid: undefined,
			rookie: false,
		})),
		trades: [],
		signings: [],
		retirees: [],
		draft: [],
		champions: [],
		mvps: [],
		h2h: [],
		prevPairs: [],
		draftRetro: undefined,
		then: undefined,
		careerBoard: undefined,
		recordWins: undefined,
		wire: undefined,
		lottery: undefined,
		releases: [],
	};
};

describe("front-office and preview pages", () => {
	test("every new page runs somewhere, with clean text, in league and team papers", () => {
		const seen = new Set<string>();
		for (const ed of EDITIONS) {
			for (let season = 2008; season < 2034; season++) {
				const f = makeFixture(ed, season);
				const p = buildPaper(f);
				for (const t of types(p)) {
					seen.add(t);
				}
				assert.notMatch(paperText(p), BAD, `${ed} ${season}`);
				if (season % 5 === 0) {
					for (const tid of [0, 4]) {
						assert.notMatch(paperText(buildPaper(f, tid)), BAD, `${ed} ${season} ${tid}`);
					}
				}
			}
		}
		const missing = DEAL_PAGE_IDS.filter((id) => !seen.has(id));
		assert.deepEqual(missing, []);
	});

	test("20+ of the variation rules now have a lead to rewrite", () => {
		const rules = new Set<string>();
		for (const ed of EDITIONS) {
			for (let season = 2008; season < 2034; season++) {
				const p = buildPaper(makeFixture(ed, season), undefined, { vary: false });
				for (const s of p.sections) {
					for (const a of s.articles) {
						const b = a.body[0];
						if (b?.type === "p" && b.segs.length === 1 && typeof b.segs[0] === "string") {
							const r = ruleOf(segsText(b.segs));
							if (r) {
								rules.add(r);
							}
						}
					}
				}
			}
		}
		assert.isAtLeast(rules.size, 20, [...rules].join(","));
		for (const id of ["deadline-lead", "deadline", "wire-contracts", "contracts-best", "contracts-paid", "draft-top", "ledger", "ledger-net", "drought", "franchise-wins"]) {
			assert.ok(rules.has(id), id);
		}
	});

	test("the variation pass rewrites some of the new leads", () => {
		let changed = 0;
		for (let season = 2010; season < 2030; season++) {
			const f = makeFixture("final", season);
			const a = buildPaper(f, undefined, { vary: false });
			const b = buildPaper(f);
			for (let i = 0; i < a.sections.length; i++) {
				for (let j = 0; j < a.sections[i]!.articles.length; j++) {
					const x = a.sections[i]!.articles[j]!;
					const y = b.sections[i]!.articles[j]!;
					if (DEAL_PAGE_IDS.includes(x.type ?? "") && JSON.stringify(x.body[0]) !== JSON.stringify(y.body[0])) {
						changed += 1;
					}
				}
			}
		}
		assert.isAtLeast(changed, 5);
	});

	test("a brand-new league's preseason paper has a full preview, from ratings only", () => {
		for (const season of [2005, 2006, 2011]) {
			const f = brandNew(season);
			const p = buildPaper(f);
			assert.deepStrictEqual(buildPaper(brandNew(season)), p);
			const text = paperText(p);
			assert.notMatch(text, BAD);
			const t = types(p);
			const preview = t.filter((x) => x.startsWith("preview-"));
			assert.isAtLeast(preview.length, 4, t.join(","));
			assert.isAtLeast(p.sections.reduce((a, s) => a + s.articles.length, 0), 15);
			// Facts only: no results claimed
			assert.notMatch(text, /\b(won|beat|defeated) the \d{4}\b|champions? in \d{4}/);
		}
	});

	test("unfinished editions say nothing about a lottery or draft that has not happened", () => {
		for (const ed of ["preseason", "midseason", "playoffs"] as const) {
			const t = types(buildPaper(makeFixture(ed, 2025)));
			assert.notInclude(t, "lottery-night");
			assert.notInclude(t, "draft-night");
		}
	});
});
