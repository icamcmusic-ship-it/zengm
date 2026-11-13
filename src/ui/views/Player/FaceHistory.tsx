// League Extras "Face Aging": then and now (his rookie face, or his first season's, next to today's), and his face in each season
// it changed
import type { FaceConfig } from "facesjs";
import HideableSection from "../../components/HideableSection.tsx";
import { PlayerPicture } from "../../components/PlayerPicture.tsx";

export const FaceHistory = ({
	bornYear,
	colors,
	faceHistory,
	jersey,
}: {
	bornYear: number;
	colors?: [string, string, string];
	faceHistory: { season: number; face: FaceConfig; rookie?: true }[];
	jersey?: string;
}) => {
	if (faceHistory.length < 2) {
		return null;
	}
	const first = faceHistory[0]!;
	const now = faceHistory.at(-1)!;

	return (
		<HideableSection title="Then and Now" className="mt-3">
			<div className="d-flex flex-wrap gap-4 align-items-end">
				{[
					{ label: first.rookie ? "Rookie" : "Then", row: first },
					{ label: "Now", row: now },
				].map(({ label, row }) => (
					<figure key={label} className="mb-0 text-center">
						<div style={{ width: 100, height: 150 }}>
							<PlayerPicture face={row.face} colors={colors} jersey={jersey} />
						</div>
						<figcaption className="small">
							<b>{label}</b>: {row.season}, age {row.season - bornYear}
						</figcaption>
					</figure>
				))}
			</div>
			{faceHistory.length > 2 ? (
				<details className="mt-2">
					<summary>Every season his face changed</summary>
					<div className="d-flex flex-wrap gap-2 mt-2">
						{faceHistory.map((row) => (
							<figure key={row.season} className="mb-0 text-center">
								<div style={{ width: 54, height: 81 }}>
									<PlayerPicture
										face={row.face}
										colors={colors}
										jersey={jersey}
										lazy
									/>
								</div>
								<figcaption className="small text-body-secondary">
									{row.season}
								</figcaption>
							</figure>
						))}
					</div>
				</details>
			) : null}
		</HideableSection>
	);
};
