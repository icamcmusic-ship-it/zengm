import type { ReactNode } from "react";
import { helpers } from "../../util/helpers.ts";
import { dropdownOptions } from "../../hooks/useDropdownOptions.tsx";
import { PLAYER } from "../../../common/constants.ts";
import type { LeagueUrlParts } from "../../router/types.ts";

export const SeasonLink = ({
	className,
	pid,
	season,
}: {
	className?: string;
	pid: number;
	season: number;
}) => {
	return (
		<a
			className={className}
			href={helpers.leagueUrl(["player_game_log", pid, season])}
		>
			{season}
		</a>
	);
};

export const highlightLeaderText = (
	<>
		<span className="highlight-leader">Bold</span> indicates league leader
	</>
);

export const MaybeBold = ({
	bold,
	children,
}: {
	bold: boolean | undefined;
	children: ReactNode;
}) => {
	if (bold) {
		return <span className="highlight-leader">{children}</span>;
	}

	return children;
};

// He has a College/Overseas page: pre-draft stats, honors or a college season (basketball)
export const hasPreDraftInfo = (player: {
	preDraftStats: unknown[];
	earlierHonors: unknown[];
	collegeSeason?: unknown;
}) =>
	__SPORT === "basketball" &&
	(player.preDraftStats.length > 0 ||
		player.earlierHonors.length > 0 ||
		!!player.collegeSeason);

/**
 * The player profile dropdown (Overview, Game Log, College/Overseas): Game Log only once he is in the league, College/Overseas only with pre-draft info. undefined when there is nothing to switch between.
 */
export const getProfileDropdownOptions = (player: {
	tid: number;
	preDraftStats: unknown[];
	earlierHonors: unknown[];
	collegeSeason?: unknown;
}) => {
	const options = dropdownOptions.playerProfile.filter(
		(option) =>
			(option.key !== "gameLog" || player.tid !== PLAYER.UNDRAFTED) &&
			(option.key !== "preDraft" || hasPreDraftInfo(player)),
	);
	return options.length > 1 ? options : undefined;
};

export const getProfileUrl = (
	profile: string,
	pid: number,
	gameLogSeason: number,
): LeagueUrlParts => {
	if (profile === "gameLog") {
		return ["player_game_log", pid, gameLogSeason];
	}
	if (profile === "preDraft") {
		return ["player_pre_draft", pid];
	}
	return ["player", pid];
};
