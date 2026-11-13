// League Extras "Face Aging": Hall of Fame plaques, each Hall of Famer drawn in his prime (the pro season with his best ovr)
// in that season's jersey. Most recent inductees first.
import { useState } from "react";
import HideableSection from "../components/HideableSection.tsx";
import { PlayerPicture } from "../components/PlayerPicture.tsx";
import type { HofPlaque } from "../../common/faceHistory.ts";
import { helpers } from "../util/helpers.ts";

const FIRST = 12;

export const HallOfFamePlaques = ({ plaques }: { plaques: HofPlaque[] }) => {
	const [all, setAll] = useState(false);
	if (plaques.length === 0) {
		return null;
	}
	const shown = all ? plaques : plaques.slice(0, FIRST);
	return (
		<div data-testid="hof-plaques">
			<HideableSection title="Plaques" className="mb-3" pageName="hallOfFame">
				<div
					className="d-grid gap-3"
					style={{
						gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
					}}
				>
					{shown.map((p) => (
						<figure
							key={p.pid}
							className="mb-0 p-2 text-center border rounded bg-body-tertiary"
						>
							<div className="mx-auto" style={{ width: 100, height: 150 }}>
								<PlayerPicture
									face={p.face}
									imgURL={p.imgURL}
									colors={p.colors}
									jersey={p.jersey}
									lazy
								/>
							</div>
							<figcaption className="small mt-1">
								<a
									className="fw-bold"
									href={helpers.leagueUrl(["player", p.pid])}
								>
									{p.name}
								</a>
								<br />
								{p.firstSeason !== undefined
									? `${p.firstSeason}-${p.retiredYear}`
									: `Retired ${p.retiredYear}`}
								<br />
								<span className="text-body-secondary">Prime: {p.season}</span>
							</figcaption>
						</figure>
					))}
				</div>
				{plaques.length > FIRST ? (
					<button
						type="button"
						className="btn btn-sm btn-secondary mt-2"
						onClick={() => setAll(!all)}
					>
						{all ? "Show fewer" : `Show all ${plaques.length}`}
					</button>
				) : null}
			</HideableSection>
		</div>
	);
};
