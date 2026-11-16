// Export League: the database stores each export option writes to the league file
import type { LeagueDBStoreNames } from "../../worker/db/connectLeague.ts";

export const EXPORT_STORES_BY_KEY = {
	players: ["players", "awards"],
	teamsBasic: ["teams", "gameAttributes"],
	teams: ["teamSeasons", "teamStats", "coaches"],
	// Rivalry Stories: the per-game rivalry log and its season rows go with the head-to-head records (without them an
	// imported league rebuilds the log from its box scores only, so a file without box scores lost the rivalry history)
	headToHead: ["headToHeads", "rivalryGames", "rivalrySeasons"],
	schedule: ["schedule", "playoffSeries"],
	draftPicks: ["draftPicks"],
	leagueSettings: ["gameAttributes"],
	gameState: [
		"gameAttributes",
		"trade",
		"negotiations",
		"draftLotteryResults",
		"messages",
		"playerFeats",
		"allStars",
		"scheduledEvents",
		"seasonLeaders",
		"savedTrades",
		"savedTradingBlock",
	],
	newsFeedTransactions: ["events"],
	newsFeedOther: ["events"],
	games: ["games"],
} satisfies Record<string, LeagueDBStoreNames[]>;
