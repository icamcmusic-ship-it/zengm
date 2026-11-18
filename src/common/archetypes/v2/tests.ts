// archv2: every word of a composed name is a yes/no test against players at his position. A concept's test is the
// rulebook's (rulebook.data.ts): its skill classes in the top X% of his position's players (lead bar for the role, support
// bar for a descriptor), the sub-rating leans and play-type shares it names when he has them, the Sniper and High-Flying
// words' raised bars, and the promise floor every name keeps (score.ts PROMISE_MET), so a name never says what he lacks.
import { FLOOR, PT_MIN_W, RULES, WORD_RULES } from "../rulebook.data.ts";
import { pctOf, SKILL_CLASS_KEYS } from "../rulebook.ts";
import type { StyleReading } from "../subStyle.ts";
import type { ArchetypeRatings, PosBucket } from "../types.ts";
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
	// archv4: whether he is a draft prospect (the Raw Athletic Handler is a prospect's name)
	prospect?: boolean;
	// archv5: his ratings themselves (the absolute tests: the user's labels read skills in absolute terms) and his age
	r?: ArchetypeRatings;
	age?: number;
	// (the low-ovr test's cap and one-tool age, engine.ts V2Params lowCap / lowYoung)
	lowCap?: number;
	lowYoung?: number;
	toolCap?: number;
	toolMin?: number;
	// (hysteresis on the absolute tests: for last season's label, every rating bar is relaxed by this many points and the
	// age bars by two years; engine.ts V2Params absBand)
	band?: number;
};

// ---- archv5: absolute tests (the user's labels of the archcmp sample: "41 3PT is way too low for Stretch", "52 3PT too
// low for true 3&D", "no rating above 52 ... Prospect") ----

// Absolute floors on the words of a name (a build's, a 2K alias's or a composed one): every holder of the word has at
// least this rating, whatever his standing at his position. Calibrated on the user's labels and the user's 2K list
// (scratchpad archv5/floors.txt).
export const ABS_FLOORS: {
	key: string;
	re: RegExp;
	rating: "tp";
	min: number;
}[] = [
	// (a big who spaces the floor)
	{ key: "stretch", re: /Stretch|Popper|Pick & Pop/, rating: "tp", min: 45 },
	// (an elite shooter's words: rulebook.data.ts WORD_RULES.sniper)
	{
		key: "sniper",
		re: /Snip|Sharp|Laser|Automatic|Logo|Big Range|Silk/,
		rating: "tp",
		min: 55,
	},
	// (a true 3-and-D player)
	{ key: "threeD", re: /3 & D/, rating: "tp", min: 53 },
	// (the other shooting words)
	{
		key: "threePt",
		re: /3PT|Catch & Shoot|Off-Screen|Splash|Shooter\b|Gunner|Bomber/,
		rating: "tp",
		min: 50,
	},
];
// (a Paint Beast or an Interior Force is not a rim protector or a rebounder first of all: his shot blocking and rebounding
// stand below ANCHOR_PZ at his position (z: Gobert, Mutombo, Howard keep their anchor and glass names))
export const ANCHOR_PZ = 1;
const notAnchor = (ctx: WordContext) =>
	Math.min(1, (ANCHOR_PZ - Math.max(ctx.pz.blk ?? 0, ctx.pz.reb ?? 0)) / 2);
// (a Paint Beast's jumper: at most these)
export const PAINT_BEAST_TP = 35;
export const PAINT_BEAST_FG = 45;
// How far below the absolute floors of its words a name is for him (0: every floor kept)
export const floorMiss = (
	name: string,
	r: ArchetypeRatings | undefined,
	band = 0,
): number => {
	if (!r) {
		return 0;
	}
	let m = 0;
	for (const f of ABS_FLOORS) {
		if (f.re.test(name)) {
			m = Math.max(m, f.min - band - (r[f.rating] ?? 0));
		}
	}
	return m;
};

// The low-ovr label (the user: "no rating above 52 ... Prospect", "Glass-Cleaning Prospect"): no skill good in absolute
// terms. His skill ratings (not size or the physical ones) are all at most LOW_OVR_CAP; a young player
// (LOW_OVR_YOUNG or younger) may instead have one tool above LOW_OVR_TOOL with every other skill at most that, and his
// name then says it ("Glass-Cleaning Prospect"). Never a draft prospect (all of them would be one: their label says what
// kind of prospect).
export const LOW_OVR_KEYS = [
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
] as const;
export const LOW_OVR_CAP = 50;
export const LOW_OVR_YOUNG = 21;
// (a young player's one tool is above this, and his other skills at most it; the tool itself at least LOW_OVR_TOOL_MIN:
// a real standout, not a rating that grows past the cap next season)
export const LOW_OVR_TOOL = 52;
export const LOW_OVR_TOOL_MIN = 60;
// "Prospect" up to this age, "Depth Piece" after (the user called a 27-year-old with no tool a Prospect)
export const PROSPECT_MAX_AGE = 27;
// His tools: the skill ratings above the cap, best first
export const lowOvrTools = (r: ArchetypeRatings, cap = LOW_OVR_TOOL) =>
	LOW_OVR_KEYS.filter((k) => (r[k] ?? 0) > cap).sort(
		(x, y) => (r[y] ?? 0) - (r[x] ?? 0),
	);
