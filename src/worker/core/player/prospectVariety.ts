// Prospect variety, worker side (see common/prospectVariety.ts): ovr-neutral reshaping of a ratings row, and the class-level steps of a new
// draft class (senior polish, near-duplicates, archetype mix), all from seeded streams.
import { g, helpers } from "../../util/index.ts";
import {
	agingCurveDelta,
	agingCurveForPlayer,
} from "../../../common/playerTraits/development.ts";
import { ovrRaw } from "./ovr.basketball.ts";
import {
	expandedRatingsApply,
	syncExpandedToCompat,
} from "./expandedRatings.ts";
import { ballSecurityBase } from "../../../common/expandedRatings.ts";
import {
	ARCHETYPE_STEER,
	NEAR_DUPLICATE,
	profileCosine,
	SENIOR_POLISH,
	type GenVariety,
} from "../../../common/prospectVariety.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import {
	NOUN_RATING,
	nounScores,
} from "../../../common/archetypes/v2/nouns.ts";
import type { PlayerWithoutKey } from "../../../common/types.ts";

// Tests of the game simulation's own mechanics (simLiveGameForTests.ts) were calibrated on a fixed population of generated players; they
// generate with the stock rating draw (no variety seed, so nothing after it either). Not a setting: nothing else can reach it.
let stockGeneration = false;
export const stockGenerationForTests = () => stockGeneration;
export const withStockGeneration = async <T>(fn: () => T | Promise<T>) => {
	const before = stockGeneration;
	stockGeneration = true;
	try {
		return await fn();
	} finally {
		stockGeneration = before;
	}
};

export const SKILL_KEYS = [
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
] as const;

const clampRating = (x: number) => helpers.bound(Math.round(x), 0, 100);

/**
 * Shift his skill ratings (not height, and not the ones in `exclude`) by one amount until his ovr before rounding (ovrRaw) is target. With
 * expanded ratings the split ratings follow (syncExpandedToCompat) and ball security keeps its place relative to handle and IQ. Used for
 * reshaping a prospect without changing how good he is.
 */
export const shiftToRawOvr = (
	ratings: any,
	target: number,
	exclude: ReadonlySet<string> = new Set(),
) => {
	const expanded = expandedRatingsApply(ratings);
	const bscResidual = expanded ? ratings.bsc - ballSecurityBase(ratings) : 0;
	const keys = SKILL_KEYS.filter((k) => !exclude.has(k));
	const base: Record<string, number> = {};
	for (const key of keys) {
		base[key] = ratings[key];
	}
	// The whole part of the shift goes to every rating and the fraction to that share of them (rounding every rating the same way would only
	// reach his ovr within about half a point)
	const set = (shift: number) => {
		const whole = Math.floor(shift);
		const extra = Math.round((shift - whole) * keys.length);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i]!;
			ratings[key] = clampRating(base[key]! + whole + (i < extra ? 1 : 0));
		}
		if (expanded) {
			syncExpandedToCompat(ratings);
			ratings.bsc = clampRating(ballSecurityBase(ratings) + bscResidual);
		}
		return ovrRaw(ratings);
	};
	let lo = -40;
	let hi = 40;
	for (let i = 0; i < 14; i++) {
		const mid = (lo + hi) / 2;
		if (set(mid) < target) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	const below = set(lo);
	const above = set(hi);
	set(Math.abs(above - target) <= Math.abs(target - below) ? hi : lo);
};

/**
 * Add rating deltas to a row, then put his ovr (before rounding) back where it was by shifting his other skill ratings. Returns nothing; the
 * caller recomputes ovr/pot/pos (develop with 0 years) when the row is a stored player's.
 */
export const reshapeKeepingOvr = (
	ratings: any,
	deltas: Record<string, number>,
) => {
	const target = ovrRaw(ratings);
	const expanded = expandedRatingsApply(ratings);
	const bscResidual = expanded ? ratings.bsc - ballSecurityBase(ratings) : 0;
	for (const [key, delta] of Object.entries(deltas)) {
		ratings[key] = clampRating(ratings[key] + delta);
	}
	if (expanded) {
		syncExpandedToCompat(ratings);
		ratings.bsc = clampRating(ballSecurityBase(ratings) + bscResidual);
	}
	shiftToRawOvr(ratings, target, new Set(Object.keys(deltas)));
};

const genVarOf = (p: PlayerWithoutKey) => (p as { genVar?: GenVariety }).genVar;

// Seniors: polish (IQ, ovr kept) and a lower ceiling (development rates)
export const polishSenior = (p: PlayerWithoutKey) => {
	const gv = genVarOf(p);
	if (!gv) {
		return;
	}
	const rng = new Rng(`seniorPolish|${gv.s}`);
	const scale = rng.uniform(0.5, 1.5);
	const deltas: Record<string, number> = {};
	for (const [key, d] of Object.entries(SENIOR_POLISH.ratings)) {
		deltas[key] = Math.round(scale * d);
	}
	reshapeKeepingOvr(p.ratings.at(-1), deltas);
	gv.c = SENIOR_POLISH.ceiling;
};

/**
 * Near-identical prospects in a class (same position, about the same ovr, almost the same centered profile): the later one gets a few
 * points moved from one of his ratings to another (ovr kept). Returns the players changed.
 */
