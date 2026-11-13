// arch15: the archetype reading reads the sub-ratings (the subRatings setting) and the play-type profile (the advStats
// setting) directly. Both are styles the base ratings cannot tell apart: a defender's blocks vs his interior D vs his
// perimeter D vs his steals, a shooter's range and catch-and-shoot vs off-the-dribble lean, post moves vs close shots vs
// touch, contact vs finesse finishing, handle vs ball security vs shot creation, vision vs accuracy, straight-line speed vs
// lateral quickness, standing reach vs max vertical; and what he actually does with the ball (isolation, pick-and-roll,
// spot-ups, post-ups, cuts, rolls, transition, putbacks).
//
// - Sub-ratings: each sub's lean is (sub - base - mean) / sd against the league's own spread (SubNorms: generated shapes are
//   large, real players' shapes, from their stats, small; a league's own table reads each the way its players are). The
//   features (SUB_FEATS) are those leans, and each build wants some of them from what its name says (BUILD_WANTS, from the
//   name's concepts). The `sub` term of the reading is the normalised dot product of the build's wants and his features.
// - Play types: each play type's share of his possessions (and his points per possession on it) against his position's peers
//   in the same league (PtNorms, built from the league's own last season: the sim's play-type mix is not the NBA's, post-ups
//   about 3x and P&R ball handlers about half, so they are normalised against the league, never against real frequencies),
//   weighted by his sample (possessions / (possessions + PT_HALF)). The `playType` term is the same dot product.
// Without sub-ratings (or without tracking stats) the features are absent and both terms are 0: the reading is unchanged.
import {
	isValidSubArray,
	NUM_SUBS,
	SUB_DEFS,
	SUB_INDEX,
} from "../subRatings.ts";
import { conceptsOf } from "./twoK/concepts.ts";
import type { Archetype, ArchetypeRatings, PosBucket } from "./types.ts";

// ---- sub-ratings ----

export type SubNorms = { mean: number[]; sd: number[] };

// Generated players (subLeans.script.test.ts, RUN_ARCHETYPE_SUBLEANS=1): a random league with Sub-Ratings on
export const SUB_NORMS_GEN: SubNorms = {
	mean: [
		-1.6, -2.5, 4.8, -2.1, -0.3, 3.4, -4.4, 1.5, -2, 0.4, -2.5, 2.5, -2.9, 2.9,
		-2.9, 2.9, -0.3, 0, 0.6, -0.5, 0.5, 1.2, -1.2, -0.2, 0.2,
	],
	sd: [
		7.1, 6.3, 9.8, 6.6, 3.6, 4.3, 6.4, 4.8, 4.2, 6.9, 5.9, 5.9, 4.8, 4.8, 4.8,
		4.8, 2.6, 6, 5.3, 4, 4, 4.5, 4.5, 5.7, 5.7,
	],
};
// ... with Expanded Ratings on (the subs follow the expanded ratings)
export const SUB_NORMS_GEN_EXPANDED: SubNorms = {
	mean: [
		-4.2, 0, 2.3, 0.5, 0.2, -0.4, 0.1, 1.4, -2, 0.6, -2.5, 2.5, 1.1, -1.1, 0, 0,
		-1.1, 2.3, -0.2, -0.5, 0.5, 0.9, -0.9, -0.5, 0.5,
	],
	sd: [
		10.5, 6.9, 8.1, 6.8, 4, 6.5, 7.3, 4.6, 4.2, 6.7, 5.9, 5.9, 6.4, 6.4, 4.5,
		4.5, 3.1, 6.9, 5.2, 3.8, 3.8, 4.5, 4.5, 5.7, 5.7,
	],
};
// Real NBA players 2016-2025, shapes from their stats (tools/realSubRatings.ts): a real-players league's own table looks
// like this until its generated draft classes take over
export const SUB_NORMS_REAL: SubNorms = {
	mean: [
		0.5, 0, -0.1, -0.2, 0.9, -0.9, -0.2, -1.2, 0.6, 1.1, -1.3, 1.3, -0.5, 0.5,
		-0.7, 0.7, 0.1, 0.6, -0.8, -0.2, 0.2, -0.7, 0.7, 0.4, -0.4,
	],
	sd: [
		2.6, 2.2, 2.2, 2.3, 0.9, 1.8, 2.3, 1.7, 1.7, 1.8, 1.8, 1.8, 2, 2, 1.5, 1.5,
		0.8, 2, 1.6, 1.5, 1.5, 1.4, 1.4, 1.2, 1.2,
	],
};
export const SUB_NORMS_REAL_EXPANDED: SubNorms = {
	mean: [
		0.5, 0, -0.1, -0.3, 0.8, 0.2, -1.5, -1.2, 0.6, 1.1, -1.3, 1.3, -2.1, 2.1,
		-0.3, 0.3, -0.7, 3.2, -1.8, -0.2, 0.2, -0.7, 0.7, 0.4, -0.4,
	],
	sd: [
		4.7, 4.5, 4.5, 4.5, 1.2, 4.5, 5.4, 1.7, 1.7, 1.8, 1.8, 1.8, 5.5, 5.5, 3.6,
		3.6, 2.1, 6.4, 2.8, 1.5, 1.5, 1.4, 1.4, 1.2, 1.2,
	],
};
export const defaultSubNorms = (expanded: boolean) =>
	expanded ? SUB_NORMS_GEN_EXPANDED : SUB_NORMS_GEN;

