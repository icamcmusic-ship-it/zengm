import { useId } from "react";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import { helpers } from "../util/helpers.ts";
import { local } from "../util/local.ts";

// League discipline (technicalFouls setting): a marker next to a suspended player's name, like the injury badge, with the games he
// has left to sit out. The games come from local state (worker/util/suspensionsToUI.ts), so every name label can show it by pid
export const SuspensionIcon = ({
	className = "",
	pid,
	season,
}: {
	className?: string;
	pid?: number;
	// A past season's page (a historical roster, an old box score) shows no current suspension
	season?: number;
}) => {
	const tooltipId = useId();
	const games = local((state) =>
		pid === undefined || (season !== undefined && season !== state.season)
			? undefined
			: state.suspensions[pid],
	);

	if (games === undefined || games <= 0) {
		return null;
	}

	return (
		<OverlayTrigger
			trigger={["hover", "focus", "click"]}
			overlay={
				<Tooltip id={tooltipId}>
					Suspended, {games} more {helpers.plural("game", games)}
				</Tooltip>
			}
		>
			<span
				className={`badge bg-dark border border-danger text-danger badge-injury ${className}`}
			>
				SUS {games}
			</span>
		</OverlayTrigger>
	);
};
