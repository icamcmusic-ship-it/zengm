// Test-only: real players (data/real-player-data.basketball.json and real-player-stats.basketball.json) as a real-players
// league reads them at the preseason: that season's ratings, the position the game shows and the previous regular
// season's stats
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { readFileSync } from "node:fs";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import ovrFn from "../../worker/core/player/ovr.ts";
import { positionFor } from "./position.ts";
import {
	multiSeasonStats,
	seasonStats,
	statReading,
	type StatReading,
} from "./stats.ts";
import type { ArchetypeRatings, ArchetypeStats, Pos } from "./types.ts";
import {
	generateSubShape,
	parseSubLean,
	realSubShape,
	seedFromString,
} from "../subRatingsGen.ts";
import {
	SUB_NORMS_REAL,
	SUB_NORMS_REAL_EXPANDED,
	SUB_NORMS_REAL_WIDE,
	SUB_NORMS_REAL_WIDE_EXPANDED,
} from "./subStyle.ts";
import { SUB_DEFS } from "../subRatings.ts";
import { ratingQuantiles, type RatingQuantiles } from "./v2/gateScale.ts";
import { parseSubZ, wideRealLean } from "../subRatingsReal.ts";
import { realShootingSplit } from "../../worker/core/player/subRatings.ts";

// arch15: sub-ratings as a league with the subRatings setting gives them: a real player's from his stats (the row's lean;
// none without one), a generated player's from his generated shape (seeded by a key). ARCH_NO_SUBS=1: none (the setting off)
export const SUBS_ON = !(globalThis as any).process?.env?.ARCH_NO_SUBS;
// subspread: ARCH_SUBS_WIDE=1 reads the shapes the Wider Sub-Rating Shapes setting gives (real players' wide leans from their stats'
// z-scores, generated players' wide shapes) and the wide norms
export const SUBS_WIDE =
	SUBS_ON && Boolean((globalThis as any).process?.env?.ARCH_SUBS_WIDE);
export const realSubs = (row: any): number[] | undefined => {
	if (SUBS_WIDE) {
		const z = parseSubZ(row.subZ);
		if (!z) {
			return undefined;
		}
		const lean = wideRealLean(
			SUB_DEFS.map((d) => d.key),
			z,
		);
		// As the game does: with Expanded Ratings his jumper split follows his stats (it mutates the row, as the game's row)
		realShootingSplit(row, lean);
		return realSubShape(row, seedFromString(row.slug), lean, true).sub;
	}
	const lean = parseSubLean(row.subLean);
	if (!SUBS_ON || !lean) {
		return undefined;
	}
	return realSubShape(row, seedFromString(row.slug), lean).sub;
};
// The league's own sub-ratings table for real players (subStyle.ts): a real-players league reads their shapes against
// each other
// archreview: the gates' scale among real players (v2/gateScale.ts): a real-players league builds it from its own players,
// so these readings use the real players of 2016-2025 as theirs
let realRq: RatingQuantiles | undefined;
const realRatingQuantiles = (): RatingQuantiles => {
	if (!realRq) {
		const rows = realData()
			.d.ratings.filter((row: any) => row.season >= 2016 && row.season <= 2025)
			.map((row: any) => {
				const r = {} as ArchetypeRatings;
				for (const k of RATING_KEYS) {
					r[k] = row[k];
				}
				return { ratings: r, ovr: ovrFn(r as any) };
			});
		realRq = ratingQuantiles(rows);
	}
	return realRq;
};
export const realNorms = <N extends object>(norms: N, expanded: boolean): N =>
	realNormsSubs({ ...norms, rq: realRatingQuantiles() }, expanded);
const realNormsSubs = <N extends object>(norms: N, expanded: boolean): N =>
	SUBS_ON
		? {
				...norms,
				sub: SUBS_WIDE
					? expanded
						? SUB_NORMS_REAL_WIDE_EXPANDED
						: SUB_NORMS_REAL_WIDE
					: expanded
						? SUB_NORMS_REAL_EXPANDED
						: SUB_NORMS_REAL,
			}
		: norms;
export const generatedSubs = (
	ratings: Record<string, any>,
	key: string,
): number[] | undefined =>
	SUBS_ON
		? generateSubShape(ratings, seedFromString(`gen|${key}`), {
				wide: SUBS_WIDE,
			}).sub
		: undefined;

export type RealData = {
	d: { ratings: any[]; bios: Record<string, any> };
	st: { stats: Record<string, any[]> };
};

let cache: RealData | undefined;
export const realData = (): RealData => {
	cache ??= {
		d: JSON.parse(
			readFileSync(
				new URL(
					"../../../data/real-player-data.basketball.json",
					import.meta.url,
				),
				"utf8",
			),
		),
		st: JSON.parse(
			readFileSync(
				new URL(
					"../../../data/real-player-stats.basketball.json",
					import.meta.url,
				),
				"utf8",
			),
		),
	};
	return cache;
};

export const realSeasonStats = (
	st: RealData["st"],
	slug: string,
	season: number,
): ArchetypeStats | undefined =>
	seasonStats(
		(st.stats[slug] ?? []).filter((r) => r.season === season && !r.playoffs),
	);

// arch14: the last three regular seasons before `season`, most recent first (stats.ts multiSeasonStats)
export const realRecentStats = (
	st: RealData["st"],
	slug: string,
	season: number,
): ArchetypeStats | undefined =>
	multiSeasonStats(
		[1, 2, 3].map((k) =>
			(st.stats[slug] ?? []).filter(
				(r) => r.season === season - k && !r.playoffs,
			),
		),
	);

export type RealPlayer = {
	ratings: ArchetypeRatings;
	ovr: number;
	pos: Pos;
	age?: number;
	stats?: StatReading;
	name: string;
	slug: string;
	season: number;
};

// `ratingsOf` turns a ratings row into the ratings to read (to add expanded ratings, say)
export const realPlayer = (
	{ d, st }: RealData,
	row: any,
	ratingsOf: (row: any) => ArchetypeRatings = (x) => {
		const r = {} as ArchetypeRatings;
		for (const k of RATING_KEYS) {
			r[k] = x[k];
		}
		return r;
	},
): RealPlayer => {
	const r = ratingsOf(row);
	const sub = realSubs(row);
	if (sub) {
		r.sub = sub;
	}
	// (as the game reads him at the preseason: the stats of the seasons before, no earlier position)
	const pos = positionFor({ ...r, season: row.season }, true, undefined, {
		stats: (st.stats[row.slug] ?? []).filter((x) => x.season < row.season),
	});
	const born = d.bios[row.slug]?.bornYear;
	return {
		ratings: r,
		ovr: ovrFn(r as any),
		pos,
		age: born ? row.season - born : undefined,
		stats: statReading(realRecentStats(st, row.slug, row.season), pos),
		name: `${d.bios[row.slug]?.name ?? row.slug} ${row.season}`,
		slug: row.slug,
		season: row.season,
	};
};
