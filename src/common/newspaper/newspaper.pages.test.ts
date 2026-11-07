import { assert, describe, test } from "vitest";
import { makeFixture } from "./fixture.ts";
import { buildPaper, paperText } from "./index.ts";
import { PAGES } from "./kit.ts";
import { segsText } from "./text.ts";
import { varyStats } from "./vary.ts";
import type { EditionId, NewsFacts, Paper } from "./types.ts";

const EDITIONS: EditionId[] = ["preseason", "midseason", "playoffs", "final"];
const BAD = /undefined|NaN|\[object|Infinity|\bnull\b|\bNaN\b/;

// The sentences a reader would notice repeating: headlines, decks and running text, not table cells or headings
const sentences = (paper: Paper) => {
	const out: string[] = [];
	for (const s of paper.sections) {
		for (const a of s.articles) {
			out.push(a.head, a.deck ? segsText(a.deck) : "");
			for (const b of a.body) {
				if (b.type === "p" || b.type === "aside") {
					out.push(segsText(b.segs));
				} else if (b.type === "list") {
					out.push(...b.items.map(segsText));
				} else if (b.type === "notebook") {
					out.push(...b.items.map((x) => `${x.lead} ${segsText(x.segs)}`));
				} else if (b.type === "quote") {
					out.push(b.text);
				}
			}
		}
	}
	return out
		.flatMap((line) => line.split(/(?<=[!.?])\s+/))
		.map((x) => x.trim())
		.filter((x) => x.length >= 25);
};

const types = (paper: Paper) =>
	paper.sections.flatMap((s) => s.articles.map((a) => a.type ?? a.id));

describe("back pages", () => {
	for (const edition of EDITIONS) {
		test(`${edition}: deterministic, no bad text, all teams`, () => {
			for (const season of [2018, 2021, 2025, 2031]) {
				const facts = makeFixture(edition, season);
				const a = buildPaper(facts);
				const b = buildPaper(makeFixture(edition, season));
				assert.deepStrictEqual(a, b);
				assert.notMatch(paperText(a), BAD, `${edition} ${season}`);
				for (const tid of [0, 3, 11]) {
					const team = buildPaper(facts, tid);
					assert.notMatch(paperText(team), BAD, `${edition} ${season} team ${tid}`);
					assert.strictEqual(team.tid, tid);
				}
			}
		});
	}

	test("at least 60 distinct page types across the editions", () => {
		const all = new Set<string>();
		for (const edition of EDITIONS) {
			for (let season = 2018; season < 2034; season++) {
				for (const t of types(buildPaper(makeFixture(edition, season)))) {
					all.add(t);
				}
			}
		}
		const pageTypes = PAGES.map((p) => p.id);
		const used = pageTypes.filter((id) => all.has(id));
		assert.isAtLeast(PAGES.length, 60, "registered page types");
		assert.isAtLeast(used.length, 60, `page types used: ${used.length}`);
		// The champion story, the six features and the champion arcs on top
		for (const f of ["feature-mvp", "feature-best", "feature-feat", "feature-break", "feature-trade", "feature-pick"]) {
			assert.ok(all.has(f), `feature ${f}`);
		}
		const champ = [...all].filter((t) => t.startsWith("champion-"));
		assert.isAtLeast(champ.length, 3, `champion arcs: ${champ.join(",")}`);
	});

	test("unfinished editions claim no outcome", () => {
		const claims = /(are champions|were champions|The ballots|Most Valuable Player\. |(2022|2025|2029) (title|championship|MVP)|won the (2022|2025|2029))/;
		for (const edition of ["preseason", "midseason", "playoffs"] as const) {
			for (const season of [2022, 2025, 2029]) {
				const text = paperText(buildPaper(makeFixture(edition, season)));
				const m = text.match(claims);
				assert.isNull(m, `${edition} ${season}: ${m ? text.slice(Math.max(0, m.index! - 80), m.index! + 80) : ""}`);
			}
		}
	});

	test("present tense while the season is on", () => {
		for (const edition of ["midseason"] as const) {
			const text = paperText(buildPaper(makeFixture(edition, 2025)));
			assert.notMatch(text, /\b(ended the season|capped a|finished the season)\b/);
		}
	});

	test("missing optional facts never print as zero or crash", () => {
		for (const edition of EDITIONS) {
			const f: NewsFacts = makeFixture(edition, 2025);
			const bare: NewsFacts = {
				...f,
				teams: f.teams.map((t) => ({
					...t,
					hist: undefined,
					close: undefined,
					ot: undefined,
					bestStreak: undefined,
					worstStreak: undefined,
					payroll: undefined,
					pts: undefined,
					oppPts: undefined,
				})),
				players: f.players.map((p) => ({
					...p,
					gs: undefined,
					ftp: undefined,
					tov: undefined,
					pf: undefined,
					orb: undefined,
					pm: undefined,
					dd: undefined,
					td: undefined,
					g30: undefined,
					g40: undefined,
					hi: undefined,
					boxGp: undefined,
					career: undefined,
					honors: undefined,
					contractAmount: undefined,
					contractExp: undefined,
				})),
				champions: undefined,
				mvps: undefined,
				h2h: undefined,
				prevPairs: undefined,
				draftRetro: undefined,
				then: undefined,
				careerBoard: undefined,
				wire: undefined,
				divs: undefined,
				numPlayoffTeams: undefined,
				salaryCap: undefined,
			};
			const paper = buildPaper(bare);
			assert.notMatch(paperText(paper), BAD, edition);
			assert.isAbove(paper.sections.length, 0);
			const team = buildPaper(bare, 2);
			assert.notMatch(paperText(team), BAD, `${edition} team`);
		}
	});

	test("the variation pass has rules and a seeded choice", () => {
		const s = varyStats();
		assert.isAtLeast(s.rules, 30);
		assert.isAtLeast(s.alts, 90);
		// Same league, same season, same words
		const a = paperText(buildPaper(makeFixture("midseason", 2025)));
		const b = paperText(buildPaper(makeFixture("midseason", 2025)));
		assert.strictEqual(a, b);
	});

	test("repetition cap: few sentences repeat across seasons", () => {
		for (const edition of ["midseason", "final", "preseason"] as const) {
			const seen = new Set<string>();
			let repeated = 0;
			let total = 0;
			const worst = new Map<string, number>();
			for (let season = 2020; season < 2034; season++) {
				const paper = buildPaper(makeFixture(edition, season));
				const mine = sentences(paper);
				if (season > 2020) {
					for (const s of mine) {
						total += 1;
						if (seen.has(s)) {
							repeated += 1;
							worst.set(s, (worst.get(s) ?? 0) + 1);
						}
					}
				}
				for (const s of mine) {
					seen.add(s);
				}
			}
			const share = repeated / total;
			const top = [...worst.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 30);
			assert.isBelow(
				share,
				0.03,
				`${edition}: ${(share * 100).toFixed(1)}% repeated\n${top.map(([s, n]) => `${n}x ${s}`).join("\n")}`,
			);
		}
	});

	test("every section has an opening article", () => {
		for (const edition of EDITIONS) {
			const paper = buildPaper(makeFixture(edition, 2026));
			for (const s of paper.sections) {
				assert.isAbove(s.articles.length, 0, `${edition} ${s.id}`);
				for (const a of s.articles) {
					assert.isAbove(a.body.length, 0, `${edition} ${a.id}`);
				}
			}
		}
	});
});
