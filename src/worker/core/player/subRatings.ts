// Worker side of sub-ratings (the subRatings setting, basketball; data model in common/subRatings.ts, generation and development in
// common/subRatingsGen.ts). Nothing here draws from the game's random stream, and nothing runs while the setting is off.

import { PLAYER } from "../../../common/constants.ts";
import { helpers } from "../../../common/helpers.ts";
import {
	isValidSubArray,
	NUM_SUBS,
	SUB_BASES,
	SUB_DEFS,
	SUB_HISTORY,
	SUB_RATINGS_VERSION,
	fitSubsToBases,
	subOffsets,
} from "../../../common/subRatings.ts";
import {
	ageAtDraft,
	type Background,
	developSubs,
	GENERATIONAL_OFFSET,
	generateSubShape,
	MAX_GENERATIONAL,
	maxOffset,
	neutralSubShape,
	parseSubLean,
	realSubShape,
	seedForExisting,
	seedForGenerated,
	type StoredSubInfo,
	syncRowSubs,
} from "../../../common/subRatingsGen.ts";
import { g } from "../../util/index.ts";
import { applyFuzz, getFuzz } from "./fuzzRating.ts";

export const subRatingsOn = (): boolean =>
	__SPORT === "basketball" &&
	Object.hasOwn(g, "subRatings") &&
	g.get("subRatings") === true;

type PlayerLike = {
	pid?: number;
	srID?: string;
	real?: boolean;
	firstName: string;
	lastName: string;
	born: { year: number; loc: string };
	draft: { year: number };
	college?: string;
	tid: number;
	ratings: any[];
	subP?: StoredSubInfo;
	subLean?: string;
	preDraftCareer?: { story?: string; years?: { level: string }[] };
};

// His background before the draft, which styles a generated prospect's shape: one-and-done (raw, athletic), senior (polished), international
// (passing, shooting), G League / Overtime Elite (no college, American: pro-ready creator), or an ordinary college prospect
export const backgroundOf = (p: PlayerLike): Background => {
	const age = ageAtDraft(p);
	const american = helpers.isAmerican(p.born.loc);
	const college = p.college ?? "";
	const story = p.preDraftCareer?.story;
	if (!american && (college === "" || story === "olderIntl")) {
		return "intl";
	}
	if (american && college === "" && age >= 19) {
		return "pro";
	}
	if (age <= 19) {
		return "oneAndDone";
	}
	if (age >= 22) {
		return "senior";
	}
	return "college";
};

// A newly generated (fictional) player: his seed, from what was already drawn about him, and a mark that his shape is still to be
// generated (g -1), when his ratings are final enough (his first development)
export const markGenerated = (p: PlayerLike) => {
	if (!subRatingsOn()) {
		return;
	}
	p.subP = { v: SUB_RATINGS_VERSION, s: seedForGenerated(p), g: -1 };
};

const isPending = (info: StoredSubInfo | undefined) =>
	info !== undefined && info.g < 0;

// Give a generated player his shape now (class caps may scale it: damp)
const generateFor = (p: PlayerLike, damp = 1) => {
	const r = p.ratings.at(-1);
	const { sub, info } = generateSubShape(
		r,
		p.subP!.s,
		{
			background: backgroundOf(p),
			story: p.preDraftCareer?.story,
		},
		damp,
	);
	r.sub = sub;
	p.subP = info;
};

// Fill in the sub-ratings a player is missing (his last SUB_HISTORY rows), and move the ones whose bases changed outside development back in
// sync. Generated players get their generated shape, everyone else a neutral one. Older rows get the latest row's shape. Returns true if
// anything changed. No-op with the setting off.
export const ensureSubs = (p: PlayerLike): boolean => {
	if (!subRatingsOn() || p.ratings.length === 0) {
		return false;
	}
	let changed = false;
	const latest = p.ratings.at(-1);
	const lean = parseSubLean(p.subLean);
	if (p.subLean !== undefined) {
		delete p.subLean;
		changed = true;
	}
	if (
		lean &&
		(!p.subP ||
			p.subP.v !== SUB_RATINGS_VERSION ||
			(p.subP.n === 1 && p.subP.rs === undefined))
	) {
		// A real player: his shape from his real stats (also replacing a neutral shape given before his stats were read)
		const { sub, info } = realSubShape(latest, seedForExisting(p), lean);
		latest.sub = sub;
		p.subP = info;
		changed = true;
	} else if (!p.subP || p.subP.v !== SUB_RATINGS_VERSION) {
		const { sub, info } = neutralSubShape(latest, seedForExisting(p));
		p.subP = info;
		if (!isValidSubArray(latest.sub)) {
			latest.sub = sub;
		}
		changed = true;
	} else if (isPending(p.subP)) {
		generateFor(p);
		changed = true;
	} else if (!isValidSubArray(latest.sub)) {
		latest.sub = neutralSubShape(latest, p.subP.s).sub;
		changed = true;
	}
	if (syncRowSubs(latest)) {
		changed = true;
	}
	const offsets = subOffsets(latest.sub, latest);
	const first = Math.max(0, p.ratings.length - SUB_HISTORY);
	for (let i = p.ratings.length - 2; i >= first; i--) {
		const r = p.ratings[i];
		if (!isValidSubArray(r.sub)) {
			r.sub = fitSubsToBases(
				offsets.map((o, j) => (r[SUB_BASES_OF[j]!] ?? 50) + o),
				r,
			);
			changed = true;
		}
	}
	return changed;
};

