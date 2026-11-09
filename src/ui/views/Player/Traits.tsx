import { TraitBadges } from "../../components/PlayerTraits/TraitBadges.tsx";
import { helpers } from "../../util/helpers.ts";
import type { View } from "../../../common/types.ts";

// The short version on the player Overview: notable trait badges and a link to the full Traits page
export const PlayerTraitsSummary = ({
	pid,
	playerTraits,
}: {
	pid: number;
	playerTraits: NonNullable<View<"player">["playerTraits"]>;
}) => {
	const uncertain = playerTraits.traits.some((t) => !t.exact);
	return (
		<div className="mb-3" data-testid="player-traits-summary">
			<h2 className="mb-1">Traits</h2>
			<div className="d-flex flex-wrap align-items-center gap-1">
				<TraitBadges traits={playerTraits.traits} max={4} />
				<a href={helpers.leagueUrl(["player_traits", pid])}>
					All traits{uncertain ? " and scouting ranges" : ""} »
				</a>
			</div>
		</div>
	);
};
