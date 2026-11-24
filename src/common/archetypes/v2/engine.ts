// archv2: the archetype engine (the only one). Hierarchical and compositional:
// 1. Three voters decide his FAMILY first: the classic engine's label (classify.ts), the family classifier of the shipped
//    model (model.ts familyProbs) with the rulebook's best-ranked role (the role whose head skill is his best), and the k
//    nearest labeled players (knn.ts: the user's 2K list, the judged key, the user's own picks). When two of them agree
//    he is labeled normally within that family; when all disagree he gets the safest label in the most-voted family (a
//    role with no descriptors, or the classic label) at a lower confidence.
// 2. Within the family, the ROLE: every role whose test he passes (tests.ts, against players at his position), scored by
//    its margin and the neighbours' role votes.
// 3. The DESCRIPTORS: every descriptor whose test he passes, scored by its margin and the neighbours' votes; up to two,
//    assembled by the grammar (grammar.ts: 2K's order, no contradictory or repeated words).
// 4. A name that is one of our builds' names (or a 2K alias of one) whose promises he keeps, at a position the build allows,
//    is that build (preset: its id, description, family); any other is a composed name (id "v2:...").
// 5. Hysteresis: last season's label stays unless the new one beats it by HYST (and he still passes its tests).
import {
	ARCHETYPES,
	archetypeById,
	classify,
	defaultNormsFor,
	explain,
	modelFor,
	scoreAll,
	type ClassifyOptions,
} from "../classify.ts";
import { FAMILIES, type Family } from "../families.ts";
import { hasExpandedRatings } from "../../expandedRatings.ts";
import { mergedId } from "../merges.data.ts";
import { familyProbs } from "../model.ts";
import { isPos, positionOf } from "../position.ts";
import { nameAt } from "../posNames.ts";
import { ATH_NAME_RE, promiseMiss } from "../score.ts";
import { FLOOR, RULES } from "../rulebook.data.ts";
import { USER_2K_MAP } from "../twoK/user2kMap.data.ts";
import { ELITE_RE, isHonestKey, tierOf } from "./honest.ts";
import {
	END_WORDS,
	nounOfDesc,
	nounScores,
	type CoverExplain,
	type NounGroupQuantiles,
	type NounInput,
	type NounKey,
	type Rejection,
} from "./nouns.ts";
import type { RatingQuantiles } from "./gateScale.ts";
import { defenseSentence } from "./defenseLabels.ts";
import { pickNouns } from "./cover.ts";
import { TWO_K_NAMES } from "../defs.data.ts";
import type { ArchetypeRatings, Classification, Norms, Pos } from "../types.ts";
import {
	compatible,
	composedId,
	ROLE_BY_KEY,
	composeName,
	DESC_BY_KEY,
	DESCRIPTORS,
	familyOfName,
	GROUP_OF,
	isComposedId,
	parseComposedId,
	parseName,
	ROLES,
	roleWord,
	type DescDef,
	type PosGroup,
	type RoleDef,
	type WordPick,
} from "./grammar.ts";
import {
	BUCKET_OF,
	FEAT_FROM_FAMX,
	knnVotes,
	shippedIndex,
	standardize,
	type KnnOptions,
	type RefRow,
	type Votes,
} from "./knn.ts";
import {
	floorGap,
	gateGap,
	RAMP_RAT,
	lowOvrTools,
	peerPct,
	testConcept,
	topSkills,
	type WordContext,
} from "./tests.ts";
import { VOTER_REL, type Voter } from "./voters.data.ts";
import { refsFromPicks } from "./picks.ts";
import { USER_PICKS } from "./userPicks.data.ts";
import { CONF_CAL } from "./confCal.data.ts";

