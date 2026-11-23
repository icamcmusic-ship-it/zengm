// The playoff series state of each game of a day (common/seriesState.ts), for rotations and the home crowd. Basketball, playoffs only
import { PHASE } from "../../../common/constants.ts";
import {
	seriesGameState,
	type SeriesGameState,
} from "../../../common/seriesState.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";

// A lookup for the day's games (one read of the bracket), or undefined when there are no series games to look up
export const getPlayoffSeriesStateFn = async (): Promise<
	| ((homeTid: number, awayTid: number) => SeriesGameState | undefined)
	| undefined
> => {
	if (__SPORT !== "basketball" || g.get("phase") !== PHASE.PLAYOFFS) {
		return undefined;
	}
	const ps = await idb.cache.playoffSeries.get(g.get("season"));
	if (!ps || ps.currentRound < 0) {
		return undefined;
	}
	const round = ps.series[ps.currentRound];
	if (!round) {
		return undefined;
	}
	const numToWin = helpers.numGamesToWinRound(ps.currentRound);
	return (homeTid: number, awayTid: number) => {
		for (const s of round) {
			if (!s.away) {
				continue;
			}
			if (s.home.tid === homeTid && s.away.tid === awayTid) {
				return seriesGameState({
					homeWon: s.home.won,
					awayWon: s.away.won,
					numToWin,
				});
			}
			if (s.home.tid === awayTid && s.away.tid === homeTid) {
				return seriesGameState({
					homeWon: s.away.won,
					awayWon: s.home.won,
					numToWin,
				});
			}
		}
		return undefined;
	};
};
