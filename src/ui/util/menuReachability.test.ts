import { afterEach, assert, test, vi } from "vitest";
import type {
	MenuItemHeader,
	MenuItemLink,
	MenuItemText,
} from "../../common/types.ts";
import { CONSOLIDATED_PAGES } from "./consolidatedPages.ts";
import { PAGE_TAB_GROUPS, tabsForSport } from "./pageTabs.ts";
import { routeInfos } from "./routeInfos.ts";
import { local } from "./local.ts";

// menuItems imports the game worker and the router, which need a browser
vi.mock("./promiseWorker.ts", () => ({ promiseWorker: {} }));
vi.mock("../router/index.ts", () => ({ default: {}, router: {} }));

// League pages that are not meant to be found from the menu, a tab bar or the command palette: they need an ID or a
// context (a player, a coach, a game, a message, a season, ...), are reached from the Play menu or another page's flow,
// or belong to other sports
const INTERNAL_PAGES = new Set([
	"allStar",
	"allStarDunk",
	"allStarTeams",
	"allStarThree",
	"allStarWeekend",
	"autoExpand",
	"autoRelocate",
	"coach",
	"depth",
	"gm",
	"history",
	"importPlayers",
	"importPlayersReal",
	"inbox",
	"liveGame",
	"message",
	"negotiationList",
	"player",
	"playerGameLog",
	"playerPreDraft",
	"playerScouting",
	"playerTraits",
	"protectPlayers",
	"tradeSummary",
	"upgrade65",
	"wrappedCompare",
]);

const loadMenuItems = async () => {
	vi.stubGlobal("CSS", { supports: () => false });
	return (await import("./menuItems.tsx")).menuItems;
};

const allLinks = (
	items: readonly (MenuItemLink | MenuItemHeader | MenuItemText)[],
): MenuItemLink[] =>
	items.flatMap((item) =>
		item.type === "header"
			? allLinks(item.children)
			: item.type === "link"
				? [item]
				: [],
	);

// View of a league link, like the router would resolve it (static parts win over parameters)
const viewOfPath = (path: readonly unknown[]) => {
	const parts = path.filter((part) => typeof part === "string");
	let best: { view: string; params: number } | undefined;
	for (const [route, view] of Object.entries(routeInfos)) {
		if (!route.startsWith("/l/:lid")) {
			continue;
		}
		const routeParts = route.split("/").slice(3);
		if (routeParts.length !== parts.length) {
			continue;
		}
		let params = 0;
		const matches = routeParts.every((routePart, i) => {
			if (routePart.startsWith(":")) {
				params += 1;
				return true;
			}
			return routePart === parts[i];
		});
		if (matches && (best === undefined || params < best.params)) {
			best = { view, params };
		}
	}
	return best?.view;
};

afterEach(() => {
	local.setState({
		featureScoutingDepth: undefined,
		featureCoachingDepth: undefined,
		coachingStaff: undefined,
		featureRumors: undefined,
	} as any);
});

test("every league page is in the menu, a tab group, or an explicit list of internal pages", async () => {
	const menuItems = await loadMenuItems();
	const reachable = new Set<string>();
	for (const link of allLinks(menuItems)) {
		if (Array.isArray(link.path)) {
			const view = viewOfPath(link.path);
			if (view !== undefined) {
				reachable.add(view);
			}
		}
	}
	for (const group of PAGE_TAB_GROUPS) {
		for (const tab of group) {
			reachable.add(tab.id);
		}
	}

	const missing = new Set<string>();
	for (const [path, view] of Object.entries(routeInfos)) {
		if (
			path.startsWith("/l/:lid") &&
			!reachable.has(view) &&
			!INTERNAL_PAGES.has(view)
		) {
			missing.add(view);
		}
	}
	assert.deepEqual([...missing], []);

	// The list only holds real pages that need it
	const views = new Set<string>(Object.values(routeInfos));
	for (const view of INTERNAL_PAGES) {
		assert.isTrue(views.has(view), view);
		assert.isFalse(reachable.has(view), view);
	}
});