export type V2Params = {
	// Family score: the voters weighed by their reliability (archv3), neighbours' share, the classic label's family, the
	// family classifier, the rulebook's role
	fV: number;
	fK: number;
	fC: number;
	fP: number;
	fR: number;
	// Role: test margin and neighbours' role share
	rM: number;
	rK: number;
	// Descriptor: margin, neighbours' share, and the cost of a word (a descriptor is shown only when it earns it)
	dM: number;
	dK: number;
	dCost: number;
	// Neighbours voting for this exact build or name
	kCanon: number;
	// The classic label as a candidate, and a composed name that is one of our builds
	classicBonus: number;
	buildBonus: number;
	// Hysteresis margin (keep last season's label unless beaten by this)
	hyst: number;
	// Runners-up order: a build over a composed name, the classic reading's top builds
	altBuild: number;
	// archv3: the user's tuning per build in the score, and the neighbours' share that makes a build a candidate
	tuneW: number;
	knnBuildMin: number;
	// A composed name gives way to a build this close, or to the earlier reading's label at this confidence (archv3)
	presetMargin: number;
	presetConf: number;
	// What an athletic name on a below-median athlete pays (archv3)
	athPen: number;
	// The Glue roles' head start (archv3: their tests' margins are small by construction, no standout)
	glueWing: number;
	glueGuard: number;
	switchDefender: number;
	// archv4 gap roles' head starts (their tests' margins are small by construction; nobody labeled votes for them yet)
	floaterGuard: number;
	rawHandler: number;
	// archv5 roles' head starts (the user's labels: absolute tests), and what a name below the absolute floor of one of its
	// words pays (tests.ts ABS_FLOORS; 0: no floors)
	paintBeast: number;
	interiorForce: number;
	offGuard: number;
	lowOvr: number;
	floorPen: number;
	// The low-ovr test: the cap on his skill ratings, and the age up to which one tool is allowed (tests.ts lowOvr)
	lowCap: number;
	lowYoung: number;
	toolCap: number;
	toolMin: number;
	// Hysteresis on the absolute bars: last season's label keeps them this many rating points looser (tests.ts band)
	absBand: number;
	// archramp: the bars of a word as ramps, not cliffs (tests.ts WordTest soft). A word is fully his `rampHi` ramp
	// widths above its tightest bar and not his at all `rampLo` widths below it (one width: 3 rating points, 5 percentile
	// points at his position, 0.25 z); in between its membership rises from 0 to 1 and scales the role's head start, and
	// a role or descriptor short of full membership pays up to `rampPen`, a name under an absolute floor up to floorPen.
	// rampLo 0: the cliffs. Measured and NOT shipped (rampLo 1: no gain in stability on the user's league or generated
	// players, and three gold players lost: the no-standout roles, with their head starts, take the near misses).
	rampLo: number;
	rampHi: number;
	rampPen: number;
	// archramp: ramps for the ranks the score read (0: as before).
	// classicSoft (shipped): the earlier reading's builds are candidates by how close each is to its best (its bonus
	// falls to nothing this many z behind, up to classicAlts of them), not the top three at 1 / 0.8 / 0.7 and the fourth
	// at nothing: that reading's order moved with 60% of the labels that flipped under small rating noise.
	// presetSoft (shipped): the earlier reading's label takes a composed name's place over this band of its confidence
	// around presetConf, not at the one value.
	// famSoft, famOutW (measured, NOT shipped: +0.9 stability, but held-out 2K family -0.9 and gold role fit -1.7): a
	// voter torn between two families splits its vote (a softmax at this temperature: z of the earlier reading, a third
	// of it in shares of the neighbours and the classifier); a candidate outside the voted family pays famOut in full
	// only when its family trails by famOutW.
	classicSoft: number;
	classicAlts: number;
	prevClassic: boolean;
	// archramp: a composed label he keeps is kept in last season's words
	keepWords: boolean;
	// archreview: absolute gates on every word of a name (tests.ts ABS_GATES): a name below one pays gatePen (0: no
	// gates), and honest names (honest.ts) take over when no candidate is honest for him
	gatePen: number;
	// archreview2: honest names for limited players (honest.ts): the tier on ovr, the skills that clear a real bar
	honest: boolean;
	// archnouns: the name from his nouns (nouns.ts), the user's design: the final say over the reading's pick
	nouns: boolean;
	// archreview2 (the user: "take stat and shot tracking out of the archetype formula"): the reading uses ratings and
	// traits only; with false, a player's box score and play types (and their shot zones) are not read at all
	useStats: boolean;
	// The low-ovr labels (archv5: Prospect, Depth Piece) are off (the user: "I don't want Prospect and Depth Piece
	// anymore"): such a player is read like anyone else. true: as archv5.
	lowOvrRoles: boolean;
	famSoft: number;
	famOutW: number;
	presetSoft: number;
	// Last season's family's head start
	famHyst: number;
	// What a candidate outside the voted family pays (its family's vote is already in its score; Infinity: the voted
	// family's candidates only, as before archv3)
	famOut: number;
	altClassic: number;
	// archv4: the runner-up is shown ("also") when its score is within this of the label's (0: never)
	alsoMargin: number;
	// archv4: the shown confidence is calibrated (confCal.data.ts: the chance his label's family is right, from how far his
	// family's vote leads) instead of the margin to the runner-up
	confCal: boolean;
	// Use the neighbours' display words
	words: boolean;
	k: number;
};
export const V2_PARAMS: V2Params = {
	fV: 1,
	fK: 0.5,
	fC: 0,
	fP: 0.2,
	fR: 0,
	rM: 1,
	rK: 1,
	dM: 1,
	dK: 1,
	dCost: 0.3,
	kCanon: 1,
	classicBonus: 1,
	buildBonus: 0.1,
	hyst: 1.2,
	altBuild: 0.5,
	tuneW: 5,
	knnBuildMin: 0.1,
	famOut: 0.5,
	presetMargin: 0.1,
	presetConf: 0.8,
	athPen: 1,
	glueWing: 2,
	glueGuard: 1.4,
	switchDefender: 1.5,
	floaterGuard: 2.5,
	rawHandler: 2.5,
	paintBeast: 0.75,
	interiorForce: 1.5,
	offGuard: 1,
	lowOvr: 3,
	floorPen: 3,
	lowCap: 50,
	lowYoung: 21,
	toolCap: 52,
	toolMin: 60,
	absBand: 3,
	rampLo: 0,
	rampHi: 0,
	rampPen: 3,
	classicSoft: 1.5,
	classicAlts: 5,
	prevClassic: true,
	keepWords: true,
	lowOvrRoles: false,
	gatePen: 8,
	honest: true,
	nouns: true,
	useStats: false,
	famSoft: 0,
	famOutW: 0,
	presetSoft: 0.1,
	famHyst: 1,
	altClassic: 1,
	alsoMargin: 0.15,
	confCal: true,
	words: true,
	k: 15,
};

// (what the earlier reading's label may trail a composed name by when that reading is sure of it)
const PRESET_SURE = 6;
const LOW_OVR_ROLES: ReadonlySet<string> = new Set(["prospect", "depthPiece"]);
// archramp: a word's membership (0-1) from how far he is from its tightest bar, in ramp widths
export const rampMu = (soft: number, P: V2Params): number =>
	P.rampLo <= 0
		? soft >= 0
			? 1
			: 0
		: Math.max(0, Math.min(1, (soft + P.rampLo) / (P.rampLo + P.rampHi)));

const norm = (s: string) => s.toLowerCase().replace(/[^\da-z]/g, "");
let nameIndex: Map<string, string> | undefined;
// Every name a build goes by (its names at each position, its 2K aliases, the user's 2K names mapped to it)
// archv3: 2K names of the user's list that the grammar composes as they are (its own words: Switch Defender, Rugged,
// Pesky, Rim Protector), rather than read as the build they were an alias of
export const OWN_COMPOSED_NAMES: ReadonlySet<string> = new Set(
	[
		"Switch Defender",
		"Rugged Rim Protector",
		"Pesky Playmaking Creator",
		"2-Way Middy Playmaker",
		"Wing-Running Sharpshooter",
		"2-Way Bucket Chaser",
	].map((n) => norm(n)),
);
// archv5: the roles of the user's labels (the archcmp sample): their names are his, so no preset stands in for them
const USER_ROLES: ReadonlySet<string> = new Set([
	"paintBeast",
	"interiorForce",
	"offGuard",
	"prospect",
	"depthPiece",
]);
// archv5: the user's own names (his labels of the archcmp sample) for builds that say the same thing
export const USER_LABEL_ALIASES: Record<string, string> = {
	"Perimeter Lockdown": "lockdown-defender",
};
const buildOfName = (name: string): string | undefined => {
	if (OWN_COMPOSED_NAMES.has(norm(name))) {
		return undefined;
	}
	if (!nameIndex) {
		nameIndex = new Map();
		for (const [n, v] of Object.entries(USER_2K_MAP)) {
			if (v.id) {
				nameIndex.set(norm(n), mergedId(v.id));
			}
		}
		for (const [n, id] of Object.entries(USER_LABEL_ALIASES)) {
			nameIndex.set(norm(n), id);
		}
		for (const a of ARCHETYPES) {
			for (const n of TWO_K_NAMES[a.id] ?? []) {
				nameIndex.set(norm(n), a.id);
			}
		}
		for (const a of ARCHETYPES) {
			for (const n of Object.values(a.posNames ?? {})) {
				nameIndex.set(norm(n!), a.id);
			}
			nameIndex.set(norm(a.name), a.id);
		}
	}
	return nameIndex.get(norm(name));
};
// Build the tables a reading needs (the neighbours' index, the names, the shipped picks) ahead of the first one
export const warmArchetypeEngine = () => {
	shippedIndex();
	buildOfName("");
	withShippedPicks();
};

