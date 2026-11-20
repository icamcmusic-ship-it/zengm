import clsx from "clsx";
import { helpers } from "../util/helpers.ts";
import { isUrlFeatureOn, useFeatureSwitches } from "../util/nativeFeatures.ts";
import { getTabGroup, tabsForSport } from "../util/pageTabs.ts";
import { urlHiddenInCollege, useIsCollege } from "../util/collegeMode.ts";

// Tabs across the top of a page that has pages of this fork folded into it (see util/pageTabs.ts). Tabs of disabled
// League extras features and, in a college league, tabs of pro-only pages are hidden, and with only one tab left there
// is no tab bar at all.
export const PageTabs = ({ pageID }: { pageID: string | undefined }) => {
	// Re-render when a League extras switch changes
	useFeatureSwitches();
	// Re-render when the league type is known
	useIsCollege();

	const group = getTabGroup(pageID);
	if (!group) {
		return null;
	}

	const tabs = tabsForSport(group).filter(
		(tab) =>
			tab.id === pageID ||
			(isUrlFeatureOn(tab.url) && !urlHiddenInCollege(tab.url)),
	);
	if (tabs.length < 2) {
		return null;
	}

	return (
		<ul
			className="nav nav-tabs mb-3 flex-nowrap overflow-auto text-nowrap"
			data-testid="page-tabs"
		>
			{tabs.map((tab) => {
				const active = tab.id === pageID;
				return (
					<li className="nav-item" key={tab.id}>
						<a
							className={clsx("nav-link", { active })}
							aria-current={active ? "page" : undefined}
							href={helpers.leagueUrl(tab.url)}
						>
							{tab.name}
						</a>
					</li>
				);
			})}
		</ul>
	);
};
