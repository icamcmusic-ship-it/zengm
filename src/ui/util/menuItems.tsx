import { CONSOLIDATED_PATHS } from "./consolidatedPages.ts";
import { toWorker } from "./toWorker.ts";
import {
	DAILY_SCHEDULE,
	DEPTH_CHART_NAME,
	PHASE,
	REAL_PLAYERS_INFO,
	WEBSITE_ROOT,
} from "../../common/constants.ts";
import type {
	MenuItemLink,
	MenuItemHeader,
	MenuItemText,
	Phase,
} from "../../common/types.ts";
import { frivolities } from "../views/Frivolities.tsx";
import {
	isFrivolitiesTabPage,
	PAGE_TAB_GROUPS,
	tabHostPageID,
	tabsForSport,
} from "./pageTabs.ts";
import { takeScreenshot } from "./takeScreenshot.ts";
import { bySport } from "../../common/sportFunctions.ts";

const depthChart: MenuItemLink[] =
	DEPTH_CHART_NAME !== undefined
		? [
				{
					type: "link",
					active: (pageID, pathname) =>
						pageID === "depth" &&
						(__SPORT !== "baseball" ||
							!pathname ||
							(!pathname.includes("/D") && !pathname.includes("/P"))),
					league: true,
					commandPalette: true,
					path: ["depth"],
					text: DEPTH_CHART_NAME,
				},
			]
		: [];

if (__SPORT === "baseball") {
	depthChart.push(
		{
			type: "link",
			active: (pageID, pathname) =>
				pageID === "depth" && !!pathname && pathname.includes("/D"),
			league: true,
			commandPalette: true,
			path: ["depth", "D"],
			text: "Defense",
		},
		{
			type: "link",
			active: (pageID, pathname) =>
				pageID === "depth" && !!pathname && pathname.includes("/P"),
			league: true,
			commandPalette: true,
			path: ["depth", "P"],
			text: "Pitching",
		},
	);
}

// Season newspaper (basketball only)
const newspaperLinks: MenuItemLink[] =
	__SPORT === "basketball"
		? [
				{
					type: "link",
					active: (pageID) => pageID === "newspaper",
					league: true,
					commandPalette: true,
					feature: "newspaper",
					path: ["newspaper"],
					text: "Newspaper",
				},
			]
		: [];

// Wrapped and Storylines (basketball only)
const wrappedLinks: MenuItemLink[] =
	__SPORT === "basketball"
		? [
				{
					type: "link",
					active: (pageID) => pageID === "wrapped",
					league: true,
					commandPalette: true,
					feature: "wrapped",
					path: ["wrapped"],
					text: "Wrapped",
				},
				{
					type: "link",
					active: (pageID) => pageID === "storylines",
					league: true,
					commandPalette: true,
					feature: "storylines",
					path: ["storylines"],
					text: "Storylines",
				},
			]
		: [];

// Achievements unlocked by the league itself, unlike the account achievements in Tools (basketball only)
const leagueAchievementsLinks: MenuItemLink[] =
	__SPORT === "basketball"
		? [
				{
					type: "link",
					active: (pageID) => pageID === "leagueAchievements",
					league: true,
					commandPalette: true,
					feature: "leagueAchievements",
					path: ["league_achievements"],
					text: "League Achievements",
				},
			]
		: [];

// The Owner page (basketball only, Owner's Office League extra)
const ownerLinks: MenuItemLink[] =
	__SPORT === "basketball"
		? [
				{
					type: "link",
					active: (pageID) => pageID === "owner",
					league: true,
					commandPalette: true,
					feature: "ownerOffice",
					path: ["owner"],
					text: "Owner",
				},
			]
		: [];

// Coaching staff (basketball only). Hidden while its League extras are off (the pages themselves say how to turn them
// on, for old links and bookmarks). The Staff Report is a tab of Draft Scouting (util/pageTabs.ts): its command palette
// item ("Draft Scouting > Staff Report") is added with the other tab pages, and uses the same rule as the page
// (isUrlFeatureOn, via isMenuLinkFeatureOn), since it belongs to two features
const staffLinks: MenuItemLink[] =
	__SPORT === "basketball"
		? [
				{
					type: "link",
					active: (pageID) => pageID === "staff" || pageID === "coach",
					league: true,
					commandPalette: true,
					feature: "coachingStaff",
					path: ["staff"],
					text: "Coaching Staff",
				},
				{
					type: "link",
					active: (pageID) => pageID === "coachNotes",
					league: true,
					commandPalette: true,
					commandPaletteOnly: true,
					feature: "coachSystems",
					path: ["coach_notes"],
					text: "Coach's Notes",
				},
			]
		: [];