// What a name is, for votes and the evaluation: the build it names, else the name itself
export const canonOf = (name: string): string =>
	buildOfName(name) ?? `name:${norm(name)}`;

export type V2Candidate = {
	id: string;
	name: string;
	canon: string;
	family: Family;
	score: number;
	role?: string;
	descs: string[];
	classic?: boolean;
	// What made him a candidate: a role and descriptors he passes, the earlier reading's label or its runners-up, a
	// build the neighbours or the user's tuning favour
	kind?: "comp" | "classic" | "classicAlt" | "build";
};

export type V2Info = {
	family: Family;
	agreed: boolean;
	voters: {
		classic: Family;
		knn?: Family;
		rule?: Family;
		probs?: Family;
	};
	famScore: Record<Family, number>;
	candidates: V2Candidate[];
	composed: boolean;
	votes: Votes;
	// The roles whose tests he passes
	roles?: string[];
	// archcmp (what the offline comparison re-scores): the family classifier's probabilities, the earlier reading's
	// confidence, its top builds and the score of its label as a candidate
	probs?: number[];
	classicConf?: number;
	classicTop?: string[];
	classicScore?: number;
};

export type V2Options = ClassifyOptions & {
	// His real-player id: a labeled player never votes for himself
	srID?: string;
	knn?: KnnOptions;
	params?: Partial<V2Params>;
	// The user's own picks as labeled players (archfb; archv3: picks.ts refsFromPicks), and his own key among them (a
	// league player's picks: picks.ts pickKey), so he never votes for himself
	extraRefs?: readonly RefRow[];
	pickKey?: string;
	// archreview2: his potential (the honest names: upside is potential well above his ovr)
	pot?: number;
	// archstick: last season's defensive label (with previousId, his whole label last season)
	previousDefense?: string;
	// archnouns: the user's "Doesn't fit" verdicts with no pick: the name shown, the player's key and his ratings then
	rejects?: readonly {
		key?: string;
		name: string;
		ratings?: ArchetypeRatings;
	}[];
};

const allowedBuild = (
	id: string,
	pos: Pos,
	cv: Record<string, number>,
): boolean => {
	const a = archetypeById(id);
	return (
		!!a &&
		a.positions.includes(pos) &&
		!a.trait &&
		!a.expanded &&
		!a.tags.includes("allAround") &&
		promiseMiss(a, cv) <= 1e-9
	);
};

// archnouns: what the noun reading (cover.ts pickNouns) reads about him
const nounInputOf = (
	ratings: ArchetypeRatings,
	opts: V2Options,
	norms: Norms,
	pos: Pos,
): NounInput => {
	const prevRaw = opts.previousId;
	const prevComposed = isComposedId(prevRaw);
	const prevParsed = prevComposed ? parseComposedId(prevRaw) : undefined;
	const prevNouns =
		prevParsed &&
		(prevParsed.role.key.startsWith("pos") ||
			prevParsed.role.key === "bruiser" ||
			prevParsed.role.key === "enigma" ||
			END_WORDS.some((e) => e.key === prevParsed.role.key))
			? prevParsed.descs
					.map((d) => nounOfDesc(d.key))
					.filter((n): n is NounKey => n !== undefined)
			: undefined;
	return {
		r: ratings,
		pos,
		ovr: opts.ovr,
		pot: opts.pot,
		age: opts.age,
		prospect: opts.prospect,
		traits: opts.traits as Record<string, number> | undefined,
		rq: (norms.nq ?? norms.rq) as RatingQuantiles | undefined,
		...(norms.ng ? { ng: norms.ng as NounGroupQuantiles } : {}),
		...(norms.common ? { common: norms.common } : {}),
		rejected: opts.rejects?.map((rj): Rejection => ({
			name: rj.name,
			own: rj.key !== undefined && rj.key === opts.pickKey,
			...(rj.ratings
				? {
						pct: Object.fromEntries(
							nounScores(
								rj.ratings,
								(norms.nq ?? norms.rq) as RatingQuantiles | undefined,
							).map((x) => [x.key, x.pct]),
						),
					}
				: {}),
		})),
		prev: {
			nouns: prevNouns,
			special: prevRaw && !prevComposed ? mergedId(prevRaw) : undefined,
			// archstick: his whole label last season
			...(prevRaw ? { id: prevComposed ? prevRaw : mergedId(prevRaw) } : {}),
			...(prevRaw && opts.previousDefense
				? { defense: opts.previousDefense }
				: {}),
		},
	};
};

