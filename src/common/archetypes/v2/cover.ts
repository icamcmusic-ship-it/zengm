// archcov (the user's 2064 audit, his proposed redesign): a player's name is the catalog name that covers the most of
// his real strengths.
// 1. Each skill is read against the league and against his position group, its standing the lower of the two
//    (nouns.ts coverScores): a skill counts only when it is good outright and good for his position.
// 2. Speed, leaping and strength are modifiers: they lead a name only when no basketball skill clears, and else add at
//    most a word next to one.
// 3. Every candidate name (a special name, the user's own names, Jack-Of-All-Trades, a noun name: front words and an
//    end word) is scored by how much of his strengths it covers: it must cover his best skill, and leaving out one of
//    his top two costs heavily. The best-covering name wins (a star gets a combination name), a near tie going to the
//    rarer name, never to chance.
// 4. A noun name's end word is picked after its front words, and only one that fits them (a Gunner names a jumper).
// 5. Last season's label is re-checked every season: kept only while every rule still holds (its skills among his best
//    TOP_N, his best one covered), it still covers his top two skills, and it covers about as much as this season's
//    pick. Honest and development names are never kept once outgrown.
// 6. Every name's promises come from its own skill list (nouns.ts coverPromises).
// archfam (reading 28, the user's 2070 audit):
// 7. Skills that say the same thing count once, as a family (nouns.ts FAMILY_HEAD): shooting (3PT, mid-range), creation
//    (handle, shot creation), perimeter D (perimeter D, steals). His best TOP_N are families; a name spends one word on
//    a family ("3-Level" is the one word for shooting and finishing, from THREE_LEVEL_BAR at all three).
// 8. No defensive tag: "2-Way" is a prefix any name may take when his best defensive and best offensive skill are both at
//    TWO_WAY_BAR, and it covers all his defensive skills. Defense-only names stay for players whose best skills are
//    defensive.
// 9. Offensive IQ is mostly a flavor word (CRAFTY_COVER); mid-range and offensive IQ need an edge to lead (nouns.ts
//    LEAD_EDGE, MID_EDGE).
// 10. Special names (the catalog's, the user's own, the many-skills names) get SPECIAL_EDGE over a plain noun name, and
//     the many-skills names are gated by how many elite skills he has (ELITE_SKILL), not by his best skill's standing.
// archskill (reading 29, the user: "remove camp body and other 'honest' archetypes ... just put the one skill they are
// good at"):
// 11. No honest, flaw, development or depth name. Every skill has a plain noun (nouns.ts SKILL_NOUNS: Rebounder,
//     Spot-Up Shooter, Contact Finisher, ...): a one-skill name is that noun (SINGLE_NOUN_EDGE over his position word),
//     a two-skill one the front word of one skill and the noun of the other ("Glass-Cleaning Contact Finisher").
// 12. A player with no real skill, or one at low ovr, is named by his best skill (or best two) against the league and his
//     position, whatever its standing (skillPick): every player gets a skill name.
import type { ArchetypeRatings, Pos } from "../types.ts";
import {
	composedId,
	composeName,
	DESC_BY_KEY,
	GROUP_OF,
	ROLE_BY_KEY,
	type PosGroup,
} from "./grammar.ts";
import { archetypeById } from "../classify.ts";

const archetypeNameOf = (id: string) => archetypeById(id)?.name;
import {
	ATH_KEYS,
	ATH_LEAD_BAR,
	ATH_WORD_BAR,
	CUSTOM_SPECIALS,
	DEF_NOUNS,
	ELITE_PCT,
	END_WORDS,
	JACK_CLEARED,
	JACK_NAME,
	MID_EDGE,
	NOUN_DESC,
	NOUNS,
	ONE_NOUN_OVR,
	OFFENSE,
	POS_WORD,
	REJECT_NEAR,
	SPREAD_PEN,
	STICK_BOOST,
	SUB_WORD,
	TOP_N,
	TRAIT_KEYWORDS,
	coverCtxOf,
	coverPromises,
	coverScores,
	coverBar,
	coverSkills,
	eliteOvrOf,
	familyMembers,
	familyOf,
	familyRep,
	leadEdgeOf,
	NEW_MEMBER_EDGE,
	NEW_NOUNS,
	OLD_NOUNS,
	NEW_OWN,
	SKILL_NOUNS,
	SKILL_ROLE_NOUN,
	skillNounOf,
	stemRepeat,
	groupOfPos,
	isLong,
	leadSub,
	mobile,
	nameProblem,
	normName,
	nounOfDesc,
	nounWord,
	pctOf,
	prevMainOf,
	skillRank,
	specialsAt,
	tieFavored,
	traitKeywordOf,
	wordsFit,
	nounFitsPos,
	type CoverCtx,
	type CoverScore,
	type CustomSpecial,
	type EndCtx,
	type NounInput,
	type NounKey,
	type NounPick,
	type PosWord,
	type Special,
	type SpecialCtx,
	type SkillNounCtx,
} from "./nouns.ts";

// Leaving out one of his top two skills costs this much coverage
export const MISS_TOP2 = 2;
// A second skill named costs this much (it is named from about the 66th percentile), each beyond two this much (from
// about the 72nd), so a skill earns its word smoothly, with no cliff
export const SECOND_COST = 0.3;
// archaudit: a skill name (skillPick) needs his best skill at this standing or more (league and position group); below it
// he is named by his position alone
export const SKILL_NAME_MIN = 0.5;
export const EXTRA_COST = 0.6;
// archfam: the many-skills names are gated by how many elite skills he has (skills at ELITE_SKILL, offensive IQ apart),
// not by his best skill's standing. A broad name (Jack-Of-All-Trades, Swiss-Army-Knife, the user's names with no
// elite-ovr test) is for a player with many good skills and at most FLAT_ELITE elite ones, and covers each of his best
// GENERIC_COVER; an elite one (Complete All-Court Prototype, the Unicorns: names with an elite-ovr test) is for a
// player with MANY_ELITE elite skills or more, and covers each ELITE_COVER (a narrow name says too little of him)
export const ELITE_SKILL = 0.9;
export const FLAT_ELITE = 3;
export const MANY_ELITE = 9;
export const GENERIC_COVER = 0.52;
export const ELITE_COVER = 0.9;
// Jack-Of-All-Trades: his TOP_N-th skill at this standing (many good skills)
export const JACK_FLAT = 0.85;
// archfam: a noun name says at most this many skills (2-Way counts as one; a name like "2-Way Crafty Shot-Creating
// Walking-Bucket" says too much)
export const MAX_PARTS = 3;
// An end word of his own over a plain noun name that covers the same
const FLAVOR = 0.05;
// archfam: a special name (a catalog build, the user's own names, Jack) over a noun name that covers the same
export const SPECIAL_EDGE = 0.15;
// archfam: 2-Way: his best defensive skill and his best offensive skill both at this standing
export const TWO_WAY_BAR = 0.8;
// archaudit 2059: 2-Way also needs real defense, perimeter or interior D itself at this standing (steals, help, post or
// switch D alone gave the prefix to players whose best perimeter/interior D sat near the league median)
export const TWO_WAY_CORE = 0.7;
// archaudit 2059: a skill name names his second skill too when it is at this standing (lower of league and position; the
// audit flagged 62nd+, and a name's word promises top 35%),
// so a low-ovr player with two real skills isn't reduced to one noun
export const PAIR_PCT = 0.65;
// archfam: 3-Level: 3PT, mid-range and finishing all at this standing
export const THREE_LEVEL_BAR = 0.78;
// archskill (reading 29): a one-skill noun name ("Rebounder") over his position word ("Glass-Cleaning Big") that covers
// the same: the plain noun of his one skill is his name
export const SINGLE_NOUN_EDGE = 0.01;
// archfam: offensive IQ is mostly a flavor word: it covers this much of what a skill word covers, leaving it out costs
// nothing, and naming it costs this much of a named skill (nothing: "Crafty" is a flavor word in front of a name)
export const CRAFTY_COVER = 0.5;
export const CRAFTY_NAMED = 0;
// archcov: last season's label stays unless this season's pick covers clearly more (the user: "only switch if the new
// name beats the current one by a clear margin")
export const STICK_COVER = 0.1;
// archcov (the user: smooth skill scoring, no cliff): a skill's weight ramps from nothing at the 60th percentile (the
// lower of league and position) to full at the 80th
export const RAMP_LO = 0.6;
export const RAMP_HI = 0.8;
export const skillWeight = (pct: number) =>
	Math.max(0, Math.min(1, (pct - RAMP_LO) / (RAMP_HI - RAMP_LO)));
