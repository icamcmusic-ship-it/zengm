// arch16 (user request), reworded in arch2kfix (user request): the archetype's "why" as a short bulleted list of words,
// no numbers anywhere. It still cites what actually drove the pick, in this order of priority: with Sub-Ratings on, the
// sub-ratings the build's name wants (subStyle.ts buildWants); with Advanced Tracking Stats and real minutes, the play type
// the name wants that he runs most against his peers; a visible trait where it counted; otherwise (and to fill in) the
// base dimensions behind the profile's strongest dimensions; last, a dimension the build wants low that he is clearly low
// in. Each driver is one bullet, worded by how he stands against players of his position (fixed thresholds: Elite,
// Strong, Above-average, Relies on), read from the ratings the user sees (`shown`: fuzzed as the ratings pages fuzz them),
// so the words agree with what the ratings pages show. Something below average is never cited as a strength, two bullets
// never speak to the same skill (a sub-rating and the base dimension it refines), and there is always at least one bullet.
// The compact one-line form (whyLine) is the top two bullets joined with " · ".
import { SUB_INDEX } from "../subRatings.ts";
import { TRAIT_DEFINITIONS } from "../playerTraits/definitions.ts";
import { zVector } from "./norms.ts";
import { TRAIT_GROUPS, traitGroupValue, type ReadOptions } from "./score.ts";
import {
	buildWants,
	defaultSubNorms,
	subLeans,
	type PlayTypes,
	type PtFeat,
	type SubFeat,
} from "./subStyle.ts";
import type {
	Archetype,
	ArchetypeRatings,
	DimKey,
	Norms,
	Why,
} from "./types.ts";

export type WhyDriver = {
	kind: "sub" | "playType" | "trait" | "rating" | "low";
	// The sub, play type, trait or dimension it is about
	key: string;
	// The skill it speaks to (two bullets never share one)
	group: string;
	// How much it counted toward the pick (comparable within a kind; subs and play types are z times the name's want)
	c: number;
	// His standing against players of his position (z; subs: the dimension plus the sub's lean)
	s: number;
	text: string;
};

// Each sub-rating feature as the user sees it: the sub that shows it (the second one when the build wants the other side
// of a contrast: lateral quickness for a lockdown defender's "less straight-line speed")
const SUB_SHOWN: Record<SubFeat, [string, string?]> = {
	blk: ["blk"],
	idf: ["idf"],
	pdf: ["pdf"],
	stl: ["stl"],
	rng: ["rng"],
	cs: ["tcs", "pul"],
	pst: ["pst"],
	cls: ["cls"],
	flt: ["flt"],
	con: ["con", "fns"],
	hnd: ["hnd"],
	sec: ["sec"],
	crt: ["crt"],
	vis: ["vis", "acc"],
	sls: ["sls", "lat"],
	mxv: ["mxv", "stj"],
	orb: ["orb", "drd"],
};

// Each shown sub: how it reads in words, the base dimension it refines (his standing there is the level the sub's lean
// adds to) and the skill it speaks to
const SUB_WORDS: Record<string, [noun: string, dim: DimKey, group: string]> = {
	blk: ["shot blocking", "blk", "blk"],
	stl: ["steal instincts", "stl", "stl"],
	idf: ["interior defense", "dint", "dint"],
	pdf: ["perimeter defense", "dper", "dper"],
	lat: ["lateral quickness", "dper", "dper"],
	rng: ["shooting range", "three", "three"],
	tcs: ["catch-and-shoot shooting", "three", "three"],
	tod: ["off-the-dribble shooting", "three", "three"],
	spu: ["spot-up shooting", "three", "three"],
	pul: ["pull-up shooting", "mid", "mid"],
	pst: ["post moves", "post", "post"],
	cls: ["touch around the basket", "fin", "fin"],
	flt: ["floater touch", "mid", "touch"],
	con: ["finishing through contact", "rim", "rim"],
	fns: ["finesse finishing", "fin", "fin"],
	orb: ["offensive rebounding", "reb", "reb"],
	drd: ["defensive rebounding", "reb", "reb"],
	hnd: ["handle", "drb", "drb"],
	sec: ["ball security", "drb", "sec"],
	crt: ["shot creation", "drb", "drb"],
	vis: ["court vision", "pss", "pss"],
	acc: ["passing accuracy", "pss", "pss"],
	sls: ["straight-line speed", "spd", "spd"],
	mxv: ["leaping", "jmp", "jmp"],
	stj: ["standing reach", "len", "len"],
};