export const separateNearDuplicates = (players: PlayerWithoutKey[]) => {
	const changed = new Set<PlayerWithoutKey>();
	for (let i = 0; i < players.length; i++) {
		for (let j = i + 1; j < players.length; j++) {
			const a = players[i]!.ratings.at(-1) as any;
			const b = players[j]!.ratings.at(-1) as any;
			if (
				a.pos !== b.pos ||
				Math.abs(a.ovr - b.ovr) > NEAR_DUPLICATE.ovr ||
				Math.abs(a.hgt - b.hgt) > 4 ||
				profileCosine(a, b, SKILL_KEYS) < NEAR_DUPLICATE.cosine
			) {
				continue;
			}
			const p = players[j]!;
			const gv = genVarOf(p);
			if (!gv) {
				continue;
			}
			const rng = new Rng(`nearDuplicate|${gv.s}|${changed.size}`);
			const up = rng.pick(SKILL_KEYS);
			const down = rng.pick(SKILL_KEYS.filter((k) => k !== up));
			reshapeKeepingOvr(b, {
				[up]: NEAR_DUPLICATE.nudge,
				[down]: -NEAR_DUPLICATE.nudge,
			});
			changed.add(p);
		}
	}
	return [...changed];
};

/**
 * Light archetype-mix steering: the archetype engine's lead skill (noun, read-only) of each prospect in the drafted part of the class; when
 * one lead skill is crowded, a few of its holders get a little more of their second-best skill (ovr kept), so labels don't pile up in a few.
 * Bounded: ARCHETYPE_STEER.maxSteered prospects per class. Returns the players changed.
 */
export const steerArchetypeMix = (players: PlayerWithoutKey[]) => {
	const pool = [...players]
		.sort((a, b) => b.ratings.at(-1)!.pot - a.ratings.at(-1)!.pot)
		.slice(0, ARCHETYPE_STEER.pool);
	const leads = pool.map((p) => {
		// The base ratings only (never sub-ratings or expanded ratings, so turning those on doesn't change who is steered)
		const r = p.ratings.at(-1) as any;
		const base: Record<string, number> = { hgt: r.hgt };
		for (const key of SKILL_KEYS) {
			base[key] = r[key];
		}
		const scores = nounScores(base as any);
		return { p, lead: scores[0]!.key, second: scores[1]!.key };
	});
	const counts = new Map<string, number>();
	for (const { lead } of leads) {
		counts.set(lead, (counts.get(lead) ?? 0) + 1);
	}
	const cap = Math.ceil(ARCHETYPE_STEER.maxShare * pool.length);
	const changed: PlayerWithoutKey[] = [];
	for (const { p, lead, second } of leads.toReversed()) {
		if (changed.length >= ARCHETYPE_STEER.maxSteered) {
			break;
		}
		const gv = genVarOf(p);
		if (!gv || (counts.get(lead) ?? 0) <= cap) {
			continue;
		}
		const upKey = NOUN_RATING[second] as string;
		const downKey = NOUN_RATING[lead] as string;
		if (upKey === downKey || upKey === "hgt" || downKey === "hgt") {
			continue;
		}
		reshapeKeepingOvr(p.ratings.at(-1), {
			[upKey]: ARCHETYPE_STEER.points,
			[downKey]: -ARCHETYPE_STEER.points,
		});
		counts.set(lead, counts.get(lead)! - 1);
		changed.push(p);
	}
	return changed;
};

/**
 * The hidden trajectory before the draft: a prospect's aging curve (early bloomers grow faster when young, late bloomers slower) also acts on
 * the seasons he developed before the draft, which happen before he has a pid (genPlayersWithoutSaving records their ages). Applied once,
 * when his class is processed after being saved. Centered over the league at every age (agingCurveDelta), so classes are as good as before.
 * Returns true if his ratings changed (the caller recomputes ovr/pot and value).
 */
export const applyPreDraftTrajectory = (p: {
	pid: number;
	genVar?: GenVariety;
	ratings: any[];
}) => {
	const gv = p.genVar;
	if (!gv?.pre) {
		return false;
	}
	const ages = gv.pre;
	delete gv.pre;
	let seed: number | string = 0;
	try {
		seed = g.get("playerTraitsSeed") ?? 0;
	} catch {
		seed = 0;
	}
	const curve = agingCurveForPlayer(seed, p.pid);
	let delta = 0;
	for (const age of ages) {
		delta += agingCurveDelta(curve, age);
	}
	if (Math.abs(delta) < 0.25) {
		return false;
	}
	const ratings = p.ratings.at(-1);
	const rng = new Rng(`preDraftTrajectory|${gv.s}`);
	const expanded = expandedRatingsApply(ratings);
	const bscResidual = expanded ? ratings.bsc - ballSecurityBase(ratings) : 0;
	for (const key of SKILL_KEYS) {
		// Like a season's development: the same base change, scaled per rating
		ratings[key] = clampRating(ratings[key] + delta * rng.uniform(0.4, 1.4));
	}
	if (expanded) {
		syncExpandedToCompat(ratings);
		ratings.bsc = clampRating(ballSecurityBase(ratings) + bscResidual);
	}
	return true;
};
