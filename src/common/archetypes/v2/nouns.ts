// archnouns (the user's design): a name is built from NOUNS. Each noun is one thing a player is good at (3PT, Shot
// Creator, Rim Protection, ...), scored by where he stands among the league's players (a percentile, so every noun is on
// the same scale: 10 points over the 3PT bar and 10 points over the shot-blocking bar are not the same thing). The nouns
// he qualifies for, best first, make his name:
//
// - a special name (a build: "2-Way Iso Sniper") when every noun it is made of is among his three best, and it has his
//   best one (a special name never hides his best skill);
// - else his two best nouns in front of his position: "2-Way 3PT Wing", "Glass-Cleaning Rim-Protecting Big";
// - else (one noun at low ovr, or none) an honest name (honest.ts), or a trait name (Closer, Screen-and-Roll Big, ...).
//
// The position is not a noun (it ends the name, it never takes a skill's place). Each noun has a front form (the word in
// front of the position) and, for the elite, an elite form (ovr ELITE_OVR+ and a top ELITE_PCT standing). Last season's
// pair is kept while it is within HYST of his current two best. Names are at most two nouns and the position, or a
// special name of at most three nouns.
import { ARCHETYPES } from "../classify.ts";
import { nameAt } from "../posNames.ts";
import { CONCEPTS, conceptsOf } from "../twoK/concepts.ts";
import type { ArchetypeRatings, Pos } from "../types.ts";
import { SUB_INDEX } from "../../subRatings.ts";
import { GATE_REF } from "./gateScale.data.ts";
import { percentileIn, type RatingQuantiles } from "./gateScale.ts";
import { ELITE_RE, hasUpside } from "./honest.ts";
import {
	composedId,
	composeName,
	DESC_BY_KEY,
	GROUP_OF,
	ROLE_BY_KEY,
	type PosGroup,
} from "./grammar.ts";

export type NounKey =
	| "three"
	| "mid"
	| "post"
	| "finish"
	| "rimD"
	| "perimD"
	| "steal"
	| "handle"
	| "creator"
	| "pass"
	| "reb"
	| "speed"
	| "jump"
	| "strength"
	| "crafty";

// A noun clears when he is in the league's top 30% at it (the user's audit: "the skill must be in the league's top 30%
// and one of the player's three best skills")
export const NOUN_CLEAR = 0.7;
// Elite words: ovr 58+ (the user's audit: the top 15% of a league) and a top 8% standing at the noun
export const NOUN_ELITE_OVR = 58;
// (with a league table of ovr: his league's top ELITE_OVR_PCT, never below ELITE_OVR_FLOOR; the user)
export const ELITE_OVR_PCT = 0.9;
export const ELITE_OVR_FLOOR = 55;
// A generic no-skill name only with no noun in the league's top 40% (else his best one's specialist name; the user)
export const GENERIC_PCT = 0.6;
// A trait adds one word to a one-noun name at this score (the user: "one trait word per name when the trait is 70+")
export const TRAIT_WORD_MIN = 70;
// Sub-ratings decide a noun's word when one leads another by this much
export const SUB_LEAN = 6;
export const ELITE_PCT = 0.92;
// Below this ovr a player with one noun gets an honest name (a specialist), not "<noun> <Position>"
export const ONE_NOUN_OVR = 50;
// A Raw / Developing / Project name: at this ovr or below (or with no noun at all)
export const DEV_MAX_OVR = 30;
// 2-Way: defense (perimeter or interior) 60+ and in the league's top 40%
const TWO_WAY_MIN = 60;
const TWO_WAY_PCT = 0.6;
// Crafty: offensive IQ in the top 15%
const CRAFTY_PCT = 0.85;
// Lockdown needs mobility: lateral quickness (or speed) at least at the league's median
const MOBILE_PCT = 0.5;
// Last season's nouns stay while each is within this much (in percentile) of his current pick
export const HYST = 0.02;

// The words of each noun: its front form, the elite front form, and by size where it differs
export type NounWords = {
	desc: string;
	elite?: string;
	byGroup?: Partial<Record<PosGroup, string>>;
	eliteByGroup?: Partial<Record<PosGroup, string>>;
};
// (descriptor keys of grammar.ts DESCRIPTORS)
export const NOUN_DESC: Record<NounKey, NounWords> = {
	three: {
		desc: "threePt",
		byGroup: { big: "stretchy" },
		elite: "sharpshooting",
		eliteByGroup: { big: "stretchy" },
	},
	mid: { desc: "midRange" },
	post: { desc: "postAny" },
	finish: { desc: "rimFinishing" },
	rimD: { desc: "rimProtecting", elite: "shotErasing" },
	perimD: { desc: "defensive", elite: "lockdownD" },
	steal: { desc: "ballHawking" },
	handle: { desc: "ballHandling" },
	creator: { desc: "iso", elite: "shotCreating" },
	pass: { desc: "playmaking" },
	reb: { desc: "glass" },
	speed: { desc: "speedy" },
	jump: { desc: "highFlying" },
	strength: { desc: "physical" },
	crafty: { desc: "crafty" },
};
// The noun a descriptor says (for last season's name)
const DESC_NOUN: Record<string, NounKey> = {};
for (const [k, w] of Object.entries(NOUN_DESC) as [NounKey, NounWords][]) {
	for (const d of [
		w.desc,
		w.elite,
		...Object.values(w.byGroup ?? {}),
		...Object.values(w.eliteByGroup ?? {}),
	]) {
		if (d) {
			DESC_NOUN[d] ??= k;
		}
	}
}
DESC_NOUN.twoWay = "perimD";
export const nounOfDesc = (d: string): NounKey | undefined => DESC_NOUN[d];

// The position word that ends the name
export type PosWord =
	| `e${string}`
	| "posGuard"
	| "posWing"
	| "posForward"
	| "posBig"
	| "bruiser"
	| "enigma";
export const POS_WORD: Record<Pos, PosWord> = {
	PG: "posGuard",
	G: "posGuard",
	SG: "posGuard",
	GF: "posWing",
	SF: "posWing",
	F: "posForward",
	PF: "posForward",
	FC: "posBig",
	C: "posBig",
};

// ---- the scores ----
const sub = (r: ArchetypeRatings, key: string): number | undefined => {
	const i = SUB_INDEX[key];
	const v = i === undefined ? undefined : r.sub?.[i];
	return typeof v === "number" ? v : undefined;
};
const mean = (xs: (number | undefined)[]) => {
	const v = xs.filter((x): x is number => typeof x === "number");
	return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};
// Each noun: its value (0-100, the ratings it is about, with the sub-ratings that say it when he has them) and the
// league table that says where that value stands
const NOUN_VALUE: Record<
	NounKey,
	{
		value: (r: ArchetypeRatings) => number;
		table: (r: ArchetypeRatings) => string;
	}
> = {
	three: { value: (r) => r.tp, table: () => "tp" },
	mid: { value: (r) => r.fg, table: () => "fg" },
	post: { value: (r) => r.ins, table: () => "ins" },
	finish: { value: (r) => r.dnk, table: () => "dnk" },
	rimD: {
		// (without interior defense or the block sub-rating, defensive IQ alone would make every smart defender a rim
		// protector: his size and leaping then count too)
		value: (r) =>
			r.idef === undefined && sub(r, "blk") === undefined
				? mean([r.diq, r.hgt, r.jmp])
				: mean([sub(r, "blk"), r.idef ?? r.diq]),
		table: (r) => (r.idef !== undefined ? "idef" : "diq"),
	},
	perimD: {
		value: (r) => mean([r.pdef, sub(r, "pdf"), r.diq]),
		table: (r) => (r.pdef !== undefined ? "pdef" : "diq"),
	},
	steal: {
		// (without the steals sub-rating: his IQ and quickness)
		value: (r) => sub(r, "stl") ?? mean([r.diq, r.spd]),
		table: () => "diq",
	},
	handle: { value: (r) => r.drb, table: () => "drb" },
	creator: {
		value: (r) => mean([sub(r, "crt") ?? r.drb, r.drb]),
		table: () => "drb",
	},
	pass: { value: (r) => r.pss, table: () => "pss" },
	reb: { value: (r) => r.reb, table: () => "reb" },
	speed: { value: (r) => r.spd, table: () => "spd" },
	jump: { value: (r) => r.jmp, table: () => "jmp" },
	strength: { value: (r) => r.stre, table: () => "stre" },
	crafty: { value: (r) => r.oiq, table: () => "oiq" },
};
export const NOUNS = Object.keys(NOUN_VALUE) as NounKey[];
// The base rating the regenerator raises for a noun (it sets base ratings only)
export const NOUN_RATING: Record<NounKey, keyof ArchetypeRatings> = {
	three: "tp",
	mid: "fg",
	post: "ins",
	finish: "dnk",
	rimD: "diq",
	perimD: "diq",
	steal: "diq",
	handle: "drb",
	creator: "drb",
	pass: "pss",
	reb: "reb",
	speed: "spd",
	jump: "jmp",
	strength: "stre",
	crafty: "oiq",
};
// The rating at a standing among the league's players
export const ratingAtPct = (k: string, p: number, rq?: RatingQuantiles) => {
	const t = tableOf(k, rq);
	if (!t) {
		return 50;
	}
	const pos = p * (t.length - 1);
	const lo = Math.floor(pos);
	const hi = Math.min(t.length - 1, lo + 1);
	return t[lo]! + (t[hi]! - t[lo]!) * (pos - lo);
};

export type NounScore = {
	key: NounKey;
	value: number;
	pct: number;
	// how far above the league's 90th percentile, in units of its top spread (breaks ties at the very top)
	above: number;
};

const tableOf = (k: string, rq?: RatingQuantiles) =>
	(rq as Record<string, number[] | undefined> | undefined)?.[k] ??
	(GATE_REF as Record<string, number[] | undefined>)[k];

export const pctOf = (k: string, v: number, rq?: RatingQuantiles): number => {
	const t = tableOf(k, rq);
	return t ? percentileIn(t, v) : 0.5;
};

// Every noun's score, best standing first
export const nounScores = (
	r: ArchetypeRatings,
	rq?: RatingQuantiles,
): NounScore[] =>
	NOUNS.map((key) => {
		const value = NOUN_VALUE[key].value(r);
		const tk = NOUN_VALUE[key].table(r);
		const t = tableOf(tk, rq);
		const q90 = t ? t[Math.round(0.9 * (t.length - 1))]! : 70;
		const top = t ? t.at(-1)! : 100;
		return {
			key,
			value,
			pct: pctOf(tk, value, rq),
			above: (value - q90) / Math.max(1, top - q90),
		};
	}).sort((a, b) => b.pct - a.pct || b.above - a.above);

// archnouns4 (the user: "a lot of high flyer builds, maybe too many"): leaping names him only from the league's top
// 10%, and ranks ATH_DISCOUNT below a skill at the same standing, so a skill that is close wins (speed and strength
// stay as they were: the user's audit names his top strength and speed, "Interior Force", "Track Star")
export const ATH_NOUNS: ReadonlySet<NounKey> = new Set(["jump"]);
export const ATH_CLEAR: Partial<Record<NounKey, number>> = { jump: 0.9 };
export const ATH_DISCOUNT = 0.04;
// A defensive skill in his defensive label from this standing (or among his three best)
export const DEF_LABEL_PCT = 0.85;
const clearAt = (k: NounKey) =>
	k === "crafty" ? CRAFTY_PCT : (ATH_CLEAR[k] ?? NOUN_CLEAR);
const rankPct = (s: NounScore) =>
	s.pct - (ATH_NOUNS.has(s.key) ? ATH_DISCOUNT : 0);
// The nouns he qualifies for (Crafty only from the top 15%), best first (athletic nouns discounted)
export const clearedNouns = (scores: readonly NounScore[]): NounScore[] =>
	scores
		.filter((s) => s.pct >= clearAt(s.key))
		.sort((a, b) => rankPct(b) - rankPct(a) || b.above - a.above);

export const twoWayOk = (r: ArchetypeRatings, rq?: RatingQuantiles) => {
	const perim = NOUN_VALUE.perimD.value(r);
	const rim = NOUN_VALUE.rimD.value(r);
	const d = Math.max(perim, rim);
	const pct = Math.max(
		pctOf(NOUN_VALUE.perimD.table(r), perim, rq),
		pctOf(NOUN_VALUE.rimD.table(r), rim, rq),
	);
	return d >= TWO_WAY_MIN && pct >= TWO_WAY_PCT;
};
const mobile = (r: ArchetypeRatings, rq?: RatingQuantiles) =>
	Math.max(pctOf("spd", sub(r, "lat") ?? r.spd, rq), pctOf("spd", r.spd, rq)) >=
	MOBILE_PCT;

const OFFENSE: ReadonlySet<NounKey> = new Set([
	"three",
	"mid",
	"post",
	"finish",
	"handle",
	"creator",
	"pass",
]);
const DEFENSE: ReadonlySet<NounKey> = new Set(["perimD", "steal"]);

