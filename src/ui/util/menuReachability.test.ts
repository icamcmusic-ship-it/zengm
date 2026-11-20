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
	"autoExpand",
	"autoRelocate",
	"coach",
	"depth",
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
	assert.include(labels, "League Settings > League Extras");
	assert.include(labels, "Trade > 3 teams");
	assert.include(labels, "Draft Scouting > Scouts");
});

test("Staff Report link follows the page's own rule (Scouting Depth, or Coaching Depth with Coaching Staff)", async () => {
	const menuItems = await loadMenuItems();
	const { isMenuLinkFeatureOn } = await import("./nativeFeatures.ts");
	const staffReport = allLinks(menuItems).find(
		(link) => link.text === "Staff Report",
	)!;

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
	assert.deepEqual(activeTexts("staffReport"), ["Staff Report"]);
	// Tabs with no item of their own highlight their host
	assert.deepEqual(activeTexts("scoutingDepartment"), ["Draft"]);
	assert.deepEqual(activeTexts("tradeThree"), ["Trade"]);

	// With the Staff Report turned off, it falls back to its host
	local.setState({ featureScoutingDepth: false } as any);
	assert.deepEqual(activeTexts("staffReport"), ["Draft"]);
});