const SUB_BASES_OF: string[] = SUB_DEFS.map((d) => d.base);

// The bases of a row, before development (SUB_BASES order)
export const basesBefore = (r: any): number[] | undefined =>
	isValidSubArray(r.sub) ? SUB_BASES.map((b) => r[b]) : undefined;

// After one season of stock development of a row: develop its subs
export const developRowSubs = (
	p: PlayerLike,
	r: any,
	before: number[],
	age: number,
) => {
	if (!p.subP || isPending(p.subP) || !isValidSubArray(r.sub)) {
		return;
	}
	r.sub = developSubs(r.sub, r, before, age, p.subP);
};

// After anything else changed the bases of his latest row (a bonus, an edit, an injury, the mentor bonus): subs follow
export const syncLatestSubs = (p: PlayerLike) => {
	if (!subRatingsOn()) {
		return;
	}
	const r = p.ratings.at(-1);
	if (isValidSubArray(r.sub)) {
		syncRowSubs(r);
	}
};

// Only the last SUB_HISTORY rows keep their sub-ratings
export const pruneSubHistory = (p: PlayerLike) => {
	const last = p.ratings.length - SUB_HISTORY;
	for (let i = 0; i < last; i++) {
		if (p.ratings[i].sub !== undefined) {
			delete p.ratings[i].sub;
		}
	}
};

// A class of generated prospects, once its ratings, ages and origins are final (the end of generation, after its class shape, after a
// regeneration of its ratings): each prospect's shape is (re)generated with his background, and at most MAX_GENERATIONAL extreme shapes
// are kept (the rest are scaled down). Deterministic: the same class gives the same shapes. force: also prospects already given theirs.
export const assignClassSubs = (players: PlayerLike[], force = true) => {
	if (!subRatingsOn()) {
		return;
	}
	const targets = players.filter(
		(p) =>
			p.tid === PLAYER.UNDRAFTED &&
			p.subP !== undefined &&
			p.subP.n === undefined &&
			(force || p.subP.c === undefined || isPending(p.subP)),
	);
	const extreme: { p: PlayerLike; m: number }[] = [];
	for (const p of targets) {
		generateFor(p);
		p.subP!.c = 1;
		const r = p.ratings.at(-1);
		const m = maxOffset(r.sub, r);
		if (m >= GENERATIONAL_OFFSET) {
			extreme.push({ p, m });
		}
	}
	if (extreme.length > MAX_GENERATIONAL) {
		// Keep the most extreme ones (the class's generational shapes), scale the rest down until they are not
		extreme.sort((a, b) => b.m - a.m);
		for (const { p } of extreme.slice(MAX_GENERATIONAL)) {
			for (const damp of [0.8, 0.65, 0.5, 0.35]) {
				generateFor(p, damp);
				p.subP!.c = 1;
				const r = p.ratings.at(-1);
				if (maxOffset(r.sub, r) < GENERATIONAL_OFFSET) {
					break;
				}
			}
		}
	}
};

export const subArrayLength = NUM_SUBS;

// His ratings were rewritten (the ratings regenerator, restoring his original ratings): a generated prospect gets his shape again from
// the new ratings (his build may have changed), anyone else keeps his shape on the new bases
export const subsAfterRewrite = (p: PlayerLike) => {
	if (!subRatingsOn()) {
		return;
	}
	ensureSubs(p);
	assignClassSubs([p]);
};

// Scouting fuzz on sub-ratings. Each sub gets the row's fuzz (like its base) plus its own deterministic part, up to 0.8x the row's fuzz
// either way, so the shape of a player's game is uncertain too, not just its level; since it scales with the row's fuzz, a better
// scouting level (front office scouting, scouting budget, a class aging) narrows it like the bases'. Subs the draft combine measures
// (standing reach and max vertical from the verticals, lateral quickness from the lane agility drill, shot blocking from the wingspan)
// keep a third of it once he was measured there. No fuzz in God Mode or multi team mode (getFuzz), like the bases.
const COMBINE_SUBS = new Set(
	["stj", "mxv", "lat", "blk"].map((k) =>
		SUB_DEFS.findIndex((d) => d.key === k),
	),
);
const COMBINE_FUZZ = 0.35;
const SHAPE_FUZZ = 0.8;

// Deterministic in [-1, 1] from the row's fuzz (a float unique to the player and season) and the sub
const shapeNoise = (fuzz: number, i: number) => {
	const x = Math.sin(fuzz * 12.9898 + (i + 1) * 78.233) * 43758.5453;
	return 2 * (x - Math.floor(x)) - 1;
};

export const fuzzSubs = (
	sub: readonly number[],
	rowFuzz: number | undefined,
	p?: { combine?: unknown },
	forceFuzz?: boolean,
): number[] => {
	const fuzz = getFuzz(rowFuzz ?? 0, forceFuzz);
	if (fuzz === 0) {
		return [...sub];
	}
	const measured = p?.combine !== undefined;
	return sub.map((x, i) => {
		let f = fuzz + SHAPE_FUZZ * Math.abs(fuzz) * shapeNoise(fuzz, i);
		if (measured && COMBINE_SUBS.has(i)) {
			f *= COMBINE_FUZZ;
		}
		return applyFuzz(x, f);
	});
};
