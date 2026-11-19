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
import type { PosGroup } from "./grammar.ts";

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
export type PosWord = "posGuard" | "posWing" | "posForward" | "posBig";
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
		let nouns: NounKey[] | undefined = NICKNAMES[name];
		let twoWay = false;
		if (!nouns) {
			const cs = conceptsOf(name);
			if (cs.length === 0) {
				continue;
			}
			const set = new Set<NounKey>();
			let ok = true;
			for (const c of cs) {
				const m = CONCEPT_NOUNS[c.key];
				if (m === "twoWay") {
					twoWay = true;
				} else if (m) {
					for (const n of m) {
						set.add(n);
					}
				} else {
					ok = false;
				}
			}
			if (!ok) {
				continue;
			}
			nouns = [...set];
		}
		if (nouns.length === 0 || nouns.length > 3) {
			continue;
		}
		out.push({ id: a.id, name, nouns, twoWay, elite: ELITE_RE.test(name) });
	}
	specialCache.set(pos, out);
	return out;
};
// Words a special name may only have at some positions, or with a trait
const BIG_POS: ReadonlySet<Pos> = new Set(["PF", "FC", "C"]);
const TRAIT_WORDS: [RegExp, string, number][] = [
	[/Hustle|Hustling|Energy|Junkyard/, "hustle", 55],
	[/Screen/, "screen", 50],
	[/Off-Ball/, "offBall", 55],
	[/Motor/, "motor", 55],
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

// (for tests)
export const allConceptKeys = () => CONCEPTS.map((c) => c.key);

// ---- trait names ----
export type TraitName = { key: string; name: string };
const TRAIT_NAMES: {
	key: string;
	name: string;
	ok: (x: NounInput, scores: readonly NounScore[]) => boolean;
}[] = [
	{
		key: "tCloser",
		name: "Closer",
		ok: (x) => (x.traits?.clutch ?? 0) >= 75 && (x.ovr ?? 0) >= 50,
	},
	{
		key: "tOldHead",
		name: "Old Head",
		ok: (x) => (x.traits?.veteranSavvy ?? 0) >= 75 && (x.age ?? 0) >= 32,
	},
	{
		key: "tScreenRoll",
		name: "Screen-and-Roll Big",
		ok: (x) =>
			(x.traits?.screen ?? 0) >= 70 &&
			(x.pos === "FC" || x.pos === "C" || x.pos === "PF"),
	},
	{
		key: "tOffBall",
		name: "Off-Ball Mover",
		ok: (x) =>
			(x.traits?.offBall ?? 0) >= 70 && x.pos !== "FC" && x.pos !== "C",
	},
	{
		key: "tConnector",
		name: "Connector",
		ok: (x, scores) => {
			const pass = scores.find((s) => s.key === "pass")!;
			const iq = scores.find((s) => s.key === "crafty")!;
			return pass.pct >= 0.55 && iq.pct >= 0.55;
		},
	},
];
export const TRAIT_NAME_KEYS = TRAIT_NAMES.map((t) => ({
	key: t.key,
	name: t.name,
}));

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
};
export type NounPick =
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
	  }
	| { kind: "trait"; key: string; name: string; conf: number }
	// no name of his own from his nouns: an honest name, about this noun (or about nothing)
	| { kind: "honest"; noun?: NounKey; conf: number };

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
	speed: { keys: ["sls", "lat"], words: { lat: "quickFooted" } },
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

// One trait word in front of a one-noun name (the user's list), the first that fits
const TRAIT_WORDS_FRONT: {
	desc: string;
	ok: (x: NounInput, group: PosGroup) => boolean;
}[] = [
	{
		desc: "clutch",
		ok: (x) => (x.traits?.clutch ?? 0) >= 75 && (x.ovr ?? 0) >= ONE_NOUN_OVR,
	},
	{
		desc: "veteran",
		ok: (x) => (x.traits?.veteranSavvy ?? 0) >= 75 && (x.age ?? 0) >= 32,
	},
	{
		desc: "screenSetting",
		ok: (x, group) =>
			group === "big" && (x.traits?.screen ?? 0) >= TRAIT_WORD_MIN,
	},
	{
		desc: "offBallMoving",
		ok: (x, group) =>
			group !== "big" && (x.traits?.offBall ?? 0) >= TRAIT_WORD_MIN,
	},
	{
		desc: "switchable",
		ok: (x) => (x.traits?.defensiveVersatility ?? 0) >= TRAIT_WORD_MIN,
	},
];

