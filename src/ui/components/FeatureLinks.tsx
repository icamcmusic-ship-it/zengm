import { Fragment } from "react";
import { helpers } from "../util/helpers.ts";
import { isUrlFeatureOn, useFeatureSwitches } from "../util/nativeFeatures.ts";
import type { LeagueUrlParts } from "../router/types.ts";

// Links to League extras pages, separated by " | ". Links to features that are turned off are left out, and nothing
// renders when none is left.
const FeatureLinks = ({
	className,
	links,
}: {
	className?: string;
	links: {
		url: LeagueUrlParts;
		text: string;
	}[];
}) => {
	useFeatureSwitches();
	const shown = links.filter((link) => isUrlFeatureOn(link.url));
	if (shown.length === 0) {
		return null;
	}
	return (
		<span className={className}>
			{shown.map((link, i) => (
				<Fragment key={i}>
					{i > 0 ? " | " : null}
					<a href={helpers.leagueUrl(link.url)}>{link.text}</a>
				</Fragment>
			))}
		</span>
	);
};

export default FeatureLinks;
