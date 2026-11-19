// archreview2: aiming the ratings regenerator at an archetype under the absolute bars. A label's words must be true in
// absolute terms (tests.ts ABS_GATES) and its tier must fit his ovr (honest.ts): an elite name needs ovr 60, and under
// 50 only a name with two skill words over the bar is not replaced by an honest one. So a target is offered only from the
// ovr where it can be had (aimMinOvr), and an aimed player's ratings are pushed up to the gates his target's words need
// (gatePush), not only toward the target's shape.
import type { RatingKey } from "../../ratingsBuilds/types.ts";
import type { ArchetypeRatings, Pos } from "../types.ts";
import {
	scaleCutoff,
	type GateScaleKey,
	type RatingQuantiles,
} from "./gateScale.ts";
import { ELITE_OVR, ELITE_RE, MID_OVR, SKILL_BARS } from "./honest.ts";
import { gatesOf } from "./tests.ts";
import {
	NOUN_CLEAR,
	NOUN_RATING,
	nounScores,
	ratingAtPct,
	aimReachable,
	specialNounsOf,
} from "./nouns.ts";

// The lowest ovr at which a name can be a player's label (archnouns: Infinity for a build that can never be one: a name
// whose words are not all nouns, nouns.ts specialNounsOf)
export const aimMinOvr = (name: string, pos?: Pos): number =>
	!aimReachable(name, pos)
		? Infinity
		: ELITE_RE.test(name)
			? ELITE_OVR
			: gatesOf(name).length < 2
				? MID_OVR
				: 0;

// The full skill bar of each rating (honest.ts SKILL_BARS, its deciding rating)
const SKILL_BAR_OF: Partial<Record<string, number>> = {};
for (const bar of Object.values(SKILL_BARS)) {
	const [k, v] = Object.entries(bar)[0]!;
	SKILL_BAR_OF[k] = Math.max(SKILL_BAR_OF[k] ?? 0, v!);
}

// (the margin a push leaves above a gate, so the rebalancing to his ovr doesn't drop him back under it)
const MARGIN = 2;

// How much each rating must rise for every word of the name to clear its gate (base ratings only: height and the
// expanded ratings are not set by the regenerator)
export const gatePush = (
	name: string,
	r: ArchetypeRatings,
	rq?: RatingQuantiles,
	// his ovr: under MID_OVR a label needs two skills over the full skill bar (honest.ts), so each rating is pushed to it
	ovr?: number,
): Partial<Record<RatingKey, number>> => {
	const push: Partial<Record<RatingKey, number>> = {};
	const low = ovr !== undefined && ovr < MID_OVR;
	const add = (k: RatingKey, gate: number) => {
		const need = low ? Math.max(gate, (SKILL_BAR_OF[k] ?? 0) + MARGIN) : gate;
		const v = r[k];
		if (typeof v === "number" && v < need) {
			push[k] = Math.max(push[k] ?? 0, need - v);
		}
	};
	for (const need of gatesOf(name)) {
		for (const [k, min] of Object.entries(need) as [string, number][]) {
			const cut = scaleCutoff(min, k as GateScaleKey, rq) + MARGIN;
			switch (k) {
				case "ovr":
				case "hgt":
				case "pdef":
				case "idef":
					break;
				case "fin":
					add((r.ins ?? 0) >= (r.dnk ?? 0) ? "ins" : "dnk", cut);
					break;
				case "ath":
					add((r.spd ?? 0) >= (r.jmp ?? 0) ? "spd" : "jmp", cut);
					break;
				case "best": {
					const best = (["tp", "fg", "ins", "dnk"] as const).reduce((a, b) =>
						(r[b] ?? 0) > (r[a] ?? 0) ? b : a,
					);
					add(best, cut);
					break;
				}
				default:
					add(k as RatingKey, cut);
			}
		}
	}
	// archnouns: each of the name's nouns into his league's top 30% with room to spare (a special name needs its nouns
	// among his three best)
	const sn = specialNounsOf(name);
	for (const n of sn?.nouns ?? []) {
		const k = NOUN_RATING[n] as RatingKey;
		add(k, ratingAtPct(k, Math.min(0.97, NOUN_CLEAR + 0.12), rq) + MARGIN);
	}
	// ... and the nouns he isn't to be named for pulled under the bar, so they neither outrank the target's nor take its
	// place (a defensive one would make a defensive label of its own)
	if (sn) {
		const own = new Set(sn.nouns.map((n) => NOUN_RATING[n]));
		for (const s of nounScores(r, rq)) {
			const k = NOUN_RATING[s.key] as RatingKey;
			if (sn.nouns.includes(s.key) || own.has(k) || s.key === "crafty") {
				continue;
			}
			const cap = ratingAtPct(k, NOUN_CLEAR - 0.08, rq);
			const v = r[k];
			if (s.pct >= NOUN_CLEAR - 0.05 && typeof v === "number" && v > cap) {
				push[k] = Math.min(push[k] ?? 0, cap - v);
			}
		}
	}
	return push;
};

// archnouns: how close his ratings are to being named for a target (> 0: its nouns all clear the bar and lead his other
// nouns; the smaller of the two margins, in league standing)
export const nounAimMargin = (
	name: string,
	r: ArchetypeRatings,
	rq?: RatingQuantiles,
): number => {
	const sn = specialNounsOf(name);
	if (!sn) {
		return -Infinity;
	}
	const sc = nounScores(r, rq);
	const own = sc.filter((x) => sn.nouns.includes(x.key));
	const rest = sc.filter(
		(x) => !sn.nouns.includes(x.key) && x.key !== "crafty",
	);
	const low = Math.min(...own.map((x) => x.pct));
	const high = Math.max(NOUN_CLEAR - 0.05, ...rest.map((x) => x.pct));
	return Math.min(low - NOUN_CLEAR, low - high);
};