// A sd below this is no spread to read (a league where nobody's shape is known)
const SD_MIN = 0.6;
const LEAN_CAP = 2.5;

// The league's own table, from the rows that have subs (at least SUB_NORMS_MIN of them; else undefined)
export const SUB_NORMS_MIN = 120;
export const buildSubNorms = (
	rows: readonly ArchetypeRatings[],
): SubNorms | undefined => {
	const offs: number[][] = [];
	for (const r of rows) {
		const o = offsetsOf(r);
		if (o) {
			offs.push(o);
		}
	}
	if (offs.length < SUB_NORMS_MIN) {
		return undefined;
	}
	const mean = new Array<number>(NUM_SUBS).fill(0);
	const sd = new Array<number>(NUM_SUBS).fill(0);
	for (const o of offs) {
		for (let i = 0; i < NUM_SUBS; i++) {
			mean[i]! += o[i]!;
		}
	}
	for (let i = 0; i < NUM_SUBS; i++) {
		mean[i]! /= offs.length;
	}
	for (const o of offs) {
		for (let i = 0; i < NUM_SUBS; i++) {
			sd[i]! += (o[i]! - mean[i]!) ** 2;
		}
	}
	const r1 = (x: number) => Math.round(x * 100) / 100;
	return {
		mean: mean.map(r1),
		sd: sd.map((s) => r1(Math.sqrt(s / offs.length))),
	};
};

const offsetsOf = (r: ArchetypeRatings): number[] | undefined => {
	const s = r.sub;
	if (!isValidSubArray(s)) {
		return undefined;
	}
	const out: number[] = [];
	for (let i = 0; i < NUM_SUBS; i++) {
		out.push(s[i]! - ((r as Record<string, number>)[SUB_DEFS[i]!.base] ?? 50));
	}
	return out;
};

// Each sub's lean (z against the table), or undefined without subs
export const subLeans = (
	r: ArchetypeRatings,
	norms: SubNorms,
): number[] | undefined => {
	const o = offsetsOf(r);
	if (!o) {
		return undefined;
	}
	return o.map((x, i) => {
		const z = (x - norms.mean[i]!) / Math.max(SD_MIN, norms.sd[i]!);
		return Math.max(-LEAN_CAP, Math.min(LEAN_CAP, z));
	});
};

const L = (k: string) => SUB_INDEX[k]!;

// The features the reading takes from the subs (each a lean or a contrast of two)
export const SUB_FEATS = [
	"blk",
	"idf",
	"pdf",
	"stl",
	"rng",
	"cs",
	"pst",
	"cls",
	"flt",
	"con",
	"hnd",
	"sec",
	"crt",
	"vis",
	"sls",
	"mxv",
	"orb",
] as const;
export type SubFeat = (typeof SUB_FEATS)[number];

