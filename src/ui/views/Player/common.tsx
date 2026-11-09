import type { ReactNode } from "react";
import { helpers } from "../../util/helpers.ts";
import { dropdownOptions } from "../../hooks/useDropdownOptions.tsx";
import { useLocal } from "../../util/local.ts";
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

// The player page's sub-pages (Overview, Game Log, Traits) for the title bar dropdown. Traits only with the Player Traits setting on
export const usePlayerProfileOptions = () => {
	const { playerTraits } = useLocal(["playerTraits"]);
	return dropdownOptions.playerProfile.filter(
		(option) => option.key !== "traits" || playerTraits,
	);
};

export const playerProfileUrl = (
	profile: string,
	pid: number,
	gameLogSeason: number,
): LeagueUrlParts => {
	if (profile === "gameLog") {
		return ["player_game_log", pid, gameLogSeason];
	}
	if (profile === "traits") {
		return ["player_traits", pid];
	}
	return ["player", pid];
};
