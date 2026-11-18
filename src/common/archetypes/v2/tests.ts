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

// ---- archramp: ramps. Every bar of a test used to be a cliff (one rating point, one percentile point either side of it
// and the word was there or not), so a small change in his ratings could flip his label. Each test now also says how far
// he is from its tightest bar in ramp widths (`soft`: 0 at the bar, -1 one ramp width below it), each bar in its own
// unit, and the engine turns that into a membership between 0 and 1 (engine.ts rampMu, V2Params rampLo / rampHi) that
// scales the word's head start and what a near miss pays. The promise floor (a name never says what he lacks), ages and
// the prospect flag stay yes/no.
// One ramp width: rating points, percentile points (0-1) at his position, z
export const RAMP_RAT = 3;
export const RAMP_PCT = 0.05;
export const RAMP_Z = 0.25;
// The bars of one test: `margin` as before the ramps (the tightest bar, in the units the score reads), `soft` the
// tightest bar in ramp widths
class Bars {
	margin = Infinity;
	soft = Infinity;
	// A percentile bar (x: percentile points above it)
	pct(x: number) {
		this.margin = Math.min(this.margin, x);
		this.soft = Math.min(this.soft, x / RAMP_PCT);
		return this;
	}
	// A rating bar (x: rating points above it)
	rat(x: number) {
		this.margin = Math.min(this.margin, x / 10);
		this.soft = Math.min(this.soft, x / RAMP_RAT);
		return this;
	}
	// A z bar (x: z above it; `div` its scale in the margin; `cap` the most it adds to the margin)
	z(x: number, div: number, cap = Infinity) {
		this.margin = Math.min(this.margin, cap, x / div);
		this.soft = Math.min(this.soft, x / RAMP_Z);
		return this;
	}
	// A yes/no bar (x: its margin as before; below 0 no ramp reaches him)
	hard(x: number) {
		this.margin = Math.min(this.margin, x);
		if (x < 0) {
			this.soft = -Infinity;
		}
		return this;
	}
	// One of `keys` among his three best skills: a miss costs the margin 0.01 as before; the ramp reads how far the best
	// of them is below his third-best skill, in percentile points at his position
	top3(ctx: WordContext, keys: readonly string[]) {
		if (keys.some((k) => ctx.top3.includes(k))) {
			return this;
		}
		this.margin = Math.min(this.margin, -0.01);
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const third = ctx.top3[2];
		this.soft = Math.min(
			this.soft,
			third === undefined
				? -Infinity
				: Math.min(-1e-6, (Math.max(...keys.map(p)) - p(third)) / RAMP_PCT),
		);
		return this;
	}
	done(): WordTest {
		if (this.margin === Infinity) {
			return { pass: true, margin: 0, soft: Infinity };
		}
		return {
			pass: this.margin >= 0,
			margin: this.margin,
			// (a bar met is never a miss on the ramp, and the other way round)
			soft:
				this.margin >= 0 ? Math.max(0, this.soft) : Math.min(-1e-6, this.soft),
		};
	}
}
const FAIL: WordTest = { pass: false, margin: -1, soft: -Infinity };

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
const notAnchor = (b: Bars, ctx: WordContext) =>
	b.z(ANCHOR_PZ - Math.max(ctx.pz.blk ?? 0, ctx.pz.reb ?? 0), 2, 1);
