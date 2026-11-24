import { useId } from "react";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import { timeBetweenGames } from "../../common/timeBetweenGames.ts";
import type { PlayerInjury } from "../../common/types.ts";
import {
	formatInjuryRange,
	GAME_TIME_LABELS,
	gameTimeStatus,
	injuryEstimateRange,
	injuryGamesOut,
} from "../../common/injuryOutlook.ts";
import { useLocal } from "../util/local.ts";

export const InjuryIcon = ({
	className = "",
	injury,
}: {
	className?: string;
	injury?: PlayerInjury & {
		playingThrough?: boolean;
		newThisGame?: boolean;
	};
}) => {
	const tooltipId = useId();
	const { godMode } = useLocal(["godMode"]);

	if (injury === undefined) {
		return null;
	}

	const colorClass = injury.playingThrough ? "warning" : "danger";

	let info;
	if (injury.gamesRemaining === -1) {
		// This is used in box scores, where it would be confusing to display "out X more days" in old box scores
		info = {
			title: injury.type,
			text: "+",
		};
	} else if (injury.gamesRemaining > 0 || injury.type !== "Healthy") {
		// One convention: the games he'll miss (one less than gamesRemaining for an injury from this game, common/injuryOutlook.ts)
		const gamesOut = injuryGamesOut(injury);
		const exact = `${gamesOut} more ${timeBetweenGames(gamesOut)}`;

		// Injury outlook: a game-time status for short injuries, an estimate range for longer ones (the exact games only in God Mode)
		const status = gameTimeStatus(injury);
		const range = injuryEstimateRange(injury);
		let title;
		let text: string | number = gamesOut;
		if (injury.gtd) {
			title = `${injury.type}, ${GAME_TIME_LABELS[injury.gtd].toLowerCase()} before the game and played`;
			text = injury.gtd;
		} else if (status) {
			title = `${injury.type}, ${GAME_TIME_LABELS[status].toLowerCase()}${status === "O" ? "" : " (game-time decision)"}`;
			text = status;
		} else if (range) {
			const estimate = formatInjuryRange(range.lo, range.hi);
			title = `${injury.type}, out an estimated ${estimate}`;
			text = `${range.lo}-${range.hi}`;
		} else {
			title = `${injury.type}, out ${exact}`;
		}
		if (godMode && (status || range)) {
			title += ` (God Mode: ${exact})`;
		}
		if (injury.treatment) {
			title += `, ${injury.treatment}${injury.treatmentOpen ? " (not decided yet)" : ""}`;
		}
		if (injury.playingThrough && !injury.gtd) {
			title += ", played through injury";
		}

		info = {
			title,
			text,
		};
	}

	if (info) {
		return (
			<OverlayTrigger
				trigger={["hover", "focus", "click"]}
				overlay={<Tooltip id={tooltipId}>{info.title}</Tooltip>}
			>
				<span className={`badge bg-${colorClass} badge-injury ${className}`}>
					{info.text}
				</span>
			</OverlayTrigger>
		);
	}

	return null;
};
