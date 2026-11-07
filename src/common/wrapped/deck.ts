// Deck planning: which slides a Wrapped shows and in what order. Pure, so it's covered by tests.
//
// Every mode has a few core slides that always come first when their data exists, in a fixed order, and a summary that closes the deck. The rest are ranked by score (0..1, how unusual the finding is) after a small seeded jitter, so two seasons rarely get the same deck but the same season always does. Picks never repeat a fact, take at most PER_GROUP slides from one topic group and at most a third of the deck from one theme, and every theme with a memorable candidate gets a slot.

import type { Slide, WrappedMode } from "./types.ts";
import { isBadText, pickBy, polish, seededRng } from "./util.ts";

export const CORE: Record<WrappedMode, string[]> = {
	season: ["intro", "champ", "mvp", "standings", "game"],
	team: ["intro", "record", "path", "star", "game"],
	player: ["intro", "line", "awards", "rank", "game"],
	all: ["intro", "goat", "dynasty", "team", "titles"],
};

export const DECK_MAX = 30;
export const DECK_DEFAULT = 16;
const MIN_SCORE = 0.15;
const PER_GROUP = 2;
const JITTER = 0.08;
const MEMORABLE = 0.35;

export const clampCount = (n: unknown, mode: WrappedMode) => {
	const min = CORE[mode].length + 1;
	const v = typeof n === "string" && n.trim() !== "" ? Number(n) : n;
	if (typeof v !== "number" || !Number.isFinite(v)) {
		return Math.max(min, DECK_DEFAULT);
	}
	return Math.max(min, Math.min(DECK_MAX, Math.round(v)));
};

const norm = (t: string) =>
	t
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

export const factsOf = (s: Slide) => {
	const out = [`id:${s.id}`, ...(s.facts ?? [])];
	if (s.hero) {
		out.push(`hero:${norm(s.hero.text)}|${norm(s.hero.unit ?? "")}|${s.pid ?? s.tid ?? ""}`);
	}
	return out;
};

// A slide is shown only if all its text is clean
export const isClean = (s: Slide) => {
	const texts = [
		s.kicker,
		...s.heads,
		...s.lines,
		s.hero?.text ?? "",
		s.hero?.unit ?? "",
		...(s.chips ?? []).flat(),
		...(s.list ?? []).flatMap((r) => [r.name, r.value, r.sub ?? ""]),
	];
	return s.heads.length > 0 && !texts.some(isBadText);
};

type Ranked = { s: Slide; v: number };

// Pick up to `room` slides from candidates, best first, with the variety rules
export const choose = (
	cands: Slide[],
	room: number,
	seed: string,
	used: Set<string> = new Set(),
) => {
	const rng = seededRng(`choose|${seed}`);
	const ranked: Ranked[] = cands
		.filter((s) => s.score >= MIN_SCORE)
		.map((s) => ({ s, v: s.score + rng() * JITTER }))
		.sort((a, b) => b.v - a.v || (a.s.id < b.s.id ? -1 : 1));
	const themeCap = Math.max(2, Math.ceil(room / 3));
	const picks: Ranked[] = [];
	const groups = new Map<string, number>();
	const themes = new Map<string, number>();
	const taken = new Set(used);
	const fits = (r: Ranked, ignoreTheme = false) =>
		(groups.get(r.s.group) ?? 0) < PER_GROUP &&
		(ignoreTheme || (themes.get(r.s.theme) ?? 0) < themeCap) &&
		!factsOf(r.s).some((f) => taken.has(f));
	const add = (r: Ranked) => {
		picks.push(r);
		groups.set(r.s.group, (groups.get(r.s.group) ?? 0) + 1);
		themes.set(r.s.theme, (themes.get(r.s.theme) ?? 0) + 1);
		for (const f of factsOf(r.s)) {
			taken.add(f);
		}
	};
	for (const r of ranked) {
		if (picks.length >= room) {
			break;
		}
		if (fits(r)) {
			add(r);
		}
	}

	// Variety: a theme with a memorable candidate but no slot takes the place of the weakest pick of the most common theme
	const missing = new Set<string>();
	for (const r of ranked) {
		if (r.s.score >= MEMORABLE && !themes.has(r.s.theme)) {
			missing.add(r.s.theme);
		}
	}
	for (const theme of missing) {
		const r = ranked.find((x) => x.s.theme === theme && !picks.includes(x));
		if (!r || !fits(r, true)) {
			continue;
		}
		if (picks.length < room) {
			add(r);
			continue;
		}
		let most: string | undefined;
		let mostN = 1;
		for (const [t, n] of themes) {
			if (n > mostN) {
				most = t;
				mostN = n;
			}
		}
		if (most === undefined) {
			continue;
		}
		const weakest = picks.findLast((x) => x.s.theme === most);
		if (!weakest) {
			continue;
		}
		picks.splice(picks.indexOf(weakest), 1);
		groups.set(weakest.s.group, (groups.get(weakest.s.group) ?? 1) - 1);
		themes.set(most, mostN - 1);
		add(r);
	}
	return picks.map((r) => r.s);
};

// Order picks so that two slides of the same theme rarely sit next to each other, keeping best-first otherwise
export const spread = (list: Slide[]) => {
	const rest = [...list];
	const out: Slide[] = [];
	while (rest.length > 0) {
		const prev = out.at(-1)?.theme;
		let i = rest.findIndex((s) => s.theme !== prev);
		if (i < 0) {
			i = 0;
		}
		out.push(rest.splice(i, 1)[0]!);
	}
	return out;
};

const finish = (s: Slide, seed: string): Slide => {
	const head = polish(pickBy(`${seed}|head|${s.id}`, s.heads));
	return {
		...s,
		head,
		kicker: polish(s.kicker),
		lines: s.lines.filter((l) => l !== "").map(polish),
	};
};

export const planDeck = (
	cands: Slide[],
	mode: WrappedMode,
	n: unknown,
	seed: string,
) => {
	const N = clampCount(n, mode);
	const clean = cands.filter(isClean);
	const core: Slide[] = [];
	const used = new Set<string>();
	for (const id of CORE[mode]) {
		const s = clean.find((x) => x.id === id);
		if (s) {
			core.push(s);
			for (const f of factsOf(s)) {
				used.add(f);
			}
		}
	}
	const summary = clean.find((x) => x.id === "summary");
	const rest = clean.filter(
		(x) => !core.includes(x) && x !== summary && !x.core,
	);
	const room = Math.max(0, N - core.length - (summary ? 1 : 0));
	const picks = spread(choose(rest, room, seed, used));
	const out = [...core, ...picks];
	if (summary) {
		out.push(summary);
	}
	return out.map((s) => finish(s, seed));
};