// The label v2 gives: classify's Classification (id: a build or a composed "v2:..." id) plus what decided it
export const classifyV2 = (
	ratings: ArchetypeRatings,
	opts: V2Options = {},
): Classification & { v2: V2Info; also?: { id: string; name: string } } => {
	const P = { ...V2_PARAMS, ...opts.params };
	// (ratings and traits only: no box score, no play types)
	if (!P.useStats && (opts.stats !== undefined || opts.pt !== undefined)) {
		opts = { ...opts, stats: undefined, pt: undefined };
	}
	const norms = opts.norms ?? defaultNormsFor(ratings);
	const prevRaw = opts.previousId;
	const prevComposed = isComposedId(prevRaw);
	const read = {
		age: opts.age,
		stats: opts.stats,
		prospect: opts.prospect,
		pt: opts.pt,
	};
	// (read once: the classic reading takes the same scores; archv3)
	const s = scoreAll(
		ratings,
		norms,
		ARCHETYPES,
		isPos(opts.pos) ? opts.pos : undefined,
		opts.traits,
		read,
		opts.model,
	);
	const classic = classify(ratings, {
		...opts,
		norms,
		previousId: prevComposed ? undefined : prevRaw,
		scored: s,
	});
	const pos = s.pos;
	const group = GROUP_OF[pos];
	const bucket = BUCKET_OF[pos];
	const cv = s.cv;
	const ctx: WordContext = {
		cv,
		style: s.style,
		bucket,
		pz: s.pz as unknown as Record<string, number>,
		top3: topSkills(bucket, cv),
		statZ: opts.stats?.z,
		prospect: opts.prospect,
		r: ratings,
		age: opts.age,
		lowCap: P.lowCap,
		lowYoung: P.lowYoung,
		toolCap: P.toolCap,
		toolMin: P.toolMin,
	};
	const order = topSkills(bucket, cv, 10);

	// The neighbours
	const xStd = standardize(FEAT_FROM_FAMX(s.famX), bucket);
	const votes = knnVotes(xStd, bucket, {
		k: P.k,
		...opts.knn,
		exclude: [
			...(opts.srID ? [opts.srID] : []),
			...(opts.pickKey ? [opts.pickKey] : []),
			...(typeof opts.knn?.exclude === "string"
				? [opts.knn.exclude]
				: (opts.knn?.exclude ?? [])),
		],
		extra: withShippedPicks(opts.extraRefs),
		canonOf: (n) => canonOf(n),
	});
	const pick: WordPick | undefined = P.words ? votes.words : undefined;

	// Roles he passes
	// (archv5: last season's role keeps its absolute bars a little looser, absBand)
	const prevRole = prevComposed
		? parseComposedId(prevRaw)?.role.key
		: undefined;
	const banded: WordContext = { ...ctx, band: P.absBand };
	// (archramp: `mu` his membership, 1 when he passes every bar clearly; a near miss is a candidate too, and pays)
	const roleTests = new Map<
		string,
		{ margin: number; name: string; mu: number }
	>();
	for (const r of ROLES) {
		if (!r.groups.includes(group) || r.nounOnly) {
			continue;
		}
		if (!P.lowOvrRoles && LOW_OVR_ROLES.has(r.key)) {
			continue;
		}
		const name = roleWord(r, group, false, pickFor(r, pick));
		const rctx = r.key === prevRole ? banded : ctx;
		let margin = Infinity;
		let soft = Infinity;
		for (const [i, c] of r.concepts.entries()) {
			const t = testConcept(c, i === 0, rctx, name);
			margin = Math.min(margin, t.margin);
			soft = Math.min(soft, t.soft);
		}
		const mu = rampMu(soft, P);
		if (mu > 0) {
			roleTests.set(r.key, { margin, name, mu });
		}
	}
	// The rulebook's role: the one whose head skill ranks best among his skills, then the margin
	// (of the roles he passes outright: the voter is the rulebook's yes/no)
	let ruleRole: RoleDef | undefined;
	let ruleRank = Infinity;
	for (const r of ROLES) {
		const t = roleTests.get(r.key);
		if (!t || t.margin < 0) {
			continue;
		}
		const head = testHeadRank(r, order);
		if (
			head < ruleRank ||
			(head === ruleRank && t.margin > roleTests.get(ruleRole!.key)!.margin)
		) {
			ruleRole = r;
			ruleRank = head;
		}
	}
	const classicFam = familyOfName(classic.name, pos);
	const knnFam = topOf(votes.family);
	const ruleFam = ruleRole
		? familyOfName(roleTests.get(ruleRole.key)!.name, pos)
		: undefined;
	const probs = familyProbs(
		opts.model ?? modelFor(hasExpandedRatings(ratings)),
		s.famX,
	);
	// archv3: each voter's family counts by how often that voter is right when it says that family at his position
	// (voters.data.ts, measured on the tune split); the classifier's and the neighbours' shares add a little
	const probsFam = FAMILIES[probs.indexOf(Math.max(...probs))]!;
	const said: [Voter, Family | undefined][] = [
		["classic", classicFam],
		["knn", knnFam],
		["rule", ruleFam],
		["probs", probsFam],
	];
	const relOf = (v: Voter, f: Family) => {
		const t = VOTER_REL[v][bucket];
		return t?.[f] ?? t?.["*"] ?? 0.4;
	};
	const famVote = {} as Record<Family, number>;
	const famScore = {} as Record<Family, number>;
	// (the vote with every voter all in on one family: what the calibrated confidence was fitted on)
	const famHard = {} as Record<Family, number>;
	// archramp: how each voter splits between the families (all on the one it says with famSoft 0)
	const split: Partial<Record<Voter, Partial<Record<Family, number>>>> = {};
	if (P.famSoft > 0) {
		const soft = (
			x: Partial<Record<Family, number>>,
			t: number,
		): Partial<Record<Family, number>> => {
			const top = Math.max(...Object.values(x));
			const out: Partial<Record<Family, number>> = {};
			let sum = 0;
			for (const [f, v] of Object.entries(x) as [Family, number][]) {
				const e = Math.exp((v - top) / t);
				if (e > 1e-4) {
					out[f] = e;
					sum += e;
				}
			}
			for (const f of Object.keys(out) as Family[]) {
				out[f]! /= sum;
			}
			return out;
		};
		// (the earlier reading: each family's best build, its own label counted as its best)
		const zFam: Partial<Record<Family, number>> = {};
		const zTop = s.scored[0]?.z ?? 0;
		for (const sc of s.scored) {
			if (zTop - sc.z > 6 * P.famSoft) {
				break;
			}
			if (sc.a.id !== classic.id && !allowedBuild(sc.a.id, pos, cv)) {
				continue;
			}
			const f = familyOfName(nameAt(sc.a, pos), pos);
			zFam[f] = Math.max(zFam[f] ?? -Infinity, sc.z);
		}
		zFam[classicFam] = zTop;
		split.classic = soft(zFam, P.famSoft);
		const all = <T>(get: (f: Family, i: number) => T) =>
			Object.fromEntries(FAMILIES.map((f, i) => [f, get(f, i)])) as Record<
				Family,
				T
			>;
		if (knnFam) {
			split.knn = soft(
				all((f) => votes.family[f] ?? 0),
				P.famSoft / 3,
			);
		}
		split.probs = soft(
			all((_f, i) => probs[i]!),
			P.famSoft / 3,
		);
	}
	for (const [i, f] of FAMILIES.entries()) {
		famVote[f] = 0;
		let hard = 0;
		for (const [v, sf] of said) {
			if (sf === f) {
				hard += relOf(v, f);
			}
			const q = split[v];
			famVote[f] += q ? (q[f] ?? 0) * relOf(v, f) : sf === f ? relOf(v, f) : 0;
		}
		const rest =
			P.fK * (votes.family[f] ?? 0) +
			P.fP * probs[i]! +
			P.fC * (classicFam === f ? 1 : 0) +
			P.fR * (ruleFam === f ? 1 : 0);
		famScore[f] = P.fV * famVote[f] + rest;
		famHard[f] = P.fV * hard + rest;
	}
	// (archv4: the calibrated confidence reads the vote before last season's head start)
	const famLead = Object.values(famHard).sort((x, y) => y - x);
	// (archv3: last season's family is kept a little: his family moves only when the vote moves clearly)
	if (prevRaw && P.famHyst !== 0) {
		const pa = archetypeById(prevComposed ? prevRaw : mergedId(prevRaw));
		if (pa) {
			famScore[familyOfName(nameAt(pa, pos), pos)] += P.famHyst;
		}
	}
	const famOrder = FAMILIES.slice().sort(
		(x, y) => famScore[y] - famScore[x] || (x < y ? -1 : 1),
	);
	const family = famOrder[0] as Family;
	// (the voters agree when two or more say his family; else the reading still takes the best label of the best-voted
	// family, at a lower confidence)
	const agreedFam =
		said.filter(([, f]) => f === family).length >= 2 ? family : undefined;

	// Descriptors he passes
	const descTests = new Map<string, { margin: number; mu: number }>();
	for (const d of DESCRIPTORS) {
		if ((d.groups && !d.groups.includes(group)) || d.nounOnly) {
			continue;
		}
		const t = testConcept(d.concept, false, ctx, pick?.[d.key] ?? d.names[0]!);
		const mu = rampMu(t.soft, P);
		if (mu > 0) {
			descTests.set(d.key, { margin: t.margin, mu });
		}
	}
	const dScore = (d: DescDef) => {
		const t = descTests.get(d.key)!;
		return (
			P.dM * t.margin +
			P.dK * (votes.desc[d.key] ?? 0) -
			P.dCost -
			P.rampPen * (1 - t.mu)
		);
	};

	// Candidates
	const cands: V2Candidate[] = [];
	const seen = new Set<string>();
	const add = (c: V2Candidate) => {
		if (!seen.has(c.canon)) {
			seen.add(c.canon);
			cands.push(c);
		}
	};
	for (const r of ROLES) {
		const t = roleTests.get(r.key);
		if (!t) {
			continue;
		}
		const ds = DESCRIPTORS.filter(
			(d) => descTests.has(d.key) && compatible(r, [d], group),
		)
			.sort((x, y) => dScore(y) - dScore(x))
			.slice(0, 5);
		const combos: DescDef[][] = [[]];
		// (archv5: a Prospect's one word is his one tool, from his ratings: tests.ts lowOvrTools)
		const tool =
			r.key === "prospect"
				? toolDesc(
						ratings,
						group,
						cv,
						P.toolCap + (r.key === prevRole ? P.absBand : 0),
					)
				: undefined;
		if (tool) {
			combos.push([tool]);
		} else if (r.key !== "prospect") {
			for (const [i, d] of ds.entries()) {
				combos.push([d]);
				for (const e of ds.slice(i + 1)) {
					if (compatible(r, [d, e], group)) {
						combos.push([d, e]);
					}
				}
			}
		}
		const base =
			P.rM * t.margin +
			P.rK * (votes.role[r.key] ?? 0) +
			roleHeadStart(r.key, P) * t.mu -
			P.rampPen * (1 - t.mu);
		for (const c of combos) {
			const pk = pickFor(r, pick, c);
			const name = composeName(r, c, group, pk);
			const fam = familyOfName(name, pos);
			const canon = canonOf(name);
			const build =
				canon.startsWith("name:") || !allowedBuild(canon, pos, cv)
					? undefined
					: canon;
			add({
				id: build ?? composedId(r, c, group, pk),
				name,
				canon,
				family: fam,
				role: r.key,
				descs: c.map((d) => d.key),
				kind: "comp",
				score:
					famScore[fam] +
					base +
					c.reduce(
						(sum, d) => sum + (descTests.has(d.key) ? dScore(d) : TOOL_SCORE),
						0,
					) +
					P.kCanon * (votes.canon[canon] ?? 0) +
					(build ? P.buildBonus : 0),
			});
		}
	}
	// The classic label: always a candidate (the safe one)
	const classicParsed = parseName(classic.name, pos);
	const classicCand: V2Candidate = {
		id: classic.id,
		name: classic.name,
		canon: classic.id,
		family: classicFam,
		role: classicParsed.role,
		descs: classicParsed.descs,
		classic: true,
		kind: "classic",
		score:
			famScore[classicFam] +
			P.classicBonus +
			P.rK * (votes.role[classicParsed.role ?? ""] ?? 0) +
			P.kCanon * (votes.canon[classic.id] ?? 0),
	};
	{
		const i = cands.findIndex((c) => c.canon === classic.id);
		if (i >= 0) {
			cands[i] = {
				...cands[i]!,
				id: classic.id,
				classic: true,
				score: Math.max(cands[i]!.score, classicCand.score),
			};
		} else {
			add(classicCand);
		}
	}
	// The classic engine's runners-up: candidates too (its next builds are often the right one)
	const classicTop: string[] = [classic.id];
	{
		let added = 0;
		const zTop = s.scored[0]?.z ?? 0;
		for (const sc of s.scored) {
			// (archramp: by how close it is to the earlier reading's best, not by its rank)
			const near =
				P.classicSoft > 0 ? 1 - (zTop - sc.z) / P.classicSoft : undefined;
			if (
				near === undefined ? added >= 2 : near <= 0 || added >= P.classicAlts
			) {
				break;
			}
			if (sc.a.id === classic.id || !allowedBuild(sc.a.id, pos, cv)) {
				continue;
			}
			added++;
			if (added <= 2) {
				classicTop.push(sc.a.id);
			}
			const nm = nameAt(sc.a, pos);
			const fam = familyOfName(nm, pos);
			const parsed = parseName(nm, pos);
			add({
				id: sc.a.id,
				name: nm,
				canon: sc.a.id,
				family: fam,
				role: parsed.role,
				descs: parsed.descs,
				kind: "classicAlt",
				score:
					famScore[fam] +
					P.classicBonus * (near ?? 0.9 - 0.1 * added) +
					P.rK * (votes.role[parsed.role ?? ""] ?? 0) +
					P.kCanon * (votes.canon[sc.a.id] ?? 0),
			});
		}
	}
	const tuneBias = opts.model?.buildBias ?? {};
	// (the candidates whose score already has the tuning)
	const tuned = new Set<V2Candidate>();
	// A build as a candidate on the neighbours' votes alone
	const buildCand = (id: string): V2Candidate => {
		const nm = nameAt(archetypeById(id)!, pos);
		const fam = familyOfName(nm, pos);
		const parsed = parseName(nm, pos);
		return {
			id,
			name: nm,
			canon: id,
			family: fam,
			role: parsed.role,
			descs: parsed.descs,
			kind: "build",
			score:
				famScore[fam] +
				P.rK * (votes.role[parsed.role ?? ""] ?? 0) +
				P.kCanon * (votes.canon[id] ?? 0) +
				P.tuneW * (tuneBias[id] ?? 0),
		};
	};
	// archv3: builds the neighbours vote for, and builds the user's tuning favours (his picks), are candidates too (a
	// pick of a build the reading never offered could not win otherwise)
	{
		const extraIds = new Set<string>();
		for (const [c, share] of Object.entries(votes.canon)) {
			if (!c.startsWith("name:") && (share ?? 0) >= P.knnBuildMin) {
				extraIds.add(c);
			}
		}
		for (const [id, b] of Object.entries(tuneBias)) {
			if (b > 0) {
				extraIds.add(id);
			}
		}
		for (const id of [...extraIds].sort()) {
			if (!seen.has(id) && allowedBuild(id, pos, cv)) {
				const c = buildCand(id);
				tuned.add(c);
				add(c);
			}
		}
	}
	// archv3: an athletic name (High-Flying, Burner, Rim Runner, ...) on a player below his position's median athleticism
	// pays athPen (the earlier reading's floor lets some through)
	if (P.athPen !== 0 && peerPct(bucket, "ath", cv.ath ?? 0) < 0.5) {
		for (const c of cands) {
			if (ATH_NAME_RE.test(c.name)) {
				c.score -= P.athPen;
			}
		}
	}
	// archv5: a name below the absolute floor of one of its words (tests.ts ABS_FLOORS: "41 3PT is way too low for
	// Stretch") pays floorPen, whichever way it came (a composed name, the earlier reading's label, a build)
	// (last season's label keeps the floors absBand looser)
	const prevKey = prevRaw && !prevComposed ? mergedId(prevRaw) : prevRaw;
	// (the name the label is shown as: a composed name that is a build's alias is shown as the build, "Glass-Cleaning
	// Playmaker" as "Triple-Double Threat")
	const shownName = (c: V2Candidate) => {
		if (isComposedId(c.id)) {
			return c.name;
		}
		const a = archetypeById(c.id);
		return a ? nameAt(a, pos) : c.name;
	};
	const gatePasses = (c: V2Candidate) =>
		gateGap(
			shownName(c),
			ratings,
			opts.ovr,
			c.id === prevKey ? P.absBand : 0,
			norms.rq,
		) <= 0;
	// (archramp: the floor is a ramp: nothing `rampHi` widths above it, all of floorPen `rampLo` widths below)
	const floorPay = (c: V2Candidate) => {
		// (archreview: every word of the name true in absolute terms)
		if (P.gatePen !== 0 && gatePasses(c) === false) {
			c.score -= P.gatePen;
		}
		if (P.floorPen !== 0) {
			const gap = floorGap(c.name, ratings, c.id === prevKey ? P.absBand : 0);
			if (gap > -Infinity) {
				c.score -= P.floorPen * (1 - rampMu(-gap / RAMP_RAT, P));
			}
		}
	};
	for (const c of cands) {
		floorPay(c);
	}
	// The user's tuning (his picks) on every build: the reading follows his picks as the earlier reading's model did
	if (P.tuneW !== 0) {
		for (const c of cands) {
			if (!tuned.has(c)) {
				c.score += P.tuneW * (tuneBias[c.canon] ?? 0);
			}
		}
	}
	cands.sort((x, y) => y.score - x.score || (x.canon < y.canon ? -1 : 1));
	// Family first: the candidates of his family (the classic label when none is)
	// (a candidate outside the voted family pays famOut: archv3, was a hard filter; Infinity: the family only)
	// (a build the user's picks favour pays no family toll: his picks say which family players like him are in)
	// (archramp: in full only when its family trails the voted one by famOutW)
	const famToll = (c: V2Candidate) =>
		c.family === family || (tuneBias[c.canon] ?? 0) > 0
			? 0
			: P.famOut *
				(P.famOutW > 0
					? Math.min(1, (famScore[family] - famScore[c.family]) / P.famOutW)
					: 1);
	let first = classicCand;
	{
		let best = -Infinity;
		for (const c of cands) {
			const sc = c.score - famToll(c);
			if (sc > best) {
				best = sc;
				first = c;
			}
		}
	}
	const eff = (c: V2Candidate) => c.score - famToll(c);
	// archv3: a composed name only where no preset says him: a build within presetMargin of it, or the earlier reading's
	// label when that reading is sure of it (its confidence presetConf or more), is his label instead
	if (
		isComposedId(first.id) &&
		!OWN_COMPOSED_NAMES.has(norm(first.name)) &&
		!USER_ROLES.has(first.role ?? "")
	) {
		const fs = eff(first);
		// (archramp: how far the earlier reading's label may trail and still take its place, rising over a band of that
		// reading's confidence)
		const sure =
			P.presetSoft > 0
				? PRESET_SURE *
					Math.max(
						0,
						Math.min(
							1,
							(classic.confidence - P.presetConf + P.presetSoft) /
								(2 * P.presetSoft),
						),
					)
				: classic.confidence >= P.presetConf
					? Infinity
					: 0;
		const preset = cands.find(
			(c) =>
				!isComposedId(c.id) &&
				// (archreview: never a preset whose words he doesn't live up to)
				(P.gatePen === 0 || gatePasses(c)) &&
				eff(c) >= fs - P.presetMargin - (c.classic ? sure : 0),
		);
		if (preset) {
			first = preset;
		}
	}
	// Hysteresis: last season's label stays unless beaten clearly (and while he still passes its tests)
	// (archv3: on the same footing as the choice, outside his family included; a build he still passes that is no longer
	// among the candidates is scored as one)
	if (prevRaw && prevRaw !== first.id) {
		const prevId = prevComposed ? prevRaw : mergedId(prevRaw);
		let prev = cands.find((c) => c.id === prevId);
		if (!prev && !prevComposed && allowedBuild(prevId, pos, cv)) {
			prev = buildCand(prevId);
			// (archramp: with what the earlier reading still gives it, as its other builds get: a label that slipped out of
			// that reading's top few used to come back with nothing and lose at once)
			if (P.classicSoft > 0 && P.prevClassic) {
				const sc = s.scored.find((x) => x.a.id === prevId);
				if (sc) {
					prev.score +=
						P.classicBonus *
						Math.max(0, 1 - ((s.scored[0]?.z ?? 0) - sc.z) / P.classicSoft);
				}
			}
			floorPay(prev);
			cands.push(prev);
		}
		if (
			prev &&
			eff(prev) >= eff(first) - P.hyst &&
			(prevComposed || prev.classic || allowedBuild(prevId, pos, cv))
		) {
			first = prev;
		} else if (!prev && prevComposed) {
			// (a composed label is kept only while every word still passes)
			const parsed = parseComposedId(prevId);
			if (parsed && parsed.group === group) {
				const own = cands.find(
					(c) =>
						c.role === parsed.role.key &&
						c.descs.join("+") === parsed.descs.map((d) => d.key).join("+"),
				);
				if (own && eff(own) >= eff(first) - P.hyst) {
					// (archramp: in last season's words: the neighbours' word for a role or a descriptor moves from season to
					// season, and "Rim-Wrecking Prospect" one year and "Rim-Rocking Prospect" the next is the same label)
					const kept = P.keepWords ? archetypeById(prevId) : undefined;
					first = kept ? { ...own, id: prevId, name: kept.name } : own;
				}
			}
		}
	}
	// archreview2: an honest name for a limited player (honest.ts). His tier (ovr) decides which words his name may have:
	// elite words only from ELITE_OVR, and under MID_OVR only an honest name unless two skills clear a real bar; every word
	// of the label must clear its gate. The reading's pick stays when it is honest for him; else the best candidate that is;
	// else an honest name (a specialist, a developing or a depth name).
	// archnouns: the name from his nouns (nouns.ts): a special name (a build), his two best nouns and his position, a
	// trait name, or (one noun at low ovr, or none) an honest name about that noun
	let nounConf: number | undefined;
	let nounDefense: string | undefined;
	let nounExplain: CoverExplain | undefined;
	let nounIn: NounInput | undefined;
	if (P.nouns && isPos(pos)) {
		nounIn = nounInputOf(ratings, opts, norms, pos);
		const np = pickNouns(nounIn);
		// (archstick: his name's words are then read in the order his nouns were picked in)
		if (np.tie === false) {
			nounIn = { ...nounIn, tie: false };
		}
		// (archcov: and with the slack his last-season label was re-checked with)
		if (np.slack !== undefined) {
			nounIn = { ...nounIn, slack: np.slack };
		}
		const score = eff(first);
		nounConf = np.conf;
		nounDefense = np.defense;
		nounExplain = np.explain;
		if (np.kind === "special") {
			const a = archetypeById(np.id)!;
			const nm = nameAt(a, pos);
			const parsed = parseName(nm, pos);
			first = {
				id: np.id,
				name: nm,
				canon: np.id,
				family: familyOfName(nm, pos),
				role: parsed.role,
				descs: parsed.descs,
				kind: "build",
				score,
			};
		} else if (np.kind === "composed" || np.kind === "trait") {
			const role = ROLE_BY_KEY.get(np.kind === "trait" ? np.key : np.role)!;
			const descs =
				np.kind === "trait" ? [] : np.descs.map((k) => DESC_BY_KEY.get(k)!);
			const wp: WordPick =
				np.kind === "trait" ? { [np.key]: np.name } : (np.pick ?? {});
			// (archstick: last season's noun name, kept, is kept in its own words)
			const keep =
				np.kind === "composed" && np.keepId
					? archetypeById(np.keepId)
					: undefined;
			const id = keep ? keep.id : composedId(role, descs, group, wp);
			const nm = keep ? keep.name : composeName(role, descs, group, wp);
			first = {
				id,
				name: nm,
				canon: id,
				family: role.family ?? familyOfName(nm, pos),
				role: role.key,
				descs: descs.map((d) => d.key),
				kind: "comp",
				score,
			};
		}
	}
	const tier = P.honest ? tierOf(opts.ovr) : "elite";
	const honestFor = (c: V2Candidate) =>
		(P.gatePen === 0 || gatePasses(c)) &&
		(tier === "elite" || !ELITE_RE.test(shownName(c)));
	if (P.honest) {
		// (archskill, reading 29: no honest names; a label the no-nouns reading finds no word of honest for keeps the best
		// candidate that is)
		if (!P.nouns && !honestFor(first)) {
			const alt = cands
				.filter(honestFor)
				.sort((x, y) => eff(y) - eff(x) || (x.canon < y.canon ? -1 : 1))[0];
			if (alt) {
				first = alt;
			}
		}
	}
	// The runners-up: the next candidates, builds (presets) before composed names by altBuild, and the classic reading's
	// own top builds by altClassic (archv3: what the user's 2K names most often are)
	const altScore = (c: V2Candidate) =>
		c.score +
		(isComposedId(c.id) ? 0 : P.altBuild) +
		(c.classic || classicTop.includes(c.id) ? P.altClassic : 0);
	const rest = [
		first,
		...cands
			.filter(
				(c) =>
					c !== first && !isHonestKey(c.role) && (!P.honest || honestFor(c)),
			)
			.sort(
				(x, y) => altScore(y) - altScore(x) || (x.canon < y.canon ? -1 : 1),
			),
	];
	const second = rest[1];
	let confidence = second
		? Math.max(0, Math.min(1, (first.score - second.score) / 0.5))
		: 1;
	if (!agreedFam) {
		confidence *= 0.5;
	}
	if (P.confCal) {
		const best = famLead[0] ?? 0;
		confidence =
			1 /
			(1 +
				Math.exp(
					-(
						CONF_CAL.a +
						CONF_CAL.best * best +
						CONF_CAL.lead * (best - (famLead[1] ?? 0))
					),
				));
	}
	// (archnouns: how clearly his nouns name him)
	if (nounConf !== undefined) {
		confidence = nounConf;
	}
	const a = archetypeById(first.id)!;
	const isClassic = first.id === classic.id;
	// archv4: the runner-up, when it is close
	const alsoC =
		P.alsoMargin > 0 &&
		second &&
		second.canon !== first.canon &&
		eff(first) - eff(second) < P.alsoMargin
			? second
			: undefined;
	// (archfam: a build's name where he plays: "Five" only on a center)
	const atPos = isPos(pos) ? nameAt(a, pos) : a.name;
	return {
		...classic,
		id: a.id,
		name: isComposedId(a.id) ? a.name : first.classic ? classic.name : atPos,
		label:
			(isComposedId(a.id) ? a.name : first.classic ? classic.label : atPos) +
			(nounDefense ? ` · ${nounDefense}` : ""),
		...(nounDefense ? { defense: nounDefense } : {}),
		// archcov: why the label was chosen
		...(nounExplain
			? {
					reason: {
						...nounExplain,
						name:
							(isComposedId(a.id)
								? a.name
								: first.classic
									? classic.label
									: atPos) + (nounDefense ? ` · ${nounDefense}` : ""),
					},
				}
			: {}),
		group: a.group,
		family: a.family,
		// (archnouns: both labels in the description)
		desc: nounDefense ? `${a.desc} ${defenseSentence(nounDefense)}` : a.desc,
		tags: a.tags,
		alternates: rest.slice(1, 3).map((c) => ({ id: c.id, name: c.name })),
		shortfall: isClassic ? classic.shortfall : 0,
		confidence: Math.round(confidence * 100) / 100,
		why: isClassic
			? classic.why
			: explain(a.id, ratings, norms, { ...read, pos }),
		...(isComposedId(a.id) ? { custom: true } : {}),
		...(alsoC ? { also: { id: alsoC.id, name: alsoC.name } } : {}),
		v2: {
			family,
			agreed: !!agreedFam,
			voters: {
				classic: classicFam,
				knn: knnFam,
				rule: ruleFam,
				probs: probsFam,
			},
			famScore,
			roles: [...roleTests].filter(([, t]) => t.margin >= 0).map(([k]) => k),
			candidates: rest,
			composed: isComposedId(a.id),
			votes,
			probs,
			classicConf: classic.confidence,
			classicTop,
			classicScore: classicCand.score,
		},
	};
};