const historyCoachesLinks: MenuItemLink[] =
	__SPORT === "basketball"
		? [
				{
					type: "link",
					active: (pageID) => pageID === "coaches",
					league: true,
					commandPalette: true,
					feature: "coachingStaff",
					path: ["coaches"],
					text: "Coaches",
				},
				{
					type: "link",
					active: (pageID) => pageID === "frontOffices",
					league: true,
					commandPalette: true,
					feature: "gmPersonalities",
					path: ["front_offices"],
					text: "Front Offices",
				},
			]
		: [];
const collegeCarouselLinks: MenuItemLink[] =
	__SPORT === "basketball"
		? [
				{
					type: "link",
					active: (pageID) => pageID === "collegeCarousel",
					league: true,
					commandPalette: true,
					leagueType: "college",
					feature: "coachingStaff",
					path: ["college_carousel"],
					text: "Coaching Carousel",
				},
			]
		: [];

// Archetype landscape (basketball only)
const archetypeLinks: MenuItemLink[] =
	__SPORT === "basketball"
		? [
				{
					type: "link",
					active: (pageID) => pageID === "archetypes",
					league: true,
					commandPalette: true,
					feature: "archetypes",
					path: ["archetypes"],
					text: "Archetypes",
				},
			]
		: [];

// League timeline (League extras)
const timelineLinks: MenuItemLink[] =
	__SPORT === "basketball"
		? [
				{
					type: "link",
					active: (pageID) => pageID === "timeline",
					league: true,
					commandPalette: true,
					feature: "timeline",
					path: ["timeline"],
					text: "Timeline",
				},
			]
		: [];

// Game hype and record chases (basketball only)
const hypeLinks: MenuItemLink[] =
	__SPORT === "basketball"
		? [
				{
					type: "link",
					active: (pageID) => pageID === "hype",
					league: true,
					commandPalette: true,
					feature: "hype",
					path: ["hype"],
					text: "Games to Watch",
				},
			]
		: [];

// Trade grades and contract value (basketball only)
const valueLinks: MenuItemLink[] =
	__SPORT === "basketball"
		? [
				{
					type: "link",
					active: (pageID) => pageID === "tradeGrader",
					league: true,
					commandPalette: true,
					feature: "tradeGrader",
					path: ["trade_grader"],
					text: "Trade Grader",
				},
				{
					type: "link",
					active: (pageID) => pageID === "contractValue",
					league: true,
					commandPalette: true,
					feature: "contractValue",
					path: ["contract_value"],
					text: "Contract Value",
				},
			]
		: [];