const lowOvr = (ctx: WordContext, young: boolean): WordTest => {
	const r = ctx.r;
	if (!r || ctx.prospect) {
		return { pass: false, margin: -1 };
	}
	const age = ctx.age;
	const band = ctx.band ?? 0;
	const ageBand = band > 0 ? 2 : 0;
	const ageOk = young
		? age !== undefined && age <= PROSPECT_MAX_AGE + ageBand
		: age === undefined || age > PROSPECT_MAX_AGE - ageBand;
	const vals = LOW_OVR_KEYS.map((k) => r[k] ?? 0).sort((x, y) => y - x);
	// (no skill above the cap; or, for a young player, one tool above LOW_OVR_TOOL and every other skill at most that)
	const toolCap = (ctx.toolCap ?? LOW_OVR_TOOL) + band;
	const oneTool =
		young &&
		age !== undefined &&
		age <= (ctx.lowYoung ?? LOW_OVR_YOUNG) + ageBand &&
		vals[0]! > toolCap &&
		vals[0]! >= (ctx.toolMin ?? LOW_OVR_TOOL_MIN) - band;
	const margin = Math.min(
		ageOk ? 1 : -1,
		oneTool
			? (toolCap + 0.5 - vals[1]!) / 10
			: ((ctx.lowCap ?? LOW_OVR_CAP) + band + 0.5 - vals[0]!) / 10,
	);
	return { pass: margin >= 0, margin };
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
	(ctx: WordContext, lead: boolean, bar?: number) => WordTest
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
	// archv4 gap roles (the archv3 gap dump's weak clusters; their words promise what each test checks):
	// Crafty Floater Guard: finishing top 50% at his position (and above the floor) and among his three best skills,
	// floaters over burst (a floater lean +0.5 z with Sub-Ratings, else offensive feel +0.5 z), athleticism below the top
	// 30%, no taller than his position's average, and no shooter's name to say first (a three below his position's top 20%)
	floaterRole: (ctx) => {
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const touch = ctx.style.sub
			? ((ctx.style.sub.flt ?? 0) - 0.5) / 4
			: ((ctx.pz.oiq ?? 0) - 0.5) / 2;
		const margin = Math.min(
			p("finish") - 0.5,
			(ctx.cv.finish ?? 0) / 4,
			touch,
			0.7 - p("ath"),
			-(ctx.pz.hgt ?? 0) / 2,
			ctx.top3.includes("finish") ? 1 : -0.01,
			0.8 - p("shoot"),
		);
		return { pass: margin >= 0, margin };
	},
	// Raw Athletic Handler: a draft prospect (a scouting word: a player in the league outgrows it, and a label he loses as
	// he ages relabeled one in thirty players a season), athleticism top 30% and handling top 50% at his position,
	// offensive feel below his position's average, a three below the top 50% and passing below the top 40%
	rawHandlerRole: (ctx) => {
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const margin = Math.min(
			ctx.prospect ? 1 : -1,
			p("ath") - 0.7,
			p("handle") - 0.5,
			(ctx.cv.ath ?? 0) / 4,
			(ctx.cv.handle ?? 0) / 4,
			-(ctx.pz.oiq ?? 0) / 2,
			0.5 - p("shoot"),
			0.6 - p("pass"),
		);
		return { pass: margin >= 0, margin };
	},
	// archv5 (the user's labels): the low-ovr roles (lowOvr above)
	prospectRole: (ctx) => lowOvr(ctx, true),
	depthPieceRole: (ctx) => lowOvr(ctx, false),
	// Paint Beast: an interior scorer with no jumper: finishing (dunk or inside) 55+ and among his two best skills, over any
	// shot by 10, no jumper (a three at most PAINT_BEAST_TP, a mid-range at most PAINT_BEAST_FG), size (height 50+) or power (strength 60+), and finishing top 50% at his
	// position (the user: "pure athletic rim-runner, zero shooting"; "Diming Paint Beast" with a playmaking word)
	paintBeastRole: (ctx) => {
		const r = ctx.r;
		if (!r) {
			return { pass: false, margin: -1 };
		}
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const b = ctx.band ?? 0;
		const fin = Math.max(r.dnk ?? 0, r.ins ?? 0) + b;
		// (finishing among his two best skills: LOW_OVR_KEYS, his size and athleticism aside)
		const second = LOW_OVR_KEYS.filter((k) => k !== "dnk" && k !== "ins")
			.map((k) => r[k] ?? 0)
			.sort((x, y) => y - x)[1]!;
		const margin = Math.min(
			(fin - 55) / 10,
			(fin - second) / 10,
			(fin - Math.max(r.tp ?? 0, r.fg ?? 0) - 10) / 10,
			(PAINT_BEAST_TP + b - (r.tp ?? 0)) / 10,
			(PAINT_BEAST_FG + b - (r.fg ?? 0)) / 10,
			Math.max((r.hgt ?? 0) - 50, (r.stre ?? 0) + b - 60) / 10,
			p("finish") - 0.5,
			(ctx.cv.finish ?? 0) / 4,
			notAnchor(ctx),
		);
		return { pass: margin >= 0, margin };
	},
	// Interior Force: size and strength (both 55+) and rebounding 55+, no jumper (three and mid-range at most 45), and no
	// finishing tool (then he is a Paint Beast) (the user: "reb 60, hgt 59, stre 58; 41 3PT rules out Stretch")
	interiorForceRole: (ctx) => {
		const r = ctx.r;
		if (!r) {
			return { pass: false, margin: -1 };
		}
		const b = ctx.band ?? 0;
		const margin = Math.min(
			((r.hgt ?? 0) + b - 55) / 10,
			((r.stre ?? 0) + b - 55) / 10,
			((r.reb ?? 0) + b - 55) / 10,
			(45 + b - (r.tp ?? 0)) / 10,
			(45 + b - (r.fg ?? 0)) / 10,
			(54.5 + b - Math.max(r.dnk ?? 0, r.ins ?? 0)) / 10,
			notAnchor(ctx),
		);
		return { pass: margin >= 0, margin };
	},
	// Offensive-Minded Guard: a scoring tool (mid-range, three or handle 60+) and no defense (defensive IQ at most 35,
	// perimeter D below his position's top 70%) (the user: "79 FG, 61 TP, 66 DRB, no defense (25 DIQ)")
	offGuardRole: (ctx) => {
		const r = ctx.r;
		if (!r) {
			return { pass: false, margin: -1 };
		}
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const b = ctx.band ?? 0;
		const margin = Math.min(
			(Math.max(r.fg ?? 0, r.tp ?? 0, r.drb ?? 0) + b - 60) / 10,
			(35 + b - (r.diq ?? 0)) / 10,
			0.3 - p("perD"),
		);
		return { pass: margin >= 0, margin };
	},
	// Crafty: offensive feel well above his position's (and, with sub-ratings, finesse over contact)
	// (archv4: `bar` the learned offensive-feel bar, wordBars.data.ts)
	crafty: (ctx, _lead, bar = CRAFTY_OIQ) => {
		const oiq = ctx.pz.oiq ?? 0;
		const con = ctx.style.sub?.con ?? 0;
		const margin = Math.min((oiq - bar) / 2, (0.25 - con) / 2);
		return { pass: margin >= 0, margin };
	},
};