export const subFeatures = (
	leans: readonly number[],
): Record<SubFeat, number> => {
	const l = (k: string) => leans[L(k)]!;
	return {
		blk: l("blk"),
		idf: l("idf"),
		pdf: l("pdf"),
		stl: l("stl"),
		rng: l("rng"),
		// catch-and-shoot and spot-up vs off the dribble and pull-up
		cs: (l("tcs") + l("spu") - l("tod") - l("pul")) / 2,
		pst: l("pst"),
		cls: l("cls"),
		flt: l("flt"),
		// (the two finishing subs are one group: contact vs finesse)
		con: (l("con") - l("fns")) / 2,
		hnd: l("hnd"),
		sec: l("sec"),
		crt: l("crt"),
		vis: (l("vis") - l("acc")) / 2,
		sls: (l("sls") - l("lat")) / 2,
		mxv: (l("mxv") - l("stj")) / 2,
		orb: (l("orb") - l("drd")) / 2,
	};
};

// ---- play types ----

// The play types the reading reads (off screen and handoff together: both a shooter coming off a screen)
export const PT_FEATS = [
	"iso",
	"prb",
	"spot",
	"post",
	"cut",
	"prr",
	"tr",
	"pb",
	"offs",
] as const;
export type PtFeat = (typeof PT_FEATS)[number];

// A player's play types: possessions in all, and per feature the share of his possessions and his points per possession
export type PlayTypes = {
	poss: number;
	freq: Record<PtFeat, number>;
	ppp: Record<PtFeat, number>;
};
// Per position bucket: mean and sd of each feature's share, and the mean PPP of each
export type PtNorms = Record<
	PosBucket,
	{
		mean: Record<PtFeat, number>;
		sd: Record<PtFeat, number>;
		ppp: Record<PtFeat, number>;
	}
>;

// From a play-type profile (common/advStats.ts playTypeProfile)
export const playTypesOf = (
	profile:
		| {
				poss: number;
				types: { key: string; poss: number; pts: number }[];
		  }
		| undefined,
): PlayTypes | undefined => {
	if (!profile || profile.poss <= 0) {
		return undefined;
	}
	const poss = {} as Record<PtFeat, number>;
	const pts = {} as Record<PtFeat, number>;
	for (const f of PT_FEATS) {
		poss[f] = 0;
		pts[f] = 0;
	}
	for (const t of profile.types) {
		const f = (t.key === "ho" ? "offs" : t.key) as PtFeat;
		if (f in poss) {
			poss[f] += t.poss;
			pts[f] += t.pts;
		}
	}
	const freq = {} as Record<PtFeat, number>;
	const ppp = {} as Record<PtFeat, number>;
	for (const f of PT_FEATS) {
		freq[f] = poss[f] / profile.poss;
		ppp[f] = poss[f] > 0 ? pts[f] / poss[f] : 0;
	}
	return { poss: profile.poss, freq, ppp };
};

// His last three seasons (most recent first), as his box score is read (stats.ts multiSeasonStats): a full last season
// (PT_FULL possessions) alone, else the older ones at a half and a quarter
export const PT_FULL = 600;
const PT_DECAY = [1, 0.5, 0.25];
export const combinePlayTypes = (
	seasons: (PlayTypes | undefined)[],
): PlayTypes | undefined => {
	const first = seasons[0];
	if (first && first.poss >= PT_FULL) {
		return first;
	}
	let poss = 0;
	const pp = {} as Record<PtFeat, number>;
	const pts = {} as Record<PtFeat, number>;
	for (const f of PT_FEATS) {
		pp[f] = 0;
		pts[f] = 0;
	}
	for (const [i, s] of seasons.entries()) {
		if (!s || i >= PT_DECAY.length) {
			continue;
		}
		const w = PT_DECAY[i]!;
		poss += w * s.poss;
		for (const f of PT_FEATS) {
			const n = w * s.poss * s.freq[f];
			pp[f] += n;
			pts[f] += n * s.ppp[f];
		}
	}
	if (poss <= 0) {
		return undefined;
	}
	const freq = {} as Record<PtFeat, number>;
	const ppp = {} as Record<PtFeat, number>;
	for (const f of PT_FEATS) {
		freq[f] = pp[f] / poss;
		ppp[f] = pp[f] > 0 ? pts[f] / pp[f] : 0;
	}
	return { poss, freq, ppp };
};

