// Red and green flags (League Extras: Scout Consensus & Flags): a few short, plain notes on a prospect from what the user's scouts can
// see: his character and effort traits, his pre-draft record and his ratings profile (with scouting fuzz). Hidden traits are never read
// as numbers: only the scouts' own reading (the true score plus their fixed error, as on the Traits page) can raise a hint, and only when
// it is extreme beyond what their uncertainty explains, so a department that can't read him well raises fewer hints, and a hint is always
// marked unconfirmed. Pure and deterministic; at most four flags.
import type { ScoutProduction } from "./types.ts";

export type FlagTrait = {
	key: string;
	// The scouts' reading (never the true score of a hidden trait)
	estimate: number;
	// Scouting uncertainty of the reading (0 when known exactly)
	sd: number;
	low: number;
	high: number;
	hidden: boolean;
	exact: boolean;
};

export type FlagRatings = {
	hgt: number;
	spd: number;
	jmp: number;
	endu: number;
	ft: number;
	fg: number;
	tp: number;
	oiq: number;
	diq: number;
	drb: number;
	pss: number;
	ovr: number;
	pot: number;
};

export type QuickFlag = {
	key: string;
	text: string;
	tone: "red" | "green";
	// A hidden trait read second-hand: not confirmed
	hint?: true;
	// Where it comes from, for a tooltip
	why: string;
	strength: number;
};

export type QuickFlagInput = {
	age: number;
	pos: string;
	ratings?: FlagRatings;
	preDraft?: ScoutProduction;
	traits?: FlagTrait[];
	// A scout covering his region saw him, or he was scouted with points or seen a lot: hidden hints need it
	seenClosely: boolean;
	// The draft class's average reading per trait (traits tied to ratings, like motor and hustle, read low on prospects next to the
	// league's rotation players): a flag means he stands out in his class. Default 50
	center?: Record<string, number>;
	// His class's ratings profile (ratingsNormsOf); a generated class's typical one when missing
	norms?: RatingsNorms;
};

export const MAX_QUICK_FLAGS = 4;

type TraitRule = {
	key: string;
	high?: string;
	low?: string;
	// Which end is good
	goodHigh: boolean;
};

const TRAIT_RULES: TraitRule[] = [
	{
		key: "motor",
		high: "Relentless motor",
		low: "Runs out of gas",
		goodHigh: true,
	},
	{
		key: "hustle",
		high: "Plays hard every possession",
		low: "Questions about effort",
		goodHigh: true,
	},
	{
		key: "temper",
		high: "Keeps his cool",
		low: "Volatile temper",
		goodHigh: true,
	},
	{
		key: "workEthic",
		high: "Gym rat",
		low: "Questions about his work habits",
		goodHigh: true,
	},
	{
		key: "ego",
		high: "High-character teammate",
		low: "Diva tendencies",
		goodHigh: true,
	},
	{
		key: "competitiveness",
		high: "Fierce competitor",
		low: "Questions about his fight",
		goodHigh: true,
	},
	{
		key: "roleAcceptance",
		low: "May not accept a small role",
		goodHigh: true,
	},
	{ key: "leadership", high: "Natural leader", goodHigh: true },
	{ key: "durability", low: "Durability questions", goodHigh: true },
];

// How far from average a reading must be to become a flag: visible traits read on tape, hidden ones need a lot more (and more the less
// sure the scouts are)
export const traitThreshold = (t: Pick<FlagTrait, "hidden" | "sd" | "exact">) =>
	t.exact ? 22 : t.hidden ? 24 + 0.9 * t.sd : 20 + 0.5 * t.sd;

// 0-1: how well the department can read a hidden trait (0.5 off when nobody has seen him up close)
export const hintReadability = (sd: number, seenClosely: boolean) =>
	Math.max(0, Math.min(1, (26 - sd) / 16)) * (seenClosely ? 1 : 0.5);

const traitFlags = (input: QuickFlagInput) => {
	const out: QuickFlag[] = [];
	for (const rule of TRAIT_RULES) {
		const t = input.traits?.find((x) => x.key === rule.key);
		if (!t) {
			continue;
		}
		const off = t.estimate - (input.center?.[t.key] ?? 50);
		const text = off > 0 ? rule.high : rule.low;
		if (!text || Math.abs(off) < traitThreshold(t)) {
			continue;
		}
		const good = off > 0 === rule.goodHigh;
		const unknownHidden = t.hidden && !t.exact;
		if (unknownHidden) {
			const r = hintReadability(t.sd, input.seenClosely);
			if (r < 0.35) {
				continue;
			}
			out.push({
				key: `trait:${t.key}`,
				text: `${text} (unconfirmed)`,
				tone: good ? "green" : "red",
				hint: true,
				why: `Second-hand: what people around him say. Our scouts can't confirm it yet${r < 0.7 ? ", and they have only a rough read on him" : ""}.`,
				strength:
					r * Math.min(1.5, (Math.abs(off) - traitThreshold(t) + 8) / 16),
			});
		} else {
			out.push({
				key: `trait:${t.key}`,
				text,
				tone: good ? "green" : "red",
				why: t.exact
					? "Known from his play."
					: `Seen on tape (reads ${t.low}-${t.high}).`,
				strength: 1 + Math.min(0.5, (Math.abs(off) - traitThreshold(t)) / 20),
			});
		}
	}
	return out;
};

