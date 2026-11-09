// Pages of this fork that live under an original BBGM page: they are reached from that page's "More" links (MoreLinks)
// and the command palette, not from their own side menu item. Their URLs are unchanged, so old links and bookmarks keep
// working.
export const CONSOLIDATED_PAGES = [
	{ path: "trade_market", home: "trading_block", moreLinks: "trade" },
	{ path: "trade_grader", home: "transactions", moreLinks: "trade" },
	{ path: "contract_value", home: "league_finances", moreLinks: "finances" },
	{ path: "coaches", home: "history_all", moreLinks: "league" },
	{ path: "timeline", home: "history_all", moreLinks: "league" },
	{ path: "records_book", home: "history_all", moreLinks: "league" },
	{ path: "milestones", home: "player_stats", moreLinks: "playerStats" },
	{ path: "archetypes", home: "player_ratings", moreLinks: "playerRatings" },
	{ path: "hype", home: "daily_schedule", moreLinks: "schedule" },
	{ path: "draft_board", home: "draft_scouting", moreLinks: "draft" },
] as const;

export const CONSOLIDATED_PATHS: ReadonlySet<string> = new Set(
	CONSOLIDATED_PAGES.map((page) => page.path),
);