// Too few possessions in a bucket's table: the league's own play-type mix is not known
export const PT_NORMS_MIN_PLAYERS = 20;
// Possessions behind a row of the table
export const PT_NORMS_MIN_POSS = 150;
export const buildPtNorms = (
	rows: readonly { pt: PlayTypes; bucket: PosBucket }[],
): Partial<PtNorms> => {
	const out: Partial<PtNorms> = {};
	const all = rows.filter((r) => r.pt.poss >= PT_NORMS_MIN_POSS);
	for (const b of ["PG", "SG", "W", "F", "C"] as const) {
		let rs = all.filter((r) => r.bucket === b);
		if (rs.length < PT_NORMS_MIN_PLAYERS) {
			// (a small league: everyone, read by bucket where it can be)
			rs = all;
		}
		if (rs.length < PT_NORMS_MIN_PLAYERS) {
			continue;
		}
		const mean = {} as Record<PtFeat, number>;
		const sd = {} as Record<PtFeat, number>;
		const ppp = {} as Record<PtFeat, number>;
		for (const f of PT_FEATS) {
			let m = 0;
			let pp = 0;
			let pn = 0;
			for (const r of rs) {
				m += r.pt.freq[f];
				pp += r.pt.ppp[f] * r.pt.freq[f] * r.pt.poss;
				pn += r.pt.freq[f] * r.pt.poss;
			}
			m /= rs.length;
			let v = 0;
			for (const r of rs) {
				v += (r.pt.freq[f] - m) ** 2;
			}
			mean[f] = m;
			sd[f] = Math.sqrt(v / rs.length);
			ppp[f] = pn > 0 ? pp / pn : 1;
		}
		out[b] = { mean, sd, ppp };
	}
	return out;
};

// Half the play-type weight at this many possessions (a full season of a starter is ~800-1,200)
export const PT_HALF = 300;
// His PPP on a play type counts this much against how often he runs it (efficiency on what he does)
const PT_PPP_K = 0.25;
const PT_PPP_SD = 0.25;
export const ptFeatures = (
	pt: PlayTypes,
	table: PtNorms[PosBucket] | undefined,
): { f: Record<PtFeat, number>; w: number } | undefined => {
	if (!table) {
		return undefined;
	}
	const f = {} as Record<PtFeat, number>;
	for (const k of PT_FEATS) {
		const z = (pt.freq[k] - table.mean[k]) / Math.max(0.01, table.sd[k]);
		// (efficiency only where he runs it at least as often as most)
		const eff =
			pt.freq[k] >= table.mean[k]
				? (PT_PPP_K * (pt.ppp[k] - table.ppp[k])) / PT_PPP_SD
				: 0;
		f[k] = Math.max(-LEAN_CAP, Math.min(LEAN_CAP, z + eff));
	}
	return { f, w: pt.poss / (pt.poss + PT_HALF) };
};

// ---- what a build's name says about the subs and the play types ----

type Wants<K extends string> = Partial<Record<K, number>>;
const SUB_WANTS: Record<string, Wants<SubFeat>> = {
	rimD: { blk: 1, idf: 0.4 },
	lockdown: { pdf: 1, sls: -0.4, stl: 0.2 },
	steal: { stl: 1, pdf: 0.3 },
	twoWay: { pdf: 0.3, idf: 0.2 },
	oreb: { orb: 1 },
	reb: { orb: -0.3 },
	catchShoot: { cs: 1, rng: 0.3, crt: -0.3 },
	shotHunt: { rng: 0.8 },
	creator: { crt: 1, hnd: 0.5, cs: -0.7 },
	mid: { cs: -0.3 },
	riser: { cs: -0.4, mxv: 0.3 },
	post: { pst: 1, cls: 0.2 },
	midPost: { pst: 0.6 },
	paint: { cls: 0.5, pst: 0.3 },
	slash: { flt: 0.3, hnd: 0.3, crt: 0.3 },
	finish: { cls: 0.5, flt: 0.3 },
	dunk: { con: 0.5, mxv: 0.5 },
	air: { mxv: 1 },
	lob: { mxv: 0.6 },
	run: { sls: 1 },
	tempo: { sls: 0.6, vis: 0.3 },
	pass: { vis: 1, hnd: 0.3 },
	outlet: { vis: 0.6 },
	tripleDouble: { vis: 0.5 },
	strength: { con: 1, pst: 0.3 },
	skill: { con: -0.5, flt: 0.4 },
};
const PT_WANTS: Record<string, Wants<PtFeat>> = {
	creator: { iso: 1, prb: 0.4, spot: -0.6 },
	pass: { prb: 1, spot: -0.4 },
	tempo: { tr: 0.6, prb: 0.5 },
	catchShoot: { spot: 1, offs: 0.6, iso: -0.4 },
	shotHunt: { spot: 0.5, offs: 0.3 },
	post: { post: 1 },
	midPost: { post: 0.7 },
	paint: { post: 0.4, cut: 0.4 },
	slash: { cut: 0.5, tr: 0.3, iso: 0.3 },
	finish: { cut: 0.6 },
	dunk: { cut: 0.4, prr: 0.3 },
	lob: { prr: 1, cut: 0.6 },
	run: { tr: 1, prr: 0.4 },
	air: { tr: 0.5 },
	oreb: { pb: 1 },
	reb: { pb: 0.3 },
	steal: { tr: 0.4 },
};
// Names the concepts do not cover
const NAME_SUB_WANTS: [RegExp, Wants<SubFeat>][] = [
	[/Snip|Logo|Deep|Range/, { rng: 1 }],
	[/Pick & Pop|Popper|Stretch/, { cs: 0.6 }],
	[/Table[ -]Sett|Distributor|Pass-First/, { sec: 0.5 }],
	[/Shot Creat|Middy Creator|Pull-Up|Iso|Ankle|Shifty/, { crt: 0.5 }],
	[/Floater|Crafty Finisher|Acrobat/, { flt: 0.6 }],
];
const NAME_PT_WANTS: [RegExp, Wants<PtFeat>][] = [
	[/Pick & Pop|Popper|Stretch/, { prr: 0.5, spot: 0.5 }],
	[/Pick & Roll|Roll|Rim Run|Pick-Diving/, { prr: 1 }],
	[/Off-Screen|Movement/, { offs: 1 }],
	[/Putback|Crash/, { pb: 1 }],
];

