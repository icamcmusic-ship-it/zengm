import HideableSection from "../../components/HideableSection.tsx";
import { TraitBadges } from "../../components/PlayerTraits/TraitBadges.tsx";
import {
	TraitBars,
	TraitEffectsHelp,
} from "../../components/PlayerTraits/TraitBars.tsx";
import type { View } from "../../../common/types.ts";

export const PlayerTraitsSection = ({
	playerTraits,
}: {
	playerTraits: NonNullable<View<"player">["playerTraits"]>;
}) => {
	const uncertain = playerTraits.traits.some((t) => !t.exact);
	return (
		<HideableSection
			title="Traits"
			description={
				<>
					<TraitBadges traits={playerTraits.traits} max={4} />
					{uncertain ? (
						<span className="text-body-secondary">
							{playerTraits.isProspect
								? "Scouting estimates, with the range you can be confident in. Hidden traits are the least certain and become clear after he plays in the league."
								: "Hidden traits are still being learned and become exact after a few seasons."}
						</span>
					) : null}
				</>
			}
		>
			<TraitBars traits={playerTraits.traits} />
			<TraitEffectsHelp />
		</HideableSection>
	);
};
