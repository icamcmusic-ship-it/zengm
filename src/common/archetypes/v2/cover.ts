// archcov (the user's 2064 audit, his proposed redesign): a player's name is the catalog name that covers the most of
// his real strengths.
// 1. Each skill is read against the league and against his position group, its standing the lower of the two
//    (nouns.ts coverScores): a skill counts only when it is good outright and good for his position.
// 2. Speed, leaping and strength are modifiers: they lead a name only when no basketball skill clears, and else add at
//    most a word next to one.
// 3. Every candidate name (a special name, the user's own names, Jack-Of-All-Trades, a noun name: front words and an
//    end word) is scored by how much of his strengths it covers (with the defensive tag): it must name his best skill,
//    and leaving out one of his top two, or a strong one, costs heavily. The best-covering name wins (a star gets a
//    combination name), a near tie going to the rarer name, never to chance.
// 4. A noun name's end word is picked after its front words, and only one that fits them (a Gunner names a jumper).
// 5. Last season's label is re-checked every season: kept only while every rule still holds (its skills among his best
//    TOP_N, his best one named) and it covers about as much as this season's pick. Honest and development names are
//    never kept once outgrown (the engine keeps an honest name's words only for the same kind of honest name).
// 6. Every name's promises come from its own skill list (nouns.ts coverPromises), and the defensive tag follows one
//    rule: a defensive skill at DEF_TAG_PCT (or his second best) that his main name doesn't name.
import type { ArchetypeRatings, Pos } from "../types.ts";
import {
	composedId,
	composeName,
	DESC_BY_KEY,
	GROUP_OF,
	isComposedId,
	parseComposedId,
	ROLE_BY_KEY,
	type PosGroup,
} from "./grammar.ts";
import { hasUpside, isHonestKey } from "./honest.ts";
import { archetypeById } from "../classify.ts";

const archetypeNameOf = (id: string) => archetypeById(id)?.name;
import {
	ATH_KEYS,
	ATH_LEAD_BAR,
	ATH_WORD_BAR,
	CUSTOM_SPECIALS,
	DEF_NOUNS,
	DEF_TAG_PCT,
	DEV_MAX_OVR,
	ELITE_PCT,
	END_WORDS,
	GENERIC_PCT,
	HONEST_NOUNS,
	JACK_CLEARED,
	JACK_NAME,
	NOUN_DESC,
	NOUNS,
	ONE_NOUN_OVR,
	OFFENSE,
	POS_WORD,
	REJECT_NEAR,
	SPREAD_PEN,
	STICK_BOOST,
	STRONG_BAR,
	STANDOUT_PCT,
	SUB_WORD,
	TOP_N,
	TRAIT_KEYWORDS,
	TRAIT_WORD_MIN,
	connector,
	defLabelNouns,
	coverCtxOf,
	coverPromises,
	coverScores,
	coverSkills,
	eliteOvrOf,
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
	sub,
	tieFavored,
	traitKeywordOf,
	twoWayOk,
	wordsFit,
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
} from "./nouns.ts";

