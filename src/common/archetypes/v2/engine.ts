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
import { isPos } from "../position.ts";
import { nameAt } from "../posNames.ts";
import { ATH_NAME_RE, promiseMiss } from "../score.ts";
import { RULES } from "../rulebook.data.ts";
import { USER_2K_MAP } from "../twoK/user2kMap.data.ts";
import { TWO_K_NAMES } from "../defs.data.ts";
import type { ArchetypeRatings, Classification, Pos } from "../types.ts";
import {
	compatible,
	composedId,
	composeName,
	DESCRIPTORS,
	familyOfName,
	GROUP_OF,
	isComposedId,
	parseComposedId,
	parseName,
	ROLES,
	roleWord,
	type DescDef,
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
import { peerPct, testConcept, topSkills, type WordContext } from "./tests.ts";
import { VOTER_REL, type Voter } from "./voters.data.ts";
import { refsFromPicks } from "./picks.ts";
import { USER_PICKS } from "./userPicks.data.ts";

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
	// What an athletic name on a below-median athlete pays (archv3)
	athPen: number;
	// The Glue roles' head start (archv3: their tests' margins are small by construction, no standout)
	glueWing: number;
	glueGuard: number;
	// Last season's family's head start
	famHyst: number;
	// What a candidate outside the voted family pays (its family's vote is already in its score; Infinity: the voted
	// family's candidates only, as before archv3)
	famOut: number;
	altClassic: number;
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
	hyst: 0.8,
	altBuild: 0.5,
	tuneW: 5,
	knnBuildMin: 0.1,
	famOut: 0.5,
	athPen: 1,
	glueWing: 2,
	glueGuard: 1.4,
	famHyst: 1,
	altClassic: 1,
	words: true,
	k: 15,
};

const norm = (s: string) => s.toLowerCase().replace(/[^\da-z]/g, "");
let nameIndex: Map<string, string> | undefined;
// Every name a build goes by (its names at each position, its 2K aliases, the user's 2K names mapped to it)
const buildOfName = (name: string): string | undefined => {
	if (!nameIndex) {
		nameIndex = new Map();
		for (const [n, v] of Object.entries(USER_2K_MAP)) {
			if (v.id) {
				nameIndex.set(norm(n), mergedId(v.id));
			}
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
};

export type V2Info = {
	family: Family;
	agreed: boolean;
	voters: { classic: Family; knn?: Family; rule?: Family; probs?: Family };
	famScore: Record<Family, number>;
	candidates: V2Candidate[];
	composed: boolean;
	votes: Votes;
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

// The label v2 gives: classify's Classification (id: a build or a composed "v2:..." id) plus what decided it
export const classifyV2 = (
	ratings: ArchetypeRatings,
	opts: V2Options = {},
): Classification & { v2: V2Info } => {
	const P = { ...V2_PARAMS, ...opts.params };
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
	};
	const order = topSkills(bucket, cv, 10);

	// The neighbours
	const votes = knnVotes(standardize(FEAT_FROM_FAMX(s.famX), bucket), bucket, {
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
	const roleTests = new Map<string, { margin: number; name: string }>();
	for (const r of ROLES) {
		if (!r.groups.includes(group)) {
			continue;
		}
		const name = roleWord(r, group, false, pickFor(r, pick));
		let margin = Infinity;
		for (const [i, c] of r.concepts.entries()) {
			margin = Math.min(margin, testConcept(c, i === 0, ctx, name).margin);
		}
		if (margin >= 0) {
			roleTests.set(r.key, { margin, name });
		}
	}
	// The rulebook's role: the one whose head skill ranks best among his skills, then the margin
	let ruleRole: RoleDef | undefined;
	let ruleRank = Infinity;
	for (const r of ROLES) {
		const t = roleTests.get(r.key);
		if (!t) {
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
	for (const [i, f] of FAMILIES.entries()) {
		famVote[f] = 0;
		for (const [v, sf] of said) {
			if (sf === f) {
				famVote[f] += relOf(v, f);
			}
		}
		famScore[f] =
			P.fV * famVote[f] +
			P.fK * (votes.family[f] ?? 0) +
			P.fP * probs[i]! +
			P.fC * (classicFam === f ? 1 : 0) +
			P.fR * (ruleFam === f ? 1 : 0);
	}
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
	const descTests = new Map<string, number>();
	for (const d of DESCRIPTORS) {
		if (d.groups && !d.groups.includes(group)) {
			continue;
		}
		const t = testConcept(d.concept, false, ctx, pick?.[d.key] ?? d.names[0]!);
		if (t.pass) {
			descTests.set(d.key, t.margin);
		}
	}
	const dScore = (d: DescDef) =>
		P.dM * descTests.get(d.key)! + P.dK * (votes.desc[d.key] ?? 0) - P.dCost;

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
		for (const [i, d] of ds.entries()) {
			combos.push([d]);
			for (const e of ds.slice(i + 1)) {
				if (compatible(r, [d, e], group)) {
					combos.push([d, e]);
				}
			}
		}
		const base =
			P.rM * t.margin +
			P.rK * (votes.role[r.key] ?? 0) +
			(r.key === "glueWing"
				? P.glueWing
				: r.key === "glueGuard"
					? P.glueGuard
					: 0);
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
				score:
					famScore[fam] +
					base +
					c.reduce((sum, d) => sum + dScore(d), 0) +
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
		for (const sc of s.scored) {
			if (added >= 2) {
				break;
			}
			if (sc.a.id === classic.id || !allowedBuild(sc.a.id, pos, cv)) {
				continue;
			}
			added++;
			classicTop.push(sc.a.id);
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
				score:
					famScore[fam] +
					P.classicBonus * (0.9 - 0.1 * added) +
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
	let first = classicCand;
	{
		let best = -Infinity;
		for (const c of cands) {
			const sc = c.family === family ? c.score : c.score - P.famOut;
			if (sc > best) {
				best = sc;
				first = c;
			}
		}
	}
	// Hysteresis: last season's label stays unless beaten clearly (and while he still passes its tests)
	// (archv3: on the same footing as the choice, outside his family included; a build he still passes that is no longer
	// among the candidates is scored as one)
	const eff = (c: V2Candidate) =>
		c.family === family ? c.score : c.score - P.famOut;
	if (prevRaw && prevRaw !== first.id) {
		const prevId = prevComposed ? prevRaw : mergedId(prevRaw);
		let prev = cands.find((c) => c.id === prevId);
		if (!prev && !prevComposed && allowedBuild(prevId, pos, cv)) {
			prev = buildCand(prevId);
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
					first = own;
				}
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
			.filter((c) => c !== first)
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
	const a = archetypeById(first.id)!;
	const isClassic = first.id === classic.id;
	return {
		...classic,
		id: a.id,
		name: isComposedId(a.id) ? a.name : first.classic ? classic.name : a.name,
		label: isComposedId(a.id) ? a.name : first.classic ? classic.label : a.name,
		group: a.group,
		family: a.family,
		desc: a.desc,
		tags: a.tags,
		alternates: rest.slice(1, 3).map((c) => ({ id: c.id, name: c.name })),
		shortfall: isClassic ? classic.shortfall : 0,
		confidence: Math.round(confidence * 100) / 100,
		why: isClassic
			? classic.why
			: explain(a.id, ratings, norms, { ...read, pos }),
		...(isComposedId(a.id) ? { custom: true } : {}),
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
			roles: [...roleTests.keys()],
			candidates: rest,
			composed: isComposedId(a.id),
			votes,
		},
	};
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
