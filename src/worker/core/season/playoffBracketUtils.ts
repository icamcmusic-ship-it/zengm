// Pure pieces of the playoff schedule (newSchedulePlayoffsDay), shared with Season Odds (seasonOdds/simSeason) so the projections play
// the same format as the real schedule.

import { chunk } from "../../../common/utils.ts";

// Play 2 home (true) then 2 away (false) and repeat, but ensure that the better team always gets the last game. gameNum is 0-based.
export const betterSeedHome = (
	numGamesPlayoffSeries: number,
	gameNum: number,
) => {
	// For series lengths like 3, 7, 11, 15, etc., special case last 3 games to ensure the home team always gets the last game
	const needsSpecialEnding = (numGamesPlayoffSeries + 1) % 4 === 0;

	if (needsSpecialEnding) {
		// Special case for last 3 games
		if (gameNum >= numGamesPlayoffSeries - 3) {
			return (
				gameNum === numGamesPlayoffSeries - 3 ||
				gameNum === numGamesPlayoffSeries - 1
			);
		}
	}

	const num = Math.floor(gameNum / 2);
	return num % 2 === 0;
};

/**
 * While the playoffs are still in their conference brackets, split the series winners into one group per conference, so reseeding
 * only reorders teams within a conference. Grouped by the cid stored in the bracket (the conference a team was seeded in), not by
 * position, so a conference change or a contracted team in God Mode mid-playoffs can't silently put a team in another conference's
 * group. Groups keep the bracket's order (first appearance). If that can't make pairs (an odd group, from a bracket edited by hand),
 * fall back to the bracket's positions, as before.
 */
export const groupByConf = <T extends { cid: number }>(
	teamsWon: T[],
	playoffsByConf: number,
): T[][] => {
	const groups = [...Map.groupBy(teamsWon, (t) => t.cid).values()];
	if (groups.every((group) => group.length % 2 === 0)) {
		return groups;
	}
	return chunk(teamsWon, Math.ceil(teamsWon.length / playoffsByConf));
};

// Reseeding: each 2 teams are a matchup (best team, worst team, 2nd best team, 2nd worst team, etc). orderedGroup is best first.
export const interleaveForReseed = <T>(orderedGroup: T[]) => {
	const remaining = [...orderedGroup];
	const interleaved: T[] = [];
	while (remaining.length > 0) {
		const t =
			interleaved.length % 2 === 0 ? remaining.shift()! : remaining.pop()!;
		interleaved.push(t);
	}
	return interleaved;
};
