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
import { SUB_NORMS_REAL, SUB_NORMS_REAL_EXPANDED } from "./subStyle.ts";

// arch15: sub-ratings as a league with the subRatings setting gives them: a real player's from his stats (the row's lean;
// none without one), a generated player's from his generated shape (seeded by a key). ARCH_NO_SUBS=1: none (the setting off)
export const SUBS_ON = !(globalThis as any).process?.env?.ARCH_NO_SUBS;
export const realSubs = (row: any): number[] | undefined => {
	const lean = parseSubLean(row.subLean);
	if (!SUBS_ON || !lean) {
		return undefined;
	}
	return realSubShape(row, seedFromString(row.slug), lean).sub;
};
// The league's own sub-ratings table for real players (subStyle.ts): a real-players league reads their shapes against
// each other
export const realNorms = <N extends object>(norms: N, expanded: boolean): N =>
	SUBS_ON
		? { ...norms, sub: expanded ? SUB_NORMS_REAL_EXPANDED : SUB_NORMS_REAL }
		: norms;
export const generatedSubs = (
	ratings: Record<string, any>,
	key: string,
): number[] | undefined =>
	SUBS_ON
		? generateSubShape(ratings, seedFromString(`gen|${key}`)).sub
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