// ---- special names (builds) ----
// The nouns a concept of a build's name says (a concept that is no noun makes the build no special name)
const CONCEPT_NOUNS: Record<string, NounKey[] | "twoWay" | null> = {
	twoWay: "twoWay",
	lockdown: ["perimD"],
	switchD: ["perimD"],
	steal: ["steal"],
	pressure: ["steal"],
	rimD: ["rimD"],
	reb: ["reb"],
	oreb: ["reb"],
	outlet: ["reb", "pass"],
	threeLevel: ["three", "mid"],
	insideOut: ["three", "finish"],
	catchShoot: ["three"],
	shotHunt: ["three"],
	midPaint: ["mid", "post"],
	midPost: ["mid", "post"],
	mid: ["mid"],
	pullUp: ["mid", "creator"],
	post: ["post"],
	paint: ["post"],
	slash: ["finish", "handle"],
	finish: ["finish"],
	dunk: ["finish"],
	hammer: ["finish"],
	air: ["jump"],
	lob: ["jump"],
	riser: ["jump"],
	run: ["speed"],
	burner: ["speed"],
	tempo: ["speed", "pass"],
	creator: ["creator"],
	pass: ["pass"],
	wizard: ["pass", "handle"],
	tripleDouble: ["pass", "reb"],
	strength: ["strength"],
	skill: ["crafty"],
};
// The nickname builds, by hand (their words are no concepts)
const NICKNAMES: Record<string, NounKey[]> = {
	"Footwork Pharaoh": ["post", "crafty"],
	"From The Logo": ["three"],
	"Shifty King": ["handle", "creator"],
	"Big Glide": ["handle", "speed"],
	"Ankle Taker": ["creator", "handle"],
	"Yamming Force of Nature": ["jump", "finish"],
	"Point-Fading Wizard": ["mid", "pass"],
};
export type Special = {
	id: string;
	name: string;
	nouns: NounKey[];
	twoWay: boolean;
	elite: boolean;
};
// The nouns a build's name is made of, when it can be a special name at all (every word a noun, one to three nouns)
export const specialNounsOf = (
	name: string,
): { nouns: NounKey[]; twoWay: boolean } | undefined => {
	let nouns: NounKey[] | undefined = NICKNAMES[name];
	let twoWay = false;
	if (!nouns) {
		const cs = conceptsOf(name);
		if (cs.length === 0) {
			return undefined;
		}
		const set = new Set<NounKey>();
		for (const c of cs) {
			const m = CONCEPT_NOUNS[c.key];
			if (m === "twoWay") {
				twoWay = true;
			} else if (m) {
				for (const n of m) {
					set.add(n);
				}
			} else {
				return undefined;
			}
		}
		nouns = [...set];
	}
	return nouns.length === 0 || nouns.length > 3 ? undefined : { nouns, twoWay };
};
const specialCache = new Map<Pos, Special[]>();
export const specialsAt = (pos: Pos): Special[] => {
	const hit = specialCache.get(pos);
	if (hit) {
		return hit;
	}
	const out: Special[] = [];
	for (const a of ARCHETYPES) {
		if (!a.positions.includes(pos) || a.expanded || a.trait) {
			continue;
		}
		const name = nameAt(a, pos);
		const sn = specialNounsOf(name);
		if (!sn) {
			continue;
		}
		out.push({
			id: a.id,
			name,
			nouns: sn.nouns,
			twoWay: sn.twoWay,
			elite: ELITE_RE.test(name),
		});
	}
	specialCache.set(pos, out);
	return out;
};
// Words a special name may only have at some positions, or with a trait
const BIG_POS: ReadonlySet<Pos> = new Set(["PF", "FC", "C"]);
const TRAIT_WORDS: [RegExp, string, number][] = [
	[/Hustle|Hustling|Energy|Junkyard|Gritty|Grinder/, "hustle", 55],
	[
		/Screen|Rolling|Roll Man|Roll-Man|Pick-and-Pop|Popper|Popping/,
		"screen",
		50,
	],
	[/Off-Ball|Cutting/, "offBall", 55],
	[/Motor|Demon|Relentless/, "motor", 55],
	[/Clutch|Ice-Cold|Closer/, "clutch", 55],
	[/Ruthless/, "competitiveness", 55],
	[/Savvy|Veteran|Old Head/, "veteranSavvy", 55],
	[/Iron|Durable/, "durability", 55],
	[/Versatile|Switchable/, "defensiveVersatility", 55],
];
export const wordsFit = (
	name: string,
	pos: Pos,
	traits?: Record<string, number>,
): boolean => {
	if (/Stretch/.test(name) && !BIG_POS.has(pos)) {
		return false;
	}
	if (/\bFour\b/.test(name) && pos !== "F" && pos !== "PF") {
		return false;
	}
	if (/\bFive\b/.test(name) && pos !== "FC" && pos !== "C") {
		return false;
	}
	for (const [re, key, min] of TRAIT_WORDS) {
		if (re.test(name) && (traits?.[key] ?? 0) < min) {
			return false;
		}
	}
	return true;
};

// archnouns: whether a build can be the label the Ratings Regenerator aims at: a special name whose words are all
// nouns, with no 2-Way and no defensive noun next to an offensive one (a two-way player has a main name and a
// defensive label), no trait word (the regenerator sets no traits) and, at a position, no big's word on a non-big
export const aimReachable = (name: string, pos?: Pos): boolean => {
	const sn = specialNounsOf(name);
	if (!sn || sn.twoWay) {
		return false;
	}
	const def = sn.nouns.filter((n) => DEF_NOUN_KEYS.has(n));
	if (def.length > 0 && def.length < sn.nouns.length) {
		return false;
	}
	if (TRAIT_WORDS.some(([re]) => re.test(name))) {
		return false;
	}
	// (archnouns4: and every promise its words make is one of its nouns: a word that needs another skill, a trait or a
	// sub-rating the regenerator doesn't set makes the name unreachable)
	const has = (n: NounKey) =>
		sn.nouns.includes(n) || (n === "handle" && sn.nouns.includes("creator"));
	for (const w of WORD_REQ) {
		if (!w.re.test(name)) {
			continue;
		}
		if ("nouns" in w ? !w.nouns.every(has) : "trait" in w) {
			return false;
		}
		if (
			"check" in w &&
			/slasher|shot-creation|mobility|high flyer/.test(w.why)
		) {
			return false;
		}
	}
	return pos === undefined || wordsFit(name, pos, {});
};
const DEF_NOUN_KEYS: ReadonlySet<NounKey> = new Set([
	"rimD",
	"perimD",
	"steal",
]);

// (for tests)
export const allConceptKeys = () => CONCEPTS.map((c) => c.key);

// ---- trait keywords (the user's list): each has front words (in front of a skill: "Clutch 3PT Wing") and end words
// (the name itself when the trait is what he is: "Closer"), and the test the trait has to pass ----
export type TraitKeyword = {
	key: string;
	// descriptor keys of the front words, and the role whose names are the end words (grammar.ts)
	desc: string;
	role: string;
	// how far over its bar he is (positive: he has it)
	over: (x: NounInput, pct: Record<NounKey, number>, group: PosGroup) => number;
	// variant index of the front / end word that fits him (default 0)
	variant?: (x: NounInput) => number;
};
const tr = (x: NounInput, k: string) => x.traits?.[k] ?? -Infinity;
export const TRAIT_KEYWORDS: TraitKeyword[] = [
	{
		key: "clutch",
		desc: "tClutchD",
		role: "tCloser",
		over: (x) => ((x.ovr ?? 0) >= ONE_NOUN_OVR ? tr(x, "clutch") - 75 : -1),
	},
	{
		key: "savvy",
		desc: "tSavvyD",
		role: "tOldHead",
		over: (x) => ((x.age ?? 0) >= 30 ? tr(x, "veteranSavvy") - 75 : -1),
		variant: (x) => ((x.age ?? 0) >= 32 ? 1 : 0),
	},
	{
		key: "ironMan",
		desc: "tIronD",
		role: "tIronMan",
		over: (x) => ((x.r.endu ?? 0) >= 70 ? tr(x, "durability") - 75 : -1),
	},
	{
		key: "versatile",
		desc: "tVersatileD",
		role: "tVersatile",
		over: (x) => tr(x, "defensiveVersatility") - TRAIT_WORD_MIN,
	},
	{
		key: "rolling",
		desc: "tRollingD",
		role: "tRollMan",
		over: (x, pct, group) =>
			group === "big" && pct.finish >= GENERIC_PCT
				? tr(x, "screen") - TRAIT_WORD_MIN
				: -1,
	},
	{
		key: "pop",
		desc: "tPopD",
		role: "tPopper",
		over: (x, pct, group) =>
			group === "big" && pct.three >= NOUN_CLEAR ? tr(x, "screen") - 60 : -1,
	},
	{
		key: "demon",
		desc: "tDemonD",
		role: "tDemon",
		over: (x) => Math.max(tr(x, "motor"), tr(x, "hustle")) - 80,
	},
	{
		key: "offBall",
		desc: "tOffBallD",
		role: "tOffBall",
		over: (x, _pct, group) =>
			group !== "big" ? tr(x, "offBall") - TRAIT_WORD_MIN : -1,
	},
	{
		key: "hustle",
		desc: "tHustleD",
		role: "tHustler",
		over: (x) => tr(x, "hustle") - TRAIT_WORD_MIN,
	},
];
// His strongest trait keyword, if any
const traitKeywordOf = (
	x: NounInput,
	pct: Record<NounKey, number>,
	group: PosGroup,
): TraitKeyword | undefined => {
	let best: TraitKeyword | undefined;
	let bestOver = -Infinity;
	for (const t of TRAIT_KEYWORDS) {
		const o = t.over(x, pct, group);
		if (o >= 0 && o > bestOver) {
			best = t;
			bestOver = o;
		}
	}
	return best;
};
// (Connector: an end word with no trait: good passing and IQ, no standout skill)
const connector = (pct: Record<NounKey, number>) =>
	pct.pass >= 0.55 && pct.crafty >= 0.55;

// ---- the pick ----
export type NounInput = {
	r: ArchetypeRatings;
	pos: Pos;
	ovr?: number;
	pot?: number;
	age?: number;
	prospect?: boolean;
	traits?: Record<string, number>;
	rq?: RatingQuantiles;
	// last season's pick, to keep its order when it is still about as good
	prev?: { special?: string; nouns?: NounKey[]; trait?: string };
	// the user's "Doesn't fit" verdicts with no pick
	rejected?: readonly Rejection[];
	// how common each label is in the league (share, by id): a near-tie goes to the rarer name
	common?: Record<string, number>;
};
// (a name held by 10% of the league pays SPREAD_PEN * 0.1 in a tie: enough to settle a near-tie, never to beat a better fit)
export const SPREAD_PEN = 3;
export type NounPick = (
	| {
			kind: "special";
			id: string;
			name: string;
			nouns: NounKey[];
			conf: number;
	  }
	| {
			kind: "composed";
			// descriptor keys, in noun order, and the position word
			descs: string[];
			role: PosWord;
			nouns: NounKey[];
			conf: number;
			// display variants of its words (grammar.ts WordPick)
			pick?: Record<string, string>;
	  }
	| { kind: "trait"; key: string; name: string; conf: number }
	// no name of his own from his nouns: an honest name, about this noun (or about nothing)
	| { kind: "honest"; noun?: NounKey; conf: number }
) & {
	// the defensive label
	defense?: string;
};

// How sure the name is (0..1): how clearly his named nouns clear the bar and stand above the next one he isn't named for
const confOf = (cleared: readonly NounScore[], named: readonly NounKey[]) => {
	const pcts = named
		.map((n) => cleared.find((c) => c.key === n)?.pct)
		.filter((p): p is number => p !== undefined);
	if (pcts.length === 0) {
		return 0.5;
	}
	const low = Math.min(...pcts);
	const next =
		cleared.find((c) => !named.includes(c.key))?.pct ?? NOUN_CLEAR - 0.1;
	const clear = Math.min(1, (low - NOUN_CLEAR) / 0.2);
	const gap = Math.min(1, Math.max(0, (low - next) / 0.1));
	return Math.round((0.4 + 0.35 * clear + 0.25 * gap) * 100) / 100;
};

const groupOfPos = (pos: Pos): PosGroup =>
	pos === "PG" || pos === "G" || pos === "SG"
		? "guard"
		: pos === "GF" || pos === "SF" || pos === "F"
			? "wing"
			: "big";

// The sub-rating that leads (by SUB_LEAN or more) among some, or undefined
const leadSub = (r: ArchetypeRatings, keys: string[]): string | undefined => {
	const v = keys
		.map((k) => ({ k, v: sub(r, k) }))
		.filter((x): x is { k: string; v: number } => x.v !== undefined)
		.sort((a, b) => b.v - a.v);
	return v.length >= 2 && v[0]!.v - v[1]!.v >= SUB_LEAN ? v[0]!.k : undefined;
};
// (the user: "split common labels using sub-ratings": the plain word of a noun says which kind of it he is)
const SUB_WORD: Partial<
	Record<
		NounKey,
		{ keys: string[]; words: Record<string, string>; groups?: PosGroup[] }
	>