// Each base dimension in words, and the skill it speaks to
const DIM_WORDS: Partial<Record<DimKey, [noun: string, group: string]>> = {
	usg: ["scoring volume", "usg"],
	drb: ["ball handling", "drb"],
	pss: ["passing", "pss"],
	rim: ["finishing at the rim", "rim"],
	post: ["post scoring", "post"],
	mid: ["mid-range shooting", "mid"],
	three: ["three-point shooting", "three"],
	ft: ["free throw shooting", "ft"],
	reb: ["rebounding", "reb"],
	dint: ["interior defense", "dint"],
	dper: ["perimeter defense", "dper"],
	blk: ["shot blocking", "blk"],
	ath: ["athleticism", "ath"],
	end: ["endurance", "end"],
	stl: ["steal instincts", "stl"],
	draw: ["foul drawing", "draw"],
	spd: ["speed", "spd"],
	jmp: ["leaping", "jmp"],
	stre: ["strength", "stre"],
	oiq: ["offensive IQ", "oiq"],
	diq: ["defensive IQ", "diq"],
	hgt: ["size", "hgt"],
	pdef: ["perimeter defense", "dper"],
	idef: ["interior defense", "dint"],
	len: ["length", "len"],
	cs: ["catch-and-shoot game", "three"],
	orl: ["offensive rebounding", "reb"],
	sec: ["ball security", "sec"],
	fin: ["finishing", "fin"],
};

// Play types: the noun, and the wording by how far above his position's share he runs it (pt.f, a z)
const PT_NOUN: Record<PtFeat, string> = {
	iso: "isolations",
	prb: "pick-and-roll ball handling",
	spot: "spot-ups",
	post: "post-ups",
	cut: "cuts to the basket",
	prr: "rolls to the rim",
	tr: "transition",
	pb: "putbacks",
	offs: "shots off screens and handoffs",
};
const PT_GROUP: Record<PtFeat, string> = {
	iso: "ptIso",
	prb: "ptPrb",
	spot: "ptSpot",
	post: "ptPost",
	cut: "ptCut",
	prr: "ptPrr",
	tr: "ptTr",
	pb: "ptPb",
	offs: "ptOffs",
};
export const PT_LIVES = 1.75;
export const PT_LOT = 1;
export const PT_PLENTY = 0.5;
const ptText = (k: PtFeat, f: number) =>
	k === "tr"
		? f >= PT_LIVES
			? "Lives in transition"
			: f >= PT_LOT
				? "Runs a lot in transition"
				: "Gets out in transition often"
		: f >= PT_LIVES
			? `Lives on ${PT_NOUN[k]}`
			: f >= PT_LOT
				? `Runs a lot of ${PT_NOUN[k]}`
				: `Plenty of ${PT_NOUN[k]}`;

// Strength words: his standing (z against players of his position) at or above each threshold
export const STRENGTH_WORDS: [number, string][] = [
	[1.75, "Elite"],
	[1, "Strong"],
	[0.4, "Above-average"],
	[0, "Relies on"],
];
// A sub's lean (how far it sits above or below its base rating, against the league) adds this much to the base standing
const SUB_LEAN_W = 0.35;
// A dimension the build wants low is cited ("Low ball handling") only this far below his position
const LOW_Z = -0.5;
// (a driver must count at least this much to be cited)
const MIN_C = 0.25;
// A "Relies on" driver (at or above average, not clearly above it) is only cited when nothing stronger is
const RELIES_MAX = 0.4;
// The list: at most this many bullets
export const MAX_BULLETS = 4;

export const strengthWord = (s: number): string | undefined =>
	STRENGTH_WORDS.find(([t]) => s >= t)?.[1];