test("every tab page and consolidated page is in the command palette", async () => {
	const menuItems = await loadMenuItems();
	const paletteViews = new Set(
		allLinks(menuItems)
			.filter((link) => link.commandPalette && Array.isArray(link.path))
			.map((link) => viewOfPath(link.path as unknown[])),
	);
	for (const group of PAGE_TAB_GROUPS) {
		for (const tab of tabsForSport(group)) {
			assert.isTrue(paletteViews.has(tab.id), tab.id);
		}
	}
	for (const { path } of CONSOLIDATED_PAGES) {
		assert.isTrue(paletteViews.has(viewOfPath([path])!), path);
	}
	const labels = allLinks(menuItems).map((link) => link.text);
	assert.include(labels, "League Extras");
	assert.include(labels, "Trade > 3 teams");
	assert.include(labels, "Draft Scouting > Scouts");
	assert.include(labels, "Draft Scouting > Staff Report");
	assert.include(labels, "Draft Scouting > Combine");
	assert.include(labels, "League History > Records Book");
	assert.include(labels, "League History > Eras");
});

test("Staff Report link follows the page's own rule (Scouting Depth, or Coaching Depth with Coaching Staff)", async () => {
	const menuItems = await loadMenuItems();
	const { isMenuLinkFeatureOn } = await import("./nativeFeatures.ts");
	const staffReport = allLinks(menuItems).find(
		(link) => Array.isArray(link.path) && link.path[0] === "staff_report",
	)!;
	assert.strictEqual(staffReport.text, "Draft Scouting > Staff Report");
	assert.isTrue(staffReport.commandPaletteOnly);

	local.setState({
		featureScoutingDepth: false,
		featureCoachingDepth: false,
	} as any);
	assert.isFalse(isMenuLinkFeatureOn(staffReport));

	local.setState({ featureScoutingDepth: true } as any);
	assert.isTrue(isMenuLinkFeatureOn(staffReport));

	local.setState({
		featureScoutingDepth: false,
		featureCoachingDepth: true,
		coachingStaff: false,
	} as any);
	assert.isFalse(isMenuLinkFeatureOn(staffReport));

	local.setState({ coachingStaff: true } as any);
	assert.isTrue(isMenuLinkFeatureOn(staffReport));
});

test("Staff Report and its tabs are pro-only", async () => {
	const { menuItemHiddenForLeagueType } = await import("./collegeMode.ts");
	assert.isTrue(
		menuItemHiddenForLeagueType(
			{ type: "link", path: ["staff_report"] },
			"college",
		),
	);
	for (const tab of PAGE_TAB_GROUPS.find(
		(group) => group[0]!.id === "draftScouting",
	)!) {
		assert.isTrue(
			menuItemHiddenForLeagueType(
				{ type: "link", path: [...tab.url] as MenuItemLink["path"] },
				"college",
			),
			tab.id,
		);
	}
});

test("only one side menu item is highlighted on a tab page with its own item", async () => {
	const menuItems = await loadMenuItems();
	const { sideMenuHighlightPageID } =
		await import("../components/Controller/SideBar.tsx");
	local.setState({
		featureScoutingDepth: true,
		featureRumors: true,
	} as any);
	const context = { godMode: false, lid: 1, leagueType: "pro" };

	const activeTexts = (pageID: string) => {
		const highlight = sideMenuHighlightPageID(pageID, undefined, context);
		return allLinks(menuItems)
			.filter(
				(link) =>
					!link.commandPaletteOnly &&
					link.league &&
					link.active?.(highlight, undefined),
			)
			.map((link) => link.text);
	};

	assert.deepEqual(activeTexts("rumors"), ["Rumors"]);
	assert.deepEqual(activeTexts("leagueExtras"), ["League Extras"]);
	assert.deepEqual(activeTexts("draftScouting"), ["Draft Scouting"]);
	assert.deepEqual(activeTexts("draftHistory"), ["Draft"]);
	// Tabs with no item of their own highlight their host
	assert.deepEqual(activeTexts("staffReport"), ["Draft Scouting"]);
	assert.deepEqual(activeTexts("scoutingDepartment"), ["Draft Scouting"]);
	assert.deepEqual(activeTexts("draftBoard"), ["Draft Scouting"]);
	assert.deepEqual(activeTexts("redraft"), ["Draft"]);
	assert.deepEqual(activeTexts("tradeThree"), ["Trade"]);
	assert.deepEqual(activeTexts("recordsBook"), ["League History"]);
});

