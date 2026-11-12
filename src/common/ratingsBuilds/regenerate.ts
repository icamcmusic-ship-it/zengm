// The ratings regenerator: rebuild a class (or one player) into varied, specialized builds without changing anyone's
// overall. Pure and deterministic: same seed + settings + inputs = same results.

import { archetypeToBuild, personalizeSeed } from "../archetypes/target.ts";
import {
	ARCHETYPES as NEW_ARCHETYPES,
	classify,
} from "../archetypes/classify.ts";
import { gateFactor } from "../archetypes/score.ts";
import { archetypePrior, isPos, positionOf } from "../archetypes/position.ts";
import { scoreAll } from "../archetypes/classify.ts";
import type { Norms } from "../archetypes/types.ts";
import { scoutingEffectCutoff, scoutingEffectStddev } from "../budgetLevels.ts";
import { Rng, clamp } from "./rng.ts";
import {
	archetypeByName,
	newDrawCounts,
	pickArchetype,
	pickClassPool,
	pickFlavor,
	planBalanced,
	TOP_OF_BOARD,
	type PlayerBio,
} from "./selection.ts";
import { normalizeSettings, type BuildSettings } from "./settings.ts";
import {
	RATING_KEYS,
	rebuildRatings,
	type Formulas,
	type Pinned,
} from "./solver.ts";
import type { BuildRatings, RatingKey } from "./types.ts";

// Per-player locks
export type PlayerLock = {
	// Leave him exactly as he is
	skip?: boolean;

	// Build him to this overall instead of the one he has
	ovr?: number;
	pot?: number;

	// Force this build
	build?: string;

	// Aim at this archetype (an id from src/common/archetypes) instead of drawing a build
	archetype?: string;

	// Pinned ratings: taken literally and never shifted
	ratings?: Partial<Record<RatingKey, number>>;

	// "Reroll just him": salts only his streams
	reroll?: number;
};

export type PlayerInput = {
	// Unique and stable (the pid), every stream and lock is derived from it
	key: string;

	// The base ratings to build from (true ratings, no fuzz applied)
	ratings: BuildRatings;
	fuzz: number;
	ovr: number;
	pot: number;
	age: number;
	hgtInches?: number;
	bio?: PlayerBio;
	lock?: PlayerLock;
};

export type PlayerState = {
	ratings: BuildRatings;
	fuzz: number;
	ovr: number;
	pot: number;
	pos: string;
	skills: string[];
	hgtInches?: number;
};

export type PlayerResult = {
	key: string;
	skipped: boolean;
	before: PlayerState;
	after: PlayerState;
	build: { name: string; tags: string[] };

	// The archetype his new ratings derive to (what the UI shows), and the one that was aimed at, if any
	derived: { id: string; name: string; label: string };
	// matched: he derives to it; inLabel: the same (a label is one build, there are no hybrid partners any more)
	target?: { id: string; name: string; matched: boolean; inLabel: boolean };

	// The overall he was asked to be built to
	targetOvr: number;

	// Signed distance from the asked-for overall to the one he was built to, non-zero when his height or his locks make it
	// unreachable
	ovrShortfall: number;
	changed: { key: RatingKey; before: number; after: number }[];
};

export type ClassResult = {
	flavor: { name: string; label: string; strength: number } | null;
	poolSize: number | null;
	// How many players got each build
	buildCounts: Record<string, number>;
	results: PlayerResult[];
};

// Salt that re-rolls one player, and the class-wide variation salt
const rerollSalt = (lock: PlayerLock | undefined) => {
	const n = Math.round(Number(lock?.reroll) || 0);
	return n > 0 ? `~${n}` : "";
};
const variationSalt = (s: BuildSettings) =>
	s.variation > 0 ? `/v${s.variation}` : "";

const HGT_MIN_INCHES = 64;
const HGT_MAX_INCHES = 92;

const state = (
	F: Formulas,
	ratings: BuildRatings,
	fuzz: number,
	ovr: number,
	pot: number,
	hgtInches: number | undefined,
): PlayerState => ({
	ratings,
	fuzz,
	ovr,
	pot,
	pos: F.pos(ratings),
	skills: F.skills({ ...ratings, fuzz }),
	hgtInches,
});

// Read with the game's position for these ratings (F.pos follows the league's position setting)
const derivedOf = (F: Formulas, ratings: BuildRatings, norms?: Norms) => {
	const c = classify(ratings, { norms, pos: F.pos(ratings) });
	return {
		id: c.id,
		name: c.name,
		label: c.label,
	};
};

const clampPot = (pot: number, ovr: number) => clamp(Math.round(pot), ovr, 100);