const menuItemsRaw: (MenuItemLink | MenuItemHeader)[] = [
	{
		type: "link",
		active: (pageID) => pageID === "dashboard",
		nonLeague: true,
		commandPalette: true,
		path: "/",
		text: "Leagues",
	},
	...(REAL_PLAYERS_INFO
		? ([
				{
					type: "link",
					active: (pageID) => pageID === "newLeague",
					nonLeague: true,
					path: "/new_league",
					text: "New League",
				},
				{
					type: "link",
					nonLeague: true,
					commandPalette: true,
					commandPaletteOnly: true,
					path: "/new_league/real",
					text: "New League > Real Players",
				},
				{
					type: "link",
					nonLeague: true,
					commandPalette: true,
					commandPaletteOnly: true,
					path: "/new_league/random",
					text: "New League > Random Players",
				},
				{
					type: "link",
					nonLeague: true,
					commandPalette: true,
					commandPaletteOnly: true,
					path: "/new_league/legends",
					text: "New League > Legends",
				},
				{
					type: "link",
					nonLeague: true,
					commandPalette: true,
					commandPaletteOnly: true,
					path: "/new_league",
					text: "New League > Custom",
				},
				...(__SPORT === "basketball"
					? [
							{
								type: "link",
								nonLeague: true,
								commandPalette: true,
								commandPaletteOnly: true,
								path: "/new_league/college",
								text: "New League > College",
							},
						]
					: []),
			] as MenuItemLink[])
		: ([
				{
					type: "link",
					active: (pageID) => pageID === "newLeague",
					nonLeague: true,
					commandPalette: true,
					path: "/new_league",
					text: "New League",
				},
			] as MenuItemLink[])),
	{
		type: "link",
		active: (pageID) =>
			typeof pageID === "string" && pageID.startsWith("exhibition"),
		nonLeague: true,
		commandPalette: true,
		path: "/exhibition",
		text: "Exhibition Game",
	},
	{
		type: "link",
		active: (pageID) => pageID === "dashboard",
		league: true,
		path: "/",
		text: "Switch League",
	},
	{
		type: "link",
		active: (pageID) => pageID === "leagueDashboard",
		league: true,
		path: [],
		text: {
			side: "Dashboard",
			top: (
				<>
					<span className="glyphicon glyphicon-home" />
					<span className="visually-hidden">League Dashboard</span>
				</>
			),
		},
	},
	{
		type: "header",
		long: "League",
		short: "L",
		league: true,
		commandPalette: true,
		children: [
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: [],
				text: "Dashboard",
			},
			{
				type: "link",
				active: (pageID) => pageID === "standings",
				league: true,
				commandPalette: true,
				path: ["standings"],
				text: "Standings",
			},
			{
				type: "link",
				active: (pageID) => pageID === "playoffs",
				league: true,
				commandPalette: true,
				path: ["playoffs"],
				text: "Playoffs",
			},
			{
				type: "link",
				active: (pageID) => pageID === "collegeConfTournaments",
				league: true,
				commandPalette: true,
				leagueType: "college",
				path: ["college_conf_tournaments"],
				text: "Conf. Tournaments",
			},
			{
				type: "link",
				active: (pageID) => pageID === "collegeNit",
				league: true,
				commandPalette: true,
				leagueType: "college",
				feature: "collegeNit",
				path: ["college_nit"],
				text: "NIT",
			},
			{
				type: "link",
				active: (pageID) => pageID === "dailySchedule",
				league: true,
				commandPalette: true,
				path: ["daily_schedule"],
				text: DAILY_SCHEDULE,
			},
			...hypeLinks,
			{
				type: "link",
				active: (pageID) => pageID === "powerRankings",
				league: true,
				commandPalette: true,
				path: ["power_rankings"],
				text: "Power Rankings",
			},
			{
				type: "link",
				active: (pageID) => pageID === "transactions",
				league: true,
				commandPalette: true,
				path: ["transactions", "all"],
				text: "Transactions",
			},
			{
				type: "link",
				active: (pageID) => pageID === "leagueFinances",
				league: true,
				commandPalette: true,
				path: ["league_finances"],
				text: "Finances",
			},
		],
	},
	{
		type: "header",
		long: "Newsroom",
		short: "N",
		league: true,
		commandPalette: true,
		topMenu: "League",
		children: [
			{
				type: "link",
				active: (pageID) => pageID === "news",
				league: true,
				commandPalette: true,
				path: ["news"],
				text: "News Feed",
			},
			{
				type: "link",
				active: (pageID) => pageID === "rumors",
				league: true,
				commandPalette: true,
				feature: "rumors",
				path: ["rumors"],
				text: "Rumors",
			},
			...newspaperLinks,
			...wrappedLinks,
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["season_preview"],
				text: "Season Previews",
			},
		],
	},
	{
		type: "header",
		long: "History",
		short: "H",
		league: true,
		commandPalette: true,
		topMenu: "League",
		children: [
			{
				type: "link",
				active: (pageID) => pageID === "history" || pageID === "historyAll",
				league: true,
				commandPalette: true,
				path: ["history_all"],
				text: "League History",
			},
			...leagueAchievementsLinks,
			{
				type: "link",
				active: (pageID) => pageID === "hallOfFame",
				league: true,
				commandPalette: true,
				path: ["hall_of_fame"],
				text: "Hall of Fame",
			},
			...timelineLinks,
			...historyCoachesLinks,
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["head2head_all"],
				text: "Head-to-Head",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["team_records"],
				text: "Team Records",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["awards_records"],
				text: "Awards Records",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["award_history"],
				text: "Award History",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["all_star", "history"],
				text: "All-Star History",
			},
		],
	},
	{
		type: "header",
		long: "Team",
		short: "T",
		league: true,
		commandPalette: true,
		children: [
			{
				type: "link",
				active: (pageID) => pageID === "roster",
				league: true,
				commandPalette: true,
				path: ["roster"],
				text: "Roster",
			},
			...(bySport({
				baseball: true,
				basketball: false,
				football: true,
				hockey: true,
			})
				? depthChart
				: []),
			{
				type: "link",
				active: (pageID) => pageID === "schedule",
				league: true,
				commandPalette: true,
				path: ["schedule"],
				text: "Schedule",
			},
			{
				type: "link",
				active: (pageID) => pageID === "teamFinances",
				league: true,
				commandPalette: true,
				path: ["team_finances"],
				text: "Finances",
			},
			...ownerLinks,
			...staffLinks,
			{
				type: "link",
				active: (pageID) => pageID === "teamHistory",
				league: true,
				commandPalette: true,
				path: ["team_history"],
				text: "Team History",
			},
			{
				type: "link",
				active: (pageID) => pageID === "gmHistory",
				league: true,
				commandPalette: true,
				path: ["gm_history"],
				text: "GM History",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["head2head"],
				text: "Head-to-Head",
			},
		],
	},
	{
		type: "header",
		long: "Players",
		short: "P",
		league: true,
		commandPalette: true,
		children: [
			{
				type: "link",
				active: (pageID) => pageID === "freeAgents",
				league: true,
				commandPalette: true,
				path: ["free_agents"],
				text: "Free Agents",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["upcoming_free_agents"],
				text: "Upcoming Free Agents",
			},
			{
				type: "link",
				active: (pageID) => pageID === "trade",
				league: true,
				commandPalette: true,
				path: ["trade"],
				text: "Trade",
			},
			{
				type: "link",
				active: (pageID) => pageID === "tradingBlock",
				league: true,
				commandPalette: true,
				path: ["trading_block"],
				text: "Trading Block",
			},
			{
				type: "link",
				active: (pageID) => pageID === "tradeOffers",
				league: true,
				commandPalette: true,
				feature: "aiTradeOffers",
				path: ["trade_offers"],
				text: "Trade Offers",
			},
			{
				type: "link",
				active: (pageID) => pageID === "tradeProposals",
				league: true,
				commandPalette: true,
				featureOff: "aiTradeOffers",
				path: ["trade_proposals"],
				text: "Trade Proposals",
			},
			{
				type: "link",
				active: (pageID) => pageID === "tradeMarket",
				league: true,
				commandPalette: true,
				feature: "tradeMarket",
				path: ["trade_market"],
				text: "Trade Market",
			},
			{
				type: "link",
				active: (pageID) => pageID === "savedTrades",
				league: true,
				commandPalette: true,
				path: ["saved_trades"],
				text: "Saved Trades",
			},
			...valueLinks,
			{
				type: "link",
				active: (pageID) => pageID === "comparePlayers",
				league: true,
				commandPalette: true,
				path: ["compare_players"],
				text: "Compare Players",
			},
			{
				type: "link",
				active: (pageID) => pageID === "watchList",
				league: true,
				commandPalette: true,
				path: ["watch_list"],
				text: "Watch List",
			},
		],
	},
	{
		type: "header",
		long: "Draft / College",
		short: "D",
		league: true,
		commandPalette: true,
		topMenu: "Players",
		children: [
			{
				type: "link",
				// Not the Draft Scouting pages (Draft Board, Mock Draft, ...), which have an item of their own
				active: (pageID) =>
					typeof pageID === "string" &&
					pageID.startsWith("draft") &&
					tabHostPageID(pageID) !== "draftScouting",
				league: true,
				commandPalette: true,
				path: ["draft"],
				text: "Draft",
			},
			{
				type: "link",
				active: (pageID) => pageID === "draftScouting",
				league: true,
				commandPalette: true,
				path: ["draft_scouting"],
				text: "Draft Scouting",
			},
			{
				type: "link",
				active: (pageID) => pageID === "collegeRecruiting",
				league: true,
				commandPalette: true,
				leagueType: "college",
				path: ["college_recruiting"],
				text: "Recruiting",
			},
			{
				type: "link",
				active: (pageID) => pageID === "collegePortal",
				league: true,
				commandPalette: true,
				leagueType: "college",
				path: ["college_portal"],
				text: "Transfer Portal",
			},
			{
				type: "link",
				active: (pageID) => pageID === "collegeDepartures",
				league: true,
				commandPalette: true,
				leagueType: "college",
				path: ["college_departures"],
				text: "Departures & Arrivals",
			},
			...collegeCarouselLinks,
			{
				type: "link",
				active: (pageID) => pageID === "collegePolls",
				league: true,
				commandPalette: true,
				leagueType: "college",
				path: ["college_polls"],
				text: "Top 25 & Selection",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["draft_history"],
				text: "Draft History",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["draft_lottery"],
				text: "Draft Lottery",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["draft_picks"],
				text: "Draft Picks",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				feature: "draftBoard",
				path: ["draft_board"],
				text: "Draft Scouting > Draft Board",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				feature: "mockDraft",
				path: ["mock_draft"],
				text: "Draft Scouting > Mock Draft",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				feature: "lotteryNight",
				path: ["draft_combine"],
				text: "Draft Scouting > Combine",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				feature: "scoutingReports",
				path: ["big_boards"],
				text: "Draft Scouting > Big Boards",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				feature: "scoutingDepth",
				path: ["pro_scouting"],
				text: "Draft Scouting > Pro Scouting",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				feature: "collegeSeason",
				path: ["college_overseas"],
				text: "Draft Scouting > College/Overseas (March Madness)",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["draft_team_history"],
				text: "Draft Team History",
			},
		],
	},
	{
		type: "header",
		long: "Stats",
		short: "S",
		league: true,
		commandPalette: true,
		children: [
			{
				type: "link",
				active: (pageID) => pageID === "gameLog",
				league: true,
				commandPalette: true,
				path: ["game_log"],
				text: "Game Log",
			},
			{
				type: "link",
				active: (pageID) =>
					pageID === "leaders" ||
					pageID === "leadersProgressive" ||
					pageID === "leadersYears",
				league: true,
				commandPalette: true,
				path: ["leaders"],
				text: "League Leaders",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["leaders_progressive"],
				text: "Progressive Leaders",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["leaders_years"],
				text: "Yearly Leaders",
			},
			{
				type: "link",
				active: (pageID) => pageID === "playerRatings",
				league: true,
				commandPalette: true,
				path: ["player_ratings"],
				text: "Player Ratings",
			},
			...archetypeLinks,
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["player_rating_dists"],
				text: "Player Rating Distributions",
			},
			{
				type: "link",
				active: (pageID) => pageID === "playerStats",
				league: true,
				commandPalette: true,
				path: ["player_stats"],
				text: "Player Stats",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["player_stat_dists"],
				text: "Player Stat Distributions",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: [
					"player_stats",
					"all",
					"career",
					bySport({
						baseball: "batting",
						basketball: "totals",
						football: "passing",
						hockey: "skater",
					}),
				],
				text: "Career Totals",
			},
			{
				type: "link",
				active: (pageID) => pageID === "playerBios",
				league: true,
				commandPalette: true,
				path: ["player_bios"],
				text: "Player Bios",
			},
			{
				type: "link",
				active: (pageID) => pageID === "playerGraphs",
				league: true,
				commandPalette: true,
				path: ["player_graphs"],
				text: "Player Graphs",
			},
			{
				type: "link",
				active: (pageID) => pageID === "advancedPlayerSearch",
				league: true,
				commandPalette: true,
				path: ["advanced_player_search"],
				text: "Advanced Player Search",
			},
			{
				type: "link",
				active: (pageID) => pageID === "teamStats",
				league: true,
				commandPalette: true,
				path: ["team_stats"],
				text: "Team Stats",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["team_stat_dists"],
				text: "Team Stat Distributions",
			},
			{
				type: "link",
				active: (pageID) => pageID === "teamGraphs",
				league: true,
				commandPalette: true,
				path: ["team_graphs"],
				text: "Team Graphs",
			},
			{
				type: "link",
				// Head-to-Head (and its Rivalries tab) is reached from League Stats' More links
				active: (pageID) =>
					pageID === "leagueStats" ||
					pageID === "headToHeadAll" ||
					pageID === "rivalries",
				league: true,
				commandPalette: true,
				path: ["league_stats"],
				text: "League Stats",
			},
			{
				type: "link",
				active: (pageID) => pageID === "injuries",
				league: true,
				commandPalette: true,
				path: ["injuries"],
				text: "Injuries",
			},
			{
				type: "link",
				active: (pageID) => pageID === "playerFeats",
				league: true,
				commandPalette: true,
				path: ["player_feats"],
				text: "Statistical Feats",
			},
			{
				type: "link",
				active: (pageID) => pageID === "awardRaces",
				league: true,
				commandPalette: true,
				path: ["award_races"],
				text: "Award Races",
			},
		],
	},
	{
		type: "header",
		long: "Tools",
		short: "X",
		league: true,
		nonLeague: true,
		commandPalette: true,
		children: [
			{
				type: "link",
				active: (pageID) => pageID === "achievements",
				league: true,
				nonLeague: true,
				commandPalette: true,
				path: "/achievements",
				text: "Achievements",
			},
			{
				type: "link",
				league: true,
				commandPalette: true,

				async onClick() {
					const response = await toWorker(
						"toolsMenu",
						"autoPlaySeasons",
						undefined,
					);
					return response;
				},

				text: "Auto Play",
			},
			{
				type: "link",
				league: true,
				nonLeague: true,
				commandPalette: true,

				onClick() {
					takeScreenshot();
				},

				prefix: <span className="glyphicon glyphicon-camera me-1" />,
				text: "Screenshot",
			},
			{
				type: "link",
				active: (pageID) =>
					pageID === "frivolities" || isFrivolitiesTabPage(pageID),
				league: true,
				commandPalette: true,
				path: ["frivolities"],
				text: "Frivolities",
			},
			{
				type: "link",
				active: (pageID) => pageID === "faceStyleGallery",
				league: true,
				nonLeague: true,
				commandPalette: true,
				path: "/face_style_gallery",
				text: "Face Style Gallery",
			},
			{
				type: "link",
				active: (pageID) => pageID === "notes",
				league: true,
				commandPalette: true,
				path: ["notes"],
				text: "Notes",
			},
			{
				type: "link",
				active: (pageID) => pageID === "exportLeague",
				league: true,
				commandPalette: true,
				path: ["export_league"],
				text: "Export League",
			},
			{
				type: "link",
				active: (pageID) => pageID === "exportStats",
				league: true,
				commandPalette: true,
				path: ["export_stats"],
				text: "Export Stats",
			},
			{
				type: "link",
				active: (pageID) => pageID === "exportPlayers",
				league: true,
				commandPalette: true,
				path: ["export_players"],
				text: "Import/Export Players",
			},
		],
	},
	{
		type: "header",
		long: "Settings",
		short: "Se",
		league: true,
		nonLeague: true,
		commandPalette: true,
		topMenu: "Tools",
		children: [
			{
				type: "link",
				active: (pageID) =>
					pageID === "globalSettings" ||
					pageID === "defaultNewLeagueSettings" ||
					pageID === "keyboardShortcuts",
				league: true,
				nonLeague: true,
				commandPalette: true,
				path: "/settings",
				text: "Global Settings",
			},
			{
				type: "link",
				league: true,
				nonLeague: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: "/settings/default",
				text: "Default New League Settings",
			},
			{
				type: "link",
				league: true,
				nonLeague: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: "/settings/keyboard",
				text: "Keyboard Shortcuts",
			},
			{
				type: "link",
				active: (pageID) => pageID === "settings",
				league: true,
				commandPalette: true,
				path: ["settings"],
				text: "League Settings",
			},
			{
				type: "link",
				active: (pageID) => pageID === "leagueExtras",
				league: true,
				commandPalette: true,
				path: ["league_extras"],
				text: "League Extras",
			},
			{
				type: "link",
				active: (pageID) => pageID === "awardSettings",
				league: true,
				commandPalette: true,
				path: ["award_settings"],
				text: "Award Settings",
			},
		],
	},
	{
		type: "header",
		long: "Commissioner",
		short: "C",
		league: true,
		commandPalette: true,
		collapsed: true,
		topMenu: "Tools",
		children: [
			{
				type: "link",
				active: (pageID) => pageID === "godMode",
				league: true,
				commandPalette: true,
				path: ["god_mode"],
				text: "God Mode",
			},
			{
				type: "link",
				active: (pageID) => pageID === "customizePlayer",
				godMode: true,
				league: true,
				commandPalette: true,
				path: ["customize_player"],
				text: "Create A Player",
			},
			{
				type: "link",
				active: (pageID) => pageID === "editAwardWinners",
				godMode: true,
				league: true,
				commandPalette: true,
				path: ["edit_award_winners"],
				text: "Edit Award Winners",
			},
			{
				type: "link",
				active: (pageID) => pageID === "manageTeams",
				league: true,
				commandPalette: true,
				path: ["manage_teams"],
				text: "Manage Teams",
			},
			{
				type: "link",
				active: (pageID) => pageID === "manageConfs",
				league: true,
				commandPalette: true,
				path: ["manage_confs"],
				text: "Manage Confs",
			},
			{
				type: "link",
				active: (pageID) => pageID === "scheduleEditor",
				league: true,
				commandPalette: true,
				path: ["schedule_editor"],
				text: "Schedule Editor",
			},
			{
				type: "link",
				active: (pageID) => pageID === "scheduledEvents",
				league: true,
				commandPalette: true,
				path: ["scheduled_events"],
				text: "Scheduled Events",
			},
			{
				type: "link",
				active: (pageID) => pageID === "expansionDraft",
				league: true,
				commandPalette: true,
				path: ["expansion_draft"],
				text: "Expansion Draft",
			},
			{
				type: "link",
				active: (pageID) => pageID === "fantasyDraft",
				league: true,
				commandPalette: true,
				path: ["fantasy_draft"],
				text: "Fantasy Draft",
			},
			...(REAL_PLAYERS_INFO
				? ([
						{
							type: "link",
							active: (pageID) => pageID === "eightyTwoZeroDraft",
							godMode: true,
							league: true,
							commandPalette: true,
							path: ["82-0_draft"],
							text: "82-0 Draft",
						},
					] as MenuItemLink[])
				: []),
			{
				type: "link",
				active: (pageID) => pageID === "multiTeamMode",
				league: true,
				commandPalette: true,
				godMode: true,
				path: ["multi_team_mode"],
				text: "Multi Team Mode",
			},
			{
				type: "link",
				active: (pageID) => pageID === "newTeam",
				league: true,
				commandPalette: true,
				godMode: true,
				path: ["new_team"],
				text: "Switch Team",
			},
		],
	},
	{
		type: "header",
		long: "Danger",
		short: "!",
		league: true,
		nonLeague: true,
		commandPalette: true,
		topMenu: "Tools",
		children: [
			{
				type: "link",
				active: (pageID) => pageID === "deleteOldData",
				league: true,
				commandPalette: true,
				path: ["delete_old_data"],
				text: "Delete Old Data",
			},
			{
				type: "link",
				active: (pageID) => pageID === "dangerZone",
				league: true,
				commandPalette: true,
				path: ["danger_zone"],
				text: "Danger Zone",
			},
			{
				type: "link",
				nonLeague: true,
				commandPalette: true,

				async onClick(): Promise<false> {
					const response = await toWorker("toolsMenu", "resetDb", undefined);

					if (response) {
						window.location.reload();
					}

					return false;
				},

				text: "Delete All Leagues",
			},
		],
	},
	{
		type: "header",
		long: "Frivolities",
		short: "F",
		league: true,
		commandPalette: true,
		commandPaletteOnly: true,
		children: Object.entries(frivolities).flatMap(([category, rows]) =>
			rows.map((row) => ({
				type: "link",
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: ["frivolities", ...row.urlParts],
				feature: row.feature,
				text: `${category} > ${row.name}`,
			})),
		),
	},
	{
		type: "header",
		long: "Help",
		short: "?",
		league: true,
		nonLeague: true,
		commandPalette: true,
		children: [
			{
				type: "link",
				active: (pageID) => pageID === "forkManual",
				league: true,
				nonLeague: true,
				commandPalette: true,
				path: "/fork_manual",
				text: "Fork Manual",
			},
			{
				type: "link",
				league: true,
				nonLeague: true,
				commandPalette: true,
				path: `https://${WEBSITE_ROOT}/manual/`,
				text: "Manual",
			},
			{
				type: "link",
				league: true,
				nonLeague: true,
				commandPalette: true,
				path: `https://${WEBSITE_ROOT}/manual/customization/`,
				text: "Custom Rosters",
			},
			{
				type: "link",
				league: true,
				nonLeague: true,
				commandPalette: true,
				path: `https://${WEBSITE_ROOT}/manual/debugging/`,
				text: "Debugging",
			},
			{
				type: "link",
				league: true,
				nonLeague: true,
				commandPalette: true,
				path: "https://zengm.com/changelog/",
				text: "Changelog",
			},
		],
	},
];