test("side menu groups, in order, with Commissioner collapsed by default", async () => {
	const menuItems = await loadMenuItems();
	const headers = menuItems.filter(
		(item): item is MenuItemHeader =>
			item.type === "header" && !item.commandPaletteOnly,
	);
	assert.deepEqual(
		headers.map((header) => header.long),
		[
			"League",
			"Newsroom",
			"History",
			"Team",
			"Players",
			"Draft / College",
			"Stats",
			"Tools",
			"Settings",
			"Commissioner",
			"Danger",
			"Help",
		],
	);
	assert.deepEqual(
		headers.filter((header) => header.collapsed).map((header) => header.long),
		["Commissioner"],
	);

	const sideTexts = (long: string) =>
		headers
			.find((header) => header.long === long)!
			.children.filter(
				(child): child is MenuItemLink =>
					child.type === "link" && !child.commandPaletteOnly,
			)
			.map((link) => link.text);
	assert.deepEqual(sideTexts("League"), [
		"Standings",
		"Playoffs",
		"Conf. Tournaments",
		"NIT",
		"Daily Schedule",
		"Power Rankings",
		"Transactions",
		"Finances",
	]);
	assert.deepEqual(sideTexts("Newsroom"), [
		"News Feed",
		"Rumors",
		"Newspaper",
		"Wrapped",
		"Storylines",
	]);
	assert.deepEqual(sideTexts("History"), [
		"League History",
		"League Achievements",
		"Hall of Fame",
	]);
	assert.deepEqual(sideTexts("Settings"), [
		"Global Settings",
		"League Settings",
		"League Extras",
		"Award Settings",
	]);
	assert.deepEqual(sideTexts("Danger"), [
		"Delete Old Data",
		"Danger Zone",
		"Delete All Leagues",
	]);
	assert.includeMembers(sideTexts("Tools"), [
		"Achievements",
		"Auto Play",
		"Screenshot",
		"Frivolities",
		"Face Style Gallery",
	]);
	assert.includeMembers(sideTexts("Commissioner"), [
		"God Mode",
		"Create A Player",
		"Manage Teams",
		"Switch Team",
	]);
});

test("the top navbar folds the new groups into its old dropdowns", async () => {
	await loadMenuItems();
	const { topMenuItems } = await import("./menuItems.tsx");
	const headers = topMenuItems.filter(
		(item): item is MenuItemHeader => item.type === "header",
	);
	assert.deepEqual(
		headers.map((header) => header.long),
		["League", "Team", "Players", "Stats", "Tools", "Help"],
	);
	const texts = (long: string) =>
		allLinks(headers.filter((header) => header.long === long)).map(
			(link) => link.text,
		);
	assert.includeMembers(texts("League"), [
		"Standings",
		"News Feed",
		"Hall of Fame",
	]);
	assert.includeMembers(texts("Players"), ["Trade", "Draft", "Draft Scouting"]);
	assert.includeMembers(texts("Tools"), [
		"Achievements",
		"Global Settings",
		"God Mode",
		"Danger Zone",
		"Delete All Leagues",
	]);
	// Tools is still shown outside a league (Global Settings, Delete All Leagues)
	assert.isTrue(headers.find((header) => header.long === "Tools")!.nonLeague);
});