// classifyV2(ratings, opts).label (speed, same label), without the rest of the reading when the noun reading names him
// on its own: with the nouns on, a special, composed or trait pick replaces the reading's choice whatever it was, and
// the label is that pick's name at his position (the same code as classifyV2's). An honest pick takes the whole reading.
export const classifyV2Label = (
	ratings: ArchetypeRatings,
	opts: V2Options = {},
): string => {
	const P = { ...V2_PARAMS, ...opts.params };
	if (P.nouns) {
		// (scoreAll's position: his own when he has one, else from his ratings)
		const pos = isPos(opts.pos) ? opts.pos : positionOf(ratings);
		if (isPos(pos)) {
			const norms = opts.norms ?? defaultNormsFor(ratings);
			const np = pickNouns(nounInputOf(ratings, opts, norms, pos));
			let id: string | undefined;
			if (np.kind === "special") {
				id = np.id;
			} else if (np.kind === "composed" || np.kind === "trait") {
				const role = ROLE_BY_KEY.get(np.kind === "trait" ? np.key : np.role)!;
				const descs =
					np.kind === "trait" ? [] : np.descs.map((k) => DESC_BY_KEY.get(k)!);
				const wp: WordPick =
					np.kind === "trait" ? { [np.key]: np.name } : (np.pick ?? {});
				const keep =
					np.kind === "composed" && np.keepId
						? archetypeById(np.keepId)
						: undefined;
				id = keep ? keep.id : composedId(role, descs, GROUP_OF[pos], wp);
			}
			if (id !== undefined) {
				const a = archetypeById(id)!;
				return (
					(isComposedId(a.id) ? a.name : nameAt(a, pos)) +
					(np.defense ? ` · ${np.defense}` : "")
				);
			}
		}
	}
	return classifyV2(ratings, opts).label;
};