const phrase = (s: number, noun: string) => {
	const w = strengthWord(s);
	return w ? `${w} ${noun}` : undefined;
};

export const whyDrivers = ({
	a,
	ratings,
	norms,
	read = {},
	rows,
	pt,
	traits,
	shown = ratings,
}: {
	a: Archetype;
	ratings: ArchetypeRatings;
	norms: Norms;
	read?: ReadOptions;
	// The profile's strongest dimensions (classify.ts explain)
	rows: Why[];
	// His play types (the raw shares), with tracking stats and minutes
	pt?: PlayTypes;
	// Visible traits only
	traits?: Partial<Record<string, number>>;
	// The ratings the user sees (scouting fuzz as on the ratings pages): the words are read from these
	shown?: ArchetypeRatings;
}): WhyDriver[] => {
	const out: WhyDriver[] = [];
	const reading = read.prospect && norms.prospect ? norms.prospect : norms;
	// His standing against players of his position, from what the user sees
	const zv = zVector(shown, reading, read.pos);
	const pz = zv.pz;
	const subNorms = norms.sub ?? defaultSubNorms(zv.expanded);
	const wants = buildWants(a);

	// Sub-ratings the name wants (what counted is read from his true ratings, as the pick was; the words from the shown)
	const leansTrue = ratings.sub ? subLeans(ratings, subNorms) : undefined;
	const leansShown =
		shown.sub && leansTrue ? subLeans(shown, subNorms) : undefined;
	if (leansTrue && leansShown) {
		const l = (k: string) => leansTrue[SUB_INDEX[k]!] ?? 0;
		// (subFeatures, inlined so the contrasts read the same)
		const feat: Record<SubFeat, number> = {
			blk: l("blk"),
			idf: l("idf"),
			pdf: l("pdf"),
			stl: l("stl"),
			rng: l("rng"),
			cs: (l("tcs") + l("spu") - l("tod") - l("pul")) / 2,
			pst: l("pst"),
			cls: l("cls"),
			flt: l("flt"),
			con: (l("con") - l("fns")) / 2,
			hnd: l("hnd"),
			sec: l("sec"),
			crt: l("crt"),
			vis: (l("vis") - l("acc")) / 2,
			sls: (l("sls") - l("lat")) / 2,
			mxv: (l("mxv") - l("stj")) / 2,
			orb: (l("orb") - l("drd")) / 2,
		};
		for (const [k, w] of wants.sub) {
			const c = w * feat[k];
			if (c < MIN_C) {
				continue;
			}
			const [pos, neg] = SUB_SHOWN[k];
			// (a build that wants less of a sub with no other side to show: "little shot creation" is no reason to cite)
			if (w < 0 && !neg) {
				continue;
			}
			const key = w < 0 && neg ? neg : pos;
			const words = SUB_WORDS[key];
			if (!words) {
				continue;
			}
			const [noun, dim, group] = words;
			const s =
				(pz[dim] ?? 0) + SUB_LEAN_W * (leansShown[SUB_INDEX[key]!] ?? 0);
			// (never cite something below average)
			if (!(s >= 0)) {
				continue;
			}
			out.push({ kind: "sub", key, group, c, s, text: phrase(s, noun)! });
		}
	}

	// Play types the name wants that he runs well above his position's share
	if (read.pt && pt) {
		for (const [k, w] of wants.pt) {
			const f = read.pt.f[k];
			const c = w * f * read.pt.w;
			if (w <= 0 || c < MIN_C || !(f >= PT_PLENTY) || !(pt.freq[k] > 0)) {
				continue;
			}
			out.push({
				kind: "playType",
				key: k,
				group: PT_GROUP[k],
				c,
				s: f,
				text: ptText(k, f),
			});
		}
	}

	// Visible traits where the name asks for them
	if (traits) {
		for (const g of TRAIT_GROUPS) {
			const v = traitGroupValue(g, traits);
			if (v >= 0.4 && g.re.test(a.name)) {
				const names = g.traits
					.filter((k) => (traits[k] ?? 0) >= 60)
					.map(
						(k) =>
							(TRAIT_DEFINITIONS as Record<string, { name: string }>)[k]
								?.name ?? k,
					);
				if (names.length > 0) {
					out.push({
						kind: "trait",
						key: g.term,
						group: g.term,
						c: v,
						s: v,
						text: `${names.join(" and ")} ${names.length > 1 ? "traits" : "trait"}`,
					});
				}
			}
		}
	}

	// The base dimensions behind the profile: what the build wants that he has, at or above his position's average
	for (const r of rows) {
		const words = DIM_WORDS[r.dim];
		if (!words) {
			continue;
		}
		const [noun, group] = words;
		const s = pz[r.dim] ?? 0;
		const c = r.want * r.z;
		if (r.want > 0 && c > 0 && s >= 0) {
			out.push({
				kind: "rating",
				key: r.dim,
				group,
				c,
				s,
				text: phrase(s, noun)!,
			});
		} else if (
			r.want < 0 &&
			r.z < 0 &&
			s <= LOW_Z &&
			r.dim !== "hgt" &&
			r.dim !== "cs" &&
			r.dim !== "orl"
		) {
			out.push({
				kind: "low",
				key: r.dim,
				group,
				c: -r.want * -r.z,
				s,
				text: `Low ${noun}`,
			});
		}
	}

	// Always at least one: the dimension the build wants where he stands best ("Relies on" when it is not above average)
	if (!out.some((d) => d.kind !== "low") && rows.length > 0) {
		const best = rows
			.filter((r) => r.want > 0 && DIM_WORDS[r.dim])
			.sort((x, y) => (pz[y.dim] ?? 0) - (pz[x.dim] ?? 0))[0];
		if (best) {
			const [noun, group] = DIM_WORDS[best.dim]!;
			const s = pz[best.dim] ?? 0;
			out.push({
				kind: "rating",
				key: best.dim,
				group,
				c: Math.max(best.want * best.z, 0),
				s,
				text: phrase(Math.max(s, 0), noun)!,
			});
		}
	}
	return out;
};

