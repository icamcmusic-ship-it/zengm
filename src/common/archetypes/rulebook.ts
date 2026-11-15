// archrules: the rule-based judge. Deterministic: from a player's blended class reading (score.ts classValues), his
// sub-rating and play-type features (subStyle.ts) and the builds his position allows, the 1-3 builds the rulebook
// (rulebook.data.ts, docs/archetype-rulebook.md) accepts for him, best first.
import { isGenericBuild } from "./generic.ts";
import {
	ALL_AROUND_MIN,
	ALL_AROUND_N,
	HEAD_TOP_N,
	MAX_ACCEPT,
	NEAREST_GAP,
	PT_MIN_W,
	RULES,
	WORD_RULES,
	type Bar,
} from "./rulebook.data.ts";
import { CV_QUANTILES } from "./ruleQuantiles.data.ts";
import type { StyleReading } from "./subStyle.ts";
import { conceptsOf } from "./twoK/concepts.ts";
import type { Archetype } from "./types.ts";

// The ten skill classes a player's best skills are ranked on
export const SKILL_CLASS_KEYS = [
	"shoot",
	"mid",
	"finish",
	"post",
	"handle",
	"pass",
	"reb",
	"rimD",
	"perD",
	"ath",
];

// A build's words under the rulebook: each word with a bar, and its head (the last one that is not a modifier)
export type BuildRules = {
	words: { key: string; bar: Bar; head: boolean }[];
	sniper: boolean;
	air: boolean;
	// Words with a measurable promise (the build's specificity)
	specificity: number;
	headClasses: string[];
};
const cache = new WeakMap<Archetype, BuildRules>();
export const buildRules = (a: Archetype): BuildRules => {
	let out = cache.get(a);
	if (!out) {
		const cs = conceptsOf(a.name).filter(
			(c) => (RULES[c.key]?.classes.length ?? 0) > 0,
		);
		// (as score.ts promisesOf: "Scorer" leads only when nothing else is named)
		const named = cs.filter((c) => c.key !== "scorer");
		const head = named.length > 0 ? named.at(-1) : cs.at(-1);
		const words = cs.map((c) => ({
			key: c.key,
			bar: RULES[c.key]!,
			head: c === head,
		}));
		out = {
			words,
			sniper: WORD_RULES.sniper.re.test(a.name),
			air: WORD_RULES.air.re.test(a.name),
			specificity: new Set(named.map((c) => c.key)).size,
			headClasses: head ? RULES[head.key]!.classes : [],
		};
		cache.set(a, out);
	}
	return out;
};

// His percentile (0-1) in a class
export const pctOf = (cls: string, x: number): number => {
	const q = CV_QUANTILES[cls];
	if (!q) {
		return 0.5;
	}
	if (x <= q[0]!) {
		return 0;
	}
	for (let i = 1; i < q.length; i++) {
		if (x <= q[i]!) {
			return (
				(i - 1 + (x - q[i - 1]!) / Math.max(1e-9, q[i]! - q[i - 1]!)) /
				(q.length - 1)
			);
		}
	}
	return 1;
};
// His skill classes, best (highest percentile) first
export const skillOrder = (cv: Record<string, number>): string[] =>
	[...SKILL_CLASS_KEYS].sort(
		(x, y) => pctOf(y, cv[y] ?? 0) - pctOf(x, cv[x] ?? 0) || (x < y ? -1 : 1),
	);

// The classes a build's name requires under the rulebook (the consistency test compares them with score.ts promisesOf)
export const requiredClasses = (a: Archetype): string[] => [
	...new Set(buildRules(a).words.flatMap((w) => w.bar.classes)),
];

// The blended value at which a player is in the top `top` fraction for a class (1: no bar)
export const barValue = (cls: string, top: number): number => {
	const q = CV_QUANTILES[cls];
	if (!q || top >= 1) {
		return -Infinity;
	}
	const x = (1 - top) * (q.length - 1);
	const i = Math.min(q.length - 2, Math.floor(x));
	return q[i]! + (x - i) * (q[i + 1]! - q[i]!);
};

export type RuleInput = {
	cv: Record<string, number>;
	style?: StyleReading;
};

const subShort = (
	want: Partial<Record<string, number>> | undefined,
	style: StyleReading | undefined,
) => {
	if (!want || !style?.sub) {
		return 0;
	}
	let t = 0;
	for (const [k, min] of Object.entries(want)) {
		t += Math.max(0, min! - ((style.sub as any)[k] ?? 0));
	}
	return t;
};
const ptShort = (
	want: Partial<Record<string, number>> | undefined,
	style: StyleReading | undefined,
) => {
	if (!want || !style?.pt || style.pt.w < PT_MIN_W) {
		return 0;
	}
	// (any one of the play types is enough)
	let best = Infinity;
	for (const [k, min] of Object.entries(want)) {
		best = Math.min(best, Math.max(0, min! - ((style.pt.f as any)[k] ?? 0)));
	}
	return best === Infinity ? 0 : best;
};