// The shipped picks (userPicks.data.ts) under the league's own (a league's copy of a shipped pick replaces it)
let shippedPickRefs: RefRow[] | undefined;
const withShippedPicks = (extra?: readonly RefRow[]): readonly RefRow[] => {
	shippedPickRefs ??= refsFromPicks(USER_PICKS, true);
	if (!extra || extra.length === 0) {
		return shippedPickRefs;
	}
	const own = new Set(extra.map((r) => r.uid).filter(Boolean));
	return [...shippedPickRefs.filter((r) => !own.has(r.uid)), ...extra];
};

// archv5: the roles' head starts (their tests' margins are small by construction; nobody labeled votes for them yet)
const roleHeadStart = (key: string, P: V2Params): number => {
	switch (key) {
		case "glueWing":
			return P.glueWing;
		case "glueGuard":
			return P.glueGuard;
		case "switchDefender":
			return P.switchDefender;
		case "floaterGuard":
			return P.floaterGuard;
		case "rawHandler":
			return P.rawHandler;
		case "paintBeast":
			return P.paintBeast;
		case "interiorForce":
			return P.interiorForce;
		case "offGuard":
			return P.offGuard;
		case "prospect":
		case "depthPiece":
			return P.lowOvr;
		default:
			return 0;
	}
};

