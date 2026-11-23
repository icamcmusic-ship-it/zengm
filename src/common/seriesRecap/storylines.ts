// Series storylines: what makes a playoff series more than a matchup. A rematch of last season's playoffs, a shot at revenge for last
// season's elimination, a rivalry built from several recent playoff meetings, or a first meeting. Pure: the caller passes the earlier
// meetings of the two teams (playoff series, newest first).

export type PastMeeting = {
	season: number;
	round: number;
	roundName: string;
	winnerTid: number;
	loserTid: number;
	winnerWon: number;
	loserWon: number;
};

export type SeriesStoryline = {
	kind: "revenge" | "rematch" | "rivalry" | "firstMeeting";
	text: string;
};

// Seasons back that count for a rivalry
export const RIVALRY_SEASONS = 10;
const RIVALRY_MEETINGS = 3;

export const seriesStorylines = ({
	season,
	a,
	b,
	meetings,
	name,
	minSeason,
}: {
	season: number;
	a: number;
	b: number;
	meetings: PastMeeting[];
	name: (tid: number) => string;
	// First season the league has playoff history for: "first meeting" only when there's enough history to say so
	minSeason: number;
}): SeriesStoryline[] => {
	const out: SeriesStoryline[] = [];
	const mine = meetings
		.filter(
			(m) =>
				m.season < season &&
				((m.winnerTid === a && m.loserTid === b) ||
					(m.winnerTid === b && m.loserTid === a)),
		)
		.toSorted((x, y) => y.season - x.season || y.round - x.round);
	const last = mine[0];
	if (last && last.season === season - 1) {
		const W = name(last.winnerTid);
		const L = name(last.loserTid);
		out.push({
			kind: "revenge",
			text: `Revenge: the ${L} get another shot at the ${W}, who knocked them out in last season's ${last.roundName} (${last.winnerWon}-${last.loserWon}).`,
		});
	} else if (last && last.season >= season - 3) {
		out.push({
			kind: "rematch",
			text: `A rematch of the ${last.season} ${last.roundName}, won by the ${name(last.winnerTid)} ${last.winnerWon}-${last.loserWon}.`,
		});
	}
	const recent = mine.filter((m) => m.season >= season - RIVALRY_SEASONS);
	if (recent.length >= RIVALRY_MEETINGS - 1) {
		const aWins = recent.filter((m) => m.winnerTid === a).length;
		const bWins = recent.length - aWins;
		const lead =
			aWins === bWins
				? `they have split them ${aWins}-${bWins}`
				: `the ${name(aWins > bWins ? a : b)} have won ${Math.max(aWins, bWins)} of them`;
		out.push({
			kind: "rivalry",
			text: `A playoff rivalry: their ${ordinal(recent.length + 1)} meeting in ${RIVALRY_SEASONS} seasons, and ${lead}.`,
		});
	}
	if (mine.length === 0 && season - minSeason >= RIVALRY_SEASONS) {
		out.push({
			kind: "firstMeeting",
			text: `The ${name(a)} and the ${name(b)} meet in the playoffs for the first time in at least ${season - minSeason} seasons.`,
		});
	}
	return out;
};

const ordinal = (x: number) => {
	const s = ["th", "st", "nd", "rd"];
	const v = x % 100;
	return `${x}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