// How far he is from every bar of the build (z summed; 0 = qualifies), and how far above them he is
export const ruleShortfall = (
	a: Archetype,
	inp: RuleInput,
): { short: number; margin: number } => {
	const r = buildRules(a);
	const v = (k: string) => inp.cv[k] ?? 0;
	let short = 0;
	let margin = 0;
	for (const w of r.words) {
		const cls = w.bar.classes;
		// Every class at the supporting bar ...
		for (const k of cls) {
			const b = barValue(k, w.bar.support);
			if (b > -Infinity) {
				short += Math.max(0, b - v(k));
				margin += Math.max(0, v(k) - b);
			}
		}
		// ... and for the head word one of them at the lead bar
		if (w.head) {
			short += Math.min(
				...cls.map((k) => Math.max(0, barValue(k, w.bar.lead) - v(k))),
			);
		}
		short += subShort(w.bar.sub, inp.style);
		short += ptShort(w.bar.pt, inp.style);
	}
	if (r.sniper) {
		const s = WORD_RULES.sniper;
		short +=
			Math.max(0, barValue(s.cls, s.bar) - v(s.cls)) +
			subShort(s.sub, inp.style);
	}
	if (r.air) {
		const s = WORD_RULES.air;
		short +=
			Math.max(0, barValue(s.cls, s.bar) - v(s.cls)) +
			subShort(s.sub, inp.style);
	}
	// What the build is first of all must be among his best skills (ranked by percentile, so classes that run high for
	// everyone do not crowd out the rest)
	const top = skillOrder(inp.cv).slice(0, HEAD_TOP_N);
	const headSkill = r.headClasses.filter((k) => SKILL_CLASS_KEYS.includes(k));
	if (headSkill.length > 0 && !headSkill.some((k) => top.includes(k))) {
		const third = pctOf(top.at(-1)!, v(top.at(-1)!));
		short += Math.min(
			...headSkill.map((k) => Math.max(0.01, (third - pctOf(k, v(k))) * 2)),
		);
	}
	// A generic build: only for a genuinely all-around player
	if (isGenericBuild(a) || a.tags.includes("allAround")) {
		const n = SKILL_CLASS_KEYS.filter(
			(k) => v(k) >= barValue(k, ALL_AROUND_MIN),
		).length;
		if (n < ALL_AROUND_N) {
			short += 0.25 * (ALL_AROUND_N - n);
		}
	}
	return { short, margin };
};

export type RuleVerdict = { ids: string[]; qualified: boolean };

// The builds the rulebook accepts: every qualifying build ranked by (1) specific before generic, (2) coverage: how many of
// his three best skill classes the build's words name, (3) family priority: the build whose head word is his best skill
// first (the rank of the head's class in his skills), (4) specificity (more measurable words), (5) margin above the bars,
// (6) id. With none
// qualifying: the nearest specific build (least shortfall), and those within NEAREST_GAP of it; never a generic build.
export const ruleJudge = (
	builds: readonly Archetype[],
	inp: RuleInput,
): RuleVerdict => {
	const order = skillOrder(inp.cv);
	const top3 = order.slice(0, HEAD_TOP_N);
	// (a head with no skill class, "2-Way" or "Bully", ranks after every skill head)
	const headRank = (a: Archetype) =>
		Math.min(
			SKILL_CLASS_KEYS.length,
			...buildRules(a)
				.headClasses.map((k) => order.indexOf(k))
				.filter((i) => i >= 0),
		);
	const seen = new Set<string>();
	const rows = [];
	for (const a of builds) {
		if (seen.has(a.id)) {
			continue;
		}
		seen.add(a.id);
		const generic = isGenericBuild(a);
		const { short, margin } = ruleShortfall(a, inp);
		rows.push({
			a,
			generic,
			short,
			margin,
			spec: buildRules(a).specificity,
			fam: headRank(a),
			cover: requiredClasses(a).filter((k) => top3.includes(k)).length,
		});
	}
	const ok = rows.filter((r) => r.short <= 1e-9);
	if (ok.length > 0) {
		ok.sort(
			(x, y) =>
				Number(x.generic) - Number(y.generic) ||
				y.cover - x.cover ||
				x.fam - y.fam ||
				y.spec - x.spec ||
				y.margin - x.margin ||
				(x.a.id < y.a.id ? -1 : 1),
		);
		return { ids: ok.slice(0, MAX_ACCEPT).map((r) => r.a.id), qualified: true };
	}
	const spec = rows.filter((r) => !r.generic);
	spec.sort(
		(x, y) =>
			x.short - y.short ||
			x.fam - y.fam ||
			y.margin - x.margin ||
			(x.a.id < y.a.id ? -1 : 1),
	);
	const best = spec[0]?.short ?? 0;
	return {
		ids: spec
			.filter((r) => r.short <= best + NEAREST_GAP)
			.slice(0, MAX_ACCEPT)
			.map((r) => r.a.id),
		qualified: false,
	};
};