> = {
	three: {
		keys: ["tcs", "tod"],
		words: { tcs: "spotUp", tod: "pullUp" },
		groups: ["guard", "wing"],
	},
	finish: {
		keys: ["con", "fns"],
		words: { con: "powerFinishing", fns: "finesse" },
	},
	post: {
		keys: ["pst", "cls", "flt"],
		words: { cls: "closeRange", flt: "floater" },
		groups: ["guard", "wing"],
	},
	handle: { keys: ["hnd", "sec"], words: { hnd: "shifty", sec: "steady" } },
	rimD: {
		keys: ["blk", "idf"],
		words: { blk: "shotBlocking", idf: "postDefending" },
	},
	speed: { keys: ["sls", "lat"], words: { lat: "twitchy" } },
};
export const nounWord = (
	n: NounKey,
	elite: boolean,
	group: PosGroup,
	r?: ArchetypeRatings,
): string => {
	const w = NOUN_DESC[n];
	if (elite) {
		return w.eliteByGroup?.[group] ?? w.elite ?? w.byGroup?.[group] ?? w.desc;
	}
	const sw = SUB_WORD[n];
	if (r && sw && (!sw.groups || sw.groups.includes(group))) {
		const k = leadSub(r, sw.keys);
		const d = k ? sw.words[k] : undefined;
		if (d) {
			return d;
		}
	}
	return w.byGroup?.[group] ?? w.desc;
};
for (const [n, sw] of Object.entries(SUB_WORD)) {
	for (const d of Object.values(sw!.words)) {
		DESC_NOUN[d] ??= n as NounKey;
	}
}

// ---- the name checker (the user: no name that repeats a word or an idea, stacks more than three descriptors or
// pairs opposite ideas) ----
const STOP_WORDS: ReadonlySet<string> = new Set(["the", "and", "of", "way"]);
const OPPOSITES: [RegExp, RegExp][] = [
	[
		/Backline|Shot-Eras|Rim-Protect|Paint-Protect|Rim-Reap/,
		/Mid-Range|Middy|Pull-Up|Sniper|Sharpshoot|Shot Hunter/,
	],
	[/Lockdown|Defensive/, /Empty-Calorie|Offensive-Minded/],
	[/Earthbound|Slow-Motion/, /High-Flying|Speedy|Bouncy|Burner/],
];
export const nameProblem = (name: string): string | undefined => {
	const toks = name
		.split(/[\s-]+/)
		.map((t) => t.toLowerCase())
		.filter((t) => t.length > 2 && !STOP_WORDS.has(t));
	if (new Set(toks).size !== toks.length) {
		return "repeats a word";
	}
	const cs = conceptsOf(name);
	if (cs.length > 4) {
		return "more than three descriptors";
	}
	const single = cs
		.map((c) => CONCEPT_NOUNS[c.key])
		.filter((m): m is NounKey[] => Array.isArray(m) && m.length === 1)
		.map((m) => m[0]!);
	if (new Set(single).size !== single.length) {
		return "repeats an idea";
	}
	for (const [a, b] of OPPOSITES) {
		if (a.test(name) && b.test(name)) {
			return "opposite ideas";
		}
	}
	return undefined;
};

// ---- the words' promises (archnouns4, the user's 2053 audit): every word of a name is checked against what it
// promises, the same way for every kind of name (special names, the user's own names, noun names, end words, honest
// names, defensive labels). A skill word needs its noun in the league's top 30% AND among his three best; a trait word
// needs the trait at its bar; an elite word an elite ovr. (The user's audit reads each word on its own: "Wing-Running"
// is his motor, "Hammer" his strength, "Defensive" his perimeter D, "Step Back" his handle and shot creation.)
export type NameCtx = {
	// his nouns in the league's top 30% (crafty apart), and his three best of them
	cleared: ReadonlySet<NounKey>;
	top3: ReadonlySet<NounKey>;
	// his standing at a noun (0..1)
	pct: (k: NounKey) => number;
	// his shot-creation sub-rating's standing (undefined without sub-ratings)
	crtPct?: number;
	traits?: Record<string, number>;
	eliteOvr: boolean;
	mobile: boolean;
	ovr: number;
	// a young player with upside (honest.ts hasUpside)
	upside: boolean;
};
type WordReq =
	// each of these nouns: top 30% and among his three best
	| { re: RegExp; nouns: NounKey[]; why: string }
	// one of these nouns in the top 30%
	| { re: RegExp; any: NounKey[]; why: string }
	// a trait at its bar (no traits: never)
	| { re: RegExp; trait: string; min: number; why: string }
	| { re: RegExp; check: (c: NameCtx) => boolean; why: string };
const OFF_NOUNS: NounKey[] = [
	"three",
	"mid",
	"post",
	"finish",
	"handle",
	"pass",
];
export const WORD_REQ: WordReq[] = [
	// shooting
	{
		re: /\b3PT\b|\bThree\b(?!-Level)|Sniper|Sharpshoot|Shooter|Shooting|Spacer|Spacing|Marksman|Deadeye|Splash|Logo|\bArc\b|Deep\b|Bomber|Stretch|Pick & Pop|Pick-and-Pop|Popp|Catch & Shoot|Catch-and-Shoot|Corner|Trey/,
		nouns: ["three"],
		why: "3PT",
	},
	{
		re: /Gunner|Shot Hunter|Shotmaker|Shot-Maker|Jumper\b/,
		any: ["three", "mid"],
		why: "a jumper (3PT or mid-range)",
	},
	{
		re: /Three-Level|3-Level/,
		nouns: ["three", "mid"],
		why: "three levels",
	},
	{
		re: /Scorer|Bucket|\bScoring\b/,
		any: ["three", "mid", "post", "finish"],
		why: "a scoring skill",
	},
	{
		re: /Mid-Range|Middy|Mid-Post|Pull-Up|Fadeaway|Fading|\bFade\b|Maestro|Elbow/,
		nouns: ["mid"],
		why: "mid-range",
	},
	{
		re: /\bPost(?![ -]Defend)|Footwork|Pharaoh|Step-Through|Back-to-Basket|Bully|\bPaint\b(?![ -]Finish)/,
		nouns: ["post"],
		why: "post scoring",
	},
	{
		re: /Finish|Dunk|Rim Wrecker|Rim-Wreck|Hammer|Slam|Layup|Acrobat|Attacker|Rim-Rocking|Rim-Running|Rim Runner|Cutter|Lob\b/,
		nouns: ["finish"],
		why: "finishing",
	},
	{
		re: /\bArtist\b/,
		check: (c) =>
			(c.cleared.has("finish") && c.top3.has("finish")) ||
			(c.cleared.has("mid") && c.top3.has("mid")),
		why: "finishing or mid-range touch",
	},
	// handle and creation
	{
		re: /Ball-Handling|Handle|Shifty|\bIso\b|Step Back|Step-Back|Shot-Creat|Shot Creator|Creator|Ankle|Live-Dribble|Dribbl|Driver/,
		nouns: ["handle"],
		why: "ball handling",
	},
	{
		re: /Step Back|Step-Back|Live-Dribble|Shot-Creat|Shot Creator|Ankle/,
		check: (c) => c.crtPct === undefined || c.crtPct >= NOUN_CLEAR,
		why: "the shot-creation sub-rating",
	},
	{
		re: /Slash|Open-Lane/,
		check: (c) => c.pct("handle") >= 0.5 && c.cleared.has("speed"),
		why: "a slasher's handle (top 50%) and speed",
	},
	// passing, rebounding
	{
		re: /Playmak|\bDime|Diming|Dimming|Engine|Facilitat|\bPoint\b(?!-of)|Wizard|Table-Setting|Connector|\bHub\b|Catalyst|Passing(?!-Lane)|Architect|General|Triple-Double|Distribut|Outlet/,
		nouns: ["pass"],
		why: "passing",
	},
	{
		re: /Glass|Rebound|Board|Cleaner|Putback|Crash/,
		nouns: ["reb"],
		why: "rebounding",
	},
	// athleticism
	{
		re: /Speedy|Glider|\bGlide\b|Burner|Track Star|\bJet\b|Blur|Open-Lane|Transition|Twitchy|Quick|\bFast\b|Speed/,
		nouns: ["speed"],
		why: "speed",
	},
	{
		re: /High-Flying|Flyer|Flier|Pogo|Bouncy|Aerial|Highlight|Hops|Leap|Springy|Yamming|Riser|Above-the-Rim|\bAir\b/,
		nouns: ["jump"],
		why: "leaping",
	},
	// (archnouns4, the user: "a lot of high flyer builds": a high flyer also uses it, at the rim)
	{
		re: /High-Flying|Flyer|Flier|Highlight|Above-the-Rim|Aerial/,
		check: (c) =>
			c.pct("finish") >= HIGH_FLYER_FINISH || c.pct("jump") >= HIGH_FLYER_ALONE,
		why: "finishing in the top 40%, or leaping in the top 5% (a high flyer uses his leaping at the rim)",
	},
	{
		re: /Physical|Bulldozer|Bruiser|Hammer|Strong|Bully|Space Eater|\bWall\b|Brute|Muscle/,
		nouns: ["strength"],
		why: "strength",
	},
	// defense
	{
		re: /Defensive|Lockdown|Stopper|Glove|3 & D|3-and-D|Perimeter Defender|Clamp|\bLock\b|Stalker/,
		nouns: ["perimD"],
		why: "perimeter D",
	},
	{
		re: /Two-Way|2-Way/,
		check: (c) =>
			(c.cleared.has("perimD") || c.cleared.has("rimD")) &&
			OFF_NOUNS.some((n) => c.cleared.has(n)),
		why: "two ways (a defensive and an offensive skill in the top 30%)",
	},
	{
		re: /Rim-Protect|Rim Protector|Shot-Block|Shot Blocker|Eras|Anchor|Swat|Post-Defend|Post Defender|Protector/,
		nouns: ["rimD"],
		why: "rim protection",
	},
	{
		re: /Ball-Hawk|Ball Hawk|Interceptor|Pickpocket|Pick-Pocket|Pick Pocket|Thief|Passing-Lane|Menace/,
		nouns: ["steal"],
		why: "steals",
	},
	{
		re: /Lockdown|\bLock\b|Clamp/,
		check: (c) => c.mobile,
		why: "mobility",
	},
	// versatility: four skills in the top 30%
	{
		re: /Jack|Swiss|Do-It-All|All-Around/,
		check: (c) => c.cleared.size >= JACK_CLEARED,
		why: `${4} skills in the top 30%`,
	},
	// traits
	{
		re: /Wing-Running|Rim-Running|Demon|Motor|Workhorse|Relentless/,
		trait: "motor",
		min: 50,
		why: "motor",
	},
	{
		re: /Hustl|\bPest\b|Chaos|Junkyard|Energy|Pressure|Gritty|Grinder/,
		trait: "hustle",
		min: 55,
		why: "hustle",
	},
	{
		re: /Switch/,
		trait: "defensiveVersatility",
		min: 55,
		why: "defensive versatility",
	},
	{
		re: /By-the-Book|By-The-Book|Caretaker|Steady/,
		trait: "consistency",
		min: 55,
		why: "consistency",
	},
	{
		re: /Caretaker/,
		trait: "shotDiscipline",
		min: 50,
		why: "shot discipline",
	},
	{ re: /Clutch|Closer|Ice-Cold/, trait: "clutch", min: 55, why: "clutch" },
	{ re: /Off-Ball|Cutter|Mover/, trait: "offBall", min: 55, why: "off-ball" },
	{
		re: /Roll Man|Roll-Man|Rolling|Screen/,
		trait: "screen",
		min: 50,
		why: "screen setting",
	},
	{
		re: /Savvy|Veteran|Old Head/,
		trait: "veteranSavvy",
		min: 55,
		why: "veteran savvy",
	},
	{ re: /Ruthless/, trait: "competitiveness", min: 55, why: "competitiveness" },
	{ re: /Iron\b|Durable/, trait: "durability", min: 55, why: "durability" },
	// elite words, development words
	{ re: ELITE_RE, check: (c) => c.eliteOvr, why: "an elite ovr" },
	{
		re: /\bRaw\b|Developing|Project|Late Bloomer|Lottery/,
		check: (c) => c.ovr <= DEV_MAX_OVR || c.cleared.size === 0,
		why: "ovr 30 or below, or no skill",
	},
];
// Four skills in the top 30% for a versatility name (the user's audit says three; the coordinator's ask: more breadth)
export const JACK_CLEARED = 4;
// A High-Flying name also needs his finishing at this standing
export const HIGH_FLYER_FINISH = 0.6;
// (or his leaping alone at this standing)
export const HIGH_FLYER_ALONE = 0.95;
// What a name promises that he doesn't have (empty: every word fits)
export const namePromises = (name: string, c: NameCtx): string[] => {
	const out: string[] = [];
	for (const w of WORD_REQ) {
		if (!w.re.test(name)) {
			continue;
		}
		if ("nouns" in w) {
			for (const n of w.nouns) {
				if (!c.cleared.has(n)) {
					out.push(`${w.why}: not in the top 30%`);
				} else if (!c.top3.has(n)) {
					out.push(`${w.why}: not one of his three best`);
				}
			}
		} else if ("any" in w) {
			if (!w.any.some((n) => c.cleared.has(n))) {
				out.push(`${w.why}: none in the top 30%`);
			}
		} else if ("trait" in w) {
			if ((c.traits?.[w.trait] ?? -Infinity) < w.min) {
				out.push(`${w.why}: trait below ${w.min}`);
			}
		} else if (!w.check(c)) {
			out.push(`needs ${w.why}`);
		}
	}
	return out;
};

