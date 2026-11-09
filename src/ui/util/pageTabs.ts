import type { LeagueUrlParts, ViewId } from "../router/types.ts";

// Pages of this fork that are tabs of an original BBGM page. Every tab keeps its own route, so the URL of a tab is the
// page's old URL: links, bookmarks and the command palette land on the right tab. The first tab is the host page.
export type PageTab = {
	id: ViewId;
	name: string;
	url: Readonly<LeagueUrlParts>;
	basketballOnly?: boolean;
};

export const PAGE_TAB_GROUPS: readonly (readonly PageTab[])[] = [
	[
		{ id: "settings", name: "League Settings", url: ["settings"] },
		{ id: "leagueExtras", name: "League Extras", url: ["league_extras"] },
	],
	[
		{ id: "tradingBlock", name: "Trading Block", url: ["trading_block"] },
		{ id: "tradeMarket", name: "Trade Market", url: ["trade_market"] },
	],
	[
		{ id: "trade", name: "2 teams", url: ["trade"] },
		{ id: "tradeThree", name: "3 teams", url: ["trade_three"] },
	],
	[
		{ id: "transactions", name: "Transactions", url: ["transactions"] },
		{
			id: "tradeGrader",
			name: "Trade Grader",
			url: ["trade_grader"],
			basketballOnly: true,
		},
	],
	[
		{ id: "leagueFinances", name: "Finances", url: ["league_finances"] },
		{
			id: "contractValue",
			name: "Contract Value",
			url: ["contract_value"],
			basketballOnly: true,
		},
		{
			id: "leagueEconomics",
			name: "Economics",
			url: ["frivolities", "economics"],
			basketballOnly: true,
		},
		{
			id: "homeCourt",
			name: "Home Court",
			url: ["frivolities", "home_court"],
			basketballOnly: true,
		},
	],
	[
		{ id: "draftHistory", name: "Draft History", url: ["draft_history"] },
		{
			id: "redraft",
			name: "Redraft",
			url: ["frivolities", "redraft"],
			basketballOnly: true,
		},
		{
			id: "pickValue",
			name: "Pick Value",
			url: ["frivolities", "pick_value"],
			basketballOnly: true,
		},
	],
	[
		{ id: "draftScouting", name: "Scouting", url: ["draft_scouting"] },
		{ id: "draftBoard", name: "Draft Board", url: ["draft_board"] },
		{
			id: "mockDraft",
			name: "Mock Draft",
			url: ["mock_draft"],
			basketballOnly: true,
		},
		{
			id: "collegeOverseas",
			name: "College/Overseas",
			url: ["college_overseas"],
			basketballOnly: true,
		},
	],
	[
		{ id: "relatives", name: "Relatives", url: ["frivolities", "relatives"] },
		{
			id: "familyTrees",
			name: "Family Trees",
			url: ["frivolities", "family_trees"],
		},
	],
	[
		{
			id: "frivolitiesJerseyNumbers",
			name: "League",
			url: ["frivolities", "jersey_numbers"],
		},
		{
			id: "jerseyNumbersTeams",
			name: "By Team",
			url: ["frivolities", "jersey_numbers", "teams"],
		},
	],
	[
		{ id: "playerRatings", name: "Ratings", url: ["player_ratings"] },
		{
			id: "archetypes",
			name: "Archetypes",
			url: ["archetypes"],
			basketballOnly: true,
		},
		{
			id: "skillBadges",
			name: "Skill Badges",
			url: ["frivolities", "skill_badges"],
			basketballOnly: true,
		},
	],
	[
		{ id: "historyAll", name: "History", url: ["history_all"] },
		{
			id: "timeline",
			name: "Timeline",
			url: ["timeline"],
			basketballOnly: true,
		},
		{
			id: "coaches",
			name: "Coaches",
			url: ["coaches"],
			basketballOnly: true,
		},
		{
			id: "recordsBook",
			name: "Records Book",
			url: ["records_book"],
			basketballOnly: true,
		},
	],
	[
		{ id: "playerStats", name: "Stats", url: ["player_stats"] },
		{
			id: "milestones",
			name: "Milestones",
			url: ["milestones"],
			basketballOnly: true,
		},
	],
	[
		{ id: "headToHeadAll", name: "Head-to-Head", url: ["head2head_all"] },
		{
			id: "rivalries",
			name: "Rivalries",
			url: ["rivalries"],
			basketballOnly: true,
		},
	],
	[
		{ id: "playoffs", name: "Playoffs", url: ["playoffs"] },
		{
			id: "seriesRecaps",
			name: "Series Recaps",
			url: ["series_recaps"],
			basketballOnly: true,
		},
	],
	[
		{ id: "dailySchedule", name: "Schedule", url: ["daily_schedule"] },
		{
			id: "hype",
			name: "Games to Watch",
			url: ["hype"],
			basketballOnly: true,
		},
		{
			id: "bestGames",
			name: "Best Games",
			url: ["best_games"],
			basketballOnly: true,
		},
	],
	[
		{ id: "awardRaces", name: "Award Races", url: ["award_races"] },
		{
			id: "awardVote",
			name: "Award Vote",
			url: ["award_vote"],
			basketballOnly: true,
		},
	],
];

// Tabs available in this sport
export const tabsForSport = (
	group: readonly PageTab[],
	sport: string = __SPORT,
) => group.filter((tab) => !tab.basketballOnly || sport === "basketball");

export const getTabGroup = (pageID: string | undefined) =>
	pageID === undefined
		? undefined
		: PAGE_TAB_GROUPS.find((group) => group.some((tab) => tab.id === pageID));

// The host (first tab) of the group a page belongs to, so the side menu highlights the host while on any of its tabs
export const tabHostPageID = (pageID: string | undefined) =>
	getTabGroup(pageID)?.[0]!.id;

// Whether a page is a tab of a Frivolities page (like Relatives or Jersey Numbers), which have no side menu item of
// their own, so the side menu's Frivolities item is highlighted on them and their tabs
export const isFrivolitiesTabPage = (pageID: string | undefined) =>
	getTabGroup(pageID)?.[0]!.url[0] === "frivolities";

const urlKey = (url: readonly unknown[]) =>
	url.filter((part) => typeof part === "string").join("/");

// Whether a "More" link points at another tab of the page it is shown on (the tab bar already links there). `page` is
// the MoreLinks page key, like "trading_block" or "frivolities/economics". A link with more than one extra part (like
// a team's Trade Report Card) is a different view, so it stays.
export const isTabOfSamePage = (
	link: readonly unknown[] | string,
	page: string,
) => {
	if (typeof link === "string") {
		return false;
	}
	const parts = link.filter((part) => part !== undefined);
	return PAGE_TAB_GROUPS.some((group) => {
		if (!group.some((tab) => urlKey(tab.url) === page)) {
			return false;
		}
		return group.some(
			(tab) =>
				parts.length <= tab.url.length + 1 &&
				tab.url.every((part, i) => parts[i] === part),
		);
	});
};
