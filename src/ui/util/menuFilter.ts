import type { MenuItemLink, MenuItemText } from "../../common/types.ts";
import { menuItemHiddenForLeagueType } from "./collegeMode.ts";
import { isMenuLinkFeatureOn } from "./nativeFeatures.ts";
import { normalizeIntl } from "../../common/normalizeIntl.ts";

export type MenuContext = {
	godMode: boolean;
	inLeague: boolean;
	leagueType: string | undefined;
};

// Whether a link is available here: in or out of a league, God Mode, League extras switches (the same rule as the page
// it links to, like the Staff Report, which belongs to two features) and the league type (college mode). Shared by the
// side menu, its filter box and shortcut groups, and the command palette, so they never disagree. Non-reactive (League
// extras switches are read from the local state): components call useFeatureSwitches to re-render on a switch change.
export const menuLinkAvailable = (
	menuItem: MenuItemLink,
	{ godMode, inLeague, leagueType }: MenuContext,
) =>
	(inLeague ? !!menuItem.league : !!menuItem.nonLeague) &&
	(!menuItem.godMode || godMode) &&
	isMenuLinkFeatureOn(menuItem) &&
	!menuItemHiddenForLeagueType(menuItem, leagueType);

// Command palette rule: available, and meant for the command palette
export const commandPaletteLinkAvailable = (
	menuItem: MenuItemLink | MenuItemText,
	context: MenuContext,
): menuItem is MenuItemLink =>
	menuItem.type === "link" &&
	!!menuItem.commandPalette &&
	menuLinkAvailable(menuItem, context);

const normalize = (text: string) => normalizeIntl(text).toLowerCase();

// Whether a link matches what was typed in a filter box: every word is in its group name or its label
export const matchesMenuFilter = (
	query: string,
	category: string,
	text: string,
) => {
	const terms = normalize(query).split(/\s+/).filter(Boolean);
	const haystack = normalize(`${category} ${text}`);
	return terms.every((term) => haystack.includes(term));
};
