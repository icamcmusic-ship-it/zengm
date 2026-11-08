// What the deck viewer shows: the planned slides with the quiz round woven in and, for "no spoilers", the champion held back until the end.
import { planDeck } from "./deck.ts";
import type { Slide, WrappedMode } from "./types.ts";

const TITLE_WORDS =
	/\b(champion(s|ship)?|title|titles|finals|won it all|ring|rings|banner|crowned)\b/i;

const clean = (x: string) => x.replace(/\s+/g, " ").trim();

const escapeRe = (s: string) =>
	s.replace(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

// Does the text talk about a title or the finals and name one of these names?
export const spoilerText = (text: string, names: readonly string[]) => {
	const t = clean(text);
	if (!t || !TITLE_WORDS.test(t)) {
		return false;
	}
	for (const n0 of names) {
		const n = clean(n0);
		if (n.length < 3) {
			continue;
		}
		const re = new RegExp(
			String.raw`(^|[^\p{L}\p{N}])${escapeRe(n)}($|[^\p{L}\p{N}])`,
			"u",
		);
		if (re.test(t)) {
			return true;
		}
	}
	return false;
};

export const slideTexts = (s: Slide) => [
	s.kicker,
	...s.heads,
	...s.lines,
	s.hero?.text ?? "",
	s.hero?.unit ?? "",
	...(s.list ?? []).flatMap((r) => [r.name, r.value, r.sub ?? ""]),
];

// Slides that are held back by "no spoilers" even without a name in the text
const SPOIL_CORE: Record<WrappedMode, string[]> = {
	season: ["champ"],
	team: [],
	player: [],
	all: [],
};

export type ItemOptions = {
	quiz: boolean;
	noSpoil: boolean;
};

// How many quiz questions fit in a deck of this size
export const quizCount = (n: number, available: number) =>
	Math.min(available, n >= 20 ? 4 : n >= 14 ? 3 : n >= 10 ? 2 : n >= 8 ? 1 : 0);

export const planItems = (
	cands: Slide[],
	mode: WrappedMode,
	n: number,
	seed: string,
	o: ItemOptions,
): Slide[] => {
	const quizzes = cands.filter((s) => s.quiz);
	const rest = cands.filter((s) => !s.quiz);
	const nq = o.quiz ? quizCount(n, quizzes.length) : 0;
	// The quiz round takes its questions and a score slide out of the deck's room
	const room = n - nq - (nq > 0 ? 1 : 0);
	const deck = planDeck(rest, mode, Math.max(room, 6), seed);
	const summary = deck.at(-1)?.id === "summary" ? deck.pop() : undefined;
	let body = deck;
	let held: Slide[] = [];
	if (o.noSpoil) {
		held = body.filter(
			(s) => SPOIL_CORE[mode].includes(s.id) || s.spoiler === true,
		);
		body = body.filter((s) => !held.includes(s));
	}
	const out = [...body];
	if (nq > 0) {
		const at = Math.ceil(out.length / 2);
		const picked = quizzes.slice(0, nq).map((s, i) => ({
			...s,
			id: `quiz${i + 1}`,
			kicker: nq > 1 ? `Quiz · ${i + 1} of ${nq}` : "Quiz time",
		}));
		out.splice(at, 0, ...picked);
		out.push({
			id: "quizscore",
			group: "quiz",
			theme: "quiz",
			score: 0,
			core: true,
			kicker: "Quiz score",
			heads: ["How did you do?"],
			head: "How did you do?",
			lines: [],
		});
	}
	out.push(...held);
	if (summary) {
		out.push(summary);
	}
	return out;
};