// Pages that moved under an original BBGM page leave the side menu (they stay in the command palette)
const consolidate = <T extends MenuItemLink | MenuItemHeader | MenuItemText>(
	item: T,
): T => {
	if (item.type === "header") {
		return { ...item, children: item.children.map(consolidate) };
	}
	if (
		item.type === "link" &&
		Array.isArray(item.path) &&
		CONSOLIDATED_PATHS.has(String(item.path[0]))
	) {
		return { ...item, commandPaletteOnly: true };
	}
	return item;
};

const startsWithUrl = (path: readonly unknown[], url: readonly unknown[]) =>
	url.every((part, i) => path[i] === part);

// Tabs of a page (util/pageTabs.ts) with no command palette item of their own get one, in the group of the page they
// are a tab of, so every tab-only page can be found by name ("Transactions > Trade Grader")
const addTabPages = (items: (MenuItemLink | MenuItemHeader)[]) => {
	const headers = items.filter(
		(item): item is MenuItemHeader => item.type === "header",
	);
	const findLink = (url: readonly unknown[]) => {
		for (const header of headers) {
			for (const link of header.children) {
				if (
					link.type === "link" &&
					link.commandPalette &&
					Array.isArray(link.path) &&
					startsWithUrl(link.path, url)
				) {
					return { header, link };
				}
			}
		}
	};
	const fallback = headers.find((header) => header.long === "Tools")!;

	for (const group of PAGE_TAB_GROUPS) {
		const host = findLink(group[0]!.url);
		const hostText =
			host && typeof host.link.text === "string"
				? host.link.text
				: group[0]!.name;
		for (const tab of tabsForSport(group)) {
			if (findLink(tab.url)) {
				continue;
			}
			(host?.header ?? fallback).children.push({
				type: "link",
				active: (pageID) => pageID === tab.id,
				league: true,
				commandPalette: true,
				commandPaletteOnly: true,
				path: [...tab.url] as MenuItemLink["path"],
				text: `${hostText} > ${tab.name}`,
			});
		}
	}

	return items;
};

