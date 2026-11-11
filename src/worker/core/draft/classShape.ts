import {
	DRAFT_CLASS_SHAPES,
	DRAFT_CLASS_SHAPE_VERSION,
	NUDGES,
	SHAPE_COUNTRIES,
	describeDraftClassShape,
	drawDraftClassShape,
	isDraftClassShape,
	planDraftClassShape,
	type DraftClassShape,
	type ExpandedTilt,
	type NudgeKind,
} from "../../../common/draftClassShape.ts";
import {
	COLLEGES,
	CONFERENCES,
} from "../../../common/collegeStats/colleges.ts";
import { clampSeed, seedKey } from "../../../common/playerTraits/index.ts";
import { ensureTraits, traitsEnabled } from "../player/traits.ts";
import { Rng } from "../../../common/collegeStats/rng.ts";
import { helpers } from "../../../common/helpers.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	getClassProfile,
	rankProspects,
	writeClassHeadline,
	writeClassStorylines,
	type ClassProfile,
	type StoryProspect,
} from "../../../common/draftClassStory.ts";
import {
	NCAA_SCORING,
	NCAA_SHAPES,
	ncaaClassTie,
} from "../../../common/collegeStats/ncaaStoryline.ts";
import { idb } from "../../db/index.ts";
import { g, logEvent } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { player } from "../index.ts";
import type {
	Conditions,
	Player,
	PlayerWithoutKey,
} from "../../../common/types.ts";
import { ballSecurityBase } from "../../../common/expandedRatings.ts";
import {
	expandedRatingsApply,
	setDefenseSplit,
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

// Change his ratings, height and weight toward a kind of player (his ovr is put back afterwards). Returns the expanded ratings tilt
const applyNudge = (p: Player, kind: NudgeKind): ExpandedTilt => {
	const ratings = p.ratings.at(-1) as any;
	const pos = ratings.pos as string;
	let nudge: (typeof NUDGES)[keyof typeof NUDGES];
	let scale = 1;
	if (kind === "wing") {
		// From either end toward the middle
		nudge = ["PG", "SG", "G"].includes(pos) ? NUDGES.big : NUDGES.guard;
		scale = 0.7;
	} else {
		nudge = NUDGES[kind];
	}
	for (const [key, delta] of Object.entries(nudge.ratings)) {
		ratings[key] = clampRating(ratings[key] + scale * delta!);
	}
	p.hgt = Math.round(p.hgt + scale * nudge.inches);
	p.weight = Math.round(p.weight + scale * nudge.weight);
	return kind === "wing" ? {} : nudge.tilt;
};

// Schools outside the power conferences, for the mid-major class
let midMajors: { names: string[]; weights: number[] } | undefined;
const getMidMajors = () => {
	if (!midMajors) {
		midMajors = { names: [], weights: [] };
		for (const [name, [freq, conf]] of Object.entries(COLLEGES)) {
			const tier = CONFERENCES[conf]?.tier;
			if (tier && tier !== "high") {
				midMajors.names.push(name);
				// The better mid-majors produce more pros
				midMajors.weights.push((freq + 0.5) ** 0.5 * (tier === "mid" ? 2 : 1));
			}
		}
	}
	return midMajors;
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
	const schoolRng = new Rng(`${seed}|schools`);
	for (const c of changes) {
		const p = byPid.get(c.key)!;
		const ratings = p.ratings.at(-1) as any;
		// Expanded ratings: his ball security keeps its place relative to his handle and IQ, and a nudge tilts his wingspan and his defense, rebounding and shooting splits (then they follow diq, reb and fg + tp)
		const expanded = expandedRatingsApply(ratings);
		const bscResidual = expanded ? ratings.bsc - ballSecurityBase(ratings) : 0;
		const ovr = player.ovr(ratings);
		const tilt: Required<ExpandedTilt> = {
			wng: 0,
			def: 0,
			reb: 0,
			shoot: 0,
			bsc: 0,
		};
		const hgtBefore = ratings.hgt;
		for (const kind of c.nudges ?? []) {
			const t = applyNudge(p, kind);
			for (const key of Object.keys(tilt) as (keyof ExpandedTilt)[]) {
				tilt[key] += t[key] ?? 0;
			}
		}
		if (expanded && c.nudges) {
			// Wingspan grows with height
			ratings.wng = clampRating(
				ratings.wng + (ratings.hgt - hgtBefore) + tilt.wng,
			);
			syncExpandedToCompat(ratings);
			setDefenseSplit(ratings, ratings.pdef - ratings.idef + tilt.def);
			setReboundSplit(ratings, ratings.oreb - ratings.dreb + tilt.reb);
			setShootingSplit(ratings, ratings.csh - ratings.dsh + tilt.shoot);
		}
		if (c.nudges || c.ovr !== 0) {
			// Twice, because ball security (in his ovr with expanded ratings) follows the ratings the shift moves
			for (let i = 0; i < (expanded ? 2 : 1); i++) {
				shiftToOvr(ratings, ovr + c.ovr);
				if (expanded) {
					ratings.bsc = clampRating(
						ballSecurityBase(ratings) + bscResidual + tilt.bsc,
					);
				}
			}
		} else if (expanded) {
			ratings.bsc = clampRating(ballSecurityBase(ratings) + bscResidual);
		}
		if (expanded) {
			syncExpandedToCompat(ratings);
		}
		if (c.age !== 0) {
			p.born.year -= c.age;
		}
		if (c.international) {
			const country =
				c.country ??
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
			// Canadians still go to college in the US
			if (country !== "Canada") {
				p.college = "";
			}
		}
		if (c.midMajor) {
			const { names, weights } = getMidMajors();
			p.college = schoolRng.weighted(names, weights);
		}
		if (c.injury) {
			p.draftClassShapeInjury = true;
			// A little less durable (Player Traits)
			if (traitsEnabled()) {
				ensureTraits(p);
				if (p.traits) {
					const key = seedKey("durability");
					p.traits[key] = clampSeed((p.traits[key] ?? 0) - 0.6);
				}
			}
		}
		// ovr, pot, position and skills from the new ratings and age
		await player.develop(p, 0, true);
		await player.updateValues(p);
	}
	for (const p of pending) {
		p.draftClassShape = shape;
		p.draftClassShapeV = DRAFT_CLASS_SHAPE_VERSION;
		await idb.cache.players.put(p);
	}
	return shape;
};

/**
 * The shape of a class from its prospects (the most common one) and the version it was given with. undefined if it has none.
 */
export const getClassShape = (
	players: { draftClassShape?: string; draftClassShapeV?: number }[],
): { key: DraftClassShape; version: number } | undefined => {
	const counts = new Map<DraftClassShape, number>();
	let version = 1;
	for (const p of players) {
		if (isDraftClassShape(p.draftClassShape)) {
			counts.set(p.draftClassShape, (counts.get(p.draftClassShape) ?? 0) + 1);
		}
	}
	const best = [...counts].sort((a, b) => b[1] - a[1])[0];
	if (!best) {
		return undefined;
	}
	for (const p of players) {
		if (p.draftClassShape === best[0] && p.draftClassShapeV !== undefined) {
			version = Math.max(version, p.draftClassShapeV);
		}
	}
	return { key: best[0], version };
};

export const toStoryProspect = (
	p: Player,
	draftYear: number,
): StoryProspect => {
	const ratings = p.ratings.at(-1)!;
	return {
		pid: p.pid,
		name: `${p.firstName} ${p.lastName}`.trim(),
		age: draftYear - p.born.year,
		pos: ratings.pos,
		country: helpers.getCountry(p.born.loc),
		college: p.college ?? "",
		ovr: ratings.ovr,
		pot: ratings.pot,
		value: p.value,
		...(p.draftClassShapeInjury ? { injury: true } : {}),
	};
};

// Earlier classes at their drafts (their draft year's ratings), for "the best class since 2031". Past classes do not change, so they are kept
const HISTORY_YEARS = 15;
const historyCache = new Map<string, ClassProfile | null>();
export const getClassHistory = async (
	draftYear: number,
): Promise<ClassProfile[]> => {
	const output: ClassProfile[] = [];
	for (let year = draftYear - HISTORY_YEARS; year < draftYear; year++) {
		const key = `${g.get("lid")}|${year}`;
		let profile = historyCache.get(key);
		if (profile === undefined) {
			const players = await idb.merged.players.getAll({ draftYear: year });
			const rows: StoryProspect[] = [];
			const order = new Map<number, number>();
			for (const p of players) {
				const ratings = p.ratings.find((r) => r.season === year);
				if (!ratings) {
					continue;
				}
				rows.push({
					pid: p.pid,
					name: "",
					age: year - p.born.year,
					pos: ratings.pos,
					country: helpers.getCountry(p.born.loc),
					college: p.college ?? "",
					ovr: ratings.ovr,
					pot: ratings.pot,
					value: 0,
				});
				// In the order they were drafted, then the undrafted by their ratings
				order.set(
					p.pid,
					p.draft.round > 0
						? 1000 - (p.draft.round - 1) * 100 - p.draft.pick
						: (ratings.ovr + ratings.pot) / 2 - 500,
				);
			}
			for (const row of rows) {
				row.value = order.get(row.pid)!;
			}
			profile =
				rows.length >= 30 ? getClassProfile(year, rankProspects(rows)) : null;
			historyCache.set(key, profile);
		}
		if (profile) {
			output.push(profile);
		}
	}
	return output;
};

export type ClassShapeInfo = {
	key: DraftClassShape;
	name: string;
	description: string;
	storylines: string[];
};

/**
 * Everything the views show about a class's shape: its name, its description and the storylines read off the class. players: the class (prospects with draft.year === draftYear).
 */
export const getClassShapeInfo = async (
	players: Player[],
	draftYear: number,
	{ headline }: { headline?: boolean } = {},
): Promise<(ClassShapeInfo & { headline?: string }) | undefined> => {
	const shape = getClassShape(players);
	if (!shape) {
		return undefined;
	}
	const { key, version } = shape;
	const prospects = players.map((p) => toStoryProspect(p, draftYear));
	// Compared with earlier classes only at its own draft, when its ratings are from the same point as theirs
	const atDraft =
		draftYear === g.get("season") && g.get("phase") <= PHASE.DRAFT;
	const history = atDraft ? await getClassHistory(draftYear) : undefined;
	let ncaaTie: string | undefined;
	const marked = players.find(
		(p) =>
			p.collegeSeason?.season === draftYear &&
			(p.collegeSeason.v ?? 1) >= 4 &&
			p.collegeSeason.cs === key,
	);
	if (marked) {
		const tie = ncaaClassTie(marked.collegeSeason!.seed, draftYear, key);
		if (tie) {
			ncaaTie = tie.shape
				? NCAA_SHAPES[tie.shape].name
				: NCAA_SCORING[tie.scoring!].name;
		}
	}
	const input = { draftYear, shape: key, prospects, history, ncaaTie };
	const storylines = writeClassStorylines(input);
	return {
		key,
		name: DRAFT_CLASS_SHAPES[key].name,
		description: describeDraftClassShape(key, version, getClassSeed(draftYear)),
		storylines,
		...(headline ? { headline: writeClassHeadline(input, storylines) } : {}),
	};
};

/**
 * The draft lottery: a headline in the news about this year's class (its shape, how it compares with earlier classes, its No. 1), if it has a shape and the setting is on.
 */
export const logClassHeadline = async (
	draftYear: number,
	conditions?: Conditions,
) => {
	if (__SPORT !== "basketball" || !featureOn("draftClassShapes")) {
		return;
	}
	const players = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
	).filter((p) => p.draft.year === draftYear);
	const info = await getClassShapeInfo(players, draftYear, { headline: true });
	if (!info?.headline) {
		return;
	}
	logEvent(
		{
			type: "draftLottery",
			text: info.headline,
			showNotification: false,
			pids: [],
			tids: [],
			score: 20,
		},
		conditions,
	);
};
