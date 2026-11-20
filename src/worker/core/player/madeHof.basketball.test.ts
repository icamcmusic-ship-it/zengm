import { assert, test } from "vitest";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { player } from "../index.ts";
import madeHofBasketball from "./madeHof.basketball.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import type { PlayerStats } from "../../../common/types.ts";

// One regular season row per season, starting with his rookie season
const withSeasons = (rows: Partial<PlayerStats>[], firstSeason = 2013) =>
	rows.map((row, i) => ({
		season: firstSeason + i,
		playoffs: false,
		tid: 0,
		...row,
	})) as PlayerStats[];

test("narrowly make HoF based on dominance factor", () => {
	resetG();
	const p = player.generate(0, 19, 2012, false, DEFAULT_LEVEL);
	p.stats = withSeasons([
		{
			dws: 5,
			ows: 5,
			ewa: 10,
		},
		{
			dws: 5,
			ows: 5,
			ewa: 10,
		},
		{
			dws: 5,
			ows: 5,
			ewa: 11,
		},
		{
			dws: 7,
			ows: 7,
			ewa: 14,
		},
		{
			dws: 7,
			ows: 7,
			ewa: 14,
		},
		{
			dws: 7,
			ows: 7,
			ewa: 14,
		},
		{
			dws: 7,
			ows: 7,
			ewa: 14,
		},
		{
			dws: 7,
			ows: 7,
			ewa: 14,
		},
	]);
	assert.strictEqual(madeHofBasketball(p), true);
});

test("narrowly miss HoF based on dominance factor", () => {
	const p = player.generate(0, 19, 2012, false, DEFAULT_LEVEL);
	p.stats = withSeasons([
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
		{
			dws: 4,
			ows: 4,
			ewa: 8,
		},
	]);
	assert.strictEqual(madeHofBasketball(p), false);
});

// A season worth exactly as much as the "narrowly miss" career's: 8 per season, 13 seasons
const missRows = () =>
	Array.from({ length: 13 }, () => ({ dws: 4, ows: 4, ewa: 8 }));

test("a traded player's season counts as one season, not two weaker rows", () => {
	resetG();
	const p = player.generate(0, 19, 2012, false, DEFAULT_LEVEL);

	// Made it on dominance: five 20 WS seasons, the rest small
	const seasons = [
		...Array.from({ length: 5 }, () => ({ dws: 10, ows: 10, ewa: 20 })),
		...Array.from({ length: 5 }, () => ({ dws: 1, ows: 1, ewa: 2 })),
	];
	p.stats = withSeasons(seasons);
	const unsplit = madeHofBasketball(p);
	assert.strictEqual(unsplit, true);

	// Same seasons, each of the big ones split evenly between two teams
	const split: PlayerStats[] = [];
	for (const row of withSeasons(seasons)) {
		if (row.ewa === 20) {
			split.push(
				{ ...row, tid: 0, dws: 5, ows: 5, ewa: 10 },
				{ ...row, tid: 1, dws: 5, ows: 5, ewa: 10 },
			);
		} else {
			split.push(row);
		}
	}
	p.stats = split;
	assert.strictEqual(madeHofBasketball(p), unsplit);
});

test("each season is scaled by that season's schedule, not today's", () => {
	resetG();
	const p = player.generate(0, 19, 2012, false, DEFAULT_LEVEL);
	p.stats = withSeasons(missRows());
	assert.strictEqual(madeHofBasketball(p), false);

	// Shortening the schedule after his career doesn't change his case
	g.setWithoutSavingToDB("numGames", [
		{ start: -Infinity, value: 82 },
		{ start: 2040, value: 41 },
	] as any);
	assert.strictEqual(madeHofBasketball(p), false);

	// The same numbers in 41 game seasons are twice as good
	g.setWithoutSavingToDB("numGames", [
		{ start: -Infinity, value: 82 },
		{ start: 2000, value: 41 },
	] as any);
	assert.strictEqual(madeHofBasketball(p), true);
	g.setWithoutSavingToDB("numGames", [{ start: -Infinity, value: 82 }] as any);
});

test("playoff runs are scaled by the bracket size", () => {
	resetG();
	const p = player.generate(0, 19, 2012, false, DEFAULT_LEVEL);
	const regularSeason = withSeasons(missRows().slice(0, 10));
	const playoffs = withSeasons(
		Array.from({ length: 10 }, () => ({ dws: 3, ows: 3, ewa: 6 })),
	).map((row) => ({ ...row, playoffs: true }));
	p.stats = [...regularSeason, ...playoffs];
	const defaultBracket = madeHofBasketball(p);

	// Same playoff numbers from a bracket with twice as many games are worth half as much
	g.setWithoutSavingToDB("numGamesPlayoffSeries", [
		{ start: -Infinity, value: [7, 7, 7, 7, 7, 7, 7, 7] },
	] as any);
	const bigBracket = madeHofBasketball(p);
	g.setWithoutSavingToDB("numGamesPlayoffSeries", [
		{ start: -Infinity, value: [7, 7, 7, 7] },
	] as any);
	assert.strictEqual(defaultBracket, true);
	assert.strictEqual(bigBracket, false);
});