// ---- the user's "Doesn't fit" verdicts ----
// A rejected name is never his again, and never a player's whose standings are within REJECT_NEAR of his (mean over the
// nouns)
export const REJECT_NEAR = 0.08;
export type Rejection = {
	name: string;
	own: boolean;
	pct?: Partial<Record<NounKey, number>>;
};
const normName = (n: string) =>
	n
		.toLowerCase()
		.replace(/[\s-]+/g, " ")
		.trim();

// ---- length (Expanded Ratings: wingspan well above his height) ----
export const LONG_MIN = 7;
const isLong = (r: ArchetypeRatings) =>
	typeof r.wng === "number" && r.wng - r.hgt >= LONG_MIN;

// ---- the user's own special names (tested on his nouns, sub-ratings and traits; checked before anything else) ----
type SpecialCtx = {
	pos: Pos;
	// his ovr's standing in the league (0..1)
	ovrPct?: number;
	pct: Record<NounKey, number>;
	r: ArchetypeRatings;
	traits?: Record<string, number>;
	eliteOvr: boolean;
	ovr: number;
	best: NounKey | undefined;
};
const subGe = (r: ArchetypeRatings, a: string, ...others: string[]) =>
	others.every((o) => (sub(r, a) ?? 0) >= (sub(r, o) ?? 0));
const traitOk = (
	t: Record<string, number> | undefined,
	k: string,
	min: number,
) => t === undefined || (t[k] ?? 0) >= min;
export const CUSTOM_SPECIALS: {
	key: string;
	positions: readonly Pos[];
	nouns: NounKey[];
	// a name about many skills: it need not have his best one
	anyBest?: true;
	test: (c: SpecialCtx) => boolean;
}[] = [
	{
		key: "sSwimStopper",
		positions: ["PG", "G", "SG", "GF", "SF", "F"],
		nouns: ["perimD", "mid"],
		test: ({ pct, r }) =>
			pct.perimD >= 0.85 &&
			subGe(r, "pdf", "stl") &&
			pctOf("spd", sub(r, "lat") ?? r.spd) >= 0.7 &&
			pct.mid >= 0.7,
	},
	{
		key: "sPaintSniper",
		positions: ["PG", "G", "SG", "GF", "SF", "F"],
		nouns: ["three", "post"],
		test: ({ pct, r, eliteOvr }) =>
			eliteOvr &&
			pct.three >= ELITE_PCT &&
			pct.post >= 0.7 &&
			((sub(r, "cls") ?? 0) > (sub(r, "pst") ?? 0) ||
				(sub(r, "flt") ?? 0) > (sub(r, "pst") ?? 0)),
	},
	{
		key: "sRuthlessBully",
		positions: ["PF", "FC", "C"],
		nouns: ["strength", "post"],
		test: ({ pct, r, traits }) =>
			pct.strength >= 0.9 &&
			pct.post >= 0.8 &&
			subGe(r, "pst", "cls", "flt") &&
			subGe(r, "con", "fns") &&
			// (Ruthless: the competitiveness trait, the user's choice)
			traits !== undefined &&
			(traits.competitiveness ?? 0) >= TRAIT_WORD_MIN,
	},
	{
		key: "sPickPocket",
		positions: ["PG", "G", "SG", "GF", "SF"],
		nouns: ["steal", "finish"],
		test: ({ pct }) =>
			pct.steal >= 0.85 &&
			pct.finish >= 0.7 &&
			pct.handle >= 0.6 &&
			pct.speed >= 0.6,
	},
	{
		key: "sShowtimer",
		positions: ["PG", "G", "SG", "GF", "SF", "F"],
		nouns: ["finish", "jump", "speed"],
		test: ({ pct, r }) =>
			pct.finish >= 0.85 &&
			subGe(r, "con", "fns") &&
			pct.jump >= 0.8 &&
			pct.speed >= 0.8 &&
			subGe(r, "sls", "lat"),
	},
	{
		key: "sByTheBook",
		positions: ["PG", "G"],
		nouns: ["pass", "crafty"],
		test: ({ pct, r, traits }) =>
			subGe(r, "sec", "hnd", "crt") &&
			pct.pass >= 0.6 &&
			pct.crafty >= 0.7 &&
			traitOk(traits, "shotDiscipline", 55),
	},
	{
		key: "sPostPilot",
		positions: ["FC", "C"],
		nouns: ["rimD", "post", "pass"],
		test: ({ pct, eliteOvr }) =>
			eliteOvr && pct.rimD >= ELITE_PCT && pct.post >= 0.85 && pct.pass >= 0.7,
	},
	...USER_SPECIALS_2(),
	...USER_SPECIALS_3(),
	{
		key: "sSlashMiddyF",
		positions: ["SF", "F", "PF"],
		nouns: ["finish", "handle", "mid"],
		test: ({ pct }) => pct.finish >= 0.7 && pct.handle >= 0.6 && pct.mid >= 0.7,
	},
];
// The user's second list (archnouns2)
function USER_SPECIALS_2(): {
	key: string;
	positions: readonly Pos[];
	nouns: NounKey[];
	anyBest?: true;
	test: (c: SpecialCtx) => boolean;
}[] {
	const G_F: Pos[] = ["PG", "G", "SG", "GF", "SF", "F"];
	const G_SF: Pos[] = ["PG", "G", "SG", "GF", "SF"];
	const SF_PF: Pos[] = ["SF", "F", "PF"];
	const BIGS: Pos[] = ["PF", "FC", "C"];
	const lead = (r: ArchetypeRatings, a: string, b: string) =>
		(sub(r, a) ?? 0) > (sub(r, b) ?? 0);
	const tr = (c: SpecialCtx, k: string) => c.traits?.[k] ?? 0;
	const count = (c: SpecialCtx, min: number) =>
		NOUNS.filter((n) => n !== "crafty" && c.pct[n] >= min).length;
	return [
		{
			key: "sMidnightHash",
			positions: G_F,
			nouns: ["mid", "three"],
			test: (c) =>
				c.eliteOvr &&
				c.pct.mid >= ELITE_PCT &&
				c.pct.three >= ELITE_PCT &&
				tr(c, "clutch") >= 75,
		},
		{
			key: "sSwissArmy",
			positions: ["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"],
			nouns: [],
			anyBest: true,
			test: (c) =>
				count(c, NOUN_CLEAR) >= 8 &&
				NOUNS.some((n) => n !== "crafty" && c.pct[n] >= 0.85),
		},
		{
			key: "sSwitchblade",
			positions: G_SF,
			nouns: ["creator", "handle", "perimD"],
			test: (c) =>
				c.pct.creator >= 0.85 &&
				c.pct.handle >= 0.8 &&
				c.pct.perimD >= 0.7 &&
				pctOf("spd", sub(c.r, "lat") ?? c.r.spd) >= 0.7,
		},
		{
			key: "sFadeawayTech",
			positions: ["SF", "F", "PF"],
			nouns: ["mid", "post"],
			test: (c) =>
				c.pct.mid >= 0.85 &&
				lead(c.r, "pul", "spu") &&
				c.pct.post >= 0.7 &&
				Math.max(c.pct.perimD, c.pct.rimD) >= 0.7 &&
				c.pct.crafty >= 0.7,
		},
		{
			key: "sVelvetStepBack",
			positions: ["GF", "SF"],
			nouns: ["three", "handle"],
			test: (c) =>
				c.pct.three >= 0.85 &&
				lead(c.r, "tod", "tcs") &&
				c.pct.handle >= 0.7 &&
				!lead(c.r, "con", "fns"),
		},
		{
			key: "sClampCreate",
			positions: ["SG", "GF", "SF"],
			nouns: ["perimD", "creator"],
			test: (c) => c.eliteOvr && c.pct.perimD >= 0.85 && c.pct.creator >= 0.8,
		},
		{
			key: "sArcCatalyst",
			positions: G_SF,
			nouns: ["three", "pass", "perimD"],
			test: (c) =>
				c.pct.three >= 0.8 && c.pct.pass >= 0.7 && c.pct.perimD >= 0.7,
		},
		{
			key: "sWingMarksman",
			positions: ["GF", "SF"],
			nouns: ["three", "mid"],
			test: (c) =>
				c.pct.three >= 0.85 && c.pct.mid >= 0.8 && c.pct.speed >= 0.6,
		},
		{
			key: "sSwitchProof",
			positions: G_F,
			nouns: ["creator"],
			test: (c) =>
				c.eliteOvr &&
				c.pct.creator >= 0.85 &&
				c.pct.strength >= 0.6 &&
				tallForPos(c.r, c.pos),
		},
		{
			key: "sBackcourtWing",
			positions: ["SG", "GF"],
			nouns: ["three", "mid"],
			test: (c) => c.pct.three >= 0.8 && c.pct.mid >= 0.8,
		},
		{
			key: "sTrailThree",
			positions: BIGS,
			nouns: ["rimD", "three"],
			test: (c) =>
				c.eliteOvr &&
				c.pct.rimD >= ELITE_PCT &&
				c.pct.three >= 0.7 &&
				c.pct.speed >= 0.6,
		},
		{
			key: "sHighPostStretch",
			positions: BIGS,
			nouns: ["three", "mid"],
			test: (c) => c.pct.three >= 0.8 && c.pct.mid >= 0.8 && c.pct.pass >= 0.6,
		},
		{
			key: "sTripleStretch",
			positions: BIGS,
			nouns: ["reb", "pass", "three"],
			test: (c) =>
				c.eliteOvr &&
				c.pct.reb >= 0.85 &&
				c.pct.pass >= 0.8 &&
				c.pct.three >= 0.7 &&
				c.pct.rimD >= 0.7,
		},
		{
			key: "sUnicornBig",
			positions: ["FC", "C"],
			nouns: [],
			anyBest: true,
			test: (c) =>
				c.eliteOvr &&
				count(c, NOUN_CLEAR) >= 5 &&
				c.pct.three >= NOUN_CLEAR &&
				Math.max(c.pct.handle, c.pct.pass) >= NOUN_CLEAR,
		},
		{
			key: "sPaintWarden",
			positions: BIGS,
			nouns: ["rimD", "perimD"],
			test: (c) =>
				c.pct.rimD >= 0.85 &&
				c.pct.perimD >= 0.7 &&
				pctOf("spd", sub(c.r, "lat") ?? c.r.spd) >= 0.6 &&
				tr(c, "defensiveVersatility") >= 70,
		},
		{
			key: "sHybridFive",
			positions: ["C"],
			nouns: ["three"],
			test: (c) =>
				c.pct.three >= 0.7 &&
				Math.max(c.pct.handle, c.pct.pass) >= 0.7 &&
				c.pct.speed >= 0.6,
		},
		{
			key: "sPutbackJuggernaut",
			positions: BIGS,
			nouns: ["reb", "strength"],
			test: (c) =>
				c.eliteOvr &&
				c.pct.reb >= 0.9 &&
				lead(c.r, "orb", "drd") &&
				c.pct.strength >= 0.8 &&
				tr(c, "motor") >= 70,
		},
		{
			key: "sGlassTitan",
			positions: BIGS,
			nouns: ["post", "reb", "strength"],
			test: (c) =>
				c.eliteOvr &&
				c.pct.post >= 0.85 &&
				subGe(c.r, "pst", "cls", "flt") &&
				c.pct.reb >= 0.85 &&
				c.pct.strength >= 0.8,
		},
		{
			key: "sMismatchIso",
			positions: SF_PF,
			nouns: ["creator", "pass"],
			test: (c) =>
				c.pct.creator >= 0.8 && c.pct.pass >= 0.8 && tallForPos(c.r, c.pos),
		},
		{
			key: "sForwardHub",
			positions: ["F", "PF"],
			nouns: ["pass", "mid"],
			test: (c) => c.pct.pass >= 0.8 && c.pct.mid >= 0.7 && c.pct.crafty >= 0.7,
		},
		{
			key: "sHelpDisruptor",
			positions: ["GF", "SF", "F", "PF"],
			nouns: ["steal", "rimD"],
			test: (c) => c.pct.steal >= 0.85 && c.pct.rimD >= 0.7,
		},
		{
			key: "sBaselineCutter",
			positions: ["GF", "SF", "F"],
			nouns: ["finish"],
			test: (c) =>
				c.pct.finish >= 0.8 && tr(c, "offBall") >= 65 && c.pct.speed >= 0.6,
		},
		{
			key: "sOpenCourtSlasher",
			positions: G_SF,
			nouns: ["speed", "finish"],
			test: (c) =>
				c.pct.speed >= 0.85 &&
				lead(c.r, "sls", "lat") &&
				c.pct.finish >= 0.8 &&
				c.pct.handle >= 0.6 &&
				tr(c, "motor") >= 70,
		},
		{
			key: "sCornerCombo",
			positions: SF_PF,
			nouns: ["three"],
			test: (c) =>
				c.pct.three >= 0.8 &&
				lead(c.r, "tcs", "tod") &&
				Math.max(c.pct.perimD, c.pct.reb) >= 0.7,
		},
		{
			key: "sPositionless",
			positions: SF_PF,
			nouns: [],
			anyBest: true,
			test: (c) =>
				count(c, NOUN_CLEAR) >= 5 &&
				Math.max(c.pct.three, c.pct.mid, c.pct.finish, c.pct.post) >=
					GENERIC_PCT &&
				Math.max(c.pct.pass, c.pct.handle) >= GENERIC_PCT &&
				Math.max(c.pct.perimD, c.pct.rimD, c.pct.steal) >= GENERIC_PCT,
		},
		{
			key: "sFourOut",
			positions: ["F", "PF"],
			nouns: ["three", "pass"],
			test: (c) =>
				c.pct.three >= 0.7 && c.pct.pass >= 0.6 && shortForPos(c.r, c.pos),
		},
	];
}

