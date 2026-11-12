// College mode in the UI (docs/college-mode.md): pages that do not exist in a college league, and the college-only pages
import type { MenuItemLink } from "../../common/types.ts";
import { local } from "./local.ts";

// First part of the league URL of pages hidden in a college league (contracts, trades, the pro draft, finances, ...)
const PRO_ONLY_PAGES = new Set([
	"free_agents",
	"upcoming_free_agents",
	"trade",
	"trading_block",
	"trade_offers",
	"trade_proposals",
	"trade_market",
	"trade_three",
	"saved_trades",
	"trade_summary",
	"draft",
	"draft_history",
	"draft_lottery",
	"draft_picks",
	"draft_scouting",
	"draft_board",
	"mock_draft",
	"college_overseas",
	"draft_team_history",
	"league_finances",
	"team_finances",
	"negotiation",
	"all_star",
	"contract_value",
	"trade_grader",
	"gm_history",
	"front_offices",
	"relatives",
]);

// A league URL (parts after /l/:lid/) of a page that does not exist in the current league, if it is a college league
export const urlHiddenInCollege = (url: unknown) =>
	isCollegeLeague() &&
	Array.isArray(url) &&
	typeof url[0] === "string" &&
	PRO_ONLY_PAGES.has(url[0]);

export const isCollegeLeague = () => local.getState().leagueType === "college";

export const useIsCollege = () =>
	local((state) => state.leagueType === "college");

const firstPart = (path: MenuItemLink["path"]) =>
	Array.isArray(path) ? path[0] : undefined;

/**
 * Should a menu item be hidden for this league type? College-only items (leagueType "college") are hidden in pro leagues, pro-only pages
 * in college leagues.
 */
export const menuItemHiddenForLeagueType = (
	menuItem: { type: string; path?: MenuItemLink["path"]; leagueType?: string },
	leagueType: string | undefined,
) => {
	if (menuItem.type !== "link") {
		return false;
	}
	const college = leagueType === "college";
	if (menuItem.leagueType === "college") {
		return !college;
	}
	if (college) {
		const first = firstPart(menuItem.path);
		return typeof first === "string" && PRO_ONLY_PAGES.has(first);
	}
	return false;
};
