import clsx from "clsx";
import { helpers } from "../util/helpers.ts";
import { isUrlFeatureOn, useFeatureSwitches } from "../util/nativeFeatures.ts";
import { getTabGroup, tabsForSport } from "../util/pageTabs.ts";

// Tabs across the top of a page that has pages of this fork folded into it (see util/pageTabs.ts). Tabs of disabled
// League extras features are hidden, and with only one tab left there is no tab bar at all.
export const PageTabs = ({ pageID }: { pageID: string | undefined }) => {
	// Re-render when a League extras switch changes
	useFeatureSwitches();

	const group = getTabGroup(pageID);
	if (!group) {
		return null;
	}

	const tabs = tabsForSport(group).filter(
		(tab) => tab.id === pageID || isUrlFeatureOn(tab.url),
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
