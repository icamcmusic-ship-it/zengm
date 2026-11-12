import {
	MARQUEE_LABELS,
	marqueeLine,
	type GameMarquee,
} from "../../common/marquee.ts";
import { useFeatureOn } from "../util/nativeFeatures.ts";
import clsx from "clsx";

// Marquee Games: badges for holiday slates, national TV and rivalry games on the schedule pages
export const MarqueeBadges = ({
	className,
	game,
}: {
	className?: string;
	game: GameMarquee;
}) => {
	const on = useFeatureOn("marqueeGames");
	if (!on || (game.marquee === undefined && !game.rivalry)) {
		return null;
	}
	const title = marqueeLine(game);
	return (
		<div
			className={clsx("small text-body-secondary", className)}
			data-testid="marquee-badges"
			title={title}
		>
			{game.marquee !== undefined && game.marquee !== "nationalTv" ? (
				<span className="badge bg-success me-1">
					{MARQUEE_LABELS[game.marquee]}
				</span>
			) : null}
			{game.marquee !== undefined ? (
				<span className="badge bg-primary me-1">National TV</span>
			) : null}
			{game.rivalry ? (
				<span className="badge bg-danger me-1">Rivalry</span>
			) : null}
		</div>
	);
};