// archv5: a Prospect's one tool as a word (the skill rating above the cap: tests.ts lowOvrTools), where the word is
// allowed at his size and its class is at least ordinary for him (the name's promise)
const TOOL_DESC: Record<string, Partial<Record<PosGroup, string>>> = {
	reb: { guard: "glass", wing: "glass", big: "glass" },
	dnk: { guard: "rimRocking", wing: "rimRocking", big: "rimRocking" },
	ins: { guard: "slashing", wing: "postScoring", big: "postScoring" },
	tp: { guard: "threePt", wing: "threePt", big: "stretchy" },
	fg: { guard: "middy", wing: "middy", big: "middy" },
	drb: { guard: "iso", wing: "iso" },
	pss: { guard: "playmaking", wing: "playmaking", big: "playmaking" },
	diq: { guard: "defensive", wing: "defensive", big: "defensive" },
	oiq: { guard: "crafty", wing: "crafty", big: "crafty" },
};
const TOOL_SCORE = 0.3;
const toolDesc = (
	ratings: ArchetypeRatings,
	group: PosGroup,
	cv: Record<string, number>,
	cap: number,
): DescDef | undefined => {
	const tools = lowOvrTools(ratings, cap);
	if (tools.length !== 1) {
		return undefined;
	}
	const d = DESC_BY_KEY.get(TOOL_DESC[tools[0]!]?.[group] ?? "");
	if (!d || (d.groups && !d.groups.includes(group))) {
		return undefined;
	}
	for (const k of RULES[d.concept]?.classes ?? []) {
		if ((cv[k] ?? 0) < FLOOR) {
			return undefined;
		}
	}
	return d;
};