// The user's third list (archnouns3)
function USER_SPECIALS_3(): {
	key: string;
	positions: readonly Pos[];
	nouns: NounKey[];
	anyBest?: true;
	test: (c: SpecialCtx) => boolean;
}[] {
	const ALL_POS: Pos[] = ["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"];
	const GUARDS: Pos[] = ["PG", "G", "SG"];
	const PGG: Pos[] = ["PG", "G"];
	const G_F: Pos[] = ["PG", "G", "SG", "GF", "SF", "F"];
	const G_SF: Pos[] = ["PG", "G", "SG", "GF", "SF"];
	const WINGS: Pos[] = ["GF", "SF"];
	const SG_SF: Pos[] = ["SG", "GF", "SF"];
	const GF_F: Pos[] = ["GF", "SF", "F"];
	const GF_PF: Pos[] = ["GF", "SF", "F", "PF"];
	const SF_PF: Pos[] = ["SF", "F", "PF"];
	const SF_C: Pos[] = ["SF", "F", "PF", "FC", "C"];
	const SF_FC: Pos[] = ["SF", "F", "PF", "FC"];
	const F_C: Pos[] = ["F", "PF", "FC", "C"];
	const BIGS: Pos[] = ["PF", "FC", "C"];
	const lead = (r: ArchetypeRatings, a: string, b: string, by = 0) =>
		(sub(r, a) ?? 0) - (sub(r, b) ?? 0) > by;
	const tr = (c: SpecialCtx, k: string) => c.traits?.[k] ?? 0;
	const count = (c: SpecialCtx, min: number) =>
		NOUNS.filter((n) => n !== "crafty" && c.pct[n] >= min).length;
	const lat = (c: SpecialCtx) => pctOf("spd", sub(c.r, "lat") ?? c.r.spd);
	const elite = (c: SpecialCtx) => c.eliteOvr;
	const scoring = (c: SpecialCtx) =>
		Math.max(c.pct.three, c.pct.mid, c.pct.finish, c.pct.post);
	const S = (
		key: string,
		positions: Pos[],
		nouns: NounKey[],
		test: (c: SpecialCtx) => boolean,
		anyBest?: true,
	) => ({ key, positions, nouns, test, ...(anyBest ? { anyBest } : {}) });
	return [
		// Creators and playmakers
		S(
			"s3OffEngine",
			G_F,
			["pass", "creator", "crafty"],
			(c) =>
				elite(c) &&
				c.pct.pass >= 0.9 &&
				c.pct.creator >= 0.85 &&
				c.pct.crafty >= 0.9,
		),
		S(
			"s3OffCatalyst",
			G_F,
			["pass", "crafty"],
			(c) => c.pct.pass >= 0.75 && c.pct.crafty >= 0.9,
		),
		S(
			"s3DimeWizard",
			PGG,
			["pass", "handle"],
			(c) => elite(c) && c.pct.pass >= ELITE_PCT && c.pct.handle >= 0.85,
		),
		S(
			"s3DimeMaestro",
			PGG,
			["pass", "mid"],
			(c) =>
				elite(c) &&
				c.pct.pass >= ELITE_PCT &&
				c.pct.mid >= 0.8 &&
				lead(c.r, "pul", "spu"),
		),
		S(
			"s3PaintPlaymaker",
			GUARDS,
			["pass", "handle"],
			(c) =>
				c.pct.pass >= 0.8 &&
				c.pct.handle >= 0.75 &&
				Math.max(c.pct.finish, c.pct.post) >= 0.7,
		),
		S(
			"s3TempoConductor",
			PGG,
			["pass", "speed"],
			(c) => c.pct.pass >= 0.8 && c.pct.speed >= 0.75 && c.pct.perimD >= 0.7,
		),
		S(
			"s3PaceSetter",
			["PG"],
			["pass"],
			(c) =>
				c.pct.pass >= 0.7 &&
				subGe(c.r, "sec", "hnd", "crt") &&
				c.pct.speed < 0.5,
		),
		S(
			"s3LiveDribble",
			G_F,
			["pass", "handle"],
			(c) =>
				c.pct.pass >= 0.7 &&
				c.pct.handle >= 0.7 &&
				lead(c.r, "vis", "acc") &&
				NOUNS.every((n) => n === "crafty" || c.pct[n] < 0.9),
		),
		S(
			"s3SecondaryFacilitator",
			["SG", "GF", "SF", "F", "PF", "FC", "C"],
			["pass"],
			(c) => c.pct.pass >= 0.75 && c.pct.creator < 0.5,
		),
		S(
			"s3ShortRollHub",
			BIGS,
			["pass"],
			(c) =>
				c.pct.pass >= 0.8 &&
				Math.max(c.pct.mid, c.pct.finish) >= 0.7 &&
				tr(c, "screen") >= 60,
		),
		S(
			"s3PointWing",
			WINGS,
			["pass", "creator", "perimD"],
			(c) => c.pct.pass >= 0.8 && c.pct.creator >= 0.75 && c.pct.perimD >= 0.75,
		),
		S(
			"s3SecondarySwing",
			SG_SF,
			["creator", "pass"],
			(c) =>
				c.pct.creator >= 0.7 &&
				c.pct.pass >= 0.6 &&
				c.best !== "creator" &&
				c.best !== "handle",
		),
		// Scorers
		S(
			"s3IsoShotmaker",
			G_F,
			["three", "mid", "finish", "creator"],
			(c) =>
				elite(c) &&
				c.pct.three >= 0.75 &&
				c.pct.mid >= 0.75 &&
				c.pct.finish >= 0.75 &&
				c.pct.creator >= 0.85,
			true,
		),
		S(
			"s3IsoThreat",
			G_F,
			["three", "mid", "finish", "creator"],
			(c) =>
				c.pct.three >= 0.65 &&
				c.pct.mid >= 0.65 &&
				c.pct.finish >= 0.65 &&
				c.pct.creator >= 0.75,
			true,
		),
		S(
			"s3TripleThreatWing",
			WINGS,
			["three", "mid", "finish"],
			(c) => c.pct.three >= 0.7 && c.pct.mid >= 0.7 && c.pct.finish >= 0.7,
		),
		S(
			"s3OffBounce",
			G_F,
			["creator", "three"],
			(c) =>
				c.pct.creator >= 0.8 &&
				((c.pct.three >= 0.8 && lead(c.r, "tod", "tcs")) ||
					(c.pct.mid >= 0.8 && lead(c.r, "pul", "spu"))),
		),
		S(
			"s3PullUpCreator",
			G_F,
			["mid", "creator", "perimD"],
			(c) =>
				c.pct.mid >= 0.8 &&
				lead(c.r, "pul", "spu") &&
				c.pct.creator >= 0.75 &&
				c.pct.perimD >= 0.75,
		),
		S(
			"s3DeepBag",
			G_F,
			["creator", "mid", "crafty"],
			(c) =>
				c.pct.creator >= 0.8 &&
				c.pct.mid >= 0.8 &&
				c.pct.crafty >= 0.8 &&
				athletic(c.pct) < 0.5,
		),
		S(
			"s3FadeawayArtist",
			ALL_POS,
			["mid"],
			(c) =>
				c.pct.mid >= 0.85 && lead(c.r, "pul", "spu") && lead(c.r, "fns", "con"),
		),
		S(
			"s3PostFadeWing",
			WINGS,
			["mid", "post"],
			(c) => c.pct.mid >= 0.85 && lead(c.r, "pul", "spu") && c.pct.post >= 0.7,
		),
		S(
			"s3StepThrough",
			SF_C,
			["post", "mid"],
			(c) =>
				c.pct.post >= 0.75 &&
				(lead(c.r, "cls", "pst") || lead(c.r, "flt", "pst")) &&
				c.pct.mid >= 0.75 &&
				c.pct.crafty >= 0.7,
		),
		S(
			"s3ClutchCloser",
			ALL_POS,
			["three"],
			(c) => elite(c) && tr(c, "clutch") >= 80 && scoring(c) >= 0.85,
			true,
		),
		// Shooters
		S(
			"s3StepBackSniper",
			G_F,
			["three"],
			(c) =>
				elite(c) &&
				c.pct.three >= 0.95 &&
				lead(c.r, "tod", "tcs") &&
				subGe(c.r, "rng", "tcs"),
		),
		S(
			"s3StepBackGunner",
			G_F,
			["three"],
			(c) =>
				c.pct.three >= 0.85 &&
				lead(c.r, "tod", "tcs") &&
				c.traits !== undefined &&
				(c.traits.shotDiscipline ?? 100) <= 50,
		),
		S(
			"s3HighArcGunner",
			G_F,
			["three"],
			(c) =>
				c.pct.three >= 0.75 &&
				subGe(c.r, "rng", "tcs", "tod") &&
				c.traits !== undefined &&
				(c.traits.shotDiscipline ?? 100) <= 50,
		),
		S(
			"s3VolumeSpacer",
			G_F,
			["three"],
			(c) =>
				c.pct.three >= 0.8 &&
				NOUNS.every(
					(n) =>
						n === "three" || n === "crafty" || c.pct[n] <= c.pct.three - 0.12,
				),
		),
		S(
			"s3OffBallSniper",
			G_F,
			["three"],
			(c) => elite(c) && c.pct.three >= 0.9 && tr(c, "offBall") >= 70,
		),
		S(
			"s3OffScreenSniper",
			G_F,
			["three", "speed"],
			(c) =>
				elite(c) &&
				c.pct.three >= 0.9 &&
				lead(c.r, "tcs", "tod") &&
				c.pct.speed >= 0.6,
		),
		S(
			"s3FloorSpacer",
			ALL_POS,
			["three"],
			(c) =>
				c.pct.three >= 0.75 &&
				lead(c.r, "tcs", "tod", 5) &&
				NOUNS.filter((n) => n !== "three" && n !== "crafty" && c.pct[n] >= 0.7)
					.length <= 1,
		),
		S(
			"s3CornerPocket",
			["GF", "SF", "F", "PF"],
			["three"],
			(c) =>
				c.pct.three >= 0.75 && lead(c.r, "tcs", "tod") && c.pct.handle < 0.5,
		),
		// Wings, two-way and all-around
		S(
			"s3CompleteTwoWayWing",
			WINGS,
			["perimD"],
			(c) =>
				(
					["three", "mid", "finish", "pass", "handle", "creator"] as const
				).filter((n) => c.pct[n] >= 0.7).length >= 3 && c.pct.perimD >= 0.8,
			true,
		),
		S(
			"s3PlaymakingTwoWayWing",
			WINGS,
			["pass", "perimD"],
			(c) => c.pct.pass >= 0.75 && c.pct.perimD >= 0.75,
		),
		S(
			"s3GlueGuyWing",
			WINGS,
			["perimD"],
			(c) =>
				count(c, GENERIC_PCT) >= 3 &&
				NOUNS.every((n) => n === "crafty" || c.pct[n] < 0.85) &&
				c.pct.perimD >= 0.7 &&
				(c.traits === undefined || (c.traits.ego ?? 0) >= 60),
			true,
		),
		S(
			"s3CornerLockdown",
			WINGS,
			["perimD", "three"],
			(c) =>
				elite(c) &&
				c.pct.perimD >= ELITE_PCT &&
				c.pct.three >= 0.7 &&
				lead(c.r, "tcs", "tod"),
		),
		S(
			"s3LockdownAce",
			G_F,
			["three", "mid", "finish", "perimD"],
			(c) =>
				elite(c) &&
				(c.ovrPct ?? 0) >= 0.95 &&
				c.pct.three >= 0.75 &&
				c.pct.mid >= 0.75 &&
				c.pct.finish >= 0.75 &&
				c.pct.perimD >= 0.9,
			true,
		),
		S(
			"s3UnicornSwingman",
			SG_SF,
			["perimD", "rimD"],
			(c) =>
				elite(c) &&
				count(c, NOUN_CLEAR) >= 5 &&
				c.pct.perimD >= NOUN_CLEAR &&
				c.pct.rimD >= NOUN_CLEAR,
			true,
		),
		S("s3SmallBallRimWing", GF_F, ["rimD"], (c) => c.pct.rimD >= 0.8),
		S(
			"s3GlassCrashingWing",
			WINGS,
			["reb"],
			(c) =>
				c.pct.reb >= 0.8 &&
				lead(c.r, "orb", "drd") &&
				Math.max(c.pct.three, c.pct.perimD) >= 0.6,
		),
		S(
			"s3HustleWing",
			WINGS,
			["reb", "perimD"],
			(c) =>
				tr(c, "motor") >= 70 &&
				tr(c, "hustle") >= 70 &&
				Math.max(c.pct.reb, c.pct.perimD) >= 0.6,
		),
		S(
			"s3HustleSpark",
			G_F,
			["speed"],
			(c) =>
				tr(c, "motor") >= 70 &&
				tr(c, "hustle") >= 70 &&
				c.pct.speed >= 0.7 &&
				(c.ovrPct ?? 1) < 0.6,
		),
		S(
			"s3SwitchProofHybrid",
			SF_PF,
			["perimD", "rimD"],
			(c) => c.pct.perimD >= 0.75 && c.pct.rimD >= 0.75 && scoring(c) >= 0.7,
		),
		S(
			"s3SwissArmyThreat",
			ALL_POS,
			["perimD"],
			(c) =>
				count(c, NOUN_CLEAR) >= 8 &&
				Math.max(c.pct.perimD, c.pct.rimD, c.pct.steal) >= 0.85,
			true,
		),
		S(
			"s3AllCourtPrototype",
			ALL_POS,
			[],
			(c) => elite(c) && (c.ovrPct ?? 0) >= 0.95 && count(c, NOUN_CLEAR) >= 7,
			true,
		),
		S(
			"s3TwoWayAnomaly",
			["FC", "C"],
			["three", "rimD"],
			(c) =>
				elite(c) &&
				c.pct.three >= 0.8 &&
				c.pct.rimD >= 0.9 &&
				Math.max(c.pct.handle, c.pct.pass) >= 0.7,
		),
		// Athletes and finishers
		S(
			"s3TurboGuard",
			GUARDS,
			["speed", "finish"],
			(c) =>
				c.pct.speed >= 0.9 &&
				lead(c.r, "sls", "lat") &&
				c.pct.finish >= 0.75 &&
				c.pct.handle >= 0.7,
		),
		S(
			"s3LayupArtist",
			G_F,
			["finish", "jump"],
			(c) =>
				c.pct.finish >= 0.85 &&
				lead(c.r, "fns", "con") &&
				c.pct.jump >= 0.75 &&
				subGe(c.r, "flt", "pst"),
		),
		S(
			"s3TransitionSlasher",
			G_SF,
			["speed", "finish"],
			(c) =>
				c.pct.speed >= 0.85 && c.pct.finish >= 0.8 && lead(c.r, "con", "fns"),
		),
		S(
			"s3BaselineFinisher",
			SF_FC,
			["finish"],
			(c) => c.pct.finish >= 0.8 && tr(c, "offBall") >= 65,
		),
		S(
			"s3LobRunner",
			BIGS,
			["jump", "speed", "finish"],
			(c) =>
				c.pct.jump >= 0.85 &&
				lead(c.r, "mxv", "stj") &&
				c.pct.speed >= 0.7 &&
				c.pct.finish >= 0.75,
		),
		S(
			"s3PopFinisher",
			BIGS,
			["three", "finish"],
			(c) => c.pct.three >= 0.7 && c.pct.finish >= 0.7 && tr(c, "screen") >= 60,
		),
		// Defenders and rebounders
		S(
			"s3PressPest",
			GUARDS,
			["steal", "speed"],
			(c) =>
				c.pct.steal >= 0.85 &&
				c.pct.speed >= 0.75 &&
				Math.max(tr(c, "motor"), tr(c, "hustle")) >= 65,
		),
		S(
			"s3ClampLock",
			G_SF,
			["perimD"],
			(c) => elite(c) && c.pct.perimD >= 0.95 && lat(c) >= 0.8,
		),
		S(
			"s3SwitchAllStopper",
			G_F,
			["perimD"],
			(c) => c.pct.perimD >= 0.85 && tr(c, "defensiveVersatility") >= 70,
		),
		S(
			"s3InterceptorLock",
			G_F,
			["steal", "perimD"],
			(c) => elite(c) && c.pct.steal >= ELITE_PCT && c.pct.perimD >= 0.85,
		),
		S(
			"s3BallHawkMenace",
			G_F,
			["steal"],
			(c) =>
				c.pct.steal >= 0.85 &&
				scoring(c) >= 0.7 &&
				Math.max(tr(c, "motor"), tr(c, "competitiveness")) >= 70,
		),
		S(
			"s3WeakSideEraser",
			GF_PF,
			["rimD"],
			(c) => elite(c) && c.pct.rimD >= ELITE_PCT && lead(c.r, "blk", "idf"),
		),
		S(
			"s3IroncladAnchor",
			BIGS,
			["rimD", "strength"],
			(c) =>
				elite(c) &&
				c.pct.rimD >= ELITE_PCT &&
				lead(c.r, "idf", "blk") &&
				c.pct.strength >= 0.75 &&
				tr(c, "durability") >= 70,
		),
		S(
			"s3RelentlessCleaner",
			F_C,
			["reb"],
			(c) => c.pct.reb >= 0.9 && tr(c, "motor") >= 70,
		),
	];
}

