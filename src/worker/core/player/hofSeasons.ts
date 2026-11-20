// Shared by the Hall of Fame formulas (madeHof.*.ts): a player's career as one value per season, so the formulas rank seasons
// rather than stats rows, and each season is measured against that season's schedule rather than today's settings.
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { g, helpers } from "../../util/index.ts";

export type HofSeason = {
	season: number;
	playoffs: boolean;
	value: number;
};

const sum = (xs: readonly number[]) => xs.reduce((total, x) => total + x, 0);

// Value of a season relative to a default-length one. Regular season: that season's schedule length. Playoffs: the most games a
// team could play in that season's bracket, so a bigger bracket (more rounds, longer series) doesn't inflate a playoff run.
export const hofSeasonScale = (season: number, playoffs: boolean) => {
	if (playoffs) {
		const games = sum(g.get("numGamesPlayoffSeries", season));
		const defaultGames = sum(
			defaultGameAttributes.numGamesPlayoffSeries[0]!.value,
		);
		return games > 0 && defaultGames > 0 ? games / defaultGames : 1;
	}

	const numGames = g.get("numGames", season);
	const defaultNumGames = defaultGameAttributes.numGames[0]!.value;
	return numGames > 0 ? numGames / defaultNumGames : 1;
};

/**
 * One value per season, regular season and playoffs separately (a traded player's rows for each team are added up, so his best
 * year isn't split into weaker rows), each normalized to a default-length season or bracket. In order of first appearance in rows,
 * which is chronological.
 */
export const hofSeasonValues = <
	Row extends { season: number; playoffs: boolean },
>(
	rows: readonly Row[],
	getValue: (row: Row) => number,
): HofSeason[] => {
	const bySeason = new Map<string, HofSeason>();
	for (const row of rows) {
		const playoffs = !!row.playoffs;
		const key = `${row.season}${playoffs ? "p" : ""}`;
		let entry = bySeason.get(key);
		if (!entry) {
			entry = { season: row.season, playoffs, value: 0 };
			bySeason.set(key, entry);
		}
		entry.value += getValue(row);
	}

	const seasons = [...bySeason.values()];
	for (const entry of seasons) {
		entry.value /= hofSeasonScale(entry.season, entry.playoffs);
	}
	return seasons;
};

// The season used for the fudge factor of players who were already in the league when it started: his best full regular season
export const bestRegularSeason = (seasons: readonly HofSeason[]) => {
	let best: number | undefined;
	for (const { playoffs, value } of seasons) {
		if (!playoffs && (best === undefined || value > best)) {
			best = value;
		}
	}
	return best;
};

// Threshold scale for the settings that are not stored per season (game length) plus the Hall of Fame factor. The schedule
// length is handled per season by hofSeasonValues.
export const hofThresholdScale = () =>
	helpers.quarterLengthFactor() * g.get("hofFactor");