export const menuItems: (MenuItemLink | MenuItemHeader)[] = addTabPages(
	menuItemsRaw.map(consolidate),
);

// Top navbar: groups with `topMenu` are folded into that group's dropdown (League gets Newsroom and History, Players gets
// Draft / College, Tools gets Settings, Commissioner and Danger), so the navbar keeps its few dropdowns
export const topMenuItems: (MenuItemLink | MenuItemHeader)[] = (() => {
	const out: (MenuItemLink | MenuItemHeader)[] = [];
	const byName = new Map<string, MenuItemHeader>();
	for (const item of menuItems) {
		if (item.commandPaletteOnly) {
			continue;
		}
		if (item.type === "header") {
			const target = item.topMenu ? byName.get(item.topMenu) : undefined;
			if (target) {
				target.children.push(...item.children);
				target.league ||= item.league;
				target.nonLeague ||= item.nonLeague;
				continue;
			}
			const copy = { ...item, children: [...item.children] };
			byName.set(item.long, copy);
			out.push(copy);
		} else {
			out.push(item);
		}
	}
	return out;
})();

// Stable key of a side menu link, to remember it (Favorites): its league URL, its address, or the action's name
export const menuLinkKey = (link: MenuItemLink) => {
	if (Array.isArray(link.path)) {
		return `l/${link.path.join("/")}`;
	}
	if (typeof link.path === "string") {
		return link.path;
	}
	return typeof link.text === "string" ? `action:${link.text}` : undefined;
};