// (the families 2-Way covers; archskill: help defense too)
const DEF_FAMS: readonly NounKey[] = ["perimD", "rimD"];
// Names that say his defense themselves (no 2-Way prefix on them)
const SAYS_DEFENSE =
	/2-Way|Two-Way|3 & D|Lockdown|Defend|Defensive|Stopper|\bLock\b|Clamp|Eras|Protect|Warden|Disruptor|Swipe|Pest|Hawk/;
const THREE_LEVEL_RE = /Three-Level|3-Level/;

const SCORING: ReadonlySet<NounKey> = new Set([
	"three",
	"mid",
	"post",
	"finish",
]);
// (an end word that says no skill must fit the skills the name does say)
const END_FITS: Record<string, (front: readonly NounKey[]) => boolean> = {
	eGunner: (f) => f.includes("three") || f.includes("mid"),
	eScorer: (f) => f.some((n) => SCORING.has(n)),
	eCloser: (f) => f.some((n) => SCORING.has(n)),
	eMover: (f) =>
		f.includes("three") || f.includes("finish") || f.includes("mid"),
	eConnector: (f) =>
		f.includes("pass") || f.includes("crafty") || f.includes("handle"),
	eSwingman: (f) =>
		f.some((n) => ["three", "finish", "handle", "perimD"].includes(n)),
	eSpark: (f) => !f.some((n) => n === "post" || n === "rimD"),
};
// Bruiser says his strength (a guard or wing whose name is about a physical skill); Enigma a talented scorer or creator
// with no consistency
const PHYSICAL: ReadonlySet<NounKey> = new Set(["post", "finish", "reb"]);
const CREATIVE: ReadonlySet<NounKey> = new Set([
	"three",
	"mid",
	"post",
	"finish",
	"handle",
	"creator",
]);

type Cand = {
	pick: NounPick;
	// the skills (and modifiers) the main name names
	main: NounKey[];
	// archfam: a 2-Way name (it covers all his defensive skills)
	twoWay: boolean;
	// archfam: it covers his top two skills (families)
	top2: boolean;
	score: number;
	// how common its id is
	common: number;
	order: number;
};

export const pickCover = (x: NounInput): NounPick => {
	const p = pickCoverTies(x);
	finalHook?.(p);
	return p;
};
// (a pick's id, as the engine gives it; undefined for an honest name, which the engine names)
const pickIdOf = (p: NounPick, pos: Pos): string | undefined => {
	const g = GROUP_OF[pos];
	switch (p.kind) {
		case "special":
			return p.id;
		case "composed":
			return (
				p.keepId ??
				composedId(
					ROLE_BY_KEY.get(p.role)!,
					p.descs.map((k) => DESC_BY_KEY.get(k)!),
					g,
					p.pick ?? {},
				)
			);
		case "trait":
			return composedId(ROLE_BY_KEY.get(p.key)!, [], g, { [p.key]: p.name });
		default:
			return undefined;
	}
};
// archstick: a near tie goes to last season's skills (coverSkills); when that order loses his label and the plain order
// keeps it, the plain order's pick (a near tie never takes away the label it was meant to keep)
// archfam: last season's label is kept only while it still covers his top two skills (families)
const pickCoverTies = (x: NounInput): NounPick => {
	const a = pickCoverOnce(x);
	const prevId = x.prev?.id;
	if (x.tie === false || prevId === undefined) {
		return a;
	}
	if (pickIdOf(a, x.pos) === prevId) {
		return a;
	}
	// (last season's name still qualifies with the slack, covers his top two, and covers about as much)
	// (with every standing STICK_BOOST higher, then lower: a bar he must reach, or one he must stay under)
	for (const slack of [STICK_BOOST, -STICK_BOOST]) {
		const k = pickCoverOnce({ ...x, slack });
		if (pickIdOf(k, x.pos) === prevId && k.coversTop2 !== false) {
			return { ...keptVariant(k), slack };
		}
	}
	const b = pickCoverOnce({ ...x, tie: false });
	return pickIdOf(b, x.pos) === prevId && b.coversTop2 !== false
		? { ...b, tie: false }
		: a;
};
const keptVariant = (p: NounPick): NounPick =>
	p.explain
		? { ...p, explain: { ...p.explain, variant: "kept from last season" } }
		: p;