const byC = (xs: WhyDriver[]) =>
	[...xs].sort((x, y) => y.c - x.c || (x.key < y.key ? -1 : 1));

// The driver the list leads with (tests: the why names the top contributing feature): the strongest sub-rating, else the
// strongest base dimension
export const topDriver = (drivers: WhyDriver[]): WhyDriver | undefined =>
	byC(drivers.filter((d) => d.kind === "sub"))[0] ??
	byC(drivers.filter((d) => d.kind === "rating"))[0];

// The bullets: the top skill, then the play type and the trait that counted most, then the other skills (sub-ratings before
// base dimensions), then a dimension he is low in; one bullet per skill, at most MAX_BULLETS
export const whyBullets = (drivers: WhyDriver[]): string[] => {
	const skills = [
		...byC(drivers.filter((d) => d.kind === "sub")),
		...byC(drivers.filter((d) => d.kind === "rating")),
	];
	const order = [
		...skills.slice(0, 1),
		...byC(drivers.filter((d) => d.kind === "playType")).slice(0, 1),
		...byC(drivers.filter((d) => d.kind === "trait")).slice(0, 1),
		...skills.slice(1),
		...byC(drivers.filter((d) => d.kind === "low")).slice(0, 1),
	];
	const groups = new Set<string>();
	const texts = new Set<string>();
	const out: string[] = [];
	for (const d of order) {
		if (out.length >= MAX_BULLETS) {
			break;
		}
		if (groups.has(d.group) || texts.has(d.text)) {
			continue;
		}
		if (
			out.length > 0 &&
			(d.kind === "sub" || d.kind === "rating") &&
			d.s < RELIES_MAX
		) {
			continue;
		}
		groups.add(d.group);
		texts.add(d.text);
		out.push(d.text);
	}
	return out;
};

// The compact one-line form: the top two bullets
export const whyLine = (drivers: WhyDriver[]): string =>
	whyBullets(drivers).slice(0, 2).join(" · ");