const recordFlags = (input: QuickFlagInput) => {
	const out: QuickFlag[] = [];
	const s = input.preDraft;
	if (!s || s.gp < 10 || s.min <= 0) {
		return out;
	}
	const prod = ((s.pts + s.trb + s.ast) * 36) / s.min;
	if (input.age <= 20 && prod >= 31) {
		out.push({
			key: "record:young",
			text: "Produced young",
			tone: "green",
			why: `${s.pts.toFixed(1)} points, ${s.trb.toFixed(1)} rebounds and ${s.ast.toFixed(1)} assists a game at ${input.age}.`,
			strength: 1.1,
		});
	} else if (input.age >= 22 && prod < 25) {
		out.push({
			key: "record:old",
			text: "Old for his production",
			tone: "red",
			why: `${input.age} years old with ${s.pts.toFixed(1)} points a game.`,
			strength: 1,
		});
	}
	const fta = s.fta * s.gp;
	const tpa = s.tpa * s.gp;
	if (fta >= 40 && s.ftPct < 62) {
		out.push({
			key: "shot",
			text: "Shot mechanics need work",
			tone: "red",
			why: `${s.ftPct.toFixed(1)}% at the line on ${Math.round(fta)} attempts.`,
			strength: 1.2,
		});
	} else if (tpa >= 60 && s.tpPct >= 38 && fta >= 30 && s.ftPct >= 78) {
		out.push({
			key: "shot",
			text: "Shooting translates",
			tone: "green",
			why: `${s.tpPct.toFixed(1)}% from three on ${Math.round(tpa)} attempts and ${s.ftPct.toFixed(1)}% at the line.`,
			strength: 1.2,
		});
	}
	if (s.min >= 15 && (s.tov * 36) / s.min >= 4.2) {
		out.push({
			key: "record:tov",
			text: "Loose with the ball",
			tone: "red",
			why: `${((s.tov * 36) / s.min).toFixed(1)} turnovers per 36 minutes.`,
			strength: 0.8,
		});
	}
	if (s.level === "juco" || s.level === "other") {
		out.push({
			key: "record:level",
			text: "Untested against top competition",
			tone: "red",
			why: `His numbers came at ${s.team}.`,
			strength: 0.6,
		});
	} else if (s.level === "overseas" && s.min >= 18) {
		out.push({
			key: "record:pros",
			text: "Held his own against grown men",
			tone: "green",
			why: `${s.min.toFixed(1)} minutes a game at ${s.team}.`,
			strength: 0.7,
		});
	}
	return out;
};

// A prospect's ratings profile against his class (mean, sd of each sum), so a flag means he stands out among the prospects
export type RatingsNorms = Record<"ath" | "shot" | "iq", [number, number]>;

export const ratingsProfile = (r: FlagRatings) => ({
	ath: r.spd + r.jmp,
	shot: r.tp + r.ft,
	iq: r.oiq + r.diq,
});

// Typical of a generated class (only used when no class is given)
const DEFAULT_NORMS: RatingsNorms = {
	ath: [100, 18],
	shot: [80, 18],
	iq: [70, 16],
};

export const ratingsNormsOf = (
	rows: FlagRatings[],
): RatingsNorms | undefined => {
	if (rows.length < 10) {
		return undefined;
	}
	const out = {} as RatingsNorms;
	for (const key of ["ath", "shot", "iq"] as const) {
		const xs = rows.map((r) => ratingsProfile(r)[key]);
		const m = xs.reduce((a, x) => a + x, 0) / xs.length;
		const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
		out[key] = [m, Math.max(4, sd)];
	}
	return out;
};

const ratingsFlags = (input: QuickFlagInput) => {
	const out: QuickFlag[] = [];
	const r = input.ratings;
	if (!r) {
		return out;
	}
	const norms = input.norms ?? DEFAULT_NORMS;
	const prof = ratingsProfile(r);
	const z = (key: keyof RatingsNorms) =>
		(prof[key] - norms[key][0]) / norms[key][1];
	const big = ["PF", "FC", "C"].includes(input.pos);
	if (z("ath") >= 1.7) {
		out.push({
			key: "ratings:ath",
			text: "Explosive athlete",
			tone: "green",
			why: "Speed and leaping stand out in his class.",
			strength: 0.9,
		});
	} else if (z("ath") <= -1.7) {
		out.push({
			key: "ratings:ath",
			text: "Limited athlete",
			tone: "red",
			why: "Speed and leaping are near the bottom of his class.",
			strength: 0.7,
		});
	}
	if (!big && z("shot") <= -1.4) {
		out.push({
			key: "shot",
			text: "Shot mechanics need work",
			tone: "red",
			why: "Three-point and free throw shooting are both well below his class for a perimeter player.",
			strength: 1,
		});
	}
	if (z("iq") >= 1.7) {
		out.push({
			key: "ratings:iq",
			text: "Feel for the game",
			tone: "green",
			why: "Reads the game on both ends better than most of his class.",
			strength: 0.8,
		});
	}
	return out;
};

/**
 * Up to four flags, strongest first (seen-on-tape traits and the record over hints), never two on the same thing (the shot) and
 * never more than three of one tone.
 */
export const quickFlags = (input: QuickFlagInput): QuickFlag[] => {
	const all = [
		...traitFlags(input),
		...recordFlags(input),
		...ratingsFlags(input),
	].toSorted((a, b) => b.strength - a.strength || a.key.localeCompare(b.key));
	const out: QuickFlag[] = [];
	const keys = new Set<string>();
	for (const f of all) {
		if (out.length >= MAX_QUICK_FLAGS || keys.has(f.key)) {
			continue;
		}
		if (out.filter((x) => x.tone === f.tone).length >= 3) {
			continue;
		}
		keys.add(f.key);
		out.push(f);
	}
	return out;
};