const pickCoverOnce = (x: NounInput): NounPick => {
	const { r, pos, rq } = x;
	const group: PosGroup = groupOfPos(pos);
	const favored = tieFavored(x);
	const scores = coverScores(r, pos, rq, x.ng, x.slack, x.traits);
	const pct = Object.fromEntries(scores.map((s) => [s.key, s.pct])) as Record<
		NounKey,
		number
	>;
	// archfam: his skills, one per family (its word), at the family's standing, best first
	const skillsS = coverSkills(scores, favored);
	const skills = skillsS.map((s) => s.key);
	const famPct = new Map<NounKey, number>(
		skillsS.map((s) => [familyOf(s.key), s.pct]),
	);
	// (a family's standing: its best member's, for a family that clears)
	const fp = (k: NounKey) => famPct.get(familyOf(k)) ?? pct[k];
	const fams = skills.map(familyOf);
	// (his best TOP_N families; offensive IQ among them as a flavor)
	const realFams = fams.filter((f) => f !== "crafty");
	const topFams = fams.slice(0, TOP_N);
	// (the window a name's skills must be in: with 2-Way, his defensive families are one)
	const windowOf = (tw: boolean): NounKey[] => {
		let d = false;
		return fams.filter((f) => {
			if (!tw || !DEF_FAMS.includes(f)) {
				return true;
			}
			const first = !d;
			d = true;
			return first;
		});
	};
	const windowIndex = (n: NounKey, tw: boolean): number => {
		const f = familyOf(n);
		const w = windowOf(tw);
		const i = w.indexOf(
			tw && DEF_FAMS.includes(f)
				? (w.find((g) => DEF_FAMS.includes(g)) ?? f)
				: f,
		);
		return i < 0 ? Infinity : i;
	};
	const ctx: CoverCtx = coverCtxOf(x);
	// (his real skills: the skill pick, the one-skill rule and the athletic lead read these)
	const nStrong = ctx.strong.length;
	const ath = ctx.ath;
	const athWord = ath.filter((a) => pct[a] >= ATH_WORD_BAR);
	// (a modifier word is never kept on slack: his true standing, for last season's label re-checked with slack)
	const athTrue = (n: NounKey) => pct[n] - (x.slack ?? 0);
	const eliteOvr = eliteOvrOf(x.ovr, rq);
	const isMobile = mobile(r, rq);
	const isElite = (k: NounKey) =>
		eliteOvr && pct[k] >= ELITE_PCT && (k !== "perimD" || isMobile);
	// archfam: 2-Way: his best defensive and best offensive skill both at TWO_WAY_BAR
	const bestD = Math.max(...[...DEF_NOUNS].map((n) => pct[n]));
	const bestO = Math.max(...[...OFFENSE].map((n) => pct[n]));
	const twoWay =
		bestD >= TWO_WAY_BAR &&
		bestO >= TWO_WAY_BAR &&
		Math.max(pct.perimD, pct.rimD) >= TWO_WAY_CORE;
	// archfam: 3-Level: 3PT, mid-range and finishing all at THREE_LEVEL_BAR
	const threeLevel =
		pct.three >= THREE_LEVEL_BAR &&
		pct.mid >= THREE_LEVEL_BAR &&
		pct.finish >= THREE_LEVEL_BAR;
	// (how many elite skills: the many-skills names read these)
	// (archskill: the skills of reading 28 only: the new ones read ratings the old ones already read, and would make the
	// many-skills names much more common)
	const eliteN = NOUNS.filter(
		(n) =>
			!ATH_KEYS.has(n) &&
			n !== "crafty" &&
			!NEW_NOUNS.has(n) &&
			pct[n] >= ELITE_SKILL,
	).length;
	const broadFams = realFams.filter((f) => !NEW_OWN.has(f));
	const nBroad = ctx.strong.filter((k) => !NEW_OWN.has(familyOf(k))).length;
	const long = isLong(r);
	const ovr = x.ovr ?? 99;
	const rank = (k: NounKey) => skillRank(ctx, k);
	// (his best skill: offensive IQ, a flavor, gives way to the next)
	const bestFam = fams.find((f) => f !== "crafty") ?? fams[0];
	const best =
		bestFam === undefined ? undefined : skills[fams.indexOf(bestFam)];
	// (the shooting family's word: 3PT unless mid-range leads it by MID_EDGE)
	const shootRep = familyRep("three", (k) => pct[k]);

	// The user's verdicts (read on league standings, as they were given)
	const leaguePct = Object.fromEntries(
		scores.map((s) => [s.key, s.league]),
	) as Record<NounKey, number>;
	const vetoed = (name: string) =>
		(x.rejected ?? []).some((rj) => {
			if (normName(rj.name) !== normName(name)) {
				return false;
			}
			if (rj.own || !rj.pct) {
				return rj.own;
			}
			let s = 0;
			let n = 0;
			for (const k of OLD_NOUNS) {
				const v = rj.pct[k];
				if (v !== undefined) {
					s += Math.abs(v - leaguePct[k]);
					n++;
				}
			}
			return n > 0 && s / n <= REJECT_NEAR;
		});
	// (with 2-Way, his defensive families are one among his best: the second leaves the list the promises read)
	const ctxTw: CoverCtx = (() => {
		const d = ctx.skills.filter((k) => DEF_FAMS.includes(familyOf(k)));
		return d.length > 1
			? { ...ctx, skills: ctx.skills.filter((k) => k !== d[1]) }
			: ctx;
	})();
	const okName = (name: string, list: readonly NounKey[], tw = false) =>
		!vetoed(name) &&
		!nameProblem(name) &&
		coverPromises(name, list, tw ? ctxTw : ctx).length === 0;
	const common = (id: string | undefined) =>
		id === undefined ? 0 : (x.common?.[id] ?? 0);

	// ---- what a main name covers: the families it names (2-Way: all his defensive ones too) ----
	const coveredFams = (main: readonly NounKey[], tw: boolean): Set<NounKey> => {
		const out = new Set<NounKey>(
			main.filter((n) => !ATH_KEYS.has(n)).map(familyOf),
		);
		if (tw) {
			for (const f of DEF_FAMS) {
				out.add(f);
			}
		}
		return out;
	};
	// (it covers his top two families: a many-skills name covers them all a little)
	const coversTop2 = (main: readonly NounKey[], tw: boolean, generic: number) =>
		generic > 0 ||
		realFams.slice(0, 2).every((f) => coveredFams(main, tw).has(f));

	// ---- how much of his strengths a main name covers: his best TOP_N families, each by how far it stands above the
	// league's middle; each skill named costs a little (a long name has to earn it) ----
	const coverOf = (
		main: readonly NounKey[],
		tw: boolean,
		generic = 0,
	): number => {
		const cov = coveredFams(main, tw);
		let s = 0;
		let i = 0;
		for (const f of topFams) {
			const c = Math.max(cov.has(f) ? 1 : 0, f === "crafty" ? 0 : generic);
			const p = famPct.get(f) ?? 0;
			const w = skillWeight(p);
			// (the weight, and a hair of the standing itself so two full-weight skills still order; offensive IQ a flavor)
			s += (w + p / 100) * c * (f === "crafty" ? CRAFTY_COVER : 1);
			// (leaving out one of his top two costs in proportion to that skill's weight)
			if (c === 0 && i <= 1 && f !== "crafty") {
				s -= MISS_TOP2 * w;
			}
			i++;
		}
		// (a many-skills name claims as much as two named skills; each family named counts once, 2-Way as one more)
		const namedFams = new Set(
			main.filter((n) => !ATH_KEYS.has(n)).map(familyOf),
		);
		const named =
			generic > 0
				? 2
				: namedFams.size -
					(namedFams.has("crafty") ? 1 - CRAFTY_NAMED : 0) +
					(tw ? 1 : 0);
		s -= SECOND_COST * Math.min(1, Math.max(0, named - 1));
		s -= EXTRA_COST * Math.max(0, named - 2);
		// (a modifier says a little more about him)
		for (const n of main) {
			if (ATH_KEYS.has(n)) {
				s += 0.1 * skillWeight(pct[n]);
			}
		}
		return s;
	};
	// Whether a main name's skills may name him: each among his best TOP_N families (and clearing its own bar), his best
	// one covered (named, or by 2-Way), the shooting family said by its own word, no modifier alone next to a skill
	const listOk = (
		list: readonly NounKey[],
		opts: { anyBest?: boolean; tw?: boolean; oneWord?: boolean } = {},
	): boolean => {
		const skillN = list.filter((n) => !ATH_KEYS.has(n));
		if (nStrong > 0) {
			if (skillN.length === 0) {
				return false;
			}
			// (re-checking last season's label: a skill within STICK_BOOST of his TOP_N-th, or of his best, still counts)
			const tol = (x.slack ?? 0) > 0 ? STICK_BOOST : 0;
			const win = windowOf(!!opts.tw);
			const nthF = win[TOP_N - 1];
			const nthP = nthF === undefined ? 0 : (famPct.get(nthF) ?? 0);
			const inTop = (n: NounKey) =>
				rank(n) < Infinity &&
				(windowIndex(n, !!opts.tw) < TOP_N ||
					(tol > 0 && nthF !== undefined && fp(n) >= nthP - tol));
			if (!skillN.every(inTop)) {
				return false;
			}
			// (one shooting word: the family's own, 3PT unless mid-range leads by MID_EDGE)
			const shoot = skillN.filter((n) => familyOf(n) === "three");
			if (shoot.length === 1 && shoot[0] !== shootRep) {
				const lead = pct.mid - pct.three - MID_EDGE;
				if (!(tol > 0 && Math.abs(lead) <= tol)) {
					return false;
				}
			}
			if (opts.oneWord) {
				const fs = skillN.map(familyOf);
				if (new Set(fs).size !== fs.length) {
					return false;
				}
			}
			if (!opts.anyBest && bestFam !== undefined) {
				const cov = coveredFams(skillN, !!opts.tw);
				if (
					!cov.has(bestFam) &&
					!(
						tol > 0 &&
						[...cov].some((f) => (famPct.get(f) ?? 0) >= fp(bestFam) - tol)
					)
				) {
					return false;
				}
			}
			return list
				.filter((n) => ATH_KEYS.has(n))
				.every((n) => athTrue(n) >= ATH_WORD_BAR);
		}
		return (
			skillN.length === 0 &&
			!opts.tw &&
			list.length > 0 &&
			list.every((n) => pct[n] >= ATH_LEAD_BAR)
		);
	};
	// (a special name's skills, one per family, except 3-Level's shooting and finishing)
	const mainOfNouns = (nouns: readonly NounKey[], name: string): NounKey[] => {
		const out: NounKey[] = [];
		const seen = new Set<NounKey>();
		const tl = THREE_LEVEL_RE.test(name);
		const list = tl ? [...nouns, "finish" as const] : [...nouns];
		// (the family's own word first)
		const ordered = [
			...list.filter((n) => familyOf(n) !== n || n === shootRep),
			...list,
		];
		for (const n of ordered) {
			const f = familyOf(n);
			if (seen.has(f) && !(tl && f === "three")) {
				continue;
			}
			if (!out.includes(n)) {
				out.push(n);
			}
			seen.add(f);
		}
		return out;
	};
	const confFor = (main: readonly NounKey[]) => {
		const named = main.filter((n) => !ATH_KEYS.has(n));
		const ps = named.map((n) => pct[n]);
		if (ps.length === 0) {
			return 0.5;
		}
		const low = Math.min(...ps);
		const nextKey = skills.find(
			(k) => !named.some((n) => familyOf(n) === familyOf(k)),
		);
		const next = nextKey === undefined ? 0.6 : fp(nextKey);
		const clear = Math.min(1, (low - 0.7) / 0.2);
		const gap = Math.min(1, Math.max(0, (low - next) / 0.1));
		return Math.round((0.4 + 0.35 * clear + 0.25 * gap) * 100) / 100;
	};

	// ---- the candidates ----
	const cands: Cand[] = [];
	let order = 0;
	const push = (
		pick: NounPick,
		main: NounKey[],
		id: string | undefined,
		bonus: number,
		generic = 0,
		tw = false,
	) => {
		const top2 = coversTop2(main, tw, generic);
		cands.push({
			pick: { ...pick, main, coversTop2: top2 },
			main,
			twoWay: tw,
			top2,
			score: coverOf(main, tw, generic) + bonus - SPREAD_PEN * common(id),
			common: common(id),
			order: order++,
		});
	};
	// (a many-skills name: 3+ real skills (families); a broad one with at most FLAT_ELITE elite skills, an elite one
	// with MANY_ELITE or more)
	const manyOk = (elite: boolean) =>
		nBroad >= 3 && (elite ? eliteN >= MANY_ELITE : eliteN <= FLAT_ELITE);

	// The user's own special names (their tests read the standings against league and position)
	const customCtx: SpecialCtx = {
		pos,
		ovrPct: x.ovr === undefined ? 0 : pctOf("ovr", x.ovr, rq),
		pct,
		r,
		traits: x.traits,
		eliteOvr,
		ovr: x.ovr ?? 0,
		age: x.age,
		best,
	};
	// (a name only an elite player may have: its test needs his elite ovr; over one anybody may, an elite name for an
	// elite player)
	const eliteGated = (c: CustomSpecial) =>
		eliteOvr && !c.test({ ...customCtx, eliteOvr: false });
	const customName = (c: CustomSpecial, tw = false) =>
		composeName(
			ROLE_BY_KEY.get(c.key)!,
			tw ? [DESC_BY_KEY.get("twoWay")!] : [],
			GROUP_OF[pos],
		);
	const customMain = (c: CustomSpecial) =>
		c.anyBest ? [] : mainOfNouns(c.nouns, customName(c));
	const customOk = (c: CustomSpecial, tw = false): boolean => {
		if (!c.positions.includes(pos) || !c.test(customCtx)) {
			return false;
		}
		const name = customName(c, tw);
		if (THREE_LEVEL_RE.test(name) && !threeLevel) {
			return false;
		}
		if (tw) {
			if (
				!twoWay ||
				c.anyBest ||
				c.nouns.some((n) => DEF_NOUNS.has(n)) ||
				SAYS_DEFENSE.test(customName(c)) ||
				!c.nouns.some((n) => OFFENSE.has(n))
			) {
				return false;
			}
		}
		if (c.anyBest) {
			if (!manyOk(eliteGated(c))) {
				return false;
			}
		} else if (!listOk(customMain(c), { tw })) {
			return false;
		}
		if (c.nouns.length <= 1 && ovr < ONE_NOUN_OVR && nStrong < 2) {
			return false;
		}
		return okName(name, customMain(c), tw);
	};
	const pushCustom = (c: CustomSpecial, tw = false) => {
		const main = customMain(c);
		if (tw) {
			// (the user's own name with a 2-Way prefix: a noun name on his name's role)
			push(
				{
					kind: "composed",
					descs: ["twoWay"],
					role: c.key as PosWord,
					nouns: main,
					conf: confFor(main),
				},
				main,
				composedId(
					ROLE_BY_KEY.get(c.key)!,
					[DESC_BY_KEY.get("twoWay")!],
					GROUP_OF[pos],
				),
				SPECIAL_EDGE,
				0,
				true,
			);
			return;
		}
		push(
			{
				kind: "trait",
				key: c.key,
				name: customName(c),
				conf: confFor(c.nouns),
			},
			main,
			composedId(ROLE_BY_KEY.get(c.key)!, [], GROUP_OF[pos]),
			SPECIAL_EDGE + (eliteGated(c) ? FLAVOR : 0),
			c.anyBest ? (eliteGated(c) ? ELITE_COVER : GENERIC_COVER) : 0,
		);
	};

	// Jack-Of-All-Trades: JACK_CLEARED skills (families) or more, his JACK_CLEARED-th at JACK_FLAT, few elite ones
	const jackOk = () =>
		nBroad >= JACK_CLEARED &&
		manyOk(false) &&
		(famPct.get(broadFams[JACK_CLEARED - 1]!) ?? 0) >= JACK_FLAT &&
		ovr >= 45 &&
		okName(JACK_NAME, []);
	const jackId = composedId(ROLE_BY_KEY.get("sJack")!, [], GROUP_OF[pos]);
	const pushJack = () =>
		push(
			{ kind: "trait", key: "sJack", name: JACK_NAME, conf: 0.6 },
			// (it names no skill of its own: it covers each of them a little)
			[],
			jackId,
			SPECIAL_EDGE,
			GENERIC_COVER,
		);

	// Special names (builds): every skill among his best families, his best one covered, modifiers at the word bar; a
	// 2-Way build (or a 3 & D one) needs the 2-Way test and covers his defense
	const specialTw = (sp: Special) =>
		sp.twoWay || (/3 & D/.test(sp.name) && twoWay);
	const specialMain = (sp: Special): NounKey[] =>
		mainOfNouns(
			specialTw(sp) ? sp.nouns.filter((n) => !DEF_NOUNS.has(n)) : sp.nouns,
			sp.name,
		);
	const specialOk = (sp: Special): boolean => {
		if (sp.twoWay && !twoWay) {
			return false;
		}
		if (THREE_LEVEL_RE.test(sp.name) && !threeLevel) {
			return false;
		}
		const main = specialMain(sp);
		if (!listOk(main, { tw: specialTw(sp) })) {
			return false;
		}
		if (main.length <= 1 && ovr < ONE_NOUN_OVR && nStrong < 2) {
			return false;
		}
		if (sp.elite) {
			const head = sp.nouns[0]!;
			if (!eliteOvr || !isElite(head) || (best && !isElite(best))) {
				return false;
			}
		}
		return (
			wordsFit(sp.name, pos, x.traits, pct.handle) &&
			okName(sp.name, main, specialTw(sp))
		);
	};
	const pushSpecial = (sp: Special) =>
		push(
			{
				kind: "special",
				id: sp.id,
				name: sp.name,
				nouns: sp.nouns,
				conf: confFor(specialMain(sp)),
			},
			specialMain(sp),
			sp.id,
			SPECIAL_EDGE,
			0,
			specialTw(sp),
		);

	// Noun names: front words, then the end word that fits them
	const endCtxOf = (shown: readonly NounKey[]): EndCtx => ({
		pct,
		r,
		traits: x.traits,
		pos,
		group,
		elite: isElite,
		shown,
		ovr: x.ovr ?? 0,
		ovrPct: x.ovr === undefined ? 0 : pctOf("ovr", x.ovr, rq),
	});
	const enigma = (x.traits?.consistency ?? 100) <= 30 && (x.ovr ?? 0) >= 45;
	// (Bruiser: a physical guard or wing, whose name is about a skill he uses his strength for: post scoring,
	// rebounding, or finishing through contact)
	const bruiserOk = (front: readonly NounKey[]) =>
		group !== "big" &&
		athTrue("strength") >= ATH_WORD_BAR &&
		front.some(
			(n) =>
				PHYSICAL.has(n) &&
				(n !== "finish" || leadSub(r, ["con", "fns"]) !== "fns"),
		);
	const enigmaOk = (front: readonly NounKey[]) =>
		enigma && front.some((n) => CREATIVE.has(n));
	// (a front noun's word: its elite word while he is elite, the sub-rating word, the plain word)
	const descWord = (n: NounKey) => nounWord(n, isElite(n), group, r);
	// archskill: the noun each skill takes (nouns.ts SKILL_NOUNS)
	const skillCtx: SkillNounCtx = {
		pct,
		r,
		group,
		elite: isElite,
		...(rq ? { rq } : {}),
		...(x.traits ? { traits: x.traits } : {}),
	};
	const descWordOk = (n: NounKey, d: string): boolean => {
		const el = isElite(n);
		if (d === nounWord(n, el, group, r)) {
			return true;
		}
		if (el) {
			return false;
		}
		const w = NOUN_DESC[n];
		if (d === (w.byGroup?.[group] ?? w.desc)) {
			return true;
		}
		const sw = SUB_WORD[n];
		if (sw && (!sw.groups || sw.groups.includes(group))) {
			const k = Object.keys(sw.words).find((key) => sw.words[key] === d);
			if (k) {
				const lead = leadSub(r, sw.keys);
				return lead === undefined || lead === k;
			}
		}
		return false;
	};
	// (a noun name, read word by word: its nouns and whether it is 2-Way, or undefined when a word no longer says him or
	// two words say one family)
	const composedNouns = (
		roleKey: string,
		descKeys: readonly string[],
	): { nouns: NounKey[]; tw: boolean } | undefined => {
		const nouns: NounKey[] = [];
		const used = new Set<NounKey>();
		let tw = false;
		const add = (...ns: NounKey[]): boolean => {
			const fs = new Set(ns.filter((n) => !ATH_KEYS.has(n)).map(familyOf));
			for (const f of fs) {
				if (used.has(f)) {
					return false;
				}
			}
			for (const f of fs) {
				used.add(f);
			}
			nouns.push(...ns);
			return true;
		};
		for (const d of descKeys) {
			if (d === "long") {
				// (archskill: his length, the wingspan over his height or the length skill at the word bar)
				if (!long && athTrue("length") < ATH_WORD_BAR) {
					return undefined;
				}
				if (!long) {
					nouns.push("length");
				}
			} else if (d === "highlightReel") {
				if (pct.jump < 0.85 || pct.finish < 0.85 || !add("finish", "jump")) {
					return undefined;
				}
			} else if (d === "twoWay") {
				if (!twoWay || tw) {
					return undefined;
				}
				tw = true;
			} else if (d === "threeLevel") {
				if (!threeLevel || !add("three", "mid", "finish")) {
					return undefined;
				}
			} else {
				const tk = TRAIT_KEYWORDS.find((t) => t.desc === d);
				if (tk) {
					if (tk.over(x, pct, group) < 0) {
						return undefined;
					}
					continue;
				}
				const n = nounOfDesc(d);
				if (!n || !descWordOk(n, d) || !add(n)) {
					return undefined;
				}
			}
		}
		const front = [...nouns];
		if (roleKey === "enigma") {
			if (!enigmaOk(front)) {
				return undefined;
			}
		} else if (roleKey === "bruiser") {
			if (!bruiserOk(front)) {
				return undefined;
			}
			nouns.push("strength");
		} else if (roleKey.startsWith("pos")) {
			if (roleKey !== POS_WORD[pos]) {
				return undefined;
			}
		} else if (SKILL_ROLE_NOUN.has(roleKey)) {
			// (archskill: a skill noun: the noun his skill takes now)
			const n = SKILL_ROLE_NOUN.get(roleKey)!;
			const head =
				skillNounOf(n, skillCtx) === roleKey
					? n
					: (Object.keys(SKILL_NOUNS) as NounKey[]).find(
							(k) =>
								k !== n &&
								familyOf(k) === familyOf(n) &&
								skillNounOf(k, skillCtx) === roleKey,
						);
			if (!head || (!nouns.includes(head) && !add(head))) {
				return undefined;
			}
		} else {
			const e = END_WORDS.find((w) => w.key === roleKey);
			if (!e || vetoed(ROLE_BY_KEY.get(e.key)?.names[0] ?? "")) {
				return undefined;
			}
			if (e.covers !== undefined && !nouns.includes(e.covers)) {
				if (!add(e.covers)) {
					return undefined;
				}
			}
			// (archfam: a 3-Level name is a Scorer by its 3-Level word: the user's "3-Level Scorer", "2-Way 3-Level Scorer")
			const tlScorer = e.key === "eScorer" && descKeys.includes("threeLevel");
			if (
				(!tlScorer && !e.ok(endCtxOf(nouns))) ||
				!(END_FITS[e.key]?.(nouns) ?? true)
			) {
				return undefined;
			}
		}
		// (2-Way with an offensive word: never a defensive word next to it, which 2-Way already says)
		if (
			tw &&
			(nouns.some((n) => DEF_NOUNS.has(n)) ||
				!nouns.some((n) => OFFENSE.has(n)))
		) {
			return undefined;
		}
		const uniq = [...new Set(nouns)];
		return uniq.length > 0 ? { nouns: uniq, tw } : undefined;
	};
	const nameOf = (
		role: string,
		descs: string[],
		pick: Record<string, string>,
	) =>
		composeName(
			ROLE_BY_KEY.get(role)!,
			descs.map((k) => DESC_BY_KEY.get(k)!),
			GROUP_OF[pos],
			pick,
		);
	const idOf = (role: string, descs: string[], pick: Record<string, string>) =>
		composedId(
			ROLE_BY_KEY.get(role)!,
			descs.map((k) => DESC_BY_KEY.get(k)!),
			GROUP_OF[pos],
			pick,
		);
	const pushComposed = (
		role: string,
		descs: string[],
		pick: Record<string, string>,
		keepId?: string,
		extra = 0,
	): boolean => {
		const skillNoun = SKILL_ROLE_NOUN.has(role);
		if (descs.length === 0 && !skillNoun) {
			return false;
		}
		const cn = composedNouns(role, descs);
		if (!cn) {
			return false;
		}
		const main = cn.nouns;
		// (archfam: at most MAX_PARTS skill words: 2-Way, each family named, offensive IQ; 3-Level is one)
		const parts =
			new Set(main.filter((n) => !ATH_KEYS.has(n)).map(familyOf)).size -
			(descs.includes("threeLevel") ? 1 : 0) +
			(cn.tw ? 1 : 0);
		if (parts > MAX_PARTS) {
			return false;
		}
		if (!listOk(main, { tw: cn.tw, oneWord: !descs.includes("threeLevel") })) {
			return false;
		}
		const name = nameOf(role, descs, pick);
		if (
			!wordsFit(name, pos, x.traits, pct.handle) ||
			!okName(name, main, cn.tw) ||
			(skillNoun && stemRepeat(name))
		) {
			return false;
		}
		push(
			{
				kind: "composed",
				descs,
				role: role as PosWord,
				nouns: main,
				pick,
				conf: confFor(main),
				...(keepId ? { keepId } : {}),
			},
			main,
			keepId ?? idOf(role, descs, pick),
			(role.startsWith("pos") ||
			role === "bruiser" ||
			role === "enigma" ||
			skillNoun
				? 0
				: FLAVOR) +
				(descs.includes("threeLevel") ? FLAVOR : 0) +
				extra,
			0,
			cn.tw,
		);
		return true;
	};
	// (the words of some front nouns; one noun gets a second word: a modifier, his trait keyword, or his length; 3PT and
	// finishing at the 3-Level bar are one word)
	const frontWords = (
		front: readonly NounKey[],
		tw = false,
		// (archskill: the front words of a skill-noun name: no trait keyword or length added)
		plain = false,
	): { descs: string[]; pick: Record<string, string> } => {
		const pick: Record<string, string> = {};
		if (
			!tw &&
			front.length === 2 &&
			front.includes("finish") &&
			front.includes("jump") &&
			pct.finish >= 0.85 &&
			pct.jump >= 0.85
		) {
			return { descs: ["highlightReel"], pick };
		}
		const tl =
			threeLevel &&
			front.includes("finish") &&
			front.some((n) => familyOf(n) === "three");
		const descs: string[] = [];
		for (const n of front) {
			if (tl && n === "finish") {
				continue;
			}
			descs.push(
				tl && familyOf(n) === "three"
					? "threeLevel"
					: // (next to shot creation, his handle is plain Ball-Handling, not a sub-rating's word: "Iso Ball-Handling")
						n === "handle" && front.includes("creator")
						? NOUN_DESC.handle.desc
						: descWord(n),
			);
		}
		if (tw) {
			descs.unshift("twoWay");
		} else if (front.length === 1 && !plain && !front.includes("length")) {
			const t = traitKeywordOf(x, pct, group);
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
		return { descs, pick };
	};
	// archskill: the skill-noun names of some front skills: each skill as the noun, the others as its front words (one
	// skill: its noun alone, SINGLE_NOUN_EDGE over his position word)
	const pushSkillNouns = (front: readonly NounKey[], tw: boolean) => {
		const sk = front.filter((n) => !ATH_KEYS.has(n) && n !== "crafty");
		if (sk.length === 0 || sk.length > 2) {
			return;
		}
		for (const head of sk) {
			const role = skillNounOf(head, skillCtx);
			if (!role) {
				continue;
			}
			const rest = front.filter((n) => n !== head);
			const fw =
				rest.length > 0
					? frontWords(rest, tw, true)
					: { descs: tw ? ["twoWay"] : [], pick: {} };
			pushComposed(
				role,
				fw.descs,
				fw.pick,
				undefined,
				sk.length === 1 && !tw ? SINGLE_NOUN_EDGE : 0,
			);
		}
	};
	const pushFront = (front: NounKey[], tw = false) => {
		const { descs, pick } = frontWords(front, tw);
		// (his position, then the first end word of his own that fits the front words, then each end word that says one
		// of his skills)
		pushComposed(POS_WORD[pos], descs, pick);
		if (enigmaOk(front)) {
			pushComposed("enigma", descs, pick);
		} else if (bruiserOk(front)) {
			pushComposed("bruiser", descs, pick);
		}
		pushSkillNouns(front, tw);
		// (a 3-Level name: Scorer first)
		let plain =
			descs.includes("threeLevel") && pushComposed("eScorer", descs, pick);
		for (const e of END_WORDS) {
			if (e.covers === undefined) {
				if (!plain && pushComposed(e.key, descs, pick)) {
					plain = true;
				}
			} else if (front.includes(e.covers)) {
				// (the end word says that noun: it leaves the front words)
				const rest = front.filter((n) => n !== e.covers);
				if (rest.length > 0) {
					const fw = frontWords(rest, tw);
					pushComposed(e.key, fw.descs, fw.pick);
				}
			} else if (
				front.length <= 2 &&
				rank(e.covers) < Infinity &&
				windowIndex(e.covers, tw) < TOP_N &&
				!front.some((n) => familyOf(n) === familyOf(e.covers!)) &&
				// (a third skill from the end word only in the front words' own domain: offense or defense)
				front.every((n) => DEF_NOUNS.has(n) === DEF_NOUNS.has(e.covers!))
			) {
				pushComposed(e.key, descs, pick);
			}
		}
	};

	// ---- the pick ----
	// archskill (reading 29): a player with no real skill, or one at low ovr, is named by his best skill (or his best two)
	// against the league and his position, whatever its standing: his skill families best first (each said by its own
	// word: a member names it with MID_EDGE over the head; steals and shot creation when higher), the second one named
	// when it may be named (its bar) and adds more than it costs (the coverage score's terms: its weight and standing over
	// SECOND_COST, against MISS_TOP2 for leaving it out), and a modifier at the word bar in front of a one-skill name. Only the words that are
	// no skill keep their promises here (his best is his best, however low).
	let skillPicked = false;
	// (the pick just pushed; a skill pick names his best skill by construction, so it counts as covering his top two: last
	// season's skill name, read again from the same ratings, stays)
	const skillCand = (): NounPick => {
		const c = cands.at(-1)!;
		c.pick.coversTop2 = true;
		c.top2 = true;
		return c.pick;
	};
	const skillPick = (): NounPick => {
		// (archaudit: a skill his position rules out, rim protection on a guard, ..., never names him: nouns.ts nounFitsPos)
		const heads = [
			...new Set(
				NOUNS.filter((n) => !ATH_KEYS.has(n) && n !== "crafty").map(familyOf),
			),
		].filter((h) => nounFitsPos(h, pos, pct.handle));
		const fams = heads
			.map((h) => {
				let rep = h;
				for (const m of familyMembers(h)) {
					// (a reading-29 member only from its own bar, as familyRep)
					if (NEW_NOUNS.has(m) && pct[m] < coverBar(m)) {
						continue;
					}
					const edge =
						(h === "handle" && m === "creator") ||
						(h === "perimD" && m === "steal")
							? 1e-9
							: NEW_NOUNS.has(m)
								? NEW_MEMBER_EDGE
								: MID_EDGE;
					if (m !== h && pct[m] >= pct[rep] + edge) {
						rep = m;
					}
				}
				const p = Math.max(...familyMembers(h).map((m) => pct[m]));
				return { rep, p };
			})
			.sort(
				(a, b) =>
					b.p - leadEdgeOf(b.rep) - (a.p - leadEdgeOf(a.rep)) ||
					NOUNS.indexOf(a.rep) - NOUNS.indexOf(b.rep),
			);
		const w = (p: number) => skillWeight(p) + p / 100;
		const [f1, f2] = fams;
		// archaudit: a skill name needs a skill: when even his best one is below SKILL_NAME_MIN (the league's and his
		// position group's median), he is named by his position alone ("Guard", "Wing", "Forward", "Big"), the modest
		// form, rather than by a skill he doesn't have
		if (!f1 || f1.p < SKILL_NAME_MIN) {
			skillPicked = true;
			const role = POS_WORD[pos];
			push(
				{
					kind: "composed",
					descs: [],
					role,
					nouns: [],
					pick: {},
					conf: confFor([]),
				},
				[],
				idOf(role, [], {}),
				0,
			);
			return skillCand();
		}
		// (a second skill only when it may be named: its bar, SKILL_BAR, "two modest skills")
		const pair =
			f2 !== undefined &&
			((pct[f2.rep] >= coverBar(f2.rep) &&
				w(f1!.p) + w(f2.p) - SECOND_COST >
					w(f1!.p) - MISS_TOP2 * skillWeight(f2.p)) ||
				f2.p >= PAIR_PCT);
		const modifier = athWord.find(
			(a) => skillNounOf(a, skillCtx) === undefined,
		);
		// (the names in order: the pair (his best skill as the noun first), then his best skill with a modifier, then each
		// one alone; the first whose words that are no skill keep their promises; else his best skill's plain noun)
		const tries: { head: NounKey; front: NounKey[] }[] = [];
		if (pair) {
			tries.push(
				{ head: f1!.rep, front: [f2.rep] },
				{ head: f2.rep, front: [f1!.rep] },
			);
		}
		if (modifier && f1) {
			tries.push({ head: f1.rep, front: [modifier] });
		}
		for (const f of fams.slice(0, pair ? 2 : 1)) {
			tries.push({ head: f.rep, front: [] });
		}
		const build = (
			t: { head: NounKey; front: NounKey[] },
			role: string,
			check: boolean,
		) => {
			const descs = t.front.map((n) =>
				ATH_KEYS.has(n) ? NOUN_DESC[n].desc : descWord(n),
			);
			const name = nameOf(role, descs, {});
			const main = [...t.front, t.head];
			if (
				check &&
				(vetoed(name) ||
					nameProblem(name) !== undefined ||
					stemRepeat(name) ||
					!wordsFit(name, pos, x.traits, pct.handle) ||
					coverPromises(name, main, ctx, true).length > 0)
			) {
				return undefined;
			}
			const pick: NounPick = {
				kind: "composed",
				descs,
				role: role as PosWord,
				nouns: main,
				pick: {},
				conf: confFor(main),
			};
			push(pick, main, idOf(role, descs, {}), 0);
			return skillCand();
		};
		skillPicked = true;
		for (const t of tries) {
			// (the noun his skill takes, else its plain noun)
			for (const role of new Set([
				skillNounOf(t.head, skillCtx),
				SKILL_NOUNS[t.head]?.at(-1)?.key,
			])) {
				const p = role ? build(t, role, true) : undefined;
				if (p) {
					return p;
				}
			}
		}
		// (his best skill's plain noun: always says him)
		const head = f1?.rep ?? "reb";
		const plainRole = SKILL_NOUNS[head]?.at(-1)?.key ?? "kRebounder";
		const descs: string[] = [];
		const main = [head];
		push(
			{
				kind: "composed",
				descs,
				role: plainRole as PosWord,
				nouns: main,
				pick: {},
				conf: confFor(main),
			},
			main,
			idOf(plainRole, descs, {}),
			0,
		);
		return skillCand();
	};
	const fresh = ((): NounPick => {
		// No real skill, or one at low ovr with no modifier at the word bar: his best skill (or two), skillPick
		if (
			nStrong === 0 ||
			(nStrong === 1 && ovr < ONE_NOUN_OVR && athWord.length === 0)
		) {
			return skillPick();
		}
		for (const c of CUSTOM_SPECIALS) {
			if (customOk(c)) {
				pushCustom(c);
			}
			if (customOk(c, true)) {
				pushCustom(c, true);
			}
		}
		if (jackOk()) {
			pushJack();
		}
		for (const sp of specialsAt(pos)) {
			if (specialOk(sp)) {
				pushSpecial(sp);
			}
		}
		// (his best skill alone, and with each other of his best TOP_N; one skill at low ovr names him only with a modifier
		// next to it)
		const repOf = (f: NounKey) => skills[fams.indexOf(f)]!;
		const top = topFams.map(repOf);
		const fronts: NounKey[][] =
			nStrong === 1 && ovr < ONE_NOUN_OVR ? [] : [[best!]];
		for (const k of top) {
			if (k !== best) {
				fronts.push([best!, k]);
			}
		}
		// (3-Level and one more of his best)
		const shootK = top.find((k) => familyOf(k) === "three");
		if (threeLevel && shootK && top.includes("finish")) {
			for (const k of top) {
				if (k !== shootK && k !== "finish" && !DEF_NOUNS.has(k)) {
					fronts.push([shootK, "finish", k]);
				}
			}
		}
		// (one skill: a modifier at the word bar as his second word)
		if (nStrong === 1) {
			for (const a of athWord) {
				fronts.push([best!, a]);
			}
		}
		for (const f of fronts) {
			pushFront(f);
		}
		// 2-Way names: his offensive skills among his best TOP_N, one or two of them (or 3-Level and one more), with 2-Way
		// saying his defense
		if (twoWay) {
			const off = windowOf(true)
				.slice(0, TOP_N)
				.map(repOf)
				.filter((k) => !DEF_NOUNS.has(k));
			const twFronts: NounKey[][] = [];
			off.forEach((k, i) => {
				if (k !== "crafty") {
					twFronts.push([k]);
				}
				for (const k2 of off.slice(i + 1)) {
					twFronts.push([k, k2]);
				}
			});
			const shootW = off.find((k) => familyOf(k) === "three");
			if (threeLevel && shootW && off.includes("finish")) {
				for (const k of off) {
					if (k !== shootW && k !== "finish") {
						twFronts.push([shootW, "finish", k]);
					}
				}
			}
			for (const f of twFronts) {
				pushFront(f, true);
			}
		}
		const c = bestOf(cands);
		return c ? c.pick : skillPick();
	})();

	debugHook?.(cands, scores);
	// ---- archcov stickiness: last season's label, re-checked ----
	const prevMain = prevMainOf(x, pos);
	if (!prevMain || skillPicked) {
		return settle(fresh);
	}
	const freshCand = cands.find((c) => c.pick === fresh) ?? bestOf(cands);
	const before = cands.length;
	switch (prevMain.kind) {
		case "custom":
			if (customOk(prevMain.c, !!prevMain.twoWay)) {
				pushCustom(prevMain.c, !!prevMain.twoWay);
			}
			break;
		case "jack":
			if (jackOk()) {
				pushJack();
			}
			break;
		case "special":
			if (specialOk(prevMain.sp)) {
				pushSpecial(prevMain.sp);
			}
			break;
		case "keyword":
			// (archskill: a trait name with no skill is not given any more)
			break;
		case "composed":
			pushComposed(
				prevMain.role,
				[...prevMain.descs],
				{ ...prevMain.pick },
				prevMain.id,
			);
			break;
	}
	const kept = cands.length > before ? cands.at(-1) : undefined;
	if (
		kept &&
		kept.top2 &&
		freshCand &&
		kept.score >= freshCand.score - STICK_COVER
	) {
		return settle(kept.pick, true);
	}
	return settle(fresh);

	// (why the name was chosen)
	function settle(q: NounPick, keptPrev = false): NounPick {
		const me = cands.find((c) => c.pick === q);
		const name = pickName(q);
		const runner = [...cands]
			.filter((c) => c !== me && pickName(c.pick) !== name)
			.sort((a, b) => b.score - a.score)[0];
		// (the skills the name says: its own, and with 2-Way his defensive skills among his best)
		const tw = me?.twoWay ?? false;
		const named = [
			...new Set([
				...(q.main ?? []),
				...(tw ? skills.filter((k) => DEF_NOUNS.has(k)) : []),
			]),
		];
		const top3 = realFams.slice(0, 3);
		const cov = coveredFams(q.main ?? [], tw);
		const fitDen = top3.reduce(
			(sum, f) => sum + skillWeight(famPct.get(f) ?? 0),
			0,
		);
		const fitNum = top3
			.filter((f) => cov.has(f))
			.reduce((sum, f) => sum + skillWeight(famPct.get(f) ?? 0), 0);
		const generic =
			q.kind === "trait" &&
			(q.key === "sJack" ||
				CUSTOM_SPECIALS.some((c) => c.key === q.key && c.anyBest));
		const r2 = (v: number) => Math.round(v * 100) / 100;
		return {
			...q,
			explain: {
				skills: named,
				pct: named.map((k) => Math.round(100 * pct[k])),
				weights: named.map((k) => r2(skillWeight(pct[k]))),
				gate: skillPicked
					? "skill name: his best skill (or two) against the league and his position (no real skill, or one at low ovr)"
					: q.kind === "honest"
						? "honest: no skill, or one at low ovr"
						: q.kind === "special"
							? "special name: its skills among his best four (families), his best covered"
							: q.kind === "composed"
								? tw
									? "noun name, 2-Way: his best skill and the skills that cover most, 2-Way for his defense"
									: "noun name: his best skill and the skills that cover most"
								: q.kind === "trait" && q.key === "sJack"
									? `Jack-Of-All-Trades: ${JACK_CLEARED} skills (families) at the ${Math.round(100 * JACK_FLAT)}th percentile`
									: generic
										? `many-skills name: at most ${FLAT_ELITE} skills at the ${Math.round(100 * ELITE_SKILL)}th (an elite name: ${MANY_ELITE} or more)`
										: "the user's own name or a trait name",
				variant: keptPrev
					? "kept from last season"
					: q.kind === "composed"
						? q.role.startsWith("pos")
							? "position"
							: SKILL_ROLE_NOUN.has(q.role)
								? "skill noun"
								: "end word"
						: q.kind,
				score: r2(me?.score ?? 0),
				fit: generic ? 1 : fitDen > 0 ? r2(fitNum / fitDen) : 1,
				...(runner
					? {
							runnerUp: {
								name: pickName(runner.pick),
								score: r2(runner.score),
							},
						}
					: {}),
			},
		};
	}
	// (a pick's display name, for the reason)
	function pickName(p: NounPick): string {
		return p.kind === "special" || p.kind === "trait"
			? p.name
			: p.kind === "composed"
				? (p.keepId && archetypeNameOf(p.keepId)) ||
					composeName(
						ROLE_BY_KEY.get(p.role)!,
						p.descs.map((k) => DESC_BY_KEY.get(k)!),
						GROUP_OF[pos],
						p.pick,
					)
				: "(honest name)";
	}
};

// (for reports: every candidate of the next reading, with its score)
let debugHook:
	| ((cs: readonly Cand[], skills: readonly CoverScore[]) => void)
	| undefined;
export const setCoverDebug = (
	f: ((cs: readonly Cand[], skills: readonly CoverScore[]) => void) | undefined,
) => {
	debugHook = f;
};
let finalHook: ((p: NounPick) => void) | undefined;
export const setCoverFinal = (f: ((p: NounPick) => void) | undefined) => {
	finalHook = f;
};
const bestOf = (cs: readonly Cand[]): Cand | undefined => {
	let out: Cand | undefined;
	for (const c of cs) {
		if (
			!out ||
			c.score > out.score + 1e-9 ||
			(Math.abs(c.score - out.score) <= 1e-9 &&
				(c.common < out.common ||
					(c.common === out.common && c.order < out.order)))
		) {
			out = c;
		}
	}
	return out;
};

// The engine's reading of a player's ratings: his name (re-exported so callers need one module)
export const pickNouns = pickCover;

// (for reports: his skills and modifiers as the coverage reading sees them)
export const coverReading = (
	r: ArchetypeRatings,
	pos: Pos,
	x: Partial<NounInput> = {},
) => {
	const scores = coverScores(r, pos, x.rq, x.ng);
	return {
		scores,
		skills: coverSkills(scores).map((s) => s.key),
		ath: scores
			.filter((s) => ATH_KEYS.has(s.key) && s.pct >= ATH_LEAD_BAR)
			.map((s) => s.key),
	};
};
export type { CoverScore };