// Jack-Of-All-Trades: JACK_MIN or more nouns in the top 40%, none in the top 10%
export const JACK_MIN = 5;
// A name about many skills gives way to a standout skill: one in the league's top 7%
export const STANDOUT_PCT = 0.93;

// ---- height for his position (the user's "tall for his position", "small for a four") ----
// The usual height rating at each position (generated leagues), and how far from it counts as tall or short
const HGT_AT_POS: Record<Pos, number> = {
	PG: 30,
	G: 34,
	SG: 38,
	GF: 44,
	SF: 48,
	F: 52,
	PF: 56,
	FC: 61,
	C: 65,
};
const HGT_SPREAD = 5;
export const tallForPos = (r: ArchetypeRatings, pos: Pos) =>
	r.hgt >= HGT_AT_POS[pos] + HGT_SPREAD;
export const shortForPos = (r: ArchetypeRatings, pos: Pos) =>
	r.hgt <= HGT_AT_POS[pos] - HGT_SPREAD;

// ---- end words (the user's nouns): in place of his position at the end of the name. One that says a noun (Maestro: his
// mid-range) needs that noun among his two shown, and the noun is then said by the end word alone ----
type EndCtx = {
	pct: Record<NounKey, number>;
	r: ArchetypeRatings;
	traits?: Record<string, number>;
	pos: Pos;
	group: PosGroup;
	elite: (k: NounKey) => boolean;
	shown: readonly NounKey[];
	ovr: number;
	// his ovr's standing in the league (0..1)
	ovrPct: number;
};
const GUARD_POS: ReadonlySet<Pos> = new Set(["PG", "G", "SG"]);
const lead2 = (r: ArchetypeRatings, a: string, b: string) =>
	(sub(r, a) ?? 0) > (sub(r, b) ?? 0);
const athletic = (pct: Record<NounKey, number>) =>
	Math.max(pct.speed, pct.jump);
export const END_WORDS: {
	key: string;
	covers?: NounKey;
	ok: (c: EndCtx) => boolean;
}[] = [
	// (archnouns3: the user's third list)
	{
		key: "eWalkingBucket",
		covers: "three",
		ok: (c) =>
			c.elite("three") ||
			(c.ovr >= ELITE_OVR_FLOOR &&
				c.pct.three >= 0.85 &&
				c.pct.mid >= 0.85 &&
				c.pct.finish >= 0.85 &&
				c.ovrPct >= 0.85),
	},
	{
		key: "eEngine",
		covers: "pass",
		ok: (c) =>
			c.ovr >= ELITE_OVR_FLOOR &&
			c.ovrPct >= 0.85 &&
			c.pct.pass >= 0.85 &&
			c.pct.creator >= 0.85 &&
			Math.max(c.pct.three, c.pct.mid, c.pct.finish) >= 0.85,
	},
	{
		key: "eDeadeye",
		covers: "three",
		ok: (c) =>
			c.ovr >= ELITE_OVR_FLOOR && c.ovrPct >= 0.85 && c.pct.three >= 0.95,
	},
	{
		key: "eGeneral",
		covers: "pass",
		ok: (c) =>
			c.pos === "PG" &&
			c.pct.pass >= 0.85 &&
			c.pct.crafty >= 0.8 &&
			c.elite("pass") &&
			(c.traits?.leadership ?? 0) >= 70,
	},
	{
		key: "eArchitect",
		covers: "pass",
		ok: (c) => c.elite("pass") && c.pct.crafty >= 0.85,
	},
	{
		key: "eWizard",
		covers: "pass",
		ok: (c) => c.elite("pass") && c.pct.handle >= 0.85,
	},
	{ key: "eMaestro", covers: "mid", ok: (c) => c.elite("mid") },
	{
		key: "eTechnician",
		covers: "crafty",
		ok: (c) =>
			c.pct.crafty >= 0.85 &&
			athletic(c.pct) < 0.5 &&
			(leadSub(c.r, ["pst", "cls", "flt"]) === "pst" ||
				leadSub(c.r, ["pul", "spu"]) === "pul"),
	},
	{
		key: "eArtist",
		covers: "finish",
		ok: (c) =>
			Math.max(c.pct.finish, c.pct.post) >= 0.8 &&
			(sub(c.r, "fns") ?? 0) > (sub(c.r, "con") ?? 0) &&
			(sub(c.r, "flt") ?? 0) >= (sub(c.r, "pst") ?? 0),
	},
	{
		key: "eGlider",
		covers: "speed",
		ok: (c) =>
			c.pct.speed >= 0.8 &&
			leadSub(c.r, ["sls", "lat"]) !== "lat" &&
			Math.max(c.pct.finish, c.pct.handle) >= 0.7,
	},
	{
		key: "eAttacker",
		covers: "finish",
		ok: (c) => c.pct.handle >= 0.7 && c.pct.finish >= 0.7 && c.pct.speed >= 0.6,
	},
	{
		key: "eInterceptor",
		covers: "steal",
		ok: (c) =>
			c.pct.steal >= 0.85 && (sub(c.r, "stl") ?? 0) > (sub(c.r, "pdf") ?? 0),
	},
	{
		key: "eProtector",
		covers: "rimD",
		ok: (c) => c.shown[0] === "rimD" && c.pct.rimD >= 0.8,
	},
	{
		key: "eFacilitator",
		covers: "pass",
		ok: (c) => c.shown[0] === "pass" && c.pct.pass >= 0.8 && c.pos !== "PG",
	},
	{
		key: "eCutter",
		covers: "finish",
		ok: (c) =>
			(c.traits?.offBall ?? 0) >= 60 &&
			c.pct.finish >= 0.7 &&
			c.pct.handle < 0.5,
	},
	{
		key: "eGunner",
		ok: (c) =>
			Math.max(c.pct.three, c.pct.mid) >= 0.7 &&
			c.traits !== undefined &&
			(c.traits.shotDiscipline ?? 100) <= 40,
	},
	{
		key: "eMover",
		ok: (c) => !BIG_POS.has(c.pos) && (c.traits?.offBall ?? 0) >= 70,
	},
	{
		key: "eConnector",
		ok: (c) =>
			c.pct.pass >= 0.55 &&
			c.pct.crafty >= 0.55 &&
			c.shown.every((n) => c.pct[n] < 0.85),
	},
	{
		key: "eSwingman",
		ok: (c) =>
			(c.pos === "SG" || c.pos === "GF" || c.pos === "SF") &&
			(["three", "finish", "handle", "perimD"] as const).filter(
				(n) => c.pct[n] >= 0.7,
			).length >= 2,
	},
	{
		key: "eAcrobat",
		covers: "finish",
		ok: (c) =>
			c.pct.finish >= 0.8 &&
			(sub(c.r, "fns") ?? 0) > (sub(c.r, "con") ?? 0) &&
			c.pct.jump >= 0.7,
	},
	{
		key: "eDriver",
		covers: "handle",
		ok: (c) =>
			c.pct.speed >= 0.7 &&
			c.pct.handle >= 0.7 &&
			leadSub(c.r, ["sls", "lat"]) !== "lat",
	},
	{
		key: "ePoint",
		covers: "pass",
		ok: (c) =>
			(c.pos === "PG" || c.pos === "G") &&
			c.pct.pass >= 0.7 &&
			c.pct.handle >= 0.7,
	},
	{
		key: "eDimer",
		covers: "pass",
		ok: (c) =>
			GUARD_POS.has(c.pos) && c.shown[0] === "pass" && c.pct.pass >= 0.8,
	},
	{
		key: "eSpacer",
		covers: "three",
		ok: (c) =>
			c.pct.three >= 0.8 &&
			!lead2(c.r, "tod", "tcs") &&
			NOUNS.every((n) => n === "three" || n === "crafty" || c.pct[n] < 0.85),
	},
	{
		key: "eCloser",
		ok: (c) =>
			(c.traits?.clutch ?? 0) >= 75 &&
			c.ovr >= 50 &&
			c.shown.some(
				(n) => n === "three" || n === "mid" || n === "finish" || n === "post",
			),
	},
	{
		key: "eWorkhorse",
		ok: (c) =>
			(c.r.endu ?? 0) >= 75 &&
			Math.max(c.traits?.durability ?? 0, c.traits?.motor ?? 0) >= 70,
	},
	{
		key: "eSpark",
		ok: (c) =>
			Math.max(c.traits?.motor ?? 0, c.traits?.hustle ?? 0) >= 70 &&
			c.pct.speed >= 0.7 &&
			c.ovrPct < 0.6,
	},
	{
		key: "eAce",
		ok: (c) =>
			c.ovr >= ELITE_OVR_FLOOR &&
			c.ovrPct >= 0.98 &&
			NOUNS.filter((n) => n !== "crafty" && c.pct[n] >= 0.9).length >= 2,
	},
	{
		key: "eScorer",
		ok: (c) =>
			(["three", "mid", "finish", "post"] as const).filter(
				(n) => c.pct[n] >= 0.7,
			).length >= 2 &&
			c.pct.pass < 0.7 &&
			Math.max(c.pct.perimD, c.pct.rimD) < 0.7,
	},
	{ key: "eFour", ok: (c) => c.pos === "PF" },
	{ key: "eFive", ok: (c) => c.pos === "C" },
];