// Phase-aware shortcuts ("Now" group of the side menu): the pages that matter in this phase, by league URL. College
// leagues rename the phases (docs/college-mode.md) and have their own pages, so each list holds both: links that are
// not available in this league (pro-only pages in a college league, turned-off League extras, ...) are left out like
// everywhere else in the menu
const NOW_PATHS: Partial<Record<Phase, string[]>> = {
	[PHASE.EXPANSION_DRAFT]: ["draft"],
	[PHASE.FANTASY_DRAFT]: ["draft"],
	// College: conference tournaments
	[PHASE.AFTER_TRADE_DEADLINE]: ["college_conf_tournaments"],
	[PHASE.PLAYOFFS]: ["playoffs", "college_polls", "daily_schedule"],
	// College: season over, the coaching carousel
	[PHASE.DRAFT_LOTTERY]: [
		"draft_lottery",
		"draft_scouting",
		"college_carousel",
	],
	// College: departures
	[PHASE.DRAFT]: ["draft", "draft_scouting", "college_departures"],
	// College: transfer portal
	[PHASE.AFTER_DRAFT]: ["college_portal"],
	// College: recruiting
	[PHASE.RESIGN_PLAYERS]: [
		"negotiation",
		"upcoming_free_agents",
		"team_finances",
		"college_recruiting",
	],
	// College: signing day
	[PHASE.FREE_AGENCY]: ["free_agents", "team_finances", "college_recruiting"],
};

// Re-signing has no menu item of its own (the Play menu leads there)
const reSignPlayersLink: MenuItemLink = {
	type: "link",
	active: (pageID) => pageID === "negotiationList",
	league: true,
	path: ["negotiation"],
	text: "Re-sign Players",
};

export const nowShortcuts = (phase: Phase | undefined): MenuItemLink[] => {
	const paths = phase === undefined ? undefined : NOW_PATHS[phase];
	if (!paths) {
		return [];
	}
	const links = new Map<string, MenuItemLink>([
		["negotiation", reSignPlayersLink],
	]);
	for (const item of menuItems) {
		for (const link of item.type === "header" ? item.children : [item]) {
			if (
				link.type === "link" &&
				Array.isArray(link.path) &&
				link.path.length === 1 &&
				typeof link.path[0] === "string"
			) {
				const existing = links.get(link.path[0]);
				// A side menu item over a command palette one
				if (
					!existing ||
					(existing.commandPaletteOnly && !link.commandPaletteOnly)
				) {
					links.set(link.path[0], link);
				}
			}
		}
	}
	return paths.flatMap((path) => {
		const link = links.get(path);
		return link ? [link] : [];
	});
};
