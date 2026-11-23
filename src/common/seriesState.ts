// Playoff series state for one game: how urgent it is for each team (rotations) and how loud the home crowd gets. Basketball, playoff
// series of 3+ games to win only (no play-in, no regular season).
//
// Urgency: 1 Game 7 (or the deciding game of any series), 0.8 facing elimination, 0 normal, -0.5 up 3-0 (or the like: one win from
// clinching, the other team without a win): rests the stars a little. Crowd: louder for the home team in elimination and clinching
// games, loudest in a deciding game.

export const SERIES_URGENCY = {
	decider: 1,
	elimination: 0.8,
	comfortable: -0.5,
};

export const SERIES_CROWD = {
	decider: 0.15,
	// The home team faces elimination, or can close the series out
	elimination: 0.1,
	clinch: 0.08,
};

export type SeriesGameState = {
	kind: "decider" | "elimination" | "comfortable" | "normal";
	// [home team of this game, away team of this game]
	urgency: [number, number];
	crowdBoost: number;
};

export const seriesGameState = ({
	homeWon,
	awayWon,
	numToWin,
}: {
	// Series wins before this game, of this game's home and away teams
	homeWon: number;
	awayWon: number;
	numToWin: number;
}): SeriesGameState => {
	const normal: SeriesGameState = {
		kind: "normal",
		urgency: [0, 0],
		crowdBoost: 0,
	};
	if (numToWin < 3 || homeWon >= numToWin || awayWon >= numToWin) {
		return normal;
	}
	const last = numToWin - 1;
	if (homeWon === last && awayWon === last) {
		return {
			kind: "decider",
			urgency: [SERIES_URGENCY.decider, SERIES_URGENCY.decider],
			crowdBoost: SERIES_CROWD.decider,
		};
	}
	if (homeWon === last || awayWon === last) {
		const homeLeads = homeWon === last;
		const trailer = homeLeads ? awayWon : homeWon;
		const urgency: [number, number] = homeLeads
			? [
					trailer === 0 ? SERIES_URGENCY.comfortable : 0,
					SERIES_URGENCY.elimination,
				]
			: [
					SERIES_URGENCY.elimination,
					trailer === 0 ? SERIES_URGENCY.comfortable : 0,
				];
		return {
			kind: trailer === 0 ? "comfortable" : "elimination",
			urgency,
			crowdBoost: homeLeads ? SERIES_CROWD.clinch : SERIES_CROWD.elimination,
		};
	}
	return normal;
};
