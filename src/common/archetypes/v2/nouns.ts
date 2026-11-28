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
// front of the position) and, for the elite, an elite form (ovr ELITE_OVR+ and a top ELITE_PCT standing). Names are at most
// two nouns and the position, or a special name of at most three nouns. archstick: last season's whole label is kept
// while it still passes every rule and is about as good as this season's pick (pickNouns, STICK_MARGIN), and a near
// tie between two nouns goes to the one it named (STICK_TIE).
import { ARCHETYPES } from "../classify.ts";
import { nameAt } from "../posNames.ts";
import { CONCEPTS, conceptsOf } from "../twoK/concepts.ts";
import type { ArchetypeRatings, Pos } from "../types.ts";
import { SUB_INDEX } from "../../subRatings.ts";
import { GATE_REF } from "./gateScale.data.ts";
import { NOUN_GROUP_REF } from "./nounGroups.data.ts";
import {
	percentileIn,
	rimDValue,
	RQ_POINTS,
	type RatingQuantiles,
} from "./gateScale.ts";
import { ELITE_RE, hasUpside } from "./honest.ts";
import {
	composeName,
	GROUP_OF,
	isComposedId,
	parseComposedId,
	ROLE_BY_KEY,
	SKILL_NOUN_ROLES,
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
	| "crafty"
	// archskill (reading 29): the new skills, from ratings, sub-ratings and visible traits
	| "foulDraw"
	| "cut"
	| "helpD"
	| "postD"
	| "oreb"
	| "length"
	| "secure"
	| "switchD"
	| "rimRun"
	| "roll"
	| "transition"
	| "motor";

// A noun clears when he is in the league's top 30% at it (the user's audit: "the skill must be in the league's top 30%
// and one of the player's three best skills")
export const NOUN_CLEAR = 0.7;
// Elite words: ovr 58+ (the user's audit: the top 15% of a league) and a top 8% standing at the noun
export const NOUN_ELITE_OVR = 58;
// (with a league table of ovr: his league's top ELITE_OVR_PCT, never below ELITE_OVR_FLOOR; the user)
export const ELITE_OVR_PCT = 0.9;
export const ELITE_OVR_FLOOR = 55;
// The league's top 40% (a bar some special names and trait words read; archskill, reading 29: no longer a generic
// no-skill name's bar, as there is no such name)
export const GENERIC_PCT = 0.6;
// A trait adds one word to a one-noun name at this score (the user: "one trait word per name when the trait is 70+")
export const TRAIT_WORD_MIN = 70;
// Sub-ratings decide a noun's word when one leads another by this much (archcov: 10, past a sub-rating's usual change
// from one season to the next, so the variant word doesn't flip on noise)
export const SUB_LEAN = 10;
export const ELITE_PCT = 0.92;
// Below this ovr a player with one real skill is named by that skill's noun ("Rebounder"; archskill, reading 29: it was an
// honest specialist name), not "<noun> <Position>"
export const ONE_NOUN_OVR = 50;
// 2-Way: defense (perimeter or interior) 60+ and in the league's top 40%
const TWO_WAY_MIN = 60;
const TWO_WAY_PCT = 0.6;
// Crafty: offensive IQ in the top 15%
const CRAFTY_PCT = 0.85;
// Lockdown needs mobility: lateral quickness (or speed) at least at the league's median
const MOBILE_PCT = 0.5;
// Last season's nouns stay while each is within this much (in percentile) of his current pick
export const HYST = 0.02;
// archstick: a near tie between two of his nouns (within this much standing) goes to the one last season's label named
export const STICK_TIE = HYST;

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
	foulDraw: { desc: "foulDrawing" },
	cut: { desc: "backdoor" },
	helpD: { desc: "helpSide" },
	postD: { desc: "postDefending" },
	oreb: { desc: "boardHunting" },
	length: { desc: "long" },
	secure: { desc: "mistakeFree" },
	switchD: { desc: "switchable" },
	rimRun: { desc: "lobCatching" },
	roll: { desc: "screenRolling" },
	transition: { desc: "transitionWord" },
	motor: { desc: "highMotor" },
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
// (archcov: a sub-rating of 0 is missing, not a rating: an export without the athletic sub-ratings has 0s there)
export const sub = (r: ArchetypeRatings, key: string): number | undefined => {
	const i = SUB_INDEX[key];
	const v = i === undefined ? undefined : r.sub?.[i];
	return typeof v === "number" && v > 0 ? v : undefined;
};
const mean = (xs: (number | undefined)[]) => {
	const v = xs.filter((x): x is number => typeof x === "number");
	return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};
// Each noun: its value (0-100, the ratings it is about, with the sub-ratings that say it when he has them) and the
// league table that says where that value stands
// archskill: a visible trait (the playerTraits setting, as the user's scouts see it) moves a skill's value by this much per
// point from 50 (a nudge: the league's tables are read from ratings alone); the traits the skills read, all of them visible
// traits (classify.ts VISIBLE_TRAITS: a hidden trait never names a player)
export const TRAIT_NUDGE = 0.15;
export const SKILL_TRAITS = [
	"offBall",
	"handle",
	"defensiveVersatility",
	"screen",
	"motor",
	"hustle",
] as const;
type SkillTrait = (typeof SKILL_TRAITS)[number];
type Traits = Partial<Record<string, number>> | undefined;
const trait = (t: Traits, k: SkillTrait): number | undefined => {
	const v = t?.[k];
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};
const nudge = (t: Traits, k: SkillTrait) => {
	const v = trait(t, k);
	return v === undefined ? 0 : TRAIT_NUDGE * (v - 50);
};
const clamp100 = (v: number) => Math.max(0, Math.min(100, v));
const NOUN_VALUE: Record<
	NounKey,
	{
		// (undefined: he has no value for it, e.g. length without the wingspan rating, motor without traits)
		value: (r: ArchetypeRatings, t?: Traits) => number | undefined;
		table: (r: ArchetypeRatings) => string;
	}
> = {
	three: { value: (r) => r.tp, table: () => "tp" },
	mid: { value: (r) => r.fg, table: () => "fg" },
	post: { value: (r) => r.ins, table: () => "ins" },
	finish: { value: (r) => r.dnk, table: () => "dnk" },
	rimD: {
		// (defensive IQ alone would make every smart defender a rim protector, and the block sub-rating a small guard who
		// blocks well: without the expanded interior-defense rating, his size and leaping count too, sub-ratings or not.
		// Read against its own table: gateScale.ts rimDValue)
		value: rimDValue,
		table: () => "rimD",
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
	// archskill (reading 29): the new skills
	// Foul drawing: free throws, contact finishing and attacking the rim
	foulDraw: {
		value: (r) =>
			mean([r.ft, sub(r, "con") ?? r.dnk, mean([r.dnk, r.drb, r.spd])]),
		table: () => "ft",
	},
	// Off-ball movement and cutting: spot-up jumper, finishing, speed, and the off-ball trait
	cut: {
		value: (r, t) =>
			clamp100(
				mean([sub(r, "spu") ?? r.fg, r.dnk, r.spd]) + nudge(t, "offBall"),
			),
		table: () => "dnk",
	},
	// Help defense: defensive IQ (twice) and interior D (or his size)
	helpD: {
		value: (r) => mean([r.diq, r.diq, r.idef ?? r.hgt]),
		table: () => "diq",
	},
	// Post defense: interior D's own part (not the blocks), strength and size
	postD: {
		value: (r) => mean([sub(r, "idf") ?? r.idef ?? r.diq, r.stre, r.hgt]),
		table: (r) => (r.idef !== undefined ? "idef" : "diq"),
	},
	// Offensive rebounding: the offensive-rebounding sub-rating (or the expanded rating)
	oreb: {
		value: (r) => sub(r, "orb") ?? r.oreb ?? r.reb,
		table: () => "reb",
	},
	// Length: wingspan, and wingspan over height (only with the wingspan rating)
	length: {
		value: (r) =>
			typeof r.wng === "number"
				? clamp100(mean([r.wng, 50 + 4 * (r.wng - r.hgt)]))
				: undefined,
		table: () => "wng",
	},
	// Ball security: the ball-security sub-rating (or his handle) and the handle-under-pressure trait
	secure: {
		value: (r, t) => clamp100((sub(r, "sec") ?? r.drb) + nudge(t, "handle")),
		table: () => "drb",
	},
	// Switchability: lateral quickness, perimeter and interior D, a size in the middle, and the versatility trait
	switchD: {
		value: (r, t) =>
			clamp100(
				mean([
					sub(r, "lat") ?? r.spd,
					r.pdef ?? r.diq,
					r.idef ?? r.diq,
					100 - 2 * Math.abs(r.hgt - 48),
				]) + nudge(t, "defensiveVersatility"),
			),
		table: (r) => (r.pdef !== undefined ? "pdef" : "diq"),
	},
	// Rim running / lob threat: max vertical (or leaping), size, finishing, speed
	rimRun: {
		value: (r) => mean([sub(r, "mxv") ?? r.jmp, r.hgt, r.dnk, r.dnk, r.spd]),
		table: () => "dnk",
	},
	// Screening / roll man: strength, size, offensive rebounding, contact finishing, and the screen trait
	roll: {
		value: (r, t) =>
			clamp100(
				mean([
					r.stre,
					r.hgt,
					sub(r, "orb") ?? r.oreb ?? r.reb,
					sub(r, "con") ?? r.dnk,
				]) + nudge(t, "screen"),
			),
		table: () => "stre",
	},
	// Transition: speed, finishing, the floater (or close-range touch)
	transition: {
		value: (r) => mean([r.spd, r.dnk, sub(r, "flt") ?? r.ins]),
		table: () => "spd",
	},
	// Motor: the motor and hustle traits and endurance (only with traits: never read without them)
	motor: {
		value: (r, t) => {
			const m = trait(t, "motor");
			const h = trait(t, "hustle");
			return m === undefined && h === undefined
				? undefined
				: mean([r.endu, m ?? h, h ?? m]);
		},
		table: () => "endu",
	},
};
export const NOUNS = Object.keys(NOUN_VALUE) as NounKey[];
// archcov: each noun's value among the players of one position group (guards, wings, bigs): the quantiles of the
// values themselves (RQ_POINTS points, 0%..100%)
export type NounGroupQuantiles = Partial<
	Record<PosGroup | "all", Partial<Record<NounKey, number[]>>>
>;
export const nounValue = (
	k: NounKey,
	r: ArchetypeRatings,
	t?: Partial<Record<string, number>>,
) => NOUN_VALUE[k].value(r, t);
export const nounGroupQuantiles = (
	rows: readonly { ratings: ArchetypeRatings; pos?: string }[],
): NounGroupQuantiles => {
	const out: NounGroupQuantiles = {};
	// ("all": the league's own table of each noun's value, so a blended noun is read against its own blend)
	for (const g of ["all", "guard", "wing", "big"] as const) {
		const mine = rows.filter(
			(x) => g === "all" || (x.pos !== undefined && GROUP_OF_POS[x.pos] === g),
		);
		if (mine.length < 40) {
			continue;
		}
		const t: Partial<Record<NounKey, number[]>> = {};
		for (const k of NOUNS) {
			const v = mine
				.map((x) => NOUN_VALUE[k].value(x.ratings))
				.filter((x): x is number => x !== undefined && Number.isFinite(x))
				.sort((a, b) => a - b);
			// (archskill: a skill few players have a value for, length without wingspans or motor without traits: no table)
			if (v.length < 40) {
				continue;
			}
			t[k] = Array.from({ length: RQ_POINTS }, (_, i) => {
				const p = (i / (RQ_POINTS - 1)) * (v.length - 1);
				const lo = Math.floor(p);
				const hi = Math.min(v.length - 1, lo + 1);
				return Math.round((v[lo]! + (v[hi]! - v[lo]!) * (p - lo)) * 10) / 10;
			});
		}
		out[g] = t;
	}
	return out;
};
const GROUP_OF_POS: Record<string, PosGroup> = {
	PG: "guard",
	G: "guard",
	SG: "guard",
	GF: "wing",
	SF: "wing",
	F: "wing",
	PF: "big",
	FC: "big",
	C: "big",
};
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
	foulDraw: "ft",
	cut: "dnk",
	helpD: "diq",
	postD: "diq",
	oreb: "reb",
	length: "hgt",
	secure: "drb",
	switchD: "diq",
	rimRun: "dnk",
	roll: "stre",
	transition: "spd",
	motor: "endu",
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
	// archskill: no value for it (length without wingspans, motor without traits): standing 0
	missing?: true;
};

const tableOf = (k: string, rq?: RatingQuantiles) =>
	(rq as Record<string, number[] | undefined> | undefined)?.[k] ??
	(GATE_REF as Record<string, number[] | undefined>)[k] ??
	// (rim protection's reference table: its values among the reference leagues' players, nounGroups.data.ts)
	(k === "rimD" ? NOUN_GROUP_REF.all?.rimD : undefined);

export const pctOf = (k: string, v: number, rq?: RatingQuantiles): number => {
	const t = tableOf(k, rq);
	return t ? percentileIn(t, v) : 0.5;
};

// archstick: best standing first; a tie (the same standing and the same height over the league's top) goes the same
// way every time, by the nouns' order in NOUNS, so a label never turns on which way a sort fell
const byStanding =
	(at: (s: NounScore) => number) => (a: NounScore, b: NounScore) =>
		at(b) - at(a) ||
		b.above - a.above ||
		NOUNS.indexOf(a.key) - NOUNS.indexOf(b.key);
// Every noun's score, best standing first
export const nounScores = (
	r: ArchetypeRatings,
	rq?: RatingQuantiles,
	// archskill: his traits (only the visible ones are read: SKILL_TRAITS)
	traits?: Partial<Record<string, number>>,
	// archskill: which skills (by default the reading-28 ones, as the callers outside the coverage reading read them:
	// the draft class's skill mix, the aim targets, the user's verdicts; the coverage reading asks for all of them)
	keys: readonly NounKey[] = OLD_NOUNS,
): NounScore[] =>
	keys
		.map((key): NounScore => {
			const v = NOUN_VALUE[key].value(r, traits);
			if (v === undefined || !Number.isFinite(v)) {
				return { key, value: 0, pct: 0, above: -1, missing: true };
			}
			const value = v;
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
		})
		.sort(byStanding((s) => s.pct));

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
// The nouns he qualifies for (Crafty only from the top 15%), best first (athletic nouns discounted). archstick: a near
// tie (within HYST) goes to the nouns last season's label named (`favored`), so "his three best" and "his best" do not
// swap between two skills at about the same standing from one season to the next; the bars themselves never move.
export const clearedNouns = (
	scores: readonly NounScore[],
	favored?: ReadonlySet<NounKey>,
): NounScore[] =>
	scores
		.filter((s) => s.pct >= clearAt(s.key))
		.sort(
			byStanding((s) => rankPct(s) + (favored?.has(s.key) ? STICK_TIE : 0)),
		);

export const twoWayOk = (r: ArchetypeRatings, rq?: RatingQuantiles) => {
	const perim = NOUN_VALUE.perimD.value(r) ?? 0;
	const rim = NOUN_VALUE.rimD.value(r) ?? 0;
	const d = Math.max(perim, rim);
	const pct = Math.max(
		pctOf(NOUN_VALUE.perimD.table(r), perim, rq),
		pctOf(NOUN_VALUE.rimD.table(r), rim, rq),
	);
	return d >= TWO_WAY_MIN && pct >= TWO_WAY_PCT;
};
export const mobile = (r: ArchetypeRatings, rq?: RatingQuantiles) =>
	Math.max(pctOf("spd", sub(r, "lat") ?? r.spd, rq), pctOf("spd", r.spd, rq)) >=
	MOBILE_PCT;

export const OFFENSE: ReadonlySet<NounKey> = new Set([
	"three",
	"mid",
	"post",
	"finish",
	"handle",
	"creator",
	"pass",
	// archskill (reading 29)
	"foulDraw",
	"cut",
	"secure",
	"rimRun",
	"roll",
]);

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
export const BIG_POS: ReadonlySet<Pos> = new Set(["PF", "FC", "C"]);
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
// archaudit: words a position (his size band) rules out, whatever his ratings say: rim protection on a guard, post
// scoring on a point or combo guard, and on a center (FC/C) the primary ball handler's words unless his handle stands
// at BIG_HANDLE_PCT or more (a center with no handle is no "Playmaker" or "Floor General", however well he passes)
const SMALL_GUARD_POS: ReadonlySet<Pos> = new Set(["PG", "G"]);
const CENTER_POS: ReadonlySet<Pos> = new Set(["FC", "C"]);
export const RIM_WORDS_RE =
	/Rim-Protect|Rim Protector|Paint Protector|Paint-Protecting|Shot-Eras|Shot Eraser|Shot-Blocking|Shot Blocker|Backline/;
export const POST_WORDS_RE = /\bPost\b|\bPost-|-Post\b/;
export const HANDLER_WORDS_RE =
	/Ball-Handling|Ball Handler|\bHandler\b|Floor General|\bPoint\b|Point Guard|Playmak|Dimer|Diming|Distributor/;
export const BIG_HANDLE_PCT = 0.4;
// The same gates for a skill (the noun his plain skill name would say)
export const nounFitsPos = (k: NounKey, pos: Pos, handle?: number) =>
	!(
		(k === "rimD" && GUARD_POS.has(pos)) ||
		(k === "post" && SMALL_GUARD_POS.has(pos)) ||
		(k === "handle" &&
			CENTER_POS.has(pos) &&
			handle !== undefined &&
			handle < BIG_HANDLE_PCT)
	);
export const wordsFit = (
	name: string,
	pos: Pos,
	traits?: Record<string, number>,
	// his ball handling's standing (0..1); undefined: not checked (the regenerator's aim)
	handle?: number,
): boolean => {
	if (RIM_WORDS_RE.test(name) && GUARD_POS.has(pos)) {
		return false;
	}
	if (POST_WORDS_RE.test(name) && SMALL_GUARD_POS.has(pos)) {
		return false;
	}
	if (
		handle !== undefined &&
		handle < BIG_HANDLE_PCT &&
		CENTER_POS.has(pos) &&
		HANDLER_WORDS_RE.test(name)
	) {
		return false;
	}
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
export const traitKeywordOf = (
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
export const connector = (pct: Record<NounKey, number>) =>
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
	// archcov: each noun's values among the players of his position group in his league (absent: the reference
	// league's, nounGroups.data.ts)
	ng?: NounGroupQuantiles;
	// last season's pick, to keep its order when it is still about as good (archstick: and his whole label, `id` his
	// main name's id, kept while every rule still holds and it is about as good)
	prev?: {
		special?: string;
		nouns?: NounKey[];
		trait?: string;
		id?: string;
	};
	// archstick: false for the plain order of his nouns (no near tie given to last season's)
	tie?: false;
	// archcov: every standing moved by this much (re-checking last season's label with slack)
	slack?: number;
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
			// archstick: last season's id, kept as it was
			keepId?: string;
	  }
	| { kind: "trait"; key: string; name: string; conf: number }
	// no name of his own from his nouns: an honest name, about this noun (or about nothing)
	| { kind: "honest"; noun?: NounKey; conf: number }
) & {
	// archcov: the skills (and modifiers) the main name names, and why the name was chosen
	main?: NounKey[];
	explain?: CoverExplain;
	// archstick: read in the plain order of his nouns (NounInput.tie)
	tie?: false;
	// archcov: read with this slack (last season's label re-checked: NounInput.slack)
	slack?: number;
	// archfam: whether the main name covers his top two skills (families): last season's label is kept only while it does
	coversTop2?: boolean;
};

// How sure the name is (0..1): how clearly his named nouns clear the bar and stand above the next one he isn't named for
export const confOf = (
	cleared: readonly NounScore[],
	named: readonly NounKey[],
) => {
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

export const groupOfPos = (pos: Pos): PosGroup =>
	pos === "PG" || pos === "G" || pos === "SG"
		? "guard"
		: pos === "GF" || pos === "SF" || pos === "F"
			? "wing"
			: "big";

// The sub-rating that leads (by SUB_LEAN or more) among some, or undefined
export const leadSub = (
	r: ArchetypeRatings,
	keys: string[],
): string | undefined => {
	const v = keys
		.map((k) => ({ k, v: sub(r, k) }))
		.filter((x): x is { k: string; v: number } => x.v !== undefined)
		.sort((a, b) => b.v - a.v || keys.indexOf(a.k) - keys.indexOf(b.k));
	return v.length >= 2 && v[0]!.v - v[1]!.v >= SUB_LEAN ? v[0]!.k : undefined;
};
// (the user: "split common labels using sub-ratings": the plain word of a noun says which kind of it he is)
export const SUB_WORD: Partial<
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
	// (archskill: a post defender's word is his own skill's now, post defense)
	rimD: {
		keys: ["blk", "idf"],
		words: { blk: "shotBlocking" },
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
	if (
		new Set(toks).size !== toks.length ||
		// (archfam: "Post-Scoring Scorer")
		/Scoring\b.*\bScorer\b/.test(name)
	) {
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

// archskill (reading 29): a skill-noun name never says one stem twice ("Defensive Help Defender", "Rebounding
// Rebounder"): two words that start with the same five letters
export const stemRepeat = (name: string): boolean => {
	const stems = name
		.split(/[\s-]+/)
		.filter((t) => t.length >= 5)
		.map((t) => t.slice(0, 5).toLowerCase());
	return new Set(stems).size !== stems.length;
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
		nouns: ["three", "mid", "finish"],
		why: "three levels",
	},
	// (archfam: 3-Level: 3PT, mid-range and finishing all at the 78th percentile)
	{
		re: /Three-Level|3-Level/,
		check: (c) =>
			c.pct("three") >= THREE_LEVEL_PCT &&
			c.pct("mid") >= THREE_LEVEL_PCT &&
			c.pct("finish") >= THREE_LEVEL_PCT,
		why: "3PT, mid-range and finishing in the top 22%",
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
		check: (c) => c.pct("handle") >= 0.5 && c.pct("speed") >= NOUN_CLEAR,
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
		re: /Speedy|Glider|\bGlide\b|Burner|Track Star|\bJet\b|Open-Lane|Twitchy|Quick|\bFast\b|Speed/,
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
		// (archfam: his best defensive and best offensive skill both in the top 20%)
		check: (c) =>
			Math.max(...[...DEF_NOUNS].map((n) => c.pct(n))) >= 0.8 &&
			Math.max(...[...OFFENSE].map((n) => c.pct(n))) >= 0.8,
		why: "two ways (his best defensive and best offensive skill in the top 20%)",
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
	// (archskill: with traits, the trait; without them, the skill read from his ratings)
	{
		re: /Switch/,
		check: (c) =>
			c.traits
				? (c.traits.defensiveVersatility ?? -Infinity) >= 55
				: c.pct("switchD") >= NEW_STRONG_BAR,
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
	{
		re: /Off-Ball|Cutter|Mover/,
		check: (c) =>
			c.traits
				? (c.traits.offBall ?? -Infinity) >= 55
				: c.pct("cut") >= NEW_STRONG_BAR,
		why: "off-ball",
	},
	{
		re: /Roll Man|Roll-Man|Rolling|Screen/,
		check: (c) =>
			c.traits
				? (c.traits.screen ?? -Infinity) >= 50
				: c.pct("roll") >= NEW_STRONG_BAR,
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
	// archskill (reading 29): the new skills' words (for reports: a name's skill list says them)
	{
		re: /Foul|And-One|Free-Throw/,
		nouns: ["foulDraw"],
		why: "foul drawing",
	},
	{ re: /Backdoor|Cutter|Movement|Relocation/, nouns: ["cut"], why: "cutting" },
	{
		re: /Help-Side|Help Defender|Quarterback/,
		nouns: ["helpD"],
		why: "help defense",
	},
	{
		re: /Post-Defend|Post Stopper|Low-Post Wall/,
		nouns: ["postD"],
		why: "post defense",
	},
	{
		re: /Board-Hunting|Glass Crasher/,
		nouns: ["oreb"],
		why: "offensive rebounding",
	},
	{ re: /\bLong\b|Length|Pterodactyl/, nouns: ["length"], why: "length" },
	{ re: /Mistake-Free/, nouns: ["secure"], why: "ball security" },
	{ re: /Switchable|1-through-4/, nouns: ["switchD"], why: "switchability" },
	{
		re: /Lob-Catching|Lob Threat|Rim Runner|Vertical Spacer/,
		nouns: ["rimRun"],
		why: "rim running",
	},
	{
		re: /Screen-and-Roll|Roll Man|Short-Roll/,
		nouns: ["roll"],
		why: "screen and roll",
	},
	{ re: /Transition|Open-Court/, nouns: ["transition"], why: "transition" },
	{ re: /High-Motor|Motor Wing|Energy Big/, nouns: ["motor"], why: "motor" },
	// elite words (archskill, reading 29: and the development words of the older readings' names, never given now)
	{ re: ELITE_RE, check: (c) => c.eliteOvr, why: "an elite ovr" },
	// (archcov, the user's 2064 audit: "athlete with no game" with steals in the top 1%)
	{
		re: /No Game|Raw Athlete|Big Body|Toolsy/,
		check: (c) => c.cleared.size === 0,
		why: "no basketball skill in the top 30%",
	},
	{
		re: /\bRaw\b|Developing|Project|Late Bloomer|Lottery/,
		check: (c) => c.ovr <= 30 || c.cleared.size === 0,
		why: "ovr 30 or below, or no skill",
	},
];
// archfam: a 3-Level name needs 3PT, mid-range and finishing at this standing (cover.ts THREE_LEVEL_BAR)
export const THREE_LEVEL_PCT = 0.78;
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
export const normName = (n: string) =>
	n
		.toLowerCase()
		.replace(/[\s-]+/g, " ")
		.trim();

// ---- length (Expanded Ratings: wingspan well above his height) ----
export const LONG_MIN = 7;
export const isLong = (r: ArchetypeRatings) =>
	typeof r.wng === "number" && r.wng - r.hgt >= LONG_MIN;

// ---- the user's own special names (tested on his nouns, sub-ratings and traits; checked before anything else) ----
export type SpecialCtx = {
	pos: Pos;
	// his ovr's standing in the league (0..1)
	ovrPct?: number;
	pct: Record<NounKey, number>;
	r: ArchetypeRatings;
	traits?: Record<string, number>;
	eliteOvr: boolean;
	ovr: number;
	age?: number;
	best: NounKey | undefined;
};
const subGe = (r: ArchetypeRatings, a: string, ...others: string[]) =>
	others.every((o) => (sub(r, a) ?? 0) >= (sub(r, o) ?? 0));
const traitOk = (
	t: Record<string, number> | undefined,
	k: string,
	min: number,
) => t === undefined || (t[k] ?? 0) >= min;
export const JACK_NAME = "Jack-Of-All-Trades";
export type CustomSpecial = (typeof CUSTOM_SPECIALS)[number];
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
	...SKILL_SPECIALS(),
	...GAP_SPECIALS(),
	{
		key: "sSlashMiddyF",
		positions: ["SF", "F", "PF"],
		nouns: ["finish", "handle", "mid"],
		test: ({ pct }) => pct.finish >= 0.7 && pct.handle >= 0.6 && pct.mid >= 0.7,
	},
];
// archaudit 2059 (new_archetypes.csv): names for the gaps the audit found: veterans whose skills outlasted their legs,
// bigs the catalog had no plain name for, role names for several modest skills, non-elite words for real skills, and
// trait-driven names

const athAvg = (pct: Record<NounKey, number>) =>
	(pct.speed + pct.jump + pct.strength) / 3;
const trOf = (c: SpecialCtx, k: string) => c.traits?.[k] ?? 0;
function GAP_SPECIALS(): {
	key: string;
	positions: readonly Pos[];
	nouns: NounKey[];
	anyBest?: true;
	test: (c: SpecialCtx) => boolean;
}[] {
	return [
		// Veterans whose athleticism is gone but whose skills are not
		{
			key: "sSavvyGeneral", // "Savvy Floor General"
			positions: ["PG", "G", "SG"],
			nouns: ["pass", "crafty"],
			test: (c: SpecialCtx) =>
				(c.age ?? 0) >= 29 &&
				c.pct.pass >= 0.7 &&
				c.pct.crafty >= 0.65 &&
				athAvg(c.pct) <= 0.5 &&
				trOf(c, "veteranSavvy") >= 45,
		},
		{
			key: "sOldSchoolPost", // "Old-School Post Technician"
			positions: ["PF", "FC", "C"],
			nouns: ["post", "crafty"],
			test: (c: SpecialCtx) =>
				(c.age ?? 0) >= 29 &&
				c.pct.post >= 0.75 &&
				c.pct.crafty >= 0.55 &&
				c.pct.jump <= 0.4,
		},
		{
			key: "sBelowRimShotmaker", // "Below-the-Rim Shotmaker"
			positions: ["PG", "G", "SG", "GF", "SF", "F", "PF"],
			nouns: ["mid", "three"],
			test: (c: SpecialCtx) =>
				c.pct.mid >= 0.7 &&
				c.pct.three >= 0.6 &&
				c.pct.crafty >= 0.6 &&
				athAvg(c.pct) <= 0.45,
		},
		{
			key: "sVeteranStopper", // "Veteran Stopper"
			positions: ["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"],
			nouns: ["perimD"],
			test: (c: SpecialCtx) =>
				(c.age ?? 0) >= 29 &&
				Math.max(c.pct.perimD, c.pct.rimD, c.pct.helpD) >= 0.8 &&
				c.r.diq >= 60 &&
				athAvg(c.pct) <= 0.5,
		},
		// Bigs the catalog has no plain name for
		{
			key: "sHubCenter", // "Hub Center"
			positions: ["FC", "C"],
			nouns: ["pass", "post"],
			test: (c: SpecialCtx) =>
				c.pct.pass >= 0.8 && Math.max(c.pct.post, c.pct.reb) >= 0.6,
		},
		{
			key: "sFaceUpBig", // "Face-Up Big"
			positions: ["PF", "FC", "C"],
			nouns: ["handle", "mid"],
			test: (c: SpecialCtx) => c.pct.handle >= 0.75 && c.pct.jump <= 0.5,
		},
		{
			key: "sThreeDFour", // "3 & D Four"
			positions: ["SF", "F", "PF", "FC"],
			nouns: ["three", "perimD"],
			test: (c: SpecialCtx) =>
				c.pct.three >= 0.7 && Math.max(c.pct.perimD, c.pct.rimD) >= 0.75,
		},
		// Role names (no standout, several modest skills) — the non-elite, non-insulting middle
		{
			key: "sGlueForward", // "Glue Forward"
			positions: ["SF", "F", "PF"],
			nouns: ["perimD", "reb"],
			anyBest: true,
			test: (c: SpecialCtx) =>
				c.pct.perimD >= 0.6 &&
				c.pct.reb >= 0.6 &&
				(c.ovrPct ?? 0) <= 0.75 &&
				OLD_NOUNS.filter((n) => c.pct[n] >= 0.85).length === 0,
		},
		{
			key: "sGlueBig", // "Glue Big"
			positions: ["PF", "FC", "C"],
			nouns: ["rimD", "reb"],
			anyBest: true,
			test: (c: SpecialCtx) =>
				c.pct.rimD >= 0.6 &&
				c.pct.reb >= 0.6 &&
				c.pct.pass >= 0.5 &&
				OLD_NOUNS.filter((n) => c.pct[n] >= 0.85).length <= 1,
		},
		{
			key: "sConnectorF", // "Connector Forward"
			positions: ["SF", "F", "PF"],
			nouns: ["pass", "crafty"],
			test: (c: SpecialCtx) => c.pct.pass >= 0.65 && c.pct.crafty >= 0.6,
		},
		// Non-elite words for real skills on lower-ovr players (the elite gate blocks Sniper / Sharpshooter / Lockdown)
		{
			key: "sFloorSpacer", // "Floor Spacer"
			positions: ["PG", "G", "SG", "GF", "SF", "F", "PF"],
			nouns: ["three"],
			test: (c: SpecialCtx) => c.pct.three >= 0.8 && !c.eliteOvr,
		},
		{
			key: "sPoaStopper", // "Point-of-Attack Stopper"
			positions: ["PG", "G", "SG", "GF"],
			nouns: ["perimD"],
			test: (c: SpecialCtx) => c.pct.perimD >= 0.8 && !c.eliteOvr,
		},
		{
			key: "sSparkPlug", // "Spark Plug"
			positions: ["PG", "G", "SG"],
			nouns: ["handle", "speed"],
			test: (c: SpecialCtx) =>
				c.pct.speed >= 0.75 &&
				Math.max(c.pct.handle, c.pct.three, c.pct.mid) >= 0.65 &&
				(c.ovrPct ?? 0) <= 0.6,
		},
		// Trait-driven (traits shape the name, not just block words)
		{
			key: "sEnergyWing", // "Energy Wing"
			positions: ["SG", "GF", "SF", "F"],
			nouns: ["reb", "steal"],
			anyBest: true,
			test: (c: SpecialCtx) =>
				Math.max(trOf(c, "hustle"), trOf(c, "motor")) >= 65 &&
				athAvg(c.pct) >= 0.6,
		},
		{
			key: "sClutchShotmaker", // "Clutch Shotmaker"
			positions: ["PG", "G", "SG", "GF", "SF", "F"],
			nouns: ["mid", "creator"],
			test: (c: SpecialCtx) =>
				trOf(c, "clutch") >= 70 &&
				trOf(c, "lateGameIq") >= 55 &&
				Math.max(c.pct.mid, c.pct.three) >= 0.7,
		},
	];
}
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
		OLD_NOUNS.filter((n) => n !== "crafty" && c.pct[n] >= min).length;
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
				OLD_NOUNS.some((n) => n !== "crafty" && c.pct[n] >= 0.85),
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
// archskill (reading 29): catalog names of the new skills (each needs its skills among his best, like any special name)
function SKILL_SPECIALS(): {
	key: string;
	positions: readonly Pos[];
	nouns: NounKey[];
	test: (c: SpecialCtx) => boolean;
}[] {
	const G_F: Pos[] = ["PG", "G", "SG", "GF", "SF", "F"];
	const BIGS: Pos[] = ["PF", "FC", "C"];
	const tv = (c: SpecialCtx, k: string) => c.traits?.[k] ?? -Infinity;
	return [
		{
			key: "s4Pterodactyl",
			positions: ["GF", "SF", "F", "PF", "FC", "C"],
			nouns: ["length", "rimD"],
			test: ({ pct }) => pct.length >= 0.95 && pct.rimD >= 0.8,
		},
		{
			key: "s4TransitionWeapon",
			positions: G_F,
			nouns: ["transition", "finish"],
			test: ({ pct }) => pct.transition >= 0.9 && pct.finish >= 0.8,
		},
		{
			key: "s4OpenCourtBlur",
			positions: ["PG", "G", "SG"],
			nouns: ["transition", "handle"],
			test: ({ pct }) =>
				pct.transition >= 0.9 && pct.speed >= 0.9 && pct.handle >= 0.75,
		},
		{
			key: "s4EnergyBig",
			positions: BIGS,
			nouns: ["motor", "reb"],
			test: (c) =>
				c.pct.motor >= 0.85 && c.pct.reb >= 0.75 && tv(c, "hustle") >= 55,
		},
		{
			key: "s4MotorWing",
			positions: ["SG", "GF", "SF", "F"],
			nouns: ["motor", "perimD"],
			test: (c) =>
				c.pct.motor >= 0.85 && c.pct.perimD >= 0.75 && tv(c, "motor") >= 50,
		},
		{
			key: "s4RelocationSniper",
			positions: G_F,
			nouns: ["cut", "three"],
			test: ({ pct, eliteOvr }) =>
				eliteOvr && pct.three >= ELITE_PCT && pct.cut >= 0.85,
		},
		{
			key: "s4OneThroughFour",
			positions: ["GF", "SF", "F", "PF"],
			nouns: ["switchD"],
			test: ({ pct }) => pct.switchD >= 0.9 && pct.perimD >= 0.75,
		},
		{
			key: "s4VerticalSpacer",
			positions: BIGS,
			nouns: ["rimRun", "jump"],
			test: ({ pct }) => pct.rimRun >= 0.85 && pct.jump >= 0.9,
		},
	];
}
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
		OLD_NOUNS.filter((n) => n !== "crafty" && c.pct[n] >= min).length;
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
				OLD_NOUNS.every((n) => n === "crafty" || c.pct[n] < 0.9),
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
				OLD_NOUNS.every(
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
				OLD_NOUNS.filter(
					(n) => n !== "three" && n !== "crafty" && c.pct[n] >= 0.7,
				).length <= 1,
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
				OLD_NOUNS.every((n) => n === "crafty" || c.pct[n] < 0.85) &&
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
export type EndCtx = {
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
export const GUARD_POS: ReadonlySet<Pos> = new Set(["PG", "G", "SG"]);
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
			OLD_NOUNS.every(
				(n) => n === "three" || n === "crafty" || c.pct[n] < 0.85,
			),
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
			OLD_NOUNS.filter((n) => n !== "crafty" && c.pct[n] >= 0.9).length >= 2,
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
	// (archfam: "Five" names only a center: C or FC)
	{ key: "eFive", ok: (c) => c.pos === "C" || c.pos === "FC" },
];

// ---- archskill (reading 29): the plain noun of each skill ----
// A one-skill player's name is the noun of his skill ("Rebounder"); two skills, the front word of one and the noun of
// the other ("Glass-Cleaning Contact Finisher"). Each skill's nouns are tried in order, the first that fits him naming
// it: an elite standing, a sub-rating lean (SUB_LEAN), a modifier at the word bar; the last always fits. Crafty and the
// modifiers have no noun (they are words next to a skill).
export type SkillNounCtx = {
	pct: Record<NounKey, number>;
	r: ArchetypeRatings;
	group: PosGroup;
	elite: (k: NounKey) => boolean;
	rq?: RatingQuantiles;
	traits?: Record<string, number>;
};
type SkillNoun = { key: string; ok?: (c: SkillNounCtx) => boolean };
const leadOver = (a: number, b: number) => a - b >= SUB_LEAN;
export const SKILL_NOUNS: Partial<Record<NounKey, SkillNoun[]>> = {
	three: [
		{ key: "kSharpshooter", ok: (c) => c.elite("three") },
		{
			key: "kSpotUpShooter",
			ok: (c) => leadSub(c.r, ["tcs", "tod"]) === "tcs",
		},
		{
			key: "kPullUpShooter",
			ok: (c) => leadSub(c.r, ["tcs", "tod"]) === "tod",
		},
		{ key: "kShooter" },
	],
	mid: [
		{
			key: "kPullUpArtist",
			ok: (c) => leadSub(c.r, ["pul", "spu"]) === "pul" && c.pct.mid >= 0.7,
		},
		{ key: "kMidShooter" },
	],
	post: [
		{
			key: "kCloseScorer",
			ok: (c) =>
				c.group !== "big" && leadSub(c.r, ["pst", "cls", "flt"]) === "cls",
		},
		{
			key: "kTouchScorer",
			ok: (c) =>
				c.group !== "big" && leadSub(c.r, ["pst", "cls", "flt"]) === "flt",
		},
		{ key: "kPostScorer" },
	],
	finish: [
		{
			key: "kBulldozer",
			ok: (c) =>
				leadSub(c.r, ["con", "fns", "flt"]) === "con" &&
				c.pct.strength >= ATH_WORD_BAR,
		},
		{
			key: "kContactFinisher",
			ok: (c) => leadSub(c.r, ["con", "fns", "flt"]) === "con",
		},
		{
			key: "kAcroFinisher",
			ok: (c) => leadSub(c.r, ["con", "fns", "flt"]) === "fns",
		},
		{
			key: "kTouchFinisher",
			ok: (c) => leadSub(c.r, ["con", "fns", "flt"]) === "flt",
		},
		{ key: "kFinisher" },
	],
	rimRun: [
		{ key: "kLobThreat", ok: (c) => c.pct.jump >= ATH_WORD_BAR },
		{ key: "kRimRunner" },
	],
	foulDraw: [
		{
			key: "kAndOne",
			ok: (c) =>
				leadOver(sub(c.r, "con") ?? c.r.dnk, c.r.ft) &&
				c.pct.finish >= STRONG_BAR,
		},
		{
			key: "kFtMerchant",
			ok: (c) => leadOver(c.r.ft, sub(c.r, "con") ?? c.r.dnk),
		},
		{ key: "kFoulMagnet" },
	],
	cut: [
		{
			key: "kMovementShooter",
			ok: (c) =>
				leadOver(sub(c.r, "spu") ?? c.r.fg, c.r.dnk) &&
				c.pct.three >= SKILL_BAR,
		},
		{ key: "kBackdoorCutter" },
	],
	rimD: [
		{
			key: "kShotBlocker",
			ok: (c) => leadSub(c.r, ["blk", "idf"]) === "blk",
		},
		{ key: "kRimProtector" },
	],
	postD: [
		{ key: "kLowPostWall", ok: (c) => c.pct.strength >= ATH_WORD_BAR },
		{ key: "kPostStopper" },
	],
	helpD: [
		{ key: "kDefQB", ok: (c) => c.elite("helpD") },
		{ key: "kHelpAnchor", ok: (c) => c.group === "big" },
		{ key: "kHelpDefender" },
	],
	perimD: [
		{ key: "kLockdownDefender", ok: (c) => c.elite("perimD") },
		{ key: "kLengthDefender", ok: (c) => c.pct.length >= ATH_WORD_BAR },
		{ key: "kPerimDefender" },
	],
	steal: [{ key: "kBallHawk" }],
	switchD: [{ key: "kSwitchDefender" }],
	handle: [{ key: "kBallHandler" }],
	creator: [
		{
			key: "kShotCreator",
			ok: (c) => {
				const crt = sub(c.r, "crt");
				return crt === undefined || pctOf("drb", crt, c.rq) >= NOUN_CLEAR;
			},
		},
		{ key: "kBallHandler" },
	],
	secure: [{ key: "kMistakeFree" }],
	pass: [
		{ key: "kVisionary", ok: (c) => leadSub(c.r, ["vis", "acc"]) === "vis" },
		{
			key: "kPrecisionPasser",
			ok: (c) => leadSub(c.r, ["vis", "acc"]) === "acc",
		},
		{ key: "kPasser" },
	],
	reb: [{ key: "kRebounder" }],
	oreb: [{ key: "kGlassCrasher" }],
	roll: [
		{ key: "kShortRoll", ok: (c) => c.pct.pass >= STRONG_BAR },
		{ key: "kRollMan" },
	],
};
// The skill each noun says (its first skill: Ball Handler is handling's, also shot creation's last noun)
export const SKILL_ROLE_NOUN: ReadonlyMap<string, NounKey> = (() => {
	const m = new Map<string, NounKey>();
	for (const [n, vs] of Object.entries(SKILL_NOUNS) as [
		NounKey,
		SkillNoun[],
	][]) {
		for (const v of vs) {
			if (!m.has(v.key)) {
				m.set(v.key, n);
			}
		}
	}
	return m;
})();
// The noun his skill takes now (undefined for a skill with no noun: offensive IQ, the modifiers)
export const skillNounOf = (n: NounKey, c: SkillNounCtx): string | undefined =>
	SKILL_NOUNS[n]?.find((v) => v.ok?.(c) ?? true)?.key;

// ---- the defensive label ----
export const DEF_NOUNS: ReadonlySet<NounKey> = new Set([
	"rimD",
	"perimD",
	"steal",
	// archskill (reading 29)
	"helpD",
	"postD",
	"switchD",
]);

// Whether his ovr is elite: the league's top ELITE_OVR_PCT, never below ELITE_OVR_FLOOR (no league table: NOUN_ELITE_OVR)
export const eliteOvrOf = (ovr: number | undefined, rq?: RatingQuantiles) => {
	const ovrTable = tableOf("ovr", rq);
	return (
		ovr !== undefined &&
		(ovrTable
			? ovr >= ELITE_OVR_FLOOR && percentileIn(ovrTable, ovr) >= ELITE_OVR_PCT
			: ovr >= NOUN_ELITE_OVR)
	);
};
// archstick: last season's main name, read back from its id: a special name (a build), the user's own name,
// Jack-Of-All-Trades, a trait name with no noun, or a noun name (front words and an end word, or a skill noun).
// Undefined for a name of an older reading (an honest name), an id of another size group, or a name the nouns never give.
export type PrevMain = { id: string } & (
	| { kind: "special"; sp: Special }
	| { kind: "custom"; c: CustomSpecial; twoWay?: true }
	| { kind: "jack" }
	| { kind: "keyword"; role: string; name: string }
	| {
			kind: "composed";
			role: string;
			descs: string[];
			name: string;
			pick: Record<string, string>;
	  }
);
// (the nouns a near tie goes to, unless the plain order was asked for)
export const tieFavored = (x: NounInput) =>
	x.tie === false ? undefined : favoredNouns(x);
// archstick: the nouns last season's label named (its main name and its defensive label), which win a near tie
const favoredNouns = (x: NounInput): ReadonlySet<NounKey> | undefined => {
	if (!x.prev) {
		return undefined;
	}
	const out = new Set<NounKey>(x.prev.nouns ?? []);
	const pm = prevMainOf(x, x.pos);
	if (pm?.kind === "special") {
		for (const n of pm.sp.nouns) {
			out.add(n);
		}
	} else if (pm?.kind === "custom") {
		for (const n of pm.c.nouns) {
			out.add(n === "creator" ? "handle" : n);
		}
	} else if (pm?.kind === "composed") {
		for (const d of pm.descs) {
			if (d === "highlightReel") {
				out.add("jump");
				out.add("finish");
			}
			const n = nounOfDesc(d);
			if (n) {
				out.add(n);
			}
		}
		const e = END_WORDS.find((w) => w.key === pm.role);
		if (e?.covers) {
			out.add(e.covers);
		}
		// (archskill: a skill noun's skill)
		const k = SKILL_ROLE_NOUN.get(pm.role);
		if (k) {
			out.add(k);
		}
	}
	return out.size > 0 ? out : undefined;
};
// (the nouns a defensive label says: labels stored before reading 28, read by the audit scripts only)
export const defLabelNouns = (label: string | undefined): NounKey[] => {
	if (!label) {
		return [];
	}
	const base = label.replace(/^(Long|Switchable) /, "");
	if (/Roamer/.test(base)) {
		return ["rimD", "steal"];
	}
	if (/Switch Defender/.test(base)) {
		return ["rimD", "perimD"];
	}
	if (/Pest/.test(base)) {
		return ["perimD", "steal"];
	}
	if (/Swatting|Eraser|Blocker|Post Defender|Protector/.test(base)) {
		return ["rimD"];
	}
	if (/Stalker|Lockdown|Cerebral|Stopper|Perimeter Defender/.test(base)) {
		return ["perimD"];
	}
	return /Hawk|Menace|Interceptor/.test(base) ? ["steal"] : [];
};
export const prevMainOf = (x: NounInput, pos: Pos): PrevMain | undefined => {
	const id = x.prev?.id;
	if (!id) {
		return undefined;
	}
	if (!isComposedId(id)) {
		const sp = specialsAt(pos).find((s) => s.id === id);
		return sp ? { id, kind: "special", sp } : undefined;
	}
	const pc = parseComposedId(id);
	if (!pc || pc.group !== GROUP_OF[pos]) {
		return undefined;
	}
	const key = pc.role.key;
	const name = composeName(pc.role, pc.descs, pc.group, pc.pick);
	// (archfam: the user's own name with a 2-Way prefix)
	if (pc.descs.length === 1 && pc.descs[0]!.key === "twoWay") {
		const c = CUSTOM_SPECIALS.find((cs) => cs.key === key);
		if (c) {
			return { id, kind: "custom", c, twoWay: true };
		}
	}
	if (pc.descs.length === 0) {
		const c = CUSTOM_SPECIALS.find((cs) => cs.key === key);
		if (c) {
			return { id, kind: "custom", c };
		}
		if (key === "sJack") {
			return { id, kind: "jack" };
		}
		if (key === "tConnector" || TRAIT_KEYWORDS.some((t) => t.role === key)) {
			return { id, kind: "keyword", role: key, name };
		}
	}
	if (
		key.startsWith("pos") ||
		key === "bruiser" ||
		key === "enigma" ||
		END_WORDS.some((e) => e.key === key) ||
		SKILL_ROLE_NOUN.has(key)
	) {
		const pick: Record<string, string> = {};
		for (const [k, v] of Object.entries(pc.pick)) {
			if (v !== undefined) {
				pick[k] = v;
			}
		}
		return {
			id,
			kind: "composed",
			role: key,
			descs: pc.descs.map((d) => d.key),
			name,
			pick,
		};
	}
	return undefined;
};

// archcov: why a name was chosen (stored with the label: types.ts ArchetypeReason)
export type CoverExplain = {
	skills: NounKey[];
	pct: number[];
	weights: number[];
	gate: string;
	variant: string;
	score: number;
	fit: number;
	runnerUp?: { name: string; score: number };
};
// ---- archcov: the coverage reading (the user's 2064 audit) ----
// Each noun is read against the league AND against his position group (guards, wings, bigs): its standing is the lower
// of the two, so a skill counts only when it is good outright and good for his position (a big's rebounding at the
// league's 78th percentile is only par among bigs). Speed, leaping and strength are modifiers, not skills: they lead a
// name only when no basketball skill clears its bar, and else may only add a word next to one.
// A basketball skill may be named from this standing (league and position): its weight in a name's score ramps from
// nothing here (cover.ts skillWeight), so a skill just over it is named only when nothing better is there
export const SKILL_BAR = 0.65;
// ... and is one of his real skills from this one (an honest name below it, a specialist's with one at low ovr)
export const STRONG_BAR = 0.7;
// Offensive IQ (Crafty, a style) clears higher
export const CRAFTY_BAR = 0.75;
export const CRAFTY_STRONG = 0.8;
// The athletic nouns: modifiers
export const ATH_KEYS: ReadonlySet<NounKey> = new Set([
	"speed",
	"jump",
	"strength",
	// archskill (reading 29): length, transition and motor are modifiers too (a word next to a skill, or a catalog name)
	"length",
	"transition",
	"motor",
]);
// An athletic noun leads a name (no basketball skill clears) from this standing
export const ATH_LEAD_BAR = 0.7;
// ... and is a word next to a skill from this one
export const ATH_WORD_BAR = 0.85;
// archcov: hysteresis: last season's label is re-checked with every standing this much higher (and an honest name, or no
// defensive tag, this much lower), so a label is lost only to a real change, not to a point of noise in the ratings
export const STICK_BOOST = 0.02;
// A defensive skill outside the main name gives a defensive tag from this standing (or as his second-best skill)
export const DEF_TAG_PCT = 0.85;
// A name's skills must be among his best TOP_N (and include his best one)
export const TOP_N = 4;
// archskill (reading 29): the new skills (not the modifiers) clear higher, as offensive IQ does: each reads ratings an old
// skill also reads, so it names a player only when it stands out (NEW_SKILL_BAR may be named, NEW_STRONG_BAR real)
export const NEW_SKILL_BAR = 0.8;
export const NEW_STRONG_BAR = 0.85;
export const coverBar = (k: NounKey) =>
	k === "crafty"
		? CRAFTY_BAR
		: ATH_KEYS.has(k)
			? ATH_LEAD_BAR
			: NEW_NOUNS.has(k)
				? NEW_SKILL_BAR
				: SKILL_BAR;
export const strongBar = (k: NounKey) =>
	k === "crafty"
		? CRAFTY_STRONG
		: NEW_NOUNS.has(k) && !ATH_KEYS.has(k)
			? NEW_STRONG_BAR
			: STRONG_BAR;

export type CoverScore = NounScore & {
	// his standing in the league and among his position group (pct: the lower of the two)
	league: number;
	group: number;
};
const groupTable = (
	group: PosGroup,
	k: NounKey,
	ng?: NounGroupQuantiles,
): number[] | undefined => ng?.[group]?.[k] ?? NOUN_GROUP_REF[group]?.[k];
const byCover = (
	at: (s: CoverScore) => number = (s) => s.pct,
): ((a: CoverScore, b: CoverScore) => number) => {
	return (a, b) =>
		at(b) - at(a) ||
		b.league + b.group - (a.league + a.group) ||
		b.above - a.above ||
		NOUNS.indexOf(a.key) - NOUNS.indexOf(b.key);
};
// Every noun's standing (league, position group, and the lower of the two), best first
// archskill: a reading asks for the same standings several times (the pick, its context, last season's label re-checked
// with slack): the last few answers per ratings object are kept, with a print of its values in case it was changed
const scoreMemo = new WeakMap<
	object,
	{ args: readonly unknown[]; out: CoverScore[] }[]
>();
const printOf = (r: ArchetypeRatings) =>
	Object.values(r)
		.map((v) => (Array.isArray(v) ? v.join(",") : String(v)))
		.join("|");
export const coverScores = (
	r: ArchetypeRatings,
	pos: Pos,
	rq?: RatingQuantiles,
	ng?: NounGroupQuantiles,
	// archcov: every standing moved by this much (the slack a last-season label is re-checked with: nouns.ts STICK_BOOST)
	shift = 0,
	// archskill: his traits (the trait-read skills read the visible ones: SKILL_TRAITS)
	traits?: Partial<Record<string, number>>,
): CoverScore[] => {
	const args = [pos, rq, ng, shift, traits, printOf(r)] as const;
	const memo = scoreMemo.get(r) ?? [];
	const hit = memo.find((m) => m.args.every((a, i) => a === args[i]));
	if (hit) {
		return hit.out;
	}
	const out = coverScoresOf(r, pos, rq, ng, shift, traits);
	memo.push({ args, out });
	if (memo.length > 6) {
		memo.shift();
	}
	scoreMemo.set(r, memo);
	return out;
};
const coverScoresOf = (
	r: ArchetypeRatings,
	pos: Pos,
	rq: RatingQuantiles | undefined,
	ng: NounGroupQuantiles | undefined,
	shift: number,
	traits: Partial<Record<string, number>> | undefined,
): CoverScore[] => {
	const group = groupOfPos(pos);
	// (reports only: standings given outright, as an audit quotes them)
	const given = (r as { __standings?: Partial<Record<NounKey, number>> })
		.__standings;
	// (archcov: the league standing against the league's own table of the noun's value; without the league's tables, a
	// league's rating tables when given, else the reference league's values)
	return nounScores(r, rq, traits, NOUNS)
		.map((s) => {
			if (s.missing) {
				return { ...s, league: 0, group: 0, pct: 0 };
			}
			const lt =
				ng?.all?.[s.key] ?? (rq ? undefined : NOUN_GROUP_REF.all?.[s.key]);
			const gv = given?.[s.key];
			const l = gv ?? (lt ? percentileIn(lt, s.value) : s.pct);
			const t = groupTable(group, s.key, ng);
			const g0 = gv ?? (t ? percentileIn(t, s.value) : l);
			const league = Math.max(0, Math.min(1, l + shift));
			const g = Math.max(0, Math.min(1, g0 + shift));
			return { ...s, league, group: g, pct: Math.min(league, g) };
		})
		.sort(byCover());
};
// archfam (reading 28, the user's 2070 audit): skills that say much the same thing count once, as a family: shooting
// (3PT and mid-range, correlated 0.67), creation (ball handling and shot creation) and perimeter D (perimeter D and
// steals). A family stands where its best member stands, and is named by one word: shooting by 3PT unless mid-range
// leads it by MID_EDGE (or 3PT doesn't clear its bar), creation and perimeter D by the higher member. No name spends two
// words on one family.
export const FAMILY_HEAD: Partial<Record<NounKey, NounKey>> = {
	mid: "three",
	creator: "handle",
	steal: "perimD",
	// archskill (reading 29): ball security with creation, switchability with perimeter D, post defense and help defense
	// with rim protection (interior D), offensive rebounding with rebounding, rim running, cutting and the roll man with
	// finishing (each reads much what its family's head reads: as a family it counts once)
	secure: "handle",
	switchD: "perimD",
	postD: "rimD",
	oreb: "reb",
	rimRun: "finish",
	cut: "finish",
	roll: "finish",
	helpD: "rimD",
};
export const familyOf = (k: NounKey): NounKey => FAMILY_HEAD[k] ?? k;
export const familyMembers = (head: NounKey): NounKey[] =>
	[head, ...(Object.keys(FAMILY_HEAD) as NounKey[])].filter(
		(k) => familyOf(k) === head,
	);
// Mid-range names the shooting family only with this lead over 3PT
export const MID_EDGE = 0.06;
// archfam: mid-range and offensive IQ lead his skills only with this edge (a mid-range lead within a few points of his
// 3PT is the same jumper; offensive IQ is mostly a flavor word)
export const LEAD_EDGE = 0.03;
// The word that names a family, from each member's standing
export const familyRep = (
	head: NounKey,
	pct: (k: NounKey) => number,
): NounKey => {
	if (head === "three") {
		return pct("mid") >= pct("three") + MID_EDGE ||
			pct("three") < coverBar("three")
			? "mid"
			: "three";
	}
	let rep: NounKey =
		head === "handle"
			? pct("creator") > pct("handle")
				? "creator"
				: "handle"
			: head === "perimD"
				? pct("steal") > pct("perimD")
					? "steal"
					: "perimD"
				: head;
	// (archskill: a reading-29 member names its family only with MID_EDGE over the word above, or when that word doesn't
	// clear its bar and the member does: "Glass Crasher" only for a player whose offensive rebounding clearly leads)
	for (const m of NEW_MEMBERS[head] ?? []) {
		if (
			pct(m) >= coverBar(m) &&
			(pct(m) >= pct(rep) + NEW_MEMBER_EDGE || pct(rep) < coverBar(rep))
		) {
			rep = m;
		}
	}
	return rep;
};
// archskill (reading 29): the new skills in an old family (they name it only with a clear lead, NEW_MEMBER_EDGE: familyRep)
export const NEW_MEMBER_EDGE = 0.15;
const NEW_MEMBERS: Partial<Record<NounKey, NounKey[]>> = {
	handle: ["secure"],
	perimD: ["switchD"],
	rimD: ["postD", "helpD"],
	reb: ["oreb"],
	finish: ["rimRun", "cut", "roll"],
};
// archskill: a new skill with a family of its own (foul drawing) leads his skills only with this edge (as mid-range and
// offensive IQ need LEAD_EDGE), so a skill read from ratings an old one also reads (foul drawing from finishing and free
// throws) doesn't crowd out the old one on a near tie
export const NEW_EDGE = 0.08;
// (every reading-29 skill)
export const NEW_NOUNS: ReadonlySet<NounKey> = new Set([
	"foulDraw",
	"cut",
	"helpD",
	"postD",
	"oreb",
	"length",
	"secure",
	"switchD",
	"rimRun",
	"roll",
	"transition",
	"motor",
]);
// (the skills of reading 28: what the catalog's and the user's names count, "8 skills in the top 30%", read on)
export const OLD_NOUNS: readonly NounKey[] = NOUNS.filter(
	(n) => !NEW_NOUNS.has(n),
);
export const NEW_OWN: ReadonlySet<NounKey> = new Set(["foulDraw"]);
export const leadEdgeOf = (k: NounKey) =>
	k === "mid" || k === "crafty" ? LEAD_EDGE : NEW_OWN.has(k) ? NEW_EDGE : 0;
// His basketball skills that clear their bar, best first, one per family (its naming word, at the family's standing);
// a near tie (STICK_TIE) goes to the families last season's label named
export const coverSkills = (
	scores: readonly CoverScore[],
	favored?: ReadonlySet<NounKey>,
): CoverScore[] => {
	const at = new Map(scores.map((s) => [s.key, s]));
	const pctOf = (k: NounKey) => at.get(k)?.pct ?? 0;
	const out: CoverScore[] = [];
	const seen = new Set<NounKey>();
	for (const s of scores) {
		if (ATH_KEYS.has(s.key) || s.pct < coverBar(s.key)) {
			continue;
		}
		const head = familyOf(s.key);
		if (seen.has(head)) {
			continue;
		}
		seen.add(head);
		const members = familyMembers(head)
			.map((k) => at.get(k))
			.filter((m): m is CoverScore => m !== undefined);
		const rep = at.get(familyRep(head, pctOf)) ?? s;
		out.push({
			...rep,
			pct: Math.max(...members.map((m) => m.pct)),
			league: Math.max(...members.map((m) => m.league)),
			group: Math.max(...members.map((m) => m.group)),
		});
	}
	const fav = (k: NounKey) =>
		familyMembers(familyOf(k)).some((m) => favored?.has(m));
	return out.sort(
		byCover((s) => s.pct - leadEdgeOf(s.key) + (fav(s.key) ? STICK_TIE : 0)),
	);
};

export type CoverCtx = {
	// standing (lower of league and position) and league standing
	pct: (k: NounKey) => number;
	league: (k: NounKey) => number;
	// his basketball skills that may be named, best first, and how many of them are real skills (strongBar)
	skills: NounKey[];
	strong: NounKey[];
	// his athletic nouns at the lead bar, best first
	ath: NounKey[];
	traits?: Record<string, number>;
	eliteOvr: boolean;
	mobile: boolean;
	ovr: number;
	upside: boolean;
	crtPct?: number;
};
export const coverCtxOf = (x: NounInput): CoverCtx => {
	const scores = coverScores(x.r, x.pos, x.rq, x.ng, x.slack, x.traits);
	const pct = Object.fromEntries(scores.map((s) => [s.key, s.pct])) as Record<
		NounKey,
		number
	>;
	const league = Object.fromEntries(
		scores.map((s) => [s.key, s.league]),
	) as Record<NounKey, number>;
	const crt = sub(x.r, "crt");
	return {
		pct: (k) => pct[k],
		league: (k) => league[k],
		skills: coverSkills(scores, tieFavored(x)).map((s) => s.key),
		strong: coverSkills(scores, tieFavored(x))
			.filter((s) => s.pct >= strongBar(s.key))
			.map((s) => s.key),
		ath: scores
			.filter((s) => ATH_KEYS.has(s.key) && s.pct >= ATH_LEAD_BAR)
			.map((s) => s.key),
		...(x.traits ? { traits: x.traits } : {}),
		eliteOvr: eliteOvrOf(x.ovr, x.rq),
		mobile: mobile(x.r, x.rq),
		ovr: x.ovr ?? 99,
		upside: hasUpside(x),
		...(crt === undefined ? {} : { crtPct: pctOf("drb", crt, x.rq) }),
	};
};
// The rank of a skill among his best (Infinity when it doesn't clear): its family's rank (archfam), when the skill itself
// clears its bar
export const skillRank = (c: CoverCtx, n: NounKey): number => {
	const i = c.skills.indexOf(n);
	if (i >= 0) {
		return i;
	}
	if (ATH_KEYS.has(n) || c.pct(n) < coverBar(n)) {
		return Infinity;
	}
	const j = c.skills.findIndex((k) => familyOf(k) === familyOf(n));
	return j < 0 ? Infinity : j;
};
const WHY_NOUN: Record<NounKey, string> = {
	three: "3PT",
	mid: "mid-range",
	post: "post scoring",
	finish: "finishing",
	rimD: "rim protection",
	perimD: "perimeter D",
	steal: "steals",
	handle: "ball handling",
	creator: "shot creation",
	pass: "passing",
	reb: "rebounding",
	speed: "speed",
	jump: "leaping",
	strength: "strength",
	crafty: "offensive IQ",
	foulDraw: "foul drawing",
	cut: "off-ball cutting",
	helpD: "help defense",
	postD: "post defense",
	oreb: "offensive rebounding",
	length: "length",
	secure: "ball security",
	switchD: "switchability",
	rimRun: "rim running",
	roll: "screen and roll",
	transition: "transition",
	motor: "motor",
};
// archcov: what a name promises, from its own skill list (every kind of name has one: a special name's skills, a noun
// name's front and end words, an honest name's skill, a defensive label's), so a name's promises never drift from what
// it is about: each skill clears (league and position) and is among his best TOP_N; an athletic noun is a modifier (the
// lead bar with no skill, else the word bar, and never alone next to a skill). Then the words that are no skill: trait
// words, elite words, development words, and the checks (a Gunner's jumper among the name's skills, 2-Way, Lockdown's
// mobility, a high flyer's finishing, Jack's breadth).
export const coverPromises = (
	name: string,
	list: readonly NounKey[],
	c: CoverCtx,
	// (archskill: a skill name given for his best skills against the league, cover.ts skillPick: only the words that are
	// no skill are checked)
	wordsOnly = false,
): string[] => {
	const out: string[] = [];
	const skillN = wordsOnly ? [] : list.filter((n) => !ATH_KEYS.has(n));
	const athN = wordsOnly ? [] : list.filter((n) => ATH_KEYS.has(n));
	for (const n of skillN) {
		const rank = skillRank(c, n);
		if (rank === Infinity) {
			out.push(
				`${WHY_NOUN[n]}: not in the top ${Math.round(100 * (1 - coverBar(n)))}% (league and position)`,
			);
		} else if (rank >= TOP_N) {
			out.push(`${WHY_NOUN[n]}: not one of his ${TOP_N} best`);
		}
	}
	const athBar = c.strong.length === 0 ? ATH_LEAD_BAR : ATH_WORD_BAR;
	for (const n of athN) {
		if (c.pct(n) < athBar) {
			out.push(
				`${WHY_NOUN[n]} (a modifier): not in the top ${Math.round(100 * (1 - athBar))}%`,
			);
		}
	}
	if (athN.length > 0 && skillN.length === 0 && c.strong.length > 0) {
		out.push(
			`names his athleticism only (his best: ${WHY_NOUN[c.strong[0]!]})`,
		);
	}
	const nctx: NameCtx = {
		cleared: new Set(c.strong),
		top3: new Set(c.skills.slice(0, 3)),
		pct: c.pct,
		...(c.crtPct === undefined ? {} : { crtPct: c.crtPct }),
		...(c.traits ? { traits: c.traits } : {}),
		eliteOvr: c.eliteOvr,
		mobile: c.mobile,
		ovr: c.ovr,
		upside: c.upside,
	};
	for (const w of WORD_REQ) {
		if (!w.re.test(name) || "nouns" in w) {
			continue;
		}
		if ("any" in w) {
			if (!w.any.some((n) => list.includes(n))) {
				out.push(`${w.why}: none among the name's skills`);
			}
		} else if ("trait" in w) {
			if ((c.traits?.[w.trait] ?? -Infinity) < w.min) {
				out.push(`${w.why}: trait below ${w.min}`);
			}
		} else if (!w.check(nctx)) {
			out.push(`needs ${w.why}`);
		}
	}
	return out;
};
// The promises of a name with no list of its own, for reports: its skill words read as its list
export const wordNouns = (name: string): NounKey[] => {
	const out = new Set<NounKey>();
	for (const w of WORD_REQ) {
		if ("nouns" in w && w.re.test(name)) {
			for (const n of w.nouns) {
				out.add(n);
			}
		}
	}
	return [...out];
};
// The promises (in words) a name with this skill list makes, for the names CSV
export const listPromiseText = (
	name: string,
	list: readonly NounKey[],
): string[] => {
	const out: string[] = [];
	for (const n of list) {
		out.push(
			ATH_KEYS.has(n)
				? `${WHY_NOUN[n]} (a modifier) top ${Math.round(100 * (1 - ATH_WORD_BAR))}%, or top ${Math.round(100 * (1 - ATH_LEAD_BAR))}% with no skill`
				: `${WHY_NOUN[n]} top ${Math.round(100 * (1 - coverBar(n)))}% (league and position) and one of his ${TOP_N} best`,
		);
	}
	for (const w of WORD_REQ) {
		if (!w.re.test(name) || "nouns" in w) {
			continue;
		}
		out.push(
			"any" in w
				? `${w.why}: one of ${w.any.map((n) => WHY_NOUN[n]).join(", ")} among the name's skills`
				: "trait" in w
					? `trait ${w.trait} ${w.min}+`
					: w.why,
		);
	}
	return out;
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
	[/Shot-Blocking/, "rimD"],
	// (archskill, reading 29: the new skills' front words)
	[/Post-Defending/, "postD"],
	[/Foul-Drawing/, "foulDraw"],
	[/Backdoor/, "cut"],
	[/Help-Side/, "helpD"],
	[/Mistake-Free/, "secure"],
	[/Lob-Catching/, "rimRun"],
	[/Screen-and-Roll/, "roll"],
	[/\bTransition\b/, "transition"],
	[/High-Motor/, "motor"],
	[/Quick-Footed|Twitchy/, "speed"],
	[/\b(Driver|Glider)$/, "speed"],
	[/\bDriver$/, "handle"],
	[/\b(Point|Dimer|Facilitator|Wizard|Architect|Engine|General)$/, "pass"],
	[/\b(Spacer|Deadeye|Walking-Bucket)$/, "three"],
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
	// (archskill: a skill-noun name: its noun says its skill, its front words the others; a catalog build's name is read
	// by its words as before)
	const sn = ARCHETYPES.some((a) => a.name === name)
		? undefined
		: SKILL_NOUN_ROLES.filter(
				(k) => name === k.name || name.endsWith(` ${k.name}`),
			).sort((a, b) => b.name.length - a.name.length)[0];
	const snNoun = sn ? SKILL_ROLE_NOUN.get(sn.key) : undefined;
	if (sn && snNoun) {
		const front = name.slice(0, name.length - sn.name.length).trim();
		const rest = front ? nounsOfName(`${front} Guard`) : undefined;
		return {
			nouns: [...new Set([snNoun, ...(rest?.nouns ?? [])])],
			twoWay: rest?.twoWay ?? false,
		};
	}
	// (archfam: the user's own name with a 2-Way prefix)
	const custom2 = /^2-Way /.test(name)
		? CUSTOM_NAME_NOUNS()[name.slice("2-Way ".length)]
		: undefined;
	if (custom2) {
		return { nouns: custom2, twoWay: true };
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
