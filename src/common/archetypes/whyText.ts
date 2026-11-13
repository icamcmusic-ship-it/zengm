// arch16 (user request): the archetype's "why" as one short line that cites what actually drove the pick. With Sub-Ratings
// on, the sub-ratings the build's name wants (subStyle.ts buildWants) by name and value ("Shot Blocking 81, Interior D 76");
// with Advanced Tracking Stats and real minutes, the play type the name wants that he runs most against his peers ("28% of
// his possessions are post-ups"); a visible trait where it counted; otherwise (and to fill in) the base ratings behind the
// profile's strongest dimensions. Numbers are the ones the user sees (`shown`: fuzzed as the ratings pages fuzz them) and
// are left out with `hideNumbers` (the no-visible-ratings challenge).
import { SUB_DEFS, SUB_INDEX } from "../subRatings.ts";
import { TRAIT_DEFINITIONS } from "../playerTraits/definitions.ts";
import { DIM_LABELS, DIM_RATINGS } from "./composites.ts";
import {
	prepare,
	TRAIT_GROUPS,
	traitGroupValue,
	type ReadOptions,
} from "./score.ts";
import {
	buildWants,
	type PlayTypes,
	type PtFeat,
	type SubFeat,
} from "./subStyle.ts";
import type { Archetype, ArchetypeRatings, Norms, Why } from "./types.ts";

export type WhyDriver = {
	kind: "sub" | "playType" | "trait" | "rating";
	// The sub, play type, trait or dimension it is about
	key: string;
	// How much it counted toward the pick (comparable within a kind; subs and play types are z times the name's want)
	c: number;
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
const PT_PHRASE: Record<PtFeat, string> = {
	iso: "isolations",
	prb: "pick-and-roll ball handling",
	spot: "spot-ups",
	post: "post-ups",
	cut: "cuts",
	prr: "rolls to the rim",
	tr: "in transition",
	pb: "putbacks",
	offs: "off screens and handoffs",
};
// (a driver must count at least this much to be cited)
const MIN_C = 0.25;

const subName = (key: string) => SUB_DEFS[SUB_INDEX[key]!]?.name ?? key;

export const whyDrivers = ({
	a,
	ratings,
	norms,
	read = {},
	rows,
	pt,
	traits,
	shown = ratings,
	hideNumbers = false,
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
	shown?: ArchetypeRatings;
	hideNumbers?: boolean;
}): WhyDriver[] => {
	const num = (v: number | undefined) =>
		hideNumbers || v === undefined || !Number.isFinite(v)
			? ""
			: ` ${Math.round(v)}`;
	const out: WhyDriver[] = [];
	const p = prepare(ratings, norms, read);
	const wants = buildWants(a);
	const sub = p.style.sub;
	if (sub) {
		for (const [k, w] of wants.sub) {
			const c = w * sub[k];
			if (c < MIN_C) {
				continue;
			}
			const [pos, neg] = SUB_SHOWN[k];
			const key = w < 0 && neg ? neg : pos;
			out.push({
				kind: "sub",
				key,
				c,
				text: `${subName(key)}${num(shown.sub?.[SUB_INDEX[key]!])}`,
			});
		}
	}
	if (p.style.pt && pt) {
		for (const [k, w] of wants.pt) {
			const c = w * p.style.pt.f[k] * p.style.pt.w;
			if (w <= 0 || c < MIN_C) {
				continue;
			}
			const share = pt.freq[k];
			out.push({
				kind: "playType",
				key: k,
				c,
				text: hideNumbers
					? `runs a lot of ${PT_PHRASE[k]}`
					: k === "tr"
						? `${Math.round(100 * share)}% of his possessions come in transition`
						: `${Math.round(100 * share)}% of his possessions are ${PT_PHRASE[k]}`,
			});
		}
	}
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
						c: v,
						text: `${names.join(" and ")} trait`,
					});
				}
			}
		}
	}
	for (const r of rows) {
		const c = r.want * r.z;
		// (what he has that the build wants: a "low" dimension is no reason worth a line this short)
		if (c <= 0 || r.want < 0) {
			continue;
		}
		// (his height is not a skill rating: never averaged in)
		const keys = DIM_RATINGS[r.dim].filter((k) => k !== "hgt");
		const v =
			keys.length > 0
				? keys.reduce((t, k) => t + ((shown as any)[k] ?? 0), 0) / keys.length
				: undefined;
		out.push({
			kind: "rating",
			key: r.dim,
			c,
			text: `${r.want < 0 ? "low " : ""}${DIM_LABELS[r.dim]}${r.want < 0 ? "" : num(v)}`,
		});
	}
	return out;
};

// The line: the two strongest sub-ratings (or, without them, base ratings) at his size, then the play type and the trait
// that counted most
export const whyLine = (drivers: WhyDriver[]): string => {
	const by = (kind: WhyDriver["kind"]) =>
		drivers.filter((d) => d.kind === kind).sort((x, y) => y.c - x.c);
	const skills = [...by("sub"), ...by("rating")].slice(0, 2);
	const parts: string[] = [];
	if (skills.length > 0) {
		parts.push(`${skills.map((d) => d.text).join(" and ")} at his size`);
	}
	const pt = by("playType")[0];
	if (pt) {
		parts.push(pt.text);
	}
	const tr = by("trait")[0];
	if (tr) {
		parts.push(tr.text);
	}
	const s = parts.join("; ");
	return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : "";
};

// The driver the line leads with (tests: the why names the top contributing feature)
export const topDriver = (drivers: WhyDriver[]): WhyDriver | undefined =>
	[
		...drivers.filter((d) => d.kind === "sub"),
		...drivers.filter((d) => d.kind === "rating"),
	].sort((x, y) =>
		x.kind === y.kind ? y.c - x.c : x.kind === "sub" ? -1 : 1,
	)[0];