const addWants = <K extends string>(into: Wants<K>, w: Wants<K>) => {
	for (const [k, v] of Object.entries(w) as [K, number][]) {
		into[k] = (into[k] ?? 0) + v;
	}
};
const norm = <K extends string>(w: Wants<K>): [K, number][] => {
	const e = Object.entries(w) as [K, number][];
	const n = Math.sqrt(e.reduce((t, [, v]) => t + v * v, 0));
	return n > 0 ? e.map(([k, v]) => [k, v / n]) : [];
};

type BuildWants = { sub: [SubFeat, number][]; pt: [PtFeat, number][] };
const wantsCache = new WeakMap<Archetype, BuildWants>();
// What the build's name wants of each feature, normalised to length 1 (so a long name is not worth more)
export const buildWants = (a: Archetype): BuildWants => {
	let out = wantsCache.get(a);
	if (!out) {
		const sub: Wants<SubFeat> = {};
		const pt: Wants<PtFeat> = {};
		for (const c of conceptsOf(a.name)) {
			if (SUB_WANTS[c.key]) {
				addWants(sub, SUB_WANTS[c.key]!);
			}
			if (PT_WANTS[c.key]) {
				addWants(pt, PT_WANTS[c.key]!);
			}
		}
		for (const [re, w] of NAME_SUB_WANTS) {
			if (re.test(a.name)) {
				addWants(sub, w);
			}
		}
		for (const [re, w] of NAME_PT_WANTS) {
			if (re.test(a.name)) {
				addWants(pt, w);
			}
		}
		// (a build's own extra wants: sw / pw on the def)
		if (a.sw) {
			addWants(sub, a.sw as Wants<SubFeat>);
		}
		if (a.pw) {
			addWants(pt, a.pw as Wants<PtFeat>);
		}
		out = { sub: norm(sub), pt: norm(pt) };
		wantsCache.set(a, out);
	}
	return out;
};

// His features as the reading holds them
export type StyleReading = {
	sub?: Record<SubFeat, number>;
	pt?: { f: Record<PtFeat, number>; w: number };
};

export const subTerm = (a: Archetype, s: StyleReading): number => {
	if (!s.sub) {
		return 0;
	}
	let t = 0;
	for (const [k, w] of buildWants(a).sub) {
		t += w * s.sub[k];
	}
	return t;
};
export const ptTerm = (a: Archetype, s: StyleReading): number => {
	if (!s.pt) {
		return 0;
	}
	let t = 0;
	for (const [k, w] of buildWants(a).pt) {
		t += w * s.pt.f[k];
	}
	return t * s.pt.w;
};