// Leaving out one of his top two skills (the defensive tag counts) costs this much coverage
export const MISS_TOP2 = 2;
// A second skill named costs this much (it is named from about the 66th percentile), each beyond two this much (from
// about the 72nd), so a skill earns its word smoothly, with no cliff
export const SECOND_COST = 0.3;
export const EXTRA_COST = 0.6;
// A defensive skill the tag names counts this much of being in the main name
export const TAG_COVER = 0.9;
// A many-skills name (Jack-Of-All-Trades, the user's anyBest names) covers each of his skills this much
export const GENERIC_COVER = 0.48;
// Jack-Of-All-Trades: his TOP_N-th skill at this standing (many good skills, none far above the rest)
export const JACK_FLAT = 0.85;
// A special name, or an end word of his own, over a plain noun name that covers the same
const FLAVOR = 0.05;
// archcov: last season's label stays unless this season's pick covers clearly more (the user: "only switch if the new
// name beats the current one by a clear margin")
export const STICK_COVER = 0.1;
// archcov (the user: smooth skill scoring, no cliff): a skill's weight ramps from nothing at the 60th percentile (the
// lower of league and position) to full at the 80th
export const RAMP_LO = 0.6;
export const RAMP_HI = 0.8;
export const skillWeight = (pct: number) =>
	Math.max(0, Math.min(1, (pct - RAMP_LO) / (RAMP_HI - RAMP_LO)));

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
const pickCoverTies = (x: NounInput): NounPick => {
	const a = pickCoverOnce(x);
	const prevId = x.prev?.id;
	if (x.tie === false || prevId === undefined) {
		return a;
	}
	const pc = isComposedId(prevId) ? parseComposedId(prevId) : undefined;
	// archcov hysteresis: last season's honest name holds while he is still honest with every standing STICK_BOOST lower
	// (a second skill must clear by a margin before it names him)
	if (pc && isHonestKey(pc.role.key)) {
		const about = HONEST_NOUNS[pc.role.key] ?? [];
		const same = (p: NounPick) =>
			p.kind === "honest" && about.includes(p.noun ?? "none");
		if (same(a)) {
			return a;
		}
		for (const slack of [-STICK_BOOST, STICK_BOOST]) {
			const h = pickCoverOnce({ ...x, slack });
			if (same(h)) {
				return { ...keptVariant(h), slack };
			}
		}
		return a;
	}
	const pd = x.prev?.defense;
	// (his defensive tag: last season's, or none, while that still holds with the slack)
	const tagged = (p: NounPick): NounPick => {
		if (p.defense === pd || p.main?.some((n) => DEF_NOUNS.has(n))) {
			return p;
		}
		const t = pickCoverOnce({
			...x,
			slack: pd ? STICK_BOOST : -STICK_BOOST,
		});
		if (t.defense !== pd) {
			return p;
		}
		if (pd) {
			return { ...p, defense: pd };
		}
		const { defense: _drop, ...rest } = p;
		return rest as NounPick;
	};
	if (pickIdOf(a, x.pos) === prevId) {
		return tagged(a);
	}
	// (last season's name still qualifies with the slack, and covers about as much)
	// (with every standing STICK_BOOST higher, then lower: a bar he must reach, or one he must stay under)
	for (const slack of [STICK_BOOST, -STICK_BOOST]) {
		const k = pickCoverOnce({ ...x, slack });
		if (pickIdOf(k, x.pos) === prevId) {
			return { ...tagged(keptVariant(k)), slack };
		}
	}
	const b = pickCoverOnce({ ...x, tie: false });
	return pickIdOf(b, x.pos) === prevId ? tagged({ ...b, tie: false }) : a;
};
const keptVariant = (p: NounPick): NounPick =>
	p.explain
		? { ...p, explain: { ...p.explain, variant: "kept from last season" } }
		: p;