// ---- the defensive label ----
const DEF_NOUNS: ReadonlySet<NounKey> = new Set(["rimD", "perimD", "steal"]);

// Whether his ovr is elite: the league's top ELITE_OVR_PCT, never below ELITE_OVR_FLOOR (no league table: NOUN_ELITE_OVR)
const eliteOvrOf = (ovr: number | undefined, rq?: RatingQuantiles) => {
	const ovrTable = tableOf("ovr", rq);
	return (
		ovr !== undefined &&
		(ovrTable
			? ovr >= ELITE_OVR_FLOOR && percentileIn(ovrTable, ovr) >= ELITE_OVR_PCT
			: ovr >= NOUN_ELITE_OVR)
	);
};
// archnouns4: what his name's words are checked against (namePromises)
export const nameCtxOf = (x: NounInput): NameCtx => {
	const scores = nounScores(x.r, x.rq);
	const cleared = clearedNouns(scores).filter((c) => c.key !== "crafty");
	const pct = Object.fromEntries(scores.map((s) => [s.key, s.pct])) as Record<
		NounKey,
		number
	>;
	const crt = sub(x.r, "crt");
	return {
		cleared: new Set(cleared.map((c) => c.key)),
		top3: new Set(cleared.slice(0, 3).map((c) => c.key)),
		pct: (k) => pct[k],
		...(crt === undefined ? {} : { crtPct: pctOf("drb", crt, x.rq) }),
		...(x.traits ? { traits: x.traits } : {}),
		eliteOvr: eliteOvrOf(x.ovr, x.rq),
		mobile: mobile(x.r, x.rq),
		ovr: x.ovr ?? 99,
		upside: hasUpside(x),
	};
};

export const pickNouns = (x: NounInput): NounPick => {
	const { r, pos, rq } = x;
	const group = groupOfPos(pos);
	const scores = nounScores(r, rq);
	let cleared = clearedNouns(scores);
	const eliteOvr = eliteOvrOf(x.ovr, rq);
	// archnouns4: every name's words are checked against what they promise
	const nctx = nameCtxOf(x);
	const fits = (name: string) => namePromises(name, nctx).length === 0;
	const isElite = (s: NounScore) =>
		eliteOvr &&
		s.pct >= ELITE_PCT &&
		// (Lockdown needs mobility: the user's audit)
		(s.key !== "perimD" || mobile(r, rq));
	const twoWay = twoWayOk(r, rq);
	const long = isLong(r);

	// The user's verdicts
	const pctOfKey = Object.fromEntries(
		scores.map((s) => [s.key, s.pct]),
	) as Record<NounKey, number>;
	const vetoed = (name: string) =>
		(x.rejected ?? []).some((rj) => {
			if (normName(rj.name) !== normName(name)) {
				return false;
			}
			if (rj.own || !rj.pct) {
				return rj.own;
			}
			let sum = 0;
			let n = 0;
			for (const k of NOUNS) {
				const v = rj.pct[k];
				if (v !== undefined) {
					sum += Math.abs(v - pctOfKey[k]);
					n++;
				}
			}
			return n > 0 && sum / n <= REJECT_NEAR;
		});
	const okName = (name: string) =>
		!vetoed(name) && !nameProblem(name) && fits(name);

	// Last season's order, while each of its nouns is within HYST of where it would be now
	const prevNouns = x.prev?.nouns;
	if (prevNouns && prevNouns.length > 0) {
		const k = prevNouns.length;
		const cut = cleared[k - 1]?.pct;
		const keep =
			cut !== undefined &&
			prevNouns.every((n) => {
				const s = cleared.find((c) => c.key === n);
				return s !== undefined && s.pct >= cut - HYST;
			});
		if (keep) {
			const head = prevNouns.map((n) => cleared.find((c) => c.key === n)!);
			cleared = [...head, ...cleared.filter((c) => !prevNouns.includes(c.key))];
		}
	}

	// The user's own special names first: the most specific that fits and has his best noun (a two-sided one names him
	// whole: no defensive label; archnouns4: an offensive one keeps his defensive label)
	let customPick: NounPick | undefined;
	let customDef = false;
	{
		const ctx: SpecialCtx = {
			pos,
			ovrPct: x.ovr === undefined ? 0 : pctOf("ovr", x.ovr, rq),
			pct: pctOfKey,
			r,
			traits: x.traits,
			eliteOvr,
			ovr: x.ovr ?? 0,
			best: cleared.find((c) => c.key !== "crafty")?.key,
		};
		const young = hasUpside(x) && (x.ovr ?? 99) <= DEV_MAX_OVR;
		const top3Custom = new Set<NounKey>(
			cleared
				.filter((c) => c.key !== "crafty")
				.slice(0, 3)
				.map((c) => (c.key === "creator" ? "handle" : c.key)),
		);
		top3Custom.add("crafty");
		let pick: (typeof CUSTOM_SPECIALS)[number] | undefined;
		let pickScore = -Infinity;
		if (!young) {
			for (const c of CUSTOM_SPECIALS) {
				if (!c.positions.includes(pos) || !c.test(ctx)) {
					continue;
				}
				// (the user's rule: one skill under ONE_NOUN_OVR is a specialist's honest name, not a one-skill special)
				if (
					c.nouns.length <= 1 &&
					!c.anyBest &&
					(x.ovr ?? 99) < ONE_NOUN_OVR &&
					cleared.filter((s2) => s2.key !== "crafty").length < 2
				) {
					continue;
				}
				// (archnouns3, the user's rule for every special name: all its skills among his three best)
				if (
					!c.anyBest &&
					!c.nouns.every((n) => top3Custom.has(n === "creator" ? "handle" : n))
				) {
					continue;
				}
				const best = ctx.best;
				const nouns: NounKey[] = c.nouns.map((n) =>
					n === "creator" ? "handle" : n,
				);
				if (
					!c.anyBest &&
					best &&
					!nouns.includes(best) &&
					!(best === "creator" && nouns.includes("handle"))
				) {
					continue;
				}
				// (archnouns3, the real-player check: a many-skills name never hides a true standout: with his best noun in the
				// league's top STANDOUT_PCT, the name must be about it)
				if (c.anyBest && best && pctOfKey[best] >= STANDOUT_PCT) {
					continue;
				}
				const role = ROLE_BY_KEY.get(c.key)!;
				const sc =
					c.nouns.reduce((sum, n) => sum + pctOfKey[n], 0) +
					c.nouns.length -
					SPREAD_PEN * (x.common?.[composedId(role, [], GROUP_OF[pos])] ?? 0);
				// (the user's own names: only his verdicts can rule one out; archnouns4: and every word must keep its promise)
				const cname = composeName(role, [], GROUP_OF[pos]);
				if (vetoed(cname) || !fits(cname)) {
					continue;
				}
				if (sc > pickScore) {
					pick = c;
					pickScore = sc;
				}
			}
		}
		if (pick) {
			const role = ROLE_BY_KEY.get(pick.key)!;
			customPick = {
				kind: "trait",
				key: pick.key,
				name: composeName(role, [], GROUP_OF[pos]),
				conf: confOf(cleared, pick.nouns),
			};
			customDef = pick.nouns.some((n) => DEF_NOUNS.has(n));
		}
		// (Jack-Of-All-Trades: many good skills, no great one; archnouns4: JACK_CLEARED skills in the top 30%)
		if (
			!pick &&
			!young &&
			nctx.cleared.size >= JACK_CLEARED &&
			scores.every((s) => s.pct < 0.9) &&
			(x.ovr ?? 0) >= 45 &&
			fits("Jack-Of-All-Trades") &&
			!vetoed("Jack-Of-All-Trades")
		) {
			return {
				kind: "trait",
				key: "sJack",
				name: "Jack-Of-All-Trades",
				conf: 0.6,
			};
		}
	}

	// The defensive label (the user: an offensive and a defensive label, "Pull-Up Shot Hunter · Point-of-Attack Pest"):
	// from his defensive nouns; his main name is then from the rest. A player whose only nouns are defensive keeps them
	// in his main name and has no second label.
	let defense: string | undefined;
	{
		// (a defensive noun names him when it is among his three best, or in the league's top 15%)
		const top3All = new Set(cleared.slice(0, 3).map((c) => c.key));
		// (archnouns3: for a star, near the top of the league at everything, "top 15%" says little: outside his three best
		// it must also be within 0.05 of his very best)
		const bestPct = cleared[0]?.pct ?? 0;
		// (a defensive skill among his three best names him, or one in the league's top 15% within 0.05 of his best: the
		// user's 2048 audit rules out a defensive label about a skill outside his three best)
		const d = cleared.filter(
			(c) =>
				DEF_NOUNS.has(c.key) &&
				(top3All.has(c.key) ||
					c.pct >= Math.max(DEF_LABEL_PCT, bestPct - 0.05)),
		);
		const rest = cleared.filter(
			(c) => !DEF_NOUNS.has(c.key) && c.key !== "crafty",
		);
		if (d.length > 0 && rest.length > 0) {
			const has = (k: NounKey) => d.find((c) => c.key === k);
			const rim = has("rimD");
			const per = has("perimD");
			const stl = has("steal");
			// (archnouns4: the trait words of a defensive label need their traits: Pest hustle 55+, Switch defensive
			// versatility 55+)
			const trv = (k: string) => x.traits?.[k] ?? -Infinity;
			const switchOk = trv("defensiveVersatility") >= 55;
			const pestOk = trv("hustle") >= 55;
			const rimName = (rr: NounScore) => {
				const lead = leadSub(r, ["blk", "idf"]);
				return isElite(rr)
					? "Shot Eraser"
					: lead === "blk"
						? "Shot Blocker"
						: lead === "idf"
							? "Post Defender"
							: "Rim Protector";
			};
			const perName = (pp: NounScore) =>
				isElite(pp)
					? "Lockdown Defender"
					: eliteOvr && pp.pct >= ELITE_PCT
						? "Cerebral Defender"
						: pctOf("spd", sub(r, "lat") ?? r.spd, rq) >= 0.7
							? "On-Ball Stopper"
							: "Perimeter Defender";
			const stlName = (ss: NounScore) =>
				ss.pct >= 0.85 &&
				(trv("competitiveness") >= TRAIT_WORD_MIN ||
					trv("motor") >= TRAIT_WORD_MIN ||
					trv("hustle") >= TRAIT_WORD_MIN)
					? "Ball-Hawking Menace"
					: ss.pct >= 0.85 && (sub(r, "stl") ?? 0) > (sub(r, "pdf") ?? 0)
						? "Passing-Lane Interceptor"
						: "Ball Hawk";
			let n: string;
			if (rim && stl && group !== "big" && rim.pct >= 0.8 && stl.pct >= 0.8) {
				n = "Help-Side Roamer";
			} else if (rim && per && rim.pct >= 0.8 && per.pct >= 0.8 && switchOk) {
				n = "Switch Defender";
			} else if (rim && group === "guard" && rim.pct >= 0.85) {
				n = "Swatting Guard";
			} else if (
				rim &&
				(!per || rim.pct >= per.pct) &&
				(!stl || rim.pct >= stl.pct)
			) {
				n = rimName(rim);
			} else if (
				per &&
				per.pct >= 0.8 &&
				Math.max(x.traits?.motor ?? 0, x.traits?.hustle ?? 0) >= 65
			) {
				n = "Perimeter Stalker";
			} else if (per && stl && pestOk) {
				// (archnouns3: Pest, the lighter one)
				n = per.pct < 0.85 && stl.pct < 0.85 ? "Pest" : "Point-of-Attack Pest";
			} else if (per && (!stl || per.pct >= stl.pct)) {
				n = perName(per);
			} else {
				n = stlName(stl!);
			}
			if (long && !/Lockdown|Eraser/.test(n)) {
				n = `Long ${n}`;
			} else if (
				(x.traits?.defensiveVersatility ?? 0) >= TRAIT_WORD_MIN &&
				n !== "Switch Defender"
			) {
				n = `Switchable ${n}`;
			}
			defense = n;
			// (the defensive nouns he isn't named for stay out of his main name too: the label covers his defense)
			cleared = cleared.filter((c) => !DEF_NOUNS.has(c.key));
		}
	}
	const withDef = <T extends NounPick>(p: T): T =>
		defense ? { ...p, defense } : p;
	if (customPick) {
		return customDef ? customPick : withDef(customPick);
	}

	const top3 = cleared.slice(0, 3);
	const top3Keys = new Set(top3.map((s) => s.key));
	// (skills: Crafty is a style, it never stands alone)
	const skills = cleared.filter((s) => s.key !== "crafty");

	// A young player with upside at ovr DEV_MAX_OVR or below: a development name about his best noun (the user's rule)
	if (hasUpside(x) && (x.ovr ?? 99) <= DEV_MAX_OVR) {
		return withDef({ kind: "honest", noun: skills[0]?.key, conf: 0.8 });
	}

	// Special names: every noun among his three best, with his best one; as many nouns as his name would have otherwise
	if (skills.length > 0) {
		const best = cleared[0]!.key;
		const want = Math.min(2, skills.length);
		let pick: Special | undefined;
		let pickScore = -Infinity;
		for (const sp of specialsAt(pos)) {
			if (sp.twoWay && (!twoWay || defense)) {
				continue;
			}
			if (defense && sp.nouns.some((n) => DEF_NOUNS.has(n))) {
				continue;
			}
			// (the user's audit: Stretch / Four / Five are bigs' words; a trait word needs the trait at 55+)
			if (!wordsFit(sp.name, pos, x.traits) || !okName(sp.name)) {
				continue;
			}
			const size = sp.nouns.length + (sp.twoWay ? 1 : 0);
			if (size < want || size > 3) {
				continue;
			}
			if (!sp.nouns.every((n) => top3Keys.has(n))) {
				continue;
			}
			// (the user: a stacked name only when it is clear: each of its nouns stands HYST or more above his next noun
			// that it doesn't have; else the plainer name)
			if (sp.nouns.length >= 2) {
				const next = cleared.find((c) => !sp.nouns.includes(c.key));
				const low = Math.min(
					...sp.nouns.map((n) => cleared.find((c) => c.key === n)!.pct),
				);
				if (next && low - next.pct < HYST) {
					continue;
				}
			}
			if (!sp.nouns.includes(best) && !(sp.twoWay && DEFENSE.has(best))) {
				continue;
			}
			if (sp.elite) {
				const head = top3.find((s) => s.key === sp.nouns[0])!;
				if (!eliteOvr || !isElite(cleared[0]!) || !isElite(head)) {
					continue;
				}
			}
			const score =
				size * 10 +
				sp.nouns.reduce(
					(sum, n) => sum + top3.find((s) => s.key === n)!.pct,
					0,
				) +
				(x.prev?.special === sp.id ? 1 : 0) -
				SPREAD_PEN * (x.common?.[sp.id] ?? 0);
			if (score > pickScore) {
				pick = sp;
				pickScore = score;
			}
		}
		if (pick) {
			return withDef({
				kind: "special",
				id: pick.id,
				name: pick.name,
				nouns: pick.nouns,
				conf: confOf(cleared, pick.nouns),
			});
		}
	}

	// One noun at low ovr, or none: a trait name, else an honest one about that noun. (The user: a Raw / Developing /
	// Project name only at ovr DEV_MAX_OVR or below, or with no noun at all; above it a young player with one skill gets
	// that skill's specialist name: honest.ts checks the skill before the development names)
	if (
		skills.length === 0 ||
		(skills.length === 1 && (x.ovr ?? 99) < ONE_NOUN_OVR)
	) {
		// (no skill: his strongest trait keyword's end word, or Connector)
		if (skills.length === 0) {
			const t = traitKeywordOf(x, pctOfKey, group);
			const role = t ? ROLE_BY_KEY.get(t.role) : ROLE_BY_KEY.get("tConnector");
			if (role && (t || connector(pctOfKey))) {
				const i = Math.min(t?.variant?.(x) ?? 0, role.names.length - 1);
				const name = role.names[i]!;
				if (!vetoed(name) && fits(name)) {
					return withDef({ kind: "trait", key: role.key, name, conf: 0.6 });
				}
			}
		}
		// (no noun in the top 30%: his best in the top 40% still names him, a generic name only below that)
		const near = scores.find(
			(s) =>
				s.key !== "crafty" &&
				s.pct >= GENERIC_PCT &&
				!(defense && DEF_NOUNS.has(s.key)),
		);
		return withDef({
			kind: "honest",
			noun: skills[0]?.key ?? near?.key,
			conf: skills.length > 0 ? 0.7 : near ? 0.55 : 0.8,
		});
	}

	// His two best nouns in front of his position (2-Way for a two-way player with no defensive label: his perimeter
	// defense with an offensive noun next to it). A pair whose name the checker or a verdict rejects gives way to the next.
	// (handle and shot creation say about the same thing: his name has the better of the two; so do steals and perimeter
	// defense)
	const SAME: Partial<Record<NounKey, NounKey>> = {
		creator: "handle",
		handle: "creator",
		steal: "perimD",
		perimD: "steal",
	};
	// (the end word: his position; Bruiser for a guard or wing whose best is strength; Enigma for a talented player with
	// no consistency)
	const baseEnd =
		(x.traits?.consistency ?? 100) <= 30 && (x.ovr ?? 0) >= 45
			? "enigma"
			: group !== "big" && skills[0]?.key === "strength"
				? "bruiser"
				: POS_WORD[pos];
	// (the user's end words: the first that fits the nouns his name shows)
	const endFor = (shown: readonly NounKey[]) => {
		if (baseEnd === "enigma" || baseEnd === "bruiser") {
			return { key: baseEnd as string, covers: undefined };
		}
		const ctx: EndCtx = {
			pct: pctOfKey,
			r,
			traits: x.traits,
			pos,
			group,
			elite: (k) => {
				const sc = scores.find((s) => s.key === k);
				return sc !== undefined && isElite(sc);
			},
			shown,
			ovr: x.ovr ?? 0,
			ovrPct: x.ovr === undefined ? 0 : pctOf("ovr", x.ovr, rq),
		};
		for (const e of END_WORDS) {
			if (e.covers !== undefined && !shown.includes(e.covers)) {
				continue;
			}
			if (e.ok(ctx) && !vetoed(ROLE_BY_KEY.get(e.key)?.names[0] ?? "")) {
				return { key: e.key, covers: e.covers };
			}
		}
		return { key: baseEnd as string, covers: undefined };
	};
	const nameOf = (
		end: string,
		descs: string[],
		pick?: Record<string, string>,
	) =>
		composeName(
			ROLE_BY_KEY.get(end)!,
			descs.map((k) => DESC_BY_KEY.get(k)!),
			GROUP_OF[pos],
			pick,
		);
	const hasOffense = cleared.slice(0, 3).some((s) => OFFENSE.has(s.key));
	const build = (two: NounScore[]) => {
		const descs: string[] = [];
		const nouns: NounKey[] = [];
		// (Highlight-Reel: finishing and leaping both in the top 15% say it in one word)
		if (
			two.length === 2 &&
			two.some((t) => t.key === "jump") &&
			two.some((t) => t.key === "finish") &&
			two.every((t) => t.pct >= 0.85)
		) {
			return {
				descs: ["highlightReel"],
				nouns: two.map((t) => t.key),
				pick: {} as Record<string, string>,
			};
		}
		for (const s of two) {
			if (s.key === "perimD" && twoWay && hasOffense && !isElite(s)) {
				descs.push("twoWay");
			} else {
				descs.push(nounWord(s.key, isElite(s), group, r));
			}
			nouns.push(s.key);
		}
		// (a two-way player whose two words are both offense: 2-Way in front when his defense is among his three best)
		if (
			!defense &&
			twoWay &&
			!descs.includes("twoWay") &&
			descs.length === 2 &&
			nouns.every((n) => OFFENSE.has(n)) &&
			top3.some((s) => s.key === "perimD")
		) {
			descs.unshift("twoWay");
			descs.pop();
			nouns.pop();
			nouns.unshift("perimD");
		}
		// (one noun: his strongest trait keyword adds its front word, else his length)
		const pick: Record<string, string> = {};
		if (descs.length === 1) {
			const t = traitKeywordOf(x, pctOfKey, group);
			const d = t ? DESC_BY_KEY.get(t.desc) : undefined;
			if (t && d) {
				descs.unshift(t.desc);
				const i = Math.min(t.variant?.(x) ?? 0, d.names.length - 1);
				if (i > 0) {
					pick[t.desc] = d.names[i]!;
				}
			} else if (long) {
				descs.unshift("long");
			}
		}
		return { descs, nouns, pick };
	};
	const top = cleared.slice(0, 4);
	const tries: NounScore[][] = [];
	for (let i = 0; i < top.length; i++) {
		for (let j = i + 1; j < top.length; j++) {
			if (SAME[top[i]!.key] !== top[j]!.key) {
				tries.push([top[i]!, top[j]!]);
			}
		}
	}
	tries.push([skills[0]!]);
	for (const two of tries) {
		const end = endFor(two.map((t) => t.key));
		// (an end word that says one of his nouns says it alone: that noun leaves the front words)
		const front = end.covers ? two.filter((t) => t.key !== end.covers) : two;
		const b = build(front.length > 0 ? front : two);
		const descs = front.length > 0 || !end.covers ? b.descs : ([] as string[]);
		const nouns = end.covers ? [...new Set([...b.nouns, end.covers])] : b.nouns;
		if (descs.length === 0) {
			continue;
		}
		if (okName(nameOf(end.key, descs, b.pick))) {
			return withDef({
				kind: "composed",
				descs,
				role: end.key as PosWord,
				nouns,
				pick: b.pick,
				conf: confOf(cleared, nouns),
			});
		}
	}
	return withDef({ kind: "honest", noun: skills[0]?.key, conf: 0.5 });
};

