import { assert, test, vi } from "vitest";
import {
	getTabGroup,
	isFrivolitiesTabPage,
	isTabOfSamePage,
	PAGE_TAB_GROUPS,
	tabHostPageID,
	tabsForSport,
} from "./pageTabs.ts";
import type {
	MenuItemHeader,
	MenuItemLink,
	MenuItemText,
} from "../../common/types.ts";
import { routeInfos } from "./routeInfos.ts";

// menuItems imports the game worker and the router, which need a browser
vi.mock("./promiseWorker.ts", () => ({ promiseWorker: {} }));
vi.mock("../router/index.ts", () => ({ default: {} }));

test("every tab URL is a route of its own view, so old links land on the tab", () => {
	const routes = routeInfos as Record<string, string>;
	for (const group of PAGE_TAB_GROUPS) {
		for (const tab of group) {
			const path = `/l/:lid/${tab.url.join("/")}`;
			assert.strictEqual(routes[path], tab.id, path);
		}
	}
});

test("a page is in at most one tab group, and the host is the first tab", () => {
	const seen = new Set<string>();
	for (const group of PAGE_TAB_GROUPS) {
		assert.isAtLeast(group.length, 2);
		assert.isUndefined(group[0]!.basketballOnly);
		for (const tab of group) {
			assert.isFalse(seen.has(tab.id), tab.id);
			seen.add(tab.id);
		}
	}
	assert.strictEqual(tabHostPageID("tradeMarket"), "tradingBlock");
	assert.strictEqual(tabHostPageID("tradeThree"), "trade");
	assert.strictEqual(tabHostPageID("tradeGrader"), "transactions");
	assert.strictEqual(tabHostPageID("homeCourt"), "leagueFinances");
	assert.strictEqual(tabHostPageID("pickValue"), "draftHistory");
	assert.strictEqual(tabHostPageID("draftBoard"), "draftScouting");
	assert.strictEqual(tabHostPageID("familyTrees"), "relatives");
	assert.strictEqual(
		tabHostPageID("jerseyNumbersTeams"),
		"frivolitiesJerseyNumbers",
	);
	assert.strictEqual(tabHostPageID("skillBadges"), "playerRatings");
	assert.strictEqual(tabHostPageID("coaches"), "historyAll");
	assert.strictEqual(tabHostPageID("hype"), "dailySchedule");
	assert.isUndefined(tabHostPageID("roster"));
	assert.isUndefined(getTabGroup(undefined));
});

test("basketball-only tabs drop out in other sports", () => {
	const finances = getTabGroup("leagueFinances")!;
	assert.strictEqual(tabsForSport(finances, "basketball").length, 4);
	assert.deepEqual(
		tabsForSport(finances, "hockey").map((tab) => tab.id),
		["leagueFinances"],
	);
	assert.strictEqual(
		tabsForSport(getTabGroup("draftBoard")!, "football").length,
		2,
	);
});

test("More links to other tabs of the same page are dropped", () => {
	assert.isTrue(isTabOfSamePage(["archetypes"], "player_ratings"));
	assert.isTrue(
		isTabOfSamePage(["frivolities", "home_court"], "league_finances"),
	);
	assert.isTrue(isTabOfSamePage(["contract_value"], "frivolities/economics"));
	assert.isTrue(isTabOfSamePage(["transactions", "all"], "trade_grader"));
	assert.isTrue(isTabOfSamePage(["timeline"], "history_all"));
	assert.isFalse(isTabOfSamePage(["frivolities", "economics"], "history_all"));
	assert.isFalse(isTabOfSamePage(["trade_market"], "trade"));
	assert.isFalse(
		isTabOfSamePage(["trade_grader", "team", "ATL"], "transactions"),
	);
	assert.isFalse(isTabOfSamePage(["roster"], "player_ratings"));
	assert.isFalse(isTabOfSamePage("/settings", "player_ratings"));
});

test("Frivolities tab pages are recognized, other tab pages are not", () => {
	for (const id of [
		"relatives",
		"familyTrees",
		"frivolitiesJerseyNumbers",
		"jerseyNumbersTeams",
	]) {
		assert.isTrue(isFrivolitiesTabPage(id), id);
	}
	for (const id of ["homeCourt", "redraft", "skillBadges", "frivolities"]) {
		assert.isFalse(isFrivolitiesTabPage(id), id);
	}
	assert.isFalse(isFrivolitiesTabPage(undefined));
});

test("every tab page highlights a visible side menu item, like SideBar does", async () => {
	vi.stubGlobal("CSS", { supports: () => false });
	const { menuItems } = await import("./menuItems.tsx");
	const links: MenuItemLink[] = [];
	const walk = (
		items: readonly (MenuItemLink | MenuItemHeader | MenuItemText)[],
	) => {
		for (const item of items) {
			if (item.type === "header" && !item.commandPaletteOnly) {
				walk(item.children);
			} else if (item.type === "link" && !item.commandPaletteOnly) {
				links.push(item);
			}
		}
	};
	walk(menuItems);
	for (const group of PAGE_TAB_GROUPS) {
		for (const tab of group) {
			const host = tabHostPageID(tab.id);
			const active = links.filter(
				(link) =>
					link.active?.(tab.id, undefined) ||
					(host !== undefined && link.active?.(host, undefined)),
			);
			assert.isAtLeast(active.length, 1, tab.id);
		}
	}
});

test("League Extras is a tab of League Settings, with no menu or command palette item of its own", async () => {
	vi.stubGlobal("CSS", { supports: () => false });
	assert.strictEqual(tabHostPageID("leagueExtras"), "settings");
	assert.deepEqual(
		tabsForSport(getTabGroup("settings")!, "hockey").map((tab) => tab.id),
		["settings", "leagueExtras"],
	);

	const { menuItems } = await import("./menuItems.tsx");
	const paths: unknown[] = [];
	const walk = (
		items: readonly (MenuItemLink | MenuItemHeader | MenuItemText)[],
	) => {
		for (const item of items) {
			if (item.type === "header") {
				walk(item.children);
			} else if (item.type === "link") {
				paths.push(item.path);
			}
		}
	};
	walk(menuItems);
	assert.isFalse(
		paths.some((path) => JSON.stringify(path)?.includes("league_extras")),
	);
});