export const pickNouns = (x: NounInput): NounPick => {
	const { r, pos, rq } = x;
	const group = groupOfPos(pos);
	const scores = nounScores(r, rq);
	let cleared = clearedNouns(scores);
	const ovrTable = tableOf("ovr", rq);
	const eliteOvr =
		x.ovr !== undefined &&
		(rq?.ovr
			? x.ovr >= ELITE_OVR_FLOOR && percentileIn(rq.ovr, x.ovr) >= ELITE_OVR_PCT
			: ovrTable
				? x.ovr >= ELITE_OVR_FLOOR &&
					percentileIn(ovrTable, x.ovr) >= ELITE_OVR_PCT
				: x.ovr >= NOUN_ELITE_OVR);
	const isElite = (s: NounScore) =>
		eliteOvr &&
		s.pct >= ELITE_PCT &&
		// (Lockdown needs mobility: the user's audit)
		(s.key !== "perimD" || mobile(r, rq));
	const twoWay = twoWayOk(r, rq);

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
	const top3 = cleared.slice(0, 3);
	const top3Keys = new Set(top3.map((s) => s.key));
	// (skills: Crafty is a style, it never stands alone)
	const skills = cleared.filter((s) => s.key !== "crafty");

	// A young player with upside at ovr DEV_MAX_OVR or below: a development name about his best noun (the user's rule)
	if (hasUpside(x) && (x.ovr ?? 99) <= DEV_MAX_OVR) {
		return { kind: "honest", noun: skills[0]?.key, conf: 0.8 };
	}

	// Special names: every noun among his three best, with his best one; as many nouns as his name would have otherwise
	if (skills.length > 0) {
		const best = cleared[0]!.key;
		const want = Math.min(2, skills.length);
		let pick: Special | undefined;
		let pickScore = -Infinity;
		for (const sp of specialsAt(pos)) {
			if (sp.twoWay && !twoWay) {
				continue;
			}
			// (the user's audit: Stretch / Four / Five are bigs' words; a trait word needs the trait at 55+)
			if (!wordsFit(sp.name, pos, x.traits)) {
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
			return {
				kind: "special",
				id: pick.id,
				name: pick.name,
				nouns: pick.nouns,
				conf: confOf(cleared, pick.nouns),
			};
		}
	}

	// One noun at low ovr, or none: a trait name, else an honest one about that noun. (The user: a Raw / Developing /
	// Project name only at ovr DEV_MAX_OVR or below, or with no noun at all; above it a young player with one skill gets
	// that skill's specialist name: honest.ts checks the skill before the development names)
	if (
		skills.length === 0 ||
		(skills.length === 1 && (x.ovr ?? 99) < ONE_NOUN_OVR)
	) {
		const t = TRAIT_NAMES.find((t) => t.ok(x, scores));
		if (t && skills.length === 0) {
			return { kind: "trait", key: t.key, name: t.name, conf: 0.6 };
		}
		// (no noun in the top 30%: his best in the top 40% still names him, a generic name only below that)
		const near = scores.find((s) => s.key !== "crafty" && s.pct >= GENERIC_PCT);
		return {
			kind: "honest",
			noun: skills[0]?.key ?? near?.key,
			conf: skills.length > 0 ? 0.7 : near ? 0.55 : 0.8,
		};
	}

	// His two best nouns in front of his position (2-Way for a two-way player: his perimeter defense with an offensive
	// noun next to it)
	// (handle and shot creation say about the same thing: his name has the better of the two)
	// (so do steals and perimeter defense)
	const SAME: Partial<Record<NounKey, NounKey>> = {
		creator: "handle",
		handle: "creator",
		steal: "perimD",
		perimD: "steal",
	};
	const two: NounScore[] = [];
	for (const s of cleared) {
		if (two.length === 2) {
			break;
		}
		if (two.some((t) => SAME[t.key] === s.key)) {
			continue;
		}
		two.push(s);
	}
	// (Crafty alone in front of nothing: drop it)
	const descs: string[] = [];
	const nouns: NounKey[] = [];
	const hasOffense = cleared.slice(0, 3).some((s) => OFFENSE.has(s.key));
	for (const s of two) {
		if (
			DEFENSE.has(s.key) &&
			s.key === "perimD" &&
			twoWay &&
			hasOffense &&
			!isElite(s)
		) {
			descs.push("twoWay");
		} else {
			descs.push(nounWord(s.key, isElite(s), group, r));
		}
		nouns.push(s.key);
	}
	// (a two-way player whose two words are both offense: 2-Way in front when his defense is among his three best)
	if (
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
	if (descs.length === 1) {
		const t = TRAIT_WORDS_FRONT.find((t) => t.ok(x, group));
		if (t) {
			descs.unshift(t.desc);
		}
	}
	return {
		kind: "composed",
		descs,
		role: POS_WORD[pos],
		nouns,
		conf: confOf(cleared, nouns),
	};
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
	[/Quick-Footed/, "speed"],
];
// (trait words name no noun)
const TRAIT_WORD_RE =
	/\b(Clutch|Veteran|Screen-Setting|Off-Ball|Switchable)\b/g;
export const nounsOfName = (
	name: string,
): { nouns: NounKey[]; twoWay: boolean } | undefined => {
	const nick = NICKNAMES[name];
	if (nick) {
		return { nouns: nick, twoWay: false };
	}
	const set = new Set<NounKey>();
	let twoWay = false;
	const composed = /\b(Guard|Wing|Forward|Big)$/.test(name);
	let rest = name
		.replace(/\b(Guard|Wing|Forward|Big)$/, "")
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