// Seeded scouting fuzz, the same distribution as the game's genFuzz
const genFuzzSeeded = (rng: Rng, scoutingLevel: number) => {
	const cutoff = scoutingEffectCutoff(scoutingLevel);
	const stddev = scoutingEffectStddev(scoutingLevel);
	const fuzz = rng.normal(0, stddev);
	return clamp(fuzz, -cutoff, cutoff);
};

export const regenerateClass = (
	F: Formulas,
	inputs: PlayerInput[],
	settingsInput: Partial<BuildSettings>,
	opts: { norms?: Norms } = {},
): ClassResult => {
	const s = normalizeSettings(settingsInput);
	const rng = new Rng(s.seed);
	const vsalt = variationSalt(s);

	// Class level streams deliberately do not take the variation salt
	const flavor = pickFlavor(rng.child("flavor"), s);
	const pool = pickClassPool(rng.child("pool"), s.buildsPerClass, flavor);

	// Board order: best overall first, ties broken by key
	const order = inputs
		.map((p, i) => ({ p, i }))
		.sort((a, b) => {
			if (b.p.ovr !== a.p.ovr) {
				return b.p.ovr - a.p.ovr;
			}
			return a.p.key < b.p.key ? -1 : a.p.key > b.p.key ? 1 : 0;
		});

	const counts = newDrawCounts();
	counts.balanced = planBalanced(
		rng.child(`balancedPlan${vsalt}`),
		order.length,
		s.diversity,
	);

	const results: (PlayerResult | undefined)[] = Array.from({
		length: inputs.length,
	});
	const buildCounts: Record<string, number> = {};
	const poolUsed: Record<string, number> = {};

	for (const [rank, { p, i }] of order.entries()) {
		const lock = p.lock;
		const salt = rerollSalt(lock);
		const prng = rng.child(`build:${p.key}${salt}${vsalt}`);

		const targetOvr = clamp(
			Math.round(lock?.ovr !== undefined ? lock.ovr : p.ovr),
			0,
			100,
		);

		// Height only moves if the user turned "keep heights" off. Its own stream, so the other draws do not move.
		let base = p.ratings;
		let hgtInches = p.hgtInches;
		if (!s.keepHeights && p.hgtInches !== undefined) {
			const srng = rng.child(`size:${p.key}${salt}${vsalt}`);
			const newInches = clamp(
				Math.round(p.hgtInches + srng.normal(0, 1.1)),
				HGT_MIN_INCHES,
				HGT_MAX_INCHES,
			);
			if (newInches !== p.hgtInches) {
				hgtInches = newInches;
				base = { ...p.ratings, hgt: F.heightToRating(newInches) };
			}
		}

		// The draw is made whether or not it is used, so forcing a build does not re-roll everything after it
		const rolled = pickArchetype(
			prng,
			base.hgt,
			s.diversity,
			flavor,
			pool,
			rank,
			p.bio,
			counts,
		);
		const forced = lock?.build ? archetypeByName(lock.build) : undefined;
		// Aiming at an archetype: a forced one, else drawn from the class's archetype pool (least used first) if he fits one
		let targetId: string | undefined = lock?.archetype;
		if (!targetId && !lock?.build && s.archetypePool.length > 0) {
			const fPos = F.pos(base);
			const basePos = isPos(fPos) ? fPos : positionOf(base);
			const fits = s.archetypePool.filter((id) => {
				const a = NEW_ARCHETYPES.find((x) => x.id === id);
				// Inside its height gate and not ruled out by his position (a guard is never aimed at a big archetype)
				return (
					a &&
					gateFactor(base.hgt, a.hgt) >= 0.6 &&
					archetypePrior(a, basePos) !== null
				);
			});
			if (fits.length > 0) {
				const arng = prng.child("archetypePool");
				const pick = arng.weighted(
					fits,
					(id) => 1 / (1 + (poolUsed[id] ?? 0)) ** 2,
				);
				poolUsed[pick] = (poolUsed[pick] ?? 0) + 1;
				targetId = pick;
			}
		}
		let aimed = !forced && targetId ? archetypeToBuild(targetId) : undefined;
		if (aimed && targetId) {
			aimed = archetypeToBuild(
				targetId,
				personalizeSeed(targetId, base, (r) => F.ovr(r), opts.norms),
			);
		}
		if (!aimed) {
			targetId = undefined;
		}
		const arch = forced ?? aimed ?? rolled;
		counts.n[arch.name] = (counts.n[arch.name] ?? 0) + 1;
		if (rank < TOP_OF_BOARD) {
			counts.top[arch.name] = (counts.top[arch.name] ?? 0) + 1;
		}

		let pinned: Pinned = null;
		if (lock?.ratings) {
			const pins: Partial<Record<RatingKey, number>> = {};
			for (const key of RATING_KEYS) {
				const v = lock.ratings[key];
				if (key !== "hgt" && v !== undefined && Number.isFinite(v)) {
					pins[key] = v;
				}
			}
			pinned = Object.keys(pins).length > 0 ? pins : null;
		}

		const run = (specialization: number, rng: Rng, using = arch) =>
			rebuildRatings(F, rng, base, targetOvr, using, pinned, {
				specialization,
				buildNoise: s.buildNoise,
				skillCap: s.skillCap,
				physCap: s.physCap,
				signatureSkills: s.signatureSkills,
				fuzz: p.fuzz,
			});
		let built = run(s.specialization, prng);

		// An aimed archetype is checked against what the ratings now derive to. If it missed, lean in harder (and re-jitter)
		// a few times and keep the attempt that fits the target best.
		let matched = false;
		if (aimed && targetId && !lock?.skip) {
			const fit = (r: BuildRatings) => {
				const sc = scoreAll(r, opts.norms).scored;
				const i = sc.findIndex((x) => x.a.id === targetId);
				return { matched: i === 0, z: sc[i]!.z - sc[0]!.z };
			};
			let best = fit(built.ratings);
			matched = best.matched;
			// What the solver did to his ratings (caps, the overall) is then corrected for: the missing push is added to the offsets
			const acc: Partial<Record<RatingKey, number>> = { ...aimed!.o };
			for (let n = 0; n < 4; n++) {
				if (matched) {
					break;
				}
				const corr = personalizeSeed(
					targetId,
					built.ratings,
					(r) => F.ovr(r),
					opts.norms,
					300,
					{},
				);
				for (const k of Object.keys(corr) as RatingKey[]) {
					acc[k] = (acc[k] ?? 0) + corr[k]! * (1 + 0.35 * n);
				}
				const attempt = run(
					Math.max(s.specialization, 1),
					prng.child(`aim${n}`),
					archetypeToBuild(targetId, { ...acc })!,
				);
				const f = fit(attempt.ratings);
				const closer =
					attempt.ovr === built.ovr || attempt.shortfall <= built.shortfall;
				if (closer && (f.matched || f.z > best.z)) {
					built = attempt;
					best = f;
					matched = f.matched;
				}
			}
		}
		const ovr = F.ovr(built.ratings);

		let fuzz = p.fuzz;
		if (s.fuzz === "zero") {
			fuzz = 0;
		} else if (s.fuzz === "regenerate") {
			fuzz = genFuzzSeeded(
				rng.child(`fuzz:${p.key}${salt}${vsalt}`),
				s.scoutingLevel,
			);
		}

		let pot = p.pot;
		if (s.pot === "estimate") {
			pot = F.potEstimate(ovr, p.age);
		} else if (s.pot === "build") {
			pot = p.pot + arch.pot;
		}
		if (lock?.pot !== undefined && Number.isFinite(lock.pot)) {
			pot = lock.pot;
		}
		pot = clampPot(pot, ovr);

		const before = state(F, p.ratings, p.fuzz, p.ovr, p.pot, p.hgtInches);
		const skipped = !!lock?.skip;
		const after = skipped
			? before
			: state(F, built.ratings, fuzz, ovr, pot, hgtInches);

		const changed: PlayerResult["changed"] = [];
		for (const key of RATING_KEYS) {
			if (before.ratings[key] !== after.ratings[key]) {
				changed.push({
					key,
					before: before.ratings[key],
					after: after.ratings[key],
				});
			}
		}

		if (!skipped) {
			buildCounts[arch.name] = (buildCounts[arch.name] ?? 0) + 1;
		}

		results[i] = {
			key: p.key,
			skipped,
			before,
			after,
			build: { name: arch.name, tags: arch.tags },
			derived: derivedOf(F, after.ratings, opts.norms),
			target:
				aimed && targetId
					? {
							id: targetId,
							name: aimed.name,
							matched,
							inLabel: matched,
						}
					: undefined,
			targetOvr,
			ovrShortfall: skipped ? 0 : built.shortfall,
			changed,
		};
	}

	return {
		flavor: flavor
			? { name: flavor.name, label: flavor.label, strength: flavor.strength }
			: null,
		poolSize: pool ? pool.length : null,
		buildCounts,
		results: results as PlayerResult[],
	};
};

// A class of one, for a single player outside a draft class (Customize Player): every build is eligible and he is never
// left Balanced unless diversity says so
export const regenerateOne = (
	F: Formulas,
	input: PlayerInput,
	settingsInput: Partial<BuildSettings>,
	opts: { norms?: Norms } = {},
): PlayerResult => {
	const result = regenerateClass(
		F,
		[input],
		{
			...settingsInput,
			buildsPerClass: 0,
			diversity: settingsInput.diversity ?? 100,
		},
		opts,
	);
	return result.results[0]!;
};