test("Now shortcuts follow the phase, and the league type", async () => {
	await loadMenuItems();
	const { PHASE } = await import("../../common/constants.ts");
	const { visibleNowShortcuts } =
		await import("../components/Controller/SideBar.tsx");
	const pro = { godMode: false, lid: 1, leagueType: "pro" };
	const college = { godMode: false, lid: 1, leagueType: "college" };
	const texts = (phase: number, context: typeof pro) =>
		visibleNowShortcuts(phase as any, context).map((link) => link.text);

	assert.deepEqual(texts(PHASE.REGULAR_SEASON, pro), []);
	assert.deepEqual(texts(PHASE.PLAYOFFS, pro), ["Playoffs", "Daily Schedule"]);
	assert.deepEqual(texts(PHASE.DRAFT, pro), ["Draft", "Draft Scouting"]);
	assert.deepEqual(texts(PHASE.RESIGN_PLAYERS, pro), [
		"Re-sign Players",
		"Upcoming Free Agents",
		"Finances",
	]);
	assert.deepEqual(texts(PHASE.FREE_AGENCY, pro), ["Free Agents", "Finances"]);

	assert.deepEqual(texts(PHASE.PLAYOFFS, college), [
		"Playoffs",
		"Top 25 & Selection",
		"Daily Schedule",
	]);
	assert.deepEqual(texts(PHASE.DRAFT, college), ["Departures & Arrivals"]);
	assert.deepEqual(texts(PHASE.RESIGN_PLAYERS, college), ["Recruiting"]);
	assert.deepEqual(texts(PHASE.AFTER_DRAFT, college), ["Transfer Portal"]);

	// Not outside a league
	assert.deepEqual(
		visibleNowShortcuts(PHASE.DRAFT, {
			godMode: false,
			leagueType: undefined,
		}),
		[],
	);
});

test("the filter box finds side menu and command palette links, with the command palette's rules", async () => {
	await loadMenuItems();
	const { filterMenuLinks } =
		await import("../components/Controller/SideBar.tsx");
	const pro = { godMode: false, lid: 1, leagueType: "pro" } as {
		godMode: boolean;
		lid?: number;
		leagueType: string | undefined;
	};
	const texts = (query: string, context = pro) =>
		filterMenuLinks(query, context).flatMap(({ category, links }) =>
			links.map((link) => `${category}: ${String(link.text)}`),
		);

	assert.include(texts("3 teams"), "Players: Trade > 3 teams");
	assert.include(texts("team fin"), "Team: Finances");
	assert.notInclude(texts("team fin"), "League: Finances");
	// God Mode items only in God Mode
	assert.notInclude(texts("create"), "Commissioner: Create A Player");
	assert.include(
		texts("create", { ...pro, godMode: true }),
		"Commissioner: Create A Player",
	);
	// Pro-only pages are not in a college league, college-only pages not in a pro one
	assert.deepEqual(texts("free agents", { ...pro, leagueType: "college" }), []);
	assert.deepEqual(texts("recruiting"), []);
	// Outside a league
	assert.include(
		texts("global", { godMode: false, leagueType: undefined }),
		"Settings: Global Settings",
	);
	assert.deepEqual(texts("zzz"), []);
});

test("Favorites keep pinned side menu links that are shown here, with a label that says which group", async () => {
	await loadMenuItems();
	const { shortcutLabel, visibleFavorites } =
		await import("../components/Controller/SideBar.tsx");
	const pro = { godMode: false, lid: 1, leagueType: "pro" };
	const favorites = visibleFavorites(
		[
			"l/team_finances",
			"l/customize_player",
			"l/standings",
			"nope",
			"/settings",
		],
		pro,
	);
	assert.deepEqual(
		favorites.map(({ group, link }) => shortcutLabel(link, group)),
		["Team Finances", "Standings", "Global Settings"],
	);
	assert.deepEqual(
		visibleFavorites(["l/customize_player"], { ...pro, godMode: true }).map(
			({ link }) => link.text,
		),
		["Create A Player"],
	);
	assert.deepEqual(
		visibleFavorites(["l/free_agents"], { ...pro, leagueType: "college" }),
		[],
	);
});
