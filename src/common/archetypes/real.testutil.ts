// Test-only: real players (data/real-player-data.basketball.json and real-player-stats.basketball.json) as a real-players
// league reads them at the preseason: that season's ratings, the position the game shows and the previous regular
// season's stats
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { readFileSync } from "node:fs";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import ovrFn from "../../worker/core/player/ovr.ts";
import { positionFor } from "./position.ts";
import { seasonStats, statReading, type StatReading } from "./stats.ts";
import type { ArchetypeRatings, ArchetypeStats, Pos } from "./types.ts";

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
	const pos = positionFor(r, true);
	const born = d.bios[row.slug]?.bornYear;
	return {
		ratings: r,
		ovr: ovrFn(r as any),
		pos,
		age: born ? row.season - born : undefined,
		stats: statReading(realSeasonStats(st, row.slug, row.season - 1), pos),
		name: `${d.bios[row.slug]?.name ?? row.slug} ${row.season}`,
		slug: row.slug,
		season: row.season,
	};
};