const topOf = <K extends string>(m: Partial<Record<K, number>>) =>
	(Object.entries(m) as [K, number][]).sort(
		(a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
	)[0]?.[0];

// The rank of a role's head skill among his skills (0 = his best)
const ROLE_HEAD: Record<string, string[]> = {};
const testHeadRank = (r: RoleDef, order: string[]) => {
	const cls = (ROLE_HEAD[r.key] ??= headClasses(r));
	const ranks = cls.map((k) => order.indexOf(k)).filter((i) => i >= 0);
	return ranks.length > 0 ? Math.min(...ranks) : order.length;
};
const headClasses = (r: RoleDef) => RULES[r.concepts[0]!]?.classes ?? [];

// Display words: the neighbours' variant only where it is one of the word's own names (and the role's only without
// descriptors when it has a separate form with them)
const pickFor = (
	r: RoleDef,
	pick: WordPick | undefined,
	descs: readonly DescDef[] = [],
): WordPick | undefined => {
	if (!pick) {
		return undefined;
	}
	const out: WordPick = {};
	const rw = pick[r.key];
	if (rw && r.names.includes(rw) && !(descs.length > 0 && r.withDesc)) {
		out[r.key] = rw;
	}
	for (const d of descs) {
		const w = pick[d.key];
		if (w && d.names.includes(w)) {
			out[d.key] = w;
		}
	}
	return out;
};
