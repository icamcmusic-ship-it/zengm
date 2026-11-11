import {
	DRAFT_CLASS_SHAPES,
	NUDGES,
	SHAPE_COUNTRIES,
	drawDraftClassShape,
	isDraftClassShape,
	planDraftClassShape,
	type DraftClassShape,
} from "../../../common/draftClassShape.ts";
import { Rng } from "../../../common/collegeStats/rng.ts";
import { helpers } from "../../../common/helpers.ts";
import { PLAYER } from "../../../common/constants.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { player } from "../index.ts";
import type { Player, PlayerWithoutKey } from "../../../common/types.ts";
import { ballSecurityBase } from "../../../common/expandedRatings.ts";
import {
	expandedRatingsApply,
	setReboundSplit,
	setShootingSplit,
	syncExpandedToCompat,
} from "../player/expandedRatings.ts";

/**
 * Draft class shapes (see common/draftClassShape.ts). A class the game generates from scratch is marked "pending" when it is made (genPlayersWithoutSaving), and processNewDraftClasses gives it its shape before anything else happens to it (re-randomizing, college stats), so the shape is applied once and everything after builds on it. Imported, uploaded and topped-off classes are never marked, so never reshaped.
 */

export const PENDING_SHAPE = "pending";

// Mark a class generated from scratch (basketball only)
export const markNewClass = (players: PlayerWithoutKey[]) => {
	if (__SPORT !== "basketball") {
		return;
	}
	for (const p of players) {
		p.draftClassShape = PENDING_SHAPE;
	}
};

const SKILL_KEYS = [
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

// Shift the skill ratings (not height) until his ovr is target
const shiftToOvr = (ratings: any, target: number) => {
	const base: Record<string, number> = {};
	for (const key of SKILL_KEYS) {
		base[key] = ratings[key];
	}
	const set = (shift: number) => {
		for (const key of SKILL_KEYS) {
			ratings[key] = clampRating(base[key]! + shift);
		}
		return player.ovr(ratings);
	};
	// ovr goes up with the shift: bisect for the shift closest to the target
	let lo = -40;
	let hi = 40;
	for (let i = 0; i < 12; i++) {
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

const applyNudge = (p: Player, kind: "guard" | "wing" | "big") => {
	const ratings = p.ratings.at(-1) as any;
	const pos = ratings.pos as string;
	let nudge: (typeof NUDGES)["guard" | "big"];
	let scale = 1;
	if (kind === "wing") {
		// From either end toward the middle
		nudge = ["PG", "SG", "G"].includes(pos) ? NUDGES.big : NUDGES.guard;
		scale = 0.7;
	} else {
		nudge = NUDGES[kind];
	}
	const ovr = player.ovr(ratings);
	for (const [key, delta] of Object.entries(nudge.ratings)) {
		ratings[key] = clampRating(ratings[key] + scale * delta);
	}
	p.hgt = Math.round(p.hgt + scale * nudge.inches);
	p.weight = Math.round(p.weight + scale * nudge.weight);
	shiftToOvr(ratings, ovr);
};

export const getClassSeed = (draftYear: number) =>
	`${g.get("lid")}-${draftYear}-class-shape`;

/**
 * Give the pending prospects of a class their shape. Returns the shape, or undefined if nothing was pending.
 */
export const applyPendingShape = async (
	draftYear: number,
	// Tests: this shape instead of the drawn one
	force?: DraftClassShape,
): Promise<DraftClassShape | undefined> => {
	const players = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
	).filter((p) => p.draft.year === draftYear);
	const pending = players.filter((p) => p.draftClassShape === PENDING_SHAPE);
	if (pending.length === 0) {
		return undefined;
	}
	if (!featureOn("draftClassShapes")) {
		for (const p of pending) {
			delete p.draftClassShape;
			await idb.cache.players.put(p);
		}
		return undefined;
	}

	const seed = getClassSeed(draftYear);
	const shape = force ?? drawDraftClassShape(seed);
	const ordered = [...pending].sort(
		(a, b) => b.value - a.value || a.pid - b.pid,
	);
	const draftAges = g.get("draftAges");
	const changes = planDraftClassShape(
		shape,
		seed,
		ordered.map((p) => {
			const ratings = p.ratings.at(-1)!;
			return {
				key: String(p.pid),
				ovr: ratings.ovr,
				age: draftYear - p.born.year,
				pos: ratings.pos,
				international:
					!helpers.isAmerican(p.born.loc) && !p.born.loc.endsWith("Canada"),
			};
		}),
		[draftAges[0], draftAges[1]],
	);
	const byPid = new Map(ordered.map((p) => [String(p.pid), p]));
	const countryRng = new Rng(`${seed}|countries`);
	for (const c of changes) {
		const p = byPid.get(c.key)!;
		const ratings = p.ratings.at(-1) as any;
		// Expanded ratings: his ball security keeps its place relative to his handle and IQ, and a guard/big nudge tilts his
		// rebounding and shooting splits (then they follow reb and fg + tp, and pdef/idef follow diq)
		const expanded = expandedRatingsApply(ratings);
		const bscResidual = expanded ? ratings.bsc - ballSecurityBase(ratings) : 0;
		if (c.nudge) {
			applyNudge(p, c.nudge);
			if (expanded) {
				const tilt = c.nudge === "big" ? 2 : c.nudge === "guard" ? -2 : 0;
				setReboundSplit(ratings, ratings.oreb - ratings.dreb + tilt);
				setShootingSplit(ratings, ratings.csh - ratings.dsh + tilt);
			}
		}
		if (c.ovr !== 0) {
			shiftToOvr(ratings, player.ovr(ratings) + c.ovr);
		}
		if (expanded) {
			ratings.bsc = clampRating(ballSecurityBase(ratings) + bscResidual);
			syncExpandedToCompat(ratings);
		}
		if (c.age !== 0) {
			p.born.year -= c.age;
		}
		if (c.international) {
			const country =
				SHAPE_COUNTRIES[
					Math.floor(countryRng.random() * SHAPE_COUNTRIES.length)
				]!;
			const name = await player.name(country);
			if (name.country === country) {
				// A name from his new country (custom player bio info might not have it)
				p.firstName = name.firstName;
				p.lastName = name.lastName;
			}
			p.born.loc = country;
			p.college = "";
		}
		// ovr, pot, position and skills from the new ratings and age
		await player.develop(p, 0, true);
		await player.updateValues(p);
	}
	for (const p of pending) {
		p.draftClassShape = shape;
		await idb.cache.players.put(p);
	}
	return shape;
};

/**
 * The shape of a class from its prospects (the most common one), for the views. undefined if it has none.
 */
export const getClassShape = (
	players: { draftClassShape?: string }[],
): { key: DraftClassShape; name: string; description: string } | undefined => {
	const counts = new Map<DraftClassShape, number>();
	for (const p of players) {
		if (isDraftClassShape(p.draftClassShape)) {
			counts.set(p.draftClassShape, (counts.get(p.draftClassShape) ?? 0) + 1);
		}
	}
	const best = [...counts].sort((a, b) => b[1] - a[1])[0];
	if (!best) {
		return undefined;
	}
	const { name, description } = DRAFT_CLASS_SHAPES[best[0]];
	return { key: best[0], name, description };
};
