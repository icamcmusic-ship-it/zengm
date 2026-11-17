// archv2: every word of a composed name is a yes/no test against players at his position. A concept's test is the
// rulebook's (rulebook.data.ts): its skill classes in the top X% of his position's players (lead bar for the role, support
// bar for a descriptor), the sub-rating leans and play-type shares it names when he has them, the Sniper and High-Flying
// words' raised bars, and the promise floor every name keeps (score.ts PROMISE_MET), so a name never says what he lacks.
import { FLOOR, PT_MIN_W, RULES, WORD_RULES } from "../rulebook.data.ts";
import { pctOf, SKILL_CLASS_KEYS } from "../rulebook.ts";
import type { StyleReading } from "../subStyle.ts";
import type { PosBucket } from "../types.ts";
import { PEER_QUANTILES } from "./peers.data.ts";

export type WordContext = {
	cv: Record<string, number>;
	style: StyleReading;
	bucket: PosBucket;
	// His standing at his position per dimension (score.ts pz), for the custom tests
	pz: Record<string, number>;
	// His three best skill classes, by percentile among his position's players
	top3: string[];
	// archv3: his box score's standing at his position (stats.ts StatReading z), when he has minutes
	statZ?: Partial<Record<string, number>>;
};

// His percentile (0-1) among players at his position in a class (the pooled rulebook table when the class has no
// position table)
export const peerPct = (bucket: PosBucket, cls: string, x: number): number => {
	const q = PEER_QUANTILES[bucket]?.[cls];
	if (!q) {
		return pctOf(cls, x);
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

export const topSkills = (
	bucket: PosBucket,
	cv: Record<string, number>,
	n = 3,
): string[] =>
	[...SKILL_CLASS_KEYS]
		.sort(
			(x, y) =>
				peerPct(bucket, y, cv[y] ?? 0) - peerPct(bucket, x, cv[x] ?? 0) ||
				(x < y ? -1 : 1),
		)
		.slice(0, n);

export type WordTest = {
	pass: boolean;
	// How far above (+) or below (-) the bars he is, in percentile points (the tightest bar)
	margin: number;
};

// Custom tests for words with no rulebook class (style words made measurable)
export const CUSTOM_TESTS: Record<
	string,
	(ctx: WordContext, lead: boolean) => WordTest
> = {
	// archgaps (user-approved, scratchpad/archgaps/report.md): Glue Wing / Glue Guard: perimeter D top 50% and his head
	// skill, two of three / passing / rebounding / rim D top 50% (guard: three or passing), 3+ of the 10 classes top 50%,
	// no class top 20%
	glueWing: (ctx) => glue(ctx, ["shoot", "pass", "reb", "rimD"], 2),
	glueGuard: (ctx) => glue(ctx, ["shoot", "pass"], 1),
	// archv3 (the user's 2K list): Switch Defender: perimeter and rim D both top 40% at his position (one his head skill),
	// athleticism top 60%, no offensive standout
	switchD: (ctx) => {
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const margin = Math.min(
			p("perD") - 0.6,
			p("rimD") - 0.6,
			p("ath") - 0.4,
			ctx.top3.includes("perD") || ctx.top3.includes("rimD") ? 1 : -0.01,
			(ctx.cv.perD ?? 0) / 4,
			(ctx.cv.rimD ?? 0) / 4,
			// (a role player's name: no standout on offense, not carrying it; a star who also defends everywhere is read by
			// what he does with the ball)
			noStandout(ctx, ["perD", "rimD", "ath", "reb", "stre"]),
			lowUsage(ctx),
		);
		return { pass: margin >= 0, margin };
	},
	// Steady Game Manager: passing and handling top 50%, no class top 20%
	gameManagerRole: (ctx) => {
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const margin = Math.min(
			p("pass") - 0.5,
			p("handle") - 0.5,
			noStandout(ctx, ["pass", "handle"]),
			(ctx.cv.pass ?? 0) / 4,
			(ctx.cv.handle ?? 0) / 4,
		);
		return { pass: margin >= 0, margin };
	},
	// Energy Big: finishing and athleticism top 50% (one his head skill), rim D top 50%, three below top 50%, no standout
	// but finishing and athleticism
	energyRole: (ctx) => {
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const margin = Math.min(
			p("finish") - 0.5,
			p("ath") - 0.5,
			p("rimD") - 0.5,
			0.5 - p("shoot"),
			ctx.top3.includes("finish") || ctx.top3.includes("ath") ? 1 : -0.01,
			// (archv3: a role player too: no standout but finishing and athleticism, an elite rim protector is not one)
			noStandout(ctx, ["finish", "ath"]),
			(ctx.cv.finish ?? 0) / 4,
			(ctx.cv.ath ?? 0) / 4,
		);
		return { pass: margin >= 0, margin };
	},
	// Crafty: offensive feel well above his position's (and, with sub-ratings, finesse over contact)
	crafty: (ctx) => {
		const oiq = ctx.pz.oiq ?? 0;
		const con = ctx.style.sub?.con ?? 0;
		const margin = Math.min((oiq - 0.5) / 2, (0.25 - con) / 2);
		return { pass: margin >= 0, margin };
	},
};

// No standout: no class but his head skill(s) in his position's top (1 - GLUE_CAP) (archv3: was every class, the head
// included, under the top 20%: a glue guy who defended well failed his own test)
export const GLUE_CAP = 0.9;
// (and he is not a leading scorer: scoring under his position's top 20%, archv3: a star scorer with no single standout
// skill read as a Glue Guard)
export const ROLE_SCORE_CAP = 0.8;
const noStandout = (ctx: WordContext, head: readonly string[] = []) =>
	Math.min(
		ROLE_SCORE_CAP - peerPct(ctx.bucket, "score", ctx.cv.score ?? 0),
		...SKILL_CLASS_KEYS.filter((k) => !head.includes(k)).map(
			(k) => GLUE_CAP - peerPct(ctx.bucket, k, ctx.cv[k] ?? 0),
		),
	);
// (a role player does not carry the offense: his usage, when his box score says, under +0.5 z at his position)
const lowUsage = (ctx: WordContext) => {
	const u = ctx.statZ?.usg;
	return u === undefined ? Infinity : (0.5 - u) / 4;
};
const glue = (ctx: WordContext, side: string[], nSide: number): WordTest => {
	const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
	const sides = side.map((k) => p(k) - 0.5).sort((a, b) => b - a);
	const broad = SKILL_CLASS_KEYS.map((k) => p(k) - 0.5).sort((a, b) => b - a);
	const margin = Math.min(
		p("perD") - 0.5,
		ctx.top3.includes("perD") ? 1 : -0.01,
		sides[nSide - 1]!,
		broad[2]!,
		noStandout(ctx, ["perD"]),
		(ctx.cv.perD ?? 0) / 4,
		lowUsage(ctx),
	);
	return { pass: margin >= 0, margin };
};

const subOk = (
	want: Partial<Record<string, number>> | undefined,
	style: StyleReading,
) => {
	if (!want || !style.sub) {
		return Infinity;
	}
	let m = Infinity;
	for (const [k, min] of Object.entries(want)) {
		m = Math.min(m, ((style.sub as any)[k] ?? 0) - min!);
	}
	return m;
};
const ptOk = (
	want: Partial<Record<string, number>> | undefined,
	style: StyleReading,
) => {
	if (!want || !style.pt || style.pt.w < PT_MIN_W) {
		return Infinity;
	}
	let m = -Infinity;
	for (const [k, min] of Object.entries(want)) {
		m = Math.max(m, ((style.pt.f as any)[k] ?? 0) - min!);
	}
	return m;
};

// A concept's test, as the head of the name (lead) or a descriptor (support). `display`: the words shown, for the Sniper
// and High-Flying whole-word bars
export const testConcept = (
	concept: string,
	lead: boolean,
	ctx: WordContext,
	display: string,
): WordTest => {
	const custom = CUSTOM_TESTS[concept];
	if (custom) {
		return custom(ctx, lead);
	}
	const bar = RULES[concept];
	if (!bar) {
		return { pass: false, margin: -1 };
	}
	const v = (k: string) => ctx.cv[k] ?? 0;
	const pct = (k: string) => peerPct(ctx.bucket, k, v(k));
	let margin = Infinity;
	const cls = bar.classes;
	if (cls.length > 0) {
		// Every class at the support bar ...
		if (bar.support < 1) {
			for (const k of cls) {
				margin = Math.min(margin, pct(k) - (1 - bar.support));
			}
		}
		// ... and for the head one of them at the lead bar, among his three best skills
		if (lead && bar.lead < 1) {
			margin = Math.min(
				margin,
				Math.max(...cls.map((k) => pct(k) - (1 - bar.lead))),
			);
			const head = cls.filter((k) => SKILL_CLASS_KEYS.includes(k));
			if (head.length > 0 && !head.some((k) => ctx.top3.includes(k))) {
				margin = Math.min(margin, -0.01);
			}
		}
		// The promise floor every holder of the name keeps
		for (const k of cls) {
			margin = Math.min(margin, (v(k) - FLOOR) / 4);
		}
	}
	margin = Math.min(margin, subOk(bar.sub, ctx.style) / 4);
	margin = Math.min(margin, ptOk(bar.pt, ctx.style) / 4);
	if (WORD_RULES.sniper.re.test(display)) {
		const s = WORD_RULES.sniper;
		margin = Math.min(
			margin,
			pct(s.cls) - (1 - s.bar),
			(v(s.cls) - s.floor) / 4,
			subOk(s.sub, ctx.style) / 4,
		);
	}
	if (WORD_RULES.air.re.test(display)) {
		const s = WORD_RULES.air;
		margin = Math.min(
			margin,
			pct(s.cls) - (1 - s.bar),
			subOk(s.sub, ctx.style) / 4,
		);
	}
	if (margin === Infinity) {
		margin = 0;
	}
	return { pass: margin >= 0, margin };
};