// (a Paint Beast's jumper: at most these)
export const PAINT_BEAST_TP = 35;
export const PAINT_BEAST_FG = 45;
// How far he is from the tightest absolute floor of a name's words, in rating points (above 0: below the floor;
// -Infinity: the name has no floor)
export const floorGap = (
	name: string,
	r: ArchetypeRatings | undefined,
	band = 0,
): number => {
	let m = -Infinity;
	if (r) {
		for (const f of ABS_FLOORS) {
			if (f.re.test(name)) {
				m = Math.max(m, f.min - band - (r[f.rating] ?? 0));
			}
		}
	}
	return m;
};
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
		return FAIL;
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
	const toolMin = (ctx.toolMin ?? LOW_OVR_TOOL_MIN) - band;
	const mayTool =
		young &&
		age !== undefined &&
		age <= (ctx.lowYoung ?? LOW_OVR_YOUNG) + ageBand;
	const oneTool = mayTool && vals[0]! > toolCap && vals[0]! >= toolMin;
	// (rating points under each cap)
	const noTool = (ctx.lowCap ?? LOW_OVR_CAP) + band + 0.5 - vals[0]!;
	const others = toolCap + 0.5 - vals[1]!;
	const margin = Math.min(ageOk ? 1 : -1, (oneTool ? others : noTool) / 10);
	// (the ramp: the nearer of the two ways in)
	const softTool = mayTool
		? Math.min(others, vals[0]! - toolMin + 0.5) / RAMP_RAT
		: -Infinity;
	const soft = ageOk ? Math.max(noTool / RAMP_RAT, softTool) : -Infinity;
	return {
		pass: margin >= 0,
		margin,
		soft: margin >= 0 ? Math.max(0, soft) : Math.min(-1e-6, soft),
	};
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
	// archramp: the same in ramp widths, each bar in its own unit (0 at the bar, -1 one ramp width below it; -Infinity:
	// a yes/no bar missed)
	soft: number;
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
		const b = new Bars()
			.pct(p("perD") - 0.6)
			.pct(p("rimD") - 0.6)
			.pct(p("ath") - 0.4)
			.top3(ctx, ["perD", "rimD"])
			.hard((ctx.cv.perD ?? 0) / 4)
			.hard((ctx.cv.rimD ?? 0) / 4);
		// (a role player's name: no standout on offense, not carrying it; a star who also defends everywhere is read by
		// what he does with the ball)
		noStandout(b, ctx, ["perD", "rimD", "ath", "reb", "stre"]);
		lowUsage(b, ctx);
		return b.done();
	},
	// Steady Game Manager: passing and handling top 50%, no class top 20%
	gameManagerRole: (ctx) => {
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const b = new Bars()
			.pct(p("pass") - 0.5)
			.pct(p("handle") - 0.5)
			.hard((ctx.cv.pass ?? 0) / 4)
			.hard((ctx.cv.handle ?? 0) / 4);
		noStandout(b, ctx, ["pass", "handle"]);
		return b.done();
	},
	// Energy Big: finishing and athleticism top 50% (one his head skill), rim D top 50%, three below top 50%, no standout
	// but finishing and athleticism
	energyRole: (ctx) => {
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const b = new Bars()
			.pct(p("finish") - 0.5)
			.pct(p("ath") - 0.5)
			.pct(p("rimD") - 0.5)
			.pct(0.5 - p("shoot"))
			.top3(ctx, ["finish", "ath"])
			.hard((ctx.cv.finish ?? 0) / 4)
			.hard((ctx.cv.ath ?? 0) / 4);
		// (archv3: a role player too: no standout but finishing and athleticism, an elite rim protector is not one)
		noStandout(b, ctx, ["finish", "ath"]);
		return b.done();
	},
	// archv4 gap roles (the archv3 gap dump's weak clusters; their words promise what each test checks):
	// Crafty Floater Guard: finishing top 50% at his position (and above the floor) and among his three best skills,
	// floaters over burst (a floater lean +0.5 z with Sub-Ratings, else offensive feel +0.5 z), athleticism below the top
	// 30%, no taller than his position's average, and no shooter's name to say first (a three below his position's top 20%)
	floaterRole: (ctx) => {
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const b = new Bars()
			.pct(p("finish") - 0.5)
			.hard((ctx.cv.finish ?? 0) / 4)
			.pct(0.7 - p("ath"))
			.z(-(ctx.pz.hgt ?? 0), 2)
			.top3(ctx, ["finish"])
			.pct(0.8 - p("shoot"));
		if (ctx.style.sub) {
			b.z((ctx.style.sub.flt ?? 0) - 0.5, 4);
		} else {
			b.z((ctx.pz.oiq ?? 0) - 0.5, 2);
		}
		return b.done();
	},
	// Raw Athletic Handler: a draft prospect (a scouting word: a player in the league outgrows it, and a label he loses as
	// he ages relabeled one in thirty players a season), athleticism top 30% and handling top 50% at his position,
	// offensive feel below his position's average, a three below the top 50% and passing below the top 40%
	rawHandlerRole: (ctx) => {
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		return new Bars()
			.hard(ctx.prospect ? 1 : -1)
			.pct(p("ath") - 0.7)
			.pct(p("handle") - 0.5)
			.hard((ctx.cv.ath ?? 0) / 4)
			.hard((ctx.cv.handle ?? 0) / 4)
			.z(-(ctx.pz.oiq ?? 0), 2)
			.pct(0.5 - p("shoot"))
			.pct(0.6 - p("pass"))
			.done();
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
			return FAIL;
		}
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const b = ctx.band ?? 0;
		const fin = Math.max(r.dnk ?? 0, r.ins ?? 0) + b;
		// (finishing among his two best skills: LOW_OVR_KEYS, his size and athleticism aside)
		const second = LOW_OVR_KEYS.filter((k) => k !== "dnk" && k !== "ins")
			.map((k) => r[k] ?? 0)
			.sort((x, y) => y - x)[1]!;
		const bars = new Bars()
			.rat(fin - 55)
			.rat(fin - second)
			.rat(fin - Math.max(r.tp ?? 0, r.fg ?? 0) - 10)
			.rat(PAINT_BEAST_TP + b - (r.tp ?? 0))
			.rat(PAINT_BEAST_FG + b - (r.fg ?? 0))
			.rat(Math.max((r.hgt ?? 0) - 50, (r.stre ?? 0) + b - 60))
			.pct(p("finish") - 0.5)
			.hard((ctx.cv.finish ?? 0) / 4);
		return notAnchor(bars, ctx).done();
	},
	// Interior Force: size and strength (both 55+) and rebounding 55+, no jumper (three and mid-range at most 45), and no
	// finishing tool (then he is a Paint Beast) (the user: "reb 60, hgt 59, stre 58; 41 3PT rules out Stretch")
	interiorForceRole: (ctx) => {
		const r = ctx.r;
		if (!r) {
			return FAIL;
		}
		const b = ctx.band ?? 0;
		const bars = new Bars()
			.rat((r.hgt ?? 0) + b - 55)
			.rat((r.stre ?? 0) + b - 55)
			.rat((r.reb ?? 0) + b - 55)
			.rat(45 + b - (r.tp ?? 0))
			.rat(45 + b - (r.fg ?? 0))
			.rat(54.5 + b - Math.max(r.dnk ?? 0, r.ins ?? 0));
		return notAnchor(bars, ctx).done();
	},
	// Offensive-Minded Guard: a scoring tool (mid-range, three or handle 60+) and no defense (defensive IQ at most 35,
	// perimeter D below his position's top 70%) (the user: "79 FG, 61 TP, 66 DRB, no defense (25 DIQ)")
	offGuardRole: (ctx) => {
		const r = ctx.r;
		if (!r) {
			return FAIL;
		}
		const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
		const b = ctx.band ?? 0;
		return new Bars()
			.rat(Math.max(r.fg ?? 0, r.tp ?? 0, r.drb ?? 0) + b - 60)
			.rat(35 + b - (r.diq ?? 0))
			.pct(0.3 - p("perD"))
			.done();
	},
	// Crafty: offensive feel well above his position's (and, with sub-ratings, finesse over contact)
	// (archv4: `bar` the learned offensive-feel bar, wordBars.data.ts)
	crafty: (ctx, _lead, bar = CRAFTY_OIQ) => {
		const oiq = ctx.pz.oiq ?? 0;
		const con = ctx.style.sub?.con ?? 0;
		return new Bars()
			.z(oiq - bar, 2)
			.z(0.25 - con, 2)
			.done();
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
const noStandout = (
	b: Bars,
	ctx: WordContext,
	head: readonly string[] = [],
) => {
	b.pct(ROLE_SCORE_CAP - peerPct(ctx.bucket, "score", ctx.cv.score ?? 0));
	for (const k of SKILL_CLASS_KEYS) {
		if (!head.includes(k)) {
			b.pct(GLUE_CAP - peerPct(ctx.bucket, k, ctx.cv[k] ?? 0));
		}
	}
	return b;
};
// (a role player does not carry the offense: his usage, when his box score says, under +0.5 z at his position)
const lowUsage = (b: Bars, ctx: WordContext) => {
	const u = ctx.statZ?.usg;
	return u === undefined ? b : b.z(0.5 - u, 4);
};
const glue = (ctx: WordContext, side: string[], nSide: number): WordTest => {
	const p = (k: string) => peerPct(ctx.bucket, k, ctx.cv[k] ?? 0);
	const sides = side.map((k) => p(k) - 0.5).sort((a, b) => b - a);
	const broad = SKILL_CLASS_KEYS.map((k) => p(k) - 0.5).sort((a, b) => b - a);
	const b = new Bars()
		.pct(p("perD") - 0.5)
		.top3(ctx, ["perD"])
		.pct(sides[nSide - 1]!)
		.pct(broad[2]!)
		.hard((ctx.cv.perD ?? 0) / 4);
	noStandout(b, ctx, ["perD"]);
	lowUsage(b, ctx);
	return b.done();
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
		return FAIL;
	}
	const support = learned ?? rule.support;
	const v = (k: string) => ctx.cv[k] ?? 0;
	const pct = (k: string) => peerPct(ctx.bucket, k, v(k));
	const b = new Bars();
	const cls = rule.classes;
	if (cls.length > 0) {
		// Every class at the support bar ...
		if (support < 1) {
			for (const k of cls) {
				b.pct(pct(k) - (1 - support));
			}
		}
		// ... and for the head one of them at the lead bar, among his three best skills
		if (lead && rule.lead < 1) {
			b.pct(Math.max(...cls.map((k) => pct(k) - (1 - rule.lead))));
			const head = cls.filter((k) => SKILL_CLASS_KEYS.includes(k));
			if (head.length > 0) {
				b.top3(ctx, head);
			}
		}
		// The promise floor every holder of the name keeps (yes/no: a name never says what he lacks)
		for (const k of cls) {
			b.hard((v(k) - FLOOR) / 4);
		}
	}
	const zBar = (x: number) => {
		if (x !== Infinity) {
			b.z(x, 4);
		}
	};
	zBar(subOk(rule.sub, ctx.style));
	zBar(ptOk(rule.pt, ctx.style));
	if (WORD_RULES.sniper.re.test(display)) {
		const s = WORD_RULES.sniper;
		b.pct(pct(s.cls) - (1 - s.bar)).hard((v(s.cls) - s.floor) / 4);
		zBar(subOk(s.sub, ctx.style));
	}
	if (WORD_RULES.air.re.test(display)) {
		const s = WORD_RULES.air;
		b.pct(pct(s.cls) - (1 - (concept === "air" && learned ? learned : s.bar)));
		zBar(subOk(s.sub, ctx.style));
	}
	return b.done();
};
