import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { isCollege } from "../college/isCollege.ts";
import { processAwards } from "./processAwards.ts";
import { awardActive } from "./trackingAwards.ts";
import type { Award } from "../../../common/types.ts";

export type SeriesAwardWinner = {
	name: string;
	shortName: string;
	pid: number;
	playerName: string;
	tid: number;
};

const sameTids = (a: readonly number[], b: readonly number[]) =>
	a.length === 2 &&
	b.length === 2 &&
	((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]));

// Playoff series awards given for one series before the finals (the Semifinals MVP, which is the conference finals MVP in a
// league split by conference). Once the season's awards are given this is the stored winner; until then it's computed with the
// award code itself from the series' stats, so the series-end news and Series Recaps name the same player the awards will.
export const getSeriesAwardWinners = async ({
	season,
	round,
	tids,
}: {
	season: number;
	round: number;
	tids: [number, number];
}): Promise<SeriesAwardWinner[]> => {
	if (isCollege()) {
		return [];
	}
	const numRounds = g.get("numGamesPlayoffSeries", season).length;
	// The Finals MVP has its own news and pages
	if (round < 0 || round >= numRounds - 1) {
		return [];
	}
	const settings = g
		.get("awards", season)
		.filter(
			(award) =>
				award.numTeams === undefined &&
				typeof award.statRange === "number" &&
				(award.statRange < 0
					? numRounds + award.statRange
					: award.statRange) === round &&
				awardActive(award),
		);
	if (settings.length === 0) {
		return [];
	}

	const stored = await idb.merged.awards.get(season);
	let realized: Award[];
	if (stored) {
		realized = stored.awards;
	} else {
		const { realizedAwards } = await processAwards({
			awards: settings,
			extraStatRanges: [],
			extraStats: [],
			numPlayersPerIndividualAward: 1,
			season,
			statOverridesByMatchup: undefined,
		});
		realized = realizedAwards.flat();
	}

	const out: SeriesAwardWinner[] = [];
	for (const setting of settings) {
		const award = realized.find(
			(a) =>
				a.shortName === setting.shortName &&
				a.group?.type === "playoffSeries" &&
				sameTids(a.group.tids, tids),
		);
		if (!award || award.numTeams !== undefined) {
			continue;
		}
		const winner = award.winner[0];
		if (winner?.pid === undefined) {
			continue;
		}
		const p = await idb.merged.players.get(winner.pid);
		out.push({
			name: award.name,
			shortName: award.shortName,
			pid: winner.pid,
			playerName: p ? `${p.firstName} ${p.lastName}`.trim() : "Unknown",
			tid: winner.tid,
		});
	}
	return out;
};