// Crafty's offensive-feel bar (z at his position), before archv4's learned bars
export const CRAFTY_OIQ = 0.5;

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
// and High-Flying whole-word bars. `bar` (archv4, a descriptor only): the learned support bar (top fraction at his
// position, wordBars.data.ts) in place of the rulebook's, and in place of the High-Flying whole-word bar for "air"; for
// Crafty, its offensive-feel bar
export const testConcept = (
	concept: string,
	lead: boolean,
	ctx: WordContext,
	display: string,
	bar?: number,
): WordTest => {
	const custom = CUSTOM_TESTS[concept];
	if (custom) {
		return custom(ctx, lead, lead ? undefined : bar);
	}
	const learned = lead ? undefined : bar;
	const rule = RULES[concept];
	if (!rule) {
		return { pass: false, margin: -1 };
	}
	const support = learned ?? rule.support;
	const v = (k: string) => ctx.cv[k] ?? 0;
	const pct = (k: string) => peerPct(ctx.bucket, k, v(k));
	let margin = Infinity;
	const cls = rule.classes;
	if (cls.length > 0) {
		// Every class at the support bar ...
		if (support < 1) {
			for (const k of cls) {
				margin = Math.min(margin, pct(k) - (1 - support));
			}
		}
		// ... and for the head one of them at the lead bar, among his three best skills
		if (lead && rule.lead < 1) {
			margin = Math.min(
				margin,
				Math.max(...cls.map((k) => pct(k) - (1 - rule.lead))),
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
	margin = Math.min(margin, subOk(rule.sub, ctx.style) / 4);
	margin = Math.min(margin, ptOk(rule.pt, ctx.style) / 4);
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
			pct(s.cls) - (1 - (concept === "air" && learned ? learned : s.bar)),
			subOk(s.sub, ctx.style) / 4,
		);
	}
	if (margin === Infinity) {
		margin = 0;
	}
	return { pass: margin >= 0, margin };
};
