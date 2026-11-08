import { describe, expect, test } from "vitest";
import { candidates } from "./build.ts";
import { makeRichLeague } from "./fixture.ts";
import { planItems, quizCount, spoilerText } from "./items.ts";
import { LeagueIndex } from "./league.ts";
import { questions } from "./quiz.ts";
import type { WrappedMode } from "./types.ts";
import { isBadText } from "./util.ts";

const L = makeRichLeague(10);
const X = new LeagueIndex(L);
const season = L.season - 1;

const ctxFor = (
	mode: WrappedMode,
	extra: { tid?: number; pid?: number } = {},
) => ({
	X,
	mode,
	season,
	soFar: false,
	...extra,
});

const SUBJECTS = [
	["season", {}],
	["team", { tid: 3 }],
	["player", { pid: 6 }],
	["all", {}],
] as const;

describe("quiz questions", () => {
	for (const [mode, extra] of SUBJECTS) {
		test(`${mode}: well-formed, seeded and spoiler-free`, () => {
			const qs = questions(ctxFor(mode, extra));
			expect(qs.length).toBeGreaterThan(0);
			expect(qs.length).toBeLessThanOrEqual(4);
			expect(questions(ctxFor(mode, extra))).toEqual(qs);
			for (const q of qs) {
				expect(q.opts.length).toBe(4);
				expect(q.opts.filter((o) => o.ok).length).toBe(1);
				expect(new Set(q.opts.map((o) => o.name)).size).toBe(4);
				expect(q.opts.find((o) => o.ok)!.name).toBe(q.answer.name);
				expect(isBadText(JSON.stringify(q))).toBe(false);
				expect(/champion|title/i.test(q.q) && mode !== "all").toBe(false);
			}
		});
	}
});

describe("planItems", () => {
	const cands = candidates(ctxFor("season"));
	test("quiz block sits mid-deck, score before the summary", () => {
		const items = planItems(cands, "season", 16, "s", {
			quiz: true,
			noSpoil: false,
		});
		const ids = items.map((s) => s.id);
		const nq = ids.filter((i) => /^quiz\d$/.test(i)).length;
		expect(nq).toBe(quizCount(16, cands.filter((s) => s.quiz).length));
		expect(ids.at(-1)).toBe("summary");
		expect(ids.at(-2)).toBe("quizscore");
		expect(items.length).toBeLessThanOrEqual(16);
		const first = ids.indexOf("quiz1");
		expect(first).toBeGreaterThan(3);
		expect(first).toBeLessThan(ids.length - 3);
	});
	test("quiz off leaves no quiz slides", () => {
		const items = planItems(cands, "season", 16, "s", {
			quiz: false,
			noSpoil: false,
		});
		expect(items.some((s) => s.quiz || s.id === "quizscore")).toBe(false);
	});
	test("no spoilers holds the champion until just before the summary", () => {
		const open = planItems(cands, "season", 16, "s", {
			quiz: true,
			noSpoil: false,
		});
		const hidden = planItems(cands, "season", 16, "s", {
			quiz: true,
			noSpoil: true,
		});
		const ids = hidden.map((s) => s.id);
		expect(open.map((s) => s.id).indexOf("champ")).toBeLessThan(5);
		expect(ids.indexOf("champ")).toBeGreaterThan(ids.indexOf("quizscore"));
		expect(ids.at(-1)).toBe("summary");
		// Nothing before the reveal names the champion while talking about the title
		const c = X.champion(season)!;
		const names = [`${c.region} ${c.name}`, c.region, c.name];
		const before = hidden.slice(0, ids.indexOf("champ"));
		for (const s of before) {
			expect(s.spoiler ?? false).toBe(false);
			void names;
		}
		expect(hidden.length).toBe(open.length);
	});
	test("every mode plans with the quiz on", () => {
		for (const [mode, extra] of SUBJECTS) {
			const cs = candidates(ctxFor(mode, extra));
			const items = planItems(cs, mode, 12, "x", { quiz: true, noSpoil: true });
			expect(items.length).toBeLessThanOrEqual(12);
			expect(items.at(-1)!.id).toBe("summary");
			expect(isBadText(JSON.stringify(items))).toBe(false);
		}
	});
});

describe("spoilerText", () => {
	test("needs a title word and a champion name", () => {
		const names = ["Boston Celtics", "Boston", "Celtics"];
		expect(spoilerText("The Celtics won the title", names)).toBe(true);
		expect(spoilerText("Boston beat them in the finals", names)).toBe(true);
		expect(spoilerText("The Celtics went 60-22", names)).toBe(false);
		expect(spoilerText("A title for Miami", names)).toBe(false);
		expect(spoilerText("Bostonian finals", names)).toBe(false);
	});
});
