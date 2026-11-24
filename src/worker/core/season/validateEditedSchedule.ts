// Schedule editor: checks on the schedule the user saves, so a broken schedule can't reach the game loop. Returns an
// error message, or undefined if the schedule is fine.
type EditedGame = {
	day: number;
	homeTid: number;
	awayTid: number;
	homeAbbrev?: string;
	awayAbbrev?: string;
	type?: string;
};

export const validateEditedSchedule = (
	games: readonly EditedGame[],
	{
		activeTids,
		allStarGameAllowed,
		tradeDeadlineAllowed,
	}: {
		// Teams that can play (not disabled)
		activeTids: ReadonlySet<number>;
		// False when the All-Star Game is disabled, in the playoffs or already played (and none is in the saved schedule)
		allStarGameAllowed: boolean;
		// False once the trade deadline has passed (phase AFTER_TRADE_DEADLINE or later)
		tradeDeadlineAllowed: boolean;
	},
): string | undefined => {
	const gamesByDay = new Map<number, EditedGame[]>();
	let numAllStarGames = 0;
	let numTradeDeadlines = 0;

	for (const game of games) {
		if (game.type === "placeholder") {
			continue;
		}
		const { day, homeTid, awayTid } = game;
		if (!Number.isInteger(day)) {
			return `Invalid day "${day}".`;
		}

		// Completed games (already played, shown in the editor) only count for the teams playing more than once a day
		const completed = game.type === "completed";
		const isAllStarGame = homeTid === -1 && awayTid === -2;
		const isTradeDeadline = homeTid === -3 && awayTid === -3;
		if (isAllStarGame) {
			if (!completed) {
				numAllStarGames += 1;
			}
		} else if (isTradeDeadline) {
			if (!completed) {
				numTradeDeadlines += 1;
			}
		} else if (!completed) {
			for (const tid of [homeTid, awayTid]) {
				if (!activeTids.has(tid)) {
					return `Invalid team (tid ${tid}) on day ${day}.`;
				}
			}
			if (homeTid === awayTid) {
				return `A team can't play itself (day ${day}).`;
			}
		}

		const dayGames = gamesByDay.get(day);
		if (dayGames) {
			dayGames.push(game);
		} else {
			gamesByDay.set(day, [game]);
		}
	}

	if (numAllStarGames > 1) {
		return "There can only be one All-Star Game.";
	}
	if (numTradeDeadlines > 1) {
		return "There can only be one trade deadline.";
	}
	if (numAllStarGames > 0 && !allStarGameAllowed) {
		return "The All-Star Game can't be added to the schedule: it is disabled, happens during the playoffs, or already happened this season.";
	}
	if (numTradeDeadlines > 0 && !tradeDeadlineAllowed) {
		return "The trade deadline already happened this season.";
	}

	for (const [day, dayGames] of gamesByDay) {
		const tids = new Set<number>();
		for (const { homeTid, awayTid, homeAbbrev, awayAbbrev } of dayGames) {
			if (homeTid < 0 || awayTid < 0) {
				if (dayGames.length > 1) {
					const name =
						homeTid === -1 ? "The All-Star Game" : "The trade deadline";
					return `${name} must be alone on its day (day ${day}).`;
				}
				continue;
			}
			for (const [tid, abbrev] of [
				[homeTid, homeAbbrev],
				[awayTid, awayAbbrev],
			] as const) {
				if (tids.has(tid)) {
					return `${abbrev ?? `Team ${tid}`} plays more than once on day ${day}.`;
				}
				tids.add(tid);
			}
		}
	}

	return undefined;
};