// The nouns a name says (a build's, a composed name's), for reports: undefined when a word of it is no noun
const WORD_NOUNS: [RegExp, NounKey][] = [
	[/Speedy/, "speed"],
	[/Ball-Handling/, "handle"],
	[/Rim-Protecting/, "rimD"],
	[/Paint-Finishing/, "finish"],
	[/Mid-Range/, "mid"],
	[/Post-Scoring/, "post"],
	[/Shot-Creating/, "creator"],
	[/Lockdown/, "perimD"],
	[/Spot-Up/, "three"],
	[/Power-Finishing|Finesse/, "finish"],
	[/Close-Range|Floater/, "post"],
	[/Shifty|Steady/, "handle"],
	[/Shot-Blocking|Post-Defending/, "rimD"],
	[/Quick-Footed|Twitchy/, "speed"],
	[/\b(Driver|Glider)$/, "speed"],
	[/\bDriver$/, "handle"],
	[/\b(Point|Dimer|Facilitator|Wizard|Architect|Engine|General)$/, "pass"],
	[/\b(Spacer|Deadeye)$/, "three"],
	[/\b(Acrobat|Artist|Attacker|Cutter)$/, "finish"],
	[/\bMaestro$/, "mid"],
	[/\bInterceptor$/, "steal"],
	[/\bProtector$/, "rimD"],
	[/Highlight-Reel/, "jump"],
];
// (trait words name no noun)
const TRAIT_WORD_RE =
	/\b(Clutch|Veteran|Screen-Setting|Off-Ball|Switchable)\b/g;
const DEFENSE_LABEL_NOUNS: [RegExp, NounKey[]][] = [
	[/Switch Defender/, ["perimD", "rimD"]],
	[/Point-of-Attack Pest/, ["perimD", "steal"]],
	[
		/Shot Blocker|Post Defender|Rim Protector|Swatting Guard|Shot Eraser/,
		["rimD"],
	],
	[
		/Perimeter Defender|On-Ball Stopper|Cerebral Defender|Lockdown Defender/,
		["perimD"],
	],
	[/Ball Hawk|Menace/, ["steal"]],
];
const CUSTOM_NAME_NOUNS = (): Record<string, NounKey[]> =>
	Object.fromEntries(
		CUSTOM_SPECIALS.flatMap((c) => {
			const role = ROLE_BY_KEY.get(c.key);
			return role
				? [
						...role.names.map((n) => [n, c.nouns] as const),
						...Object.values(role.byGroup ?? {}).map(
							(n) => [n, c.nouns] as const,
						),
					]
				: [];
		}),
	);
export const nounsOfName = (
	label: string,
): { nouns: NounKey[]; twoWay: boolean } | undefined => {
	const [name0, def] = label.split(" · ");
	const name = name0!;
	if (def) {
		const main = nounsOfName(name);
		const d = DEFENSE_LABEL_NOUNS.find(([re]) => re.test(def))?.[1] ?? [];
		return {
			nouns: [...new Set([...(main?.nouns ?? []), ...d])],
			twoWay: main?.twoWay ?? false,
		};
	}
	const custom = CUSTOM_NAME_NOUNS()[name];
	if (custom) {
		return { nouns: custom, twoWay: false };
	}
	const nick = NICKNAMES[name];
	if (nick) {
		return { nouns: nick, twoWay: false };
	}
	const set = new Set<NounKey>();
	let twoWay = false;
	const composed = /\b(Guard|Wing|Forward|Big|Bruiser|Enigma)$/.test(name);
	if (/Highlight-Reel/.test(name)) {
		set.add("finish");
	}
	let rest = name
		.replace(/\b(Guard|Wing|Forward|Big|Bruiser|Enigma)$/, "")
		.replace(TRAIT_WORD_RE, "")
		.trim();
	// (in a noun name, Pull-Up is his three)
	if (composed && /Pull-Up/.test(rest)) {
		set.add("three");
		rest = rest.replace("Pull-Up", "");
	}
	for (const [re, n] of WORD_NOUNS) {
		if (re.test(rest)) {
			set.add(n);
			rest = rest.replace(re, "");
		}
	}
	for (const c of conceptsOf(rest)) {
		const m = CONCEPT_NOUNS[c.key];
		if (m === "twoWay") {
			twoWay = true;
		} else if (m) {
			for (const n of m) {
				set.add(n);
			}
		}
	}
	return set.size > 0 || twoWay ? { nouns: [...set], twoWay } : undefined;
};
