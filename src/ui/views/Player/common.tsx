import type { ReactNode } from "react";
import { helpers } from "../../util/helpers.ts";
import { dropdownOptions } from "../../hooks/useDropdownOptions.tsx";
import { PLAYER } from "../../../common/constants.ts";
import { useLocal } from "../../util/local.ts";
import { useScoutingOn } from "../../components/ScoutingReport/index.tsx";
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
	preDraftStats?: unknown[];
	earlierHonors?: unknown[];
	collegeSeason?: unknown;
}) =>
	__SPORT === "basketball" &&
	((player.preDraftStats?.length ?? 0) > 0 ||
		(player.earlierHonors?.length ?? 0) > 0 ||
		!!player.collegeSeason);

type ProfilePlayer = {
	tid: number;
	preDraftStats?: unknown[];
	earlierHonors?: unknown[];
	collegeSeason?: unknown;
};

/**
 * The player profile dropdown (Overview, Game Log, College/Overseas, Traits): Game Log only once he is in the league, College/Overseas only with pre-draft info, Traits only with the Player Traits setting on. undefined when there is nothing to switch between.
 */
export const getProfileDropdownOptions = (
	player: ProfilePlayer | undefined,
	playerTraits = false,
	scoutingReports = false,
) => {
	const options = dropdownOptions.playerProfile.filter(
		(option) =>
			(option.key !== "gameLog" ||
				!player ||
				player.tid !== PLAYER.UNDRAFTED) &&
			(option.key !== "preDraft" || (!!player && hasPreDraftInfo(player))) &&
			(option.key !== "traits" || (__SPORT === "basketball" && playerTraits)) &&
			(option.key !== "scouting" ||
				(__SPORT === "basketball" && scoutingReports)),
	);
	return options.length > 1 ? options : undefined;
};

// For the profile pages other than Overview: current is the page's own key, always kept (also where the page doesn't apply, like
// Traits in another sport or with the setting off) so the dropdown shows where you are
export const usePlayerProfileOptions = (
	player: ProfilePlayer | undefined,
	current: "overview" | "gameLog" | "preDraft" | "traits" | "scouting",
) => {
	const { playerTraits } = useLocal(["playerTraits"]);
	const scoutingReports = useScoutingOn();
	const keys = new Set(
		(
			getProfileDropdownOptions(player, !!playerTraits, scoutingReports) ??
			dropdownOptions.playerProfile.filter((o) => o.key === "overview")
		).map((o) => o.key),
	);
	keys.add(current);
	return dropdownOptions.playerProfile.filter((o) => keys.has(o.key));
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
	if (profile === "traits") {
		return ["player_traits", pid];
	}
	if (profile === "scouting") {
		return ["player_scouting", pid];
	}
	return ["player", pid];
};

export const playerProfileUrl = getProfileUrl;
