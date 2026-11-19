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
export const ELITE_OVR_PCT = 0.85;
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
		value: (r) => mean([sub(r, "blk"), r.idef ?? r.diq]),
		table: (r) => (r.idef !== undefined ? "idef" : "diq"),
	},
	perimD: {
		value: (r) => mean([r.pdef, sub(r, "pdf"), r.diq]),
		table: (r) => (r.pdef !== undefined ? "pdef" : "diq"),
	},
	steal: {
		value: (r) => sub(r, "stl") ?? r.diq,
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

export type NounScore = { key: NounKey; value: number; pct: number };

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
		return { key, value, pct: pctOf(NOUN_VALUE[key].table(r), value, rq) };
	}).sort((a, b) => b.pct - a.pct || b.value - a.value);

// The nouns he qualifies for (Crafty only from the top 15%), best first
export const clearedNouns = (scores: readonly NounScore[]): NounScore[] =>
	scores.filter((s) => s.pct >= (s.key === "crafty" ? CRAFTY_PCT : NOUN_CLEAR));

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
};
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
			traits !== undefined &&
			(traits.motor ?? 0) >= TRAIT_WORD_MIN,
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
	{
		key: "sSlashMiddyF",
		positions: ["SF", "F", "PF"],
		nouns: ["finish", "handle", "mid"],
		test: ({ pct }) => pct.finish >= 0.7 && pct.handle >= 0.6 && pct.mid >= 0.7,
	},
];
// Jack-of-all-Trades: JACK_MIN or more nouns in the top 40%, none in the top 10%
export const JACK_MIN = 5;

// ---- the defensive label ----
const DEF_NOUNS: ReadonlySet<NounKey> = new Set(["rimD", "perimD", "steal"]);

export const pickNouns = (x: NounInput): NounPick => {
	const { r, pos, rq } = x;
	const group = groupOfPos(pos);
	const scores = nounScores(r, rq);
	let cleared = clearedNouns(scores);
	const ovrTable = tableOf("ovr", rq);
	const eliteOvr =
		x.ovr !== undefined &&
		(ovrTable
			? x.ovr >= ELITE_OVR_FLOOR &&
				percentileIn(ovrTable, x.ovr) >= ELITE_OVR_PCT
			: x.ovr >= NOUN_ELITE_OVR);
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
	const okName = (name: string) => !vetoed(name) && !nameProblem(name);

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
	// whole: no defensive label)
	{
		const ctx: SpecialCtx = {
			pct: pctOfKey,
			r,
			traits: x.traits,
			eliteOvr,
			ovr: x.ovr ?? 0,
			best: cleared.find((c) => c.key !== "crafty")?.key,
		};
		const young = hasUpside(x) && (x.ovr ?? 99) <= DEV_MAX_OVR;
		let pick: (typeof CUSTOM_SPECIALS)[number] | undefined;
		let pickScore = -Infinity;
		if (!young) {
			for (const c of CUSTOM_SPECIALS) {
				if (!c.positions.includes(pos) || !c.test(ctx)) {
					continue;
				}
				const best = ctx.best;
				const nouns: NounKey[] = c.nouns.map((n) =>
					n === "creator" ? "handle" : n,
				);
				if (
					best &&
					!nouns.includes(best) &&
					!(best === "creator" && nouns.includes("handle"))
				) {
					continue;
				}
				const sc =
					c.nouns.reduce((sum, n) => sum + pctOfKey[n], 0) + c.nouns.length;
				const role = ROLE_BY_KEY.get(c.key)!;
				if (!okName(composeName(role, [], GROUP_OF[pos]))) {
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
			return {
				kind: "trait",
				key: pick.key,
				name: composeName(role, [], GROUP_OF[pos]),
				conf: confOf(cleared, pick.nouns),
			};
		}
		// (Jack-of-all-Trades: many good skills, no great one)
		const good = scores.filter(
			(s) => s.key !== "crafty" && s.pct >= GENERIC_PCT,
		);
		if (
			!young &&
			good.length >= JACK_MIN &&
			scores.every((s) => s.pct < 0.9) &&
			(x.ovr ?? 0) >= 45 &&
			!vetoed("Jack-of-all-Trades")
		) {
			return {
				kind: "trait",
				key: "sJack",
				name: "Jack-of-all-Trades",
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
		const d = cleared.filter(
			(c) => DEF_NOUNS.has(c.key) && (top3All.has(c.key) || c.pct >= 0.85),
		);
		const rest = cleared.filter(
			(c) => !DEF_NOUNS.has(c.key) && c.key !== "crafty",
		);
		if (d.length > 0 && rest.length > 0) {
			const has = (k: NounKey) => d.find((c) => c.key === k);
			const rim = has("rimD");
			const per = has("perimD");
			const stl = has("steal");
			let n: string;
			if (rim && per && rim.pct >= 0.8 && per.pct >= 0.8) {
				n = "Switch Defender";
			} else if (rim && group === "guard" && rim.pct >= 0.85) {
				n = "Swatting Guard";
			} else if (
				rim &&
				(!per || rim.pct >= per.pct) &&
				(!stl || rim.pct >= stl.pct)
			) {
				const lead = leadSub(r, ["blk", "idf"]);
				n = isElite(rim)
					? "Shot Eraser"
					: lead === "blk"
						? "Shot Blocker"
						: lead === "idf"
							? "Post Defender"
							: "Rim Protector";
			} else if (per && stl) {
				n = "Point-of-Attack Pest";
			} else if (per) {
				n = isElite(per)
					? "Lockdown Defender"
					: eliteOvr && per.pct >= ELITE_PCT
						? "Cerebral Defender"
						: pctOf("spd", sub(r, "lat") ?? r.spd, rq) >= 0.7
							? "On-Ball Stopper"
							: "Perimeter Defender";
			} else {
				n =
					stl!.pct >= 0.85 &&
					((x.traits?.motor ?? 0) >= TRAIT_WORD_MIN ||
						(x.traits?.hustle ?? 0) >= TRAIT_WORD_MIN)
						? "Ball-Hawking Menace"
						: "Ball Hawk";
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
				(x.prev?.special === sp.id ? 1 : 0);
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
				if (!vetoed(name)) {
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
	const endKey =
		(x.traits?.consistency ?? 100) <= 30 && (x.ovr ?? 0) >= 45
			? "enigma"
			: group !== "big" && skills[0]?.key === "strength"
				? "bruiser"
				: POS_WORD[pos];
	const roleDef = ROLE_BY_KEY.get(endKey)!;
	const nameOf = (descs: string[], pick?: Record<string, string>) =>
		composeName(
			roleDef,
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
		const b = build(two);
		if (okName(nameOf(b.descs, b.pick))) {
			return withDef({
				kind: "composed",
				descs: b.descs,
				role: endKey as PosWord,
				nouns: b.nouns,
				pick: b.pick,
				conf: confOf(cleared, b.nouns),
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