const pickCoverOnce = (x: NounInput): NounPick => {
	const { r, pos, rq } = x;
	const group: PosGroup = groupOfPos(pos);
	const favored = tieFavored(x);
	const scores = coverScores(r, pos, rq, x.ng, x.slack);
	const pct = Object.fromEntries(scores.map((s) => [s.key, s.pct])) as Record<
		NounKey,
		number
	>;
	const skillsS = coverSkills(scores, favored);
	const skills = skillsS.map((s) => s.key);
	const ctx: CoverCtx = coverCtxOf(x);
	// (his real skills: the honest names, the one-skill rule and the athletic lead read these)
	const nStrong = ctx.strong.length;
	const ath = ctx.ath;
	const athWord = ath.filter((a) => pct[a] >= ATH_WORD_BAR);
	const eliteOvr = eliteOvrOf(x.ovr, rq);
	const isMobile = mobile(r, rq);
	const isElite = (k: NounKey) =>
		eliteOvr && pct[k] >= ELITE_PCT && (k !== "perimD" || isMobile);
	const twoWay = twoWayOk(r, rq);
	const long = isLong(r);
	const ovr = x.ovr ?? 99;
	const young = hasUpside(x) && ovr <= DEV_MAX_OVR;
	const rank = (k: NounKey) => skillRank(ctx, k);
	const best = skills[0];

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
			for (const k of NOUNS) {
				const v = rj.pct[k];
				if (v !== undefined) {
					s += Math.abs(v - leaguePct[k]);
					n++;
				}
			}
			return n > 0 && s / n <= REJECT_NEAR;
		});
	const okName = (name: string, list: readonly NounKey[]) =>
		!vetoed(name) &&
		!nameProblem(name) &&
		coverPromises(name, list, ctx).length === 0;
	const common = (id: string | undefined) =>
		id === undefined ? 0 : (x.common?.[id] ?? 0);

	// ---- the defensive tag: a defensive skill at DEF_TAG_PCT, or his second best, that the main name doesn't name ----
	const trv = (k: string) => x.traits?.[k] ?? -Infinity;
	const switchOk = trv("defensiveVersatility") >= 55;
	const pestOk = trv("hustle") >= 55;
	const rimLead = leadSub(r, ["blk", "idf"]);
	const latPct = pctOf("spd", sub(r, "lat") ?? r.spd, rq);
	// (the user's rule reads the league's 85th percentile; the skill must still clear for his position)
	// (hysteresis: a skill last season's tag named keeps it from STICK_BOOST lower; with no tag last season, a new one
	// needs STICK_BOOST more)
	const prevTagNouns = x.prev?.defense ? defLabelNouns(x.prev.defense) : [];
	const tagBar = (k: NounKey) =>
		x.prev?.id === undefined
			? DEF_TAG_PCT
			: prevTagNouns.includes(k)
				? DEF_TAG_PCT - STICK_BOOST
				: x.prev.defense
					? DEF_TAG_PCT
					: DEF_TAG_PCT + STICK_BOOST;
	const tagList = skillsS.filter(
		(s) =>
			DEF_NOUNS.has(s.key) &&
			(s.league >= tagBar(s.key) || (rank(s.key) <= 1 && s.pct >= STRONG_BAR)),
	);
	const hasTag = (k: NounKey) => tagList.find((s) => s.key === k);
	const rim = hasTag("rimD");
	const per = hasTag("perimD");
	const stl = hasTag("steal");
	const stalkerOk =
		!!per &&
		per.pct >= 0.8 &&
		Math.max(x.traits?.motor ?? 0, x.traits?.hustle ?? 0) >= 65;
	const menaceOk =
		!!stl &&
		stl.pct >= 0.85 &&
		(trv("competitiveness") >= TRAIT_WORD_MIN ||
			trv("motor") >= TRAIT_WORD_MIN ||
			trv("hustle") >= TRAIT_WORD_MIN);
	// (what each defensive label says, and what it needs beyond its skills)
	const DEF_BASE: Record<string, { nouns: NounKey[]; ok: () => boolean }> = {
		"Help-Side Roamer": {
			nouns: ["rimD", "steal"],
			ok: () => group !== "big" && rim!.pct >= 0.8 && stl!.pct >= 0.8,
		},
		"Switch Defender": {
			nouns: ["rimD", "perimD"],
			ok: () => rim!.pct >= 0.8 && per!.pct >= 0.8 && switchOk,
		},
		"Swatting Guard": {
			nouns: ["rimD"],
			ok: () => group === "guard" && rim!.pct >= 0.85,
		},
		"Shot Eraser": { nouns: ["rimD"], ok: () => isElite("rimD") },
		"Shot Blocker": {
			nouns: ["rimD"],
			ok: () => !isElite("rimD") && rimLead !== "idf",
		},
		"Post Defender": {
			nouns: ["rimD"],
			ok: () => !isElite("rimD") && rimLead !== "blk",
		},
		"Rim Protector": { nouns: ["rimD"], ok: () => !isElite("rimD") },
		"Perimeter Stalker": { nouns: ["perimD"], ok: () => stalkerOk },
		"Point-of-Attack Pest": {
			nouns: ["perimD", "steal"],
			ok: () => pestOk && Math.max(per!.pct, stl!.pct) >= 0.85,
		},
		Pest: { nouns: ["perimD", "steal"], ok: () => pestOk },
		"Lockdown Defender": { nouns: ["perimD"], ok: () => isElite("perimD") },
		"Cerebral Defender": {
			nouns: ["perimD"],
			ok: () => !isElite("perimD") && eliteOvr && per!.pct >= ELITE_PCT,
		},
		"On-Ball Stopper": {
			nouns: ["perimD"],
			ok: () => !isElite("perimD") && latPct >= 0.7,
		},
		"Perimeter Defender": {
			nouns: ["perimD"],
			ok: () => !isElite("perimD"),
		},
		"Ball-Hawking Menace": { nouns: ["steal"], ok: () => menaceOk },
		"Passing-Lane Interceptor": {
			nouns: ["steal"],
			ok: () => stl!.pct >= 0.85 && (sub(r, "stl") ?? 0) > (sub(r, "pdf") ?? 0),
		},
		"Ball Hawk": { nouns: ["steal"], ok: () => true },
	};
	const defBaseOf = (name: string) => {
		let base = name;
		let prefix: "long" | "switchable" | undefined;
		if (base.startsWith("Long ")) {
			prefix = "long";
			base = base.slice("Long ".length);
		} else if (base.startsWith("Switchable ")) {
			prefix = "switchable";
			base = base.slice("Switchable ".length);
		}
		const d = DEF_BASE[base];
		return d ? { ...d, base, prefix } : undefined;
	};
	// (a defensive label he may have: its skills among the ones that give a tag, its own test, its prefix's, and every
	// word's promise)
	const defOk = (name: string): boolean => {
		const d = defBaseOf(name);
		if (
			!d ||
			!d.nouns.every((n) => tagList.some((s) => s.key === n)) ||
			!d.ok() ||
			(d.prefix === "long" && (!long || /Lockdown|Eraser/.test(d.base))) ||
			(d.prefix === "switchable" &&
				(trv("defensiveVersatility") < TRAIT_WORD_MIN ||
					d.base === "Switch Defender"))
		) {
			return false;
		}
		// (its skills were read by the tag's own rule: the rest of its words keep their promises)
		return (
			!vetoed(name) && coverPromises(name, d.nouns, ctx, true).length === 0
		);
	};
	// His tag for a main name: none when the main name names a defensive skill, or no defensive skill gives one
	const tagFor = (
		main: readonly NounKey[],
	): { label: string; nouns: NounKey[] } | undefined => {
		if (tagList.length === 0 || main.some((n) => DEF_NOUNS.has(n))) {
			return undefined;
		}
		const order: string[] = [];
		if (rim && stl && group !== "big" && rim.pct >= 0.8 && stl.pct >= 0.8) {
			order.push("Help-Side Roamer");
		}
		if (rim && per && rim.pct >= 0.8 && per.pct >= 0.8 && switchOk) {
			order.push("Switch Defender");
		}
		if (rim && group === "guard" && rim.pct >= 0.85) {
			order.push("Swatting Guard");
		}
		const rimFirst =
			rim && (!per || rim.pct >= per.pct) && (!stl || rim.pct >= stl.pct);
		const rimNames = rim
			? isElite("rimD")
				? ["Shot Eraser"]
				: rimLead === "blk"
					? ["Shot Blocker"]
					: rimLead === "idf"
						? ["Post Defender"]
						: ["Rim Protector"]
			: [];
		if (rimFirst) {
			order.push(...rimNames);
		}
		if (stalkerOk) {
			order.push("Perimeter Stalker");
		}
		if (per && stl && pestOk) {
			order.push(
				per.pct < 0.85 && stl.pct < 0.85 ? "Pest" : "Point-of-Attack Pest",
			);
		}
		const perName = per
			? isElite("perimD")
				? "Lockdown Defender"
				: eliteOvr && per.pct >= ELITE_PCT
					? "Cerebral Defender"
					: latPct >= 0.7
						? "On-Ball Stopper"
						: "Perimeter Defender"
			: undefined;
		const stlName = stl
			? menaceOk
				? "Ball-Hawking Menace"
				: stl.pct >= 0.85 && (sub(r, "stl") ?? 0) > (sub(r, "pdf") ?? 0)
					? "Passing-Lane Interceptor"
					: "Ball Hawk"
			: undefined;
		if (perName && (!stl || per!.pct >= stl.pct)) {
			order.push(perName);
		}
		if (stlName) {
			order.push(stlName);
		}
		if (perName) {
			order.push(perName);
		}
		order.push(...rimNames);
		// (the label that says the most of his defense: his best defensive skills first; a tie goes to the order above)
		let out: { label: string; nouns: NounKey[] } | undefined;
		let outScore = -Infinity;
		for (const base of order) {
			let n = base;
			if (long && !/Lockdown|Eraser/.test(n)) {
				n = `Long ${n}`;
			} else if (
				trv("defensiveVersatility") >= TRAIT_WORD_MIN &&
				n !== "Switch Defender"
			) {
				n = `Switchable ${n}`;
			}
			const label = [n, base].find(defOk);
			if (label) {
				const nouns = DEF_BASE[base]!.nouns;
				const sc = nouns.reduce(
					(sum, k) =>
						sum + (skillWeight(pct[k]) + pct[k] / 10) * (rank(k) <= 1 ? 2 : 1),
					0,
				);
				if (sc > outScore + 1e-9) {
					out = { label, nouns };
					outScore = sc;
				}
			}
		}
		return out;
	};

	// ---- how much of his strengths a main name (with its tag) covers: his best TOP_N skills, each by how far it stands
	// above the league's middle; a third skill named costs a little (a long name has to earn it) ----
	const coverOf = (main: readonly NounKey[], generic = 0): number => {
		// (a many-skills name covers by its breadth alone: its tag adds nothing to that)
		const tag = generic > 0 ? undefined : tagFor(main);
		let s = 0;
		skills.slice(0, TOP_N).forEach((k, i) => {
			const c = Math.max(
				main.includes(k) ? 1 : tag?.nouns.includes(k) ? TAG_COVER : 0,
				generic,
			);
			// (the weight, and a hair of the standing itself so two full-weight skills still order)
			s += (skillWeight(pct[k]) + pct[k] / 100) * c;
			// (leaving out one of his top two costs in proportion to that skill's weight)
			if (c === 0 && i <= 1) {
				s -= MISS_TOP2 * skillWeight(pct[k]);
			}
		});
		// (a many-skills name claims as much as two named skills; handle and shot creation named together say much the
		// same thing, so the second counts half)
		const named = generic > 0 ? 2 : main.filter((n) => !ATH_KEYS.has(n)).length;
		if (main.includes("handle") && main.includes("creator")) {
			s -= 0.5 * Math.min(skillWeight(pct.handle), skillWeight(pct.creator));
		}
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
	// Whether a main name's skills may name him: each among his best TOP_N, his best one named (else, with no skill, an
	// athletic lead), no modifier alone next to a skill
	const listOk = (list: readonly NounKey[], anyBest = false): boolean => {
		const skillN = list.filter((n) => !ATH_KEYS.has(n));
		if (nStrong > 0) {
			if (skillN.length === 0) {
				return false;
			}
			// (re-checking last season's label: a skill within STICK_BOOST of his TOP_N-th, or of his best, still counts)
			const tol = (x.slack ?? 0) > 0 ? STICK_BOOST : 0;
			const nth = skills[TOP_N - 1];
			const inTop = (n: NounKey) =>
				rank(n) < TOP_N ||
				(tol > 0 &&
					rank(n) < Infinity &&
					nth !== undefined &&
					pct[n] >= pct[nth] - tol);
			if (!skillN.every(inTop)) {
				return false;
			}
			if (
				!anyBest &&
				Math.min(...skillN.map(rank)) !== 0 &&
				!(tol > 0 && Math.max(...skillN.map((n) => pct[n])) >= pct[best!] - tol)
			) {
				return false;
			}
			return list
				.filter((n) => ATH_KEYS.has(n))
				.every((n) => pct[n] >= ATH_WORD_BAR);
		}
		return (
			skillN.length === 0 &&
			list.length > 0 &&
			list.every((n) => pct[n] >= ATH_LEAD_BAR)
		);
	};

	const withTag = (p: NounPick, main: readonly NounKey[]): NounPick => {
		const t = tagFor(main);
		return t ? { ...p, defense: t.label } : p;
	};
	const confFor = (main: readonly NounKey[]) => {
		const named = main.filter((n) => !ATH_KEYS.has(n));
		const ps = named.map((n) => pct[n]);
		if (ps.length === 0) {
			return 0.5;
		}
		const low = Math.min(...ps);
		const nextKey = skills.find((k) => !named.includes(k));
		const next = nextKey === undefined ? 0.6 : pct[nextKey];
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
	) => {
		cands.push({
			pick: withTag({ ...pick, main }, main),
			main,
			score: coverOf(main, generic) + bonus - SPREAD_PEN * common(id),
			common: common(id),
			order: order++,
		});
	};

	// The user's own special names (their tests read the standings against league and position)
	const customCtx: SpecialCtx = {
		pos,
		ovrPct: x.ovr === undefined ? 0 : pctOf("ovr", x.ovr, rq),
		pct,
		r,
		traits: x.traits,
		eliteOvr,
		ovr: x.ovr ?? 0,
		best,
	};
	const customName = (c: CustomSpecial) =>
		composeName(ROLE_BY_KEY.get(c.key)!, [], GROUP_OF[pos]);
	const customOk = (c: CustomSpecial): boolean => {
		if (young && nStrong <= 1) {
			return false;
		}
		if (!c.positions.includes(pos) || !c.test(customCtx)) {
			return false;
		}
		if (c.anyBest) {
			if (nStrong < 3 || (best && pct[best] >= STANDOUT_PCT)) {
				return false;
			}
		} else if (!listOk(c.nouns)) {
			return false;
		}
		if (c.nouns.length <= 1 && ovr < ONE_NOUN_OVR && nStrong < 2) {
			return false;
		}
		return okName(customName(c), c.anyBest ? [] : c.nouns);
	};
	const customPick = (c: CustomSpecial): NounPick => ({
		kind: "trait",
		key: c.key,
		name: customName(c),
		conf: confFor(c.nouns),
	});
	const customId = (c: CustomSpecial) =>
		composedId(ROLE_BY_KEY.get(c.key)!, [], GROUP_OF[pos]);
	const pushCustom = (c: CustomSpecial) =>
		push(
			customPick(c),
			c.nouns,
			customId(c),
			FLAVOR,
			c.anyBest ? GENERIC_COVER : 0,
		);

	// Jack-Of-All-Trades: JACK_CLEARED skills or more
	const jackOk = () =>
		!young &&
		nStrong >= JACK_CLEARED &&
		// (many good skills, none a standout: with his best in the top 7%, a name about it)
		pct[best!] < STANDOUT_PCT &&
		pct[skills[JACK_CLEARED - 1]!] >= JACK_FLAT &&
		ovr >= 45 &&
		okName(JACK_NAME, []);
	const jackId = composedId(ROLE_BY_KEY.get("sJack")!, [], GROUP_OF[pos]);
	const pushJack = () =>
		push(
			{ kind: "trait", key: "sJack", name: JACK_NAME, conf: 0.6 },
			// (it names no skill of its own: it covers each of them a little)
			[],
			jackId,
			FLAVOR,
			GENERIC_COVER,
		);

	// Special names (builds): every skill among his best, his best one named, modifiers at the word bar
	const specialMain = (sp: Special): NounKey[] => {
		const main = [...sp.nouns];
		if (sp.twoWay) {
			const d = (["perimD", "rimD"] as const).find((n) => skills.includes(n));
			if (d && !main.includes(d)) {
				main.push(d);
			}
		}
		return main;
	};
	const specialOk = (sp: Special): boolean => {
		if (young && nStrong <= 1) {
			return false;
		}
		if (sp.twoWay && !twoWay) {
			return false;
		}
		const main = specialMain(sp);
		if (!listOk(main)) {
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
		return wordsFit(sp.name, pos, x.traits) && okName(sp.name, sp.nouns);
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
			FLAVOR,
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
		pct.strength >= ATH_WORD_BAR &&
		front.some(
			(n) =>
				PHYSICAL.has(n) &&
				(n !== "finish" || leadSub(r, ["con", "fns"]) !== "fns"),
		);
	const enigmaOk = (front: readonly NounKey[]) =>
		enigma && front.some((n) => CREATIVE.has(n));
	// (a front noun's word: its elite word while he is elite, the sub-rating word, the plain word)
	const descWord = (n: NounKey) => nounWord(n, isElite(n), group, r);
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
	// (a noun name, read word by word: its nouns, or undefined when a word no longer says him)
	const composedNouns = (
		roleKey: string,
		descKeys: readonly string[],
	): NounKey[] | undefined => {
		const nouns: NounKey[] = [];
		for (const d of descKeys) {
			if (d === "long") {
				if (!long) {
					return undefined;
				}
			} else if (d === "highlightReel") {
				if (pct.jump < 0.85 || pct.finish < 0.85) {
					return undefined;
				}
				nouns.push("finish", "jump");
			} else if (d === "twoWay") {
				const dn = (["perimD", "rimD"] as const).find((n) =>
					skills.includes(n),
				);
				if (!twoWay || !dn) {
					return undefined;
				}
				nouns.push(dn);
			} else {
				const tk = TRAIT_KEYWORDS.find((t) => t.desc === d);
				if (tk) {
					if (tk.over(x, pct, group) < 0) {
						return undefined;
					}
					continue;
				}
				const n = nounOfDesc(d);
				if (!n || !descWordOk(n, d)) {
					return undefined;
				}
				nouns.push(n);
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
		} else {
			const e = END_WORDS.find((w) => w.key === roleKey);
			if (!e || vetoed(ROLE_BY_KEY.get(e.key)?.names[0] ?? "")) {
				return undefined;
			}
			if (e.covers !== undefined && !nouns.includes(e.covers)) {
				nouns.push(e.covers);
			}
			if (!e.ok(endCtxOf(nouns)) || !(END_FITS[e.key]?.(nouns) ?? true)) {
				return undefined;
			}
		}
		const uniq = [...new Set(nouns)];
		return uniq.length > 0 ? uniq : undefined;
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
	): boolean => {
		if (descs.length === 0) {
			return false;
		}
		const main = composedNouns(role, descs);
		if (!main || !listOk(main)) {
			return false;
		}
		const name = nameOf(role, descs, pick);
		if (!okName(name, main)) {
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
			role.startsWith("pos") || role === "bruiser" || role === "enigma"
				? 0
				: FLAVOR,
		);
		return true;
	};
	// (the words of some front nouns; one noun gets a second word: a modifier, his trait keyword, or his length)
	const frontWords = (
		front: readonly NounKey[],
	): { descs: string[]; pick: Record<string, string> } => {
		const pick: Record<string, string> = {};
		if (
			front.length === 2 &&
			front.includes("finish") &&
			front.includes("jump") &&
			pct.finish >= 0.85 &&
			pct.jump >= 0.85
		) {
			return { descs: ["highlightReel"], pick };
		}
		const hasOff = front.some((n) => OFFENSE.has(n));
		const descs = front.map((n) =>
			n === "perimD" && twoWay && hasOff && !isElite(n)
				? "twoWay"
				: // (next to shot creation, his handle is plain Ball-Handling, not a sub-rating's word: "Iso Ball-Handling")
					n === "handle" && front.includes("creator")
					? NOUN_DESC.handle.desc
					: descWord(n),
		);
		if (front.length === 1) {
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
	const pushFront = (front: NounKey[]) => {
		const { descs, pick } = frontWords(front);
		// (his position, then the first end word of his own that fits the front words, then each end word that says one
		// of his skills)
		pushComposed(POS_WORD[pos], descs, pick);
		if (enigmaOk(front)) {
			pushComposed("enigma", descs, pick);
		} else if (bruiserOk(front)) {
			pushComposed("bruiser", descs, pick);
		}
		let plain = false;
		for (const e of END_WORDS) {
			if (e.covers === undefined) {
				if (!plain && pushComposed(e.key, descs, pick)) {
					plain = true;
				}
			} else if (front.includes(e.covers)) {
				// (the end word says that noun: it leaves the front words)
				const rest = front.filter((n) => n !== e.covers);
				if (rest.length > 0) {
					const fw = frontWords(rest);
					pushComposed(e.key, fw.descs, fw.pick);
				}
			} else if (
				front.length <= 2 &&
				rank(e.covers) < TOP_N &&
				// (a third skill from the end word only in the front words' own domain: offense or defense)
				front.every((n) => DEF_NOUNS.has(n) === DEF_NOUNS.has(e.covers!))
			) {
				pushComposed(e.key, descs, pick);
			}
		}
	};

	// ---- the pick ----
	const honest = (noun: NounKey | undefined, conf: number): NounPick => ({
		kind: "honest",
		...(noun ? { noun } : {}),
		conf,
		main: noun ? [noun] : [],
	});
	const fresh = ((): NounPick => {
		// A young player with upside at ovr DEV_MAX_OVR or below and one skill at most: a development name
		if (young && nStrong <= 1) {
			return honest(skills[0] ?? ath[0], 0.8);
		}
		// No basketball skill: two athletic nouns lead a name; else his trait keyword, else an honest name
		if (nStrong === 0) {
			if (ath.length >= 2) {
				for (const front of [ath.slice(0, 2), [ath[0]!, ath[2]!]]) {
					if (front[1] !== undefined) {
						pushFront(front);
					}
				}
				const c = bestOf(cands);
				if (c) {
					return c.pick;
				}
			}
			const t = traitKeywordOf(x, pct, group);
			const role = t ? ROLE_BY_KEY.get(t.role) : ROLE_BY_KEY.get("tConnector");
			if (role && (t || connector(pct))) {
				const i = Math.min(t?.variant?.(x) ?? 0, role.names.length - 1);
				const name = role.names[i]!;
				if (!vetoed(name) && okName(name, [])) {
					return { kind: "trait", key: role.key, name, conf: 0.6 };
				}
			}
			const near = scores.find(
				(s) =>
					!ATH_KEYS.has(s.key) && s.key !== "crafty" && s.pct >= GENERIC_PCT,
			);
			return honest(ath[0] ?? near?.key, ath[0] ? 0.7 : near ? 0.55 : 0.8);
		}
		// One skill at low ovr: a specialist's honest name (unless a modifier at the word bar makes a two-word name)
		if (nStrong === 1 && ovr < ONE_NOUN_OVR && athWord.length === 0) {
			return honest(best, 0.7);
		}
		for (const c of CUSTOM_SPECIALS) {
			if (customOk(c)) {
				pushCustom(c);
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
		// (one skill at low ovr names him only with a modifier next to it)
		const fronts: NounKey[][] =
			nStrong === 1 && ovr < ONE_NOUN_OVR ? [] : [[best!]];
		for (let j = 1; j < Math.min(TOP_N, skills.length); j++) {
			fronts.push([best!, skills[j]!]);
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
		const c = bestOf(cands);
		return c ? c.pick : honest(best, 0.5);
	})();

	debugHook?.(cands, scores);
	// ---- archcov stickiness: last season's label, re-checked ----
	const prevMain = prevMainOf(x, pos);
	if (!prevMain || fresh.kind === "honest") {
		return settleTag(fresh);
	}
	const freshCand = cands.find((c) => c.pick === fresh) ?? bestOf(cands);
	const before = cands.length;
	switch (prevMain.kind) {
		case "custom":
			if (customOk(prevMain.c)) {
				pushCustom(prevMain.c);
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
		case "keyword": {
			if (fresh.kind === "trait" && nStrong === 0) {
				const role = ROLE_BY_KEY.get(prevMain.role);
				const ok =
					role !== undefined &&
					role.names.includes(prevMain.name) &&
					(prevMain.role === "tConnector"
						? connector(pct)
						: TRAIT_KEYWORDS.some(
								(t) => t.role === prevMain.role && t.over(x, pct, group) >= 0,
							)) &&
					okName(prevMain.name, []);
				if (ok) {
					return settleTag({
						kind: "trait",
						key: prevMain.role,
						name: prevMain.name,
						conf: 0.6,
					});
				}
			}
			break;
		}
		case "composed":
			if (!(young && nStrong <= 1)) {
				pushComposed(
					prevMain.role,
					[...prevMain.descs],
					{ ...prevMain.pick },
					prevMain.id,
				);
			}
			break;
	}
	const kept = cands.length > before ? cands.at(-1) : undefined;
	if (kept && freshCand && kept.score >= freshCand.score - STICK_COVER) {
		return settleTag(kept.pick, true);
	}
	return settleTag(fresh);

	// (his defensive tag: last season's while it still holds, in place of this season's; and why the name was chosen)
	function settleTag(p: NounPick, keptPrev = false): NounPick {
		const pd = x.prev?.defense;
		const q =
			p.defense && pd && pd !== p.defense && defOk(pd)
				? { ...p, defense: pd }
				: p;
		const me = cands.find((c) => c.pick === p);
		const name = pickName(q);
		const runner = [...cands]
			.filter((c) => c !== me && pickName(c.pick) !== name)
			.sort((a, b) => b.score - a.score)[0];
		const named = [
			...new Set([
				...(q.main ?? []),
				...(q.defense ? defLabelNouns(q.defense) : []),
			]),
		];
		const top3 = skills.slice(0, 3);
		const fitDen = top3.reduce((sum, k) => sum + skillWeight(pct[k]), 0);
		const fitNum = top3
			.filter((k) => named.includes(k))
			.reduce((sum, k) => sum + skillWeight(pct[k]), 0);
		const r2 = (v: number) => Math.round(v * 100) / 100;
		return {
			...q,
			explain: {
				skills: named,
				pct: named.map((k) => Math.round(100 * pct[k])),
				weights: named.map((k) => r2(skillWeight(pct[k]))),
				gate:
					q.kind === "honest"
						? "honest: no skill, or one at low ovr"
						: q.kind === "special"
							? "special name: its skills among his best four, his best named"
							: q.kind === "composed"
								? "noun name: his best skill and the skills that cover most"
								: q.kind === "trait" && q.key === "sJack"
									? "Jack-Of-All-Trades: four skills at the 80th percentile"
									: "the user's own name or a trait name",
				variant: keptPrev
					? "kept from last season"
					: q.kind === "composed"
						? q.role.startsWith("pos")
							? "position"
							: "end word"
						: q.kind,
				score: r2(me?.score ?? 0),
				fit: fitDen > 0 ? r2(fitNum / fitDen) : 1,
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
		const main =
			p.kind === "special" || p.kind === "trait"
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
		return p.defense ? `${main} · ${p.defense}` : main;
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
